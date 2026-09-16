import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const clientSrc = readFileSync(join(pkg, "add-cats.js"), "utf8");

// The client is one hand-authored file, so tests pull the real functions out of
// the shipped source and run them, the same way frame-maps.test.js extracts the
// frame maps. Nothing is reimplemented here: a change to the shipped tint has to
// pass these tests.
const blockStart = clientSrc.indexOf("function hexToRgb(");
const tintStart = clientSrc.indexOf("function tintFrames(");
const blockEnd = clientSrc.indexOf("\n  }", tintStart) + 4;
const block = clientSrc.slice(blockStart, blockEnd);

function load(cfg) {
  return new Function(
    "cfg",
    block +
      "\n  return { hexToRgb: hexToRgb, tintFor: tintFor, catRowsOf: catRowsOf," +
      " tintFrames: tintFrames, OUTLINE_LUM: OUTLINE_LUM, FLOOR_LUM: FLOOR_LUM };"
  )(cfg || {});
}

const api = load({});
function extractMap(name) {
  const start = clientSrc.indexOf(`var ${name} = {`);
  const end = clientSrc.indexOf("\n  };", start);
  return new Function("return " + clientSrc.slice(start + `var ${name} = `.length, end + 4))();
}
const CLASSIC = extractMap("CLASSIC_MAP");
const ONEKO = extractMap("ONEKO_MAP");

function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}
function pxHue(r, g, b) { return hexToHue("#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")); }
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const dHue = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// A synthetic sheet: three 33px cell rows, only rows 0 and 1 carrying cat frames.
const STRIDE = 33, W = 66, H = 99;
function sheet() {
  const px = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, r, g, b, a) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  const get = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  put(1, 1, 255, 255, 255, 255);      // brightest fur, cat row 0
  put(2, 1, 128, 128, 128, 255);      // shaded fur, cat row 0
  put(3, 1, 10, 10, 10, 255);         // outline, cat row 0
  put(4, 1, 200, 40, 40, 0);          // transparent, cat row 0
  put(1, 40, 255, 200, 0, 255);       // fur, cat row 1
  put(1, 70, 255, 0, 0, 255);         // effects row (row 2), must not be touched
  return { px, get };
}

describe("tintFor: distinguishes a real colour from an absent or broken one", () => {
  it("prefers a per-skin colour over the single tint", () => {
    const a = load({ tint: "#111111", tints: { greta: "#222222" } });
    expect(a.tintFor("greta")).toBe("#222222");
    expect(a.tintFor("nigel")).toBe("#111111");
  });

  it("treats an explicit per-skin entry as authoritative, even when empty", () => {
    const a = load({ tint: "#8b6bd6", tints: { greta: "" } });
    expect(a.tintFor("greta")).toBe("");          // explicitly no tint for greta
    expect(a.tintFor("nigel")).toBe("#8b6bd6");   // absent entry falls back to the global
  });

  it("degrades a per-skin typo to no tint for that skin only", () => {
    const a = load({ tint: "#8b6bd6", tints: { greta: "#zzz" } });
    expect(a.tintFor("greta")).toBe("");          // broken override, not a surprise global
    expect(a.tintFor("nigel")).toBe("#8b6bd6");
  });

  it("accepts both hex lengths, with or without the leading hash", () => {
    expect(load({ tint: "#8B6BD6" }).tintFor("x")).toBe("#8b6bd6");
    expect(load({ tint: "abc" }).tintFor("x")).toBe("#abc");
    expect(load({ tint: "abcdef" }).tintFor("x")).toBe("#abcdef");
  });

  it("degrades to no tint for a typo rather than breaking the sheet", () => {
    for (const bad of ["", "   ", "rebeccapurple", "#12345", "#gggggg", "#12", "javascript:alert(1)"]) {
      expect(load({ tint: bad }).tintFor("x")).toBe("");
    }
  });
});

describe("catRowsOf: derives the cat rows from the frame map", () => {
  it("collects only the rows the classic map actually draws from", () => {
    const rows = api.catRowsOf(CLASSIC);
    expect(rows.slice().sort()).toEqual([0, 1, 2, 3]);
    // The classic sheet's lower two rows are effects and text, and no frame
    // references them, so a tint must never reach them.
    expect(rows).not.toContain(4);
    expect(rows).not.toContain(5);
  });

  it("covers all four rows of the oneko layout", () => {
    const rows = api.catRowsOf(ONEKO);
    expect(rows.slice().sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("tintFrames: re-hues the cat without flattening it", () => {
  it("leaves the outline, transparency and non-cat rows exactly as they were", () => {
    const { px, get } = sheet();
    const before = [get(3, 1), get(4, 1), get(1, 70)];
    api.tintFrames(px, W, H, "#a06cd5", [0, 1], STRIDE);
    expect(get(3, 1)).toEqual(before[0]);   // outline
    expect(get(4, 1)).toEqual(before[1]);   // transparent
    expect(get(1, 70)).toEqual(before[2]);  // effects row
  });

  it("puts the requested hue on the fur and keeps the shading gradient", () => {
    const { px, get } = sheet();
    api.tintFrames(px, W, H, "#a06cd5", [0, 1], STRIDE);
    const bright = get(1, 1), shaded = get(2, 1), row1 = get(1, 40);
    const want = hexToHue("#a06cd5");
    for (const [r, g, b] of [bright, shaded, row1]) {
      expect(dHue(pxHue(r, g, b), want), `hue of ${r},${g},${b}`).toBeLessThan(2);
    }
    // Shading survives: the darker source pixel stays darker than the brighter one.
    expect(lum(...shaded.slice(0, 3))).toBeLessThan(lum(...bright.slice(0, 3)));
  });

  it("is faithful for a light colour, with no lifting applied", () => {
    const { px, get } = sheet();
    api.tintFrames(px, W, H, "#a06cd5", [0, 1], STRIDE);
    expect(get(1, 1).slice(0, 3)).toEqual([0xa0, 0x6c, 0xd5]);   // brightest fur is exactly the tint
  });

  it("keeps every fur pixel above the outline for a very dark colour", () => {
    // The whole fur band must clear the outline, not just the brightest pixel:
    // on a shaded sheet a dark tint must not let any fur sink into the outline.
    const { px, get } = sheet();
    api.tintFrames(px, W, H, "#1f2933", [0, 1], STRIDE);
    const floor = api.FLOOR_LUM;
    for (const [x, y] of [[1, 1], [2, 1], [1, 40]]) {
      const l = lum(...get(x, y).slice(0, 3));
      expect(l, `fur at ${x},${y}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("re-hues a stride-32 (oneko) sheet only within its cat rows", () => {
    const PW = 64, PH = 96;                       // three 32px rows
    const px = new Uint8ClampedArray(PW * PH * 4);
    const put = (x, y, r, g, b, a) => { const i = (y * PW + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
    const get = (x, y) => { const i = (y * PW + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
    put(1, 1, 255, 255, 255, 255);    // row 0 (cat)
    put(1, 33, 255, 255, 255, 255);   // row 1 (cat)
    put(1, 65, 255, 0, 0, 255);       // row 2 (not a cat row)
    api.tintFrames(px, PW, PH, "#a06cd5", [0, 1], 32);
    expect(get(1, 1)).toEqual([0xa0, 0x6c, 0xd5, 255]);
    expect(get(1, 33)).toEqual([0xa0, 0x6c, 0xd5, 255]);
    expect(get(1, 65)).toEqual([255, 0, 0, 255]);   // untouched
  });
});

describe("tint against the real bundled sheet", () => {
  const rows = api.catRowsOf(CLASSIC);
  const catRowLimit = (rows.reduce((m, r) => Math.max(m, r), 0) + 1) * CLASSIC.stride;

  function apply(hex) {
    const png = PNG.sync.read(readFileSync(join(pkg, "assets", "neko.png")));
    const original = Buffer.from(png.data);
    api.tintFrames(png.data, png.width, png.height, hex, rows, CLASSIC.stride);
    return { png, original };
  }

  it("preserves every outline pixel, re-hues the fur on-hue, and leaves effects rows alone", () => {
    const { png, original } = apply("#2f9e6e");
    const want = hexToHue("#2f9e6e");
    let outlineKept = 0, fur = 0, furMatched = 0, effectsKept = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        const same = png.data[i] === original[i] && png.data[i + 1] === original[i + 1] &&
                     png.data[i + 2] === original[i + 2] && png.data[i + 3] === original[i + 3];
        if (y >= catRowLimit) { if (same) effectsKept++; continue; }
        if (original[i + 3] === 0) continue;
        if (lum(original[i], original[i + 1], original[i + 2]) <= api.OUTLINE_LUM) { if (same) outlineKept++; continue; }
        if (same) continue;
        fur++;
        if (dHue(pxHue(png.data[i], png.data[i + 1], png.data[i + 2]), want) < 2) furMatched++;
      }
    }
    expect(outlineKept).toBeGreaterThan(1000);
    expect(fur).toBeGreaterThan(1000);
    expect(furMatched).toBe(fur);
    expect(effectsKept).toBe(png.width * (png.height - catRowLimit));
  });

  it("keeps every fur pixel readable against the outline for a dark tint", () => {
    const { png, original } = apply("#1f2933");
    const floor = api.FLOOR_LUM;
    let minFur = 1e9, fur = 0;
    for (let y = 0; y < catRowLimit; y++) {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (original[i + 3] === 0) continue;
        if (lum(original[i], original[i + 1], original[i + 2]) <= api.OUTLINE_LUM) continue;
        const l = lum(png.data[i], png.data[i + 1], png.data[i + 2]);
        fur++; if (l < minFur) minFur = l;
        expect(l).toBeGreaterThanOrEqual(floor);
      }
    }
    expect(fur).toBeGreaterThan(1000);
  });
});
