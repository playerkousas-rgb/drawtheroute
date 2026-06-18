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

/**
 * 將香港 HK80 格網座標 (Easting, Northing) 轉換為 WGS84 經緯度
 */
export const hk80ToWgs84 = (N: number, E: number): { lat: number; lng: number } => {
  const N0 = 811555.11; 
  const E0 = 836694.05; 
  const phi0 = 22.25 * Math.PI / 180; 
  const lambda0 = 114.16666666666667 * Math.PI / 180; 
  const m0 = 0.99992; 
  const a = 6378388.0;
  const f = 1 / 297.0;
  const b = a * (1 - f);
  const e2 = (a*a - b*b) / (a*a);
  const ePrime2 = (a*a - b*b) / (b*b);
  const dy = N - N0;
  const dx = E - E0;
  const M0 = a * ((1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * phi0 
               - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*phi0)
               + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*phi0)
               - (35*e2*e2*e2/3072) * Math.sin(6*phi0));
  const M = M0 + dy / m0;
  let phi1 = M / (a * (1 - e2/4));
  let delta = 1;
  while (Math.abs(delta) > 1e-11) {
      let sin2 = Math.sin(2*phi1);
      let sin4 = Math.sin(4*phi1);
      let sin6 = Math.sin(6*phi1);
      let Mi = a * ((1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * phi1 
               - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * sin2
               + (15*e2*e2/256 + 45*e2*e2*e2/1024) * sin4
               - (35*e2*e2*e2/3072) * sin6);
      delta = M - Mi;
      phi1 += delta / a;
  }
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const D = dx / (N1 * m0);
  const latHK80 = phi1 - (N1 * tan1 / R1) * (D*D/2 - (5 + 3*tan1*tan1 + 10*ePrime2*cos1*cos1 - 4*ePrime2*ePrime2*cos1*cos1*cos1*cos1 - 9*tan1*tan1*ePrime2*cos1*cos1)*D*D*D*D/24);
  const lngHK80 = lambda0 + (D - (1 + 2*tan1*tan1 + ePrime2*cos1*cos1)*D*D*D/6 + (5 - 2*ePrime2*cos1*cos1 + 28*tan1*tan1 - 3*ePrime2*ePrime2*cos1*cos1*cos1*cos1 + 8*ePrime2*cos1*cos1*tan1*tan1 + 24*tan1*tan1*tan1*tan1)*D*D*D*D*D/120) / cos1;
  const latDeg = latHK80 * 180 / Math.PI;
  const lngDeg = lngHK80 * 180 / Math.PI;
  const wgsLat = latDeg - 0.0000475 + (latDeg - 22.0) * 0.0000012;
  const wgsLng = lngDeg + 0.0024423 + (lngDeg - 114.0) * 0.0000203;
  return { lat: wgsLat, lng: wgsLng };
}

/**
 * 將 WGS84 經緯度轉換為香港 HK80 坐標
 * 實時坐標追蹤使用
 */
export const wgs84ToHk80 = (lat: number, lng: number): { easting: number; northing: number } => {
  // 簡化反向轉換：使用近似線性偏移 (對於小範圍追蹤足夠) 
  // 正確的做法是反轉 Transverse Mercator 投影
  const latDeg = lat + 0.0000475 - (lat - 22.0) * 0.0000012;
  const lngDeg = lng - 0.0024423 - (lng - 114.0) * 0.0000203;
  
  // 這裡使用近似估算來提供即時反饋，若需極高精度需實作完整反投影
  // 由於本項目主要是視覺追蹤，使用近似值即可
  const phi = latDeg * Math.PI / 180;
  const lambda = lngDeg * Math.PI / 180;
  const phi0 = 22.25 * Math.PI / 180;
  const lambda0 = 114.16666666666667 * Math.PI / 180;
  const a = 6378388.0;
  const m0 = 0.99992;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  
  // 簡化版投影公式
  const N = a / Math.sqrt(1 - 0.00669438 * sinPhi * sinPhi);
  const dL = lambda - lambda0;
  
  const easting = 836694.05 + m0 * N * cosPhi * dL;
  const northing = 811555.11 + m0 * (
    a * (phi - phi0) + 
    (a * 0.00669438 / 2) * sinPhi * cosPhi * (dL * dL)
  );
  
  return { easting, northing };
}

/**
 * 將 HK80 全座標轉換為專業 8 位坐標格式 (例如: KK 0670 2346)
 */
export const formatToHk80Shorthand = (E: number, N: number): string => {
  const squareMap: Record<string, [number, number]> = {
    'KK': [83, 82], 'JK': [83, 81], 'HE': [81, 82], 'GE': [81, 81],
    'LK': [84, 82], 'MK': [84, 81], 'KE': [82, 82], 'JE': [82, 81],
    'FK': [80, 82], 'GK': [80, 81], 'FE': [80, 82], 
    'AK': [79, 82], 'BK': [79, 81],
  };
  
  const eastPrefix = Math.floor(E / 10000);
  const northPrefix = Math.floor(N / 10000);
  
  let square = '??';
  for (const [s, p] of Object.entries(squareMap)) {
    if (p[0] === eastPrefix && p[1] === northPrefix) {
      square = s;
      break;
    }
  }
  
  const e8 = Math.floor(E % 10000).toString().padStart(4, '0');
  const n8 = Math.floor(N % 10000).toString().padStart(4, '0');
  
  return `${square} ${e8} ${n8}`;
}
