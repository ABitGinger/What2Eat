/*!
 * util.js —— 无依赖工具函数
 * 挂在 window.WTE.util 上，供其余脚本使用（刻意不用 ES Module：
 * 这样双击 index.html 直接从 file:// 打开也能跑，不需要起服务器）。
 */
(function (global) {
  'use strict';

  var WTE = global.WTE = global.WTE || {};

  /* ------------------------------------------------------------ DOM */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ------------------------------------------------------------ 杂项 */
  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + rnd;
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  }

  function deepClone(v) {
    if (global.structuredClone) {
      try { return global.structuredClone(v); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(v));
  }

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  function escapeAttr(s) { return escapeHtml(s); }

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ------------------------------------------------------------ 随机 */
  function rand() {
    if (global.crypto && global.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      global.crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }
  function randInt(n) { return Math.floor(rand() * n); }

  /**
   * 按权重不放回抽样。
   * @param {Array} items
   * @param {number} count
   * @param {Function} weightOf  (item) => number > 0
   * @param {Function} [filter]  (item) => boolean
   */
  function weightedSample(items, count, weightOf, filter) {
    var pool = items.filter(function (it) {
      if (filter && !filter(it)) return false;
      var w = weightOf ? Number(weightOf(it)) : 1;
      return isFinite(w) && w > 0;
    });
    var out = [];
    var n = Math.min(count, pool.length);
    for (var i = 0; i < n; i++) {
      var total = 0;
      for (var j = 0; j < pool.length; j++) total += Math.max(0.0001, Number(weightOf ? weightOf(pool[j]) : 1) || 1);
      var target = rand() * total;
      var acc = 0, idx = pool.length - 1;
      for (var k = 0; k < pool.length; k++) {
        acc += Math.max(0.0001, Number(weightOf ? weightOf(pool[k]) : 1) || 1);
        if (target <= acc) { idx = k; break; }
      }
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }

  /* ------------------------------------------------------------ 颜色 */
  function normHex(input) {
    var s = String(input || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return '#' + s.toLowerCase();
  }

  function hexToRgb(hex) {
    var h = normHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16)
    };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d > 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hexToHsl(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    if (s === 0) { var v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function hue(t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return {
      r: Math.round(hue(h + 1 / 3) * 255),
      g: Math.round(hue(h) * 255),
      b: Math.round(hue(h - 1 / 3) * 255)
    };
  }

  function hslToHex(h, s, l) {
    var c = hslToRgb(h, s, l);
    var to = function (n) { return ('0' + c[n].toString(16)).slice(-2); };
    return '#' + to('r') + to('g') + to('b');
  }

  /** 相对亮度，用于决定叠在品牌色上的文字用黑还是白 */
  function luminance(hex) {
    var c = hexToRgb(hex);
    if (!c) return 0;
    var f = function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrastInk(hex) {
    return luminance(hex) > 0.42 ? '#12100f' : '#ffffff';
  }

  /* ------------------------------------------------------------ Base64 / 压缩 */
  function bytesToB64(bytes) {
    var s = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return global.btoa(s);
  }

  function b64ToBytes(b64) {
    var raw = global.atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function toBase64Url(bytes) {
    return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return b64ToBytes(s);
  }

  var hasCompression = typeof global.CompressionStream === 'function' &&
                       typeof global.DecompressionStream === 'function';

  async function gzip(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new global.CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function gunzip(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new global.DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function utf8Encode(str) { return new TextEncoder().encode(str); }
  function utf8Decode(bytes) { return new TextDecoder().decode(bytes); }

  /* ------------------------------------------------------------ 剪贴板 / 下载 */
  async function copyText(text) {
    try {
      if (navigator.clipboard && global.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 退化到 execCommand */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function bytesToHuman(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  /* ------------------------------------------------------------ 导出 */
  WTE.util = {
    $: $, $$: $$, el: el,
    uid: uid, clamp: clamp, debounce: debounce, deepClone: deepClone,
    escapeHtml: escapeHtml, escapeAttr: escapeAttr,
    formatTime: formatTime, stamp: stamp, prefersReducedMotion: prefersReducedMotion,
    rand: rand, randInt: randInt, weightedSample: weightedSample,
    normHex: normHex, hexToRgb: hexToRgb, hexToHsl: hexToHsl,
    hslToHex: hslToHex, luminance: luminance, contrastInk: contrastInk,
    toBase64Url: toBase64Url, fromBase64Url: fromBase64Url,
    gzip: gzip, gunzip: gunzip, hasCompression: hasCompression,
    utf8Encode: utf8Encode, utf8Decode: utf8Decode,
    copyText: copyText, download: download, bytesToHuman: bytesToHuman
  };
})(window);
