import { useCallback } from 'react';
import { LatLng } from '../types';

export interface OSRMRoute {
  coordinates: LatLng[];
  distance: number;
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function interpolateStraight(from: LatLng, to: LatLng, steps = 20): LatLng[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: from.lat + (to.lat - from.lat) * (i / steps),
    lng: from.lng + (to.lng - from.lng) * (i / steps),
  }));
}

export function useOSRM() {
  const getRoute = useCallback(async (from: LatLng, to: LatLng): Promise<OSRMRoute> => {
    try {
      const url = `https://router.project-osrm.org/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('OSRM error');
      const data = await res.json();
      if (!data.routes?.length) throw new Error('No route');
      const coords: LatLng[] = data.routes[0].geometry.coordinates.map(
        (c: [number, number]) => ({ lat: c[1], lng: c[0] })
      );
      return { coordinates: coords, distance: data.routes[0].distance / 1000 };
    } catch {
      const coords = interpolateStraight(from, to, 20);
      return { coordinates: coords, distance: haversine(from, to) };
    }
  }, []);

  return { getRoute };
}
