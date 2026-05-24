import { useCallback } from 'react';
import { LatLng } from '../types';

const TOPO_API = 'https://api.opentopodata.org/v1/srtm30m';

export function useElevation() {
  const fetchElevations = useCallback(async (points: LatLng[]): Promise<number[]> => {
    if (points.length === 0) return [];
    const results: number[] = [];
    const chunkSize = 100;
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      const locationStr = chunk.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
      try {
        const res = await fetch(`${TOPO_API}?locations=${locationStr}&interpolation=bilinear`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        results.push(...data.results.map((r: { elevation: number | null }) => r.elevation ?? 0));
      } catch {
        results.push(...chunk.map(() => 0));
      }
    }
    return results;
  }, []);

  const fetchGridElevations = useCallback(async (
    north: number, south: number, east: number, west: number,
    gridSize: number
  ): Promise<number[][]> => {
    const grid: number[][] = [];
    const latStep = (north - south) / (gridSize - 1);
    const lngStep = (east - west) / (gridSize - 1);
    const allPts: LatLng[] = [];
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        allPts.push({
          lat: north - row * latStep,
          lng: west + col * lngStep,
        });
      }
    }
    const elevs = await fetchElevations(allPts);
    for (let row = 0; row < gridSize; row++) {
      grid.push(elevs.slice(row * gridSize, (row + 1) * gridSize));
    }
    return grid;
  }, [fetchElevations]);

  return { fetchElevations, fetchGridElevations };
}
