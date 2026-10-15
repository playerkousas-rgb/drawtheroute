/**
 * routeGeometry — 手繪／手動微調路線用的純幾何工具（零依賴）
 *
 * 全部函式皆為純函式，方便獨立測試：
 *  - haversineM / pathLengthM：距離計算（米）
 *  - simplifyPath：Ramer–Douglas–Peucker 簡化（去除手繪抖動）
 *  - densifyMaxGap：把過長的邊切開，確保「磁石」錨點夠密
 *  - limitAnchorCount：錨點數量上限保護（避免一次發太多 BRouter 請求）
 *  - nearestOnPath / matchAnchorsToGeometry / legMidpoints：路線與錨點對位
 */
import { LatLng } from '../types';

const R_EARTH_M = 6371008.8;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_M * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function pathLengthM(pts: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversineM(pts[i - 1], pts[i]);
  return d;
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/** 移除與前一點太近的重複點（手繪時的抖動） */
export function dedupeByDistance(pts: LatLng[], minGapM: number): LatLng[] {
  const out: LatLng[] = [];
  for (const p of pts) {
    if (out.length === 0 || haversineM(out[out.length - 1], p) >= minGapM) out.push(p);
  }
  // 補回首尾（若尾點被 dedupe 掉，仍要保留終點）
  const last = pts[pts.length - 1];
  if (last && out.length > 0) {
    const tail = out[out.length - 1];
    if (tail.lat !== last.lat || tail.lng !== last.lng) out.push(last);
  }
  return out;
}

interface XY { x: number; y: number }

/** 以首點為原點的等距圓柱投影（米），供像素級的幾何運算用 */
function toLocalMeters(pts: LatLng[]): XY[] {
  const lat0 = pts[0].lat;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  return pts.map(p => ({ x: (p.lng - pts[0].lng) * kx, y: (p.lat - lat0) * ky }));
}

function pointSegDistM(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker 簡化，epsilon 單位為米 */
export function simplifyPath(pts: LatLng[], epsilonM: number): LatLng[] {
  if (pts.length <= 2) return pts.slice();
  const P = toLocalMeters(pts);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop() as [number, number];
    if (e - s < 2) continue;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDistM(P[i], P[s], P[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > epsilonM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** 把任何比 maxGapM 長的邊等分切開（磁石錨點密度控制） */
export function densifyMaxGap(pts: LatLng[], maxGapM: number): LatLng[] {
  if (pts.length < 2 || maxGapM <= 0) return pts.slice();
  const out: LatLng[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = haversineM(a, b);
    const parts = d > maxGapM ? Math.ceil(d / maxGapM) : 1;
    for (let k = 1; k <= parts; k++) {
      out.push({
        lat: a.lat + (b.lat - a.lat) * (k / parts),
        lng: a.lng + (b.lng - a.lng) * (k / parts),
      });
    }
  }
  return out;
}

/** 錨點數量上限保護：反覆加大簡化容差，直至錨點數 ≤ max */
export function limitAnchorCount(pts: LatLng[], max: number, startEpsM = 10): LatLng[] {
  if (pts.length <= max) return pts.slice();
  let eps = startEpsM;
  let out = pts.slice();
  for (let i = 0; i < 14 && out.length > max; i++) {
    eps *= 1.6;
    out = simplifyPath(pts, eps);
  }
  return out;
}

export interface PathHit {
  /** 距離（米） */
  distM: number;
  /** 最近線段的起點索引 */
  index: number;
  /** 投影到線上的實際位置 */
  point: LatLng;
}

/** 找 pt 到 polyline 的最近點（回傳線段索引與投影點） */
export function nearestOnPath(pt: LatLng, path: LatLng[]): PathHit | null {
  if (path.length < 2) return null;
  const lat0 = pt.lat;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const toXY = (p: LatLng): XY => ({ x: (p.lng - pt.lng) * kx, y: (p.lat - pt.lat) * ky });
  const target: XY = { x: 0, y: 0 };
  const P = path.map(toXY);

  let best: PathHit | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = P[i];
    const b = P[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((target.x - a.x) * dx + (target.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const dist = Math.hypot(px, py);
    if (!best || dist < best.distM) {
      best = {
        distM: dist,
        index: i,
        point: {
          lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
          lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t,
        },
      };
    }
  }
  return best;
}

/**
 * 為錨點鏈在路線幾何上找出對應的索引（單調遞增）。
 * 用於把「一段幾何」按錨點切回每一條 leg。
 */
export function matchAnchorsToGeometry(anchors: LatLng[], geom: LatLng[], maxSnapDeg = 0.02): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    let bi = cursor;
    let bd = Infinity;
    for (let j = cursor; j < geom.length; j++) {
      const d = (geom[j].lat - a.lat) ** 2 + (geom[j].lng - a.lng) ** 2;
      if (d < bd) { bd = d; bi = j; }
    }
    // 若錨點離幾何太遠（≥ 約 2.2 km），視為對位失敗
    if (Math.sqrt(bd) > maxSnapDeg && i > 0 && i < anchors.length - 1) bi = -1;
    out.push(bi);
    cursor = Math.min(Math.max(bi, cursor) + (bi >= cursor ? 1 : 0), geom.length - 1);
  }
  return out;
}

export interface LegHandle {
  /** 錨點鏈中的第幾條 leg（0-based）：anchors[leg] → anchors[leg+1] */
  leg: number;
  /** 位於路線幾何上的中點（若幾何不足則用直線中點） */
  point: LatLng;
  /** 該 leg 的長度（米） */
  lengthM: number;
}

/**
 * 為每個 leg 計算「新增彎位手柄」的位置（貼在實際路線幾何上）。
 * 只回傳長度 ≥ minLegM 的 leg，避免密集的無意義手柄。
 */
export function legMidpoints(anchors: LatLng[], geom: LatLng[], minLegM: number): LegHandle[] {
  if (anchors.length < 2) return [];
  const idxs = matchAnchorsToGeometry(anchors, geom);
  const out: LegHandle[] = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = idxs[k];
    const b = idxs[k + 1];
    const straightM = haversineM(anchors[k], anchors[k + 1]);
    let lengthM = straightM;
    let point: LatLng = midpoint(anchors[k], anchors[k + 1]);

    if (a >= 0 && b > a && geom.length > 1) {
      let acc = 0;
      const cum: number[] = [0];
      for (let i = a; i < b; i++) {
        acc += haversineM(geom[i], geom[i + 1]);
        cum.push(acc);
      }
      if (acc > 0) {
        lengthM = acc;
        // 取「沿線累積距離一半」的位置（比取索引中點更準，避免長短段不均）
        const half = acc / 2;
        let k = 0;
        while (k < cum.length - 2 && cum[k + 1] < half) k++;
        const segLen = cum[k + 1] - cum[k];
        const t = segLen > 0 ? Math.min(1, Math.max(0, (half - cum[k]) / segLen)) : 0;
        const p0 = geom[a + k];
        const p1 = geom[a + k + 1];
        point = { lat: p0.lat + (p1.lat - p0.lat) * t, lng: p0.lng + (p1.lng - p0.lng) * t };
      } else {
        point = geom[a];
      }
    }

    if (lengthM >= minLegM) out.push({ leg: k, point, lengthM });
  }
  return out;
}

/** 錨點鏈 → 逐段直線內插（BRouter 失敗時的備援幾何） */
export function interpolateLeg(a: LatLng, b: LatLng, targetPointsPerKm = 30): LatLng[] {
  const d = haversineM(a, b);
  const n = Math.max(4, Math.min(80, Math.round((d / 1000) * targetPointsPerKm)));
  const out: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    out.push({
      lat: a.lat + (b.lat - a.lat) * (i / n),
      lng: a.lng + (b.lng - a.lng) * (i / n),
    });
  }
  return out;
}
