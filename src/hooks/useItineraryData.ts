import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing, addMinutesToTime, calculateSunrise, formatToHk80Shorthand } from '../utils/coordUtils';
import { WaypointMarker, RouteSegment } from '../types';
import proj4 from 'proj4';

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
      const lat = waypoints && waypoints.length > 0 ? waypoints[0].latlng.lat : 22.3193;
      const lng = waypoints && waypoints.length > 0 ? waypoints[0].latlng.lng : 114.1694;

      try {
        const data = await fetchWeatherData(lat, lng, selectedDate);
        setWeather(data);
      } catch (e) {
        console.error("Open-Meteo 全球氣象獲取失敗，啟動核心防禦降級", e);
        setWeather(null);
      }
    };

    fetchWeatherOnly();
  }, [selectedDate, waypoints]);


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

        // 🎯 核心修正：不再依賴外部 API 進行格網轉換，直接在本地用 WGS84 投影到 UTM
        let gridStr = "Calculating...";
        try {
          const { lat, lng } = wp.latlng;
          const utmZone = lng < 114.0 ? "EPSG:32649" : "EPSG:32650";
          const utm = proj4("EPSG:4326", utmZone, [lng, lat]);
          gridStr = formatToHk80Shorthand(utm[0], utm[1], lng);
        } catch (e) {
          console.error("Local Grid conversion error", e);
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
