// 橫剖面「軸間距改變時剖面要跟隨縮放」運行時驗證
// 用法: npx tsx scripts/crosssection.test.mjs
import { JSDOM } from 'jsdom';

// ── jsdom 全域設定（import 組件前完成）──────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.fetch = () => Promise.reject(new Error('offline'));
// 固定容器大小，讓 ResponsiveContainer 量到真實尺寸
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { width: 900, height: 400, top: 0, left: 0, right: 900, bottom: 400, x: 0, y: 0 };
};
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { value: 900, configurable: true });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { value: 400, configurable: true });
global.ResizeObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { const r = el.getBoundingClientRect(); this.cb([{ contentRect: { width: r.width, height: r.height }, target: el }], this); }
  unobserve() {} disconnect() {}
};

const React = (await import('react')).default;
const { render, screen, fireEvent, act } = await import('@testing-library/react');
const { default: ElevationChart } = await import('../src/components/ElevationProfile/ElevationChart.tsx');

// 繪圖區幾何（必須與元件內 CHART_MARGIN / Y_AXIS_WIDTH 一致）
const PLOT_TOP = 20, PLOT_HEIGHT = 346;

// ── 合成一座「400 米山頂」的路線剖面 ─────────────────────
const profile = [];
for (let i = 0; i <= 64; i++) {
  const t = i / 64;
  profile.push({
    distance: +(t * 3.2).toFixed(3),              // 總里程 3.2 km
    elevation: Math.round(100 + 300 * Math.sin(Math.PI * t)), // 山頂 400m
    lat: 22.3 + t * 0.01, lng: 114.1 + t * 0.01,
  });
}
const props = {
  profile,
  stats: { totalDistance: 3.2, totalAscent: 300, totalDescent: 300, maxElevation: 400, minElevation: 100, estimatedTime: 60 },
  waypoints: [
    { id: 'a', latlng: { lat: 22.3, lng: 114.1 }, elevation: 100, type: 'start' },
    { id: 'b', latlng: { lat: 22.31, lng: 114.11 }, elevation: 100, type: 'end' },
  ],
  segments: [{ id: 's1', points: [], mode: 'straight', distance: 3.2, ascent: 300, descent: 300 }],
  naismithSettings: { baseSpeedKmh: 4, ascentPer20m: 10, descentPer20m: 0 },
  onPointClick: () => {}, onHoverPoint: () => {}, onSlideWaypoint: () => {}, onSetWaypoint: () => {},
};

// 所有 SVG 文字標籤（軸刻度＋SP/EP）
const allLabels = () => Array.from(document.querySelectorAll('text')).map(t => t.textContent).filter(Boolean);
const areaD = () => document.querySelector('.recharts-area-area')?.getAttribute('d') || '';
// 剖面山頂在 SVG 的 y 座標（取 path 中最小的 y；SVG y 向下增長，越小＝越高）
const peakY = (d) => { const m = d.match(/-?\d+\.?\d*/g); let min = Infinity; for (let i = 1; i < m.length; i += 2) { const y = parseFloat(m[i]); if (y < min) min = y; } return min; };
// 依 domain 預期的山頂 y 座標（線性縮放）
const expectedPeakY = (domainMax) => +(PLOT_TOP + (1 - 400 / domainMax) * PLOT_HEIGHT).toFixed(1);

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const waitUntil = async (fn, timeout = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (fn()) return true; await new Promise(r => setTimeout(r, 30)); }
  return false;
};

console.log('\n情境：山頂 400m，總里程 3.2km，繪圖區高 346px\n');

render(React.createElement(ElevationChart, props));
await act(async () => {});

const intervalInputs = screen.getAllByPlaceholderText('自動');
const xInput = intervalInputs[0];
const yInput = intervalInputs[1];

// ── 1. 自動（無輸入）：domain = [0, 500] ─────────────────
await waitUntil(() => allLabels().includes('500'));
console.log('【自動】標籤 =', JSON.stringify(allLabels()));
const autoPeakY = peakY(areaD());
check('自動時軸頂部 = 500', allLabels().includes('500'));
check('自動時不出現 1000', !allLabels().includes('1000'));
check(`自動時山頂 y ≈ ${expectedPeakY(500)}（400/500 高度）`, Math.abs(autoPeakY - expectedPeakY(500)) < 1, `(實測 ${autoPeakY.toFixed(1)})`);

// ── 2. Y 間距 = 1000（用戶例子）：domain 應變 [0, 1000] ──
fireEvent.change(yInput, { target: { value: '1000' } });
await waitUntil(() => allLabels().includes('1000'));
console.log('【Y間距=1000】標籤 =', JSON.stringify(allLabels()));
check('間距 1000 時軸頂部變成 1000（軸跟隨間距延伸）', allLabels().includes('1000'));
const bigPeakY = peakY(areaD());
check(`山頂 y 移到 ≈ ${expectedPeakY(1000)}（400/1000 高度，剖面跟隨縮放）`, Math.abs(bigPeakY - expectedPeakY(1000)) < 1, `(實測 ${bigPeakY.toFixed(1)})`);
check('剖面確實重新縮放（山頂位置明顯改變）', Math.abs(bigPeakY - autoPeakY) > 50, `(Δ=${Math.abs(bigPeakY - autoPeakY).toFixed(1)}px)`);

// ── 3. Y 間距 = 300（不整除 → 對齊到 600）──────────────
fireEvent.change(yInput, { target: { value: '300' } });
await waitUntil(() => allLabels().includes('600'));
console.log('【Y間距=300】標籤 =', JSON.stringify(allLabels()));
check('間距 300 時 domain 對齊到 600', allLabels().includes('600'));
check('山頂 y 對應 400/600 高度', Math.abs(peakY(areaD()) - expectedPeakY(600)) < 1, `(實測 ${peakY(areaD()).toFixed(1)})`);

// ── 4. X 間距同樣跟隨：domain = [0, 4] ──────────────────
fireEvent.change(yInput, { target: { value: '' } });
fireEvent.change(xInput, { target: { value: '2' } });
await waitUntil(() => allLabels().includes('4.0'));
console.log('【X間距=2】標籤 =', JSON.stringify(allLabels()));
check('X 間距 2 時 domain 對齊到 4km（軸延伸至 4.0）', allLabels().includes('4.0'));

// ── 5. 無效輸入回落自動 ─────────────────────────────────
fireEvent.change(xInput, { target: { value: '' } });
fireEvent.change(yInput, { target: { value: 'abc' } });
await act(async () => {});
console.log('【無效Y間距】標籤 =', JSON.stringify(allLabels()));
check('無效 Y 間距 → 回落自動 domain（含 500）', allLabels().includes('500') && !allLabels().includes('1000'));

console.log(`\n結果：${pass} 通過，${fail} 失敗\n`);
process.exit(fail === 0 ? 0 : 1);
