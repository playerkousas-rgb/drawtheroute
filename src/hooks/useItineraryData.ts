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
    const processRouteData = async () => {
      if (!waypoints || waypoints.length === 0) {
        setMaterials([]);
        return;
      }

      const startLoc = waypoints[0].latlng;
      let sunriseTime = "06:14";

      if (weather && weather.sunrise && weather.sunrise !== "--:--") {
        sunriseTime = weather.sunrise;
      } else {
        sunriseTime = calculateSunrise(startLoc.lat, startLoc.lng, selectedDate);
      }

      let cumulativeDist = 0;
      let currentTime = sunriseTime;

      const result = [];
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const prevSeg = i > 0 ? segments[i - 1] : null;
        
        if (prevSeg) cumulativeDist += prevSeg.distance;
        if (prevSeg) {
          const segmentMinutes = (prevSeg.distance / 4.0) * 60;
          currentTime = addMinutesToTime(currentTime, segmentMinutes);
        }

        let bearing = 0;
        if (i < waypoints.length - 1) {
          const nextLoc = waypoints[i + 1].latlng;
          bearing = calculateBearing(wp.latlng.lat, wp.latlng.lng, nextLoc.lat, nextLoc.lng);
        }

        // 🎯 核心修正：統一使用 HKGrid 座標的後四位，確保與搜尋功能 100% 一致
        let gridStr = "Calculating...";
        try {
          const resp1 = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=wgsgeog&outSys=hkgrid&lat=${wp.latlng.lat}&long=${wp.latlng.lng}`);
          if (resp1.ok) {
            const data1 = await resp1.json();
            if (data1.hkE && data1.hkN) {
              const hkE = data1.hkE.toString();
              const hkN = data1.hkN.toString();
              
              const resp2 = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&e=${hkE}&n=${hkN}`);
              if (resp2.ok) {
                const data2 = await resp2.json();
                if (data2.utmGridZone && data2.utmRefZone) {
                  const zone = data2.utmGridZone; // "50Q"
                  const square = data2.utmRefZone.split('-')[1] || "XX"; // "KK"
                  
                  // 🚀 重要修正：使用 HKGrid 的後四位，而非 API 返回的 UTM 座標後四位
                  const easting = hkE.slice(-4).padStart(4, '0');
                  const northing = hkN.slice(-4).padStart(4, '0');
                  gridStr = `${zone} ${square} ${easting} ${northing}`;
                }
              }
            }
          }
        } catch (e) {
          console.error("Grid conversion API error", e);
        }

        result.push({
          id: wp.id,
          name: wp.type === 'start' ? '起點' : wp.type === 'end' ? '終點' : `CP${i}`,
          grid: gridStr,
          bearing: bearing,
          elevation: wp.elevation,
          cumDist: cumulativeDist.toFixed(2),
          eta: i === 0 ? sunriseTime : currentTime,
          lat: wp.latlng.lat.toFixed(4),
          lng: wp.latlng.lng.toFixed(4)
        });
      }

      setMaterials(result);
    };

    processRouteData();
  }, [waypoints, segments, selectedDate, weather?.sunrise]);

  return { weather, materials };
};
