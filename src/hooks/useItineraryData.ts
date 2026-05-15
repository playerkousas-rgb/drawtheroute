import { useState, useEffect } from 'react';
// 根據你的截圖，services 資料夾在 src 之外，所以用 ../../ 找回去
import { getKKGrid, fetchWeatherData } from '../../services/weatherService';

export const useItineraryData = (waypoints: any[], segments: any[], naismith: any) => {
  const [weather, setWeather] = useState<any>(null);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    // 這裡我們先保持空白，確保檔案建立後 build 能過
    console.log("大總管檔案已掛載，等待指令...");
  }, []);

  return { weather, materials };
};
