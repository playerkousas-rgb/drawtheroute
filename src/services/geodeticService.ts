/**
 * Geodetic Service
 * Handles all authoritative coordinate conversions.
 */
import proj4 from 'proj4';
import { UTM_SQUARE_CONFIG } from '../utils/coordUtils';

// 定義 UTM Zone 49N & 50N
proj4.defs("EPSG:32649", "+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:32650", "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs");

export interface LatLng {
  lat: number;
  lng: number;
}

export async function convertToWgs84(
  input: string, 
  mode: 'utm' | 'hk80' | 'latlng',
  utmOptions?: { zone: string; square: string }
): Promise<LatLng> {
  const cleanInput = input.trim().toUpperCase();

  if (mode === 'latlng') {
    const parts = cleanInput.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    throw new Error('經緯度格式不正確。請使用: 22.3, 114.1');
  }

  if (mode === 'hk80') {
    const parts = cleanInput.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 2) {
      const easting = parts[0];
      const northing = parts[1];
      const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&outSys=wgsgeog&e=${easting}&n=${northing}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.wgsLat && data.wgsLong) return { lat: parseFloat(data.wgsLat), lng: parseFloat(data.wgsLong) };
      }
    }
    throw new Error('HK80 格式不正確。請使用: 830670 82346');
  }

  if (mode === 'utm') {
    if (!utmOptions) throw new Error('UTM 模式需要選擇分區和方格。');
    
    const { zone, square } = utmOptions;
    const lookupKey = `${zone}_${square}`;
    const config = UTM_SQUARE_CONFIG[lookupKey];
    if (!config) throw new Error(`無法辨識分區/方格組合 "${lookupKey}"。`);

    const numberMatches = cleanInput.match(/\d+/g);
    if (!numberMatches || numberMatches.length < 2) {
      throw new Error('請輸入坐標數字 (例如: 017 688 或 0170 6880)');
    }

    const eStr = numberMatches[0];
    const nStr = numberMatches[1];

    // 🚀 核心修正：修正倍率還原
    // 3位 = 100m, 4位 = 10m, 5位 = 1m
    // 公式：實際偏移 = 數字 * 10^(5 - 長度)
    const eOffset = parseInt(eStr) * Math.pow(10, 5 - eStr.length);
    const nOffset = parseInt(nStr) * Math.pow(10, 5 - nStr.length);

    const fullE = eOffset >= 100000 ? eOffset : (config.eastBase + eOffset);
    const fullN = nOffset >= 100000 ? nOffset : (config.northBase + nOffset);
    
    try {
      const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=utmgrid&outSys=wgsgeog&zone=${config.zone}&e=${fullE}&n=${fullN}`);
      
      if (resp.ok) {
        const data = await resp.json();
        if (data.wgsLat && data.wgsLong) {
          return { lat: parseFloat(data.wgsLat), lng: parseFloat(data.wgsLong) };
        }
      }
    } catch (e) {
      console.error("Government UTM API Error:", e);
    }

    throw new Error('政府 API 轉換失敗或座標超出範圍，請檢查輸入。');
  }

  throw new Error('未知的坐標模式');
}
