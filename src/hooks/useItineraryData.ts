import { useState, useEffect } from 'react';
// 1. 從根目錄的 services 抓取工具
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
// 2. 從 src/utils 抓取地理運算工具
import { calculateBearing } from '../utils/coordUtils';
// 3. 引入類型定義
import { WaypointMarker, RouteSegment } from '../types';

export const useItineraryData = (waypoints: WaypointMarker[], segments: RouteSegment[]) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    const processData = async () => {
      // 如果還沒有點位，就什麼都不做
      if (!waypoints || waypoints.length === 0) return;

      // 【加工 1：抓天氣】
      // 只在還沒有天氣資料時，抓一次起點的天氣
      if (!weather) {
        const startLoc = waypoints[0].latlng;
        const data = await fetchWeatherData(startLoc.lat, startLoc.lng);
        setWeather(data);
      }

      // 【加工 2：拼裝路書食材】
      const result = waypoints.map((wp, i) => {
        // 計算這一站看向下一站的「方位角」
        let bearing = 0;
        if (i < waypoints.length - 1) {
          const currentLoc = wp.latlng;
          const nextLoc = waypoints[i + 1].latlng;
          bearing = calculateBearing(
            currentLoc.lat, currentLoc.lng, 
            nextLoc.lat, nextLoc.lng
          );
        }

        // 回傳這一站加工後的完整資訊
        return {
          id: wp.id,
          // 這裡呼叫 services 裡的網格轉換
          grid: getKKGrid(wp.latlng.lat, wp.latlng.lng), 
          bearing: bearing,
          elevation: wp.elevation,
        };
      });

      // 把加工好的成品存起來
      setMaterials(result);
    };

    processData();
    // 當點位有變動、或者路段有變動時，重新加工
  }, [waypoints, segments]);

  // 對外輸出：天氣成品、點位加工成品
  return { weather, materials };
};
