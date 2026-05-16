import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing, addMinutesToTime, calculateSunrise } from '../utils/coordUtils';
import { WaypointMarker, RouteSegment } from '../types';

export const useItineraryData = (
  waypoints: WaypointMarker[], 
  segments: RouteSegment[], 
  selectedDate: string // 🟢 穩當接球：引入用戶選取的日期
) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    const processData = async () => {
      if (!waypoints || waypoints.length === 0) return;

      const startLoc = waypoints[0].latlng;

      // 🟢 雙引擎核心判斷：計算目標日期與今天相差幾天
      const today = new Date();
      const targetDate = new Date(selectedDate);
      
      // 將時間部分歸零，純粹比較日期天數
      today.setHours(0, 0, 0, 0);
      targetDate.setHours(0, 0, 0, 0);
      const diffTime = targetDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let sunriseTime = "08:30"; // 預設緩衝時間

      // 🚂 引擎 A：日期在 5 天之內（近期），安全呼叫 OpenWeather 獲取實時數據
      if (diffDays >= -1 && diffDays <= 5) {
        if (!weather) {
          try {
            const data = await fetchWeatherData(startLoc.lat, startLoc.lng);
            setWeather(data);
          } catch (e) {
            console.error("OpenWeather 獲取失敗，自動啟動幾何科學公式備援", e);
          }
        }
        // 如果 API 有回傳就用 API，API 沒回傳或報錯則立刻使用幾何公式防崩潰
        sunriseTime = weather?.sunrise || calculateSunrise(startLoc.lat, startLoc.lng, selectedDate);
      } else {
        // 🚂 引擎 B：日期是遠期或歷史，直接調用幾何天文公式計算，100% 免疫 API 報錯
        sunriseTime = calculateSunrise(startLoc.lat, startLoc.lng, selectedDate);
      }

      // 2. 初始化加工變數
      let cumulativeDist = 0;
      let currentTime = sunriseTime; // 🟢 對齊出發原點

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
          // 🟢 統一收線：出發點對齊 sunriseTime，其餘點跟隨 currentTime 骨牌前進
          eta: i === 0 ? sunriseTime : currentTime,
          lat: wp.latlng.lat.toFixed(4),
          lng: wp.latlng.lng.toFixed(4)
        };
      });

      setMaterials(result);
    };

    processData();
    // 🟢 關鍵監聽：當 waypoints, segments 或是用戶「改日期」時，全線時間骨牌全部重算！
  }, [waypoints, segments, weather?.sunrise, selectedDate]);

  return { weather, materials };
};
