/**
 * 遠足徑幾何與時間計算工具 (純運算)
 */

// 1. 計算兩點間的前視方位 (Bearing)
// 輸入：起點 lat/lng, 終點 lat/lng
// 輸出：0-359 度的整數
export const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  
  const theta = Math.atan2(y, x);
  const brng = (toDeg(theta) + 360) % 360;
  return Math.round(brng);
};

// 2. 時間連動換算 (Time Addition)
// 輸入：開始時間 "08:30", 增加的分鐘數 45
// 輸出："09:15"
export const addMinutesToTime = (timeStr: string, minutesToAdd: number): string => {
  if (!timeStr || timeStr.indexOf(':') === -1) return "--:--";
  
  const [hrs, mins] = timeStr.split(':').map(Number);
  if (isNaN(hrs) || isNaN(mins)) return "--:--";

  const totalMinutes = hrs * 60 + mins + Math.round(minutesToAdd);
  const finalHrs = Math.floor(totalMinutes / 60) % 24;
  const finalMins = totalMinutes % 60;

  return `${String(finalHrs).padStart(2, '0')}:${String(finalMins).padStart(2, '0')}`;
};

// 3. 距離單位轉換 (Optional)
// 確保里程顯示為 1 位小數 (例如 5.2 km)
export const formatDistance = (distMeter: number): string => {
  return (distMeter / 1000).toFixed(1);
};

// 4. 純數學幾何日出計算器（雙引擎之：遠期與歷史防崩潰引擎）
// 輸入：緯度、經度、日期字串 ("2026-05-16")
// 輸出：日出時間字串 ("05:41")
export const calculateSunrise = (lat: number, lng: number, dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "08:30"; // 防錯降級

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    // 1. 計算該年在地球軌道上的積日 (Day of year)
    const N1 = Math.floor(275 * month / 9);
    const N2 = Math.floor((month + 9) / 12);
    const N3 = (1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3));
    const N = N1 - (N2 * N3) + day - 30;

    // 2. 估算太陽赤緯與時角 (天體力學幾何公式)
    const longitudeHour = lng / 15;
    const t = N + ((6 - longitudeHour) / 24); // 概估日出時間
    const M = (0.9856 * t) - 3.289;           // 太陽平近點角
    
    let L = M + (1.916 * Math.sin(M * Math.PI / 180)) + (0.020 * Math.sin(2 * M * Math.PI / 180)) + 282.634;
    L = (L + 360) % 360;                      // 太陽黃經

    const sinDec = 0.39782 * Math.sin(L * Math.PI / 180);
    const cosDec = Math.cos(Math.asin(sinDec));

    // 3. 計算在地時角 (大氣折射修正修正角：香港地平線高度為 -0.833 度)
    const cosH = (Math.sin(-0.833 * Math.PI / 180) - (sinDec * Math.sin(lat * Math.PI / 180))) / (cosDec * Math.cos(lat * Math.PI / 180));
    
    if (cosH > 1 || cosH < -1) return "06:00"; // 極圈防禦機制（雖然香港用不到，但能保證程式不跳崖）

    const H = 360 - (Math.acos(cosH) * 180 / Math.PI);
    const T = H / 15; // 當地時角時數
    
    // 4. 轉換回世界協調時(UTC)與香港本地時間(GMT+8)
    const UT = T + longitudeHour - (0.06571 * t) - 6.622;
    const localHour = (UT + 8 + 24) % 24;

    const hour = Math.floor(localHour);
    const minute = Math.round((localHour - hour) * 60);
    
    // 分鐘進位進位修正
    const finalHour = minute === 60 ? (hour + 1) % 24 : hour;
    const finalMinute = minute === 60 ? 0 : minute;

    return `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;
  } catch (e) {
    return "08:30"; // 萬一發生任何未知錯誤，絕對不白屏，優雅退回標準預設出發時間
  }
};
