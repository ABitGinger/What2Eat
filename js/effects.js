/*!
 * effects.js —— 视觉特效与音效
 * 星野粒子背景（含星座连线）、礼花、彩带雨、冲击波、闪白、震屏、WebAudio 音效。
 */
(function (global) {
  'use strict';

  var WTE = global.WTE;
  var U = WTE.util;

  var canvas = null;
  var ctx = null;
  var dpr = 1;
  var W = 0, H = 0;
  var rafId = null;
  var lastT = 0;
  var running = false;

  var level = 'full';
  var palette = { brand: [255, 61, 110], alt: [110, 220, 255], partner: [255, 176, 90], ink: [255, 255, 255] };
  var appearance = 'dark';

  var stars = [];
  var bits = [];          // 礼花 / 彩带
  var mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  var reduced = false;

  /* ------------------------------------------------------------ 调色板 */
  function setPalette(hex, saturation) {
    var hsl = U.hexToHsl(hex) || { h: 344, s: 92, l: 62 };
    var s = isFinite(saturation) ? saturation : hsl.s;
    var brand = U.hexToRgb(U.hslToHex(hsl.h, s, hsl.l)) || { r: 255, g: 61, b: 110 };
    var alt = U.hexToRgb(U.hslToHex(hsl.h + 196, Math.max(40, s - 10), 64)) || { r: 110, g: 220, b: 255 };
    var partner = U.hexToRgb(U.hslToHex(hsl.h + 42, Math.max(40, s - 6), hsl.l + 4)) || { r: 255, g: 176, b: 90 };
    palette = {
      brand: [brand.r, brand.g, brand.b],
      alt: [alt.r, alt.g, alt.b],
      partner: [partner.r, partner.g, partner.b],
      ink: U.contrastInk(hex) === '#ffffff' ? [255, 255, 255] : [24, 18, 26]
    };
  }

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  /* ------------------------------------------------------------ 初始化 */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || global.innerWidth;
    H = canvas.clientHeight || global.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedStars();
  }

  function starCount() {
    if (level === 'off') return 0;
    var density = level === 'lite' ? 15000 : 8600;
    return Math.round(U.clamp((W * H) / density, 40, level === 'lite' ? 90 : 190));
  }

  function seedStars() {
    var n = starCount();
    stars = [];
    for (var i = 0; i < n; i++) {
      stars.push({
        x: U.rand() * W,
        y: U.rand() * H,
        z: 0.35 + U.rand() * 0.9,
        r: 0.5 + U.rand() * 1.5,
        tw: U.rand() * Math.PI * 2,
        ts: 0.6 + U.rand() * 1.6,
        c: U.rand() < 0.22 ? 'brand' : (U.rand() < 0.3 ? 'alt' : 'ink')
      });
    }
  }

  function init(canvasEl) {
    canvas = canvasEl;
    if (!canvas) return;
    reduced = U.prefersReducedMotion();
    resize();
    global.addEventListener('resize', U.debounce(resize, 180));
    global.addEventListener('pointermove', onPointerMove, { passive: true });
    start();
  }

  function onPointerMove(e) {
    mouse.tx = e.clientX / Math.max(1, global.innerWidth);
    mouse.ty = e.clientY / Math.max(1, global.innerHeight);
  }

  /* ------------------------------------------------------------ 循环 */
  function start() {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = global.requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = null;
  }

  function frame(t) {
    if (!running) return;
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016;
    lastT = t;
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    draw(dt);
    rafId = global.requestAnimationFrame(frame);
  }

  function draw(dt) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    var light = appearance === 'light';
    var baseAlpha = light ? 0.34 : 0.7;
    var ox = (mouse.x - 0.5) * 26;
    var oy = (mouse.y - 0.5) * 26;

    /* --- 背景光晕 --- */
    var glow = ctx.createRadialGradient(W * 0.5 + ox * 2, H * 0.42 + oy * 2, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.72);
    glow.addColorStop(0, rgba(palette.brand, light ? 0.06 : 0.13));
    glow.addColorStop(0.45, rgba(palette.alt, light ? 0.03 : 0.05));
    glow.addColorStop(1, rgba(palette.brand, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* --- 星点 --- */
    var pts = [];
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.tw += dt * s.ts;
      var twinkle = 0.55 + Math.sin(s.tw) * 0.45;
      var px = s.x + ox * s.z;
      var py = s.y + oy * s.z;
      var color = palette[s.c] || palette.ink;
      ctx.beginPath();
      ctx.arc(px, py, s.r * s.z, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, baseAlpha * twinkle * (light ? 0.5 : 1));
      ctx.fill();
      if (level === 'full' && i % 2 === 0) pts.push({ x: px, y: py, z: s.z });
    }

    /* --- 星座连线 --- */
    if (level === 'full') {
      var maxD = Math.min(W, H) * 0.16;
      var maxD2 = maxD * maxD;
      ctx.lineWidth = 0.7;
      for (var a = 0; a < pts.length; a++) {
        for (var b = a + 1; b < pts.length; b++) {
          var dx = pts[a].x - pts[b].x;
          var dy = pts[a].y - pts[b].y;
          var d2 = dx * dx + dy * dy;
          if (d2 > maxD2) continue;
          var alpha = (1 - d2 / maxD2) * (light ? 0.08 : 0.16);
          ctx.strokeStyle = rgba(palette.brand, alpha);
          ctx.beginPath();
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[b].x, pts[b].y);
          ctx.stroke();
        }
      }
    }

    /* --- 礼花 / 彩带 --- */
    drawBits(dt);
  }

  function spawnBit(x, y, opts) {
    var o = opts || {};
    var speed = o.speed || (120 + U.rand() * 320);
    var angle = o.angle !== undefined ? o.angle + (U.rand() - 0.5) * (o.spread || 1.1) : U.rand() * Math.PI * 2;
    var colors = [palette.brand, palette.alt, palette.partner, palette.ink];
    bits.push({
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (o.lift || 40),
      g: o.gravity === undefined ? 620 : o.gravity,
      life: 0,
      ttl: o.ttl || (0.9 + U.rand() * 1.1),
      w: o.w || (3 + U.rand() * 6),
      h: o.h || (2 + U.rand() * 5),
      rot: U.rand() * Math.PI * 2,
      vr: (U.rand() - 0.5) * 14,
      color: colors[U.randInt(colors.length)],
      shape: U.rand() < 0.35 ? 'circle' : 'ribbon',
      drag: o.drag === undefined ? 0.985 : o.drag
    });
  }

  function drawBits(dt) {
    if (!bits.length) return;
    var keep = [];
    for (var i = 0; i < bits.length; i++) {
      var p = bits[i];
      p.life += dt;
      if (p.life >= p.ttl) continue;
      p.vy += p.g * dt;
      p.vx *= p.drag;
      p.vy *= p.drag > 0.99 ? 0.995 : p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;

      var lifeRatio = 1 - p.life / p.ttl;
      ctx.save();
      ctx.globalAlpha = U.clamp(lifeRatio * 1.4, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = rgba(p.color, 1);
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.5 + Math.abs(Math.cos(p.rot)) * 0.5));
      }
      ctx.restore();
      keep.push(p);
    }
    bits = keep.slice(0, 900);
  }

  /* ------------------------------------------------------------ 对外特效 */
  function burst(x, y, opts) {
    if (level === 'off') return;
    var o = opts || {};
    var count = o.count || (level === 'lite' ? 26 : 74);
    for (var i = 0; i < count; i++) {
      spawnBit(x, y, {
        speed: o.speed || (150 + U.rand() * 420),
        gravity: o.gravity === undefined ? 700 : o.gravity,
        ttl: 0.9 + U.rand() * 1.2,
        lift: o.lift || 60
      });
    }
  }

  function confettiRain(duration) {
    if (level === 'off') return;
    var until = Date.now() + (duration || 2600);
    var spray = function () {
      if (Date.now() > until) return;
      for (var i = 0; i < (level === 'lite' ? 4 : 12); i++) {
        bits.push({
          x: U.rand() * W,
          y: -20 - U.rand() * 80,
          vx: (U.rand() - 0.5) * 90,
          vy: 90 + U.rand() * 200,
          g: 60,
          life: 0,
          ttl: 3 + U.rand() * 2,
          w: 4 + U.rand() * 7,
          h: 3 + U.rand() * 6,
          rot: U.rand() * Math.PI,
          vr: (U.rand() - 0.5) * 10,
          color: [palette.brand, palette.alt, palette.partner, palette.ink][U.randInt(4)],
          shape: U.rand() < 0.4 ? 'circle' : 'ribbon',
          drag: 0.999
        });
      }
      global.setTimeout(spray, 70);
    };
    spray();
  }

  var shockEl = null;
  function shock(x, y) {
    if (level === 'off' || !shockEl) return;
    shockEl.style.left = x + 'px';
    shockEl.style.top = y + 'px';
    shockEl.classList.remove('is-live');
    void shockEl.offsetWidth;
    shockEl.classList.add('is-live');
  }

  var flashEl = null;
  function flash() {
    if (level === 'off' || !flashEl) return;
    flashEl.classList.remove('is-live');
    void flashEl.offsetWidth;
    flashEl.classList.add('is-live');
  }

  function shake() {
    if (level !== 'full') return;
    var b = document.body;
    b.classList.remove('is-shaking');
    void b.offsetWidth;
    b.classList.add('is-shaking');
    global.setTimeout(function () { b.classList.remove('is-shaking'); }, 560);
  }

  function haptic(ms) {
    if (level === 'off') return;
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 18);
    } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------ 音效 */
  var audio = { ctx: null, enabled: true, master: null };

  function ac() {
    if (!audio.ctx) {
      var C = global.AudioContext || global.webkitAudioContext;
      if (!C) return null;
      audio.ctx = new C();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.22;
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') {
      try { audio.ctx.resume(); } catch (e) { /* 忽略 */ }
    }
    return audio.ctx;
  }

  function tone(freq, dur, type, gain, when) {
    if (!audio.enabled || level === 'off') return;
    var c = ac();
    if (!c || !audio.master) return;
    var t0 = c.currentTime + (when || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain === undefined ? 0.5 : gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function sweep(f1, f2, dur, gain) {
    if (!audio.enabled || level === 'off') return;
    var c = ac();
    if (!c || !audio.master) return;
    var t0 = c.currentTime;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.16, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    osc.connect(lp); lp.connect(g); g.connect(audio.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  var sound = {
    setEnabled: function (v) { audio.enabled = !!v; if (v) ac(); },
    click: function () { tone(660, 0.06, 'triangle', 0.16); },
    tick: function (n) { tone(760 + (n || 0) * 24, 0.035, 'square', 0.055); },
    whoosh: function () { sweep(1400, 180, 0.5, 0.13); },
    land: function () { sweep(240, 900, 0.22, 0.12); },
    win: function () {
      var notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (f, i) { tone(f, 0.42, 'sine', 0.3, i * 0.085); });
      tone(261.63, 0.7, 'triangle', 0.16, 0.02);
    },
    fanfare: function () {
      var seq = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      seq.forEach(function (f, i) { tone(f, 0.3, 'sine', 0.26, i * 0.1); });
    }
  };

  /* ------------------------------------------------------------ 光标光晕 */
  function bindCursor(el) {
    if (!el || !global.matchMedia || !global.matchMedia('(pointer: fine)').matches) return;
    var raf = null, x = 0, y = 0;
    function apply() {
      raf = null;
      el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    }
    document.addEventListener('pointermove', function (e) {
      x = e.clientX; y = e.clientY;
      if (!document.body.classList.contains('has-cursor')) document.body.classList.add('has-cursor');
      if (!raf) raf = global.requestAnimationFrame(apply);
    }, { passive: true });
    document.addEventListener('pointerleave', function () {
      document.body.classList.remove('has-cursor');
    });
  }

  /* ------------------------------------------------------------ 等级 / 外观 */
  function setLevel(next) {
    level = next === 'lite' || next === 'off' ? next : 'full';
    if (level === 'off') {
      bits = [];
      stop();
      if (ctx && canvas) ctx.clearRect(0, 0, W, H);
    } else {
      seedStars();
      start();
    }
  }

  function setAppearance(mode) {
    appearance = mode === 'light' ? 'light' : 'dark';
  }

  function level_() { return level; }

  WTE.fx = {
    init: init,
    setLevel: setLevel,
    getLevel: level_,
    setPalette: setPalette,
    setAppearance: setAppearance,
    burst: burst,
    confettiRain: confettiRain,
    shock: shock,
    flash: flash,
    shake: shake,
    haptic: haptic,
    sound: sound,
    bindCursor: bindCursor,
    bindDom: function (opts) {
      shockEl = opts.shock || null;
      flashEl = opts.flash || null;
    },
    center: function () {
      var core = document.getElementById('core');
      if (!core) return { x: W / 2, y: H / 2 };
      var r = core.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    size: function () { return { w: W, h: H }; }
  };
})(window);
