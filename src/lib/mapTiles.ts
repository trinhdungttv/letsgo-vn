// Lớp nền bản đồ đường phố dùng chung (CSKH, Thị trường, bản đồ nhỏ): OpenStreetMap chuẩn → hỏng thì
// OSM chuẩn qua server LetsGo → OSM France (cùng dữ liệu, kiểu khác) → Esri. Quy tắc chọn nguồn ở mapTileChoice.ts.
// Trả về 1 LayerGroup: nơi gọi thêm / gỡ khỏi bản đồ như 1 lớp bình thường (VD bật tắt vệ tinh),
// việc đổi nguồn diễn ra bên trong nhóm.
import L from 'leaflet';
import { rememberTileProvider, shouldFallback, startTileProvider, TILE_PROVIDER_KEYS, type TileProviderKey } from './mapTileChoice';

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const PROVIDERS: Readonly<Record<TileProviderKey, { url: string; options: L.TileLayerOptions }>> = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: OSM_ATTR } },
  // Cùng ảnh nền OSM chuẩn, server LetsGo (Vercel) tải hộ khi mạng chặn openstreetmap.org — xem api/osm-tile.ts
  osmproxy: { url: '/api/osm-tile?z={z}&x={x}&y={y}', options: { maxZoom: 19, attribution: OSM_ATTR } },
  // Máy chủ cộng đồng OSM France — cùng dữ liệu OSM, nhãn tiếng Việt; khác hạ tầng nên thường vẫn vào được khi OSM bị chặn.
  // (CARTO từng thử: nay trả ảnh "API KEY REQUIRED" thay vì báo lỗi — không dùng được.)
  osmfr: {
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    options: { maxZoom: 20, subdomains: 'abc', attribution: `${OSM_ATTR} &copy; <a href="https://www.openstreetmap.fr">OSM France</a>` },
  },
  esri: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles &copy; Esri' },
  },
};

const STORE_KEY = 'lgvn_map_tiles_v3';

function readStored(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}
function writeStored(v: string) {
  try { localStorage.setItem(STORE_KEY, v); } catch { /* chế độ riêng tư — lần sau dò lại, chấp nhận được */ }
}

/** Lớp nền đường phố có tự chuyển nguồn dự phòng. */
export function streetTiles(): L.LayerGroup {
  const group = L.layerGroup();
  let current = startTileProvider(readStored(), Date.now());
  const showProvider = (index: number) => {
    group.clearLayers();
    const { url, options } = PROVIDERS[TILE_PROVIDER_KEYS[index]];
    const layer = L.tileLayer(url, options);
    let loaded = 0;
    let failed = 0;
    layer.on('tileload', () => {
      if (loaded++ === 0) writeStored(rememberTileProvider(index, Date.now()));
    });
    layer.on('tileerror', () => {
      failed += 1;
      if (current === index && shouldFallback(loaded, failed, index)) {
        current = index + 1;
        showProvider(current);
      }
    });
    group.addLayer(layer);
  };
  showProvider(current);
  return group;
}
