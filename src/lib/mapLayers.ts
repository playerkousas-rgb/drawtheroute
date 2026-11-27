import type { MapLayer } from '../types';
import type { TileSource } from './mapImageExport';

/** 底圖元資料（credit 必須跟條款；hm20c = LandsD TNC 要求）。
 *  由 MapExportDialog 同 Canvas bridge 截图共用，避免兩份漂移。 */
export const LAYER_META: Record<MapLayer, TileSource & { credit: string; name: string }> = {
  osm:       { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                                            maxZoom: 19, credit: '© OpenStreetMap',          name: '街道圖' },
  topo:      { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                                              maxZoom: 17, credit: '© OpenTopoMap',            name: '地形圖' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, credit: 'Imagery © Esri, Maxar, GeoEye', name: '衛星圖' },
  hm20c:     { url: 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png',                  maxZoom: 20, credit: 'Map from Lands Department', name: 'HM20C 地形圖' },
};
