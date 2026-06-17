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
// ... (keep existing calculateSunrise function)
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
 * 採用地政總署標準參數及基準面修正
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
