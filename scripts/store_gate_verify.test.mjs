import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segs) => readFileSync(path.join(ROOT, ...segs), 'utf8');

const cjs = { exports: {} };
vm.runInNewContext(read('public', 'store_gate_v1.0.js'), {
  URL,
  module: cjs,
  exports: cjs.exports,
});
const gate = cjs.exports;

function makeMockEnv({
  referrer = '',
  inIframe = false,
  standalone = false,
  navigatorStandalone = false,
  storageThrows = false,
  lang = 'zh-HK',
  selfOrigin = 'https://drawtheroute-yd8p.vercel.app',
} = {}) {
  const store = new Map();
  const makeElement = (tag) => {
    const attrs = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      href: '',
      target: '',
      rel: '',
      hidden: false,
      children: [],
      get firstChild() {
        return this.children[0] || null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') this.id = String(v);
        if (k === 'hidden') this.hidden = true;
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'hidden') this.hidden = false;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        return child;
      },
    };
    return el;
  };

  const html = makeElement('html');
  if (lang) html.setAttribute('lang', lang);
  const head = makeElement('head');
  const body = makeElement('body');
  html.appendChild(head);
  html.appendChild(body);

  const findById = (node, id) => {
    if (node.id === id) return node;
    for (const ch of node.children) {
      const hit = findById(ch, id);
      if (hit) return hit;
    }
    return null;
  };

  const doc = {
    referrer,
    documentElement: html,
    head,
    body,
    createElement: makeElement,
    getElementById(id) {
      return findById(html, id);
    },
    addEventListener() {},
  };

  const timers = [];
  const win = {
    document: doc,
    navigator: { standalone: navigatorStandalone, serviceWorker: { ready: true } },
    matchMedia(q) {
      return { matches: q === '(display-mode: standalone)' && standalone };
    },
    localStorage: {
      getItem(k) {
        if (storageThrows) throw new Error('SecurityError: storage disabled');
        return store.has(k) ? store.get(k) : null;
      },
      setItem(k, v) {
        if (storageThrows) throw new Error('SecurityError: storage disabled');
        store.set(k, String(v));
      },
    },
    sessionStorage: {
      getItem(k) {
        if (storageThrows) throw new Error('SecurityError: storage disabled');
        return store.has(k) ? store.get(k) : null;
      },
      setItem(k, v) {
        if (storageThrows) throw new Error('SecurityError: storage disabled');
        store.set(k, String(v));
      },
    },
    location: {
      origin: selfOrigin,
      replacedWith: null,
      replace(u) {
        this.replacedWith = u;
      },
    },
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
  };
  win.self = win;
  win.top = inIframe ? { location: win.location } : win;

  return { win, doc, store, timers };
}

test('驗收 1：由 APP STORE 撳入 → 正常放行，乜都唔彈', () => {
  const env = makeMockEnv({ referrer: 'https://scoutappstore.vercel.app/' });
  const res = gate.initStoreGate({
    appKey: 'drawtheroute',
    mode: 'entry-gate',
    portalIds: ['appstore'],
    silentPortalIds: ['library'],
    allowStandalone: true,
  }, env.win);
  assert.equal(res.allowed, true);
  assert.equal(res.matchedPortalId, 'appstore');
  assert.equal(env.doc.getElementById('scoutStoreGate'), null);
});

test('驗收 2：由圖書館撳入 → 正常放行（matchedPortalId: library）', () => {
  const env = makeMockEnv({ referrer: 'https://scout-circulars.vercel.app/' });
  const res = gate.initStoreGate({
    appKey: 'drawtheroute',
    mode: 'entry-gate',
    portalIds: ['appstore'],
    silentPortalIds: ['library'],
    allowStandalone: true,
  }, env.win);
  assert.equal(res.allowed, true);
  assert.equal(res.matchedPortalId, 'library');
  assert.equal(env.doc.getElementById('scoutStoreGate'), null);
});

test('驗收 3：直接打網址 → 只有 1 粒 APP STORE 掣（唔會 404、唔會白屏）', () => {
  const env = makeMockEnv({ referrer: '' });
  const res = gate.initStoreGate({
    appKey: 'drawtheroute',
    mode: 'entry-gate',
    portalIds: ['appstore'],
    silentPortalIds: ['library'],
    allowStandalone: true,
  }, env.win);
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'missing-whitelist-entry');

  const dialog = env.doc.getElementById('scoutStoreGate');
  assert.ok(dialog, '必須渲染提示卡');
  const actions = dialog.children.find((c) => c.className === 'sg-actions');
  assert.equal(actions.children.length, 1, '只有 1 粒掣');
  assert.equal(actions.children[0].href, 'https://scoutappstore.vercel.app/');
  assert.equal(actions.children[0].textContent, '前往 APP STORE');
});

test('驗收 4：已加入主畫面（standalone PWA）→ 撳 icon 直接入到', () => {
  const envAndroid = makeMockEnv({ referrer: '', standalone: true });
  const resAndroid = gate.initStoreGate({
    appKey: 'drawtheroute',
    mode: 'entry-gate',
    portalIds: ['appstore'],
    silentPortalIds: ['library'],
    allowStandalone: true,
  }, envAndroid.win);
  assert.equal(resAndroid.allowed, true);
  assert.equal(resAndroid.reason, 'standalone-pwa');

  const envIos = makeMockEnv({ referrer: '', navigatorStandalone: true });
  const resIos = gate.initStoreGate({
    appKey: 'drawtheroute',
    mode: 'entry-gate',
    portalIds: ['appstore'],
    silentPortalIds: ['library'],
    allowStandalone: true,
  }, envIos.win);
  assert.equal(resIos.allowed, true);
  assert.equal(resIos.reason, 'standalone-pwa');
});

test('驗收 5：SG18 掣 → 開新分頁，落到該 App 詳情卡', () => {
  const url = gate.getAppStoreUrl('drawtheroute');
  assert.equal(url, 'https://scoutappstore.vercel.app/?app=drawtheroute');

  const idx = read('index.html');
  assert.ok(idx.includes('id="storeSupportTop"'), 'index.html 必須有 id="storeSupportTop"');
  assert.ok(idx.includes('target="_blank"'), '必須開新分頁');
  assert.ok(idx.includes('rel="noopener"'), '必須有 rel="noopener"');
  assert.ok(idx.includes("ScoutStoreGate.getAppStoreUrl('drawtheroute')"), '必須動態組出正確 slug 網址');
});

test('驗收 6：SG18 掣喺 ScoutStoreGate 未載入時保持隱藏', () => {
  const idx = read('index.html');
  // 元素預設帶 hidden 屬性
  assert.match(idx, /<a id="storeSupportTop"[^>]*\bhidden\b/);
  // CSS 明確設定 [hidden] { display: none !important; }
  assert.ok(idx.includes('.support-btn[hidden]'), '必須有 .support-btn[hidden] 規則');
});

test('驗收 7：有列印 → 掣被隱藏', () => {
  const idx = read('index.html');
  assert.ok(idx.includes('@media print'), '必須有 @media print 規則');
  const css = read('src', 'index.css');
  assert.ok(css.includes('@media print'), 'src/index.css 也必須有 @media print 規則');
});

test('驗收 8：窄屏 360／430px 唔爆版', () => {
  const idx = read('index.html');
  assert.ok(idx.includes('@media (max-width: 430px)'), 'index.html 必須有 430px 響應式規則');
  const css = read('src', 'index.css');
  assert.ok(css.includes('@media (max-width: 430px)'), 'src/index.css 也必須有 430px 響應式規則');
});

test('驗收 9：發佈根目錄與檔案完整性', () => {
  assert.ok(existsSync(path.join(ROOT, 'public', 'store_gate_v1.0.js')), 'public/store_gate_v1.0.js 必須存在');
  assert.ok(existsSync(path.join(ROOT, 'dist', 'store_gate_v1.0.js')), 'dist/store_gate_v1.0.js 必須存在於 build 輸出');
});
