#!/usr/bin/env node
/**
 * 冒烟测试：用本机 Edge / Chrome 的无头模式跑 tools/smoke/drive.html，
 * 把页面里打印的断言抓出来。零依赖，只用 Node 内置模块。
 *
 * 前置：
 *   1) 在仓库根目录起一个静态服务器： python -m http.server 8765
 *   2) node tools/smoke/run.js <step...>        单个/多个步骤
 *      node tools/smoke/run.js --all            全部步骤
 *      node tools/smoke/run.js draw-where --keep 保留截图，否则只打印断言
 *
 * 退出码：全部通过为 0，有步骤抛异常为 1。
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.smoke-out');

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:8765';
const BUDGET = process.env.SMOKE_BUDGET || '25000';
const SIZE = process.env.SMOKE_SIZE || '1440,900';

const STEPS = [
  'gate', 'home', 'draw-where', 'draw-what', 'follow',
  'origin', 'origin-what', 'origin-tight', 'origin-narrow',
  'places', 'legacy',
  'editor', 'roster', 'share', 'bulk', 'theme', 'switches',
  'import', 'badimport', 'empty',
  'galaxy', 'galaxy-narrow', 'galaxy-many'
];

// 需要模拟窄屏的步骤 → iframe 宽度(px)
const STEP_VW = { 'galaxy-narrow': 430, 'origin-narrow': 430 };

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

function findBrowser() {
  for (const p of CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 忽略 */ }
  }
  for (const name of ['msedge', 'google-chrome', 'chromium', 'chrome']) {
    try {
      const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
      const first = which.split(/\r?\n/).filter(Boolean)[0];
      if (first && fs.existsSync(first.trim())) return first.trim();
    } catch (e) { /* 继续找 */ }
  }
  return null;
}

function runOnce(browser, args) {
  try {
    return execFileSync(browser, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return e.stdout ? e.stdout.toString('utf8') : '';
  }
}

function profileDir(tag) {
  const dir = path.join(os.tmpdir(), 'wte-smoke-' + tag + '-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extractLog(dom) {
  const m = dom.match(/<pre id="drivelog">([\s\S]*?)<\/pre>/);
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function runStep(browser, step, keep) {
  const vw = STEP_VW[step] ? '&vw=' + STEP_VW[step] : '';
  const url = BASE + '/tools/smoke/drive.html?step=' + encodeURIComponent(step) + '&scroll=1&fx=off' + vw;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--window-size=' + SIZE, '--virtual-time-budget=' + BUDGET
  ];

  const dom = runOnce(browser, common.concat(['--user-data-dir=' + profileDir(step), '--dump-dom', url]));
  let log = extractLog(dom);

  if (keep) {
    fs.mkdirSync(OUT, { recursive: true });
    const shot = path.join(OUT, step + '.png');
    // 截图那次多带一个 nolog=1，让驱动器跑完后把调试浮层藏掉
    runOnce(browser, common.concat(['--user-data-dir=' + profileDir(step + '-shot'), '--screenshot=' + shot, url + '&nolog=1']));
    fs.writeFileSync(path.join(OUT, step + '.log.txt'), (log || '(no log)') + '\n', 'utf8');
  }

  return log;
}

/* ---- 持久化验证：同一 profile 连开两次 ----
   第一次跑 origin 步骤（会选中教学馆作为出发地并落盘），
   第二次以 reload 步骤重开，断言食堂 / 地点 / 出发地都还在。 */
function runPersist(browser, keep) {
  const profile = profileDir('persist');
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--window-size=' + SIZE, '--virtual-time-budget=' + BUDGET,
    '--user-data-dir=' + profile
  ];
  runOnce(browser, common.concat(['--dump-dom', BASE + '/tools/smoke/drive.html?step=origin&fx=off']));
  const dom = runOnce(browser, common.concat(['--dump-dom', BASE + '/tools/smoke/drive.html?step=reload&fx=off&expect=p-jxg']));
  const log = extractLog(dom);
  if (keep && log) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'persist.log.txt'), log + '\n', 'utf8');
  }
  return log;
}

/* ---- 主流程 ---- */
const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const targets = argv.includes('--all') ? STEPS.concat(['persist'])
  : argv.filter((a) => a.charAt(0) !== '-');

if (!targets.length) {
  console.log('用法： node tools/smoke/run.js <step...>|--all [--keep]');
  console.log('可用： ' + STEPS.concat(['persist']).join(', '));
  process.exit(2);
}

const browser = findBrowser();
if (!browser) {
  console.error('找不到 Edge / Chrome。可以设置环境变量 EDGE_PATH 指向浏览器可执行文件。');
  process.exit(2);
}
console.log('浏览器： ' + browser);
console.log('目标： ' + BASE + '  （先确认静态服务器已启动）\n');

let failed = 0;
for (const step of targets) {
  const log = step === 'persist' ? runPersist(browser, keep) : runStep(browser, step, keep);
  const ok = log && !/EXCEPTION/.test(log) && !/err=(?!-)/.test(log) && !/VERDICT=(?!OK)/.test(log);
  if (!ok) failed++;
  console.log('───── ' + step + ' : ' + (ok ? 'OK' : 'FAIL') + ' ─────');
  console.log(log || '(没有拿到断言输出)');
  console.log('');
}

console.log(failed ? (failed + ' 个步骤失败') : '全部步骤通过');
process.exit(failed ? 1 : 0);
