/*!
 * draw.js —— 抽取引擎
 *
 * 两种方式：
 *   where（去哪吃）：主选食堂 + 次选食堂
 *   what （吃什么）：主选档口 + 次选档口（并标出各自所属食堂 = 主选/次选食堂）
 * 以及 where 之后的追加步骤：在已抽中的食堂里各抽一个档口。
 *
 * 出发地（origin）：
 *   传一个地点 id 进来，就只在「标了离这儿近」的食堂里抽 —— 主选一定在附近，
 *   次选优先也在附近，附近只剩一家时会自动放宽到稍远的食堂并给出提示。
 *   传 null / undefined 就是「任意」，全清单一起抽。
 *
 * 规则：加权、不放回、能吃到的都算数（只从 enabled 的食堂/档口里抽）。
 */
(function (global) {
  'use strict';

  var WTE = global.WTE;
  var U = WTE.util;
  var S = WTE.store;

  /* ------------------------------------------------------------ 候选池 */
  function activeCanteens() {
    var st = S.get();
    if (!st) return [];
    return st.canteens.filter(function (c) { return c.enabled; });
  }

  function enabledStalls(canteen) {
    return canteen.stalls.filter(function (s) { return s.enabled; });
  }

  function allPairs() {
    var out = [];
    activeCanteens().forEach(function (c) {
      enabledStalls(c).forEach(function (s) { out.push({ canteen: c, stall: s }); });
    });
    return out;
  }

  function poolStats() {
    var cs = activeCanteens();
    var pairs = allPairs();
    return {
      canteens: cs.length,
      stalls: pairs.length,
      canteensWithStalls: cs.filter(function (c) { return enabledStalls(c).length > 0; }).length
    };
  }

  /** 这个食堂标了「离 placeId 近」吗 */
  function isNear(canteen, placeId) {
    if (!placeId || !canteen) return false;
    return (canteen.near || []).indexOf(placeId) >= 0;
  }

  /** 出发地 -> 可用的食堂池（没有出发地就是整个清单） */
  function nearCanteens(placeId) {
    var all = activeCanteens();
    if (!placeId) return all;
    return all.filter(function (c) { return isNear(c, placeId); });
  }

  /** 各地点的可用食堂数，给界面上的地点选择器显示「附近几家」 */
  function nearCounts() {
    var st = S.get();
    var out = {};
    if (!st) return out;
    st.places.forEach(function (p) {
      out[p.id] = st.canteens.filter(function (c) {
        return c.enabled && (c.near || []).indexOf(p.id) >= 0 && enabledStalls(c).length > 0;
      }).length;
    });
    return out;
  }

  /** 出发地的显示名，没传就是「任意」 */
  function originName(placeId) {
    if (!placeId) return '任意';
    var p = S.findPlace(placeId);
    return p ? p.name : '任意';
  }

  /* ------------------------------------------------------------ 手气值 */
  var HOT_TAGS = ['必点', '招牌', '排队王', '评分高', '特色', '拉满', '毕业标配'];

  function tagBonus(stall) {
    var bonus = 0;
    (stall.tags || []).forEach(function (t) {
      if (HOT_TAGS.indexOf(t) >= 0) bonus += 6;
    });
    return Math.min(bonus, 14);
  }

  function luckForCanteen(c) {
    var n = enabledStalls(c).length;
    var scarcity = n === 0 ? 20 : n <= 3 ? 18 : n <= 6 ? 10 : n <= 10 ? 4 : 0;
    var raw = 40 + (3 - c.weight) * 12 + scarcity + U.rand() * 22;
    return Math.round(U.clamp(raw, 0, 100));
  }

  function luckForStall(canteen, stall) {
    var raw = 45 + (3 - canteen.weight) * 10 + tagBonus(stall) + U.rand() * 18;
    return Math.round(U.clamp(raw, 0, 100));
  }

  var LUCK_LABELS = [
    { min: 95, label: '欧皇附体', flavor: '这一签，食堂大师傅都站你这边。' },
    { min: 85, label: '天选之子', flavor: '今天的运气相当能打。' },
    { min: 70, label: '手气不错', flavor: '是那种吃完会想再来的签。' },
    { min: 55, label: '稳中带皮', flavor: '不惊喜，但绝对不踩雷。' },
    { min: 0, label: '平平无奇但能吃', flavor: '好歹不用纠结了，走吧。' }
  ];

  function labelOf(luck) {
    for (var i = 0; i < LUCK_LABELS.length; i++) {
      if (luck >= LUCK_LABELS[i].min) return LUCK_LABELS[i];
    }
    return LUCK_LABELS[LUCK_LABELS.length - 1];
  }

  /* ------------------------------------------------------------ 抽取 */
  function emptyResult(mode, origin, warnings) {
    return {
      mode: mode,
      at: Date.now(),
      origin: origin || null,
      luck: 0,
      label: LUCK_LABELS[LUCK_LABELS.length - 1],
      picks: [],
      warnings: warnings || []
    };
  }

  function buildPick(role, canteen, stall) {
    return { role: role, canteen: canteen || null, stall: stall || null };
  }

  function weightOfCanteen(c) { return c.weight; }
  function weightOfPair(p) { return p.canteen.weight; }

  /**
   * 按出发地收紧候选池。
   * @returns {{origin: string|null, place: Object|null, primary: Array,
   *           applied: boolean, warnings: string[]}}
   *          primary 是「主选可用的池」——出发地附近一家都没有时会退化成整个清单，
   *          applied 用来区分「约束真的生效了」和「退化成了全清单」。
   */
  function resolvePool(origin, all) {
    var warnings = [];
    if (!origin) return { origin: null, place: null, primary: all, applied: false, warnings: warnings };

    var place = S.findPlace(origin);
    if (!place) return { origin: null, place: null, primary: all, applied: false, warnings: warnings };

    var near = all.filter(function (c) { return isNear(c, origin); });
    if (!near.length) {
      warnings.push('清单里没有食堂标了离「' + place.name + '」近，这一次就把整个清单一起抽了 —— 去控制台把「离哪近」勾上会更准。');
      return { origin: origin, place: place, primary: all, applied: false, warnings: warnings };
    }
    return { origin: origin, place: place, primary: near, applied: true, warnings: warnings };
  }

  /**
   * 主抽取。
   * @param {'where'|'what'} mode
   * @param {string} [origin] 出发地 id，不传 = 任意
   * @returns {Object} 结果对象
   */
  function run(mode, origin) {
    var stats = poolStats();

    if (!stats.canteens) {
      return emptyResult(mode, origin, ['清单里一个启用的食堂都没有，先去控制台加两个吧。']);
    }

    var all = activeCanteens();
    var ctx = resolvePool(origin, all);
    var org = ctx.origin;
    var place = ctx.place;
    var warnings = ctx.warnings.slice();

    /* ---------------- 去哪吃 ---------------- */
    if (mode !== 'what') {
      var primary = U.weightedSample(ctx.primary, 1, weightOfCanteen)[0] || null;

      // 次选：先在「同一片（附近）」的剩余食堂里挑，附近没了才放宽到整个清单
      var rest = all.filter(function (c) { return !primary || c.id !== primary.id; });
      var restNear = org ? rest.filter(function (c) { return isNear(c, org); }) : rest;
      if (ctx.applied && !restNear.length) {
        warnings.push('「' + place.name + '」附近就这一家，次选给你放到稍远一点。');
      }
      var secondary = U.weightedSample(restNear.length ? restNear : rest, 1, weightOfCanteen)[0] || null;

      if (!secondary) warnings.push('清单里只有一个启用的食堂，抽不出次选 —— 再补一个会更有意思。');

      var luckW = primary ? luckForCanteen(primary) : 0;
      if (primary && !enabledStalls(primary).length) {
        warnings.push('「' + primary.name + '」还没填档口，之后就没法追加「吃什么」了。');
      }
      return {
        mode: 'where',
        at: Date.now(),
        origin: org,
        luck: luckW,
        label: labelOf(luckW),
        picks: [buildPick('primary', primary, null), buildPick('secondary', secondary, null)],
        warnings: warnings
      };
    }

    /* ---------------- 吃什么 ---------------- */
    var pairs = allPairs();
    if (!pairs.length) {
      return emptyResult('what', org, ['所有食堂的档口都被关掉了，先打开几个再抽。']);
    }

    var nearPairs = org ? pairs.filter(function (p) { return isNear(p.canteen, org); }) : pairs;
    var firstPool = nearPairs.length ? nearPairs : pairs;
    var first = U.weightedSample(firstPool, 1, weightOfPair)[0];

    var others = pairs.filter(function (p) { return p.canteen.id !== first.canteen.id; });
    var othersNear = org ? others.filter(function (p) { return isNear(p.canteen, org); }) : others;
    if (ctx.applied && !othersNear.length && others.length) {
      warnings.push('「' + place.name + '」附近就这一家有档口，次选给你放到稍远一点。');
    }
    var second = U.weightedSample(othersNear.length ? othersNear : others, 1, weightOfPair)[0];

    if (!second) {
      // 只有一个食堂有档口，退一步：同一食堂里换个档口
      var sameCanteen = pairs.filter(function (p) { return p.stall.id !== first.stall.id; });
      second = U.weightedSample(sameCanteen, 1, weightOfPair)[0] || null;
      if (second) warnings.push('只有「' + first.canteen.name + '」有档口，次选来自同一个食堂。');
      else warnings.push('能吃的档口太少了，留一个给你慢慢挑。');
    }

    var luck = Math.round((luckForStall(first.canteen, first.stall) * 1.3 +
      (second ? luckForStall(second.canteen, second.stall) : 50) * 0.7) / 2);

    return {
      mode: 'what',
      at: Date.now(),
      origin: org,
      luck: luck,
      label: labelOf(luck),
      picks: [
        buildPick('primary', first.canteen, first.stall),
        buildPick('secondary', second ? second.canteen : null, second ? second.stall : null)
      ],
      warnings: warnings
    };
  }

  /**
   * where 之后的追加：在抽中的食堂里各抽一个档口。
   * @param {Array} canteens 已经抽中的食堂（最多取前两个）
   * @param {Object} [opts] { exclude: {primary?: string, secondary?: string} 已经给过的档口 id,
   *                          origin: 沿用上一次的出发地（只用于展示） }
   */
  function runStallsFor(canteens, opts) {
    var o = opts || {};
    var warnings = [];
    var list = (canteens || []).filter(Boolean).slice(0, 2);

    if (!list.length) {
      return {
        mode: 'where-stalls', at: Date.now(), origin: o.origin || null, luck: 0,
        label: LUCK_LABELS[LUCK_LABELS.length - 1], picks: [],
        warnings: ['没有可以抽的食堂。']
      };
    }

    var picks = list.map(function (c, i) {
      var role = i === 0 ? 'primary' : 'secondary';
      var excludeId = (o.exclude && o.exclude[role]) || null;
      var pool = enabledStalls(c).filter(function (s) { return s.id !== excludeId; });
      if (!pool.length) {
        warnings.push('「' + c.name + '」没有可抽的档口。');
        return buildPick(role, c, null);
      }
      var picked = U.weightedSample(pool, 1, function () { return 1; })[0];
      return buildPick(role, c, picked);
    });

    var withStall = picks.filter(function (p) { return p.stall; });
    var luck = withStall.length
      ? Math.round(withStall.reduce(function (n, p) { return n + luckForStall(p.canteen, p.stall); }, 0) / withStall.length)
      : 0;

    return {
      mode: 'where-stalls',
      at: Date.now(),
      origin: o.origin || null,
      luck: luck,
      label: labelOf(luck),
      picks: picks,
      warnings: warnings
    };
  }

  /** 把结果压缩成可持久化的形式 */
  function serialize(result) {
    if (!result) return null;
    return {
      mode: result.mode === 'what' ? 'what' : (result.mode === 'where-stalls' ? 'where' : result.mode),
      at: result.at || Date.now(),
      luck: result.luck || 0,
      origin: result.origin || null,
      canteenIds: result.picks.filter(function (p) { return p.canteen; }).map(function (p) { return p.canteen.id; }),
      stallIds: result.picks.filter(function (p) { return p.stall; }).map(function (p) { return p.stall.id; })
    };
  }

  /** 从持久化的 last 还原成可渲染的结果 */
  function revive(last) {
    if (!last) return null;
    var picks = [];
    var mode = last.mode === 'what' ? 'what' : 'where';
    var hasStalls = (last.stallIds || []).length > 0;
    var origin = S.findPlace(last.origin) ? last.origin : null;

    (last.canteenIds || []).forEach(function (cid, i) {
      var c = S.findCanteen(cid);
      if (!c) return;
      var stall = null;
      var sid = hasStalls ? last.stallIds[i] : null;
      if (sid) {
        var found = S.findStall(sid);
        if (found && found.canteen.id === cid) stall = found.stall;
      }
      picks.push(buildPick(i === 0 ? 'primary' : 'secondary', c, stall));
    });

    // what 模式理论上一定有 canteenIds；兜底再按 stallIds 补
    if (!picks.length && hasStalls) {
      (last.stallIds || []).forEach(function (sid, i) {
        var found = S.findStall(sid);
        if (found) picks.push(buildPick(i === 0 ? 'primary' : 'secondary', found.canteen, found.stall));
      });
    }
    if (!picks.length) return null;

    return {
      mode: hasStalls && mode === 'where' ? 'where-stalls' : mode,
      at: last.at,
      origin: origin,
      luck: last.luck,
      label: labelOf(last.luck || 0),
      picks: picks,
      warnings: [],
      restored: true
    };
  }

  /**
   * 只重抽某一个位置（保留另一个）。沿用当前结果的出发地。
   * @param {Object} result 当前结果
   * @param {'primary'|'secondary'} role
   * @returns {{pick: Object|null, reason: string}}
   */
  function reroll(result, role) {
    if (!result || !result.picks) return { pick: null, reason: '没有可重抽的结果。' };
    var idx = role === 'secondary' ? 1 : 0;
    var otherIdx = idx === 0 ? 1 : 0;
    var other = result.picks[otherIdx];
    var current = result.picks[idx];
    var org = S.findPlace(result.origin) ? result.origin : null;

    function notTaken(c) {
      if (current && current.canteen && c.id === current.canteen.id) return false;
      if (other && other.canteen && c.id === other.canteen.id) return false;
      return true;
    }

    /* where：重抽食堂 */
    if (result.mode === 'where') {
      var all = activeCanteens();
      var pool = (org ? all.filter(function (c) { return isNear(c, org); }) : all).filter(notTaken);
      if (!pool.length) pool = all.filter(notTaken);            // 附近没人了，放宽到整个清单
      if (!pool.length) return { pick: null, reason: '没有别的食堂可以换了。' };
      var c2 = U.weightedSample(pool, 1, weightOfCanteen)[0];
      return { pick: buildPick(role, c2, null), reason: '' };
    }

    /* what：重抽档口 */
    if (result.mode === 'what') {
      var pairs = allPairs().filter(function (p) {
        if (current && current.stall && p.stall.id === current.stall.id) return false;
        if (other && other.stall && p.stall.id === other.stall.id) return false;
        return true;
      });
      var pool2 = org ? pairs.filter(function (p) { return isNear(p.canteen, org); }) : pairs;
      if (!pool2.length) pool2 = pairs;
      var notSameCanteen = pool2.filter(function (p) {
        return !(other && other.canteen && p.canteen.id === other.canteen.id);
      });
      var use = notSameCanteen.length ? notSameCanteen : pool2;
      if (!use.length) return { pick: null, reason: '没有别的档口可以换了。' };
      var hit = U.weightedSample(use, 1, weightOfPair)[0];
      return { pick: buildPick(role, hit.canteen, hit.stall), reason: '' };
    }

    /* where-stalls / 追加档口：在同一个食堂里换个档口 */
    if (!current || !current.canteen) return { pick: null, reason: '这个位置没有食堂。' };
    var list = enabledStalls(current.canteen).filter(function (s) {
      return !(current.stall && s.id === current.stall.id);
    });
    if (!list.length) return { pick: null, reason: '「' + current.canteen.name + '」没有别的档口了。' };
    var st = U.weightedSample(list, 1, function () { return 1; })[0];
    return { pick: buildPick(role, current.canteen, st), reason: '' };
  }

  WTE.draw = {
    activeCanteens: activeCanteens,
    enabledStalls: enabledStalls,
    allPairs: allPairs,
    poolStats: poolStats,
    isNear: isNear,
    nearCanteens: nearCanteens,
    nearCounts: nearCounts,
    originName: originName,
    labelOf: labelOf,
    LUCK_LABELS: LUCK_LABELS,
    run: run,
    reroll: reroll,
    runStallsFor: runStallsFor,
    serialize: serialize,
    revive: revive
  };
})(window);
