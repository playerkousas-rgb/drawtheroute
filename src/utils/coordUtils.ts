/**
 * 遠足徑幾何與時間計算工具 (純運算)
 */

// 1. 計算兩點間的前視方位 (Bearing)
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
export const addMinutesToTime = (timeStr: string, minutesToAdd: number): string => {
  if (!timeStr || timeStr.indexOf(':') === -1) return "--:--";
  
  const [hrs, mins] = timeStr.split(':').map(Number);
  if (isNaN(hrs) || isNaN(mins)) return "--:--";

  const totalMinutes = hrs * 60 + mins + Math.round(minutesToAdd);
  const finalHrs = Math.floor(totalMinutes / 60) % 24;
  const finalMins = totalMinutes % 60;

  return `${String(finalHrs).padStart(2, '0')}:${String(finalMins).padStart(2, '0')}`;
};

// 3. 距離單位轉換
export const formatDistance = (distMeter: number): string => {
  return (distMeter / 1000).toFixed(1);
};

// 4. 日出計算器
export const calculateSunrise = (lat: number, lng: number, dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "08:30"; 
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const N1 = Math.floor(275 * month / 9);
    const N2 = Math.floor((month + 9) / 12);
    const N3 = (1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3));
    const N = N1 - (N2 * N3) + day - 30;
    const longitudeHour = lng / 15;
    const t = N + ((6 - longitudeHour) / 24); 
    const M = (0.9856 * t) - 3.289;           
    let L = M + (1.916 * Math.sin(M * Math.PI / 180)) + (0.020 * Math.sin(2 * M * Math.PI / 180)) + 282.634;
    L = (L + 360) % 360;                      
    const sinDec = 0.39782 * Math.sin(L * Math.PI / 180);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.sin(-0.833 * Math.PI / 180) - (sinDec * Math.sin(lat * Math.PI / 180))) / (cosDec * Math.cos(lat * Math.PI / 180));
    if (cosH > 1 || cosH < -1) return "06:00"; 
    const H = 360 - (Math.acos(cosH) * 180 / Math.PI);
    const T = H / 15; 
    const UT = T + longitudeHour - (0.06571 * t) - 6.622;
    const localHour = (UT + 8 + 24) % 24;
    const hour = Math.floor(localHour);
    const minute = Math.round((localHour - hour) * 60);
    const finalHour = minute === 60 ? (hour + 1) % 24 : hour;
    const finalMinute = minute === 60 ? 0 : minute;
    return `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;
  } catch (e) {
    return "08:30";
  }
};

import proj4 from 'proj4';

// 定義香港 1980 方格網 (EPSG:2326) - 權威標準解
proj4.defs("EPSG:2326", "+proj=tmerc +lat_0=22.31213333333333 +lon_0=114.1787222222222 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.0677,-2.6556,0.8942,-10.624 +units=m +no_defs");

export const convertWgs84ToHk80 = (lat: number, lng: number): [number, number] => {
  // proj4 接收 [lng, lat]
  return proj4("EPSG:4326", "EPSG:2326", [lng, lat]);
};

export const convertHk80ToWgs84 = (easting: number, northing: number): [number, number] => {
  return proj4("EPSG:2326", "EPSG:4326", [easting, northing]);
};

// 5. 香港 UTM 坐標方格基準座標對照表 (權威定義)
// 格式: 'Zone_Square': [EastingBase, NorthingBase]
// 基於 True UTM 投影
export const SQUARE_MAP: Record<string, [number, number]> = {
  // --- 50Q 分區 (基準點由 True UTM 確定) ---
  '50Q_KK': [200000, 2470000],
  '50Q_JK': [190000, 2470000],
  '50Q_HE': [180000, 2470000],
  '50Q_GE': [170000, 2470000],
  '50Q_LK': [210000, 2470000],
  '50Q_MK': [220000, 2470000],
  '50Q_KE': [200000, 2460000],
  '50Q_JE': [190000, 2460000],
  '50Q_LE': [210000, 2460000],
  '50Q_ME': [220000, 2460000],
  '50Q_FK': [170000, 2470000], 
  '50Q_GK': [160000, 2470000],
};

/**
 * 將 True UTM 座標轉換為專業 8 位坐標格式 (例如: 50Q KK 0670 2346)
 */
export const formatToHk80Shorthand = (E: number, N: number): string => {
  // E, N 應為 True UTM 座標 (例如: 200670, 2472346)
  const eastPrefix = Math.floor(E / 10000) * 10000;
  const northPrefix = Math.floor(N / 10000) * 10000;
  
  let square = '??';
  let zone = '50Q';
  
  for (const [key, base] of Object.entries(SQUARE_MAP)) {
    if (base[0] === eastPrefix && base[1] === northPrefix) {
      square = key.split('_')[1];
      zone = key.split('_')[0];
      break;
    }
  }
  
  // 如果找不到匹配的方格，zone 仍然保持-由座標確定-
  // 這裡可以增加更複雜的 Zone 判定邏輯，但目前針對香港區域，50Q 為主
  
  const eOffset = Math.floor(E % 10000).toString().padStart(4, '0');
  const nOffset = Math.floor(N % 10000).toString().padStart(4, '0');
  
  return `${zone} ${square} ${eOffset} ${nOffset}`;
}
