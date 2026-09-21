/*!
 * ui.js —— 界面层
 * 舞台 / 轨道 / 老虎机揭示 / 结果抽签牌 / 控制台（外观·编辑·分享）/ 清单星系 / 引导
 */
(function (global) {
  'use strict';

  var WTE = global.WTE;
  var U = WTE.util;
  var S = WTE.store;
  var D = WTE.draw;
  var FX = WTE.fx;
  var esc = U.escapeHtml;

  var dom = {};
  var ui = {
    mode: 'where',
    origin: null,        // 出发地：地点 id，null = 任意
    originDirty: false,  // true 表示「这次是界面改的」，需要把 ui.origin 写回 state
    result: null,
    openIds: {},
    placesOpen: false,
    editorQuery: '',
    rosterQuery: '',
    busy: false
  };

  var PRESETS = [
    '#ff3d6e', '#ff5722', '#ff9800', '#ffc107', '#a3e635',
    '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1',
    '#a855f7', '#ec4899', '#f43f5e', '#94a3b8'
  ];

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(s, r) { return U.$(s, r); }

  function cache() {
    dom = {
      body: document.body,
      root: document.documentElement,
      barSub: $('#bar-sub'),
      orbit: $('#orbit'),
      originRail: $('#origin-rail'),
      originHint: $('#origin-hint'),
      placebox: $('#placebox'),
      placeboxSub: $('#placebox-sub'),
      places: $('#places'),
      core: $('#core'),
      coreFace: $('#core-face'),
      coreVerdict: $('#core-verdict'),
      coreKicker: $('#core-kicker'),
      coreHint: $('#core-hint'),
      modes: $('#modes'),
      drawBtn: $('#btn-draw'),
      drawLabel: $('#draw-label'),
      stageTip: $('.stage__tip'),
      result: $('#result'),
      settings: $('#panel-settings'),
      roster: $('#panel-roster'),
      galaxy: $('#galaxy'),
      editor: $('#editor'),
      editorStat: $('#editor-stat'),
      editorSearch: $('#editor-search'),
      rostersearch: $('#roster-search'),
      swatches: $('#swatches'),
      themeColor: $('#theme-color'),
      themeChip: $('#theme-chip'),
      themeCode: $('#theme-code'),
      themeSat: $('#theme-sat'),
      themeSatOut: $('#theme-sat-out'),
      optSound: $('#opt-sound'),
      optAutoscroll: $('#opt-autoscroll'),
      shareUrl: $('#share-url'),
      shareNote: $('#share-note'),
      storeNote: $('#store-note'),
      importText: $('#import-text'),
      importFile: $('#import-file'),
      gate: $('#gate'),
      toaster: $('#toaster'),
      cursor: $('#fx-cursor'),
      shock: $('#fx-shock'),
      flash: $('#flash'),
      bulk: $('#modal-bulk'),
      bulkText: $('#bulk-text'),
      bulkReplace: $('#bulk-replace')
    };
  }

  /* ================================================================
     主题
     ================================================================ */
  function applyTheme() {
    var st = S.get();
    if (!st) return;
    var t = st.theme;
    var hsl = U.hexToHsl(t.primary) || { h: 344, s: 92, l: 62 };
    var light = t.appearance === 'light';
    var l = U.clamp(hsl.l, light ? 30 : 50, light ? 56 : 72);

    dom.root.style.setProperty('--h', hsl.h);
    dom.root.style.setProperty('--s', t.saturation + '%');
    dom.root.style.setProperty('--l', l + '%');
    dom.root.dataset.appearance = t.appearance;
    dom.root.dataset.fx = t.fx;

    FX.setPalette(U.hslToHex(hsl.h, t.saturation, l), t.saturation);
    FX.setAppearance(t.appearance);
    FX.setLevel(t.fx);
    FX.sound.setEnabled(t.sound);

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', U.hslToHex(hsl.h, t.saturation, light ? 97 : 7));

    // 控件回填
    if (dom.themeColor) dom.themeColor.value = U.hslToHex(hsl.h, Math.max(60, t.saturation), l);
    if (dom.themeChip) dom.themeChip.style.background = t.primary;
    if (dom.themeCode) dom.themeCode.textContent = t.primary.toUpperCase();
    if (dom.themeSat) dom.themeSat.value = t.saturation;
    if (dom.themeSatOut) dom.themeSatOut.textContent = t.saturation + '%';
    if (dom.optSound) dom.optSound.checked = !!t.sound;
    if (dom.optAutoscroll) dom.optAutoscroll.checked = !!t.autoScroll;

    U.$$('[data-group]').forEach(function (group) {
      var key = group.dataset.group;
      var val = key === 'appearance' ? t.appearance : t.fx;
      U.$$('.seg__btn', group).forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.value === val);
        b.setAttribute('aria-pressed', b.dataset.value === val ? 'true' : 'false');
      });
    });

    if (dom.swatches) {
      dom.swatches.innerHTML = PRESETS.map(function (hex) {
        return '<button type="button" class="swatch' + (U.normHex(hex) === t.primary ? ' is-on' : '') +
          '" data-act="theme-preset" data-color="' + hex + '" style="background:' + hex +
          '" aria-label="主题色 ' + hex + '"></button>';
      }).join('');
    }
  }

  function setTheme(patch, opts) {
    S.mutate(function (st) { Object.keys(patch).forEach(function (k) { st.theme[k] = patch[k]; }); });
    applyTheme();
    if (!(opts && opts.noRender)) refreshLightweight();
  }

  /* ================================================================
     顶栏 / 轨道
     ================================================================ */
  function renderBar() {
    var st = S.get();
    if (!st || !dom.barSub) return;
    var s = S.stats();
    var bits = [s.enabledCanteens + ' 个食堂', s.enabledStalls + ' 个档口'];
    if (st.meta.source) bits.unshift(st.meta.source);
    if (ui.origin) {
      bits.push('从 ' + D.originName(ui.origin) + ' 出发（' + (D.nearCounts()[ui.origin] || 0) + ' 家）');
    }
    if (st.stats.draws) bits.push('已抽 ' + st.stats.draws + ' 次');
    dom.barSub.textContent = bits.join(' · ');
  }

  /* ================================================================
     出发地（从哪出发？）
     ================================================================ */
  function originChip(id, emoji, name, count, on, blank) {
    var tip = id ? (name + ' · 附近 ' + count + ' 个食堂') : ('任意 · 整份清单 ' + count + ' 个食堂');
    return '<button type="button" class="origin__chip' + (on ? ' is-on' : '') + (blank ? ' is-blank' : '') + '"' +
      ' role="radio" aria-checked="' + (on ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '"' +
      ' data-act="set-origin" data-pid="' + U.escapeAttr(id || '') + '"' +
      ' title="' + U.escapeAttr(tip) + '" aria-label="' + U.escapeAttr(tip) + '">' +
      '<i class="origin__ico" aria-hidden="true">' + esc(emoji) + '</i>' +
      '<span class="origin__name">' + esc(name) + '</span>' +
      '<span class="origin__n">' + count + '</span>' +
      '</button>';
  }

  function renderOrigin(ensureVisible) {
    if (!dom.originRail) return;
    var st = S.get();
    if (!st) return;

    // 平时以 state 为准（导入 / 载入示例 / 刷新后都能还原）；
    // 只有界面主动改过（originDirty）时才把 ui.origin 写回去。
    if (ui.originDirty) {
      if (st.origin !== ui.origin) {
        S.mutate(function (s) { s.origin = ui.origin; }, { noEmit: true });
        S.saveSoon();
      }
      ui.originDirty = false;
    } else {
      ui.origin = (st.origin && S.findPlace(st.origin)) ? st.origin : null;
    }

    var counts = D.nearCounts();
    var total = st.canteens.filter(function (c) {
      return c.enabled && D.enabledStalls(c).length > 0;
    }).length;

    var html = originChip('', '🎲', '任意', total, !ui.origin, false);
    st.places.forEach(function (p) {
      var n = counts[p.id] || 0;
      html += originChip(p.id, p.emoji, p.name, n, ui.origin === p.id, n === 0);
    });
    dom.originRail.innerHTML = html;

    var hint = '不选就是整份清单一起抽';
    if (ui.origin) {
      var n2 = counts[ui.origin] || 0;
      hint = n2
        ? '只在离「' + D.originName(ui.origin) + '」近的 ' + n2 + ' 家里抽'
        : '「' + D.originName(ui.origin) + '」附近还没标食堂，会退化成整份清单';
    } else if (!st.places.length) {
      hint = '还没有地点，去控制台「食堂与档口」加几个';
    }
    if (dom.originHint) dom.originHint.textContent = hint;

    if (ensureVisible) {
      var on = dom.originRail.querySelector('.is-on');
      if (on && on.scrollIntoView) {
        try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 忽略 */ }
      }
    }
  }

  function setOrigin(pid) {
    var st = S.get();
    if (!st) return;
    var next = (pid && S.findPlace(pid)) ? pid : null;
    if (next === ui.origin) return;
    ui.origin = next;
    ui.originDirty = true;
    renderOrigin(true);
    renderBar();
    FX.sound.click();
  }

  /** 键盘 ←/→ 在出发地之间挪 */
  function moveOrigin(step) {
    var st = S.get();
    if (!st) return;
    var ids = [''].concat(st.places.map(function (p) { return p.id; }));
    var i = ids.indexOf(ui.origin || '');
    if (i < 0) i = 0;
    var j = (i + step + ids.length * 2) % ids.length;
    setOrigin(ids[j]);
    if (dom.originRail) {
      var on = dom.originRail.querySelector('.is-on');
      if (on) on.focus({ preventScroll: true });
    }
  }

  function renderOrbit() {
    if (!dom.orbit) return;
    var st = S.get();
    dom.orbit.innerHTML = '';
    if (!st) return;

    var list = st.canteens.filter(function (c) { return c.enabled; }).slice();
    list.sort(function (a, b) {
      return (b.weight - a.weight) || (D.enabledStalls(b).length - D.enabledStalls(a).length);
    });

    var max = global.innerWidth > 1280 ? 8 : 6;
    var shown = list.slice(0, max);
    if (shown.length < 2) return;

    var w = dom.orbit.offsetWidth;
    var h = dom.orbit.offsetHeight;
    if (!w || !h) return;

    var rx = w * 0.99;
    var ry = h * 0.74;
    var span = 208;
    var start = -194;

    shown.forEach(function (c, i) {
      var angle = (start + (shown.length === 1 ? span / 2 : (span / (shown.length - 1)) * i)) * Math.PI / 180;
      var jr = 0.95 + U.rand() * 0.12;
      var x = w / 2 + Math.cos(angle) * rx * jr;
      var y = h / 2 + Math.sin(angle) * ry * jr;

      var slot = U.el('div', { class: 'orbit__slot' });
      slot.style.left = x.toFixed(1) + 'px';
      slot.style.top = y.toFixed(1) + 'px';

      var btn = U.el('button', {
        type: 'button',
        class: 'orbit__node',
        'data-act': 'orbit-node',
        'data-id': c.id,
        title: c.name + (c.area ? ' · ' + c.area : '') + '\n点击看它的档口'
      }, [
        U.el('i', { text: c.emoji || '🍽️' }),
        U.el('span', { class: 'orbit__label', text: c.name })
      ]);
      btn.style.setProperty('--dur', (95 + shown.length * 4) + 's');
      slot.appendChild(btn);
      dom.orbit.appendChild(slot);
    });
  }

  function refreshLightweight() {
    renderOrigin(false);   // 先定下 ui.origin，顶栏那行「从 X 出发」才画得对；
                           // 出发地上的计数也随食堂的启用状态/「离哪近」一起刷新
    renderBar();
    renderOrbit();
  }

  /* ================================================================
     揭示动画
     ================================================================ */
  function reelPool(mode) {
    if (mode === 'what') {
      return D.allPairs().map(function (p) { return p.stall.name; });
    }
    return D.activeCanteens().map(function (c) { return c.name; });
  }

  function reel(el, names, duration) {
    return new Promise(function (resolve) {
      if (!names.length || FX.getLevel() === 'off') { resolve(); return; }
      var t0 = performance.now();
      var lastSwap = 0;
      var lastTick = 0;
      var swaps = 0;
      function step(now) {
        var p = Math.min(1, (now - t0) / duration);
        var interval = 38 + Math.pow(p, 3.2) * 340;
        if (now - lastSwap > interval) {
          lastSwap = now;
          swaps++;
          el.textContent = names[U.randInt(names.length)];
          if (now - lastTick > 42) {
            lastTick = now;
            FX.sound.tick(swaps % 7);
          }
        }
        if (p < 1) global.requestAnimationFrame(step);
        else resolve();
      }
      global.requestAnimationFrame(step);
    });
  }

  function setBusy(on) {
    ui.busy = !!on;
    dom.body.dataset.drawing = on ? 'true' : 'false';
    dom.drawBtn.classList.toggle('is-busy', !!on);
    dom.drawBtn.disabled = !!on;
    if (dom.drawLabel) dom.drawLabel.textContent = on ? '抽取中…' : '抽取';
  }

  async function playReveal(result) {
    setBusy(true);
    dom.coreVerdict.classList.remove('is-locked');
    dom.coreVerdict.classList.add('is-reeling');
    dom.coreHint.classList.add('is-hidden');
    dom.coreKicker.textContent = result.mode === 'what' ? '档口风暴' : (result.mode === 'where-stalls' ? '档口追加' : '食堂风暴');
    FX.sound.whoosh();

    var names = (result.picks || []).map(function (p) {
      return p.stall ? p.stall.name : (p.canteen ? p.canteen.name : '');
    }).filter(Boolean);
    var pool = reelPool(result.mode === 'where-stalls' ? 'what' : result.mode);
    if (pool.length < 4) pool = pool.concat(names);

    var dur = result.mode === 'what' ? 1500 : 1350;
    if (FX.getLevel() === 'off') dur = 260;
    await reel(dom.coreVerdict, pool, dur);

    var headline = names[0] || '今天没得吃';
    dom.coreVerdict.textContent = headline;
    dom.coreVerdict.classList.remove('is-reeling');
    void dom.coreVerdict.offsetWidth;
    dom.coreVerdict.classList.add('is-locked');
    dom.coreKicker.textContent = result.label ? result.label.label : '命运已落定';

    var c = FX.center();
    FX.flash();
    FX.shock(c.x, c.y);
    FX.burst(c.x, c.y, { count: 90 });
    FX.shake();
    FX.haptic([16, 40, 22]);
    FX.sound.land();
    global.setTimeout(function () { FX.sound.win(); }, 90);

    await sleep(FX.getLevel() === 'off' ? 120 : 420);
    dom.coreHint.classList.remove('is-hidden');
    setBusy(false);
  }

  /* ================================================================
     结果
     ================================================================ */
  function pickCard(pick, index, result) {
    var c = pick.canteen, st = pick.stall;
    var isPrimary = pick.role === 'primary';
    var name = st ? st.name : (c ? c.name : '抽不出来');
    var tags = (st ? st.tags : (c ? c.tags : [])) || [];
    var note = st ? st.note : (c ? c.note : '');
    var price = st && st.price ? st.price : '';

    var org = (result && result.origin) ? result.origin : null;
    var nearHit = !!(org && c && D.isNear(c, org));

    var meta = [];
    if (st && c) meta.push(['🏛', c.name]);
    if (c && c.area) meta.push(['📍', c.area]);
    if (!st && c) meta.push(['🍽', c.stalls.length + ' 个档口']);
    if (price) meta.push(['💰', price]);

    var html = '';
    html += '<span class="pick__badge">' + (isPrimary ? '主选' : '次选') + '</span>';
    if (org) {
      html += '<span class="pick__near">🧭 ' +
        (nearHit ? '离' + esc(D.originName(org)) + '近' : '离' + esc(D.originName(org)) + '稍远') + '</span>';
    }
    html += '<h3 class="pick__name">' + esc(name) + '</h3>';
    html += '<p class="pick__meta">' + meta.map(function (m) {
      return '<span>' + m[0] + ' ' + esc(m[1]) + '</span>';
    }).join('') + '</p>';
    if (tags.length) {
      html += '<ul class="pick__tags">' + tags.map(function (t) {
        return '<li>' + esc(t) + '</li>';
      }).join('') + '</ul>';
    }
    if (note) html += '<p class="pick__note">' + esc(note) + '</p>';

    html += '<div class="pick__roll">';
    html += '<button class="btn btn--ghost btn--sm" type="button" data-act="reroll" data-role="' + pick.role + '">🎲 换这一个</button>';
    if (!st && c && c.stalls.length) {
      html += '<button class="btn btn--ghost btn--sm" type="button" data-act="orbit-node" data-id="' + c.id + '">看看有什么</button>';
    }
    if (isPrimary && c) {
      html += '<span class="pick__ghost">' + (st ? '权重越高越容易被抽到' : '主选优先权重高的食堂') + '</span>';
    }
    html += '</div>';

    var cls = 'pick pick--' + pick.role + (pick.stall || pick.canteen ? '' : ' is-empty');
    return '<article class="' + cls + '" style="--i:' + index + '">' + html + '</article>';
  }

  function renderResult(result, opts) {
    var o = opts || {};
    ui.result = result;
    dom.result.innerHTML = '';

    if (!result || !result.picks || !result.picks.length) {
      dom.result.hidden = true;
      if (result && result.warnings && result.warnings.length) toast(result.warnings[0], 'warn', 4200);
      return;
    }
    dom.result.hidden = false;

    var hasStalls = result.picks.some(function (p) { return !!p.stall; });
    var isWhere = result.mode === 'where';
    var title = result.mode === 'what'
      ? '今天就去吃<em>这个</em>'
      : (result.mode === 'where-stalls' ? '食堂和档口都<em>定好了</em>' : '去哪<em>儿吃</em>');
    var eyebrow = result.mode === 'what' ? 'WHAT TO EAT' : 'WHERE TO EAT';

    var canFollow = isWhere && !hasStalls && result.picks.some(function (p) {
      return p.canteen && D.enabledStalls(p.canteen).length;
    });

    var head = '';
    head += '<div class="result__head">';
    head += '<div>';
    head += '<p class="result__eyebrow">' + eyebrow + '</p>';
    head += '<h2 class="result__title">' + title + '</h2>';
    if (result.origin) {
      var n = D.nearCounts()[result.origin] || 0;
      head += '<p class="result__origin">🧭 从 <b>' + esc(D.originName(result.origin)) + '</b> 出发 · 附近 ' +
        n + ' 家食堂</p>';
    } else {
      head += '<p class="result__origin">🎲 任意出发 · 整份清单一起抽</p>';
    }
    head += '</div>';
    head += '<div class="result__luck">手气值 <b>' + (result.luck || 0) + '</b> · ' + esc(result.label ? result.label.label : '') + '</div>';
    head += '</div>';

    var actions = '';
    actions += '<div class="result__actions">';
    actions += '<button class="btn btn--primary btn--sm" type="button" data-act="draw-again">🔁 再抽一次</button>';
    if (canFollow) {
      actions += '<button class="btn btn--ghost btn--sm" type="button" data-act="followup">✨ 顺便决定吃什么</button>';
    }
    actions += '<button class="btn btn--ghost btn--sm" type="button" data-act="share-this">📮 复制这一签</button>';
    actions += '<button class="btn btn--ghost btn--sm" type="button" data-act="open-roster">🌌 清单星系</button>';
    actions += '</div>';

    var picks = result.picks.map(function (p, i) { return pickCard(p, i, result); });
    var cards = picks.length > 1
      ? '<div class="picks">' + picks[0] + picks[1] + '</div>'
      : '<div class="picks">' + picks[0] + '</div>';

    var warn = (result.warnings && result.warnings.length)
      ? '<p class="mini">' + result.warnings.map(esc).join('　·　') + '</p>' : '';

    dom.result.innerHTML = '<div class="result__inner">' +
      head +
      '<div class="result__link"><span>' + (result.label ? esc(result.label.flavor) : '') + '</span></div>' +
      cards + warn + actions +
      '</div>';

    if (o.animate !== false) {
      dom.result.classList.remove('is-dealt');
      void dom.result.offsetWidth;
      dom.result.classList.add('is-dealt');
      global.setTimeout(function () {
        U.$$('.pick', dom.result).forEach(function (el) { el.classList.add('is-landed'); });
      }, 340);
    }

    var st = S.get();
    if (o.animate !== false && st && st.theme.autoScroll) {
      global.setTimeout(function () {
        dom.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 260);
    }
  }

  function clearResult() {
    ui.result = null;
    dom.result.innerHTML = '';
    dom.result.hidden = true;
    dom.coreVerdict.textContent = '准备好了吗';
    dom.coreVerdict.classList.remove('is-locked', 'is-reeling');
    dom.coreKicker.textContent = '命运抽取器';
  }

  /* ================================================================
     抽取流程
     ================================================================ */
  async function performDraw(mode) {
    if (ui.busy) return;
    var stats = D.poolStats();
    if (!stats.canteens || !stats.stalls) {
      toast(stats.canteens ? '所有档口都被关掉了，先去控制台打开几个。' : '清单是空的，先去控制台填两个食堂。', 'warn', 4200);
      openPanel('settings');
      return;
    }

    var result = D.run(mode, ui.origin);
    S.mutate(function (st) {
      st.stats.draws += 1;
      st.stats.modes[mode] = (st.stats.modes[mode] || 0) + 1;
      st.last = D.serialize(result);
    }, { noEmit: true });
    S.saveSoon();

    await playReveal(result);
    renderResult(result, { animate: true });
    renderBar();
    checkAchievements(result);
  }

  async function performFollowup() {
    if (ui.busy || !ui.result) return;
    var canteens = ui.result.picks.map(function (p) { return p.canteen; }).filter(Boolean);
    if (!canteens.length) return;

    var result = D.runStallsFor(canteens, { origin: ui.result.origin });
    result.mode = 'where-stalls';
    // 保留原食堂顺序
    S.mutate(function (st) { st.last = D.serialize(result); }, { noEmit: true });
    S.saveSoon();

    await playReveal(result);
    renderResult(result, { animate: true });
    var a = S.unlock('chain');
    if (a) showAchievement(a);
    renderBar();
  }

  async function reroll(role) {
    if (ui.busy || !ui.result) return;
    var res = D.reroll(ui.result, role);
    if (!res.pick) { toast(res.reason || '换不了。', 'warn'); return; }

    var idx = role === 'secondary' ? 1 : 0;
    ui.result.picks[idx] = res.pick;
    ui.result.luck = Math.round((ui.result.luck * 0.45) + (40 + U.rand() * 60) * 0.55);
    ui.result.label = D.labelOf(ui.result.luck);

    S.mutate(function (st) { st.last = D.serialize(ui.result); }, { noEmit: true });
    S.saveSoon();

    var card = U.$$('.pick', dom.result)[idx];
    if (card) {
      FX.burst(
        card.getBoundingClientRect().left + card.offsetWidth / 2,
        card.getBoundingClientRect().top + card.offsetHeight / 2,
        { count: 34, speed: 200, gravity: 520 }
      );
    }
    FX.sound.click();
    renderResult(ui.result, { animate: true });
  }

  function shareThis() {
    var r = ui.result;
    if (!r) return;
    var lines = ['🎲 今天吃什么 · 命运抽取结果', ''];
    if (r.origin) lines.push('从「' + D.originName(r.origin) + '」出发', '');
    r.picks.forEach(function (p) {
      var who = p.role === 'primary' ? '主选' : '次选';
      if (p.stall) lines.push(who + '：' + p.stall.name + (p.canteen ? '（' + p.canteen.name + '）' : ''));
      else if (p.canteen) lines.push(who + '：' + p.canteen.name + (p.canteen.area ? ' - ' + p.canteen.area : ''));
    });
    lines.push('');
    lines.push('手气值 ' + r.luck + ' · ' + r.label.label + ' —— ' + r.label.flavor);
    lines.push('（由「今天吃什么」抽取）');
    var text = lines.join('\n');
    U.copyText(text).then(function (ok) {
      toast(ok ? '这一签已经复制到剪贴板。' : '复制失败，手动选中吧。', ok ? 'ok' : 'bad');
    });
  }

  /* ================================================================
     成就
     ================================================================ */
  function checkAchievements(result) {
    var st = S.get();
    var list = [];
    if (st.stats.draws >= 1) list.push('first');
    if (st.stats.draws >= 10) list.push('ten');
    if (st.stats.draws >= 50) list.push('fifty');
    if (st.stats.modes.where > 0 && st.stats.modes.what > 0) list.push('both');
    if ((result.luck || 0) >= 95) list.push('queen');
    if (result.origin || ui.origin) list.push('nearby');

    var unlocked = [];
    list.forEach(function (id) {
      var a = S.unlock(id);
      if (a) unlocked.push(a);
    });
    unlocked.slice(0, 2).forEach(function (a, i) {
      global.setTimeout(function () { showAchievement(a); }, i * 900);
    });
    if (unlocked.length) renderBar();
  }

  function showAchievement(a) {
    var node = U.el('div', { class: 'achv' }, [
      U.el('span', { class: 'achv__icon', text: a.icon }),
      U.el('div', {}, [
        U.el('p', { class: 'achv__kicker', text: 'ACHIEVEMENT' }),
        U.el('p', { class: 'achv__name', text: a.name }),
        U.el('p', { class: 'achv__desc', text: a.desc })
      ])
    ]);
    document.body.appendChild(node);
    FX.sound.fanfare();
    global.setTimeout(function () {
      node.style.transition = 'opacity .4s, translate .4s';
      node.style.opacity = '0';
      node.style.translate = '30px 0';
      global.setTimeout(function () { node.remove(); }, 460);
    }, 4600);
  }

  /* ================================================================
     提示
     ================================================================ */
  function toast(msg, kind, ms) {
    if (!dom.toaster) return;
    var icon = kind === 'ok' ? '✅' : kind === 'warn' ? '⚠️' : kind === 'bad' ? '⛔' : '💬';
    var node = U.el('div', { class: 'toast' + (kind ? ' toast--' + kind : '') }, [
      U.el('i', { text: icon }),
      U.el('span', { text: msg })
    ]);
    dom.toaster.appendChild(node);
    var ttl = ms || 2600;
    global.setTimeout(function () {
      node.classList.add('is-out');
      global.setTimeout(function () { node.remove(); }, 340);
    }, ttl);
  }

  /* ================================================================
     面板
     ================================================================ */
  function openPanel(which) {
    var panel = which === 'roster' ? dom.roster : dom.settings;
    if (!panel) return;
    panel.hidden = false;
    void panel.offsetWidth;
    panel.classList.add('is-open');
    dom.body.dataset.locked = 'true';
    if (which === 'roster') renderGalaxy();
    if (which === 'settings') {
      renderSharePane();
      renderEditor();
      var focus = panel.querySelector('.panel__body');
      if (focus) focus.scrollTop = 0;
    }
  }

  function closePanel(which) {
    var panel = which === 'roster' ? dom.roster : dom.settings;
    if (!panel || panel.hidden) return;
    panel.classList.remove('is-open');
    global.setTimeout(function () {
      panel.hidden = true;
      // 引导还开着的时候别解锁 —— 重置之后这里会抢在 showGate() 后面把锁打开
      if (dom.settings.hidden && dom.roster.hidden && dom.gate.hidden) dom.body.dataset.locked = 'false';
    }, 280);
  }

  function switchTab(name) {
    U.$$('.tab', dom.settings).forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    U.$$('.pane', dom.settings).forEach(function (p) {
      p.classList.toggle('is-on', p.dataset.pane === name);
    });
    if (name === 'share') renderSharePane();
  }

  /* ================================================================
     编辑器
     ================================================================ */
  function splitTags(v) {
    return String(v || '').split(/[,，、|\/]+/).map(function (t) { return t.trim(); })
      .filter(function (t, i, arr) { return t && arr.indexOf(t) === i; }).slice(0, 4);
  }

  function canteenSub(c) {
    var near = (c.near || []).length;
    return (c.area || '未填写位置') + ' · ' + c.stalls.length + ' 个档口 · 权重 ' + c.weight +
      (near ? ' · 近 ' + near + ' 处' : ' · 未标地点');
  }

  function canteenMatches(c, q) {
    if (!q) return true;
    if (c.name.toLowerCase().indexOf(q) >= 0) return true;
    if ((c.area || '').toLowerCase().indexOf(q) >= 0) return true;
    if ((c.near || []).some(function (pid) {
      var p = S.findPlace(pid);
      return !!p && p.name.toLowerCase().indexOf(q) >= 0;
    })) return true;
    return c.stalls.some(function (s) { return s.name.toLowerCase().indexOf(q) >= 0; });
  }

  /* ---------------------------------------------------------------- 地点 */
  function renderPlaces(st) {
    if (!dom.places) return;
    st = st || S.get();
    if (!st) return;

    var counts = {};
    st.canteens.forEach(function (c) {
      (c.near || []).forEach(function (pid) { counts[pid] = (counts[pid] || 0) + 1; });
    });

    if (dom.placebox) dom.placebox.classList.toggle('is-open', !!ui.placesOpen);
    var head = dom.placebox ? dom.placebox.querySelector('.placebox__head') : null;
    if (head) head.setAttribute('aria-expanded', ui.placesOpen ? 'true' : 'false');
    dom.places.hidden = !ui.placesOpen;

    if (dom.placeboxSub) {
      dom.placeboxSub.textContent = st.places.length
        ? st.places.length + ' 个地点 · 选了出发地就只抽「离它近」的食堂'
        : '还没有地点，加几个比如「教学馆」「宿舍区」';
    }

    if (!ui.placesOpen) { dom.places.innerHTML = ''; return; }

    var html = st.places.map(function (p, i) {
      var n = counts[p.id] || 0;
      return '<div class="place" data-pid="' + p.id + '">' +
        '<div class="place__main">' +
        '<input class="input place__emoji" data-pfield="emoji" data-pid="' + p.id + '" value="' + U.escapeAttr(p.emoji) + '" aria-label="图标" maxlength="4">' +
        '<input class="input place__name" data-pfield="name" data-pid="' + p.id + '" value="' + U.escapeAttr(p.name) + '" aria-label="地点名称">' +
        '<span class="place__count' + (n ? '' : ' is-zero') + '" title="有 ' + n + ' 个食堂标了离这儿近">' + n + ' 个</span>' +
        '<button type="button" class="tiny-btn" data-act="place-up" data-pid="' + p.id + '" title="上移">↑</button>' +
        '<button type="button" class="tiny-btn" data-act="place-down" data-pid="' + p.id + '" title="下移">↓</button>' +
        '<button type="button" class="tiny-btn is-danger" data-act="place-del" data-pid="' + p.id + '" title="删除地点">✕</button>' +
        '</div>' +
        '<input class="input place__area" style="width:100%" data-pfield="area" data-pid="' + p.id + '" value="' +
        U.escapeAttr(p.area) + '" placeholder="在哪儿 / 备注（可留空）" aria-label="地点备注">' +
        '</div>';
    }).join('');

    html += '<form class="place-add" id="place-add">' +
      '<input class="input input--sm" style="width:100%" name="placeName" placeholder="加一个地点，比如「图书馆」，回车确认…" autocomplete="off">' +
      '<button class="btn btn--primary btn--sm" type="submit">加</button></form>';

    dom.places.innerHTML = html;
  }

  function renderEditor() {
    var st = S.get();
    if (!st || !dom.editor) return;
    renderPlaces(st);

    var q = ui.editorQuery.trim().toLowerCase();
    var list = st.canteens.filter(function (c) { return canteenMatches(c, q); });

    var s = S.stats();
    dom.editorStat.textContent = '共 ' + s.canteens + ' 个食堂 / ' + s.stalls + ' 个档口；' +
      '当前启用 ' + s.enabledCanteens + ' 个食堂、' + s.enabledStalls + ' 个档口；' +
      s.places + ' 个地点，其中 ' + s.tagged + ' 个食堂标了「离哪近」。' +
      (q ? '（筛选中，显示 ' + list.length + ' 个）' : '');

    if (!list.length) {
      dom.editor.innerHTML = '<div class="empty">' +
        (st.canteens.length ? '没搜到匹配的食堂。' : '还没有食堂，点右上角「＋ 新食堂」开始。') + '</div>';
      return;
    }

    dom.editor.innerHTML = list.map(function (c, i) { return canteenCard(c, i, q, st); }).join('');
  }

  function canteenCard(c, index, q, st) {
    st = st || S.get() || { places: [] };
    var open = !!ui.openIds[c.id];
    var stallCount = c.stalls.length;
    var shownStalls = q
      ? c.stalls.filter(function (s) {
        return c.name.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0;
      })
      : c.stalls;

    var body = '';
    if (open) {
      body += '<div class="row row--split">';
      body += '<label class="row"><span class="row__label">食堂名称</span>' +
        '<input class="input input--sm" style="width:100%" data-field="name" data-cid="' + c.id + '" value="' + U.escapeAttr(c.name) + '"></label>';
      body += '<label class="row"><span class="row__label">图标（一个 emoji）</span>' +
        '<input class="input input--sm" style="width:100%" data-field="emoji" data-cid="' + c.id + '" value="' + U.escapeAttr(c.emoji) + '"></label>';
      body += '</div>';

      body += '<label class="row"><span class="row__label">位置 / 说明（显示在结果里）</span>' +
        '<input class="input input--sm" style="width:100%" data-field="area" data-cid="' + c.id + '" value="' + U.escapeAttr(c.area) + '"></label>';

      // 「离哪近」：选了出发地之后，只会在勾过这里的食堂里抽
      body += '<div class="row"><span class="row__label">离哪近（出发地，可多选）</span><div class="nearpick">';
      if (!st.places || !st.places.length) {
        body += '<span class="mini">还没有地点 —— 先在上面「出发地（地点）」里加两个。</span>';
      } else {
        var nearIds = c.near || [];
        st.places.forEach(function (p) {
          var on = nearIds.indexOf(p.id) >= 0;
          body += '<button type="button" class="near' + (on ? ' is-on' : '') + '" data-act="toggle-near"' +
            ' data-cid="' + c.id + '" data-pid="' + p.id + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
            ' title="' + U.escapeAttr(p.name + (p.area ? ' · ' + p.area : '')) + '">' +
            esc(p.emoji) + ' ' + esc(p.name) + '</button>';
        });
      }
      body += '</div></div>';

      body += '<label class="row"><span class="row__label">标签（逗号分隔，最多 4 个）</span>' +
        '<input class="input input--sm" style="width:100%" data-field="tags" data-cid="' + c.id + '" value="' + U.escapeAttr((c.tags || []).join(', ')) + '"></label>';

      body += '<label class="row"><span class="row__label">一句话点评</span>' +
        '<input class="input input--sm" style="width:100%" data-field="note" data-cid="' + c.id + '" value="' + U.escapeAttr(c.note) + '"></label>';

      body += '<div class="row"><span class="row__label">权重（越高越容易被抽到）</span><div class="weights">' +
        [1, 2, 3].map(function (w) {
          return '<button type="button" class="weight' + (c.weight === w ? ' is-on' : '') +
            '" data-act="set-weight" data-cid="' + c.id + '" data-weight="' + w + '">' +
            (w === 1 ? '偶尔' : w === 2 ? '常去' : '本命') + '</button>';
        }).join('') + '</div></div>';

      body += '<div class="row"><span class="row__label">档口（' + stallCount + '）</span><div class="stalls">';
      if (!shownStalls.length) {
        body += '<div class="empty">这个食堂还没有档口。</div>';
      } else {
        shownStalls.forEach(function (s) {
          body += '<div class="stall' + (s.enabled ? '' : ' is-off') + '">' +
            '<button type="button" class="tiny-btn" data-act="stall-toggle" data-cid="' + c.id + '" data-sid="' + s.id + '" title="启用 / 停用">' + (s.enabled ? '✓' : '○') + '</button>' +
            '<input class="stall__name" data-field="name" data-cid="' + c.id + '" data-sid="' + s.id + '" value="' + U.escapeAttr(s.name) + '" aria-label="档口名称">' +
            '<input class="stall__price" data-field="price" data-cid="' + c.id + '" data-sid="' + s.id + '" value="' + U.escapeAttr(s.price) + '" placeholder="价格" aria-label="价格">' +
            '<input class="stall__tags" data-field="tags" data-cid="' + c.id + '" data-sid="' + s.id + '" value="' + U.escapeAttr((s.tags || []).join(',')) + '" placeholder="标签" aria-label="标签">' +
            '<button type="button" class="tiny-btn is-danger" data-act="stall-del" data-cid="' + c.id + '" data-sid="' + s.id + '" title="删除档口">✕</button>' +
            '</div>';
        });
      }
      body += '</div>';
      body += '<form class="stall-add" data-cid="' + c.id + '">' +
        '<input class="input input--sm" style="width:100%" name="stallName" placeholder="加一个档口，回车确认…" autocomplete="off">' +
        '<button class="btn btn--primary btn--sm" type="submit">加</button></form>';
      body += '</div>';
    }

    return '<section class="canteen' + (open ? ' is-open' : '') + (c.enabled ? '' : ' is-off') + '" data-cid="' + c.id + '">' +
      '<div class="canteen__head">' +
      '<button type="button" class="canteen__toggle" data-act="canteen-toggle" data-cid="' + c.id + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="canteen__emoji">' + esc(c.emoji || '🍽️') + '</span>' +
      '<span class="canteen__names">' +
      '<span class="canteen__name">' + esc(c.name) + '</span>' +
      '<span class="canteen__sub">' + esc(canteenSub(c)) + '</span>' +
      '</span></button>' +
      '<div class="canteen__tools">' +
      '<button type="button" class="tiny-btn" data-act="canteen-toggle-enabled" data-cid="' + c.id + '" title="' + (c.enabled ? '停用' : '启用') + '">' + (c.enabled ? '✓' : '○') + '</button>' +
      '<button type="button" class="tiny-btn" data-act="canteen-up" data-cid="' + c.id + '" title="上移">↑</button>' +
      '<button type="button" class="tiny-btn" data-act="canteen-down" data-cid="' + c.id + '" title="下移">↓</button>' +
      '<button type="button" class="tiny-btn is-danger" data-act="canteen-del" data-cid="' + c.id + '" title="删除食堂">✕</button>' +
      '</div></div>' +
      '<div class="canteen__body">' + body + '</div>' +
      '</section>';
  }

  /* ================================================================
     清单星系
     ================================================================ */
  /* 由字符串得到稳定的 [0,1) 伪随机数：让同一个食堂每次重排都落在同一处，
     不会因为改一个字（触发重渲染）就整片星系乱跳。 */
  function hash01(str, salt) {
    var h = 2166136261 ^ ((salt || 0) | 0);
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100003) / 100003;
  }

  /** 选了出发地之后，不在「附近」的星球会暗下去，一眼看出哪些在射程内 */
  function farFromOrigin(c) {
    return !!(ui.origin && c.enabled && !D.isNear(c, ui.origin));
  }

  function nearTitle(c) {
    var names = (c.near || []).map(function (id) {
      var p = S.findPlace(id);
      return p ? p.name : null;
    }).filter(Boolean);
    return names.length ? '\n离这儿近：' + names.join('、') : '\n（还没标「离哪近」）';
  }

  function renderGalaxy() {
    var st = S.get();
    if (!st || !dom.galaxy) return;
    var q = ui.rosterQuery.trim().toLowerCase();

    var list = st.canteens.filter(function (c) {
      if (!q) return true;
      return canteenMatches(c, q);
    });

    dom.galaxy.innerHTML = '<p class="galaxy__hint">' +
      (q ? '筛选中 · ' + list.length + ' 个食堂' : '悬停 / 点击每个星球，看它的档口') + '</p>';

    var host = dom.galaxy.parentNode;
    if (!list.length) {
      dom.galaxy.style.height = '';
      dom.galaxy.insertAdjacentHTML('beforeend', '<div class="empty" style="margin-top:140px">没有匹配的食堂。</div>');
      return;
    }

    /* ---- 1. 量可用画布：取父级（滚动容器），避免“自己撑高自己”的反馈 ---- */
    var PAD_X = 34, PAD_TOP = 66, PAD_BOTTOM = 84, SCROLLBAR = 16;
    var w = Math.max(300, ((host && host.clientWidth) || global.innerWidth || 900) - SCROLLBAR);
    var hAvail = Math.max(360, (host && host.clientHeight) || (global.innerHeight || 800) * 0.82);

    var a = Math.max(130, (w - PAD_X * 2) / 2);                   // 椭圆半长轴
    var bFit = Math.max(96, (hAvail - PAD_TOP - PAD_BOTTOM) / 2);  // 椭圆半短轴上限
    var n = list.length;

    /* ---- 2. 反推星球直径：把“总外接框面积 / 椭圆面积”压到 DENSITY 以下 ----
       这是「不挤在一起」的关键——原来直径只跟容器大小有关，
       13 个食堂时外接框能占到 58% 的面积，必然互相压住。
       同时约束画布高度：宁可让面板稍微滚动，也不把星球缩成看不清的小点。 */
    var DENSITY = 0.34, MIN_D = 72, MAX_D = 128;
    var maxCanvas = hAvail * 1.4;
    var d = U.clamp(Math.sqrt((Math.PI * a * bFit * DENSITY) / n), MIN_D, MAX_D);
    var b = 0;
    for (;;) {
      b = Math.max((n * d * d) / (DENSITY * Math.PI * a), d * 0.95);
      if (d <= MIN_D + 0.01) break;
      if (b * 2 + PAD_TOP + PAD_BOTTOM <= maxCanvas) break;
      d = Math.max(MIN_D, d - 2);
    }

    var sizes = list.map(function (c) {
      return Math.round(d * (0.88 + Math.min(D.enabledStalls(c).length, 16) * 0.014));
    });

    /* ---- 3. 叶序种子 + 松弛迭代：任意两个星球都留出 gap，绝不允许重叠 ---- */
    var golden = Math.PI * (3 - Math.sqrt(5));
    var pts = list.map(function (c, i) {
      var t = Math.sqrt((i + 0.62) / n);
      var ang = i * golden + (hash01(c.id, 7) - 0.5) * 0.5;
      var r = t * 0.92;
      return { x: Math.cos(ang) * r * a, y: Math.sin(ang) * r * b, s: sizes[i] };
    });

    var gap = Math.max(12, d * 0.16);
    var i, j, m, dx, dy, dist, minD, push;

    function separate(iters) {
      for (var it = 0; it < iters; it++) {
        var moved = 0;
        for (i = 0; i < pts.length; i++) {
          for (j = i + 1; j < pts.length; j++) {
            var p = pts[i], k = pts[j];
            dx = k.x - p.x; dy = k.y - p.y;
            dist = Math.sqrt(dx * dx + dy * dy);
            minD = (p.s + k.s) / 2 + gap;
            if (dist >= minD) continue;
            if (dist < 0.01) {
              dx = Math.cos((i + 1) * 2.399) * 0.8;
              dy = Math.sin((j + 1) * 2.399) * 0.8;
              dist = 0.8;
            }
            push = ((minD - dist) / dist) * 0.5;
            p.x -= dx * push; p.y -= dy * push;
            k.x += dx * push; k.y += dy * push;
            moved++;
          }
        }
        // 每个星球各自留出半径，收回到椭圆内
        for (m = 0; m < pts.length; m++) {
          var o = pts[m];
          var ra = Math.max(6, a - o.s / 2);
          var rb = Math.max(6, b - o.s / 2);
          var nx = o.x / ra, ny = o.y / rb;
          var len = Math.sqrt(nx * nx + ny * ny);
          if (len > 1) { o.x = (nx / len) * ra; o.y = (ny / len) * rb; }
        }
        if (!moved) return 0;
      }
      var worst = 0; // 残余最大重叠量（px）
      for (i = 0; i < pts.length; i++) {
        for (j = i + 1; j < pts.length; j++) {
          var q1 = pts[i], q2 = pts[j];
          var over = ((q1.s + q2.s) / 2 + gap) -
            Math.sqrt((q2.x - q1.x) * (q2.x - q1.x) + (q2.y - q1.y) * (q2.y - q1.y));
          if (over > worst) worst = over;
        }
      }
      return worst;
    }

    // 撑开空间重试：宁可让面板滚动，也不接受“挤在一起”
    for (var pass = 0; pass < 4; pass++) {
      var worst = separate(220);
      if (worst <= 1.5) break;
      b *= 1.16;
      for (m = 0; m < pts.length; m++) pts[m].y *= 1.16;
    }

    /* ---- 4. 按实际落点定容器尺寸，并横向居中 ---- */
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (o) {
      minX = Math.min(minX, o.x - o.s / 2); maxX = Math.max(maxX, o.x + o.s / 2);
      minY = Math.min(minY, o.y - o.s / 2); maxY = Math.max(maxY, o.y + o.s / 2);
    });
    var offX = Math.max(PAD_X, (w - (maxX - minX)) / 2) - minX;
    var offY = Math.max(PAD_TOP, (hAvail - (maxY - minY)) / 2) - minY;
    dom.galaxy.style.height =
      Math.round(Math.max(hAvail, maxY - minY + PAD_TOP + PAD_BOTTOM)) + 'px';

    // 留一份几何快照，方便排查（冒烟测试也会读它）
    WTE.ui.galaxyGeom = {
      w: w, hAvail: hAvail, a: a, b: b, d: d, gap: gap, n: n,
      canvas: Math.round(Math.max(hAvail, maxY - minY + PAD_TOP + PAD_BOTTOM))
    };

    /* ---- 5. 落 DOM ---- */
    list.forEach(function (c, i) {
      var o = pts[i];
      var size = o.s;
      var x = o.x + offX;
      var y = o.y + offY;

      var node = U.el('button', {
        type: 'button',
        class: 'node' + (c.enabled ? '' : ' is-off') + (farFromOrigin(c) ? ' is-far' : ''),
        'data-act': 'galaxy-node',
        'data-id': c.id,
        style: 'left:' + (x - size / 2).toFixed(1) + 'px;top:' + (y - size / 2).toFixed(1) + 'px;' +
               'width:' + size + 'px;height:' + size + 'px;' +
               'rotate:' + ((hash01(c.id, 21) - 0.5) * 12).toFixed(1) + 'deg;' +
               '--delay:' + (hash01(c.id, 33) * 4).toFixed(2) + 's;',
        title: c.name + (c.area ? ' · ' + c.area : '') + nearTitle(c)
      });

      if (c.enabled) node.style.animationPlayState = 'running';
      node.appendChild(U.el('span', { class: 'node__emoji', text: c.emoji || '🍽️' }));
      node.appendChild(U.el('span', { class: 'node__name', text: c.name }));
      node.appendChild(U.el('span', {
        class: 'node__meta',
        text: D.enabledStalls(c).length + ' 档口' + ((c.near || []).length ? ' · 近 ' + (c.near || []).length + ' 处' : '')
      }));

      if (c.stalls.length) {
        var burst = U.el('div', { class: 'node__burst' });
        c.stalls.slice(0, 24).forEach(function (s) {
          var chip = U.el('span', { text: s.name });
          if (s.price) chip.textContent += ' ' + s.price;
          if (!s.enabled) chip.style.opacity = '.5';
          burst.appendChild(chip);
        });
        if (c.stalls.length > 24) burst.appendChild(U.el('span', { text: '…还有 ' + (c.stalls.length - 24) + ' 个' }));
        node.appendChild(burst);
      }
      dom.galaxy.appendChild(node);
    });
  }

  /* ================================================================
     分享 / 导入
     ================================================================ */
  async function renderSharePane() {
    if (!dom.shareUrl) return;
    dom.shareUrl.value = '正在生成…';
    try {
      var url = await S.buildShareUrl(false);
      dom.shareUrl.value = url;
      var len = url.length;
      var note = '链接长度 ' + len + ' 字符（约 ' + U.bytesToHuman(len * 2) + '）。';
      if (len > 7000) note += ' 有点长了，某些聊天软件会截断，建议改用「导出 .json」。';
      else if (len > 3500) note += ' 偏长，微信里可能被折行，复制后注意别漏字符。';
      else note += ' 可以直接丢给同学。';
      if (!U.hasCompression) note += '（当前浏览器不支持压缩，链接会偏长。）';
      dom.shareNote.textContent = note;
    } catch (e) {
      dom.shareUrl.value = '';
      dom.shareNote.textContent = '生成失败：' + e.message;
    }

    var st = S.get();
    if (dom.storeNote && st) {
      var bytes = 0;
      try { bytes = new Blob([S.toJSON(true)]).size; } catch (e2) { bytes = S.toJSON(true).length; }
      var info = S.storageInfo();
      dom.storeNote.textContent = '配置体积约 ' + U.bytesToHuman(bytes) +
        ' · 只存在这台设备的浏览器里（localStorage · ' + info.key + '）' +
        ' · 上次更新 ' + U.formatTime(st.updatedAt || Date.now()) +
        ' · 已解锁成就 ' + ((st.stats.achievements || []).length) + ' / ' + S.ACHIEVEMENTS.length;
    }
  }

  async function copyLink() {
    var url = dom.shareUrl.value;
    if (!url || url === '正在生成…') url = await S.buildShareUrl(false);
    var ok = await U.copyText(url);
    if (ok) {
      toast('分享链接已复制，发给同学就能看到同一份清单。', 'ok', 3200);
      var a = S.unlock('share');
      if (a) showAchievement(a);
    } else {
      toast('复制失败，手动选中文本框复制吧。', 'bad');
      dom.shareUrl.select();
    }
  }

  async function nativeShare() {
    var url = await S.buildShareUrl(false);
    var shareData = {
      title: '今天吃什么',
      text: '我的食堂清单，点开就能抽 —— 今天你不用纠结了。',
      url: url
    };
    if (navigator.share) {
      try { await navigator.share(shareData); return; } catch (e) { /* 用户取消 */ }
    }
    copyLink();
  }

  async function importFromText(text, silent) {
    if (!String(text || '').trim()) { toast('先粘贴点东西进来。', 'warn'); return false; }
    try {
      var raw = await S.decodePayload(text);
      var res = S.setState(raw, null, {});
      applyTheme();
      refreshLightweight();
      renderEditor();
      renderSharePane();
      renderGalaxy();
      var st = S.get();
      if (st.last) {
        var revived = D.revive(st.last);
        if (revived) renderResult(revived, { animate: false });
      } else {
        clearResult();
      }
      if (!silent) {
        var msg = '导入成功：' + res.state.canteens.length + ' 个食堂、' + res.state.places.length + ' 个地点。';
        if (res.warnings.length) msg += ' 提示：' + res.warnings.join('；');
        toast(msg, 'ok', 4200);
      }
      return true;
    } catch (e) {
      toast('导入失败：' + e.message, 'bad', 4600);
      return false;
    }
  }

  /* ================================================================
     批量粘贴解析
     ================================================================ */
  /**
   * 支持三种写法：
   *   食堂名
   *   - 档口名
   *   食堂 > 档口
   * 行尾可以加 `@教学馆、综一` 标上「离哪近」（名字要对得上已有的地点）。
   * @returns {{list: Array, unknown: string[]}} unknown 是没认出来的地点名
   */
  function parseBulk(text) {
    var st = S.get();
    var placeByName = {};
    ((st && st.places) || []).forEach(function (p) { placeByName[p.name] = p; });

    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    var current = null;
    var unknown = [];

    function newCanteen(name) {
      return { name: name, area: '', emoji: '🍽️', tags: [], note: '', weight: 1, enabled: true, near: [], stalls: [] };
    }

    /** 把行尾的 `@地点、地点` 摘出来，返回去掉它之后的行和地点 id */
    function splitNear(line) {
      var m = line.match(/\s*@\s*(.+)$/);
      if (!m) return { line: line, near: [] };
      var ids = [];
      m[1].split(/[,，、|\/]+/).forEach(function (nm) {
        var t = nm.trim();
        if (!t) return;
        var p = placeByName[t];
        if (!p) { if (unknown.indexOf(t) === -1) unknown.push(t); return; }
        if (ids.indexOf(p.id) === -1) ids.push(p.id);
      });
      return { line: line.slice(0, m.index).trim(), near: ids };
    }

    function attachNear(near) {
      if (!near.length) return;
      if (!current) { current = newCanteen('未命名食堂'); out.push(current); }
      near.forEach(function (id) { if (current.near.indexOf(id) === -1) current.near.push(id); });
    }

    lines.forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line || line.charAt(0) === '#') return;

      var split = splitNear(line);
      line = split.line;
      if (!line) { attachNear(split.near); return; }

      // 「食堂 > 档口」形式
      if (line.indexOf('>') > 0 || line.indexOf('＞') > 0) {
        var parts = line.split(/[>＞]/);
        var cname = parts[0].trim();
        var sname = (parts[1] || '').trim();
        if (!cname) return;
        current = out.filter(function (c) { return c.name === cname; })[0];
        if (!current) { current = newCanteen(cname); out.push(current); }
        attachNear(split.near);
        if (sname) current.stalls.push({ name: sname, tags: [], price: '', note: '', enabled: true });
        return;
      }

      var isStall = /^[-*·•–]|^\d+[.、)]/.test(line);
      if (isStall) {
        var name = line.replace(/^[-*·•–]\s*|^\d+[.、)]\s*/, '').trim();
        if (!name) return;
        if (!current) { current = newCanteen('未命名食堂'); out.push(current); }
        attachNear(split.near);
        current.stalls.push({ name: name, tags: [], price: '', note: '', enabled: true });
        return;
      }

      var cname2 = line.replace(/[:：]\s*$/, '').trim();
      current = out.filter(function (c) { return c.name === cname2; })[0];
      if (!current) { current = newCanteen(cname2); out.push(current); }
      attachNear(split.near);
    });

    return { list: out.filter(function (c) { return c.name; }), unknown: unknown };
  }

  /* ================================================================
     引导
     ================================================================ */
  function showGate() {
    dom.gate.hidden = false;
    dom.body.dataset.locked = 'true';
  }

  function hideGate() {
    dom.gate.hidden = true;
    dom.body.dataset.locked = 'false';
  }

  /**
   * 重置 —— 和「清空全部」不是一回事：
   * 清空是换一份清单（这条设备、这份配置还在），重置是连身份一起换掉，
   * 抹掉本机所有数据后重新回到「第一次进来」的那道门，从头选「用示例还是自己填」。
   */
  function resetEverything() {
    if (!confirm('重置会抹掉这台设备上的一切：清单、地点、主题、统计与成就，且无法撤销。\n\n' +
                 '想留个底就先「导出 .json」或复制一条分享链接。\n\n' +
                 '确定要重新开始吗？会回到最初那道「用示例数据还是自己填」的门。')) return;

    // 地址栏里可能还挂着一条分享串，留着的话刷新就又把它导回来了
    try {
      if (global.location.hash && global.history && global.history.replaceState) {
        global.history.replaceState(null, '', global.location.pathname + global.location.search);
      }
    } catch (e) { /* 忽略 */ }

    S.resetAll();                             // 存储：状态 + 「来过」的标记，全没
    S.setTransient(global.WTE_BLANK_DATA);    // 内存里摆一份占位，等用户在门上选

    ui.origin = null;
    ui.originDirty = false;
    ui.placesOpen = false;
    closePanel('settings');
    clearResult();
    applyTheme();
    refreshLightweight();
    renderEditor();
    renderSharePane();
    setMode('where');
    showGate();
  }

  /* ================================================================
     事件
     ================================================================ */
  function bind() {
    /* ---- 顶栏 ---- */
    $('#btn-roster').addEventListener('click', function () { FX.sound.click(); openPanel('roster'); });
    $('#btn-settings').addEventListener('click', function () { FX.sound.click(); openPanel('settings'); });

    /* ---- 抽取按钮 ---- */
    var longPressTimer = null;
    dom.drawBtn.addEventListener('pointerdown', function () {
      dom.drawBtn.classList.add('is-longpress');
      longPressTimer = setTimeout(function () { dom.drawBtn.classList.add('is-busy'); }, 700);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      dom.drawBtn.addEventListener(ev, function () {
        clearTimeout(longPressTimer);
        dom.drawBtn.classList.remove('is-longpress');
      });
    });
    dom.drawBtn.addEventListener('click', function () { performDraw(ui.mode); });

    /* ---- 模式切换 ---- */
    U.$$('.mode').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
    });

    /* ---- 面板关闭 ---- */
    document.addEventListener('click', function (e) {
      var actEl = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!actEl) return;
      var act = actEl.dataset.act;
      handleAction(act, actEl, e);
    });

    /* ---- 页签 ---- */
    dom.settings.addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) switchTab(tab.dataset.tab);
    });

    /* ---- 外观控件 ---- */
    U.$$('[data-group]').forEach(function (group) {
      group.addEventListener('click', function (e) {
        var b = e.target.closest('.seg__btn');
        if (!b) return;
        var key = group.dataset.group;
        var val = b.dataset.value;
        setTheme(key === 'appearance' ? { appearance: val } : { fx: val });
        FX.sound.click();
      });
    });

    dom.themeColor.addEventListener('input', function () {
      var hex = U.normHex(dom.themeColor.value) || '#ff3d6e';
      setTheme({ primary: hex });
    });
    dom.themeSat.addEventListener('input', function () {
      if (dom.themeSatOut) dom.themeSatOut.textContent = dom.themeSat.value + '%';
      setTheme({ saturation: Number(dom.themeSat.value) });
    });
    dom.optSound.addEventListener('change', function () {
      setTheme({ sound: dom.optSound.checked });
      if (dom.optSound.checked) FX.sound.click();
    });
    dom.optAutoscroll.addEventListener('change', function () {
      setTheme({ autoScroll: dom.optAutoscroll.checked });
    });

    /* ---- 编辑器 ---- */
    dom.editorSearch.addEventListener('input', U.debounce(function () {
      ui.editorQuery = dom.editorSearch.value;
      renderEditor();
    }, 180));

    dom.editor.addEventListener('change', function (e) {
      var input = e.target;
      if (!input.dataset || !input.dataset.field) return;
      commitField(input);
    });

    dom.editor.addEventListener('submit', function (e) {
      var form = e.target.closest('.stall-add');
      if (!form) return;
      e.preventDefault();
      var cid = form.dataset.cid;
      var input = form.querySelector('input[name="stallName"]');
      var name = (input.value || '').trim();
      if (!name) return;
      S.mutate(function (st) {
        var c = st.canteens.filter(function (x) { return x.id === cid; })[0];
        if (!c) return;
        c.stalls.push({ id: U.uid('s'), name: name, tags: [], price: '', note: '', enabled: true });
      }, { noEmit: true });
      S.saveSoon();
      input.value = '';
      renderEditor();
      refreshLightweight();
      FX.sound.click();
      var target = dom.editor.querySelector('.canteen[data-cid="' + cid + '"] .stall:last-child');
      if (target) target.classList.add('is-hit');
    });

    /* ---- 出发地 ---- */
    dom.originRail.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveOrigin(1); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveOrigin(-1); return; }
      if (e.key === 'Home') {
        e.preventDefault();
        var st0 = S.get();
        if (st0) setOrigin('');
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        var st1 = S.get();
        if (st1 && st1.places.length) setOrigin(st1.places[st1.places.length - 1].id);
        return;
      }
    });

    /* ---- 地点编辑器 ---- */
    dom.places.addEventListener('change', function (e) {
      var input = e.target;
      if (!input.dataset || !input.dataset.pfield) return;
      commitField(input);
    });

    dom.places.addEventListener('submit', function (e) {
      var form = e.target.closest('.place-add');
      if (!form) return;
      e.preventDefault();
      var input = form.querySelector('input[name="placeName"]');
      var name = (input.value || '').trim();
      if (!name) return;
      var newId = U.uid('p');
      S.mutate(function (st) {
        st.places.push({ id: newId, name: name.slice(0, 30), emoji: '📍', area: '' });
      }, { noEmit: true });
      S.saveSoon();
      input.value = '';
      renderEditor();
      refreshLightweight();
      FX.sound.click();
      var row = dom.places.querySelector('.place[data-pid="' + newId + '"]');
      if (row) row.classList.add('is-hit');
    });

    /* ---- 清单搜索 ---- */
    dom.rostersearch.addEventListener('input', U.debounce(function () {
      ui.rosterQuery = dom.rostersearch.value;
      renderGalaxy();
    }, 180));

    /* ---- 导入 ---- */
    dom.importFile.addEventListener('change', function () {
      var f = dom.importFile.files && dom.importFile.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { importFromText(String(reader.result), false); };
      reader.onerror = function () { toast('文件读不出来。', 'bad'); };
      reader.readAsText(f, 'utf-8');
      dom.importFile.value = '';
    });

    /* ---- 拖拽导入 ---- */
    ['dragenter', 'dragover'].forEach(function (ev) {
      global.addEventListener(ev, function (e) {
        e.preventDefault();
        dom.body.style.outline = '2px dashed var(--brand)';
        dom.body.style.outlineOffset = '-10px';
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      global.addEventListener(ev, function (e) {
        e.preventDefault();
        dom.body.style.outline = '';
      });
    });
    global.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { importFromText(String(reader.result), false); };
      reader.readAsText(f, 'utf-8');
    });

    /* ---- 键盘 ---- */
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      if (e.key === 'Escape') {
        if (!dom.bulk.hidden) { closeBulk(); return; }
        if (!dom.settings.hidden) { closePanel('settings'); return; }
        if (!dom.roster.hidden) { closePanel('roster'); return; }
      }
      if (!dom.gate.hidden) {
        if (e.key === 'Enter') { gateSkip(); }
        return;
      }
      if (typing) return;
      if (e.code === 'Space') { e.preventDefault(); performDraw(ui.mode); return; }
      if (e.key === '1') { setMode('where'); return; }
      if (e.key === '2') { setMode('what'); return; }
      if (e.key === 's' || e.key === 'S') { openPanel('settings'); return; }
      if (e.key === 'r' || e.key === 'R') { openPanel('roster'); return; }
      if (e.key === 'g' || e.key === 'G') { if (ui.result) performFollowup(); return; }
      if (e.key === 'd' || e.key === 'D') { performDraw(ui.mode); return; }
    });

    /* ---- 彩蛋：konami ---- */
    var seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    var pos = 0;
    document.addEventListener('keydown', function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === seq[pos]) {
        pos++;
        if (pos === seq.length) { pos = 0; easterEgg(); }
      } else {
        pos = k === seq[0] ? 1 : 0;
      }
    });

    global.addEventListener('resize', U.debounce(function () {
      renderOrbit();
      if (!dom.roster.hidden) renderGalaxy();
    }, 240));

    global.addEventListener('hashchange', function () { tryHash(); });
    global.addEventListener('beforeunload', function () { S.save(); });
  }

  function setMode(mode) {
    ui.mode = mode === 'what' ? 'what' : 'where';
    U.$$('.mode').forEach(function (b) {
      var on = b.dataset.mode === ui.mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (dom.drawLabel && !ui.busy) dom.drawLabel.textContent = ui.mode === 'what' ? '抽档口' : '抽食堂';
    if (dom.coreVerdict && !ui.busy && !ui.result) {
      dom.coreVerdict.textContent = ui.mode === 'what' ? '去哪吃？' : '吃什么？';
    }
  }

  function commitField(input) {
    var cid = input.dataset.cid;
    var pid = input.dataset.pid;
    var sid = input.dataset.sid;
    var field = input.dataset.field;
    var pfield = input.dataset.pfield;
    var value = input.value;

    /* ---- 地点的字段 ---- */
    if (pfield) {
      S.mutate(function (st) {
        var p = st.places.filter(function (x) { return x.id === pid; })[0];
        if (!p) return;
        if (pfield === 'emoji') p.emoji = value.trim().slice(0, 4) || '📍';
        else if (pfield === 'name') p.name = value.trim().slice(0, 30) || p.name;
        else p[pfield] = value.slice(0, 60);
      }, { noEmit: true });
      S.saveSoon();
      var p2 = S.findPlace(pid);
      if (p2) input.value = pfield === 'name' ? p2.name : (p2[pfield] || '');
      renderOrigin(false);
      renderBar();
      if (pfield === 'name') renderEditor();
      return;
    }

    S.mutate(function (st) {
      var c = st.canteens.filter(function (x) { return x.id === cid; })[0];
      if (!c) return;
      if (sid) {
        var s = c.stalls.filter(function (x) { return x.id === sid; })[0];
        if (!s) return;
        if (field === 'tags') s.tags = splitTags(value);
        else if (field === 'name') s.name = value.trim().slice(0, 60) || s.name;
        else s[field] = value.slice(0, 24);
      } else {
        if (field === 'tags') c.tags = splitTags(value);
        else if (field === 'emoji') c.emoji = (value.trim().slice(0, 4) || '🍽️');
        else if (field === 'name') c.name = value.trim().slice(0, 60) || c.name;
        else c[field] = value.slice(0, 200);
      }
    }, { noEmit: true });
    S.saveSoon();

    // 回填（名称被清空时 store 会保留旧值）
    var c2 = S.findCanteen(cid);
    if (!c2) return;
    if (sid) {
      var s2 = c2.stalls.filter(function (x) { return x.id === sid; })[0];
      if (s2) input.value = field === 'tags' ? (s2.tags || []).join(',') : (s2[field] || '');
    } else {
      input.value = field === 'tags' ? (c2.tags || []).join(', ') : (c2[field] || '');
      var card = dom.editor.querySelector('.canteen[data-cid="' + cid + '"]');
      if (card) {
        var nameEl = card.querySelector('.canteen__name');
        var subEl = card.querySelector('.canteen__sub');
        var emojiEl = card.querySelector('.canteen__emoji');
        if (nameEl) nameEl.textContent = c2.name;
        if (emojiEl) emojiEl.textContent = c2.emoji || '🍽️';
        if (subEl) {
          subEl.textContent = canteenSub(c2);
        }
      }
    }
    refreshLightweight();
  }

  function handleAction(act, el, evt) {
    var cid = el.dataset.cid, sid = el.dataset.sid;

    switch (act) {
      /* 关闭 */
      case 'close-settings': closePanel('settings'); return;
      case 'close-roster': closePanel('roster'); return;
      case 'close-bulk': closeBulk(); return;

      /* 引导 */
      case 'gate-skip': gateSkip(); return;
      case 'gate-custom': gateCustom(); return;

      /* 外观 */
      case 'theme-preset': setTheme({ primary: U.normHex(el.dataset.color) }); FX.sound.click(); return;
      case 'theme-random': {
        var hex = U.hslToHex(Math.round(U.rand() * 360), 70 + Math.round(U.rand() * 30), 60);
        setTheme({ primary: hex });
        FX.confettiRain(1200);
        FX.sound.click();
        return;
      }

      /* 出发地 */
      case 'set-origin': setOrigin(el.dataset.pid || ''); return;
      case 'toggle-places':
        ui.placesOpen = !ui.placesOpen;
        renderPlaces();
        FX.sound.click();
        return;
      case 'add-place': {
        var newPid = U.uid('p');
        S.mutate(function (st) {
          st.places.push({ id: newPid, name: '新地点', emoji: '📍', area: '' });
        }, { noEmit: true });
        S.saveSoon();
        ui.placesOpen = true;
        renderEditor(); refreshLightweight();
        var prow = dom.places.querySelector('.place[data-pid="' + newPid + '"]');
        if (prow) {
          prow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var pinp = prow.querySelector('input[data-pfield="name"]');
          if (pinp) { pinp.focus(); pinp.select(); }
        }
        return;
      }
      case 'place-del': {
        var pu = S.placeUsage(el.dataset.pid);
        var pnameOf = S.findPlace(el.dataset.pid);
        if (!confirm('删除地点「' + (pnameOf ? pnameOf.name : '') + '」？' +
          (pu ? '\n有 ' + pu + ' 个食堂标了「离它近」，这些标记会一起清掉。' : ''))) return;
        S.mutate(function (st) {
          st.places = st.places.filter(function (p) { return p.id !== el.dataset.pid; });
          st.canteens.forEach(function (c) {
            c.near = (c.near || []).filter(function (id) { return id !== el.dataset.pid; });
          });
          if (st.origin === el.dataset.pid) st.origin = null;
        }, { noEmit: true });
        S.save();
        renderEditor(); refreshLightweight();
        toast('地点已删除。', 'ok');
        return;
      }
      case 'place-up':
      case 'place-down': {
        var pdir = act === 'place-up' ? -1 : 1;
        S.mutate(function (st) {
          var i = -1;
          st.places.forEach(function (p, idx) { if (p.id === el.dataset.pid) i = idx; });
          var j = i + pdir;
          if (i < 0 || j < 0 || j >= st.places.length) return;
          var tmp = st.places[i];
          st.places[i] = st.places[j];
          st.places[j] = tmp;
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        return;
      }
      case 'toggle-near': {
        var nearby = S.findPlace(el.dataset.pid);
        if (!nearby) return;
        S.mutate(function (st) {
          var c = st.canteens.filter(function (x) { return x.id === cid; })[0];
          if (!c) return;
          if (!Array.isArray(c.near)) c.near = [];
          var k = c.near.indexOf(el.dataset.pid);
          if (k >= 0) c.near.splice(k, 1);
          else c.near.push(el.dataset.pid);
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        FX.sound.click();
        return;
      }

      /* 编辑器 */
      case 'add-canteen': {
        var newId = U.uid('c');
        S.mutate(function (st) {
          st.canteens.push({
            id: newId, name: '新食堂', area: '', emoji: '🍽️', tags: [], note: '',
            weight: 1, enabled: true, near: [], stalls: []
          });
        }, { noEmit: true });
        S.saveSoon();
        ui.openIds[newId] = true;
        ui.editorQuery = '';
        if (dom.editorSearch) dom.editorSearch.value = '';
        renderEditor();
        refreshLightweight();
        var a = S.unlock('editor');
        if (a) showAchievement(a);
        var card = dom.editor.querySelector('.canteen[data-cid="' + newId + '"]');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var inp = card.querySelector('input[data-field="name"]');
          if (inp) { inp.focus(); inp.select(); }
        }
        return;
      }
      case 'canteen-toggle':
        ui.openIds[cid] = !ui.openIds[cid];
        renderEditor();
        return;
      case 'canteen-toggle-enabled':
        S.mutate(function (st) {
          var c = st.canteens.filter(function (x) { return x.id === cid; })[0];
          if (c) c.enabled = !c.enabled;
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        if (!dom.roster.hidden) renderGalaxy();
        return;
      case 'canteen-up':
      case 'canteen-down': {
        var dir = act === 'canteen-up' ? -1 : 1;
        S.mutate(function (st) {
          var i = -1;
          st.canteens.forEach(function (c, idx) { if (c.id === cid) i = idx; });
          var j = i + dir;
          if (i < 0 || j < 0 || j >= st.canteens.length) return;
          var tmp = st.canteens[i];
          st.canteens[i] = st.canteens[j];
          st.canteens[j] = tmp;
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        return;
      }
      case 'canteen-del':
        if (!confirm('删除这个食堂以及它的所有档口？')) return;
        S.mutate(function (st) {
          st.canteens = st.canteens.filter(function (c) { return c.id !== cid; });
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        if (!dom.roster.hidden) renderGalaxy();
        toast('已删除。', 'ok');
        return;
      case 'set-weight':
        S.mutate(function (st) {
          var c = st.canteens.filter(function (x) { return x.id === cid; })[0];
          if (c) c.weight = Number(el.dataset.weight) || 1;
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        return;
      case 'stall-toggle':
        S.mutate(function (st) {
          var c = st.canteens.filter(function (x) { return x.id === cid; })[0];
          if (!c) return;
          var s = c.stalls.filter(function (x) { return x.id === sid; })[0];
          if (s) s.enabled = !s.enabled;
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        return;
      case 'stall-del':
        S.mutate(function (st) {
          var c = st.canteens.filter(function (x) { return x.id === cid; })[0];
          if (c) c.stalls = c.stalls.filter(function (x) { return x.id !== sid; });
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        return;
      case 'toggle-all': {
        var anyOn = S.stats().enabledCanteens > 0;
        S.mutate(function (st) {
          st.canteens.forEach(function (c) {
            c.enabled = !anyOn;
            c.stalls.forEach(function (s) { s.enabled = !anyOn; });
          });
        }, { noEmit: true });
        S.saveSoon();
        renderEditor(); refreshLightweight();
        if (!dom.roster.hidden) renderGalaxy();
        toast(anyOn ? '已全部停用。' : '已全部启用。', 'ok');
        return;
      }
      case 'collapse-all':
        ui.openIds = {};
        renderEditor();
        return;
      case 'open-bulk':
        dom.bulk.hidden = false;
        dom.bulkText.focus();
        return;
      case 'apply-bulk': {
        var parsed = parseBulk(dom.bulkText.value);
        if (!parsed.list.length) { toast('没解析出任何食堂，检查一下格式。', 'warn'); return; }
        var replace = dom.bulkReplace.checked;
        S.mutate(function (st) {
          // 带上 places 一起规范化，否则行尾写的 @地点 会被当成「不存在的地点」丢掉
          var mapped = parsed.list.map(function (c) {
            return S.normalize({ places: st.places, canteens: [c] }).state.canteens[0];
          });
          st.canteens = replace ? mapped : st.canteens.concat(mapped);
        }, { noEmit: true });
        S.saveSoon();
        closeBulk();
        renderEditor(); refreshLightweight(); renderSharePane(); renderOrigin(false);
        if (!dom.roster.hidden) renderGalaxy();
        var bmsg = '已导入 ' + parsed.list.length + ' 个食堂。';
        if (parsed.unknown.length) bmsg += ' 这几个地点没对上（先在地点列表里加）：' + parsed.unknown.slice(0, 6).join('、');
        toast(bmsg, parsed.unknown.length ? 'warn' : 'ok', 4600);
        return;
      }

      /* 数据 */
      case 'copy-link': copyLink(); return;
      case 'copy-json':
        U.copyText(S.toJSON(false)).then(function (ok) {
          toast(ok ? 'JSON 已复制。' : '复制失败。', ok ? 'ok' : 'bad');
        });
        return;
      case 'share-native': nativeShare(); return;
      case 'import-text':
        importFromText(dom.importText.value).then(function (ok) { if (ok) dom.importText.value = ''; });
        return;
      case 'import-file': dom.importFile.click(); return;
      case 'export-json':
        U.download('吃什么配置-' + U.stamp() + '.json', S.toJSON(true));
        toast('已导出 .json。', 'ok');
        return;
      case 'export-md':
        exportMarkdown();
        return;
      case 'load-demo':
        if (!confirm('用大工示例数据覆盖当前清单？当前数据会被替换。')) return;
        S.resetTo(global.WTE_DEFAULT_DATA);
        afterDataReplace('已载入大工示例数据。');
        return;
      case 'clear-all':
        if (!confirm('清空全部清单和设置（包括地点）？这个操作不可撤销。')) return;
        S.mutate(function (st) {
          st.canteens = [];
          st.places = [];
          st.origin = null;
          st.last = null;
          st.stats.draws = 0;
          st.stats.modes = { where: 0, what: 0 };
          st.stats.achievements = [];
        }, { noEmit: true });
        S.save();
        afterDataReplace('已清空，去「食堂与档口」页签填自己的清单吧。');
        return;
      case 'reset-all':
        resetEverything();
        return;

      /* 结果 */
      case 'draw-again': performDraw(ui.mode); return;
      case 'followup': performFollowup(); return;
      case 'reroll': reroll(el.dataset.role); return;
      case 'share-this': shareThis(); return;
      case 'open-roster': openPanel('roster'); return;

      /* 轨道 / 星系 */
      case 'orbit-node':
        openPanel('roster');
        global.setTimeout(function () {
          var node = dom.galaxy.querySelector('.node[data-id="' + el.dataset.id + '"]');
          if (node) {
            U.$$('.node', dom.galaxy).forEach(function (n) { n.classList.remove('is-open'); });
            node.classList.add('is-open');
            node.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 60);
        return;
      case 'galaxy-node':
        var open = el.classList.toggle('is-open');
        if (open) {
          U.$$('.node', dom.galaxy).forEach(function (n) { if (n !== el) n.classList.remove('is-open'); });
        }
        return;
      default:
        return;
    }
  }

  function afterDataReplace(msg) {
    applyTheme();
    refreshLightweight();
    renderEditor();
    renderSharePane();
    if (!dom.roster.hidden) renderGalaxy();
    var st = S.get();
    if (st && st.last) {
      var revived = D.revive(st.last);
      if (revived) { renderResult(revived, { animate: false }); }
      else clearResult();
    } else {
      clearResult();
    }
    toast(msg, 'ok', 3200);
  }

  function closeBulk() {
    dom.bulk.hidden = true;
  }

  function exportMarkdown() {
    var st = S.get();
    if (!st) return;
    var lines = ['# ' + (st.meta.title || '今天吃什么') + ' · 食堂清单', ''];
    if (st.meta.source) lines.push('> ' + st.meta.source, '');
    lines.push('共 ' + st.canteens.length + ' 个食堂。', '');
    if (st.places.length) {
      lines.push('## 地点（出发地）', '');
      st.places.forEach(function (p) {
        lines.push('- ' + p.emoji + ' ' + p.name + (p.area ? ' — ' + p.area : ''));
      });
      lines.push('');
    }
    st.canteens.forEach(function (c) {
      lines.push('## ' + (c.emoji || '') + ' ' + c.name + (c.enabled ? '' : '（已停用）'));
      if (c.area) lines.push('*' + c.area + '*');
      var nearNames = (c.near || []).map(function (id) {
        var p = S.findPlace(id);
        return p ? p.name : null;
      }).filter(Boolean);
      if (nearNames.length) lines.push('离 ' + nearNames.join('、') + ' 近');
      if (c.tags && c.tags.length) lines.push('`' + c.tags.join('` `') + '`');
      if (c.note) lines.push('> ' + c.note);
      lines.push('');
      if (c.stalls.length) {
        c.stalls.forEach(function (s) {
          lines.push('- ' + s.name + (s.price ? '（' + s.price + '）' : '') +
            (s.tags && s.tags.length ? ' — ' + s.tags.join('、') : '') +
            (s.enabled ? '' : ' ~~已停用~~'));
        });
      } else {
        lines.push('- （还没填档口）');
      }
      lines.push('');
    });
    lines.push('---', '', '由「今天吃什么」导出 · ' + U.formatTime(Date.now()));
    U.download('食堂清单-' + U.stamp() + '.md', lines.join('\n'), 'text/markdown;charset=utf-8');
    toast('已导出 Markdown 清单。', 'ok');
  }

  function gateSkip() {
    S.resetTo(global.WTE_DEFAULT_DATA);
    S.markSeen();
    hideGate();
    bootstrapAfterGate('已经载入大工示例，随时可以在控制台里改。');
  }

  function gateCustom() {
    S.resetTo(global.WTE_BLANK_DATA);
    S.markSeen();
    hideGate();
    bootstrapAfterGate('空白清单已就绪，先给自己的食堂起个名字吧。');
    global.setTimeout(function () { openPanel('settings'); switchTab('data'); }, 260);
  }

  function bootstrapAfterGate(msg) {
    applyTheme();
    refreshLightweight();
    renderEditor();
    renderSharePane();
    setMode(ui.mode);
    if (msg) toast(msg, 'ok', 4000);
  }

  function easterEgg() {
    FX.confettiRain(4200);
    FX.sound.fanfare();
    dom.body.classList.add('is-shaking');
    global.setTimeout(function () { dom.body.classList.remove('is-shaking'); }, 560);
    toast('🥠 隐藏菜单已解锁：食堂之神会保佑你的下一顿。', 'ok', 5200);
    for (var i = 0; i < 5; i++) {
      global.setTimeout(function () {
        FX.burst(U.rand() * global.innerWidth, global.innerHeight * (0.25 + U.rand() * 0.4), { count: 60 });
      }, i * 180);
    }
  }

  /* ================================================================
     启动
     ================================================================ */
  async function tryHash() {
    var code = S.readShareFromHash();
    if (!code) return false;
    var ok = await importFromText('#c=' + code, true);
    if (ok) {
      S.markSeen();
      hideGate();
      applyTheme();
      refreshLightweight();
      renderEditor();
      toast('已通过分享链接载入配置。', 'ok', 3600);
    } else {
      toast('分享链接解析失败，已改为首次进入流程。', 'bad', 4000);
    }
    return ok;
  }

  function init() {
    cache();
    FX.bindDom({ shock: dom.shock, flash: dom.flash });
    FX.init($('#fx-bg'));
    FX.bindCursor(dom.cursor);
    S.subscribe(function (evt) {
      if (evt && evt.type === 'save-error') {
        toast('本地保存失败（可能是存储空间不足或隐私模式），数据只在本次会话有效。', 'bad', 6000);
      }
    });

    // 先尝试从分享链接载入
    var hadStored = S.hasStored();
    var hadSeen = S.seen();
    var fromHash = tryHash();

    // 本地数据
    S.load(global.WTE_DEFAULT_DATA ? global.WTE_DEFAULT_DATA.meta : null);
    if (!S.get()) {
      // 没有任何数据：先装一份空白占位，等 hash 结果 / 引导决定真正要什么
      S.setTransient(global.WTE_BLANK_DATA);
    }

    applyTheme();
    refreshLightweight();
    setMode('where');

    var st = S.get();
    if (st && st.last) {
      var revived = D.revive(st.last);
      if (revived) renderResult(revived, { animate: false });
    }

    bind();

    fromHash.then(function (used) {
      if (used) return;
      if (!hadStored && !hadSeen) {
        showGate();
      } else if (!hadStored) {
        // 用过但数据没了（清了缓存）—— 直接给默认示例，不再打断
        S.resetTo(global.WTE_DEFAULT_DATA);
        bootstrapAfterGate('');
      }
    });

    dom.body.dataset.boot = 'ready';
  }

  WTE.ui = {
    init: init,
    applyTheme: applyTheme,
    renderBar: renderBar,
    renderOrbit: renderOrbit,
    renderOrigin: renderOrigin,
    renderPlaces: renderPlaces,
    setOrigin: setOrigin,
    moveOrigin: moveOrigin,
    renderEditor: renderEditor,
    renderGalaxy: renderGalaxy,
    renderResult: renderResult,
    renderSharePane: renderSharePane,
    clearResult: clearResult,
    setMode: setMode,
    resetEverything: resetEverything,
    openPanel: openPanel,
    closePanel: closePanel,
    toast: toast,
    showAchievement: showAchievement,
    performDraw: performDraw,
    parseBulk: parseBulk,
    state: ui
  };
})(window);
