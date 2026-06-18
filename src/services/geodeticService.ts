/**
 * Geodetic Service
 * Handles all authoritative coordinate conversions.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

// Local constants for HK80 projection (Fallback Engine)
const HK80_CONSTANTS = {
  N0: 811555.11,
  E0: 836694.05,
  phi0: 22.25 * Math.PI / 180,
  lambda0: 114.16666666666667 * Math.PI / 180,
  m0: 0.99992,
  a: 6378388.0,
  f: 1 / 297.0,
};

/**
 * High-precision local math conversion (Fallback)
 * Based on Transverse Mercator projection
 */
function localHk80ToWgs84(N: number, E: number): LatLng {
  const { N0, E0, phi0, lambda0, m0, a, f } = HK80_CONSTANTS;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ePrime2 = (a * a - b * b) / (b * b);

  const dy = N - N0;
  const dx = E - E0;

  const M0 = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi0 
               - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi0)
               + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi0)
               - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi0));

  const M = M0 + dy / m0;
  let phi1 = M / (a * (1 - e2 / 4));
  let delta = 1;
  while (Math.abs(delta) > 1e-11) {
    let sin2 = Math.sin(2 * phi1);
    let sin4 = Math.sin(4 * phi1);
    let sin6 = Math.sin(6 * phi1);
    let Mi = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi1 
             - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * sin2
             + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * sin4
             - (35 * e2 * e2 * e2 / 3072) * sin6);
    delta = M - Mi;
    phi1 += delta / a;
  }

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const D = dx / (N1 * m0);

  const latHK80 = phi1 - (N1 * tan1 / R1) * (D * D / 2 - (5 + 3 * tan1 * tan1 + 10 * ePrime2 * cos1 * cos1 - 4 * ePrime2 * ePrime2 * cos1 * cos1 * cos1 * cos1 - 9 * tan1 * tan1 * ePrime2 * cos1 * cos1) * Math.pow(D, 4) / 24);
  const lngHK80 = lambda0 + (D - (1 + 2 * tan1 * tan1 + ePrime2 * cos1 * cos1) * Math.pow(D, 3) / 6 + (5 - 2 * ePrime2 * cos1 * cos1 + 28 * tan1 * tan1 - 3 * ePrime2 * ePrime2 * cos1 * cos1 * cos1 * cos1 + 8 * ePrime2 * cos1 * cos1 * tan1 * tan1 + 24 * tan1 * tan1 * tan1 * tan1) * Math.pow(D, 5) / 120) / cos1;

  const latDeg = latHK80 * 180 / Math.PI;
  const lngDeg = lngHK80 * 180 / Math.PI;

  // Datum transformation
  return {
    lat: latDeg - 0.0000475 + (latDeg - 22.0) * 0.0000012,
    lng: lngDeg + 0.0024423 + (lngDeg - 114.0) * 0.0000203,
  };
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

  let easting: number, northing: number;

  if (mode === 'hk80') {
    const parts = cleanInput.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 2) {
      easting = parseFloat(parts[0]);
      northing = parseFloat(parts[1]);
      if (isNaN(easting) || isNaN(northing)) throw new Error('HK80 格式不正確。');
    } else {
      throw new Error('HK80 格式不正確。請使用: 830670 82346');
    }
  } else if (mode === 'utm') {
    const utmMatch = cleanInput.match(/^([45]0[PQ])?\s*([A-Z]{2})?\s*(\d{4})\s*(\d{4})$/i);
    if (utmMatch) {
      let square = utmMatch[2]?.toUpperCase();
      const rawE = utmMatch[3];
      const rawN = utmMatch[4];

      if (!square) throw new Error('請提供方格碼 (例如: KK 0670 2346)。');

      const squareMap: Record<string, [string, string]> = {
        'KK': ['83', '82'], 'JK': ['83', '81'], 'HE': ['81', '82'], 'GE': ['81', '81'],
        'LK': ['84', '82'], 'MK': ['84', '81'], 'KE': ['82', '82'], 'JE': ['82', '81'],
        'FK': ['80', '82'], 'GK': ['80', '81'], 'FE': ['80', '82'], 
        'AK': ['79', '82'], 'BK': ['79', '81'],
      };

      const prefix = squareMap[square];
      if (!prefix) throw new Error(`無法辨識方格碼 "${square}"。`);
      easting = parseInt(`${prefix[0]}${rawE}`, 10);
      northing = parseInt(`${prefix[1]}${rawN}`, 10);
    } else {
      throw new Error('UTM 格式不正確。請使用: 50Q KK 0670 2346');
    }
  } else {
    throw new Error('未知的坐標模式');
  }

  // Try official API first for absolute precision
  try {
    const resp = await fetch(`https://www.geodetic.gov.hk/transform/v2/?inSys=hkgrid&outSys=wgsgeog&e=${easting}&n=${northing}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.lat && data.long) return { lat: parseFloat(data.lat), lng: parseFloat(data.long) };
    }
  } catch (e) {
    console.warn("API request failed, using local fallback engine", e);
  }

  // Fallback to high-precision local math
  return localHk80ToWgs84(northing, easting);
}
