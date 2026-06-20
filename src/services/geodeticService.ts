/**
 * Geodetic Service - 正確使用 utmref 模式支援簡寫
 */
import { UTM_SQUARE_CONFIG } from '../utils/coordUtils';

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
    throw new Error('經緯度格式不正確');
  }

  if (mode === 'hk80') {
    const parts = cleanInput.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 2) {
      const easting = parts[0];
      const northing = parts[1];
      const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&outSys=wgsgeog&e=${easting}&n=${northing}`);
      const data = await resp.json();
      if (data.wgsLat && data.wgsLong) return { lat: parseFloat(data.wgsLat), lng: parseFloat(data.wgsLong) };
    }
    throw new Error('HK80 格式不正確');
  }

  if (mode === 'utm') {
    if (!utmOptions) throw new Error('請選擇分區和方格');

    const { zone, square } = utmOptions;
    const refZone = `${zone}Q-${square}`;   // 例如 50Q-KK

    const numberMatches = cleanInput.match(/\d+/g);
    if (!numberMatches || numberMatches.length < 2) {
      throw new Error('請輸入坐標數字');
    }

    const eStr = numberMatches[0];
    const nStr = numberMatches[1];

    // 支援 3~5 位數
    const eOffset = parseInt(eStr);
    const nOffset = parseInt(nStr);

    console.log(`[搜尋] 使用 utmref 模式: zone=${refZone}, e=${eStr}, n=${nStr}`);

    const resp = await fetch(
      `https://www.geodetic.gov.hk/transform/v2/?inSys=utmref&outSys=wgsgeog&zone=${refZone}&e=${eOffset}&n=${nOffset}`
    );

    const data = await resp.json();

    if (data.wgsLat && data.wgsLong) {
      return { 
        lat: parseFloat(data.wgsLat), 
        lng: parseFloat(data.wgsLong) 
      };
    } else {
      console.error('[搜尋] API 錯誤:', data);
      throw new Error('政府 API 轉換失敗：' + (data.ErrorCode || '格式錯誤'));
    }
  }

  throw new Error('未知的坐標模式');
}
