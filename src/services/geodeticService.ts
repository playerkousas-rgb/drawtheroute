/**
 * Geodetic Service
 * Handles all authoritative coordinate conversions.
 */
import proj4 from 'proj4';
import { UTM_SQUARE_BASES } from '../utils/coordUtils';

// 定義 UTM Zone 50N (EPSG:32650)
proj4.defs("EPSG:32650", "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs");

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
        if (data.wgsLat && data.wgsLong) return { lat: parseFloat(data.wgsLat), lng: parseFloat(data.wgsLong) };
      }
    }
    throw new Error('HK80 格式不正確。請使用: 830670 82346');
  }

  if (mode === 'utm') {
    const utmMatch = cleanInput.match(/^([45]0[PQ])?\s*([A-Z]{2})?\s*(\d{8}|\d{4}\s*\d{4})$/i);
    if (utmMatch) {
      const zone = utmMatch[1]?.toUpperCase() || '50Q'; 
      const square = utmMatch[2]?.toUpperCase();
      let eastingStr = '';
      let northingStr = '';

      const coordsPart = utmMatch[3];
      if (coordsPart.length === 8) {
        eastingStr = coordsPart.slice(0, 4);
        northingStr = coordsPart.slice(4);
      } else {
        const parts = coordsPart.split(/\s+/).filter(Boolean);
        eastingStr = parts[0];
        northingStr = parts[1];
      }

      const eastingOffset = parseInt(eastingStr);
      const northingOffset = parseInt(northingStr);

      if (!square) throw new Error('請提供方格碼 (例如: 50Q KK 0670 2346)。');

      const lookupKey = `${zone}_${square}`;
      const base = UTM_SQUARE_BASES[lookupKey];
      if (!base) throw new Error(`無法辨識分區/方格組合 "${lookupKey}"。請注意：50Q KK 等格式僅適用於香港地區，世界其他地方請使用經緯度。`);

      const fullE = base[0] + eastingOffset;
      const fullN = base[1] + northingOffset;
      
      // 根據 Zone 選擇投影
      const projZone = zone.startsWith('49') ? "EPSG:32649" : "EPSG:32650";
      const wgs = proj4(projZone, "EPSG:4326", [fullE, fullN]);
      return { lat: wgs[1], lng: wgs[0] };
    }
    throw new Error('UTM 格式不正確或超出香港範圍。請注意：50Q KK 等格式僅適用於香港地區，世界其他地方請使用經緯度。正確格式示例: 50Q KK 0670 2346');
  }

  throw new Error('未知的坐標模式');
}
