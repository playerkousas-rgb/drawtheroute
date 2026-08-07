function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
  );
}

export interface GpxPoint {
  lat: number;
  lng: number;
  elevation: number;
}

/**
 * 匯出 GPX：
 * - waypoints（起點 / 中間檢查點 CP / 終點）寫成 <wpt>，以保留 CP 結構
 * - 完整路徑寫成單一 <trkseg>
 */
export function exportGPX(
  points: GpxPoint[],
  name = '路線',
  waypoints: GpxPoint[] = []
): string {
  const now = new Date().toISOString();
  const safeName = escapeXml(name);

  const wpts = waypoints.map((w, i) => {
    const label = i === 0 ? '起點' : i === waypoints.length - 1 ? '終點' : `CP${i}`;
    return `    <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}">
      <ele>${w.elevation.toFixed(1)}</ele>
      <name>${escapeXml(label)}</name>
      <time>${now}</time>
    </wpt>`;
  }).join('\n');

  const trkpts = points.map(p =>
    `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">
        <ele>${p.elevation.toFixed(1)}</ele>
        <time>${now}</time>
      </trkpt>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ReliefForge Pro - SKWSCOUT"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${safeName}</name><time>${now}</time></metadata>
${wpts ? `${wpts}\n` : ''}  <trk><name>${safeName}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`;
}
