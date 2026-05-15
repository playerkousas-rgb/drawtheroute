import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing, addMinutesToTime } from '../utils/coordUtils'; // 補上 addMinutesToTime
import { WaypointMarker, RouteSegment, NaismithSettings } from '../types';

export const useItineraryData = (
  waypoints: WaypointMarker[], 
  segments: RouteSegment[],
  naismith: NaismithSettings // 傳入 Naismith 設定
) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    const processData = async () => {
      if (!waypoints || waypoints.length === 0) return;

      // 1. 抓天氣
      if (!weather) {
        const startLoc = waypoints[0].latlng;
        const data = await fetchWeatherData(startLoc.lat, startLoc.lng);
        setWeather(data);
      }

      // 2. 加工全數據
      let cumulativeDist = 0;
      // 初始時間：使用天氣的日出時間，若無則預設 08:00
      let currentTime = weather?.sunrise || "08:00"; 

      const result = waypoints.map((wp, i) => {
        const prevSeg = i > 0 ? segments[i - 1] : null;
        
        // 累計里程 (km)
        if (prevSeg) cumulativeDist += prevSeg.distance;

        // 方位角
        let bearing = 0;
        if (i < waypoints.length - 1) {
          const nextLoc = waypoints[i + 1].latlng;
          bearing = calculateBearing(wp.latlng.lat, wp.latlng.lng, nextLoc.lat, nextLoc.lng);
        }

        // 預計抵達時間 (ETA)
        if (prevSeg) {
          // 這裡對齊 Naismith 算法：(距離 / 時速) * 60 分鐘
          // 後續可以再加上高度加權，目前先做里程累加
          const segmentMinutes = (prevSeg.distance / naismith.baseSpeedKmh) * 60;
          currentTime = addMinutesToTime(currentTime, segmentMinutes);
        }

        return {
          id: wp.id,
          grid: getKKGrid(wp.latlng.lat, wp.latlng.lng),
          bearing: bearing,
          elevation: wp.elevation,
          cumDist: cumulativeDist.toFixed(2), // 補上里程
          eta: currentTime,                  // 補上時間
        };
      });

      setMaterials(result);
    };

    processData();
  }, [waypoints, segments, naismith, weather?.sunrise]);

  return { weather, materials };
};
