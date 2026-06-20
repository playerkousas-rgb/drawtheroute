/**
 * Geodetic Service - 兩步驟轉換（utmref → hkgrid → wgsgeog）
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

  // UTM 簡寫（兩步驟轉換）
  if (mode === 'utm') {
    if (!utmOptions) throw new Error('請選擇分區和方格');

    const { zone, square } = utmOptions;
    const refZone = `${zone}Q-${square}`;

    const digits = cleanInput.replace(/\D/g, '');
    if (digits.length < 6) throw new Error('請輸入至少 6 位數字');

    const half = Math.floor(digits.length / 2);
    const eStr = digits.substring(0, half);
    const nStr = digits.substring(half);

    console.log(`[搜尋] Step1: utmref → hkgrid | zone=${refZone}, e=${eStr}, n=${nStr}`);

    // 步驟 1: utmref → hkgrid
    const step1 = await fetch(
      `https://www.geodetic.gov.hk/transform/v2/?inSys=utmref&outSys=hkgrid&e=${eStr}&n=${nStr}&zone=${refZone}`
    );
    const step1Data = await step1.json();

    if (!step1Data.hkE || !step1Data.hkN) {
      console.error('[搜尋] Step1 失敗:', step1Data);
      throw new Error('政府 API 轉換失敗（Step1）');
    }

    console.log(`[搜尋] Step2: hkgrid → wgsgeog | e=${step1Data.hkE}, n=${step1Data.hkN}`);

    // 步驟 2: hkgrid → wgsgeog
    const step2 = await fetch(
      `https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&outSys=wgsgeog&e=${step1Data.hkE}&n=${step1Data.hkN}`
    );
    const step2Data = await step2.json();

    if (step2Data.wgsLat && step2Data.wgsLong) {
      return {
        lat: parseFloat(step2Data.wgsLat),
        lng: parseFloat(step2Data.wgsLong)
      };
    } else {
      console.error('[搜尋] Step2 失敗:', step2Data);
      throw new Error('政府 API 轉換失敗（Step2）');
    }
  }

  throw new Error('未知的坐標模式');
}
