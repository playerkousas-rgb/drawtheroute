import { useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';
import { calculateBearing, addMinutesToTime, calculateSunrise } from '../utils/coordUtils';
import { WaypointMarker, RouteSegment } from '../types';

/**
 * 呼叫政府 API 把 WGS84 轉成 UTM 4位數簡寫
 */
async function getOfficialGrid(lat: number, lng: number): Promise<string> {
  try {
    const zone = lng < 114.0 ? 49 : 50;
    const resp = await fetch(
      `https://www.geodetic.gov.hk/transform/v2/?inSys=wgsgeog&outSys=utmgrid&zone=${zone}&lat=${lat}&lon=${lng}`
    );
    if (!resp.ok) throw new Error('API 失敗');
    const data = await resp.json();
    
    if (data.utmE && data.utmN) {
      const E = parseFloat(data.utmE);
      const N = parseFloat(data.utmN);
      
      // 直接取 100000 模轉成 4 位數
      const eOff = Math.floor(((E % 100000) + 100000) % 100000 / 10);
      const nOff = Math.floor(((N % 100000) + 100000) % 100000 / 10);
      
      const square = E >= 200000 ? 'KK' : 'JK';
      return `${zone}Q ${square} ${eOff.toString().padStart(4, '0')} ${nOff.toString().padStart(4, '0')}`;
    }
  } catch (e) {
    console.error('政府 API 轉格網失敗', e);
  }
  return '?? ?? ???? ????';
}

export const useItineraryData = (
  waypoints: WaypointMarker[], 
  segments: RouteSegment[], 
  selectedDate: string
) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  // 氣象
  useEffect(() => {
    const fetchWeatherOnly = async () => {
      const lat = waypoints && waypoints.length > 0 ? waypoints[0].latlng.lat : 22.3193;
      const lng = waypoints && waypoints.length > 0 ? waypoints[0].latlng.lng : 114.1694;

      try {
        const data = await fetchWeatherData(lat, lng, selectedDate);
        setWeather(data);
      } catch (e) {
        setWeather(null);
      }
    };
    fetchWeatherOnly();
  }, [selectedDate, waypoints]);

  // 行程表（已改成走政府 API）
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

        // ✅ 已改成走政府 API
        const gridStr = await getOfficialGrid(wp.latlng.lat, wp.latlng.lng);

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

  return { materials, weather };
};
