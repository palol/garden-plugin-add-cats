/* Add Cats — resident pixel cats for Digital Garden.
 *
 * Cats appear on pages tagged with the note flag, settle and stay, and run to
 * wherever a visitor clicks. Zero dependencies, no tracking, no network beyond
 * the sprite sheets the site owner configures.
 *
 * Sprite layouts (auto-detected from the loaded sheet's size):
 *   classic  — 263x197, 8x6, 32px cells, 1px separators (classic Neko sheets).
 *              The cat frames occupy the top 4 rows; rows 4-5 are effects/text.
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

  var cfg = {
    count: clampInt(script.dataset.count, 1, 5, 3),
    scale: clampInt(script.dataset.scale, 16, 64, 32),
    mode: script.dataset.mode === "stampede" ? "stampede" : "clicked",
    skin: (script.dataset.skin || "random").toLowerCase(),
    assets: script.dataset.assets || "/plugins/add-cats/assets/",
    chromaKey: script.dataset.chromaKey || "",
    skins: {}
  };
  try {
    var parsed = JSON.parse(script.dataset.skins || "{}");
    if (parsed && typeof parsed === "object") cfg.skins = parsed;
  } catch (e) { cfg.skins = {}; }

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
    }
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
    }
  };

  // Built-in public-domain skins ship with the plugin as pre-keyed PNGs.
  var BUILTIN = ["neko", "tabby"];

  function mapFor(width, height) {
    if (width >= 250 && height >= 180) return CLASSIC_MAP;
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

  // Load a sheet, resolve its layout, and optionally chroma-key it.
  function loadSheet(url, cb) {
    var img = new Image();
    if (/^https?:/i.test(url) && url.indexOf(location.origin) !== 0) {
      img.crossOrigin = "anonymous";
    }
    img.onload = function () {
      var map = mapFor(img.naturalWidth, img.naturalHeight);
      if (cfg.chromaKey) {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var key = hexToRgb(cfg.chromaKey);
          var px = data.data;
          for (var i = 0; i < px.length; i += 4) {
            if (px[i + 3] > 0 && near(px[i], px[i + 1], px[i + 2], key)) {
              px[i + 3] = 0;
            }
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

  function makeCat(sheetUrl, map) {
    var el = document.createElement("div");
    el.className = "add-cats-cat";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    frameStyle(el, map, map.cell, cfg.scale);
    el.style.backgroundImage = "url(" + sheetUrl + ")";

    var cat = {
      el: el, map: map, scale: cfg.scale,
      x: 16 + Math.random() * Math.max(1, window.innerWidth - 64),
      y: 40 + Math.random() * Math.max(1, window.innerHeight - 120),
      speed: 5 + Math.random() * 9,       // 5..14 px per step, varied per cat
      frame: 0, idle: 0, idleAnim: null, idleAnimFrame: 0
    };
    cat.tx = cat.x; cat.ty = cat.y;
    position(cat);
    setSprite(cat, "idle", 0);
    cats.push(cat);
    return cat;
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
    cat.x -= (dx / dist) * cat.speed;
    cat.y -= (dy / dist) * cat.speed;
    cat.x = Math.max(cfg.scale / 2, Math.min(window.innerWidth - cfg.scale / 2, cat.x));
    cat.y = Math.max(cfg.scale / 2, Math.min(window.innerHeight - cfg.scale / 2, cat.y));
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
        requestAnimationFrame(tick);
        document.addEventListener("click", onPointer);
        document.addEventListener("touchend", onPointer);
      }
      return;
    }
    loadSheet(sheetUrl(skinsToSpawn[index]), function (url, loadedMap) {
      if (url && loadedMap) makeCat(url, loadedMap);
      spawn(skinsToSpawn, index + 1, map, sheet);
    });
  }

  function boot() {
    var skins = [];
    for (var i = 0; i < cfg.count; i++) {
      skins.push(cfg.skin === "random" ? randomSkin() : cfg.skin);
    }
    spawn(skins, 0, null, null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
