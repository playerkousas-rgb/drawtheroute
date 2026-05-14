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

      const raw: [number, number, number][] = feature.geometry.coordinates;

      // ── 在這裡替換了原本的那行代碼 ──
      const coordinates = raw.map(([lng, lat, ele], idx) => {
        let finalEle = ele ?? 0;
        
        // 使用 as any 避開 TypeScript 對 elevation 屬性的檢查報錯
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
      const ascentM = parseFloat(props['filtered ascend'] ?? '0');
      const plainAscend = parseFloat(props['plain-asc-desc'] || props['plain-ascend'] || '0');
      const descentM = plainAscend < 0 ? Math.abs(plainAscend) : 0;

      return { coordinates, distanceM, ascentM, descentM };
    } catch (err) {
      console.warn('[BRouter] failed:', err);
      return null;
    }
  }, []);

  return { getHikingRoute };
}
