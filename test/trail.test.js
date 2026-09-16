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
  it("classic sheets declare four mark variants, all in the effects row", () => {
    expect(CLASSIC.prints).toBeTruthy();
    expect(CLASSIC.prints.length).toBe(4);
    for (const { cell: [c, r] } of CLASSIC.prints) {
      expect(r, "row").toBe(4);
      expect(c, "col").toBeGreaterThanOrEqual(0);
      expect(c, "col in range").toBeLessThan(8);
    }
  });

  it("each cell declares the direction its own art already faces", () => {
    // The four variants are not drawn the same way round — cell 0's toes point
    // south, the others south-east/east/north-east — so a stamp is turned by the
    // difference between the cat's heading and this angle. Getting one of these
    // wrong is exactly what makes the trail look like it points at random.
    expect(CLASSIC.prints.map((p) => p.faces)).toEqual([90, 45, 0, -45]);
  });

  it("the mark cells are distinct, all in row 4, and none is a cat frame", () => {
    const cells = CLASSIC.prints.map((p) => p.cell.join(","));
    expect(new Set(cells).size).toBe(4);
    expect(CLASSIC.prints.map((p) => p.cell[1])).toEqual([4, 4, 4, 4]);
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
    for (const { cell: [c, r] } of CLASSIC.prints) {
      expect(inkAt(png, c, r), `${skin} r${r}c${c}`).toBeGreaterThan(20);
    }
  });

  // The declared facing of each cell has to match the art that ships, or the
  // trail points off by however far the map is wrong. Measured the way a reader
  // sees it: the pad is the biggest blob of ink, the toes are the small marks
  // around it, and the print points from the pad towards the toes.
  function facingOf(png, c, r, stride = 33) {
    const ink = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const px = ((r * stride + y) * png.width + (c * stride + x)) << 2;
        if (png.data[px + 3] > 40) ink.push(x + "," + y);
      }
    }
    const seen = new Set(), blobs = [];
    for (const key of ink) {
      if (seen.has(key)) continue;
      const queue = [key], blob = [];
      seen.add(key);
      while (queue.length) {
        const [x, y] = queue.pop().split(",").map(Number);
        blob.push([x, y]);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const nk = (x + dx) + "," + (y + dy);
            if (ink.includes(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
          }
        }
      }
      blobs.push(blob);
    }
    blobs.sort((a, b) => b.length - a.length);
    const mid = (blob) => [
      blob.reduce((s, p) => s + p[0], 0) / blob.length,
      blob.reduce((s, p) => s + p[1], 0) / blob.length
    ];
    const pad = mid(blobs[0]);
    const toes = blobs.slice(1);
    if (!toes.length) return null;
    const t = toes.flat();
    const toesMid = [
      t.reduce((s, p) => s + p[0], 0) / t.length,
      t.reduce((s, p) => s + p[1], 0) / t.length
    ];
    const deg = Math.atan2(toesMid[1] - pad[1], toesMid[0] - pad[0]) * 180 / Math.PI;
    return Math.round(deg / 45) * 45;
  }

  // Ink centroid of a cell, as an offset from the cell's centre — the same thing
  // the map declares as dx/dy and stampPrint subtracts so the print sits over the
  // cat. A cell that draws its print in a corner needs a big offset here.
  function centroidOffset(png, c, r, stride = 33) {
    const pts = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const px = ((r * stride + y) * png.width + (c * stride + x)) << 2;
        if (png.data[px + 3] > 40) pts.push([x, y]);
      }
    }
    if (!pts.length) return null;
    return [
      Math.round(pts.reduce((s, p) => s + p[0], 0) / pts.length - 16),
      Math.round(pts.reduce((s, p) => s + p[1], 0) / pts.length - 16)
    ];
  }

  it.each(BUNDLED)("%s: declared facings match the art", (skin) => {
    const png = PNG.sync.read(readFileSync(join(pkg, "assets", skin + ".png")));
    for (const { cell: [c, r], faces } of CLASSIC.prints) {
      const measured = facingOf(png, c, r);
      expect(measured, `${skin} r${r}c${c} facing`).not.toBe(null);
      expect(((faces - measured) % 360 + 360) % 360, `${skin} r${r}c${c}`).toBe(0);
    }
  });

  it.each(BUNDLED)("%s: declared offsets match where the art sits", (skin) => {
    const png = PNG.sync.read(readFileSync(join(pkg, "assets", skin + ".png")));
    for (const { cell: [c, r], dx, dy } of CLASSIC.prints) {
      const measured = centroidOffset(png, c, r);
      expect(measured, `${skin} r${r}c${c} centroid`).not.toBe(null);
      // Off by more than a pixel or two and every print of that variant sits
      // visibly beside the paw instead of on it.
      expect(Math.abs(measured[0] - dx), `${skin} r${r}c${c} dx`).toBeLessThanOrEqual(1);
      expect(Math.abs(measured[1] - dy), `${skin} r${r}c${c} dy`).toBeLessThanOrEqual(1);
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

  it("turns a print to follow the path in all eight directions", () => {
    const rot = extractFn("printRotation");
    const SOUTH_ART = 90;   // cell 0's own facing, in screen degrees
    // A southward run leaves cell 0's art alone; the other headings are quarter,
    // half or eighth turns off it.
    expect(rot(0, 10, SOUTH_ART)).toBe(0);      // south
    expect(rot(10, 0, SOUTH_ART)).toBe(270);    // east
    expect(rot(0, -10, SOUTH_ART)).toBe(180);   // north
    expect(rot(-10, 0, SOUTH_ART)).toBe(90);    // west
    expect(rot(10, 10, SOUTH_ART)).toBe(315);   // south-east
    expect(rot(-10, 10, SOUTH_ART)).toBe(45);   // south-west
    expect(rot(10, -10, SOUTH_ART)).toBe(225);  // north-east
    expect(rot(-10, -10, SOUTH_ART)).toBe(135); // north-west
  });

  it("turns a cell by the difference between heading and its own facing", () => {
    const rot = extractFn("printRotation");
    // Same heading, four cells drawn facing four ways: each gets its own turn, so
    // every mark in a run ends up pointing the same way as the cat (the bug was
    // turning them all as if the art faced south).
    for (const base of [90, 45, 0, -45]) {
      expect(rot(10, 0, base), `base ${base}`).toBe((0 - base % 360 + 360) % 360);
    }
    // Art already facing the way the cat runs needs no turn at all.
    expect(rot(10, 0, 0)).toBe(0);
    expect(rot(0, 10, 90)).toBe(0);
    // And art facing north has to be turned most of the way round to point east.
    expect(rot(10, 0, 270)).toBe(90);
  });

  it("keeps direction on a shallow run instead of collapsing to south/north", () => {
    // Regression: marks used to be picked from a south set or a north set only,
    // so a cat running across the screen left prints pointing down or up.
    const rot = extractFn("printRotation");
    expect(rot(10, 2, 90)).toBe(270);    // east-ish, not south
    expect(rot(-10, 2, 90)).toBe(90);    // west-ish, not north
    expect(rot(10, -2, 90)).toBe(270);
    expect(rot(-10, -2, 90)).toBe(90);
    // Every heading lands on a 45deg step, so a half turn stays on the pixel grid.
    for (const [x, y] of [[3, 7], [-3, 7], [7, -3], [-7, -3], [0, 5], [5, 0]]) {
      for (const base of [90, 45, 0, -45]) expect(rot(x, y, base) % 45).toBe(0);
    }
    // No heading to follow: the mark is left as drawn rather than turned blind.
    for (const base of [90, 45, 0, -45]) expect(rot(0, 0, base)).toBe(0);
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

  it("stamps the mark rotated, and takes the heading from the whole stretch", () => {
    expect(clientSrc).toContain('"rotate(" + rotation + "deg) translate(" +');
    expect(clientSrc).toContain('(-mark.mark.dx * k) + "px," + (-mark.mark.dy * k) + "px)"');
    expect(clientSrc).toContain("var rotation = printRotation(headingX, headingY, mark.mark.faces || 0);");
    expect(clientSrc).toContain("cat.trailDx += movedX;");
    expect(clientSrc).toContain("cat.trailDy += movedY;");
    expect(clientSrc).toContain("stampPrint(cat, tx, ty);");
  });

  it("trails a print behind the cat, whichever way it is running", () => {
    const point = extractFn("stampPoint");
    const SIZE = 24, BACK = 11.2;
    const centreOf = (p) => [p.x + SIZE / 2, p.y + SIZE / 2];
    // Regression: the stamp used a fixed offset south of the cat, so only a
    // northward run trailed (everything else left prints beside or ahead of it).
    for (const [name, hx, hy, dx, dy] of [
      ["east", 10, 0, -1, 0],
      ["west", -10, 0, 1, 0],
      ["south", 0, 10, 0, -1],
      ["north", 0, -10, 0, 1],
      ["south-east", 10, 10, -1, -1],
      ["north-west", -10, -10, 1, 1]
    ]) {
      const [cx0, cy0] = centreOf(point(200, 200, hx, hy, BACK, SIZE));
      const moved = [cx0 - 200, cy0 - 200];
      const behind = moved[0] * dx + moved[1] * dy;
      expect(behind, `${name} trails behind`).toBeGreaterThan(0);
      // A diagonal keeps the same trailing distance, split across both axes.
      expect(Math.hypot(moved[0], moved[1]), `${name} distance`).toBeCloseTo(BACK, 1);
    }
    // No heading to follow: fall back to the old southward trail.
    expect(centreOf(point(200, 200, 0, 0, BACK, SIZE))).toEqual([200, 200 - BACK]);
  });

  it("stamps from the heading, not a fixed offset", () => {
    expect(clientSrc).toContain("var at = stampPoint(cat.x, cat.y, headingX, headingY, cfg.scale * 0.35, size);");
    expect(clientSrc).not.toContain("cat.y + cfg.scale * 0.25");
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

  it("draws a print as bare art, with no plate behind the mark", () => {
    const css = readFileSync(join(pkg, "styles.css"), "utf8");
    const start = css.indexOf(".add-cats-print {");
    expect(start, ".add-cats-print rule").toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("background-color: transparent;");
    // Regression guard: a plate (or a rounded box) makes every mark read as a
    // pasted square instead of a paw print.
    expect(block).not.toMatch(/border-radius/);
    expect(block).not.toMatch(/rgba\(/);
    // A rotated mark has to turn about its own centre, not a corner.
    expect(block).toContain("transform-origin: center;");
  });

  it("retires each print after it has faded", () => {
    expect(clientSrc).toContain("setTimeout(function () { removePrint(el); }, cfg.trailFade * 1000 + 80);");
  });
});
