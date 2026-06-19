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

/**
 * 專業 UTM 方格基準座標表 (100km x 100km)
 * 注意：北緯基數統一使用 2,470,000，這是香港專業遠足縮寫的通用基準線
 */
export const UTM_SQUARE_BASES: Record<string, [number, number]> = {
  '50Q_KK': [200000, 2470000],
  '50Q_JK': [100000, 2470000],
  '49Q_HE': [800000, 2470000],
  '49Q_GE': [700000, 2470000],
};

/**
 * 將 True UTM 座標轉換為專業 8 位坐標格式 (例如: 50Q KK 0670 2346)
 */
export const formatToHk80Shorthand = (E: number, N: number, lng: number): string => {
  let zone = '';
  let square = '??';

  if (lng < 114.0) {
    zone = '49Q';
    if (E >= 700000 && E < 800000) square = 'GE';
    else if (E >= 800000 && E < 900000) square = 'HE';
  } else {
    zone = '50Q';
    if (E >= 100000 && E < 200000) square = 'JK';
    else if (E >= 200000 && E < 300000) square = 'KK';
  }

  const eOffset = Math.floor(Math.abs(E % 10000)).toString().padStart(4, '0');
  const nOffset = Math.floor(Math.abs(N % 10000)).toString().padStart(4, '0');
  
  return `${zone} ${square} ${eOffset} ${nOffset}`;
}
