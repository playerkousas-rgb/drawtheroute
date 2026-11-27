// Embed bridge hook 整合測試（jsdom + React Testing Library，模擬 Canvas parent）
// 用法: npx tsx --test scripts/bridge_embed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const ORIGIN = 'http://localhost:5173';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: ORIGIN + '/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
global.HTMLElement = dom.window.HTMLElement;
global.MessageEvent = dom.window.MessageEvent;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { render, act } = await import('@testing-library/react');
const { useEmbedBridge } = await import('../src/bridge/embedBridge.ts');
const { CHANNEL, PROTOCOL_VERSION } = await import('../src/bridge/contract.ts');

const NAISMITH = { baseSpeedKmh: 3.5, ascentPer20m: 7, descentPer20m: 2 };

// mock engine：每條 leg 回 1km、爬升 20m 嘅假路段（真實 analyzeRoute 會重算）
function mockPlanRoute(snapped = true) {
  return async (points) => {
    const segments = [], legMeta = [];
    for (let i = 0; i < points.length - 1; i++) {
      const pts = [
        { lat: points[i].lat, lng: points[i].lng, elevation: 10, distanceFromStart: 0 },
        { lat: points[i + 1].lat, lng: points[i + 1].lng, elevation: 30, distanceFromStart: 1.0 },
      ];
      segments.push({ id: 'seg' + i, points: pts, mode: snapped ? 'auto' : 'straight', distance: 1.0, ascent: 20, descent: 0 });
      legMeta.push({ snapped, snappedLegs: snapped ? 1 : 0, totalLegs: 1 });
    }
    return { segments, legMeta };
  };
}

const plan = () => ({
  days: 1, targetTotalKm: 2,
  start: { label: 'A', lat: 22.4, lon: 114.3 },
  waypoints: [
    { id: 'b', label: 'B', lat: 22.41, lon: 114.31, role: 'cp' },
    { id: 'c', label: 'C', lat: 22.42, lon: 114.32, role: 'finish' },
  ],
  stages: [{ day: 1, from: 'start', to: 'b' }, { day: 1, from: 'b', to: 'c' }],
  constraints: { targetDistanceToleranceKm: 1 },
});

function setup(snapped = true, captureMap = undefined) {
  const sent = [];
  dom.window.__DTR_EMBED__ = { parentOrigin: ORIGIN };
  dom.window.postMessage = (msg, targetOrigin) => { sent.push({ msg, targetOrigin }); };
  const deps = { planRoute: mockPlanRoute(snapped), naismith: NAISMITH, appVersion: 'test-1.0', captureMap };
  function Harness() { useEmbedBridge(deps); return null; }
  const utils = render(React.createElement(Harness));
  const incoming = (data, origin = ORIGIN) => {
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data, origin, source: dom.window }));
  };
  const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 20)); }); };
  return { sent, incoming, flush, utils };
}
const msg = (type, extra = {}, requestId) => Object.assign({ channel: CHANNEL, version: PROTOCOL_VERSION, type, requestId }, extra);
const lastOfType = (sent, type) => [...sent].reverse().find(s => s.msg.type === type);

test('mount 送 drawtheroute:ready（精確 targetOrigin）', async () => {
  const { sent, utils } = setup();
  await act(async () => {});
  const ready = lastOfType(sent, 'drawtheroute:ready');
  assert.ok(ready, '應該送 ready');
  assert.equal(ready.targetOrigin, ORIGIN);
  assert.equal(ready.msg.channel, CHANNEL);
  utils.unmount();
});

test('canvas:init → init-ack；valid plan → route:result（真實 analyzeRoute）', async () => {
  const { sent, incoming, flush, utils } = setup();
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'init-1')); });
  assert.ok(lastOfType(sent, 'canvas:init-ack'), '應該回 init-ack');
  await act(async () => { incoming(msg('route:plan', { plan: plan() }, 'req-1')); });
  await flush();
  const res = lastOfType(sent, 'route:result');
  assert.ok(res, '應該回 route:result');
  assert.equal(res.msg.requestId, 'req-1');
  assert.equal(res.targetOrigin, ORIGIN);
  const r = res.msg.result;
  assert.equal(r.source, 'drawtheroute');
  assert.equal(r.total.distanceM, 2000);          // 2 legs × 1km
  assert.equal(r.legs.length, 2);
  assert.equal(r.fallbackUsed, false);
  assert.equal(r.humanReviewRequired, true);
  assert.equal(r.criteria.find(c => c.id === 'all_legs_snapped').status, 'pass');
  assert.equal(r.criteria.find(c => c.id === 'target_total_km').status, 'pass');
  utils.unmount();
});

test('未握手就送 plan → NOT_READY', async () => {
  const { sent, incoming, flush, utils } = setup();
  await act(async () => {});
  await act(async () => { incoming(msg('route:plan', { plan: plan() }, 'req-x')); });
  await flush();
  const err = lastOfType(sent, 'route:error');
  assert.ok(err);
  assert.equal(err.msg.code, 'NOT_READY');
  utils.unmount();
});

test('invalid plan → INVALID_PLAN', async () => {
  const { sent, incoming, flush, utils } = setup();
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'i')); });
  await act(async () => { incoming(msg('route:plan', { plan: { start: { lat: 999, lon: 0 }, waypoints: [] } }, 'req-bad')); });
  await flush();
  const err = lastOfType(sent, 'route:error');
  assert.ok(err);
  assert.equal(err.msg.code, 'INVALID_PLAN');
  utils.unmount();
});

test('重複 requestId → DUPLICATE', async () => {
  const { sent, incoming, flush, utils } = setup();
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'i')); });
  await act(async () => { incoming(msg('route:plan', { plan: plan() }, 'dup')); });
  await flush();
  await act(async () => { incoming(msg('route:plan', { plan: plan() }, 'dup')); });
  await flush();
  const errs = sent.filter(s => s.msg.type === 'route:error' && s.msg.code === 'DUPLICATE');
  assert.ok(errs.length >= 1, '應該回 DUPLICATE');
  utils.unmount();
});

test('錯誤 origin → 靜默拒絕（冇任何回應）', async () => {
  const { sent, incoming, flush, utils } = setup();
  await act(async () => {});
  const before = sent.length;
  await act(async () => { incoming(msg('canvas:init', {}, 'i'), 'https://evil.com'); });
  await flush();
  assert.equal(sent.length, before, '唔應該回應錯誤 origin');
  utils.unmount();
});

test('bridge 將 plan label 帶入 planRoute（唔丟地名）', async () => {
  const sent = []; let captured = null;
  dom.window.__DTR_EMBED__ = { parentOrigin: ORIGIN };
  dom.window.postMessage = (m, t) => { sent.push({ msg: m, targetOrigin: t }); };
  const deps = {
    planRoute: async (points) => { captured = points; return mockPlanRoute(true)(points); },
    naismith: NAISMITH, appVersion: 'test-1.0',
  };
  function H() { useEmbedBridge(deps); return null; }
  const utils = render(React.createElement(H));
  const incoming = (data, origin = ORIGIN) => { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data, origin, source: dom.window })); };
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'i')); });
  await act(async () => { incoming(msg('route:plan', { plan: plan() }, 'lbl')); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  assert.ok(captured, 'planRoute 應被呼叫');
  assert.deepEqual(captured.map(p => p.label), ['A', 'B', 'C']);
  utils.unmount();
});

test('fallback leg → fallbackUsed=true、criteria 不可 pass、有 warning', async () => {
  const { sent, incoming, flush, utils } = setup(false);
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'i')); });
  await act(async () => { incoming(msg('route:plan', { plan: plan() }, 'fb')); });
  await flush();
  const res = lastOfType(sent, 'route:result');
  assert.ok(res);
  const r = res.msg.result;
  assert.equal(r.fallbackUsed, true);
  assert.equal(r.criteria.find(c => c.id === 'all_legs_snapped').status, 'fail');
  assert.equal(r.criteria.find(c => c.id === 'target_total_km').status, 'unknown');
  assert.ok(r.warnings.some(w => w.code === 'FALLBACK_STRAIGHT'));
  assert.ok(r.legs.every(l => l.snapped === false));
  utils.unmount();
});

test('map:snapshot → map:snapshot-result（dataUrl＋尺寸，精確 targetOrigin）', async () => {
  const cap = async () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 1600, height: 1200 });
  const { sent, incoming, flush, utils } = setup(true, cap);
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'i')); });
  await act(async () => { incoming(msg('map:snapshot', {}, 'snap-1')); });
  await flush();
  const res = lastOfType(sent, 'map:snapshot-result');
  assert.ok(res, '應該回 map:snapshot-result');
  assert.equal(res.msg.requestId, 'snap-1');
  assert.equal(res.targetOrigin, ORIGIN);
  assert.equal(res.msg.image, 'data:image/png;base64,AAAA');
  assert.equal(res.msg.width, 1600);
  assert.equal(res.msg.height, 1200);
  utils.unmount();
});

test('冇 captureMap dep → map:snapshot-error（唔會 crash）', async () => {
  const { sent, incoming, flush, utils } = setup();
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'i')); });
  await act(async () => { incoming(msg('map:snapshot', {}, 'snap-2')); });
  await flush();
  const err = lastOfType(sent, 'map:snapshot-error');
  assert.ok(err, '應該回 map:snapshot-error');
  assert.equal(err.msg.requestId, 'snap-2');
  utils.unmount();
});

test('未握手就 map:snapshot → error', async () => {
  const cap = async () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 });
  const { sent, incoming, flush, utils } = setup(true, cap);
  await act(async () => {});
  await act(async () => { incoming(msg('map:snapshot', {}, 'snap-3')); });
  await flush();
  const err = lastOfType(sent, 'map:snapshot-error');
  assert.ok(err);
  assert.equal(err.msg.requestId, 'snap-3');
  assert.ok(!lastOfType(sent, 'map:snapshot-result'), '未握手唔可以回圖');
  utils.unmount();
});

test('captureMap 拋錯 → map:snapshot-error 帶 message；截圖期間再請求 → busy error', async () => {
  let calls = 0;
  const cap = () => { calls++; return new Promise((_, rej) => setTimeout(() => rej(new Error('tiles failed')), 30)); };
  const { sent, incoming, flush, utils } = setup(true, cap);
  await act(async () => {});
  await act(async () => { incoming(msg('canvas:init', {}, 'i')); });
  await act(async () => { incoming(msg('map:snapshot', {}, 'snap-4')); });
  await act(async () => { incoming(msg('map:snapshot', {}, 'snap-5')); });
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
  const errs = sent.filter(s => s.msg.type === 'map:snapshot-error');
  assert.equal(calls, 1, 'busy 期間唔可以再開截圖');
  assert.ok(errs.some(e => e.msg.requestId === 'snap-5'), '第二個請求要即時收到 busy error');
  const fail = errs.find(e => e.msg.requestId === 'snap-4');
  assert.ok(fail, '失敗要回 error');
  assert.equal(fail.msg.message, 'tiles failed');
  utils.unmount();
});
