import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import nunjucks from "nunjucks";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");

const manifest = JSON.parse(readFileSync(join(pkg, "garden-plugin.json"), "utf8"));
const template = readFileSync(join(pkg, "templates/cats.njk"), "utf8");
const clientSrc = readFileSync(join(pkg, "add-cats.js"), "utf8");

function extractMap(name) {
  const start = clientSrc.indexOf(`var ${name} = {`);
  expect(start).toBeGreaterThan(-1);
  const end = clientSrc.indexOf("\n  };", start);
  const objSrc = clientSrc.slice(start + `var ${name} = `.length, end + 4);
  // eslint-disable-next-line no-new-func
  return new Function("return " + objSrc)();
}

const CLASSIC = extractMap("CLASSIC_MAP");
const ONEKO = extractMap("ONEKO_MAP");

// The client is a browser IIFE, so a pure helper is lifted out of the shipped
// source and called here, rather than asserted as a string of text.
function extractFn(name) {
  const start = clientSrc.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = clientSrc.indexOf("\n  }", start);
  const fnSrc = clientSrc.slice(start, end + 4);
  // eslint-disable-next-line no-new-func
  return new Function("return " + fnSrc)();
}

function constValue(name) {
  const m = clientSrc.match(new RegExp(`var ${name} = (\\d+);`));
  expect(m, name).not.toBe(null);
  return Number(m[1]);
}

function setting(key) {
  return (manifest.settings || []).find((s) => s.key === key);
}

function render(pluginSettings) {
  const env = new nunjucks.Environment(null, { autoescape: true });
  return env.renderString(template, { settings: { dgAddCats: true }, pluginSettings });
}

const basePlugin = {
  enabled: true, count: 2, scale: 32, summonMode: "stampede",
  skin: "neko", skins: "", chromaKey: "", tint: "", tints: "",
  trail: true, trailFade: 4,
};

describe("paw print setting", () => {
  it("is declared as an on-by-default boolean with an env override", () => {
    const trail = setting("trail");
    expect(trail, "trail setting").toBeDefined();
    expect(trail.type).toBe("boolean");
    expect(trail.default).toBe(true);
    expect(trail.env).toBe("ADD_CATS_TRAIL");
  });

  it("declares a fade duration in seconds", () => {
    const fade = setting("trailFade");
    expect(fade, "trailFade setting").toBeDefined();
    expect(fade.type).toBe("number");
    expect(fade.default).toBe(4);
    expect(fade.env).toBe("ADD_CATS_TRAIL_FADE");
  });

  it("ships as version 1.2.0", () => {
    expect(manifest.version).toBe("1.2.0");
  });
});

describe("template carries the paw print settings", () => {
  it("emits both attributes from pluginSettings", () => {
    const html = render({ ...basePlugin, trail: false, trailFade: 9 });
    expect(html).toContain('data-trail="false"');
    expect(html).toContain('data-trail-fade="9"');
  });

  it("still renders without the new settings (older site config)", () => {
    const { trail, trailFade, ...legacy } = basePlugin;
    const html = render(legacy);
    expect(html).toContain("data-add-cats");
    // Empty attributes fall back to the defaults in the client.
    expect(html).toContain('data-trail=""');
  });
});

describe("trail mark cells", () => {
  it("classic sheets declare four marks per direction, all in the effects row", () => {
    expect(CLASSIC.prints).toBeTruthy();
    for (const dir of ["s", "n"]) {
      const set = CLASSIC.prints[dir];
      expect(set.length, dir).toBe(4);
      for (const [c, r] of set) {
        expect(r, `${dir} row`).toBe(4);
        expect(c, `${dir} col`).toBeGreaterThanOrEqual(0);
        expect(c, `${dir} col in range`).toBeLessThan(8);
      }
    }
  });

  it("the two directions use eight distinct cells, none of them a cat frame", () => {
    const cells = [...CLASSIC.prints.s, ...CLASSIC.prints.n].map((c) => c.join(","));
    expect(new Set(cells).size).toBe(8);
    const catCells = new Set(
      Object.values(CLASSIC.frames).flat().map((c) => c.join(","))
    );
    for (const cell of cells) expect(catCells.has(cell), cell).toBe(false);
  });

  it("a 4-row oneko sheet declares no prints", () => {
    expect(ONEKO.prints).toBe(null);
  });
});

// The marks must exist in the art that ships, not only in the map: a cell that
// decodes to an empty square would stamp invisible prints.
describe("bundled sheets carry the trail marks", () => {
  const BUNDLED = ["neko", "ginger", "smokey", "midnight", "biscuit"];

  function inkAt(png, c, r, stride = 33) {
    let count = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const px = ((r * stride + y) * png.width + (c * stride + x)) << 2;
        if (png.data[px + 3] > 0) count++;
      }
    }
    return count;
  }

  it.each(BUNDLED)("%s: every mark cell has ink", (skin) => {
    const png = PNG.sync.read(readFileSync(join(pkg, "assets", skin + ".png")));
    for (const dir of ["s", "n"]) {
      for (const [c, r] of CLASSIC.prints[dir]) {
        expect(inkAt(png, c, r), `${skin} ${dir} r${r}c${c}`).toBeGreaterThan(20);
      }
    }
  });
});

// The client is a browser IIFE, so behaviour is tested by calling the shipped
// helpers; the remaining source assertions pin the wiring the browser run covers.
describe("client trail behaviour", () => {
  it("stamps every 26px and keeps at most 24 prints", () => {
    expect(constValue("TRAIL_SPACING")).toBe(26);
    expect(constValue("TRAIL_MAX")).toBe(24);
  });

  it("carries the remainder so the rhythm does not round up to the step size", () => {
    expect(clientSrc).toContain("cat.trailAcc -= TRAIL_SPACING;");
    expect(clientSrc).not.toContain("cat.trailAcc = 0;\n      stampPrint");
  });

  it("orients a print by the travel vector, matching the walk-sprite threshold", () => {
    const facesSouth = extractFn("printFacesSouth");
    // Steep steps: the vertical component decides, in both directions.
    expect(facesSouth(0, 10, 10)).toBe(true);
    expect(facesSouth(0, -10, 10)).toBe(false);
    expect(facesSouth(2, 10, Math.sqrt(104))).toBe(true);
    expect(facesSouth(2, -10, Math.sqrt(104))).toBe(false);
    // Shallow runs have no faithful print in the art: they lean on the
    // horizontal direction (east -> south, west -> north).
    expect(facesSouth(10, 0, 10)).toBe(true);
    expect(facesSouth(-10, 0, 10)).toBe(false);
    expect(facesSouth(10, 2, Math.sqrt(104))).toBe(true);
    expect(facesSouth(-10, 2, Math.sqrt(104))).toBe(false);
  });

  it("counts sheet rows from the pixel height", () => {
    const rowCount = extractFn("rowCount");
    expect(rowCount(197, 33, 32)).toBe(6);   // canonical classic sheet
    expect(rowCount(164, 33, 32)).toBe(5);   // short classic sheet: no mark row
    expect(rowCount(128, 32, 32)).toBe(4);   // oneko sheet
  });

  it("only grants a sheet its own marks at six rows or more", () => {
    expect(clientSrc).toContain("prints: base.prints && rows >= 6 ? base.prints : null");
  });

  it("measures real displacement, so a clamped cat stamps nothing", () => {
    expect(clientSrc).toContain("cat.trailAcc += moved;");
    expect(clientSrc).toContain("if (moved > 0.5 && cat.trailAcc >= TRAIL_SPACING)");
  });

  it("skips prints for reduced motion or a disabled setting", () => {
    expect(clientSrc).toContain("if (!cfg.trail || reducedMotion) return;");
  });

  it("loads the fallback prints untouched by the site's key or tint", () => {
    expect(clientSrc).toContain('loadSheet(cfg.assets + "neko.png", "neko", function (url, map) {');
    expect(clientSrc).toContain("}, true);");
    expect(clientSrc).toContain("var tint = skipKeys ? \"\" : tintFor(id);");
  });

  it("preloads the fallback at boot only when a cat needs it", () => {
    expect(clientSrc).toContain("if (!cats[c].map.prints) { loadPrintFallback(function () {}); break; }");
  });

  it("floors a pinned speed so a sub-pixel cat still leaves prints", () => {
    expect(clientSrc).toContain("return isFinite(pinned) ? Math.max(1, pinned) : 5 + Math.random() * 9;");
  });

  it("retires each print after it has faded", () => {
    expect(clientSrc).toContain("setTimeout(function () { removePrint(el); }, cfg.trailFade * 1000 + 80);");
  });
});
