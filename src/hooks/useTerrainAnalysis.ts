import { useMemo } from 'react';
import { RouteSegment, RouteStats, NaismithSettings, ElevationProfilePoint } from '../types';

export function useTerrainAnalysis(segments: RouteSegment[], settings: NaismithSettings) {
  const stats: RouteStats = useMemo(() => {
    const empty = { totalDistance: 0, totalAscent: 0, totalDescent: 0, maxElevation: 0, minElevation: 0, estimatedTime: 0 };
    if (!segments.length) return empty;

    let dist = 0, asc = 0, desc = 0;
    let maxE = -Infinity, minE = Infinity;

    for (const s of segments) {
      dist += s.distance;
      asc += s.ascent;
      desc += s.descent;
      for (const p of s.points) {
        if (p.elevation > maxE) maxE = p.elevation;
        if (p.elevation < minE) minE = p.elevation;
      }
    }

    const baseMin = (dist / settings.baseSpeedKmh) * 60;
    const ascMin = (asc / 20) * settings.ascentPer20m;
    const descMin = (desc / 20) * settings.descentPer20m;

    return {
      totalDistance: dist,
      totalAscent: asc,
      totalDescent: desc,
      maxElevation: maxE === -Infinity ? 0 : maxE,
      minElevation: minE === Infinity ? 0 : minE,
      estimatedTime: baseMin + ascMin + descMin,
    };
  }, [segments, settings]);

  // ── Elevation profile ───────────────────────────────────────────────────────────────
  // Key fix: use a monotonically increasing index-based distance
  // so Recharts XAxis always gets unique, increasing values
  const elevationProfile: ElevationProfilePoint[] = useMemo(() => {
    const out: ElevationProfilePoint[] = [];
    let cumulativeKm = 0;

    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      for (let i = 0; i < seg.points.length; i++) {
        // Skip duplicate junction point between segments
        if (i === 0 && si > 0) continue;
        const p = seg.points[i];
        // Cumulative distance = base of this segment + distance within segment
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

    // Ensure strictly increasing distance (deduplicate same-distance points)
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

  return { stats, elevationProfile };
}

export function formatTime(min: number): string {
  if (min < 1) return '--';
  if (min < 60) return `${Math.round(min)} 分`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
