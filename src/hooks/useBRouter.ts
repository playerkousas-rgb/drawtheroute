import { useCallback } from 'react';
import { LatLng } from '../types';

export interface BRouterResult {
  coordinates: Array<{ lat: number; lng: number; ele: number }>;
  distanceM: number;
  ascentM: number;
  descentM: number;
}

const BROUTER = 'https://brouter.de/brouter';

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

      // ── 數據處理 ──
      const raw: [number, number, number][] = feature.geometry.coordinates;
      
      // 核心修改：確保這段路徑的「頭」和「尾」高度與傳入的 LatLng (來自地圖/右側欄) 完全一致
      const coordinates = raw.map(([lng, lat, ele], idx) => {
        let finalEle = ele ?? 0;
        
        // 如果是第一個點，強行對齊起點高度
        if (idx === 0 && from.elevation !== undefined) {
          finalEle = from.elevation;
        } 
        // 如果是最後一個點，強行對齊終點高度
        else if (idx === raw.length - 1 && to.elevation !== undefined) {
          finalEle = to.elevation;
        }

        return { lat, lng, ele: finalEle };
      });

      // 解析統計數據
      const props = feature.properties ?? {};
      const distanceM = parseFloat(props['track-length'] ?? '0');
      const ascentM = parseFloat(props['filtered ascend'] ?? '0');
      const plainAscend = parseFloat(props['plain-ascend'] ?? '0');
      const descentM = plainAscend < 0 ? Math.abs(plainAscend) : 0;

      return { coordinates, distanceM, ascentM, descentM };
    } catch (err) {
      console.warn('[BRouter] failed:', err);
      return null;
    }
  }, []);

  return { getHikingRoute };
}
