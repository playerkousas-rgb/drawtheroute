/**
 * Geodetic Service - 搜尋功能（已針對限定方格優化）
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

  // 經緯度
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
      const data = await resp.json();
      if (data.wgsLat && data.wgsLong) return { lat: parseFloat(data.wgsLat), lng: parseFloat(data.wgsLong) };
    }
    throw new Error('HK80 格式不正確');
  }

  // UTM 簡寫（已針對限定方格優化）
  if (mode === 'utm') {
    if (!utmOptions) throw new Error('請選擇分區和方格');

    const { zone, square } = utmOptions;
    const refZone = `${zone}Q-${square}`;   // 例如 50Q-KK

    // 只取數字（支援 6~10 位數）
    const digits = cleanInput.replace(/\D/g, '');

    if (digits.length < 6) {
      throw new Error('請輸入至少 6 位數字');
    }

    // 取前一半當 Easting，後一半當 Northing
    const half = Math.floor(digits.length / 2);
    const eStr = digits.substring(0, half);
    const nStr = digits.substring(half);

    const eOffset = parseInt(eStr);
    const nOffset = parseInt(nStr);

    console.log(`[搜尋] 輸入: ${cleanInput} → zone=${refZone}, e=${eStr}, n=${nStr}`);

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
