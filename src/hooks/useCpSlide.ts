import { useEffect, useMemo, useRef } from 'react';
import { LatLng, RouteSegment, WaypointMarker } from '../types';
import { nearestOnPath, haversineM } from '../utils/routeGeometry';

/**
 * useCpSlide — 「CP 沿線滑動」引擎
 *
 * 目的：在地圖／橫切面把 CP 拖到路線**沿途**的位置時，來回都沿住實際路線移動，
 * 而唔會令路線被拉成一條直線。
 *
 * 原理：CP 前方（入程 segments[i-1]）與後方（出程 segments[i]）各自已經有一條
 * 貼路幾何。把目標點投影到兩條幾何上：
 *  - 目標較貼近**出程** → 直接移動 CP，出程由新位置重新貼路（沿路線滑動）
 *  - 目標較貼近**入程** → 先在新位置插入一個 CP，再刪除舊 CP（原地「併段」：
 *    保留入程原線，只有新位置之後重算）
 *
 * 目標離兩條幾何都太遠（> 400m，例如一次性大搬遷）→ 直接自由移動（舊行為）。
 *
 * 拖曳期間的請求會用「最新優先（latest wins）」序列化處理：
 *  - 重算進行中收到新目標 → 只保留最新一個，完成後立即執行
 *  - 中間發生「插入＋刪除」時，索引會自動改跟新 CP 位置，
 *    確保連續拖曳仍然鎖住同一個 CP（唔會拉錯點）
 */
const SNAP_TOL_M = 400;

export type CpMoveKind = 'move' | 'backtrack';

export interface CpMove {
  /** move = 直接移動 CP（出程重算）；backtrack = 沿入程後退（插入新 CP 並移除舊 CP） */
  kind: CpMoveKind;
  /** CP 索引（backtrack 時新 CP 會佔用同一個索引） */
  index: number;
  /** 新位置 */
  latlng: LatLng;
  /** 是否沿線滑動（否則為自由移動） */
  slid: boolean;
}

export interface CpSlideHooks {
  /** 直接移動路點 */
  onMove: (index: number, latlng: LatLng) => Promise<void> | void;
  /** 沿入程後退（插入＋移除，一次過） */
  onBacktrack: (index: number, latlng: LatLng) => Promise<void> | void;
}

export function useCpSlide(
  waypoints: WaypointMarker[],
  segments: RouteSegment[],
  hooks: CpSlideHooks
) {
  const paths = useMemo(
    () => segments.map(s => s.points.map(p => ({ lat: p.lat, lng: p.lng }))),
    [segments]
  );

  const translate = useMemo(() => (
    (index: number, target: LatLng): CpMove | null => {
      const n = waypoints.length;
      if (index < 0 || index >= n) return null;

      // 起點／終點：直接移動（唔存在「沿線滑動」）
      if (index === 0 || index === n - 1) {
        return { kind: 'move', index, latlng: target, slid: false };
      }

      const before = paths[index - 1];
      const after  = paths[index];
      let best: { seg: number; distM: number } | null = null;

      if (before && before.length >= 2) {
        const hit = nearestOnPath(target, before);
        if (hit) best = { seg: index - 1, distM: hit.distM };
      }
      if (after && after.length >= 2) {
        const hit = nearestOnPath(target, after);
        if (hit && (!best || hit.distM < best.distM)) best = { seg: index, distM: hit.distM };
      }

      if (!best || best.distM > SNAP_TOL_M) {
        return { kind: 'move', index, latlng: target, slid: false };
      }

      if (best.seg === index) {
        // 沿出程滑動（向前或向後），出程會由新位置重新貼路
        return { kind: 'move', index, latlng: target, slid: true };
      }

      // 沿入程向後：原地後退（保留入程原線，只有後半段重算）
      return { kind: 'backtrack', index, latlng: target, slid: true };
    }
  ), [waypoints, paths]);

  // 保持最新版本，令 async 佇列每一步都用最新幾何／路點
  const translateRef = useRef(translate);
  const hooksRef = useRef(hooks);
  useEffect(() => { translateRef.current = translate; }, [translate]);
  useEffect(() => { hooksRef.current = hooks; }, [hooks]);

  const pendingRef = useRef<{ index: number; target: LatLng } | null>(null);
  const runningRef = useRef(false);
  const waitersRef = useRef<Array<() => void>>([]);

  const drain = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (pendingRef.current) {
        const { index, target } = pendingRef.current;
        pendingRef.current = null;

        const move = translateRef.current(index, target);
        if (!move) continue;

        if (move.kind === 'backtrack') {
          await hooksRef.current.onBacktrack(move.index, move.latlng);
        } else {
          await hooksRef.current.onMove(move.index, move.latlng);
        }
        // 讓 React 套用最新路點／幾何，下一步才用得到新 index
        await new Promise(r => setTimeout(r, 16));
      }
    } finally {
      runningRef.current = false;
      const waiters = waitersRef.current;
      waitersRef.current = [];
      waiters.forEach(w => w());
    }
  };

  /** 送出一次 CP 目標位置（拖曳時可連續呼叫，會自動序列化為最新優先） */
  const slide = useMemo(() => (
    (index: number, target: LatLng): Promise<boolean> => {
      if (index < 0 || index >= waypoints.length) return Promise.resolve(false);
      pendingRef.current = { index, target };
      const done = new Promise<boolean>(resolve => {
        waitersRef.current.push(() => resolve(true));
      });
      void drain();
      return done;
    }
  ), [waypoints.length]);

  /** 目標點同相鄰兩條幾何的最短距離（供 UI 判斷係唔係「沿途」） */
  const distanceTo = useMemo(() => (
    (index: number, target: LatLng): number => {
      let best = Infinity;
      for (const si of [index - 1, index]) {
        const path = paths[si];
        if (!path || path.length < 2) continue;
        const hit = nearestOnPath(target, path);
        if (hit && hit.distM < best) best = hit.distM;
      }
      return best;
    }
  ), [paths]);

  /** 目標點與原來 CP 位置的直線距離（拖曳距離感） */
  const distanceAlong = useMemo(() => (
    (index: number, target: LatLng): number => {
      const wp = waypoints[index];
      return wp ? haversineM(wp.latlng, target) : 0;
    }
  ), [waypoints]);

  return { slide, translate, distanceTo, distanceAlong, snapToleranceM: SNAP_TOL_M };
}
