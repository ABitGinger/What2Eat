/*!
 * app.js —— 启动入口
 * 只做三件事：立刻启动 UI（本文件是最后一个脚本，所需的 DOM 已经解析完）、
 * 把启动期异常显示成一张可读的错误卡、顺带把错误信息留在 body[data-error] 上便于排查。
 */
(function (global) {
  'use strict';

  var reported = 0;

  function showFatal(err) {
    var host = document.getElementById('result');
    var msg = err && err.message ? err.message : String(err);
    var stack = err && err.stack ? String(err.stack).split('\n').slice(0, 4).join('  ⟶  ') : '';
    try { document.body.dataset.error = msg.slice(0, 220); } catch (x) { /* 忽略 */ }
    if (!host) return;
    host.hidden = false;
    host.innerHTML =
      '<div class="result__inner"><div class="pick pick--primary">' +
      '<span class="pick__badge">出错了</span>' +
      '<h3 class="pick__name">页面没能启动</h3>' +
      '<p class="pick__meta"><span>😵 ' + msg + '</span></p>' +
      (stack ? '<p class="pick__note">' + stack + '</p>' : '') +
      '<p class="pick__note">换新版 Chrome / Edge / Safari / Firefox 试试；' +
      '用 file:// 打开的话，也可以改成起一个本地服务器（见 README）。</p>' +
      '</div></div>';
  }

  function reportError(err) {
    if (reported > 2 || !err) return;
    reported++;
    if (global.console && console.error) console.error(err);
    showFatal(err instanceof Error ? err : new Error(String((err && err.message) || err)));
  }

  global.addEventListener('error', function (e) { reportError(e.error || e.message); });
  global.addEventListener('unhandledrejection', function (e) { reportError(e.reason); });

  function boot() {
    if (!global.WTE || !global.WTE.ui || !global.WTE.store || !global.WTE.draw) {
      try { document.body.dataset.boot = 'error'; } catch (x) { /* 忽略 */ }
      showFatal(new Error('脚本没有全部加载成功'));
      return;
    }
    try {
      global.WTE.ui.init();
      document.body.dataset.boot = 'ready';
    } catch (err) {
      try { document.body.dataset.boot = 'error'; } catch (x) { /* 忽略 */ }
      if (global.console && console.error) console.error(err);
      showFatal(err);
    }
  }

  /**
   * 本文件是最后一个脚本且位于 </body> 之前，需要操作的节点都已解析完成，
   * 所以直接启动 —— 少一次事件等待，也避免首屏闪一下「正在装载…」。
   */
  function domReadyEnough() {
    return !!(document.getElementById('stage') && document.getElementById('btn-draw'));
  }

  if (domReadyEnough()) {
    boot();
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
