import proj4 from 'proj4';
import axios from 'axios';

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
/**
 * 外部數據服務 (Weather & Grid)
 */

// 1. 香港網格座標對照 (KK Grid) - 本地對標地政總署標準
export const getKKGrid = (lat: number, lng: number): string => {
  // 香港 1980 方格網 (HK1980) 參數
  const hk1980 = "+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +units=m +no_defs";
  
  try {
    const [easting, northing] = proj4("WGS84", hk1980, [lng, lat]);
    // 取得 8 位網格格式 (KK EEEE NNNN)
    const eStr = Math.floor(easting).toString().padStart(6, '0').slice(-5, -1);
    const nStr = Math.floor(northing).toString().padStart(6, '0').slice(-5, -1);
    return `KK ${eStr} ${nStr}`;
  } catch (e) {
    return "KK ---- ----";
  }
};

// 2. OpenWeather API 對接
export const fetchWeatherData = async (lat: number, lng: number) => {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=zh_tw`;
    const response = await axios.get(url);
    const data = response.data;

    const formatTime = (ts: number) => {
      const date = new Date(ts * 1000);
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    return {
      temp: Math.round(data.main.temp),
      humidity: data.main.humidity,
      windSpeed: (data.wind.speed * 3.6).toFixed(1), // 轉為 km/h
      description: data.weather[0].description,
      sunrise: formatTime(data.sys.sunrise),
      sunset: formatTime(data.sys.sunset),
      icon: `https://openweathermap.org/img/wn/${data.weather[0].icon}.png`
    };
  } catch (error) {
    console.error("Weather API Error:", error);
    return null;
  }
};