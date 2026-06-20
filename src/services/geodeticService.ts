/**
 * Geodetic Service - 完全對齊沙盒測試成功的格式
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

    const { zone, square } = utmOptions;
    const refZone = `${zone}Q-${square}`;

    // 只保留數字
    const digits = cleanInput.replace(/\D/g, '');

    if (digits.length < 6) {
      throw new Error('請輸入至少 6 位數字');
    }

    // 直接取前一半當 e，後一半當 n（保留原始位數）
    const half = Math.floor(digits.length / 2);
    const eStr = digits.substring(0, half);
    const nStr = digits.substring(half);

    const fullUrl = `https://www.geodetic.gov.hk/transform/v2/?inSys=utmref&outSys=hkgrid&e=${eStr}&n=${nStr}&zone=${refZone}`;
    console.log('[搜尋] 完整 URL:', fullUrl);

    // Step 1
    const step1 = await fetch(fullUrl);
    const step1Data = await step1.json();
    console.log('[搜尋] Step1 回傳:', step1Data);

    if (!step1Data.hkE || !step1Data.hkN) {
      throw new Error('政府 API 轉換失敗（Step1）：' + (step1Data.ErrorCode || '未知錯誤'));
    }

    // Step 2
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
