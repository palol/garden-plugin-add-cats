/* Add Cats — resident pixel cats for Digital Garden.
 *
 * Cats appear on pages tagged with the note flag, settle and stay, run to
 * wherever a visitor clicks, and leave a fading paw-print trail while they run.
 * Zero dependencies, no tracking, no network beyond the sprite sheets the site
 * owner configures.
 *
 * Sprite layouts (auto-detected from the loaded sheet's size):
 *   classic  — 263x197, 8x6, 32px cells, 1px separators (classic Neko sheets).
 *              The cat frames occupy the top 4 rows; row 4 holds the paw-print
 *              trail marks and row 5 is text, neither drawn as a cat pose.
 *   oneko    — 256x128, 8x4, 32px cells (oneko.gif style sheets).
 * Each frame map lists [column, row] cell coordinates per animation.
 */
(function () {
  "use strict";

  var script = document.querySelector("script[data-add-cats]");
  if (!script) return;

  var reducedMotion = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ---- settings ------------------------------------------------------ */

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || isNaN(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  // Settings that arrive as dataset strings. A boolean setting renders as
  // "true"/"false"; a site that sets the env var instead may produce "1"/"0".
  // Both spellings are accepted, and an absent attribute means the default.
  function boolSetting(raw, dflt) {
    if (raw === undefined || raw === null || raw === "") return dflt;
    var v = String(raw).trim().toLowerCase();
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    return dflt;
  }

  var cfg = {
    count: clampInt(script.dataset.count, 1, 5, 3),
    scale: clampInt(script.dataset.scale, 16, 64, 32),
    mode: script.dataset.mode === "stampede" ? "stampede" : "clicked",
    skin: resolveSkin(script.dataset.skin),
    assets: script.dataset.assets || "/plugins/add-cats/assets/",
    chromaKey: script.dataset.chromaKey || "",
    tint: script.dataset.tint || "",
    trail: boolSetting(script.dataset.trail, true),
    trailFade: clampInt(script.dataset.trailFade, 1, 30, 4),
    skins: {},
    speeds: {},
    tints: {}
  };
  try {
    var parsed = JSON.parse(script.dataset.skins || "{}");
    if (parsed && typeof parsed === "object") cfg.skins = parsed;
  } catch (e) { cfg.skins = {}; }
  try {
    var speedMap = JSON.parse(script.dataset.speeds || "{}");
    if (speedMap && typeof speedMap === "object") cfg.speeds = speedMap;
  } catch (e) { cfg.speeds = {}; }
  try {
    var tintMap = JSON.parse(script.dataset.tints || "{}");
    if (tintMap && typeof tintMap === "object") cfg.tints = tintMap;
  } catch (e) { cfg.tints = {}; }

  // A skin value is either a single id, the word "random" (any bundled or
  // configured skin), or a JSON array of ids — used to pin distinct named
  // cats (e.g. '["greta","nigel"]', one per resident cat, cycling if there
  // are more cats than ids).
  function resolveSkin(raw) {
    var value = (raw || "random").trim().toLowerCase();
    if (value.charAt(0) === "[") {
      try {
        var list = JSON.parse(value);
        if (Array.isArray(list) && list.length > 0) {
          return list.map(function (id) { return String(id).toLowerCase(); });
        }
      } catch (e) { /* fall through to a single skin id */ }
      value = "random";
    } else if (value.charAt(0) === '"') {
      // The template serializes the value with | dump, so a plain id arrives
      // JSON-quoted; unwrap it.
      try {
        var single = JSON.parse(value);
        if (typeof single === "string") value = single.toLowerCase();
      } catch (e) { /* keep the raw value */ }
    }
    return value;
  }

  /* ---- frame maps ---------------------------------------------------- */
  /* Coordinates are [column, row] cells. Verified against the canonical
   * classic Neko frame order (see test/frame-maps.test.js). */

  var CLASSIC_MAP = {
    cell: 32, stride: 33, width: 263, height: 197,
    frames: {
      idle: [[0, 0]],
      alert: [[7, 0]],
      tired: [[4, 0]],
      sleeping: [[6, 0], [5, 0]],
      scratchSelf: [[3, 0], [2, 0], [1, 0]],
      scratchWallN: [[5, 3], [4, 3]],
      scratchWallS: [[1, 3], [0, 3]],
      scratchWallE: [[3, 3], [2, 3]],
      scratchWallW: [[7, 3], [6, 3]],
      N: [[1, 2], [0, 2]],
      NE: [[7, 1], [6, 1]],
      E: [[5, 1], [4, 1]],
      SE: [[3, 1], [2, 1]],
      S: [[1, 1], [0, 1]],
      SW: [[7, 2], [6, 2]],
      W: [[5, 2], [4, 2]],
      NW: [[3, 2], [2, 2]]
    },
    // Trail marks. Row 4 of a classic sheet holds eight paw-print cells: four
    // variants ([0..3] — pad first, then the toe beans) and the same four drawn
    // 180deg round ([4..7]). Two things about those four cells are measured off
    // the shipped art and declared here, because assuming either one is what
    // makes a trail look random:
    //
    //   faces   the screen angle the art's toes already point at, so a stamp is
    //           turned by the difference between that and the cat's heading
    //           (see printRotation). The cells are NOT all drawn the same way
    //           round: cell 0 south, cell 1 south-east, cell 2 east, cell 3
    //           north-east. The flipped half of the row is not needed — the
    //           rotation covers it.
    //   dx/dy   where the art sits inside its cell, as an offset from the cell
    //           centre. Every cell draws its print in a corner, so a stamp is
    //           nudged back over the cat before it is turned; without this the
    //           art swings a dozen pixels off the paw as the mark rotates, and
    //           turns can push it off the edge of its own box.
    //
    // Row 5 is text, never drawn.
    prints: [
      { cell: [0, 4], faces: 90,  dx: 0,   dy: -12 },
      { cell: [1, 4], faces: 45,  dx: -12, dy: -12 },
      { cell: [2, 4], faces: 0,   dx: -12, dy: -1 },
      { cell: [3, 4], faces: -45, dx: -12, dy: 11 }
    ]
  };

  var ONEKO_MAP = {
    cell: 32, stride: 32, width: 256, height: 128,
    frames: {
      idle: [[3, 3]],
      alert: [[7, 3]],
      tired: [[3, 2]],
      sleeping: [[2, 0], [2, 1]],
      scratchSelf: [[5, 0], [6, 0], [7, 0]],
      scratchWallN: [[0, 0], [0, 1]],
      scratchWallS: [[7, 1], [6, 2]],
      scratchWallE: [[2, 2], [2, 3]],
      scratchWallW: [[4, 0], [4, 1]],
      N: [[1, 2], [1, 3]],
      NE: [[0, 2], [0, 3]],
      E: [[3, 0], [3, 1]],
      SE: [[5, 1], [5, 2]],
      S: [[6, 3], [7, 2]],
      SW: [[5, 3], [6, 1]],
      W: [[4, 2], [4, 3]],
      NW: [[1, 0], [1, 1]]
    },
    // A 4-row oneko sheet maps all 32 cells to cat poses and has no effects
    // row, so it carries no trail marks: prints behind such a cat come from the
    // bundled classic sheet instead (see loadPrintFallback).
    prints: null
  };

  // Built-in skins: the public-domain classic sheet plus recoloured
  // derivatives of it (identical frames, different fur), so a random pick
  // reads as a mix of visibly different cats. Other archive skins are
  // author-owned and are deliberately not bundled.
  var BUILTIN = ["neko", "ginger", "smokey", "midnight", "biscuit"];

  // Rows a sheet actually has, from its pixel height: classic sheets carry a 1px
  // separator, so a row is 33px in a 263x197 sheet and 32px in a oneko sheet.
  function rowCount(height, stride, cell) {
    return Math.round((height + (stride - cell)) / stride);
  }

  // How far to turn a mark so its toes follow the path, as a CSS rotation in
  // degrees. `base` is the screen angle that cell's art already points at (0 =
  // east, 90 = south, since screen y runs down), so the turn is simply the
  // difference between the cat's heading and the art's own facing. Headings are
  // rounded to 45deg steps — the eight directions a cat walks — which keeps
  // quarter turns exactly on the pixel grid and gives a diagonal the same
  // nearest-neighbour turn the rest of the pixel art gets.
  function printRotation(travelX, travelY, base) {
    if (!travelX && !travelY) return 0;   // nothing to follow: leave the art as drawn
    var ang = Math.atan2(travelY, travelX) * 180 / Math.PI;  // 0 = east, 90 = south
    var rot = Math.round(ang / 45) * 45 - base;
    return ((rot % 360) + 360) % 360;
  }

  // Classic sheets are 263px wide (8 columns of 32px plus a 1px separator),
  // so their width is not a multiple of the 32px cell. oneko sheets are a
  // clean 256px. Height varies across classic skins, so width is the signal.
  function mapFor(width, height) {
    if (width > 0 && width % 32 !== 0) return CLASSIC_MAP;
    return ONEKO_MAP;
  }

  /* ---- sheet loading ------------------------------------------------- */

  function sheetUrl(id) {
    if (cfg.skins[id]) return cfg.skins[id];           // site-configured (BYO)
    if (BUILTIN.indexOf(id) !== -1) return cfg.assets + id + ".png";
    return cfg.assets + BUILTIN[0] + ".png";           // safe fallback
  }

  function availableSkins() {
    var list = BUILTIN.slice();
    Object.keys(cfg.skins).forEach(function (id) {
      if (list.indexOf(id) === -1) list.push(id);
    });
    return list;
  }

  // Load a sheet, resolve its layout, then key out its background and/or re-hue
  // its cat frames. Both edits need pixel access, so they share one canvas pass.
  // `id` selects the skin's tint. `skipKeys` leaves the pixels untouched, for the
  // bundled sheet a trail borrows prints from: those frames are already keyed, and
  // a site's own chromaKey or tint could eat print pixels.
  function loadSheet(url, id, cb, skipKeys) {
    var img = new Image();
    if (/^https?:/i.test(url) && url.indexOf(location.origin) !== 0) {
      img.crossOrigin = "anonymous";
    }
    img.onload = function () {
      // Layout is chosen by width, but the sheet's own pixel size drives the
      // background scaling: classic heights vary (6-row and 5-row sheets both
      // ship), so a map constant would stretch the shorter sheets.
      var base = mapFor(img.naturalWidth, img.naturalHeight);
      // Trail marks belong to the canonical 6-row classic sheet. A shorter
      // classic sheet declares none (its row 4 is effects or text, not prints),
      // so its cat takes prints from the bundled sheet instead of stamping
      // whatever happens to sit at those coordinates.
      var rows = rowCount(img.naturalHeight, base.stride, base.cell);
      var map = {
        cell: base.cell, stride: base.stride,
        width: img.naturalWidth, height: img.naturalHeight,
        frames: base.frames,
        prints: base.prints && rows >= 6 ? base.prints : null
      };
      var tint = skipKeys ? "" : tintFor(id);
      if (!skipKeys && (cfg.chromaKey || tint)) {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var px = data.data;
          if (cfg.chromaKey) {
            var key = hexToRgb(cfg.chromaKey);
            for (var i = 0; i < px.length; i += 4) {
              if (px[i + 3] > 0 && near(px[i], px[i + 1], px[i + 2], key)) {
                px[i + 3] = 0;
              }
            }
          }
          if (tint) {
            tintFrames(px, canvas.width, canvas.height, tint, catRowsOf(map), map.stride);
          }
          ctx.putImageData(data, 0, 0);
          return cb(canvas.toDataURL("image/png"), map);
        } catch (e) { /* tainted canvas or no canvas: use the sheet as-is */ }
      }
      cb(url, map);
    };
    img.onerror = function () { cb(null, null); };   // missing sheet: no cats, page unaffected
    img.src = url;
  }

  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function near(r, g, b, key) {
    return Math.abs(r - key[0]) < 60 && Math.abs(g - key[1]) < 60 && Math.abs(b - key[2]) < 60;
  }

  // A skin's tint: the per-skin map wins, then the single tint setting. Values
  // are validated, so a typo in settings degrades to "no tint" rather than to a
  // broken sheet.
  function tintFor(id) {
    var map = cfg.tints || {};
    // A per-skin entry that is present is authoritative: an empty or invalid
    // value means "no tint for this skin", never "fall back to the global
    // colour". Only an absent entry uses the global tint. Skin ids are resolved
    // to lower case, so a key is matched case-insensitively too: {"Greta": ...}
    // must reach skin "greta".
    var key = String(id).toLowerCase();
    var val;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      val = map[key];
    } else {
      for (var tintKey in map) {
        if (Object.prototype.hasOwnProperty.call(map, tintKey) &&
            String(tintKey).toLowerCase() === key) {
          val = map[tintKey]; break;
        }
      }
    }
    var hex = String(val === undefined ? cfg.tint || "" : val).trim().toLowerCase();
    if (!hex) return "";
    if (hex.charAt(0) !== "#") hex = "#" + hex;
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(hex) ? hex : "";
  }

  // The rows a layout actually draws cats from. Every mapped cell in both
  // layouts sits in the top four rows; the lower rows of a classic sheet hold
  // effects and text frames, which must keep their own colours.
  function catRowsOf(map) {
    var rows = [];
    for (var name in map.frames) {
      if (map.frames[name]) {
        for (var f = 0; f < map.frames[name].length; f++) {
          var r = map.frames[name][f][1];
          if (rows.indexOf(r) === -1) rows.push(r);
        }
      }
    }
    return rows;
  }

  // Pixels at or below this luminance are the outline and the dark details.
  var OUTLINE_LUM = 60;
  // Every fur pixel is kept at or above this floor, so a tinted cat always reads
  // against its outline. For a tint lighter than the floor the brightest fur
  // lands on the tint's own colour and shading is preserved; for a tint darker
  // than the floor there is not enough range to keep both, so the fur is
  // compressed up to the floor and the cat renders as a flat body with its
  // outline intact rather than as a silhouette.
  var FLOOR_LUM = 84;

  // Re-hue the cat frames to `hex`: each pixel keeps its own luminance and only
  // its colour changes, so shading and anti-aliasing survive, and outline pixels
  // are left exactly as they were. The fur band (OUTLINE_LUM, 255] is mapped
  // onto [FLOOR_LUM, hi], where hi is the tint's own luminance when that is
  // above the floor, so no fur pixel can sink into the outline band even on a
  // shaded sheet. A pixel that is darker than the tint is darkened by SCALING
  // the tint (hue-exact, so a fully-saturated or near-white tint keeps its
  // shading instead of flattening or blowing out); a pixel that must be lighter
  // than the tint is mixed toward white, which only happens for tints darker
  // than the floor and compresses them to a flat, readable body rather than a
  // silhouette.
  function tintFrames(px, width, height, hex, rows, stride) {
    var rgb = hexToRgb(hex);
    var tintLum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    var hi = tintLum > FLOOR_LUM ? tintLum : FLOOR_LUM;
    for (var y = 0; y < height; y++) {
      if (rows.indexOf(Math.floor(y / stride)) === -1) continue;
      for (var x = 0; x < width; x++) {
        var i = (y * width + x) * 4;
        if (px[i + 3] === 0) continue;
        var p = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        if (p <= OUTLINE_LUM) continue;
        var t = (p - OUTLINE_LUM) / (255 - OUTLINE_LUM);
        var target = FLOOR_LUM + t * (hi - FLOOR_LUM);
        if (target <= tintLum) {
          // darken by scaling the tint: hue is exact, every channel scales, so a
          // channel pinned at 255 in the tint can still darken (target <= tintLum
          // implies tintLum >= FLOOR_LUM > 0, so this cannot divide by zero)
          var k = target / tintLum;
          px[i]     = Math.ceil(rgb[0] * k);
          px[i + 1] = Math.ceil(rgb[1] * k);
          px[i + 2] = Math.ceil(rgb[2] * k);
        } else {
          // lighten toward white: only reachable for tints darker than the
          // floor, where w is small and non-negative and cannot blow out
          var w = (target - tintLum) / (255 - tintLum);
          px[i]     = Math.ceil(rgb[0] + (255 - rgb[0]) * w);
          px[i + 1] = Math.ceil(rgb[1] + (255 - rgb[1]) * w);
          px[i + 2] = Math.ceil(rgb[2] + (255 - rgb[2]) * w);
        }
      }
    }
    return px;
  }

  /* ---- cats ---------------------------------------------------------- */

  var cats = [];
  var lastTs = null;

  function frameStyle(el, map, cell, scale) {
    var k = scale / 32;
    el.style.width = scale + "px";
    el.style.height = scale + "px";
    el.style.backgroundSize = (map.width * k) + "px " + (map.height * k) + "px";
  }

  function setSprite(cat, name, f) {
    var set = cat.map.frames[name];
    if (!set) return;
    var cell = set[f % set.length];
    var k = cat.scale / 32;
    cat.el.style.backgroundPosition =
      (-cell[0] * cat.map.stride * k) + "px " + (-cell[1] * cat.map.stride * k) + "px";
  }

  function randomSkin() {
    var list = availableSkins();
    return list[Math.floor(Math.random() * list.length)];
  }

  function makeCat(sheetUrl, map, skin) {
    var el = document.createElement("div");
    el.className = "add-cats-cat";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    frameStyle(el, map, map.cell, cfg.scale);
    el.style.backgroundImage = "url(" + sheetUrl + ")";

    var cat = {
      el: el, map: map, scale: cfg.scale, skin: skin, sheetUrl: sheetUrl,
      x: 16 + Math.random() * Math.max(1, window.innerWidth - 64),
      y: 40 + Math.random() * Math.max(1, window.innerHeight - 120),
      speed: speedFor(skin),       // per-skin override or 5..14 px per step
      frame: 0, idle: 0, idleAnim: null, idleAnimFrame: 0,
      trailAcc: 0, trailDx: 0, trailDy: 0
    };
    cat.tx = cat.x; cat.ty = cat.y;
    position(cat);
    setSprite(cat, "idle", 0);
    cats.push(cat);
    return cat;
  }

  function speedFor(skin) {
    var pinned = cfg.speeds && typeof cfg.speeds[skin] === "number"
      ? cfg.speeds[skin] : NaN;
    // A pinned speed below 1px per step never accumulates enough distance to
    // stamp a print, so the trail would stall silently: floor it.
    return isFinite(pinned) ? Math.max(1, pinned) : 5 + Math.random() * 9;
  }

  function position(cat) {
    cat.el.style.left = (cat.x - cfg.scale / 2) + "px";
    cat.el.style.top = (cat.y - cfg.scale / 2) + "px";
  }

  function nearest(x, y) {
    var best = null, bd = Infinity;
    for (var i = 0; i < cats.length; i++) {
      var dx = cats[i].x - x, dy = cats[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = cats[i]; }
    }
    return best;
  }

  /* ---- paw prints ---------------------------------------------------- */

  // A print is stamped every TRAIL_SPACING pixels of travel, so a fast cat
  // leaves the same rhythm of prints as a slow one, and TRAIL_MAX caps the live
  // prints so a long run cannot grow the DOM without bound (the oldest print
  // retires when the cap is hit). Prints are skipped under
  // prefers-reduced-motion, which also stops the cats from walking.
  var TRAIL_SPACING = 26;
  var TRAIL_MAX = 24;
  var prints = [];              // live print elements, oldest first
  var printSheet = null;        // { url, map } fallback for sheets with no marks
  var printSheetTried = false;

  // A sheet with no mark row (every 4-row oneko sheet, i.e. most brought-your-own
  // sheets) borrows its prints from the bundled classic sheet; those mark cells
  // are plain paw prints, so they read correctly behind any cat. Loaded once, on
  // the first stamp, through the same keying path a sheet takes.
  function loadPrintFallback(cb) {
    if (printSheet) { cb(printSheet); return; }
    if (printSheetTried) { cb(null); return; }
    printSheetTried = true;
    // Untouched pixels: the bundled sheets are already keyed, and a site's own
    // chromaKey or tint has no business editing another skin's print art.
    loadSheet(cfg.assets + "neko.png", "neko", function (url, map) {
      if (url && map && map.prints) printSheet = { url: url, map: map };
      cb(printSheet);
    }, true);
  }

  // Where a print comes from: the cat's own sheet when it has a mark row,
  // otherwise the bundled sheet. The cell carries its own facing and its own
  // offset inside the cell; stampPrint applies both.
  function markFor(cat, cb) {
    if (cat.map.prints) {
      var set = cat.map.prints;
      cb({ url: cat.sheetUrl, map: cat.map, mark: set[Math.floor(Math.random() * set.length)] });
      return;
    }
    loadPrintFallback(function (fallback) {
      if (!fallback) { cb(null); return; }
      var fset = fallback.map.prints;
      cb({
        url: fallback.url, map: fallback.map,
        mark: fset[Math.floor(Math.random() * fset.length)]
      });
    });
  }

  function removePrint(el) {
    var i = prints.indexOf(el);
    if (i !== -1) prints.splice(i, 1);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  // Where a print lands, given the cat's centre and the heading it is travelling
  // on: centred on the cat and pulled back along that heading, so the mark sits
  // where the cat's paws have just been. A fixed downward offset cannot do this —
  // it trails correctly for a cat running north and lands the print beside or
  // ahead of the cat in every other direction.
  function stampPoint(cx, cy, headingX, headingY, back, size) {
    var len = Math.sqrt(headingX * headingX + headingY * headingY);
    var hx = len > 0 ? headingX / len : 0;
    var hy = len > 0 ? headingY / len : 1;   // no heading: trail south, as before
    return { x: cx - hx * back - size / 2, y: cy - hy * back - size / 2 };
  }

  // `headingX`/`headingY` are the cat's travel vector over the stretch since the
  // last stamp; each mark's own facing is read from its cell, so one stamp per
  // cell variant still lands pointing the same way as the others.
  function stampPrint(cat, headingX, headingY) {
    if (!cfg.trail || reducedMotion) return;
    var size = Math.max(12, Math.round(cfg.scale * 0.75));
    // Capture the stamp point at the triggering step. A fallback sheet load is
    // asynchronous, and reading cat.x/cat.y in the callback would drop the print
    // a few frames behind where the cat actually was. Prints landing while that
    // first load is in flight are skipped, so a trail never doubles up.
    var at = stampPoint(cat.x, cat.y, headingX, headingY, cfg.scale * 0.35, size);
    var x = at.x, y = at.y;
    markFor(cat, function (mark) {
      if (!mark) return;
      var k = size / 32;
      var el = document.createElement("div");
      el.className = "add-cats-print";
      el.setAttribute("aria-hidden", "true");
      el.style.width = size + "px";
      el.style.height = size + "px";
      el.style.backgroundImage = "url(" + mark.url + ")";
      el.style.backgroundSize = (mark.map.width * k) + "px " + (mark.map.height * k) + "px";
      var cell = mark.mark.cell;
      el.style.backgroundPosition =
        (-cell[0] * mark.map.stride * k) + "px " +
        (-cell[1] * mark.map.stride * k) + "px";
      // Turn the mark so its toes point along the way the cat is travelling,
      // measured against the direction that cell's own art already faces, and
      // pull the art back over the stamp point first: the sheet draws each print
      // in a corner of its cell, so without the shift a turn would swing the
      // mark off the cat (and off the edge of its own box).
      var rotation = printRotation(headingX, headingY, mark.mark.faces || 0);
      el.style.transform =
        "rotate(" + rotation + "deg) translate(" +
        (-mark.mark.dx * k) + "px," + (-mark.mark.dy * k) + "px)";
      // Stamp behind the cat rather than under it, with a few pixels of scatter
      // so a straight run does not read as a ruled line.
      var jx = (Math.random() - 0.5) * 6, jy = (Math.random() - 0.5) * 6;
      el.style.left = (x + jx) + "px";
      el.style.top = (y + jy) + "px";
      el.style.transition = "opacity " + cfg.trailFade + "s linear";
      document.body.appendChild(el);
      prints.push(el);
      // Fade on the next frame, so the transition has a start value to leave
      // from, then retire the element once it has faded out.
      setTimeout(function () { el.style.opacity = "0"; }, 16);
      setTimeout(function () { removePrint(el); }, cfg.trailFade * 1000 + 80);
      while (prints.length > TRAIL_MAX) removePrint(prints[0]);
    });
  }

  function resetIdle(cat) { cat.idleAnim = null; cat.idleAnimFrame = 0; }

  function idleStep(cat) {
    cat.idle++;
    if (reducedMotion) { setSprite(cat, "idle", 0); return; }
    if (!cat.idleAnim && cat.idle > 10 && Math.floor(Math.random() * 200) === 0) {
      var opts = ["sleeping", "scratchSelf"];
      if (cat.x < 40) opts.push("scratchWallW");
      if (cat.y < 40) opts.push("scratchWallN");
      if (cat.x > window.innerWidth - 40) opts.push("scratchWallE");
      if (cat.y > window.innerHeight - 40) opts.push("scratchWallS");
      cat.idleAnim = opts[Math.floor(Math.random() * opts.length)];
    }
    switch (cat.idleAnim) {
      case "sleeping":
        if (cat.idleAnimFrame < 8) { setSprite(cat, "tired", 0); break; }
        setSprite(cat, "sleeping", Math.floor(cat.idleAnimFrame / 4));
        if (cat.idleAnimFrame > 192) resetIdle(cat);
        break;
      case "scratchSelf":
      case "scratchWallN": case "scratchWallS":
      case "scratchWallE": case "scratchWallW":
        setSprite(cat, cat.idleAnim, cat.idleAnimFrame);
        if (cat.idleAnimFrame > 9) resetIdle(cat);
        break;
      default:
        setSprite(cat, "idle", 0);
        return;
    }
    cat.idleAnimFrame++;
  }

  function step(cat) {
    cat.frame++;
    var dx = cat.x - cat.tx, dy = cat.y - cat.ty;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < cat.speed || dist < 40) { idleStep(cat); return; }
    resetIdle(cat); cat.idle = 0;
    if (!reducedMotion) {
      var dir = "";
      if (dy / dist > 0.5) dir += "N";
      if (dy / dist < -0.5) dir += "S";
      if (dx / dist > 0.5) dir += "W";
      if (dx / dist < -0.5) dir += "E";
      setSprite(cat, dir, cat.frame);
    }
    var wasX = cat.x, wasY = cat.y;
    cat.x -= (dx / dist) * cat.speed;
    cat.y -= (dy / dist) * cat.speed;
    cat.x = Math.max(cfg.scale / 2, Math.min(window.innerWidth - cfg.scale / 2, cat.x));
    cat.y = Math.max(cfg.scale / 2, Math.min(window.innerHeight - cfg.scale / 2, cat.y));
    // Trail: accumulate how far the cat actually moved and stamp a print each
    // time that crosses the spacing, carrying the remainder so the marks keep an
    // even 26px rhythm instead of rounding up to the step size. Measuring the
    // real displacement (rather than the step size) keeps a cat pinned against a
    // screen edge — its target still off-screen, so it never idles — from
    // dribbling prints in one spot.
    var movedX = cat.x - wasX, movedY = cat.y - wasY;
    var moved = Math.sqrt(movedX * movedX + movedY * movedY);
    cat.trailAcc += moved;
    // Direction comes from the whole stretch since the last print rather than the
    // last step, so a cat weaving slightly along its path still leaves prints
    // pointing the way it is actually going. dx/dy point from the cat to its
    // target, so travel is their negation.
    cat.trailDx += movedX;
    cat.trailDy += movedY;
    if (moved > 0.5 && cat.trailAcc >= TRAIL_SPACING) {
      cat.trailAcc -= TRAIL_SPACING;
      var tx = cat.trailDx, ty = cat.trailDy;
      if (Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5) { tx = -dx; ty = -dy; }
      cat.trailDx = 0; cat.trailDy = 0;
      stampPrint(cat, tx, ty);
    }
    position(cat);
  }

  function tick(ts) {
    if (lastTs === null) lastTs = ts;
    if (ts - lastTs > 100) {
      lastTs = ts;
      for (var i = 0; i < cats.length; i++) step(cats[i]);
    }
    requestAnimationFrame(tick);
  }

  function onPointer(e) {
    var x, y;
    if (e.clientX !== undefined) { x = e.clientX; y = e.clientY; }
    else if (e.changedTouches && e.changedTouches[0]) {
      x = e.changedTouches[0].clientX; y = e.changedTouches[0].clientY;
    } else return;
    if (cfg.mode === "stampede") {
      for (var i = 0; i < cats.length; i++) {
        cats[i].tx = x + (i - (cats.length - 1) / 2) * 24;
        cats[i].ty = y;
        resetIdle(cats[i]);
      }
    } else {
      var cat = nearest(x, y);
      if (cat) { cat.tx = x; cat.ty = y; resetIdle(cat); }
    }
  }

  /* ---- boot ---------------------------------------------------------- */

  function spawn(skinsToSpawn, index, map, sheet) {
    // Stagger asynchronous sheet loads so each cat can carry its own skin.
    if (index >= skinsToSpawn.length) {
      if (cats.length) {
        // A cat whose sheet carries no mark row borrows prints from the bundled
        // sheet; fetching it now means the first run of such a cat stamps from
        // its first stride instead of waiting on a load mid-run. Pages whose cats
        // all have their own marks make no extra request.
        if (cfg.trail && !reducedMotion) {
          for (var c = 0; c < cats.length; c++) {
            if (!cats[c].map.prints) { loadPrintFallback(function () {}); break; }
          }
        }
        requestAnimationFrame(tick);
        document.addEventListener("click", onPointer);
        document.addEventListener("touchend", onPointer);
      }
      return;
    }
    loadSheet(sheetUrl(skinsToSpawn[index]), skinsToSpawn[index], function (url, loadedMap) {
      if (url && loadedMap) makeCat(url, loadedMap, skinsToSpawn[index]);
      spawn(skinsToSpawn, index + 1, map, sheet);
    });
  }

  function boot() {
    var skins = [];
    for (var i = 0; i < cfg.count; i++) {
      var pick;
      if (Array.isArray(cfg.skin)) {
        pick = cfg.skin[i % cfg.skin.length];
      } else {
        pick = cfg.skin === "random" ? randomSkin() : cfg.skin;
      }
      skins.push(pick);
    }
    spawn(skins, 0, null, null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
