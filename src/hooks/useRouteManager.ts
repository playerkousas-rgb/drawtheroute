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
      const seg = await buildSegment(from.latlng, latlng, routingMode);

      // 從計算好的路徑中精確提取起點和終點的高度
      const startElevation = seg.points[0]?.elevation ?? from.elevation;
      const endElevation = seg.points.at(-1)?.elevation ?? 0;

      const newWp: WaypointMarker = {
        id: uid('wp'),
        latlng,
        elevation: endElevation,
        type: 'end',
      };

      setWaypoints(prev => {
        // 1. 先複製一份目前的清單
        const newWps = [...prev];
        // 2. 更新即將變成「中間點」的那個點的高度與類型
        if (newWps.length > 0) {
          const lastIdx = newWps.length - 1;
          newWps[lastIdx] = {
            ...newWps[lastIdx],
            elevation: startElevation,
            type: 'waypoint'
          };
        }
        // 3. 加上新的終點，並重新分配一次 type 確保萬無一失
        return reassignTypes([...newWps, newWp]);
      });

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

      // 跨 namespace 查詢元素：相容外部 GPX 的「預設/前綴 namespace」
      // （getElementsByTagName 對前綴元素會讀不到，故改用 NS 版）
      const byTag = (name: string) => {
        try { return Array.from(doc.getElementsByTagNameNS('*', name)); }
        catch { return Array.from(doc.getElementsByTagName(name)); }
      };

      // 讀取軌跡點：若無 <trkpt> 則退回 <rtept>(路線格式)
      const readCoord = (node: Element) => {
        const lat = parseFloat(node.getAttribute('lat') ?? '');
        const lng = parseFloat(node.getAttribute('lon') ?? '');
        if (isNaN(lat) || isNaN(lng)) return null;
        let eleEl: Element | undefined;
        try { eleEl = node.getElementsByTagNameNS('*', 'ele')[0]; }
        catch { eleEl = node.getElementsByTagName('ele')[0]; }
        const ele = eleEl ? parseFloat(eleEl.textContent ?? '') : NaN;
        const hasEle = eleEl !== undefined && !isNaN(ele);
        return { lat, lng, ele: isNaN(ele) ? 0 : ele, hasEle };
      };

      let trkpts = byTag('trkpt');
      if (trkpts.length === 0) trkpts = byTag('rtept');
      if (trkpts.length < 2) throw new Error('GPX 點位不足');

      // 讀取檢查點 <wpt>（若存在）：保留 CP 結構
      const wptCoords: Array<{ lat: number; lng: number; ele: number }> = [];
      byTag('wpt').forEach(w => {
        const c = readCoord(w);
        if (c) wptCoords.push({ lat: c.lat, lng: c.lng, ele: c.ele });
      });

      const rawCoords: Array<{ lat: number; lng: number; ele: number; hasEle: boolean }> = [];
      trkpts.forEach(pt => {
        const c = readCoord(pt);
        if (c) rawCoords.push(c);
      });

      const step = Math.max(1, Math.ceil(rawCoords.length / 500));
      let coords = rawCoords.filter((_, i) => i % step === 0);
      if (coords[coords.length - 1] !== rawCoords[rawCoords.length - 1]) {
        coords.push(rawCoords[rawCoords.length - 1]);
      }

      // 只為「真正缺少高程」的點補取 SRTM 高程，避免覆蓋 GPX 原本的有效高程
      // (若 API 失敗回傳 0，也只會影響原本就缺高程的點)
      const missingIdx = coords.map((c, i) => c.hasEle ? -1 : i).filter(i => i >= 0);
      if (missingIdx.length > 0) {
        const elevs = await fetchElevations(missingIdx.map(i => ({ lat: coords[i].lat, lng: coords[i].lng })));
        missingIdx.forEach((i, k) => {
          if (elevs[k] !== undefined && elevs[k] > 0) coords[i].ele = elevs[k];
        });
      }

      const pts = buildPoints(coords);
      const { ascent, descent, distance } = calcStats(pts);

      // 若有 <wpt> 檢查點且 ≥2，按檢查點位置把路徑切回多個 segment
      if (wptCoords.length >= 2) {
        // 在路徑上為每個檢查點找最接近的點
        // 只接受「靠近路徑」的檢查點（約 0.0008°≈90m），避免外部 GPX 的雜散
        // waypoint(不在路徑上的地標)被誤當成檢查點而錯誤切段
        const MAX_DIST = 0.0008;
        const closestIdx: Array<{ idx: number; ok: boolean }> = wptCoords.map(w => {
          let bi = 0, bd = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const d = Math.pow(pts[i].lat - w.lat, 2) + Math.pow(pts[i].lng - w.lng, 2);
            if (d < bd) { bd = d; bi = i; }
          }
          return { idx: bi, ok: bd <= MAX_DIST * MAX_DIST };
        });

        // 過濾：起點/終點一定要在路徑上；中間檢查點若遠離路徑則略過
        const kept: number[] = [];
        closestIdx.forEach((c, wi) => {
          if (!c.ok && wi !== 0 && wi !== wptCoords.length - 1) return; // 略過不在路徑上的中間點
          if (kept.length === 0 || c.idx > kept[kept.length - 1]) kept.push(c.idx);
        });
        const idxs = kept;

        const newSegments: RouteSegment[] = [];
        for (let i = 0; i < idxs.length - 1; i++) {
          const startI = idxs[i];
          const endI = idxs[i + 1];
          if (endI - startI < 1) continue;
          const segPts = pts.slice(startI, endI + 1);
          const s = calcStats(segPts);
          newSegments.push({
            id: uid('gpx'),
            points: segPts,
            mode: 'auto',
            distance: (segPts.at(-1)?.distanceFromStart ?? 0) - segPts[0].distanceFromStart,
            ascent: s.ascent,
            descent: s.descent,
          });
        }
        if (newSegments.length > 0) {
          setWaypoints(idxs.map((idx, i) => ({
            id: uid('wp'),
            latlng: { lat: pts[idx].lat, lng: pts[idx].lng },
            elevation: pts[idx].elevation,
            type: i === 0 ? 'start' : i === idxs.length - 1 ? 'end' : 'waypoint',
          })));
          setSegments(newSegments);
          return;
        }
      }

      // 沒有 <wpt>（或 CP 結構不完整）→ 退化成起點/終點單一路段
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
