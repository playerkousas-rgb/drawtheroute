import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing, addMinutesToTime } from '../utils/coordUtils';
import { WaypointMarker, RouteSegment, NaismithSettings } from '../types';

export const useItineraryData = (
  waypoints: WaypointMarker[], 
  segments: RouteSegment[], 
  naismith: NaismithSettings
) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    const processData = async () => {
      if (!waypoints || waypoints.length === 0) return;

      // 1. 獲取起點天氣 (僅在有起點時抓取一次)
      if (!weather) {
        const startWp = waypoints[0];
        const weatherData = await fetchWeatherData(startWp.lat, startWp.lng);
        setWeather(weatherData);
      }

      // 2. 加工路徑點數據
      let cumulativeDist = 0;
      let currentTime = weather?.sunrise || "08:00"; // 如果沒天氣數據，預設 8 點出發

      const processed = waypoints.map((wp, i) => {
        const prevSeg = i > 0 ? segments[i - 1] : null;
        
        // 累計里程
        if (prevSeg) cumulativeDist += prevSeg.distance;

        // 計算方位 (看向下一個點)
        let bearing = 0;
        if (i < waypoints.length - 1) {
          const nextWp = waypoints[i + 1];
          bearing = calculateBearing(wp.lat, wp.lng, nextWp.lat, nextWp.lng);
        }

        // 估算抵達時間 (ETA)
        // 注意：這裡簡化計算，實際 Naismith 邏輯應在 stats 預算好，我們這裡做累加顯示
        if (prevSeg) {
          // 這裡我們暫時用一個基礎邏輯推算，後續可再精確對齊你的 stats
          const segmentTime = (prevSeg.distance / naismith.baseSpeedKmh) * 60; 
          currentTime = addMinutesToTime(currentTime, segmentTime);
        }

        return {
          id: wp.id,
          name: wp.type === 'start' ? '起點' : wp.type === 'end' ? '終點' : `CP ${i}`,
          kkGrid: getKKGrid(wp.lat, wp.lng),
          cumDist: cumulativeDist.toFixed(2),
          bearing: bearing,
          elevation: wp.elevation,
          eta: i === 0 ? (weather?.sunrise || "08:00") : currentTime
        };
      });

      setMaterials(processed);
    };

    processData();
  }, [waypoints, segments, naismith, weather?.sunrise]);

  return { weather, materials };
};
