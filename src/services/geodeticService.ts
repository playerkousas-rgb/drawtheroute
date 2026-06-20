/**
 * Geodetic Service - 正確處理 4 位數簡寫
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
    const lookupKey = `${zone}_${square}`;
    const config = UTM_SQUARE_CONFIG[lookupKey];
    if (!config) throw new Error(`無法辨識 "${zone} ${square}"`);

    const numberMatches = cleanInput.match(/\d+/g);
    if (!numberMatches || numberMatches.length < 2) {
      throw new Error('請輸入坐標數字');
    }

    const eStr = numberMatches[0];
    const nStr = numberMatches[1];

    // ✅ 正確處理：4 位數已經是 10 公尺單位，直接使用
    let eOffset: number;
    let nOffset: number;

    if (eStr.length === 3) {
      eOffset = parseInt(eStr) * 100;      // 3 位數 = 100 公尺
    } else if (eStr.length === 4) {
      eOffset = parseInt(eStr) * 10;       // 4 位數 = 10 公尺（已修正）
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

    console.log(`[搜尋] 輸入: ${cleanInput} → 完整座標 E=${fullE}, N=${fullN}`);

    const resp = await fetch(
      `https://www.geodetic.gov.hk/transform/v2/?inSys=utmgrid&outSys=wgsgeog&zone=${zone}&e=${fullE}&n=${fullN}`
    );

    const data = await resp.json();

    if (data.wgsLat && data.wgsLong) {
      return { 
        lat: parseFloat(data.wgsLat), 
        lng: parseFloat(data.wgsLong) 
      };
    } else {
      console.error('[搜尋] API 錯誤:', data);
      throw new Error('政府 API 轉換失敗：' + (data.ErrorCode || '座標超出範圍'));
    }
  }

  throw new Error('未知的坐標模式');
}
