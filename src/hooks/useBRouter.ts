import { useCallback } from 'react';
import { LatLng } from '../types';
import { matchAnchorsToGeometry } from '../utils/routeGeometry';

export interface BRouterResult {
  coordinates: Array<{ lat: number; lng: number; ele: number }>;
  distanceM: number;
  ascentM: number;
  descentM: number;
}

export type GeoPoint = { lat: number; lng: number; ele: number };

const BROUTER = 'https://brouter.de/brouter';

/** 多點（磁石）請求：每個 request 最多幾個錨點（= legs + 1） */
const MULTI_MAX_ANCHORS = 9;
/** 逐段重試上限（避免離線時狂發請求） */
const RETRY_MAX_LEGS = 16;
const RETRY_CONCURRENCY = 4;

export function useBRouter() {
  const getHikingRoute = useCallback(async (
    from: LatLng,
    to: LatLng
  ): Promise<BRouterResult | null> => {
    try {
      const url =
        `${BROUTER}?lonlats=${from.lng.toFixed(6)},${from.lat.toFixed(6)}|${to.lng.toFixed(6)},${to.lat.toFixed(6)}` +
        `&profile=hiking-mountain&alternativeidx=0&format=geojson`;

      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);

      const geojson = await res.json();
      const feature = geojson?.features?.[0];
      if (!feature) throw new Error('No feature in BRouter response');

      const raw: [number, number, number][] = feature.geometry.coordinates;

      const coordinates = raw.map(([lng, lat, ele], idx) => {
        let finalEle = ele ?? 0;
        
        const startPoint = from as any;
        const endPoint = to as any;

        if (idx === 0 && startPoint.elevation !== undefined) {
          finalEle = startPoint.elevation;
        } 
        else if (idx === raw.length - 1 && endPoint.elevation !== undefined) {
          finalEle = endPoint.elevation;
        }

        return { lat, lng, ele: finalEle };
      });

      const props = feature.properties ?? {};
      const distanceM = parseFloat(props['track-length'] ?? '0');
      
      // 精確對齊 BRouter 官方過濾去噪後的爬升與下降欄位
      const ascentM = parseFloat(props['filtered ascend'] ?? '0');
      const descentM = parseFloat(
        props['filtered descend'] ?? 
        props['filtered descent'] ?? 
        props['plain-descend'] ?? 
        '0'
      );

      return { coordinates, distanceM, ascentM, descentM };
    } catch (err) {
      console.warn('[BRouter] failed:', err);
      return null;
    }
  }, []);

  /**
   * 一次過多點（via points）路由：`lonlats=a|b|c|…`
   * BRouter 會依序穿過所有錨點，回傳合併後的一條幾何線。
   */
  const getMultiPointRoute = useCallback(async (anchors: LatLng[]): Promise<GeoPoint[] | null> => {
    if (anchors.length < 2) return null;
    try {
      const lonlats = anchors.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join('|');
      const url = `${BROUTER}?lonlats=${lonlats}&profile=hiking-mountain&alternativeidx=0&format=geojson`;

      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);

      const geojson = await res.json();
      const feature = geojson?.features?.[0];
      if (!feature) throw new Error('No feature in BRouter response');

      const raw: [number, number, number][] = feature.geometry.coordinates;
      if (!raw || raw.length < 2) throw new Error('Empty geometry');

      return raw.map(([lng, lat, ele]) => ({ lat, lng, ele: ele ?? 0 }));
    } catch (err) {
      console.warn('[BRouter] multipoint failed:', err);
      return null;
    }
  }, []);

  /**
   * 錨點鏈 → 每一段（leg）的 BRouter 幾何。
   * 回傳陣列長度 = anchors.length - 1，`null` 代表該段未能貼路（呼叫方需用直線備援）。
   *
   * 策略（三層）：
   *  1. 分塊多點請求（每塊 9 個錨點）— 正常情況只需 1～數個請求
   *  2. 個別 leg 重試（僅在伺服器可用時，最多 16 段、併發 4）
   *  3. 交由呼叫方用直線內插備援
   */
  const getHikingRouteLegs = useCallback(async (
    anchors: LatLng[],
    onProgress?: (done: number, total: number) => void
  ): Promise<Array<GeoPoint[] | null>> => {
    const legCount = anchors.length - 1;
    const legs: Array<GeoPoint[] | null> = new Array(Math.max(legCount, 0)).fill(null);
    if (legCount < 1) return legs;

    const runs: Array<[number, number]> = [];
    for (let s = 0; s < legCount; s += MULTI_MAX_ANCHORS - 1) {
      runs.push([s, Math.min(s + MULTI_MAX_ANCHORS - 1, legCount)]);
    }

    let serverAlive = false;
    let done = 0;
    for (const [s, e] of runs) {
      const chunkAnchors = anchors.slice(s, e + 1);
      const geo = await getMultiPointRoute(chunkAnchors);

      if (geo) {
        serverAlive = true;
        const idxs = matchAnchorsToGeometry(chunkAnchors, geo);
        for (let k = 0; k < chunkAnchors.length - 1; k++) {
          const a = idxs[k];
          const b = idxs[k + 1];
          if (a >= 0 && b > a) legs[s + k] = geo.slice(a, b + 1);
        }
      }

      done += chunkAnchors.length - 1;
      onProgress?.(Math.min(done, legCount), legCount);
    }

    // 只有確認過伺服器可用，才值得逐段重試（離線時直接走直線備援）
    const missing = legs.map((l, i) => (l ? -1 : i)).filter(i => i >= 0);
    if (serverAlive && missing.length > 0 && missing.length <= RETRY_MAX_LEGS) {
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(RETRY_CONCURRENCY, missing.length) }, async () => {
          while (cursor < missing.length) {
            const i = missing[cursor++];
            const r = await getHikingRoute(anchors[i], anchors[i + 1]);
            if (r && r.coordinates.length >= 2) {
              legs[i] = r.coordinates.map(c => ({ lat: c.lat, lng: c.lng, ele: c.ele }));
            }
          }
        })
      );
    }

    return legs;
  }, [getHikingRoute, getMultiPointRoute]);

  return { getHikingRoute, getMultiPointRoute, getHikingRouteLegs };
}
