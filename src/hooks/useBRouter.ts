import { useCallback } from 'react';
import { LatLng } from '../types';

export interface BRouterResult {
  coordinates: Array<{ lat: number; lng: number; ele: number }>;
  distanceM: number;
  ascentM: number;
  descentM: number;
}

// BRouter public server — hiking-mountain profile follows footways, trails, steps
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

      // BRouter GeoJSON coords = [lon, lat, ele]
      const raw: [number, number, number][] = feature.geometry.coordinates;
      const coordinates = raw.map(([lng, lat, ele]) => ({ lat, lng, ele: ele ?? 0 }));

      // Parse stats from properties
      const props = feature.properties ?? {};
      const distanceM = parseFloat(props['track-length'] ?? '0');
      // filtered ascend is the clean ascent (noise-filtered)
      const ascentM = parseFloat(props['filtered ascend'] ?? '0');
      // plain-ascend can be negative = net descent
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
