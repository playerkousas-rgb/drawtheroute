import { useMemo } from 'react';
import { RouteSegment, RouteStats, NaismithSettings, ElevationProfilePoint } from '../types';

export function useTerrainAnalysis(segments: RouteSegment[], settings: NaismithSettings) {
  
  // ── 1. 完美的 Elevation profile ───────────────────────────────────────────────────
  // 維持你原本寫得最讚的橫切面點位計算，確保跟畫面 100% 同步
  const elevationProfile: ElevationProfilePoint[] = useMemo(() => {
    const out: ElevationProfilePoint[] = [];
    let cumulativeKm = 0;

    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      for (let i = 0; i < seg.points.length; i++) {
        if (i === 0 && si > 0) continue; // Skip duplicate junction point
        const p = seg.points[i];
        const d = parseFloat((cumulativeKm + p.distanceFromStart).toFixed(3));
        out.push({
          distance: d,
          elevation: Math.round(p.elevation),
          lat: p.lat,
          lng: p.lng,
        });
      }
      if (seg.points.length > 0) {
        cumulativeKm += seg.distance;
      }
    }

    const deduped: ElevationProfilePoint[] = [];
    let lastD = -1;
    for (const pt of out) {
      if (pt.distance > lastD) {
        deduped.push(pt);
        lastD = pt.distance;
      }
    }
    return deduped;
  }, [segments]);

  // ── 2. 修正後的 Route Stats ──────────────────────────────────────────────────────
  // 遵照你的意見：直接用現在橫切面（elevationProfile）的真實數據來算總高度起伏
  const stats: RouteStats = useMemo(() => {
    const empty = { totalDistance: 0, totalAscent: 0, totalDescent: 0, maxElevation: 0, minElevation: 0, estimatedTime: 0 };
    if (!elevationProfile.length) return empty;

    let dist = 0, asc = 0, desc = 0;
    let maxE = -Infinity, minE = Infinity;

    // 取得最後一個點的累積總距離
    dist = elevationProfile[elevationProfile.length - 1].distance;

    // 直接遍歷橫切面的每一個精準點位，現場累加
    for (let i = 0; i < elevationProfile.length; i++) {
      const p = elevationProfile[i];
      
      // 計算最高與最低點
      if (p.elevation > maxE) maxE = p.elevation;
      if (p.elevation < minE) minE = p.elevation;

      // 現場計算點與點之間的真實高度差
      if (i > 0) {
        const prevP = elevationProfile[i - 1];
        const diff = p.elevation - prevP.elevation;
        if (diff > 0) {
          asc += diff;            // 上坡
        } else {
          desc += Math.abs(diff); // 下坡
        }
      }
    }

    const baseMin = (dist / settings.baseSpeedKmh) * 60;
    const ascMin = (asc / 20) * settings.ascentPer20m;
    const descMin = (desc / 20) * settings.descentPer20m;

    return {
      totalDistance: dist,
      totalAscent: Math.round(asc),
      totalDescent: Math.round(desc),
      maxElevation: maxE === -Infinity ? 0 : maxE,
      minElevation: minE === Infinity ? 0 : minE,
      estimatedTime: baseMin + ascMin + descMin,
    };
  }, [elevationProfile, settings]); // 當橫切面數據更新，這裡就跟著即時重算

  return { stats, elevationProfile };
}

export function formatTime(min: number): string {
  if (min < 1) return '--';
  if (min < 60) return `${Math.round(min)} 分`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
