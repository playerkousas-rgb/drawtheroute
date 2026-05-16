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

  useEffect(() => {
    const processData = async () => {
      if (!waypoints || waypoints.length === 0) return;

      const startLoc = waypoints[0].latlng;
      let currentFetchWeather = null;

      try {
        // 🚂 1. 動態戳全球引擎：直接把經緯度與日期拋給 Open-Meteo
        // 內部會智慧判斷是提供「即時預報」還是「歷史統計平均值」
        const data = await fetchWeatherData(startLoc.lat, startLoc.lng, selectedDate);
        currentFetchWeather = data;
        setWeather(data);
      } catch (e) {
        console.error("Open-Meteo 全球氣象獲取失敗，啟動核心防禦降級", e);
        setWeather(null);
      }

      // 🚂 2. 雙引擎核心決策：知之為知之
      let sunriseTime = "08:30"; // 預設降級出發時間

      if (currentFetchWeather && currentFetchWeather.sunrise && currentFetchWeather.sunrise !== "--:--") {
        // 如果 Open-Meteo 有給出可靠的日出時間，百分之百信任並採用
        sunriseTime = currentFetchWeather.sunrise;
      } else {
        // 如果 API 斷網、報錯、或歷史檔案沒給日出，幾何科學公式 0 毫秒無縫頂上，免疫崩潰
        sunriseTime = calculateSunrise(startLoc.lat, startLoc.lng, selectedDate);
      }

      // 3. 初始化加工變數
      let cumulativeDist = 0;
      let currentTime = sunriseTime; // 出發時間起點對齊

      // 4. 全數據加工循環 (大表格滾雪球連動)
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
          // 🟢 這裡接通了我們剛剛改好的、真正會分辨 KV/KW/JV 字頭的真香港網格轉換！
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

    processData();
    // 🟢 當點擊地圖(waypoints)、路線改變(segments)或是上方「修改日期」時，全線數據骨牌重算！
  }, [waypoints, segments, selectedDate]);

  return { weather, materials };
};
