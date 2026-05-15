import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing } from '../utils/coordUtils';
import { WaypointMarker, RouteSegment } from '../types';

export const useItineraryData = (waypoints: WaypointMarker[], segments: RouteSegment[]) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    const processData = async () => {
      if (!waypoints || waypoints.length === 0) return;

      // 1. 抓天氣 (起點座標是 waypoints[0].latlng)
      if (!weather) {
        const startLoc = waypoints[0].latlng;
        const data = await fetchWeatherData(startLoc.lat, startLoc.lng);
        setWeather(data);
      }

      // 2. 加工資料 (使用 .latlng.lat 和 .latlng.lng)
      const result = waypoints.map((wp, i) => {
        let bearing = 0;
        if (i < waypoints.length - 1) {
          const currentLoc = wp.latlng;
          const nextLoc = waypoints[i + 1].latlng;
          bearing = calculateBearing(
            currentLoc.lat, currentLoc.lng, 
            nextLoc.lat, nextLoc.lng
          );
        }

        return {
          id: wp.id,
          grid: getKKGrid(wp.latlng.lat, wp.latlng.lng), // 這裡也修正了
          bearing: bearing,
          elevation: wp.elevation,
        };
      });

      setMaterials(result);
    };

    processData();
  }, [waypoints, segments]);

  return { weather, materials };
};
