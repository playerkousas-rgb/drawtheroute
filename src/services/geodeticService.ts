/**
 * Geodetic Service
 * Direct integration with Hong Kong Government Geodetic API.
 */
import proj4 from 'proj4';
import { UTM_SQUARE_CONFIG } from '../utils/coordUtils';

proj4.defs("EPSG:32649", "+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:32650", "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs");

export interface LatLng {
  lat: number;
  lng: number;
}

export interface UtmCoord {
  easting: number;
  northing: number;
  zone: string;
}

/**
 * 🚀 核心修正：將 WGS84 經緯度直接轉換為 UTM 全座標 (調用政府 API)
 */
export async function convertWgs84ToUtm(lat: number, lng: number): Promise<UtmCoord> {
  const zone = lng < 114.0 ? '49' : '50';
  const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=wgsgeog&outSys=utmgrid&zone=${zone}&lat=${lat}&lon=${lng}`);
  if (resp.ok) {
    const data = await resp.json();
    if (data.utmE && data.utmN) {
      return { easting: parseFloat(data.utmE), northing: parseFloat(data.utmN), zone };
    }
  }
  throw new Error('政府 API 轉換 WGS84 $\rightarrow$ UTM 失敗');
}

/**
 * 🚀 核心修正：將 UTM 縮寫/全座標轉換為 WGS84 (調用政府 API)
 */
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
    throw new Error('經緯度格式不正確');
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
    throw new Error('HK80 格式不正確');
  }

  if (mode === 'utm') {
    if (!utmOptions) throw new Error('UTM 模式需要選擇分區和方格。');
    
    const { zone, square } = utmOptions;
    const lookupKey = `${zone}_${square}`;
    const config = UTM_SQUARE_CONFIG[lookupKey];
    if (!config) throw new Error(`無法辨識分區/方格組合 "${zone} ${square}"。`);

    const numberMatches = cleanInput.match(/\d+/g);
    if (!numberMatches || numberMatches.length < 2) {
      throw new Error('請輸入坐標數字');
    }

    // 🚀 嚴格還原：3位數 = 100m 偏移 (對齊政府 6 位標籤)
    const eOffset = numberMatches[0].length === 3 ? parseInt(numberMatches[0]) * 100 : parseInt(numberMatches[0]);
    const nOffset = numberMatches[1].length === 3 ? parseInt(numberMatches[1]) * 100 : parseInt(numberMatches[1]);

    const fullE = config.eastBase + eOffset;
    const fullN = config.northBase + nOffset;
    
    const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=utmgrid&outSys=wgsgeog&zone=${zone}&e=${fullE}&n=${fullN}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.wgsLat && data.wgsLong) {
        return { lat: parseFloat(data.wgsLat), lng: parseFloat(data.wgsLong) };
      }
    }
    throw new Error('政府 API 轉換失敗');
  }

  throw new Error('未知的坐標模式');
}
