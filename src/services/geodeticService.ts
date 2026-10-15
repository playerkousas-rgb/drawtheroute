/**
 * Geodetic Service - 修正 zone 格式
 */
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

    // 直接使用傳進來的 zone 和 square（不要再加 Q）
    const refZone = `${utmOptions.zone}-${utmOptions.square}`;

    const digits = cleanInput.replace(/\D/g, '');
    if (digits.length < 6) throw new Error('請輸入至少 6 位數字');

    const half = Math.floor(digits.length / 2);
    const eStr = digits.substring(0, half);
    const nStr = digits.substring(half);

    const fullUrl = `https://www.geodetic.gov.hk/transform/v2/?inSys=utmref&outSys=hkgrid&e=${eStr}&n=${nStr}&zone=${refZone}`;
    console.log('[搜尋] 完整 URL:', fullUrl);

    const step1 = await fetch(fullUrl);
    const step1Data = await step1.json();
    console.log('[搜尋] Step1 回傳:', step1Data);

    if (!step1Data.hkE || !step1Data.hkN) {
      throw new Error('政府 API 轉換失敗（Step1）：' + (step1Data.ErrorCode || '未知錯誤'));
    }

    const step2Url = `https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&outSys=wgsgeog&e=${step1Data.hkE}&n=${step1Data.hkN}`;
    console.log('[搜尋] Step2 URL:', step2Url);

    const step2 = await fetch(step2Url);
    const step2Data = await step2.json();
    console.log('[搜尋] Step2 回傳:', step2Data);

    if (step2Data.wgsLat && step2Data.wgsLong) {
      return {
        lat: parseFloat(step2Data.wgsLat),
        lng: parseFloat(step2Data.wgsLong)
      };
    } else {
      throw new Error('政府 API 轉換失敗（Step2）：' + (step2Data.ErrorCode || '未知錯誤'));
    }
  }

  throw new Error('未知的坐標模式');
}

// ══════════════════════════════════════════════════════════════════════════
//  手動輸入座標（路線計畫表用）
//  支援：WGS84「22.3193, 114.1694」、UTM 4 位簡寫「50Q KK 0670 2346」
//        「KK 0670 2346」、「06702346」
// ══════════════════════════════════════════════════════════════════════════

const HK_BOX = { minLat: 22.13, maxLat: 22.60, minLng: 113.80, maxLng: 114.50 };
const inHKBox = (lat: number, lng: number) =>
  lat >= HK_BOX.minLat && lat <= HK_BOX.maxLat && lng >= HK_BOX.minLng && lng <= HK_BOX.maxLng;

/** 解析經緯度輸入；若順序打反（緯經倒轉）亦會自動修正 */
export function parseLatLngInput(raw: string): LatLng | null {
  const parts = raw.trim().replace(/[()（）]/g, '').split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;   // 一定唔係經緯度
  if (inHKBox(a, b)) return { lat: a, lng: b };
  if (inHKBox(b, a)) return { lat: b, lng: a };              // 香港範圍內 → 當用戶打反咗
  return { lat: a, lng: b };
}

/** 解析 UTM 4 位簡寫（可省略 zone／grid square，省略時用 50Q KK） */
export function parseUtmShorthand(raw: string): { zone: string; square: string; digits: string } | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = /^(?:(\d{2})Q)?(GE|HE|JK|KK)?(\d{6,8})$/.exec(s);
  if (!m) return null;
  const [, zoneRaw, squareRaw, digits] = m;
  if (!zoneRaw && !squareRaw) return { zone: '50Q', square: 'KK', digits };
  if (!zoneRaw) {
    // 由 grid square 反推 zone：GE/HE → 49Q；JK/KK → 50Q
    const zone = squareRaw === 'GE' || squareRaw === 'HE' ? '49Q' : '50Q';
    return { zone, square: squareRaw as string, digits };
  }
  if (!squareRaw) {
    return { zone: `${zoneRaw}Q`, square: zoneRaw === '49' ? 'HE' : 'KK', digits };
  }
  // 有 zone 又有 square：以 square 所屬 zone 為準
  const zone = squareRaw === 'GE' || squareRaw === 'HE' ? '49Q' : '50Q';
  return { zone, square: squareRaw, digits };
}

/**
 * 通用座標輸入解析：先試經緯度，再試 UTM 簡寫（後者經政府 API 轉換）。
 * 失敗會 throw，附上格式提示。
 */
export async function parseCoordinateInput(raw: string): Promise<LatLng> {
  const text = raw.trim();
  if (!text) throw new Error('請輸入座標');

  const ll = parseLatLngInput(text);
  if (ll) return ll;

  const utm = parseUtmShorthand(text);
  if (utm) {
    return convertToWgs84(utm.digits, 'utm', { zone: utm.zone, square: utm.square });
  }

  throw new Error('格式不正確（例：22.3193, 114.1694 或 50Q KK 0670 2346）');
}
