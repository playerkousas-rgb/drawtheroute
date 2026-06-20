import proj4 from 'proj4';

proj4.defs("EPSG:2326", "+proj=tmerc +lat_0=22.31213333333333 +lon_0=114.1787222222222 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.0677,-2.6556,0.8942,-10.624 +units=m +no_defs");
proj4.defs("EPSG:32649", "+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:32650", "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs");

export const convertWgs84ToHk80 = (lat: number, lng: number): [number, number] => {
  return proj4("EPSG:4326", "EPSG:2326", [lng, lat]);
};

export const convertHk80ToWgs84 = (easting: number, northing: number): [number, number] => {
  return proj4("EPSG:2326", "EPSG:4326", [easting, northing]);
};

/** 保留給 geodeticService.ts 使用 */
export const UTM_SQUARE_CONFIG: Record<string, { zone: string; eastBase: number; northBase: number }> = {
  '49Q_GE': { zone: '49', eastBase: 700000, northBase: 2370000 },
  '49Q_HE': { zone: '49', eastBase: 800000, northBase: 2370000 },
  '50Q_JK': { zone: '50', eastBase: 100000, northBase: 2370000 },
  '50Q_KK': { zone: '50', eastBase: 200000, northBase: 2370000 },
};

/**
 * ✅ 即時版（方法 A）：WGS84 → 香港登山 UTM 4位數簡寫
 * 已修正 Northing 取模問題（港島/九龍/新界皆為 4 位數）
 */
export function wgs84ToHikingShorthand4(lat: number, lng: number): string {
  const zone = lng < 114.0 ? 49 : 50;
  const epsg = zone === 49 ? "EPSG:32649" : "EPSG:32650";
  
  const [eastingRaw, northingRaw] = proj4("EPSG:4326", epsg, [lng, lat]);
  const E = Math.round(eastingRaw);
  const N = Math.round(northingRaw);

  let square = '';
  let eastBase = 0;
  const northBase = 2370000;

  if (zone === 49) {
    if (E >= 700000 && E < 800000) { square = 'GE'; eastBase = 700000; }
    else if (E >= 800000 && E < 900000) { square = 'HE'; eastBase = 800000; }
  } else {
    if (E >= 100000 && E < 200000) { square = 'JK'; eastBase = 100000; }
    else if (E >= 200000 && E < 300000) { square = 'KK'; eastBase = 200000; }
  }

  if (!square) return `${zone}Q ?? ${E} ${N}`;

  // ✅ 關鍵修正：取模 100000，確保永遠是 4 位數
  const eOff = Math.floor(((E - eastBase) % 100000) / 10);
  const nOff = Math.floor(((N - northBase) % 100000) / 10);

  return `${zone}Q ${square} ${eOff.toString().padStart(4, '0')} ${nOff.toString().padStart(4, '0')}`;
}

const resolveUtmGrid = (E: number, N: number, lng: number) => {
  const northBase = 2370000;
  if (lng < 114.0) {
    if (E >= 700000 && E < 800000) return { zone: '49Q', square: 'GE', eastBase: 700000, northBase };
    if (E >= 800000 && E < 900000) return { zone: '49Q', square: 'HE', eastBase: 800000, northBase };
  } else {
    if (E >= 100000 && E < 200000) return { zone: '50Q', square: 'JK', eastBase: 100000, northBase };
    if (E >= 200000 && E < 300000) return { zone: '50Q', square: 'KK', eastBase: 200000, northBase };
  }
  return { zone: '??', square: '??', eastBase: 0, northBase: 0 };
};

export const formatToHk80Shorthand = (E: number, N: number, lng: number): string => {
  const { zone, square, eastBase, northBase } = resolveUtmGrid(E, N, lng);
  if (square === '??') return `?? ?? ???? ????`;
  const eOff = Math.floor((E - eastBase) / 10);
  const nOff = Math.floor((N - northBase) / 10);
  return `${zone} ${square} ${eOff.toString().padStart(4, '0')} ${nOff.toString().padStart(4, '0')}`;
};

export const formatToMapLabel = (E: number, N: number, lng: number): string => {
  const { square, eastBase, northBase } = resolveUtmGrid(E, N, lng);
  if (square === '??') return '??';
  const eOff = Math.floor((E - eastBase) / 100);
  const nOff = Math.floor((N - northBase) / 100);
  return `${square}${eOff.toString().padStart(3, '0')}${nOff.toString().padStart(3, '0')}`;
};

export const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const φ1 = toRad(lat1); const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const theta = Math.atan2(y, x);
  return Math.round((toDeg(theta) + 360) % 360);
};

export const addMinutesToTime = (timeStr: string, minutesToAdd: number): string => {
  if (!timeStr || timeStr.indexOf(':') === -1) return "--:--";
  const [hrs, mins] = timeStr.split(':').map(Number);
  if (isNaN(hrs) || isNaN(mins)) return "--:--";
  const totalMinutes = hrs * 60 + mins + Math.round(minutesToAdd);
  const finalHrs = Math.floor(totalMinutes / 60) % 24;
  const finalMins = totalMinutes % 60;
  return `${String(finalHrs).padStart(2, '0')}:${String(finalMins).padStart(2, '0')}`;
};

export const formatDistance = (distMeter: number): string => (distMeter / 1000).toFixed(1);

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
  } catch (e) { return "08:30"; }
};
