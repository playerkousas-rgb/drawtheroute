/**
 * routeAnalysis.ts — 路線分析純函數（由 useTerrainAnalysis 抽出，行為完全一致）
 *
 * 目的：令「橋接器（embed bridge）」同「一般 UI」用同一份計算核心，
 * 確保 postMessage 回傳嘅距離／爬升／時間同地圖／高程剖面／路程表絕對對齊。
 *
 * ★ 呢個模組冇 React、冇 side effect，可以喺 headless bridge 直接呼叫。
 * ★ 邏輯同 useTerrainAnalysis 原本嘅 useMemo 完全一樣，只係搬出嚟做 pure function。
 */
import { RouteSegment, RouteStats, NaismithSettings, ElevationProfilePoint } from '../types';

/** 由路段幾何現場重算每段爬升／下降（解決 BRouter 欄位下山變 0 嘅問題），同時攤平高程剖面。 */
export function analyzeSegments(segments: RouteSegment[]): {
  analyzedSegments: RouteSegment[];
  elevationProfile: ElevationProfilePoint[];
} {
  const outProfile: ElevationProfilePoint[] = [];
  const outSegments: RouteSegment[] = [];
  let cumulativeKm = 0;

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    let segAsc = 0;
    let segDesc = 0;

    for (let i = 0; i < seg.points.length; i++) {
      const p = seg.points[i];
      if (i > 0) {
        const prevP = seg.points[i - 1];
        const diff = p.elevation - prevP.elevation;
        if (diff > 0) segAsc += diff;
        else segDesc += Math.abs(diff);
      }
      if (i === 0 && si > 0) continue;
      const d = parseFloat((cumulativeKm + p.distanceFromStart).toFixed(3));
      outProfile.push({
        distance: d,
        elevation: Math.round(p.elevation),
        lat: p.lat,
        lng: p.lng,
      });
    }

    outSegments.push({
      ...seg,
      ascent: Math.round(segAsc),
      descent: Math.round(segDesc),
    });

    if (seg.points.length > 0) cumulativeKm += seg.distance;
  }

  const deduped: ElevationProfilePoint[] = [];
  let lastD = -1;
  for (const pt of outProfile) {
    if (pt.distance > lastD) {
      deduped.push(pt);
      lastD = pt.distance;
    }
  }

  return { analyzedSegments: outSegments, elevationProfile: deduped };
}

/** Naismith 時間估算（分鐘）：底速 + 每 20m 爬升／下降加時。同 UI 用同一條式。 */
export function naismithMinutes(
  distanceKm: number,
  ascentM: number,
  descentM: number,
  settings: NaismithSettings
): number {
  const baseMin = (distanceKm / settings.baseSpeedKmh) * 60;
  const ascMin = (ascentM / 20) * settings.ascentPer20m;
  const descMin = (descentM / 20) * settings.descentPer20m;
  return baseMin + ascMin + descMin;
}

/** 總統計（同 useTerrainAnalysis 嘅 stats useMemo 一致）。 */
export function computeRouteStats(
  elevationProfile: ElevationProfilePoint[],
  analyzedSegments: RouteSegment[],
  settings: NaismithSettings
): RouteStats {
  const empty: RouteStats = {
    totalDistance: 0, totalAscent: 0, totalDescent: 0,
    maxElevation: 0, minElevation: 0, estimatedTime: 0,
  };
  if (!elevationProfile.length) return empty;

  const dist = elevationProfile[elevationProfile.length - 1].distance;
  let maxE = -Infinity, minE = Infinity;
  let totalAsc = 0, totalDesc = 0;
  for (const seg of analyzedSegments) {
    totalAsc += seg.ascent;
    totalDesc += seg.descent;
  }
  for (const p of elevationProfile) {
    if (p.elevation > maxE) maxE = p.elevation;
    if (p.elevation < minE) minE = p.elevation;
  }

  return {
    totalDistance: dist,
    totalAscent: totalAsc,
    totalDescent: totalDesc,
    maxElevation: maxE === -Infinity ? 0 : maxE,
    minElevation: minE === Infinity ? 0 : minE,
    estimatedTime: naismithMinutes(dist, totalAsc, totalDesc, settings),
  };
}

/** 一次過分析：segments + settings → { stats, elevationProfile, analyzedSegments }。 */
export function analyzeRoute(segments: RouteSegment[], settings: NaismithSettings): {
  stats: RouteStats;
  elevationProfile: ElevationProfilePoint[];
  analyzedSegments: RouteSegment[];
} {
  const { analyzedSegments, elevationProfile } = analyzeSegments(segments);
  const stats = computeRouteStats(elevationProfile, analyzedSegments, settings);
  return { stats, elevationProfile, analyzedSegments };
}
