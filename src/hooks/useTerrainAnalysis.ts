import { useMemo } from 'react';
import { RouteSegment, RouteStats, NaismithSettings, ElevationProfilePoint } from '../types';
import { analyzeSegments, computeRouteStats } from '../services/routeAnalysis';

/**
 * 路線分析 hook。
 * 計算核心已抽到 `src/services/routeAnalysis.ts`（pure function），
 * 令 embed bridge 同一般 UI 共用同一份邏輯，確保結果絕對對齊。
 * 呢個 hook 只係用 useMemo 包住純函數，行為同之前完全一致。
 */
export function useTerrainAnalysis(segments: RouteSegment[], settings: NaismithSettings) {
  const { elevationProfile, analyzedSegments } = useMemo(
    () => analyzeSegments(segments),
    [segments]
  );

  const stats: RouteStats = useMemo(
    () => computeRouteStats(elevationProfile, analyzedSegments, settings),
    [elevationProfile, analyzedSegments, settings]
  );

  return { stats, elevationProfile, analyzedSegments };
}

export function formatTime(min: number): string {
  if (min < 1) return '--';
  if (min < 60) return `${Math.round(min)} 分`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
