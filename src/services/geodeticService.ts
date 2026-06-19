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
    const base = UTM_SQUARE_BASES[lookupKey];
    if (!base) throw new Error(`無法辨識分區/方格組合 "${lookupKey}"。`);

    const numberMatches = cleanInput.match(/\d+/g);
    if (!numberMatches || numberMatches.length < 2) {
      throw new Error('請輸入 8 位座標數字 (例如: 0670 2346)');
    }

    let eOffset = parseInt(numberMatches[0]);
    let nOffset = parseInt(numberMatches[1]);

    // 🚀 核心邏輯：還原為全座標 (Full UTM)
    // 如果輸入的是完整 6 位數/7 位數，則直接使用；否則加上基數
    const fullE = eOffset >= 100000 ? eOffset : (base[0] + eOffset);
    const fullN = nOffset >= 100000 ? nOffset : (2470000 + nOffset);
    
    // 🚀 終極方案：將全座標發送給政府 API 進行權威轉換
    try {
      // UTM 轉換 API 接口: inSys=utmgrid (True UTM) -> outSys=wgsgeog (經緯度)
      // 注意：API 需要知道 Zone，我們將 zone 傳入參數中 (例如 50)
      const zoneNum = zone.replace('Q', ''); 
      const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=utmgrid&outSys=wgsgeog&zone=${zoneNum}&e=${fullE}&n=${fullN}`);
      
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
