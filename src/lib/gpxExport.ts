export function exportGPX(points: { lat:number; lng:number; elevation:number }[], name = '路線'): string {
  const now = new Date().toISOString();
  const trkpts = points.map(p =>
    `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">
        <ele>${p.elevation.toFixed(1)}</ele>
        <time>${now}</time>
      </trkpt>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ReliefForge Pro - SKWSCOUT"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name><time>${now}</time></metadata>
  <trk><name>${name}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`;
}
