import { useMemo } from 'react';
import { RouteSegment, RouteStats, NaismithSettings, ElevationProfilePoint } from '../types';

export function useTerrainAnalysis(segments: RouteSegment[], settings: NaismithSettings) {
  
  // ── 1. 同步分析路段與橫切面 ──────────────────────────────────────────────────────
  // 遵照你的最高指導原則：既然橫切面數據最準，我們在產出橫切面的同時，順便把每一段的爬升下降重算乾淨！
  const { elevationProfile, analyzedSegments } = useMemo(() => {
    const outProfile: ElevationProfilePoint[] = [];
    const outSegments: RouteSegment[] = [];
    let cumulativeKm = 0;

    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      
      // 現場為這一個獨立路段建立局部的爬升與下降計數器
      let segAsc = 0;
      let segDesc = 0;

      for (let i = 0; i < seg.points.length; i++) {
        const p = seg.points[i];
        
        // 現場重算這一段內部的點位高度起伏，解決 BRouter 欄位下山變 0 的問題
        if (i > 0) {
          const prevP = seg.points[i - 1];
          const diff = p.elevation - prevP.elevation;
          if (diff > 0) segAsc += diff;
          else segDesc += Math.abs(diff);
        }

        // 原本寫得最讚的橫切面攤平邏輯
        if (i === 0 && si > 0) continue; 
        const d = parseFloat((cumulativeKm + p.distanceFromStart).toFixed(3));
        outProfile.push({
          distance: d,
          elevation: Math.round(p.elevation),
          lat: p.lat,
          lng: p.lng,
        });
      }

      // 將這個路段複製一份，但把原本髒掉、壞掉的 ascent / descent 用剛才現場算好的精準數值強行覆蓋！
      outSegments.push({
        ...seg,
        ascent: Math.round(segAsc),
        descent: Math.round(segDesc)
      });

      if (seg.points.length > 0) {
        cumulativeKm += seg.distance;
      }
    }

    // 原本寫得最讚的去重疊邏輯
    const deduped: ElevationProfilePoint[] = [];
    let lastD = -1;
    for (const pt of outProfile) {
      if (pt.distance > lastD) {
        deduped.push(pt);
        lastD = pt.distance;
      }
    }

    return { elevationProfile: deduped, analyzedSegments: outSegments };
  }, [segments]);

  // ── 2. 完美的總統計 ──────────────────────────────────────────────────────
  const stats: RouteStats = useMemo(() => {
    const empty = { totalDistance: 0, totalAscent: 0, totalDescent: 0, maxElevation: 0, minElevation: 0, estimatedTime: 0 };
    if (!elevationProfile.length) return empty;

    let dist = elevationProfile[elevationProfile.length - 1].distance;
    let maxE = -Infinity, minE = Infinity;
    
    // 總和直接從我們剛剛洗乾淨的 analyzedSegments 累加，確保總體與分段數據在物理上絕對對齊
    let totalAsc = 0;
    let totalDesc = 0;
    for (const seg of analyzedSegments) {
      totalAsc += seg.ascent;
      totalDesc += seg.descent;
    }

    for (const p of elevationProfile) {
      if (p.elevation > maxE) maxE = p.elevation;
      if (p.elevation < minE) minE = p.elevation;
    }

    const baseMin = (dist / settings.baseSpeedKmh) * 60;
    const ascMin = (totalAsc / 20) * settings.ascentPer20m;
    const descMin = (totalDesc / 20) * settings.descentPer20m;

    return {
      totalDistance: dist,
      totalAscent: totalAsc,
      totalDescent: totalDesc,
      maxElevation: maxE === -Infinity ? 0 : maxE,
      minElevation: minE === Infinity ? 0 : minE,
      estimatedTime: baseMin + ascMin + descMin,
    };
  }, [elevationProfile, analyzedSegments, settings]);

  // 🔴 妙招在這裡：我們除了原本的東西，順便把洗乾淨的 analyzedSegments 也回傳出去！
  return { stats, elevationProfile, analyzedSegments };
}

export function formatTime(min: number): string {
  if (min < 1) return '--';
  if (min < 60) return `${Math.round(min)} 分`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
