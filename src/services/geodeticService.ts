/**
 * Geodetic Service - 使用政府官方 API
 */
import { UTM_SQUARE_CONFIG } from '../utils/coordUtils';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * 搜尋功能：UTM 簡寫 / HK80 / 經緯度 → WGS84
 * 已完整支援 4 位數簡寫（最常用登山格式）
 */
export async function convertToWgs84(
  input: string, 
  mode: 'utm' | 'hk80' | 'latlng',
  utmOptions?: { zone: string; square: string }
): Promise<LatLng> {
  const cleanInput = input.trim().toUpperCase();

  // 直接輸入經緯度
  if (mode === 'latlng') {
    const parts = cleanInput.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    throw new Error('經緯度格式不正確');
  }

  // HK80
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

  // UTM 簡寫轉經緯度（最重要）
  if (mode === 'utm') {
    if (!utmOptions) throw new Error('請選擇分區和方格');

    const { zone, square } = utmOptions;
    const lookupKey = `${zone}_${square}`;
    const config = UTM_SQUARE_CONFIG[lookupKey];
    if (!config) throw new Error(`無法辨識 "${zone} ${square}"`);

    const numberMatches = cleanInput.match(/\d+/g);
    if (!numberMatches || numberMatches.length < 2) {
      throw new Error('請輸入坐標數字');
    }

    const eStr = numberMatches[0];
    const nStr = numberMatches[1];

    // 正確處理 3 位數 / 4 位數
    let eOffset: number;
    let nOffset: number;

    if (eStr.length === 3) {
      eOffset = parseInt(eStr) * 100;      // 3 位數 = 100m
    } else if (eStr.length === 4) {
      eOffset = parseInt(eStr) * 10;       // 4 位數 = 10m（最常用）
    } else {
      eOffset = parseInt(eStr);
    }

    if (nStr.length === 3) {
      nOffset = parseInt(nStr) * 100;
    } else if (nStr.length === 4) {
      nOffset = parseInt(nStr) * 10;
    } else {
      nOffset = parseInt(nStr);
    }

    const fullE = config.eastBase + eOffset;
    const fullN = config.northBase + nOffset;

    const resp = await fetch(
      `https://www.geodetic.gov.hk/transform/v2/?inSys=utmgrid&outSys=wgsgeog&zone=${zone}&e=${fullE}&n=${fullN}`
    );

    if (resp.ok) {
      const data = await resp.json();
      if (data.wgsLat && data.wgsLong) {
        return { 
          lat: parseFloat(data.wgsLat), 
          lng: parseFloat(data.wgsLong) 
        };
      }
    }
    throw new Error('政府 API 轉換失敗');
  }

  throw new Error('未知的坐標模式');
}
