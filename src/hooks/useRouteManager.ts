import { useState, useCallback, useRef } from 'react';
import { LatLng, RouteSegment, RoutePoint, WaypointMarker } from '../types';
import { useBRouter } from './useBRouter';
import { useElevation } from './useElevation';

let _counter = 0;
const uid = (p: string) => `${p}-${Date.now()}-${++_counter}`;

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function buildPoints(
  coords: Array<{ lat: number; lng: number; ele: number }>
): RoutePoint[] {
  let dist = 0;
  return coords.map((c, i) => {
    if (i > 0) dist += haversine(coords[i - 1], c);
    return { lat: c.lat, lng: c.lng, elevation: c.ele, distanceFromStart: dist };
  });
}

function calcStats(pts: RoutePoint[]) {
  let ascent = 0, descent = 0;
  for (let i = 1; i < pts.length; i++) {
    const diff = pts[i].elevation - pts[i - 1].elevation;
    if (diff > 0) ascent += diff;
    else descent += Math.abs(diff);
  }
  return { ascent, descent, distance: pts.at(-1)?.distanceFromStart ?? 0 };
}

function interpolate(from: LatLng, to: LatLng, n = 30): LatLng[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    lat: from.lat + (to.lat - from.lat) * (i / n),
    lng: from.lng + (to.lng - from.lng) * (i / n),
  }));
}

// Re-assign waypoint types based on position in array
function reassignTypes(wps: WaypointMarker[]): WaypointMarker[] {
  return wps.map((w, i) => ({
    ...w,
    type: i === 0 ? 'start' : i === wps.length - 1 ? 'end' : 'waypoint',
  }));
}

export type RoutingMode = 'hiking' | 'straight';

export function useRouteManager() {
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const [waypoints, setWaypoints] = useState<WaypointMarker[]>([]);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('hiking');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const segmentsRef = useRef(segments);
  const waypointsRef = useRef(waypoints);
  segmentsRef.current = segments;
  waypointsRef.current = waypoints;

  const { getHikingRoute } = useBRouter();
  const { fetchElevations } = useElevation();

  // ── Build one segment between two points ──────────────────────────
  const buildSegment = useCallback(async (
    from: LatLng,
    to: LatLng,
    mode: RoutingMode
  ): Promise<RouteSegment> => {
    let pts: RoutePoint[];
    let segMode: RouteSegment['mode'];
    let ascentM: number, descentM: number;

    if (mode === 'hiking') {
      const result = await getHikingRoute(from, to);
      if (result && result.coordinates.length >= 2) {
        pts = buildPoints(result.coordinates);
        segMode = 'auto';
        ascentM = result.ascentM;
        descentM = result.descentM;
      } else {
        // BRouter fallback
        const coords = interpolate(from, to, 40);
        const elevs = await fetchElevations(coords);
        pts = buildPoints(coords.map((c, i) => ({ ...c, ele: elevs[i] ?? 0 })));
        segMode = 'straight';
        const s = calcStats(pts);
        ascentM = s.ascent;
        descentM = s.descent;
      }
    } else {
      const coords = interpolate(from, to, 40);
      const elevs = await fetchElevations(coords);
      pts = buildPoints(coords.map((c, i) => ({ ...c, ele: elevs[i] ?? 0 })));
      segMode = 'straight';
      const s = calcStats(pts);
      ascentM = s.ascent;
      descentM = s.descent;
    }

    return {
      id: uid('seg'),
      points: pts,
      mode: segMode,
      distance: pts.at(-1)?.distanceFromStart ?? 0,
      ascent: ascentM,
      descent: descentM,
    };
  }, [getHikingRoute, fetchElevations]);

  // ── Add waypoint at end ───────────────────────────────────────────
  const addWaypoint = useCallback(async (latlng: LatLng) => {
    setIsProcessing(true);
    setLastError(null);
    try {
      const currentWps = waypointsRef.current;

      if (currentWps.length === 0) {
        const [ele] = await fetchElevations([latlng]);
        setWaypoints([{ id: uid('wp'), latlng, elevation: ele ?? 0, type: 'start' }]);
        return;
      }

      const from = currentWps[currentWps.length - 1];
      const [endEle] = await fetchElevations([latlng]);
      const seg = await buildSegment(from.latlng, latlng, routingMode);

      const newWp: WaypointMarker = {
        id: uid('wp'), latlng,
        elevation: endEle ?? seg.points.at(-1)?.elevation ?? 0,
        type: 'end',
      };

      setWaypoints(prev => reassignTypes([
        ...prev.map((w, i) => i === prev.length - 1 ? { ...w, type: 'waypoint' as const } : w),
        newWp,
      ]));
      setSegments(prev => [...prev, seg]);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : '路線計算失敗');
    } finally {
      setIsProcessing(false);
    }
  }, [routingMode, buildSegment, fetchElevations]);

  // ── Delete a specific waypoint by index ──────────────────────────
  // Logic:
  //   - If deleting index 0 (start): remove wp[0] + seg[0]
  //   - If deleting last index (end): remove wp[last] + seg[last]
  //   - If deleting middle index i: remove wp[i] + seg[i-1] + seg[i],
  //     then rebuild the bridging segment between wp[i-1] and wp[i+1]
  const deleteWaypoint = useCallback(async (wpIndex: number) => {
    const wps = waypointsRef.current;
    const segs = segmentsRef.current;
    if (wps.length === 0) return;

    setIsProcessing(true);
    setLastError(null);
    try {
      if (wps.length === 1) {
        // Only one point, just clear
        setWaypoints([]);
        setSegments([]);
        return;
      }

      if (wpIndex === 0) {
        // Remove first waypoint + first segment
        setWaypoints(prev => reassignTypes(prev.slice(1)));
        setSegments(prev => prev.slice(1));
        return;
      }

      if (wpIndex === wps.length - 1) {
        // Remove last waypoint + last segment
        setWaypoints(prev => reassignTypes(prev.slice(0, -1)));
        setSegments(prev => prev.slice(0, -1));
        return;
      }

      // Middle waypoint: remove it and rebuild bridge segment
      const prevWp = wps[wpIndex - 1];
      const nextWp = wps[wpIndex + 1];

      // Build new segment bridging prev → next
      const bridgeSeg = await buildSegment(prevWp.latlng, nextWp.latlng, routingMode);

      setWaypoints(prev => reassignTypes([
        ...prev.slice(0, wpIndex),
        ...prev.slice(wpIndex + 1),
      ]));
      setSegments(prev => [
        ...prev.slice(0, wpIndex - 1),
        bridgeSeg,
        ...prev.slice(wpIndex + 1),
      ]);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : '刪除路點失敗');
    } finally {
      setIsProcessing(false);
    }
  }, [routingMode, buildSegment]);

  // ── Undo last segment ─────────────────────────────────────────────
  const undoLastSegment = useCallback(() => {
    const segs = segmentsRef.current;
    if (segs.length === 0) {
      setWaypoints([]);
      return;
    }
    setSegments(prev => prev.slice(0, -1));
    setWaypoints(prev => reassignTypes(prev.slice(0, -1)));
  }, []);

  // ── Clear all ─────────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setSegments([]);
    setWaypoints([]);
    setLastError(null);
  }, []);

  // ── Import GPX ────────────────────────────────────────────────────
  const importGPX = useCallback(async (text: string) => {
    setIsProcessing(true);
    setLastError(null);
    try {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('GPX 格式錯誤');
      const trkpts = doc.querySelectorAll('trkpt');
      if (trkpts.length < 2) throw new Error('GPX 點位不足');

      const rawCoords: Array<{ lat: number; lng: number; ele: number }> = [];
      trkpts.forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat') ?? '');
        const lng = parseFloat(pt.getAttribute('lon') ?? '');
        if (isNaN(lat) || isNaN(lng)) return;
        const eleEl = pt.querySelector('ele');
        const ele = eleEl ? parseFloat(eleEl.textContent ?? '') : NaN;
        rawCoords.push({ lat, lng, ele: isNaN(ele) ? 0 : ele });
      });

      const step = Math.max(1, Math.ceil(rawCoords.length / 500));
      let coords = rawCoords.filter((_, i) => i % step === 0);
      if (coords[coords.length - 1] !== rawCoords[rawCoords.length - 1]) {
        coords.push(rawCoords[rawCoords.length - 1]);
      }

      if (coords.some(c => c.ele === 0)) {
        const elevs = await fetchElevations(coords.map(c => ({ lat: c.lat, lng: c.lng })));
        coords = coords.map((c, i) => ({ ...c, ele: elevs[i] ?? c.ele }));
      }

      const pts = buildPoints(coords);
      const { ascent, descent, distance } = calcStats(pts);

      setWaypoints([
        { id: uid('wp'), latlng: { lat: coords[0].lat, lng: coords[0].lng }, elevation: coords[0].ele, type: 'start' },
        { id: uid('wp'), latlng: { lat: coords[coords.length - 1].lat, lng: coords[coords.length - 1].lng }, elevation: coords[coords.length - 1].ele, type: 'end' },
      ]);
      setSegments([{ id: uid('gpx'), points: pts, mode: 'auto', distance, ascent, descent }]);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'GPX 匯入失敗');
    } finally {
      setIsProcessing(false);
    }
  }, [fetchElevations]);

  return {
    segments, waypoints,
    routingMode, setRoutingMode,
    isProcessing, lastError,
    addWaypoint, deleteWaypoint, undoLastSegment, clearAll, importGPX,
  };
}
