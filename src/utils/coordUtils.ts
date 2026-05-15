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