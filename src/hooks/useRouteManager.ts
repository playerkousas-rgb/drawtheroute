import { useState, useCallback, useRef } from 'react';
import { LatLng, RouteSegment, RoutePoint, WaypointMarker } from '../types';
import { useBRouter, GeoPoint } from './useBRouter';
import { useElevation } from './useElevation';
import {
  haversineM,
  dedupeByDistance,
  simplifyPath,
  densifyMaxGap,
  limitAnchorCount,
  nearestOnPath,
  matchAnchorsToGeometry,
  interpolateLeg,
  pathLengthM,
} from '../utils/routeGeometry';

let _counter = 0;
const uid = (p: string) => `${p}-${Date.now()}-${++_counter}`;

/** 手繪錨點上限（每次微調最多發幾個 BRouter 請求的保護） */
export const MAX_DRAW_ANCHORS = 36;
/** 手繪原線保留的上限點數（高程剖面效能保護） */
const MAX_STROKE_POINTS = 600;
/** 每個手繪路段的「可拖曳彎位」上限（避免地圖上滿佈手柄） */
const MAX_EDIT_VIAS = 12;
/** 挑選可拖曳彎位時的簡化容差（米）：只保留有意義的轉角 */
const VIA_SIMPLIFY_M = 60;
/** 兩個中間點太近就不再加（避免手柄重疊） */
const MIN_VIA_SPACING_M = 25;

function haversine(a: LatLng, b: LatLng): number {
  // 公里（沿用舊有單位，段內距離以 km 計）
  return haversineM(a, b) / 1000;
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

// Re-assign waypoint types based on position in array
function reassignTypes(wps: WaypointMarker[]): WaypointMarker[] {
  return wps.map((w, i) => ({
    ...w,
    type: i === 0 ? 'start' : i === wps.length - 1 ? 'end' : 'waypoint',
  }));
}

/** 由路段幾何回填路點高度（幾何是唯一真相） */
function refreshWaypointElevations(wps: WaypointMarker[], segs: RouteSegment[]): WaypointMarker[] {
  return wps.map((w, i) => {
    const left = segs[i - 1];
    const right = segs[i];
    let ele = w.elevation;
    if (left?.points.length) ele = left.points[left.points.length - 1].elevation;
    else if (right?.points.length) ele = right.points[0].elevation;
    return ele === w.elevation ? w : { ...w, elevation: ele };
  });
}

function pushUnique(coords: Array<{ lat: number; lng: number; ele: number }>, c: { lat: number; lng: number; ele: number }) {
  const last = coords[coords.length - 1];
  if (last && last.lat === c.lat && last.lng === c.lng) return;
  coords.push(c);
}

export type RoutingMode = 'hiking' | 'straight';

export interface BuiltSegment {
  segment: RouteSegment;
  /** 成功貼路的 leg 數（直線備援的 leg 不計） */
  snappedLegs: number;
  totalLegs: number;
}

export function useRouteManager() {
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const [waypoints, setWaypoints] = useState<WaypointMarker[]>([]);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('hiking');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const segmentsRef = useRef(segments);
  const waypointsRef = useRef(waypoints);
  segmentsRef.current = segments;
  waypointsRef.current = waypoints;

  const { getHikingRoute, getHikingRouteLegs } = useBRouter();
  const { fetchElevations } = useElevation();

  // ── Build one segment between two points（可穿過任意 via 錨點）─────────────
  const buildSegment = useCallback(async (
    from: LatLng,
    to: LatLng,
    mode: RoutingMode,
    vias: LatLng[] = [],
    onProgress?: (done: number, total: number) => void
  ): Promise<BuiltSegment> => {
    const anchors: LatLng[] = [from, ...vias, to];
    const legCount = anchors.length - 1;
    const legs: Array<GeoPoint[] | null> = new Array(legCount).fill(null);
    let snappedLegs = 0;

    if (mode === 'hiking') {
      if (legCount === 1) {
        const result = await getHikingRoute(from, to);
        if (result && result.coordinates.length >= 2) {
          legs[0] = result.coordinates.map(c => ({ lat: c.lat, lng: c.lng, ele: c.ele }));
          snappedLegs = 1;
        }
        onProgress?.(1, 1);
      } else {
        const res = await getHikingRouteLegs(anchors, onProgress);
        for (let i = 0; i < res.length; i++) {
          if (res[i] && res[i]!.length >= 2) {
            legs[i] = res[i];
            snappedLegs++;
          }
        }
      }
    }

    // 未能貼路的 leg → 直線內插 + SRTM 高程備援
    const fallback: Array<{ leg: number; pts: LatLng[] }> = [];
    for (let i = 0; i < legCount; i++) {
      if (!legs[i]) fallback.push({ leg: i, pts: interpolateLeg(anchors[i], anchors[i + 1]) });
    }
    let fallbackEle: number[] = [];
    if (fallback.length > 0) {
      fallbackEle = await fetchElevations(fallback.flatMap(f => f.pts));
    }

    const coords: Array<{ lat: number; lng: number; ele: number }> = [];
    let eleCursor = 0;
    let fbCursor = 0;
    for (let i = 0; i < legCount; i++) {
      const leg = legs[i];
      if (leg) {
        const piece = coords.length === 0 ? leg : leg.slice(1);
        piece.forEach(g => pushUnique(coords, { lat: g.lat, lng: g.lng, ele: g.ele }));
      } else {
        const fb = fallback[fbCursor++];
        if (!fb) continue;
        fb.pts.forEach((p, k) => {
          pushUnique(coords, { lat: p.lat, lng: p.lng, ele: fallbackEle[eleCursor + k] ?? 0 });
        });
        eleCursor += fb.pts.length;
      }
    }

    const pts = buildPoints(coords);
    const s = calcStats(pts);
    const segMode: RouteSegment['mode'] =
      mode === 'hiking' && snappedLegs === legCount && legCount > 0 ? 'auto' : 'straight';

    const segment: RouteSegment = {
      id: uid('seg'),
      points: pts,
      mode: segMode,
      distance: pts.at(-1)?.distanceFromStart ?? s.distance,
      ascent: s.ascent,
      descent: s.descent,
      via: vias.length > 0 ? vias.map(v => ({ ...v })) : undefined,
    };
    return { segment, snappedLegs, totalLegs: legCount };
  }, [getHikingRoute, getHikingRouteLegs, fetchElevations]);

  // ── Build a segment that keeps the hand-drawn geometry as-is ──────────────
  const buildSegmentFromPath = useCallback(async (
    path: LatLng[],
    vias: LatLng[]
  ): Promise<BuiltSegment> => {
    const elevs = await fetchElevations(path);
    const coords = path.map((p, i) => ({ lat: p.lat, lng: p.lng, ele: elevs[i] ?? 0 }));
    const pts = buildPoints(coords);
    const s = calcStats(pts);
    return {
      segment: {
        id: uid('draw'),
        points: pts,
        mode: 'straight',
        distance: pts.at(-1)?.distanceFromStart ?? s.distance,
        ascent: s.ascent,
        descent: s.descent,
        via: vias.length > 0 ? vias.map(v => ({ ...v })) : undefined,
      },
      snappedLegs: 0,
      totalLegs: 1,
    };
  }, [fetchElevations]);

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
      const { segment: seg } = await buildSegment(from.latlng, latlng, routingMode);

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
  //     （保留兩段原有的手動微調點）
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

      const mergedVias = limitAnchorCount([
        ...(segs[wpIndex - 1]?.via ?? []),
        ...(segs[wpIndex]?.via ?? []),
      ], MAX_DRAW_ANCHORS);

      // Build new segment bridging prev → next
      setProgress('重新計算連接路段…');
      const { segment: bridgeSeg } = await buildSegment(
        prevWp.latlng, nextWp.latlng, routingMode, mergedVias
      );

      const nextSegs = [
        ...segs.slice(0, wpIndex - 1),
        bridgeSeg,
        ...segs.slice(wpIndex + 1),
      ];
      setSegments(nextSegs);
      setWaypoints(reassignTypes(refreshWaypointElevations([
        ...wps.slice(0, wpIndex),
        ...wps.slice(wpIndex + 1),
      ], nextSegs)));
    } catch (e) {
      setLastError(e instanceof Error ? e.message : '刪除路點失敗');
    } finally {
      setIsProcessing(false);
      setProgress(null);
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
    setProgress(null);
  }, []);

  // ══════════════════════════════════════════════════════════════════
  //  手動微調（Edit）— 拖曳路點 / 拖曳中間點 / 點擊路線加彎位
  // ══════════════════════════════════════════════════════════════════

  /** 以新的 via 清單重算指定路段 */
  const rebuildSegmentWithVias = useCallback(async (
    segIndex: number,
    vias: LatLng[],
    wps: WaypointMarker[] = waypointsRef.current,
    label = '重新計算路段…'
  ): Promise<RouteSegment | null> => {
    const from = wps[segIndex]?.latlng;
    const to = wps[segIndex + 1]?.latlng;
    if (!from || !to) return null;
    setProgress(label);
    const { segment } = await buildSegment(from, to, routingMode, vias);
    return segment;
  }, [buildSegment, routingMode]);

  const applyVias = useCallback(async (segIndex: number, vias: LatLng[]) => {
    const wps = waypointsRef.current;
    const segs = segmentsRef.current;
    if (!segs[segIndex]) return;
    setIsProcessing(true);
    setLastError(null);
    try {
      const built = await rebuildSegmentWithVias(segIndex, vias, wps);
      if (!built) return;
      const nextSegs = segs.map((s, i) => (i === segIndex ? built : s));
      setSegments(nextSegs);
      setWaypoints(refreshWaypointElevations(wps, nextSegs));
    } catch (e) {
      setLastError(e instanceof Error ? e.message : '路線重算失敗');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [rebuildSegmentWithVias]);

  /** 新增一個中間點（viaIndex = 插在 via 陣列的位置，亦即 leg 索引） */
  const insertVia = useCallback((segIndex: number, viaIndex: number, latlng: LatLng) => {
    const seg = segmentsRef.current[segIndex];
    if (!seg) return;
    const vias = [...(seg.via ?? [])];
    const at = Math.max(0, Math.min(viaIndex, vias.length));
    vias.splice(at, 0, latlng);
    void applyVias(segIndex, vias);
  }, [applyVias]);

  /** 移動一個中間點 */
  const moveVia = useCallback((segIndex: number, viaIndex: number, latlng: LatLng) => {
    const seg = segmentsRef.current[segIndex];
    if (!seg) return;
    const vias = [...(seg.via ?? [])];
    if (viaIndex < 0 || viaIndex >= vias.length) return;
    vias[viaIndex] = latlng;
    void applyVias(segIndex, vias);
  }, [applyVias]);

  /** 刪除一個中間點（回到自動路由） */
  const deleteVia = useCallback((segIndex: number, viaIndex: number) => {
    const seg = segmentsRef.current[segIndex];
    if (!seg) return;
    const vias = [...(seg.via ?? [])];
    if (viaIndex < 0 || viaIndex >= vias.length) return;
    vias.splice(viaIndex, 1);
    void applyVias(segIndex, vias);
  }, [applyVias]);

  /**
   * 沿入程後退（CP 沿線滑動專用）：
   * 在 index 位置插入一個新 CP（= 舊 CP 退到新位置），同時移除原本嘅 CP。
   * 一次過完成，避免出現「先移動再刪除」嘅中間態；
   * 入程前段（wps[index-1] → 新位置）用原本 via 重新貼路，keep 住原本行山線。
   */
  const slideWaypointBackward = useCallback(async (index: number, latlng: LatLng) => {
    const wps = waypointsRef.current;
    const segs = segmentsRef.current;
    if (index <= 0 || index >= wps.length - 1) return;
    const prevWp = wps[index - 1];
    const nextWp = wps[index + 1];
    if (!prevWp || !nextWp) return;

    setIsProcessing(true);
    setLastError(null);
    setProgress('CP 沿路線移動…');
    try {
      // 入程前段：由前一個路點到新位置（保留原本彎位）
      const incoming = await buildSegment(prevWp.latlng, latlng, routingMode, segs[index - 1]?.via ?? []);
      // 後段：新位置直接接到下一個路點（併掉原本兩段，保留雙方彎位）
      const mergedVias = limitAnchorCount([
        ...(segs[index]?.via ?? []),
      ], MAX_DRAW_ANCHORS);
      const outgoing = await buildSegment(latlng, nextWp.latlng, routingMode, mergedVias);

      const newWp: WaypointMarker = {
        id: uid('wp'),
        latlng: { ...latlng },
        elevation: incoming.segment.points.at(-1)?.elevation ?? wps[index].elevation,
        type: 'waypoint',
      };
      const nextSegs = [
        ...segs.slice(0, index - 1),
        incoming.segment,
        outgoing.segment,
        ...segs.slice(index + 1),
      ];
      setSegments(nextSegs);
      setWaypoints(reassignTypes(refreshWaypointElevations([
        ...wps.slice(0, index),
        newWp,
        ...wps.slice(index + 1),
      ], nextSegs)));
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'CP 移動失敗');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [buildSegment, routingMode]);

  /** 移動一個路點（起點 / CP / 終點）→ 重算相鄰路段 */
  const moveWaypoint = useCallback(async (index: number, latlng: LatLng) => {
    const wps = waypointsRef.current;
    const segs = segmentsRef.current;
    if (index < 0 || index >= wps.length) return;

    setIsProcessing(true);
    setLastError(null);
    setProgress('重新計算相鄰路段…');
    try {
      const movedWps = wps.map((w, i) => (i === index ? { ...w, latlng } : w));
      const nextSegs = [...segs];
      const targets: number[] = [];
      if (index > 0) targets.push(index - 1);
      if (index < wps.length - 1) targets.push(index);

      for (const si of targets) {
        const built = await rebuildSegmentWithVias(si, nextSegs[si]?.via ?? [], movedWps);
        if (built) nextSegs[si] = built;
      }

      setSegments(nextSegs);
      setWaypoints(refreshWaypointElevations(movedWps, nextSegs));
    } catch (e) {
      setLastError(e instanceof Error ? e.message : '路點移動失敗');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [rebuildSegmentWithVias]);

  /**
   * 點擊路線 → 在最近的 leg 上加一個中間點。
   * tolM 由地圖依縮放級數換算（約 24 px）。
   */
  const insertViaNear = useCallback(async (latlng: LatLng, tolM: number): Promise<boolean> => {
    const wps = waypointsRef.current;
    const segs = segmentsRef.current;
    if (segs.length === 0) return false;

    let bestSeg = -1;
    let bestLeg = -1;
    let bestDist = Infinity;

    for (let si = 0; si < segs.length; si++) {
      const geom = segs[si].points;
      if (geom.length < 2 || !wps[si] || !wps[si + 1]) continue;

      const hit = nearestOnPath(latlng, geom);
      if (!hit || hit.distM > tolM || hit.distM >= bestDist) continue;

      const anchors = [wps[si].latlng, ...(segs[si].via ?? []), wps[si + 1].latlng];
      const idxs = matchAnchorsToGeometry(anchors, geom);
      let leg = anchors.length - 2;
      for (let k = 0; k < anchors.length - 1; k++) {
        const a = idxs[k];
        const b = idxs[k + 1];
        if (a >= 0 && hit.index >= a && hit.index < Math.max(b, a + 1)) { leg = k; break; }
      }

      bestDist = hit.distM;
      bestSeg = si;
      bestLeg = leg;
    }

    if (bestSeg < 0) return false;

    // 太貼近既有錨點就不加，避免手柄疊在一起
    const seg = segs[bestSeg];
    const anchors = [wps[bestSeg].latlng, ...(seg.via ?? []), wps[bestSeg + 1].latlng];
    for (const a of anchors) {
      if (haversineM(a, latlng) < MIN_VIA_SPACING_M) return false;
    }

    await applyVias(bestSeg, [
      ...(seg.via ?? []).slice(0, bestLeg),
      latlng,
      ...(seg.via ?? []).slice(bestLeg),
    ]);
    return true;
  }, [applyVias]);

  // ══════════════════════════════════════════════════════════════════
  //  手繪（Draw）— 磁石貼路 / 保留手繪原線
  // ══════════════════════════════════════════════════════════════════

  /**
   * 加入一條手繪線。
   * @param raw    手繪原始座標（滑鼠/手指軌跡）
   * @param magnet 是否用 BRouter 吸附山徑（磁石）
   * @param gapM   磁石錨點間距（米）：越細越貼近原線，但請求數越多
   */
  const addDrawnStroke = useCallback(async (
    raw: LatLng[],
    magnet: boolean,
    gapM: number
  ) => {
    if (raw.length < 2) return;
    setIsProcessing(true);
    setLastError(null);
    setProgress('處理手繪路線…');

    try {
      // 1. 清理抖動點（保留足夠細節做高程剖面）
      const stroke = limitAnchorCount(dedupeByDistance(raw, 5), MAX_STROKE_POINTS, 2);
      if (stroke.length < 2 || pathLengthM(stroke) < 15) {
        throw new Error('手繪線太短，請拖曳畫長一點');
      }

      // 2. 磁石錨點：簡化 + 限制間距 + 數量上限
      const epsM = Math.max(10, gapM * 0.4);
      const anchors = limitAnchorCount(
        densifyMaxGap(simplifyPath(stroke, epsM), gapM),
        MAX_DRAW_ANCHORS
      );

      const wps = waypointsRef.current;
      const hasRoute = wps.length > 0;
      const from: LatLng = hasRoute ? wps[wps.length - 1].latlng : anchors[0];
      const endPt: LatLng = anchors.length >= 2 ? anchors[anchors.length - 1] : stroke[stroke.length - 1];

      // 路由用的錨點（可達 MAX_DRAW_ANCHORS 個，貼得較實）
      const routeVias: LatLng[] = hasRoute ? anchors.slice(0, -1) : anchors.slice(1, -1);
      // 顯示給人拖曳的彎位（較少、只保留有意義的轉角，避免滿佈手柄）
      const vias: LatLng[] = limitAnchorCount(simplifyPath(stroke, VIA_SIMPLIFY_M), MAX_EDIT_VIAS)
        .filter(p => haversineM(p, from) > 40 && haversineM(p, endPt) > 40);

      let built: BuiltSegment;
      if (magnet) {
        built = await buildSegment(from, endPt, 'hiking', routeVias, (done, total) =>
          setProgress(`磁石貼路中… ${done}/${total} 段`)
        );
        if (built.snappedLegs === 0 && built.totalLegs > 0) {
          setLastError('磁石貼路失敗（BRouter 無回應），已改用直線連接');
        }
      } else {
        // 關閉磁石 → 保留親手畫的線形，只補 SRTM 高程
        const geom: LatLng[] = hasRoute ? [from, ...stroke] : stroke;
        built = await buildSegmentFromPath(geom, routeVias);
      }
      // 幾何以 routeVias（貼得較實）計算，但手柄只給較精簡的一組
      built.segment.via = vias.length > 0 ? vias.map(v => ({ ...v })) : undefined;

      const seg = built.segment;
      const startElevation = seg.points[0]?.elevation ?? 0;
      const endElevation = seg.points.at(-1)?.elevation ?? 0;
      const endWp: WaypointMarker = {
        id: uid('wp'),
        latlng: { ...endPt },
        elevation: endElevation,
        type: 'end',
      };

      if (!hasRoute) {
        setWaypoints([
          { id: uid('wp'), latlng: { ...from }, elevation: startElevation, type: 'start' },
          endWp,
        ]);
        setSegments([seg]);
      } else {
        setWaypoints(prev => reassignTypes([
          ...prev.map((w, i) => (i === prev.length - 1 ? { ...w, elevation: startElevation } : w)),
          endWp,
        ]));
        setSegments(prev => [...prev, seg]);
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : '手繪路線失敗');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [buildSegment, buildSegmentFromPath]);

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
          const raw = pts.slice(startI, endI + 1);
          // 每段 distanceFromStart 要重新歸零(從段首 0 起算)，否則 useTerrainAnalysis
          // 再用 cumulativeKm 累加時，絕對距離會被重複累加而把總距離算錯
          const segPts = buildPoints(raw.map(r => ({ lat: r.lat, lng: r.lng, ele: r.elevation })));
          const s = calcStats(segPts);
          newSegments.push({
            id: uid('gpx'),
            points: segPts,
            mode: 'auto',
            distance: segPts.at(-1)?.distanceFromStart ?? 0,
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
    isProcessing, lastError, progress,
    addWaypoint, deleteWaypoint, undoLastSegment, clearAll, importGPX,
    // 手動微調
    moveWaypoint, slideWaypointBackward, insertVia, moveVia, deleteVia, insertViaNear,
    // 手繪
    addDrawnStroke,
  };
}
