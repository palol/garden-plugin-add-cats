import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");

function decode(skin) {
  return PNG.sync.read(readFileSync(join(pkg, "assets", skin + ".png")));
}

// Pull the classic map out of the shipped client source, same as frame-maps.test.js.
const clientSrc = readFileSync(join(pkg, "add-cats.js"), "utf8");
function extractMap(name) {
  const start = clientSrc.indexOf(`var ${name} = {`);
  const end = clientSrc.indexOf("\n  };", start);
  return new Function("return " + clientSrc.slice(start + `var ${name} = `.length, end + 4))();
}
const CLASSIC = extractMap("CLASSIC_MAP");

// Count non-transparent pixels in one 32px cell of a decoded sheet.
// Classic sheets use a 1px separator, so the cell origin is c*33, r*33.
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

// Count transparent (keyed-out) pixels in a separator column between cells.
function separatorInk(png, col) {
  let count = 0;
  for (let y = 0; y < png.height; y++) {
    const px = (y * png.width + col) << 2;
    if (png.data[px + 3] > 0) count++;
  }
  return count;
}

describe("bundled sprite sheets decode and match the map", () => {
  // Every bundled skin is the public-domain classic sheet or a recolour of it,
  // so all are the 6-row (197) variant.
  const BUNDLED = { neko: { h: 197 }, ginger: { h: 197 }, smokey: { h: 197 }, midnight: { h: 197 }, biscuit: { h: 197 } };
  for (const [skin, dim] of Object.entries(BUNDLED)) {
    it(`${skin}: every mapped cat cell contains a drawn sprite`, () => {
      const png = decode(skin);
      expect(png.width).toBe(263);
      expect(png.height).toBe(dim.h);
      for (const [anim, frames] of Object.entries(CLASSIC.frames)) {
        for (const [c, r] of frames) {
          const ink = inkAt(png, c, r);
          expect(ink, `${skin} ${anim} r${r}c${c} ink`).toBeGreaterThan(20);
        }
      }
    });
  }

  it("bundled skins are visually distinct from one another", () => {
    // Regression guard: the two original bundled sheets were the same white cat
    // (~97% identical), so a random pick always looked like two white cats.
    const skins = Object.keys(BUNDLED);
    const pix = Object.fromEntries(skins.map((s) => [s, decode(s)]));
    for (let i = 0; i < skins.length; i++) {
      for (let j = i + 1; j < skins.length; j++) {
        const a = pix[skins[i]];
        const b = pix[skins[j]];
        let diff = 0;
        for (let p = 0; p < a.data.length; p += 4) {
          if (
            Math.abs(a.data[p] - b.data[p]) +
              Math.abs(a.data[p + 1] - b.data[p + 1]) +
              Math.abs(a.data[p + 2] - b.data[p + 2]) +
              Math.abs(a.data[p + 3] - b.data[p + 3]) >
            24
          ) {
            diff++;
          }
        }
        const frac = diff / (a.width * a.height);
        expect(frac, `${skins[i]} vs ${skins[j]} differ`).toBeGreaterThan(0.1);
      }
    }
  });

  it("classic cells are separated by keyed-out 1px columns", () => {
    const png = decode("neko");
    // Separator between column 0 and 1 sits at x = 32.
    expect(separatorInk(png, 32)).toBeLessThan(10);
    expect(separatorInk(png, 65)).toBeLessThan(10);
  });
});
