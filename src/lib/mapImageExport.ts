/**
 * 路線連地圖圖片匯出引擎（純 Canvas，零新依賴）
 *
 * 設計原則：
 * 1. 手動拼圖磚（唔用 html2canvas 截 Leaflet，避開 translate3d 錯位）
 * 2. 分數縮放渲染：圖磚按連續 zoom 縮放，令「100% 列印 = 1:N」精確成立
 * 3. 路線／CP 樣式跟 MapCore（auto 綠／straight 棕＋虛線）
 * 4. 圖面必帶版權標示（LandsD TNC：Map from Lands Department 等）
 */
import L from 'leaflet';
import type { LatLng, RouteSegment, WaypointMarker } from '../types';

const TILE = 256;
const EARTH_CIRC = 40075016.68557849; // WebMercator 赤道周長（米）
/** 96dpi 螢幕下 1 米 = 多少 px（1:N ≈ pxPerMeter × 此值） */
export const PX_PER_M_96DPI = 3779.5275590551;

export interface TileSource { url: string; maxZoom: number; }

export interface MapImageExportOptions {
  /** 要覆蓋的地面範圍 */
  bounds: L.LatLngBounds;
  widthPx: number;
  heightPx: number;
  /** 輸出精度（用於計算比例 N = dpi / (0.0254 × pxPerMeter)） */
  dpi: number;
  /** 固定比例時指定（px/米）；唔傳就自動 fit bounds */
  pxPerMeter?: number;
  base: TileSource;
  overlay?: { source: TileSource; alpha: number };
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  /** 標題（路線名／頁名） */
  title: string;
  /** 日期／附註行 */
  subtitle: string;
  /** 比例說明（唔傳就按實際 pxPerMeter 自動計算，確保圖面比例同輸出一致） */
  scaleText?: string;
  /** 圖例警示（例如「部分路段可能未見於地形圖」） */
  noteText: string;
  /** 版權行（依底圖組裝；LandsD 必含 Map from Lands Department） */
  attribution: string[];
  /** 分頁高亮：只著色此距離區間（米），其餘路線 ghost 顯示 */
  highlightRange?: { startM: number; endM: number };
  onProgress?: (done: number, total: number) => void;
}

export interface MapImageResult {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  /** 輸出圖的實際比例分母（四捨五入到好記數字） */
  scaleDenominator: number;
}

/* ────────────────────────── 座標／比例工具 ────────────────────────── */

function proj0(latlng: LatLng): { x: number; y: number } {
  const p = L.CRS.EPSG3857.latLngToPoint(L.latLng(latlng.lat, latlng.lng), 0);
  return { x: p.x, y: p.y };
}

/** 螢幕（96dpi）當前比例分母——供地圖角落 1:N 徽章用 */
export function screenScaleDenominator(map: L.Map): number {
  const zoom = map.getZoom();
  const lat = map.getCenter().lat;
  const mpp = (EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (TILE * Math.pow(2, zoom));
  return niceDenominator(mpp * PX_PER_M_96DPI);
}

/** 四捨五入到好記的比例分母 */
export function niceDenominator(d: number): number {
  if (!isFinite(d) || d <= 0) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(d)));
  const norm = d / pow;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return Math.round(step * pow);
}

/** 精確比例所需 pxPerMeter（例如 1:20000 @300dpi） */
export function pxPerMeterForScale(denominator: number, dpi: number): number {
  return dpi / (0.0254 * denominator);
}

/** 由 pxPerMeter 反算比例分母 */
export function denominatorFor(pxPerMeter: number, dpi: number): number {
  return niceDenominator(dpi / (0.0254 * pxPerMeter));
}

/** 粗略量度 bounds 的地面尺寸（米）——足夠做覆蓋警告 */
export function boundsGroundSizeM(b: L.LatLngBounds): { wM: number; hM: number } {
  const lat = b.getCenter().lat;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  return {
    wM: Math.abs(b.getEast() - b.getWest()) * mPerDegLng,
    hM: Math.abs(b.getNorth() - b.getSouth()) * mPerDegLat,
  };
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ────────────────────────── 路線攤平（含距離） ────────────────────────── */

export interface FlatRoute {
  pts: LatLng[];
  /** cum[i] = 第 i 點距起點距離（米） */
  cum: number[];
  totalM: number;
}

export function flattenRoute(segments: RouteSegment[]): FlatRoute {
  const pts: LatLng[] = [];
  const cum: number[] = [];
  let total = 0;
  for (const seg of segments) {
    for (let i = 0; i < seg.points.length; i++) {
      const p = seg.points[i];
      if (pts.length > 0) {
        total += haversine(pts[pts.length - 1], p);
      }
      pts.push({ lat: p.lat, lng: p.lng });
      cum.push(total);
    }
  }
  return { pts, cum, totalM: total };
}

/** 手繪／直線路段太疏時補點，令 ghost／高亮同分頁判定更準 */
export function densify(flat: FlatRoute, maxGapM = 250): FlatRoute {
  const pts: LatLng[] = [];
  const cum: number[] = [];
  for (let i = 0; i < flat.pts.length; i++) {
    if (i > 0) {
      const d = haversine(flat.pts[i - 1], flat.pts[i]);
      if (d > maxGapM) {
        const n = Math.floor(d / maxGapM);
        for (let k = 1; k <= n; k++) {
          const t = k / (n + 1);
          pts.push({
            lat: flat.pts[i - 1].lat + (flat.pts[i].lat - flat.pts[i - 1].lat) * t,
            lng: flat.pts[i - 1].lng + (flat.pts[i].lng - flat.pts[i - 1].lng) * t,
          });
          cum.push(flat.cum[i - 1] + d * t);
        }
      }
    }
    pts.push(flat.pts[i]);
    cum.push(flat.cum[i]);
  }
  return { pts, cum, totalM: flat.totalM };
}

/* ────────────────────────── 圖磚載入 ────────────────────────── */

function tileUrl(tpl: string, z: number, x: number, y: number): string {
  return tpl
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{s}', 'abc'[(x + y) % 3]);
}

function loadTile(src: TileSource, z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const url = tileUrl(src.url, Math.min(z, src.maxZoom), x, y);
  return new Promise(resolve => {
    let tries = 0;
    const attempt = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        tries += 1;
        if (tries < 2) setTimeout(attempt, 350);
        else resolve(null);
      };
      img.src = url;
    };
    attempt();
  });
}

async function loadTiles(
  src: TileSource,
  tiles: Array<[number, number, number]>,
  concurrency = 6,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, HTMLImageElement | null>> {
  const out = new Map<string, HTMLImageElement | null>();
  let done = 0;
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, tiles.length) }, async () => {
    while (idx < tiles.length) {
      const [z, x, y] = tiles[idx++];
      out.set(`${z}/${x}/${y}`, await loadTile(src, z, x, y));
      done += 1;
      onProgress?.(done, tiles.length);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ────────────────────────── 渲染 ────────────────────────── */

const FONT = "'Noto Sans TC','PingFang HK','Microsoft JhengHei',sans-serif";
const COLOR = {
  bg: '#e8e4d8',
  titleBar: 'rgba(15,23,42,0.94)',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  note: '#fcd34d',
  autoMain: '#34d399',
  autoCasing: '#065f46',
  straightMain: '#fbbf24',
  straightCasing: '#78350f',
  ghost: 'rgba(100,116,139,0.55)',
  wpStart: '#22c55e',
  wpEnd: '#ef4444',
  wpMid: '#f59e0b',
};

function wpColor(wp: WaypointMarker): string {
  return wp.type === 'start' ? COLOR.wpStart : wp.type === 'end' ? COLOR.wpEnd : COLOR.wpMid;
}
function wpLabel(wp: WaypointMarker, idx: number): string {
  return wp.type === 'start' ? '起點' : wp.type === 'end' ? '終點' : `CP ${idx}`;
}

export interface RenderedMapImage {
  canvas: HTMLCanvasElement;
  /** 渲染時實際用到的 pxPerMeter */
  pxPerMeter: number;
  /** 輸出圖實際比例分母（好記數字） */
  scaleDenominator: number;
}

export async function renderMapImage(opts: MapImageExportOptions): Promise<RenderedMapImage> {
  const { bounds, widthPx: W, heightPx: H, dpi, base, overlay, segments, waypoints } = opts;
  // ① 決定連續 zoom 同 pxPerMeter
  const p0a = proj0({ lat: bounds.getNorth(), lng: bounds.getWest() });
  const p0b = proj0({ lat: bounds.getSouth(), lng: bounds.getEast() });
  const spanX0 = Math.max(1e-12, p0b.x - p0a.x);
  const spanY0 = Math.max(1e-12, p0b.y - p0a.y);

  let zFloat: number;
  let pxPerMeter: number;
  if (opts.pxPerMeter && opts.pxPerMeter > 0) {
    // 固定比例：由 pxPerMeter 反推連續 zoom（以中心緯度校正 Mercator 變形）
    // ⚠ 呢度唔可以 clamp 去 maxZoom——會令實際比例失準；圖磚唔夠高解像就放大貼（見 zBase）
    pxPerMeter = opts.pxPerMeter;
    const lat = bounds.getCenter().lat;
    const worldPx = EARTH_CIRC * Math.cos((lat * Math.PI) / 180) * pxPerMeter;
    zFloat = Math.max(-2, Math.min(Math.log2(worldPx / TILE), 24));
  } else {
    // 自動 fit：zoom 剛好令 bounds 入到 W×H（留 3% margin）
    const margin = 0.97;
    zFloat = Math.log2(Math.min((W * margin) / spanX0, (H * margin) / spanY0));
    zFloat = Math.max(0, Math.min(zFloat, base.maxZoom));
    const lat = bounds.getCenter().lat;
    pxPerMeter = (TILE * Math.pow(2, zFloat)) / (EARTH_CIRC * Math.cos((lat * Math.PI) / 180));
  }

  const zBase = Math.max(0, Math.min(Math.floor(zFloat), base.maxZoom));
  const s = Math.pow(2, zFloat - zBase); // 圖磚縮放係數（canvas 上每塊 = TILE*s px）

  const center = proj0(bounds.getCenter());
  const cx = center.x * Math.pow(2, zFloat);
  const cy = center.y * Math.pow(2, zFloat);
  const topLeftX = cx - W / 2;
  const topLeftY = cy - H / 2;

  // 畫布座標：proj0(latlng) → zFloat px → 減 topLeft
  const toCanvas = (p: LatLng): { x: number; y: number } => {
    const q = proj0(p);
    return { x: q.x * Math.pow(2, zFloat) - topLeftX, y: q.y * Math.pow(2, zFloat) - topLeftY };
  };

  // ② 圖磚清單
  const tSize = TILE * s;
  const x0 = Math.floor(topLeftX / tSize) - 1;
  const x1 = Math.ceil((topLeftX + W) / tSize) + 1;
  const y0 = Math.floor(topLeftY / tSize) - 1;
  const y1 = Math.ceil((topLeftY + H) / tSize) + 1;
  const tileList: Array<[number, number, number]> = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tileList.push([zBase, x, y]);

  const totalTasks = tileList.length * (overlay ? 2 : 1);

  const baseTiles = await loadTiles(base, tileList, 6, (d) => opts.onProgress?.(d, totalTasks));
  let loadedCount = 0;
  baseTiles.forEach(img => { if (img) loadedCount += 1; });
  if (tileList.length > 0 && loadedCount === 0) {
    throw new Error('圖磚全部載入失敗（網絡或 CORS 限制）——請檢查連線或轉用其他底圖');
  }
  let overlayTiles: Map<string, HTMLImageElement | null> | null = null;
  if (overlay) {
    overlayTiles = await loadTiles(overlay.source, tileList, 6, (d) => opts.onProgress?.(tileList.length + d, totalTasks));
  }
  opts.onProgress?.(totalTasks, totalTasks);

  // ③ 畫布
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);

  const drawTileSet = (tiles: Map<string, HTMLImageElement | null>, alpha: number) => {
    ctx.globalAlpha = alpha;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const img = tiles.get(`${zBase}/${x}/${y}`);
        if (!img) continue;
        ctx.drawImage(img, x * tSize - topLeftX, y * tSize - topLeftY, tSize, tSize);
      }
    }
    ctx.globalAlpha = 1;
  };
  drawTileSet(baseTiles, 1);
  if (overlayTiles && overlay) drawTileSet(overlayTiles, overlay.alpha);

  // ④ 路線（ghost 全線 + 主色；highlightRange 存在時只著色區間）
  const lineWidthMain = Math.max(2.2, W * 0.0022);
  const casingW = lineWidthMain * 2.6;
  const drawPolyline = (lls: LatLng[], style: { main: string; casing: string; dash?: boolean }) => {
    if (lls.length < 2) return;
    const pts = lls.map(toCanvas);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = style.casing;
    ctx.lineWidth = casingW;
    path();
    ctx.stroke();
    ctx.strokeStyle = style.main;
    ctx.lineWidth = lineWidthMain;
    if (style.dash) ctx.setLineDash([lineWidthMain * 3, lineWidthMain * 1.8]);
    path();
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const flat = densify(flattenRoute(segments));
  const hl = opts.highlightRange;

  if (hl) {
    // 分頁模式：全線 ghost + 區間高亮（用密度化線段，頁界切割準確）
    if (flat.pts.length >= 2) {
      drawPolyline(flat.pts, { main: COLOR.ghost, casing: 'rgba(51,65,85,0.25)' });
    }
    const runs: LatLng[][] = [];
    let cur: LatLng[] = [];
    for (let i = 0; i < flat.pts.length; i++) {
      const inside = flat.cum[i] >= hl.startM && flat.cum[i] <= hl.endM;
      if (inside) cur.push(flat.pts[i]);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    for (const run of runs) drawPolyline(run, { main: COLOR.autoMain, casing: COLOR.autoCasing });
  } else {
    for (const seg of segments) {
      const style = seg.mode === 'auto'
        ? { main: COLOR.autoMain, casing: COLOR.autoCasing }
        : { main: COLOR.straightMain, casing: COLOR.straightCasing, dash: true };
      drawPolyline(seg.points, style);
    }
  }

  // ⑤ CP 標記（膠囊樣式，跟地圖 divIcon 一致）
  const fsLabel = Math.max(11, W * 0.011);
  const padX = fsLabel * 0.55;
  const dotR = Math.max(4, W * 0.0045);
  waypoints.forEach((wp, idx) => {
    const p = toCanvas(wp.latlng);
    const text = `${wpLabel(wp, idx)}  ${wp.elevation.toFixed(0)}m`;
    ctx.font = `600 ${fsLabel}px ${FONT}`;
    const tw = ctx.measureText(text).width;
    const pillW = dotR * 2 + padX * 2 + tw + fsLabel * 0.6;
    const pillH = fsLabel * 1.85;
    const cx0 = p.x - pillW / 2;
    const cy0 = p.y - pillH / 2;
    ctx.fillStyle = 'rgba(8,14,28,0.92)';
    roundRect(ctx, cx0, cy0, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = Math.max(1, W * 0.0008);
    ctx.stroke();
    const c = wpColor(wp);
    ctx.beginPath();
    ctx.arc(cx0 + padX + dotR, p.y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, W * 0.0012);
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx0 + padX + dotR * 2 + padX * 0.5, p.y + 1);
  });

  // ⑥ 比例尺
  const bar = scaleBarLenM(pxPerMeter, W);
  const barPx = bar.meters * pxPerMeter;
  const barH = Math.max(4, W * 0.005);
  const barX = W * 0.035;
  const barY = H - titleBarH(H) - H * 0.055;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  roundRect(ctx, barX - 10, barY - fsLabel * 1.9, barPx + 20 * 2 + fsLabel * 4.5, fsLabel * 2.6 + barH, 6);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#0f172a' : '#f8fafc';
    ctx.fillRect(barX + (barPx / 4) * i, barY, barPx / 4, barH);
  }
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = Math.max(1, W * 0.0008);
  ctx.strokeRect(barX, barY, barPx, barH);
  ctx.fillStyle = '#0f172a';
  ctx.font = `600 ${fsLabel * 0.9}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(bar.label, barX + barPx + fsLabel * 0.7, barY + barH * 0.9);

  // ⑦ 指北針（右上）
  const nx = W - W * 0.055;
  const ny = H * 0.075;
  const nr = Math.max(16, W * 0.018);
  ctx.beginPath();
  ctx.arc(nx, ny, nr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = Math.max(1, W * 0.0008);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(nx, ny - nr * 0.62);
  ctx.lineTo(nx + nr * 0.3, ny + nr * 0.38);
  ctx.lineTo(nx, ny + nr * 0.12);
  ctx.lineTo(nx - nr * 0.3, ny + nr * 0.38);
  ctx.closePath();
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 ${nr * 0.55}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('N', nx, ny + nr * 1.15);
  ctx.textAlign = 'left';

  // ⑧ 底部標題帶：標題／日期／比例／警示／版權
  const th = titleBarH(H);
  const ty = H - th;
  ctx.fillStyle = COLOR.titleBar;
  ctx.fillRect(0, ty, W, th);
  ctx.fillStyle = '#34d399';
  ctx.fillRect(0, ty, W, Math.max(2, H * 0.0022));

  const fsTitle = Math.max(15, W * 0.0185);
  const fsSub = Math.max(10, W * 0.0115);
  const fsTiny = Math.max(8.5, W * 0.0095);
  const mX = W * 0.035;

  ctx.fillStyle = COLOR.text;
  ctx.font = `700 ${fsTitle}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(opts.title, mX, ty + th * 0.14);

  const rightText = opts.scaleText ?? (opts.pxPerMeter
    ? `比例 1:${denominatorFor(pxPerMeter, dpi).toLocaleString('en-US')}（100% 列印）`
    : `比例約 1:${denominatorFor(pxPerMeter, dpi).toLocaleString('en-US')}（自動縮放）`);
  ctx.font = `700 ${fsSub}px ${FONT}`;
  const rw = ctx.measureText(rightText).width;
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText(rightText, W - mX - rw, ty + th * 0.17);

  ctx.font = `500 ${fsSub}px ${FONT}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(opts.subtitle, mX, ty + th * 0.45);

  ctx.font = `500 ${fsTiny}px ${FONT}`;
  ctx.fillStyle = COLOR.note;
  const noteY = ty + th * 0.68;
  ctx.fillText(opts.noteText, mX, noteY);

  const attrText = opts.attribution.join('  ·  ');
  ctx.fillStyle = COLOR.textDim;
  const aw = ctx.measureText(attrText).width;
  ctx.fillText(attrText, W - mX - aw, noteY);

  return { canvas, pxPerMeter, scaleDenominator: denominatorFor(pxPerMeter, dpi) };
}

function titleBarH(H: number): number {
  return Math.max(64, H * 0.082);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 選「好睇」嘅比例尺長度（100m/200m/500m/1km…） */
function scaleBarLenM(pxPerMeter: number, W: number): { meters: number; label: string } {
  const targetPx = W * 0.18;
  const candidates = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
  let best = candidates[0];
  for (const m of candidates) {
    if (m * pxPerMeter <= targetPx) best = m;
  }
  return { meters: best, label: best >= 1000 ? `${best / 1000} km` : `${best} m` };
}

/* ────────────────────────── 匯出封裝 ────────────────────────── */

export async function exportMapImage(opts: MapImageExportOptions): Promise<MapImageResult> {
  const rendered = await renderMapImage(opts);
  const blob = await new Promise<Blob | null>(res => rendered.canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob 失敗');
  return {
    blob,
    widthPx: rendered.canvas.width,
    heightPx: rendered.canvas.height,
    scaleDenominator: rendered.scaleDenominator,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ────────────────────────── 多日長線：自動分段（圖幅式） ────────────────────────── */

export interface RoutePage {
  bounds: L.LatLngBounds;
  startM: number;
  endM: number;
  /** 顯示用：此頁路線距離區間 */
  label: string;
}

/**
 * 圖幅式分頁：固定比例、軸向格網、沿路線推進、20% 重疊。
 * 只保留同路線相交嘅頁，並按「首次相交距離」排序（跟住行軍次序）。
 */
export function planRoutePages(flat: FlatRoute, pageWM: number, pageHM: number): RoutePage[] {
  if (flat.pts.length < 2) return [];
  const stepX = pageWM * 0.8;
  const stepY = pageHM * 0.8;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of flat.pts) {
    minX = Math.min(minX, p.lng); maxX = Math.max(maxX, p.lng);
    minY = Math.min(minY, p.lat); maxY = Math.max(maxY, p.lat);
  }
  const lat = (minY + maxY) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const pageWdeg = pageWM / mPerDegLng;
  const pageHdeg = pageHM / mPerDegLat;
  const stepXdeg = stepX / mPerDegLng;
  const stepYdeg = stepY / mPerDegLat;

  const cells: Array<{ ix: number; iy: number }> = [];
  const cellInfo = new Map<string, { firstM: number; minM: number; maxM: number; n: number }>();

  for (let i = 0; i < flat.pts.length; i++) {
    const p = flat.pts[i];
    const ix = Math.floor((p.lng - minX) / stepXdeg);
    const iy = Math.floor((p.lat - minY) / stepYdeg);
    for (const [cx, cy] of [[ix, iy], [ix - 1, iy], [ix, iy - 1], [ix - 1, iy - 1]]) {
      if (cx < 0 || cy < 0) continue;
      const key = `${cx},${cy}`;
      const x0 = minX + cx * stepXdeg;
      const y0 = minY + cy * stepYdeg;
      const inside = p.lng >= x0 && p.lng <= x0 + pageWdeg && p.lat >= y0 && p.lat <= y0 + pageHdeg;
      if (!inside) continue;
      const info = cellInfo.get(key) ?? { firstM: flat.cum[i], minM: flat.cum[i], maxM: flat.cum[i], n: 0 };
      info.n += 1;
      info.minM = Math.min(info.minM, flat.cum[i]);
      info.maxM = Math.max(info.maxM, flat.cum[i]);
      if (!cellInfo.has(key)) { cellInfo.set(key, info); cells.push({ ix: cx, iy: cy }); }
      else cellInfo.set(key, info);
    }
  }

  const ordered = cells
    .filter(c => (cellInfo.get(`${c.ix},${c.iy}`)?.n ?? 0) >= 2)
    .sort((a, b) => (cellInfo.get(`${a.ix},${a.iy}`)!.firstM) - (cellInfo.get(`${b.ix},${b.iy}`)!.firstM));

  return ordered.map(c => {
    const info = cellInfo.get(`${c.ix},${c.iy}`)!;
    const x0 = minX + c.ix * stepXdeg;
    const y0 = minY + c.iy * stepYdeg;
    return {
      bounds: L.latLngBounds([y0, x0], [y0 + pageHdeg, x0 + pageWdeg]),
      startM: info.minM,
      endM: info.maxM,
      label: `${fmtKm(info.minM)}–${fmtKm(info.maxM)} km`,
    };
  });
}

function fmtKm(m: number): string {
  return (m / 1000).toFixed(1);
}

/** 逐頁匯出（瀏覽器可能詢問「允許多個下載」）；shouldCancel 回 true 會喺頁與頁之間中止 */
export async function exportRoutePages(
  base: Omit<MapImageExportOptions, 'bounds' | 'highlightRange'>,
  pages: RoutePage[],
  nameFor: (idx: number, total: number) => string,
  onStatus?: (msg: string) => void,
  shouldCancel?: () => boolean,
): Promise<number> {
  let done = 0;
  for (let i = 0; i < pages.length; i++) {
    if (shouldCancel?.()) {
      onStatus?.(`已取消（完成 ${done}/${pages.length} 頁）`);
      return done;
    }
    onStatus?.(`匯出第 ${i + 1}/${pages.length} 頁…`);
    const res = await exportMapImage({
      ...base,
      bounds: pages[i].bounds,
      title: `${base.title} · 頁 ${i + 1}/${pages.length}（${pages[i].label}）`,
      highlightRange: { startM: pages[i].startM, endM: pages[i].endM },
    });
    downloadBlob(res.blob, nameFor(i + 1, pages.length));
    done += 1;
    await new Promise(r => setTimeout(r, 350)); // 少少間隔，避免瀏覽器封鎖多下載
  }
  return done;
}
