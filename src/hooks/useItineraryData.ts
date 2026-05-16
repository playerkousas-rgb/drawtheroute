import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing, addMinutesToTime, calculateSunrise } from '../utils/coordUtils';
import { WaypointMarker, RouteSegment } from '../types';

export const useItineraryData = (
  waypoints: WaypointMarker[], 
  segments: RouteSegment[], 
  selectedDate: string // 🟢 穩當接收：大表格傳進來的用戶選取日期
) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  // 🚂 引擎 A：獨立負責「氣象與天文數據」，只要日期一變，就算還沒畫地圖也要抓得到預設值！
  useEffect(() => {
    const fetchWeatherOnly = async () => {
      // 預設參考點（如果沒畫地圖，預設拿香港市中心或預設座標，避免斷流；若有點，則拿第一個點的坐標）
      const lat = waypoints && waypoints.length > 0 ? waypoints[0].latlng.lat : 22.3193;
      const lng = waypoints && waypoints.length > 0 ? waypoints[0].latlng.lng : 114.1694;

      try {
        // 動態戳全球引擎：直接把經緯度與日期拋給 Open-Meteo
        const data = await fetchWeatherData(lat, lng, selectedDate);
        setWeather(data);
      } catch (e) {
        console.error("Open-Meteo 全球氣象獲取失敗，啟動核心防禦降級", e);
        setWeather(null);
      }
    };

    fetchWeatherOnly();
  }, [selectedDate, waypoints]); // 🟢 當手動修改日期，或地圖起點變更時，即時重刷氣象與天文！


  // 🚂 引擎 B：負責「行程表 CP 格網與時間加工循環」
  useEffect(() => {
    const processRouteData = () => {
      // 如果地圖上尚未點擊任何站點，表格主體資料先保持空陣列
      if (!waypoints || waypoints.length === 0) {
        setMaterials([]);
        return;
      }

      const startLoc = waypoints[0].latlng;

      // 雙引擎核心決策：知之為知之
      let sunriseTime = "06:14"; // 預設降級出發時間基正值

      if (weather && weather.sunrise && weather.sunrise !== "--:--") {
        // 如果 Open-Meteo 有給出可靠的日出時間，百分之百信任並採用
        sunriseTime = weather.sunrise;
      } else {
        // 如果 API 還在加載、斷網、或沒給日出，幾何科學公式頂上，免疫崩潰
        sunriseTime = calculateSunrise(startLoc.lat, startLoc.lng, selectedDate);
      }

      // 初始化加工變數
      let cumulativeDist = 0;
      let currentTime = sunriseTime; // 出發時間起點對齊

      // 全數據加工循環 (大表格滾雪球連動)
      const result = waypoints.map((wp, i) => {
        const prevSeg = i > 0 ? segments[i - 1] : null;
        
        // 累計里程計算
        if (prevSeg) cumulativeDist += prevSeg.distance;

        // 預計抵達時間計算 (Naismith 基礎邏輯)
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
          // 🟢 這裡接通真香港方格網轉換
          grid: getKKGrid(wp.latlng.lat, wp.latlng.lng),
          bearing: bearing,
          elevation: wp.elevation,
          cumDist: cumulativeDist.toFixed(2),
          eta: i === 0 ? sunriseTime : currentTime,
          lat: wp.latlng.lat.toFixed(4),
          lng: wp.latlng.lng.toFixed(4)
        };
      });

      setMaterials(result);
    };

    processRouteData();
    // 🟢 當點擊地圖(waypoints)、路線改變(segments)或是天文數據刷出新日出時間時，全線表格數據骨牌重算！
  }, [waypoints, segments, selectedDate, weather?.sunrise]);

  return { weather, materials };
};
