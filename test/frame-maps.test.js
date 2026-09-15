import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const clientSrc = readFileSync(join(pkg, "add-cats.js"), "utf8");

// The client is a browser IIFE. To test its frame maps we evaluate the two map
// literals directly from source rather than importing the module (which would
// touch `document`). This keeps the map data under test as the shipped bytes.
function extractMap(name) {
  const start = clientSrc.indexOf(`var ${name} = {`);
  expect(start).toBeGreaterThan(-1);
  const end = clientSrc.indexOf("\n  };", start);
  expect(end).toBeGreaterThan(start);
  const objSrc = clientSrc.slice(start + `var ${name} = `.length, end + 4);
  // eslint-disable-next-line no-new-func
  return new Function("return " + objSrc)();
}

const CLASSIC = extractMap("CLASSIC_MAP");
const ONEKO = extractMap("ONEKO_MAP");

describe("frame maps", () => {
  it("classic map is the 263x197 8x6 sheet with 1px separators", () => {
    expect(CLASSIC.width).toBe(263);
    expect(CLASSIC.height).toBe(197);
    expect(CLASSIC.cell).toBe(32);
    expect(CLASSIC.stride).toBe(33);
  });

  it("oneko map is the 256x128 8x4 sheet with no separator", () => {
    expect(ONEKO.width).toBe(256);
    expect(ONEKO.height).toBe(128);
    expect(ONEKO.cell).toBe(32);
    expect(ONEKO.stride).toBe(32);
  });

  const REQUIRED = [
    "idle", "alert", "tired", "sleeping", "scratchSelf",
    "scratchWallN", "scratchWallS", "scratchWallE", "scratchWallW",
    "N", "NE", "E", "SE", "S", "SW", "W", "NW",
  ];

  it.each([["classic", () => CLASSIC], ["oneko", () => ONEKO]])(
    "%s map defines every animation",
    (_label, get) => {
      const map = get();
      for (const name of REQUIRED) {
        expect(map.frames[name], name).toBeDefined();
        expect(map.frames[name].length).toBeGreaterThan(0);
      }
    }
  );

  // All cells must land inside the sheet, and must avoid the 1px separator
  // columns/rows in the classic sheet. A frame that lands on a separator or
  // past the edge means the map is wrong.
  it.each([["classic", () => CLASSIC], ["oneko", () => ONEKO]])(
    "%s map cells stay inside the sheet",
    (_label, get) => {
      const map = get();
      // Sheet geometry: width = cols * cell + (cols - 1) * (stride - cell).
      // For the classic sheet: 8*32 + 7*1 = 263. For oneko: 8*32 + 0 = 256.
      const cols = Math.round((map.width + (map.stride - map.cell)) / map.stride);
      const rows = Math.round((map.height + (map.stride - map.cell)) / map.stride);
      for (const [anim, frames] of Object.entries(map.frames)) {
        for (const [c, r] of frames) {
          expect(c, `${anim} col`).toBeGreaterThanOrEqual(0);
          expect(r, `${anim} row`).toBeGreaterThanOrEqual(0);
          expect(c, `${anim} col in range`).toBeLessThan(cols);
          expect(r, `${anim} row in range`).toBeLessThan(rows);
        }
      }
    }
  );

  // The classic sheet's cat frames occupy the top four rows only; rows 4-5 are
  // effects and credit text. No cat animation may reference those rows.
  it("classic map never references the effects/text rows", () => {
    for (const [anim, frames] of Object.entries(CLASSIC.frames)) {
      for (const [, r] of frames) {
        expect(r, anim).toBeLessThan(4);
      }
    }
  });

  // Directional walks are 2-frame cycles with distinct cells.
  it("directional walks are 2 distinct frames", () => {
    for (const dir of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]) {
      expect(CLASSIC.frames[dir].length, dir).toBe(2);
      expect(CLASSIC.frames[dir][0]).not.toEqual(CLASSIC.frames[dir][1]);
    }
  });
});
