import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import nunjucks from "nunjucks";
import { parse } from "node-html-parser";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");

const manifest = JSON.parse(readFileSync(join(pkg, "garden-plugin.json"), "utf8"));
const template = readFileSync(join(pkg, "templates/cats.njk"), "utf8");
const clientSrc = readFileSync(join(pkg, "add-cats.js"), "utf8");

function render(settings, pluginSettings) {
  const env = new nunjucks.Environment(null, { autoescape: true });
  return env.renderString(template, { settings, pluginSettings });
}

const basePlugin = {
  enabled: true, count: 3, scale: 32, summonMode: "clicked",
  skin: "neko", skins: "", chromaKey: "", tint: "", tints: "",
};

// Read width/height from a PNG IHDR chunk (bytes 16..24), big-endian.
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("manifest", () => {
  it("declares the required keys", () => {
    for (const k of ["id", "name", "version", "description", "author"]) {
      expect(manifest[k], k).toBeTruthy();
    }
  });

  it("uses a valid id and never the reserved dg- prefix", () => {
    expect(manifest.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(manifest.id.startsWith("dg-")).toBe(false);
    expect(manifest.id).toBe("add-cats");
  });

  it("declares only relative slot paths without traversal", () => {
    for (const p of Object.values(manifest.slots || {})) {
      const files = Array.isArray(p) ? p : [p];
      for (const f of files) {
        expect(f).not.toContain("..");
        expect(f.startsWith("/")).toBe(false);
      }
    }
  });

  it("declares the note flag and every setting has a key and type", () => {
    expect(manifest.noteSettings).toContain("dgAddCats");
    for (const s of manifest.settings) {
      expect(s.key, JSON.stringify(s)).toBeTruthy();
      expect(["text", "boolean", "number", "select"]).toContain(s.type);
    }
  });

  it("declares the fur colour settings with their environment names", () => {
    const byKey = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
    for (const [key, env] of [["tint", "ADD_CATS_TINT"], ["tints", "ADD_CATS_TINTS"]]) {
      expect(byKey[key], key + " declared").toBeTruthy();
      expect(byKey[key].type, key).toBe("text");
      expect(byKey[key].env, key).toBe(env);
    }
  });

  it("declares the script and styles it ships", () => {
    expect(manifest.scripts).toContain("add-cats.js");
    expect(manifest.styles).toContain("styles.css");
  });
});

describe("bundled assets", () => {
  it("ships the bundled skins at the expected size", () => {
    // All bundled skins are the public-domain classic sheet or recolours of it,
    // so every one is the 263x197 (6-row) sheet.
    const skins = ["neko", "ginger", "smokey", "midnight", "biscuit"];
    expect(skins.length).toBeGreaterThan(1);
    for (const skin of skins) {
      const path = join(pkg, "assets", skin + ".png");
      expect(existsSync(path), skin + " present").toBe(true);
      const size = pngSize(readFileSync(path));
      expect(size.width, skin).toBe(263);
      expect(size.height, skin).toBe(197);
    }
  });
});

describe("template rendering", () => {
  it("renders nothing when the page is not tagged", () => {
    const html = render({ dgAddCats: false }, basePlugin);
    expect(html.trim()).toBe("");
  });

  it("renders nothing when the plugin is disabled", () => {
    const html = render({ dgAddCats: true }, { ...basePlugin, enabled: false });
    expect(html.trim()).toBe("");
  });

  it("emits the data script only when enabled and tagged", () => {
    const html = render({ dgAddCats: true }, basePlugin);
    const root = parse(html);
    const el = root.querySelector("script[data-add-cats]");
    expect(el).not.toBeNull();
    expect(el.getAttribute("data-count")).toBe("3");
    expect(el.getAttribute("data-mode")).toBe("clicked");
    expect(el.getAttribute("data-skin")).toBe("neko");
    expect(el.getAttribute("data-assets")).toBe("/plugins/add-cats/assets/");
    // The skins map is a JSON string passed straight through (autoescaped in
    // the attribute); it must round-trip to a parsed object on the client.
    const expectedSkins = basePlugin.skins
      ? JSON.parse(basePlugin.skins)
      : {};
    expect(JSON.parse(el.getAttribute("data-skins") || "{}")).toEqual(
      expectedSkins
    );
  });

  it("passes the fur colour settings through to the client", () => {
    const html = render({ dgAddCats: true }, {
      ...basePlugin, tint: "#8b6bd6", tints: '{"greta":"#a06cd5"}',
    });
    const el = parse(html).querySelector("script[data-add-cats]");
    expect(el.getAttribute("data-tint")).toBe("#8b6bd6");
    // Per-skin colours ride in a single-quoted JSON attribute, so they round-trip
    // to a parsed object on the client like the skins map does.
    expect(JSON.parse(el.getAttribute("data-tints"))).toEqual({ greta: "#a06cd5" });
  });

  it("escapes a hostile tints map instead of emitting raw markup", () => {
    const html = render({ dgAddCats: true }, {
      ...basePlugin, tints: '{"greta":"<script>alert(1)</script>"}',
    });
    expect(html).not.toContain("<script>alert(1)");
  });

  it("escapes a hostile skin map instead of emitting raw markup", () => {
    const html = render({ dgAddCats: true }, {
      ...basePlugin,
      skins: '{"evil":"<script>alert(1)</script>"}',
    });
    expect(html).not.toContain("<script>alert(1)");
  });
});

describe("client behavior (source contract)", () => {
  it("clamps count and scale, and never blocks page interaction", () => {
    expect(clientSrc).toContain("clampInt(script.dataset.count, 1, 5");
    expect(clientSrc).toContain("clampInt(script.dataset.scale, 16, 64");
    const css = readFileSync(join(pkg, "styles.css"), "utf8");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("image-rendering: pixelated");
  });

  it("honors reduced motion", () => {
    expect(clientSrc).toContain("prefers-reduced-motion: reduce");
  });

  it("supports both summon modes and auto-detects both sheet layouts", () => {
    expect(clientSrc).toContain('cfg.mode === "stampede"');
    expect(clientSrc).toContain("nearest(x, y)");
    // Detection must be width-based: classic sheets are 263px wide (not a
    // multiple of the 32px cell), oneko sheets are a clean 256px. Height
    // varies between classic skins, so it cannot be the signal.
    expect(clientSrc).toContain("width % 32 !== 0");
  });

  it("lets a skin setting pin distinct named cats via a JSON array", () => {
    // A JSON-array skin value cycles distinct ids across the resident cats
    // (e.g. ["greta","nigel"]), so two named cats render side by side.
    expect(clientSrc).toContain("Array.isArray(cfg.skin)");
    expect(clientSrc).toContain("cfg.skin[i % cfg.skin.length]");
    expect(clientSrc).toContain('value.charAt(0) === "["');
  });

  it("lets a speeds setting pin per-skin walk speed, falling back to random", () => {
    // speedFor returns a pinned number for a listed skin, else random 5..14.
    expect(clientSrc).toContain("function speedFor(skin)");
    expect(clientSrc).toContain("cfg.speeds && typeof cfg.speeds[skin] === \"number\"");
    // Pinned speeds are floored at 1px so a sub-pixel cat still travels far
    // enough to leave a trail.
    expect(clientSrc).toContain("isFinite(pinned) ? Math.max(1, pinned) : 5 + Math.random() * 9");
    expect(clientSrc).toContain("makeCat(url, loadedMap, skinsToSpawn[index])");
    // The slot template passes the speeds map through to the client.
    expect(template).toContain("data-speeds");
  });

  it("scales the sheet from the loaded image, not a fixed map constant", () => {
    // Classic heights vary (6-row and 5-row sheets both exist in the wild), so
    // background scaling must come from the decoded sheet or the shorter ones
    // stretch. Bundled sheets are both 197, but BYO skins are not.
    expect(clientSrc).toContain("width: img.naturalWidth, height: img.naturalHeight");
    expect(clientSrc).toContain("el.style.backgroundSize = (map.width * k)");
  });

  it("re-hues the cat frames from a validated hex colour", () => {
    expect(clientSrc).toContain("script.dataset.tint");
    expect(clientSrc).toContain("script.dataset.tints");
    // A malformed colour must degrade to "no tint", never to a broken sheet.
    expect(clientSrc).toContain("/^#([0-9a-f]{3}|[0-9a-f]{6})$/");
    // Chroma keying and re-hueing share one canvas pass, so a sheet is drawn once.
    // `skipKeys` loads a sheet untouched: the bundled sheet a trail borrows
    // prints from must not be re-keyed or re-hued by the site's own settings.
    expect(clientSrc).toContain("if (!skipKeys && (cfg.chromaKey || tint))");
    // Only the rows the frame map draws cats from are touched, so the effects
    // and text frames in a classic sheet's lower rows keep their colours.
    expect(clientSrc).toContain("catRowsOf(map)");
    expect(clientSrc).toContain("rows.indexOf(Math.floor(y / stride)) === -1");
    expect(template).toContain("data-tint");
  });

  it("fetches only the configured sheets and makes no other requests", () => {
    // The only network primitive is an Image() used for the sprite sheet.
    const networkCalls = clientSrc.match(/fetch\(|XMLHttpRequest|navigator\.sendBeacon/g) || [];
    expect(networkCalls).toEqual([]);
  });

  it("is dependency-free (no require/import of npm packages)", () => {
    expect(/\brequire\(/.test(clientSrc)).toBe(false);
    expect(/\bimport\s/.test(clientSrc)).toBe(false);
  });

  it("does not hardcode a host identity", () => {
    for (const bad of ["paologabriel", "/contact/", "closeFloatingTray", "wedding"]) {
      expect(clientSrc.includes(bad), bad).toBe(false);
    }
  });
});
