import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing, addMinutesToTime } from '../utils/coordUtils';
import { WaypointMarker, RouteSegment } from '../types';

export const useItineraryData = (waypoints: WaypointMarker[], segments: RouteSegment[]) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    const processData = async () => {
      if (!waypoints || waypoints.length === 0) return;

      // 1. 抓天氣
      if (!weather) {
        try {
          const startLoc = waypoints[0].latlng;
          const data = await fetchWeatherData(startLoc.lat, startLoc.lng);
          setWeather(data);
        } catch (e) { console.error("Weather fetch failed", e); }
      }

      // 2. 初始化加工變數
      let cumulativeDist = 0;
      let currentTime = weather?.sunrise || "08:30"; 

      // 3. 全數據加工循環
      const result = waypoints.map((wp, i) => {
        const prevSeg = i > 0 ? segments[i - 1] : null;
        
        // 累計里程計算
        if (prevSeg) cumulativeDist += prevSeg.distance;

        // 預計抵達時間計算 (Naismith 基礎邏輯: 4km/h)
        if (prevSeg) {
          const segmentMinutes = (prevSeg.distance / 4.0) * 60;
          currentTime = addMinutesToTime(currentTime, segmentMinutes);
        }

        // 方位角計算 (看向下一站)
        let bearing = 0;
        if (i < waypoints.length - 1) {
          const nextLoc = waypoints[i + 1].latlng;
          bearing = calculateBearing(wp.latlng.lat, wp.latlng.lng, nextLoc.lat, nextLoc.lng);
        }

        return {
          id: wp.id,
          name: wp.type === 'start' ? '起點' : wp.type === 'end' ? '終點' : `CP${i}`,
          grid: getKKGrid(wp.latlng.lat, wp.latlng.lng),
          bearing: bearing,
          elevation: wp.elevation,
          cumDist: cumulativeDist.toFixed(2),
          eta: i === 0 ? (weather?.sunrise || "08:30") : currentTime,
          lat: wp.latlng.lat.toFixed(4),
          lng: wp.latlng.lng.toFixed(4)
        };
      });

      setMaterials(result);
    };

    processData();
  }, [waypoints, segments, weather?.sunrise]);

  return { weather, materials };
};
