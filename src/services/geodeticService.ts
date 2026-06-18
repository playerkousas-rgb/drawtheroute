/**
 * Geodetic Service
 * Handles all authoritative coordinate conversions using the Hong Kong Government Geodetic API.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export async function convertToWgs84(input: string, mode: 'utm' | 'hk80' | 'latlng'): Promise<LatLng> {
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
        if (data.lat && data.long) return { lat: parseFloat(data.lat), lng: parseFloat(data.long) };
      }
    }
    throw new Error('HK80 格式不正確。請使用: 830670 82346');
  }

  if (mode === 'utm') {
    // Support "50Q KK 0670 2346", "KK 0670 2346", "0670 2346"
    const utmMatch = cleanInput.match(/^([45]0[PQ])?\s*([A-Z]{2})?\s*(\d{4})\s*(\d{4})$/i);
    if (utmMatch) {
      let square = utmMatch[2]?.toUpperCase();
      const rawE = utmMatch[3];
      const rawN = utmMatch[4];

      if (!square) {
        throw new Error('請提供方格碼 (例如: KK 0670 2346) 以精確定位。');
      }

      const squareMap: Record<string, [string, string]> = {
        'KK': ['83', '82'], 'JK': ['83', '81'], 'HE': ['81', '82'], 'GE': ['81', '81'],
        'LK': ['84', '82'], 'MK': ['84', '81'], 'KE': ['82', '82'], 'JE': ['82', '81'],
        'FK': ['80', '82'], 'GK': ['80', '81'], 'FE': ['80', '82'], 
        'AK': ['79', '82'], 'BK': ['79', '81'],
      };

      const prefix = squareMap[square];
      if (prefix) {
        const easting = `${prefix[0]}${rawE}`;
        const northing = `${prefix[1]}${rawN}`;
        const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&outSys=wgsgeog&e=${easting}&n=${northing}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.lat && data.long) return { lat: parseFloat(data.lat), lng: parseFloat(data.long) };
        }
      }
      throw new Error(`無法解析方格碼 "${square}" 或 API 轉換失敗。`);
    }
    throw new Error('UTM 格式不正確。請使用: 50Q KK 0670 2346');
  }

  throw new Error('未知的坐標模式');
}
