/*!
 * store.js —— 状态中枢
 * 负责：localStorage 持久化、数据规范化与校验、导入导出、分享链接编解码。
 * 所有对状态的写入都必须走 store.mutate()，写入后自动存盘并广播。
 */
(function (global) {
  'use strict';

  var WTE = global.WTE;
  var U = WTE.util;

  var KEY = 'wte.state.v2';
  var KEY_LEGACY = 'wte.state.v1';
  var KEY_SEEN = 'wte.seen.v1';

  var SCHEMA_VERSION = 3;
  var MAX_CANTEENS = 400;
  var MAX_STALLS = 1200;
  var MAX_PLACES = 80;
  var MAX_NEAR = 12;

  var APPEARANCES = ['dark', 'light'];
  var FX_LEVELS = ['full', 'lite', 'off'];

  var state = null;
  var listeners = [];
  var saveTimer = null;

  /* ------------------------------------------------------------ 规范化 */
  function str(v, fallback) {
    if (v === null || v === undefined) return fallback || '';
    return String(v).replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function strList(v, max) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length && out.length < (max || 8); i++) {
      var t = str(v[i]);
      if (t && out.indexOf(t) === -1) out.push(t.slice(0, 16));
    }
    return out;
  }

  function normalizeStall(raw, canteenId, index) {
    var o = (raw && typeof raw === 'object') ? raw : { name: String(raw || '') };
    var name = str(o.name, '');
    return {
      id: str(o.id, '') || (canteenId + '-s' + (index + 1)),
      name: name || '未命名档口',
      tags: strList(o.tags, 4),
      price: str(o.price, '').slice(0, 24),
      note: str(o.note, '').slice(0, 120),
      enabled: o.enabled === false ? false : true
    };
  }

  /**
   * 地点（出发地）：教学馆、综一、综二、宿舍区……
   * 只保留 id / name / emoji / area 四个字段，够用且好分享。
   */
  function normalizePlace(raw, index, usedIds) {
    var o = (raw && typeof raw === 'object') ? raw : { name: String(raw || '') };
    var base = str(o.id, '') || ('p' + (index + 1));
    var id = base, n = 2;
    while (usedIds[id]) { id = base + '-' + n; n++; }
    usedIds[id] = true;
    return {
      id: id,
      name: str(o.name, '') || ('地点 ' + (index + 1)),
      emoji: str(o.emoji, '').slice(0, 4) || '📍',
      area: str(o.area, '').slice(0, 60)
    };
  }

  /**
   * 把 canteen.near 里的东西解析成地点 id。
   * 允许写 id，也允许直接写地点名字（导入手写 JSON 时更友好）；
   * 认不出来的直接丢掉并计入 unknown，由调用方决定要不要提示。
   */
  function resolveNear(raw, placeById, placeByName, unknown) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_NEAR; i++) {
      var key = str(raw[i], '');
      if (!key) continue;
      var id = placeById[key] ? key : (placeByName[key] ? placeByName[key].id : null);
      if (!id) {
        if (unknown.indexOf(key) === -1) unknown.push(key);
        continue;
      }
      if (out.indexOf(id) === -1) out.push(id);
    }
    return out;
  }

  function normalizeCanteen(raw, index, usedIds, placeById, placeByName, unknownNear) {
    var o = (raw && typeof raw === 'object') ? raw : { name: String(raw || '') };
    var base = str(o.id, '') || ('c' + (index + 1));
    var id = base, n = 2;
    while (usedIds[id]) { id = base + '-' + n; n++; }
    usedIds[id] = true;

    var stalls = Array.isArray(o.stalls) ? o.stalls.slice(0, MAX_STALLS) : [];
    var usedStallIds = {};
    var list = stalls.map(function (st, i) {
      var ns = normalizeStall(st, id, i);
      var sid = ns.id, k = 2;
      while (usedStallIds[sid]) { sid = ns.id + '-' + k; k++; }
      usedStallIds[sid] = true;
      ns.id = sid;
      return ns;
    });

    var weight = Number(o.weight);
    if (!isFinite(weight) || weight < 1) weight = 1;
    if (weight > 3) weight = 3;

    return {
      id: id,
      name: str(o.name, '') || ('食堂 ' + (index + 1)),
      area: str(o.area, '').slice(0, 60),
      emoji: str(o.emoji, '').slice(0, 4) || '🍽️',
      tags: strList(o.tags, 5),
      note: str(o.note, '').slice(0, 200),
      weight: Math.round(weight),
      enabled: o.enabled === false ? false : true,
      near: resolveNear(o.near, placeById, placeByName, unknownNear),
      stalls: list
    };
  }

  function normalizeTheme(raw) {
    var o = (raw && typeof raw === 'object') ? raw : {};
    var primary = U.normHex(o.primary) || '#ff3d6e';
    var sat = Number(o.saturation);
    if (!isFinite(sat)) sat = 92;
    return {
      primary: primary,
      saturation: Math.round(U.clamp(sat, 20, 100)),
      appearance: APPEARANCES.indexOf(o.appearance) >= 0 ? o.appearance : 'dark',
      fx: FX_LEVELS.indexOf(o.fx) >= 0 ? o.fx : 'full',
      sound: o.sound !== false,
      autoScroll: o.autoScroll !== false
    };
  }

  function normalizeMeta(raw, fallback) {
    var o = (raw && typeof raw === 'object') ? raw : {};
    var f = fallback || {};
    return {
      title: str(o.title, '') || str(f.title, '') || '今天吃什么',
      city: str(o.city, '') || str(f.city, ''),
      source: str(o.source, '') || str(f.source, ''),
      note: str(o.note, '').slice(0, 300) || str(f.note, '')
    };
  }

  function normalizeStats(raw) {
    var o = (raw && typeof raw === 'object') ? raw : {};
    var draws = Number(o.draws);
    var modes = (o.modes && typeof o.modes === 'object') ? o.modes : {};
    return {
      draws: isFinite(draws) && draws > 0 ? Math.round(draws) : 0,
      modes: {
        where: Math.max(0, Math.round(Number(modes.where) || 0)),
        what: Math.max(0, Math.round(Number(modes.what) || 0))
      },
      since: isFinite(Number(o.since)) && Number(o.since) > 0 ? Number(o.since) : Date.now(),
      achievements: strList(o.achievements, 24)
    };
  }

  function normalizeLast(raw, canteens, places) {
    if (!raw || typeof raw !== 'object') return null;
    var ids = {};
    canteens.forEach(function (c) { ids[c.id] = c; });
    var placeIds = {};
    places.forEach(function (p) { placeIds[p.id] = p; });
    var mode = raw.mode === 'what' ? 'what' : 'where';
    var cIds = Array.isArray(raw.canteenIds) ? raw.canteenIds.filter(function (id) { return !!ids[id]; }).slice(0, 2) : [];
    var sIds = Array.isArray(raw.stallIds) ? raw.stallIds.slice(0, 2) : [];
    if (!cIds.length && !sIds.length) return null;
    var origin = raw.origin && placeIds[raw.origin] ? raw.origin : null;
    return {
      mode: mode,
      at: isFinite(Number(raw.at)) ? Number(raw.at) : Date.now(),
      luck: Math.round(U.clamp(Number(raw.luck) || 0, 0, 100)),
      origin: origin,
      canteenIds: cIds,
      stallIds: sIds
    };
  }

  /**
   * 老数据升级：v2 及以前没有「地点」，如果这份清单看着就是大工那份示例
   * （食堂名字能对上默认示例），就按名字把地点和「离哪近」补回去。
   * 名字对不上就什么都不做 —— 宁可没有地点，也不要凭空塞一堆陌生的地标。
   */
  function upgradeLegacyPlaces(o, warnings) {
    if (!o || Number(o.version) >= SCHEMA_VERSION) return;
    if (Array.isArray(o.places) && o.places.length) return;
    var def = global.WTE_DEFAULT_DATA;
    if (!def || !Array.isArray(def.places) || !def.places.length) return;
    if (!Array.isArray(o.canteens) || !o.canteens.length) return;

    var nearByName = {};
    def.canteens.forEach(function (c) { nearByName[String(c.name || '').trim()] = c.near || []; });

    var need = {};
    var hits = [];
    o.canteens.forEach(function (c) {
      var nm = c && String(c.name || '').trim();
      var near = nm && nearByName[nm];
      if (!near || !near.length) return;
      hits.push({ raw: c, near: near });
      near.forEach(function (id) { need[id] = true; });
    });
    if (!hits.length) return;

    // 只引入真正被用到的那些地点，不把整份地图塞给用户
    o.places = def.places.filter(function (p) { return need[p.id]; }).map(function (p) {
      return { id: p.id, name: p.name, emoji: p.emoji, area: p.area };
    });
    hits.forEach(function (h) {
      var has = Array.isArray(h.raw.near) && h.raw.near.length;
      if (!has) h.raw.near = h.near.slice();
    });
    warnings.push('检测到旧版本数据，已按大工示例补上「出发地」和食堂的「离哪近」，可在控制台修改。');
  }

  /**
   * 把任意输入整形成合法 state。
   * @returns {{state: Object, errors: string[], warnings: string[]}}
   */
  function normalize(raw, fallbackMeta) {
    var errors = [];
    var warnings = [];
    var o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;

    if (!o) {
      errors.push('数据不是合法的配置对象。');
      o = {};
    }
    upgradeLegacyPlaces(o, warnings);

    if (!Array.isArray(o.places)) {
      if (o.places !== undefined) warnings.push('places 字段不是数组，已忽略。');
      o.places = [];
    }
    if (o.places.length > MAX_PLACES) {
      warnings.push('地点数量超过 ' + MAX_PLACES + '，多余的已截断。');
      o.places = o.places.slice(0, MAX_PLACES);
    }
    var usedPlaceIds = {};
    var places = o.places.map(function (p, i) { return normalizePlace(p, i, usedPlaceIds); });
    var placeById = {}, placeByName = {};
    places.forEach(function (p) {
      placeById[p.id] = p;
      if (!placeByName[p.name]) placeByName[p.name] = p;
    });

    if (!Array.isArray(o.canteens)) {
      if (o.canteens !== undefined) warnings.push('canteens 字段不是数组，已忽略。');
      o.canteens = [];
    }
    if (o.canteens.length > MAX_CANTEENS) {
      warnings.push('食堂数量超过 ' + MAX_CANTEENS + '，多余的已截断。');
      o.canteens = o.canteens.slice(0, MAX_CANTEENS);
    }

    var usedIds = {};
    var unknownNear = [];
    var canteens = o.canteens.map(function (c, i) {
      return normalizeCanteen(c, i, usedIds, placeById, placeByName, unknownNear);
    });
    if (unknownNear.length) {
      warnings.push('这些「离哪近」的地点在清单里不存在，已忽略：' + unknownNear.slice(0, 6).join('、'));
    }

    var stallsTotal = canteens.reduce(function (n, c) { return n + c.stalls.length; }, 0);
    if (!canteens.length) warnings.push('清单里还没有任何食堂。');
    else if (!stallsTotal) warnings.push('清单里还没有任何档口。');

    // 出发地是本地偏好，指向一个已经不存在的地点时直接归零（= 任意）
    var origin = (typeof o.origin === 'string' && placeById[o.origin]) ? o.origin : null;

    var out = {
      version: SCHEMA_VERSION,
      meta: normalizeMeta(o.meta, fallbackMeta),
      theme: normalizeTheme(o.theme),
      places: places,
      origin: origin,
      canteens: canteens,
      stats: normalizeStats(o.stats),
      last: normalizeLast(o.last, canteens, places),
      updatedAt: Date.now()
    };
    return { state: out, errors: errors, warnings: warnings };
  }

  /* ------------------------------------------------------------ 读写 */
  function readRaw() {
    try {
      var txt = global.localStorage.getItem(KEY);
      if (txt) return JSON.parse(txt);
    } catch (e) { /* 忽略损坏数据 */ }
    try {
      var legacy = global.localStorage.getItem(KEY_LEGACY);
      if (legacy) return JSON.parse(legacy);
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function load(fallbackMeta) {
    var raw = readRaw();
    if (!raw) { state = null; return null; }
    var res = normalize(raw, fallbackMeta);
    state = res.state;
    return { state: state, warnings: res.warnings, errors: res.errors };
  }

  function hasStored() {
    try {
      return !!(global.localStorage.getItem(KEY) || global.localStorage.getItem(KEY_LEGACY));
    } catch (e) { return false; }
  }

  function seen() {
    try { return global.localStorage.getItem(KEY_SEEN) === '1'; } catch (e) { return false; }
  }

  function markSeen() {
    try { global.localStorage.setItem(KEY_SEEN, '1'); } catch (e) { /* 忽略 */ }
  }

  function clearSeen() {
    try { global.localStorage.removeItem(KEY_SEEN); } catch (e) { /* 忽略 */ }
  }

  var lastError = null;

  function save() {
    if (!state) return;
    try {
      state.updatedAt = Date.now();
      global.localStorage.setItem(KEY, JSON.stringify(state));
      lastError = null;
    } catch (e) {
      lastError = e;
      emit({ type: 'save-error', error: e });
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 220);
  }

  /* ------------------------------------------------------------ 订阅 */
  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function emit(evt) {
    listeners.slice().forEach(function (fn) {
      try { fn(evt || { type: 'change' }); } catch (e) { /* 单个订阅者出错不影响其他 */ }
    });
  }

  /* ------------------------------------------------------------ 变更 */
  /**
   * 唯一的状态写入口。
   * @param {Function} fn  (draft) => void  —— 直接改 draft
   * @param {Object} [opts] { silent, event }
   */
  function mutate(fn, opts) {
    var o = opts || {};
    if (!state) state = normalize({}, null).state;
    fn(state);
    state.version = SCHEMA_VERSION;
    state.updatedAt = Date.now();
    if (!o.silent) saveSoon();
    if (!o.noEmit) emit(o.event || { type: 'change' });
    return state;
  }

  function setState(nextRaw, fallbackMeta, opts) {
    var res = normalize(nextRaw, fallbackMeta);
    state = res.state;
    save();
    if (!(opts && opts.noEmit)) emit({ type: 'replace' });
    return res;
  }

  function resetTo(data, opts) {
    setState(U.deepClone(data), null, opts);
  }

  /** 只在内存里装一份数据，不落盘、不广播（用于启动时的占位状态） */
  function setTransient(data) {
    state = normalize(U.deepClone(data), null).state;
    return state;
  }

  function clearAll() {
    try {
      global.localStorage.removeItem(KEY);
      global.localStorage.removeItem(KEY_LEGACY);
    } catch (e) { /* 忽略 */ }
    state = null;
    emit({ type: 'replace' });
  }

  /* ------------------------------------------------------------ 查询 */
  function get() { return state; }

  function stats() {
    if (!state) return { places: 0, canteens: 0, enabledCanteens: 0, stalls: 0, enabledStalls: 0, tagged: 0 };
    var ec = 0, st = 0, es = 0, tagged = 0;
    state.canteens.forEach(function (c) {
      if (c.enabled) ec++;
      if ((c.near || []).length) tagged++;
      c.stalls.forEach(function (s) {
        st++;
        if (s.enabled) es++;
      });
    });
    return {
      places: state.places.length,
      canteens: state.canteens.length, enabledCanteens: ec,
      stalls: st, enabledStalls: es,
      tagged: tagged
    };
  }

  function findCanteen(id) {
    if (!state) return null;
    for (var i = 0; i < state.canteens.length; i++) if (state.canteens[i].id === id) return state.canteens[i];
    return null;
  }

  function findPlace(id) {
    if (!state || !id) return null;
    for (var i = 0; i < state.places.length; i++) if (state.places[i].id === id) return state.places[i];
    return null;
  }

  /** 某个地点被多少个（启用的）食堂标了「离哪近」 */
  function placeUsage(placeId) {
    if (!state) return 0;
    return state.canteens.filter(function (c) {
      return c.enabled && (c.near || []).indexOf(placeId) >= 0;
    }).length;
  }

  function findStall(stallId) {
    if (!state) return null;
    for (var i = 0; i < state.canteens.length; i++) {
      var c = state.canteens[i];
      for (var j = 0; j < c.stalls.length; j++) {
        if (c.stalls[j].id === stallId) return { canteen: c, stall: c.stalls[j] };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------ 序列化 */
  function toJSON(withStats) {
    var out = {
      version: SCHEMA_VERSION,
      meta: state ? state.meta : {},
      theme: state ? state.theme : {},
      places: state ? state.places : [],
      canteens: state ? state.canteens : []
    };
    if (withStats && state) {
      out.stats = state.stats;
      out.last = state.last;
    }
    return JSON.stringify(out, null, 2);
  }

  /* ------------------------------------------------------------ 分享 / 导入 */
  var SHARE_PREFIX = '#c=';

  /**
   * 生成分享串（不含 origin）： c=z<base64url> 或 c=u<base64url>
   */
  async function encodeShare(withStats) {
    var json = toJSON(withStats);
    var bytes = U.utf8Encode(json);
    var flag = 'u';
    var payload = bytes;
    if (U.hasCompression) {
      try {
        payload = await U.gzip(bytes);
        flag = 'z';
      } catch (e) { payload = bytes; flag = 'u'; }
    }
    return flag + U.toBase64Url(payload);
  }

  async function buildShareUrl(withStats) {
    var code = await encodeShare(withStats);
    var base = global.location.origin + global.location.pathname;
    if (global.location.protocol === 'file:') {
      // file:// 下 origin 为 "null"，只能用文件路径
      base = global.location.href.split('#')[0].split('?')[0];
    }
    return base + SHARE_PREFIX + code;
  }

  function readShareFromHash(hash) {
    var h = String(hash || global.location.hash || '');
    var i = h.indexOf('c=');
    if (i === -1) return null;
    return h.slice(i + 2).trim();
  }

  /**
   * 解码分享串或直接粘贴的 JSON / 链接。
   * @returns {Promise<Object>} 规范化后的数据
   */
  async function decodePayload(text) {
    var t = String(text || '').trim();
    if (!t) throw new Error('内容是空的。');

    // 1) 从 URL 里挖出 c= 片段
    if (/^https?:\/\//i.test(t) || t.indexOf('#c=') >= 0) {
      var idx = t.indexOf('c=');
      if (idx >= 0) t = t.slice(idx + 2);
    }
    t = t.trim();

    // 2) JSON
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      var parsed;
      try { parsed = JSON.parse(t); } catch (e) { throw new Error('JSON 解析失败：' + e.message); }
      return parsed;
    }

    // 3) 压缩串
    if (t.charAt(0) === 'z' || t.charAt(0) === 'u') {
      var flag = t.charAt(0);
      var body = t.slice(1);
      var bytes;
      try { bytes = U.fromBase64Url(body); } catch (e) { throw new Error('分享串不是合法的 base64。'); }
      if (flag === 'z') {
        if (!U.hasCompression) throw new Error('这个链接是压缩格式，当前浏览器不支持解压，请换新版 Chrome / Edge / Safari。');
        bytes = await U.gunzip(bytes);
      }
      var text2 = U.utf8Decode(bytes);
      try { return JSON.parse(text2); } catch (e) { throw new Error('分享链接内容已损坏。'); }
    }

    throw new Error('没认出这是什么格式：既不是链接也不是 JSON。');
  }

  /* ------------------------------------------------------------ 成就 */
  var ACHIEVEMENTS = [
    { id: 'first', name: '开张', desc: '完成第一次抽取', icon: '🎉' },
    { id: 'ten', name: '老饕 · 初阶', desc: '累计抽取 10 次', icon: '🥢' },
    { id: 'fifty', name: '食堂之神', desc: '累计抽取 50 次', icon: '👑' },
    { id: 'both', name: '两条腿走路', desc: '「去哪吃」和「吃什么」都抽过', icon: '🚶' },
    { id: 'chain', name: '家庭套餐', desc: '用追加抽取定了食堂 + 档口', icon: '🍱' },
    { id: 'editor', name: '自耕农', desc: '自己新增了一个食堂', icon: '🌱' },
    { id: 'nearby', name: '近水楼台', desc: '选了「从哪出发」抽一次', icon: '🧭' },
    { id: 'share', name: '安利成功', desc: '生成了一次分享链接', icon: '📮' },
    { id: 'queen', name: '欧皇', desc: '抽到 95 以上的手气值', icon: '✨' }
  ];

  function unlock(id) {
    if (!state) return null;
    if (!Array.isArray(state.stats.achievements)) state.stats.achievements = [];
    if (state.stats.achievements.indexOf(id) >= 0) return null;
    state.stats.achievements.push(id);
    saveSoon();
    for (var i = 0; i < ACHIEVEMENTS.length; i++) if (ACHIEVEMENTS[i].id === id) return ACHIEVEMENTS[i];
    return null;
  }

  function hasAchievement(id) {
    return !!(state && state.stats.achievements && state.stats.achievements.indexOf(id) >= 0);
  }

  WTE.store = {
    KEY: KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    ACHIEVEMENTS: ACHIEVEMENTS,
    normalize: normalize,
    load: load,
    hasStored: hasStored,
    seen: seen,
    markSeen: markSeen,
    clearSeen: clearSeen,
    get: get,
    stats: stats,
    save: save,
    saveSoon: saveSoon,
    lastError: function () { return lastError; },
    subscribe: subscribe,
    emit: emit,
    mutate: mutate,
    setState: setState,
    resetTo: resetTo,
    setTransient: setTransient,
    clearAll: clearAll,
    findCanteen: findCanteen,
    findPlace: findPlace,
    placeUsage: placeUsage,
    findStall: findStall,
    toJSON: toJSON,
    encodeShare: encodeShare,
    buildShareUrl: buildShareUrl,
    readShareFromHash: readShareFromHash,
    decodePayload: decodePayload,
    unlock: unlock,
    hasAchievement: hasAchievement
  };
})(window);
