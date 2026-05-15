import proj4 from 'proj4';
import axios from 'axios';

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;

/**
 * 1. 香港網格座標轉換 (HK1980 Grid)
 * 將經緯度轉為 1:20000 地圖通用的網格編號 (例如 KK 123 456)
 */
export const getKKGrid = (lat: number, lng: number): string => {
  const hk1980 = "+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +units=m +no_defs";
  
  try {
    const [easting, northing] = proj4("WGS84", hk1980, [lng, lat]);
    
    // 取得百公里識別碼 (例如 8xx,xxx 8xx,xxx -> KK)
    // 這裡是簡化版，精確版需對照地政總署百公里方格索引
    const eastIdx = Math.floor(easting / 100000);
    const northIdx = Math.floor(northing / 100000);
    
    let prefix = "KK"; // 預設香港大部分地區
    if (eastIdx === 8 && northIdx === 8) prefix = "KK";
    if (eastIdx === 9 && northIdx === 8) prefix = "JK"; // 大鵬半島方向
    
    // 取得 6 位或 8 位網格格式 (取 easting/northing 的後五位的前三位或四位)
    const eStr = Math.floor(easting % 100000).toString().padStart(5, '0').slice(0, 4);
    const nStr = Math.floor(northing % 100000).toString().padStart(5, '0').slice(0, 4);
    
    return `${prefix} ${eStr} ${nStr}`;
  } catch (e) {
    return "Grid Error";
  }
};

/**
 * 2. OpenWeather API 對接
 * 獲取即時氣象、天文數據
 */
export const fetchWeatherData = async (lat: number, lng: number) => {
  if (!OPENWEATHER_API_KEY) {
    console.warn("Missing OpenWeather API Key");
    return null;
  }

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
      feelsLike: Math.round(data.main.feels_like), // 體感溫度
      humidity: data.main.humidity,
      windSpeed: (data.wind.speed * 3.6).toFixed(1), // km/h
      windDeg: data.wind.deg, // 風向度數
      cloudCover: data.clouds.all, // 雲量
      description: data.weather[0].description,
      sunrise: formatTime(data.sys.sunrise),
      sunset: formatTime(data.sys.sunset),
      icon: `https://openweathermap.org/img/wn/${data.weather[0].icon}.png`,
      // 這裡預留給大總管處理月相，因為 OpenWeather 免費版通常不給月相
      moonPhase: "🌓 52%", 
      uvIndex: "5" // 建議大總管從 One Call API 或其他渠道獲取
    };
  } catch (error) {
    console.error("Weather API Error:", error);
    return null;
  }
};
