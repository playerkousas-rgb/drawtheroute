import { useMemo, useState, useEffect } from 'react';
import { getKKGrid, fetchWeatherData } from '../services/weatherService';
import { calculateBearing, addMinutesToTime } from '../utils/coordUtils';
import { RouteStats, RouteSegment, WaypointMarker, NaismithSettings } from '../types';

// 我們現在接收更多的參數，因為右側欄有這些現成的好料
export const useItineraryData = (
  waypoints: WaypointMarker[], 
  segments: RouteSegment[],
  settings: NaismithSettings,
  startTime: string = "08:30" // 預設出發時間
) => {
  const [weather, setWeather] = useState<any>(null);

  useEffect(() => {
    if (waypoints.length > 0) {
      const sp = waypoints[0].latlng;
      fetchWeatherData(sp.lat, sp.lng).then(setWeather);
    }
  }, [waypoints[0]?.latlng?.lat, waypoints[0]?.latlng?.lng]);

  const materials = useMemo(() => {
    let accumulatedDistance = 0;
    let accumulatedAscent = 0;
    let accumulatedDescent = 0;
    let currentTime = startTime;

    return waypoints.map((wp, i) => {
      // 拿取該路段的數據 (如果是 SP 則沒有前一段)
      const segment = i > 0 ? segments[i - 1] : null;
      const nextWp = waypoints[i + 1];

      if (segment) {
        accumulatedDistance += segment.distance;
        accumulatedAscent += segment.ascent;
        accumulatedDescent += segment.descent;
      }

      // --- 這裡預留計算路段時間的邏輯 (等大總管調度) ---
      // 假設 segment 已經自帶時間，或者我們用 utils 算
      const segmentMinutes = segment ? (segment as any).duration / 60 : 0; 
      const arrivalTime = i === 0 ? startTime : addMinutesToTime(currentTime, segmentMinutes);
      
      // 更新當前時間供下一個點使用 (這裡暫不考慮休息時間，測試完再加)
      currentTime = arrivalTime;

      return {
        id: i === 0 ? 'SP' : i === waypoints.length - 1 ? 'EP' : `CP${i}`,
        grid: getKKGrid(wp.latlng.lat, wp.latlng.lng),
        ele: wp.elevation,
        
        // 分段與累積數據 (來自 segments)
        dist: segment ? segment.distance : 0,
        accDist: accumulatedDistance,
        gain: segment ? segment.ascent : 0,
        accGain: accumulatedAscent,
        loss: segment ? segment.descent : 0,
        accLoss: accumulatedDescent,
        
        // 方位角
        bearing: nextWp ? calculateBearing(wp.latlng.lat, wp.latlng.lng, nextWp.latlng.lat, nextWp.latlng.lng) : null,
        
        // 時間
        predictedArrival: arrivalTime
      };
    });
  }, [waypoints, segments, settings, startTime]);

  return {
    materials,
    weather,
    settings // 把右側欄的設定也傳回去，方便對照
  };
};
