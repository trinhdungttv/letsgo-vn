// Lớp mật độ dân số (choropleth) cho bản đồ Thị trường.
// LƯU Ý: dữ liệu dưới đây là MOCK/DEMO — ranh giới vẽ đơn giản hoá, dân số & diện tích
// lấy gần đúng theo số liệu công bố. Khi có API/GeoJSON chính thức, chỉ cần thay
// POPULATION_GEOJSON (giữ nguyên schema properties) là toàn bộ layer chạy như cũ.

import L from 'leaflet';
import type { CommuneRow } from './populationData';
import { densityOfRow } from './populationData';

export interface RegionProps {
  name: string;       // Tên khu vực (Quận/Huyện/TP)
  province: string;   // Tỉnh/Thành
  population: number; // Dân số (người)
  area_km2: number;   // Diện tích (km²)
}

type RegionFeature = GeoJSON.Feature<GeoJSON.Polygon, RegionProps>;

// Ngưỡng phân cấp mật độ (người/km²) và màu tương ứng (nhạt → đậm).
export const DENSITY_BREAKS = [500, 1000, 2000, 3000, 5000, 10000];
export const DENSITY_COLORS = ['#FFEDA0', '#FED976', '#FEB24C', '#FD8D3C', '#FC4E2A', '#E31A1C', '#800026'];

export function densityOf(p: RegionProps): number {
  return p.area_km2 > 0 ? p.population / p.area_km2 : 0;
}

export function densityColor(d: number): string {
  for (let i = DENSITY_BREAKS.length - 1; i >= 0; i--) {
    if (d >= DENSITY_BREAKS[i]) return DENSITY_COLORS[i + 1];
  }
  return DENSITY_COLORS[0];
}

const fmt = (n: number) => n.toLocaleString('vi-VN');

// Polygon đơn giản hoá (toạ độ [lng, lat]) — chỉ để demo, KHÔNG phải ranh giới pháp lý.
function region(name: string, province: string, population: number, area_km2: number, ring: [number, number][]): RegionFeature {
  return {
    type: 'Feature',
    properties: { name, province, population, area_km2 },
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
  };
}

export const POPULATION_GEOJSON: GeoJSON.FeatureCollection<GeoJSON.Polygon, RegionProps> = {
  type: 'FeatureCollection',
  features: [
    region('TP. Thủ Đức', 'TP.HCM', 1207795, 211.56,
      [[106.70, 10.87], [106.77, 10.90], [106.84, 10.87], [106.85, 10.78], [106.76, 10.75], [106.70, 10.79]]),
    region('Quận Bình Thạnh', 'TP.HCM', 499164, 20.78,
      [[106.68, 10.83], [106.73, 10.83], [106.73, 10.78], [106.68, 10.78]]),
    region('Quận 7', 'TP.HCM', 360155, 35.69,
      [[106.69, 10.76], [106.75, 10.76], [106.75, 10.71], [106.69, 10.71]]),
    region('Huyện Nhà Bè', 'TP.HCM', 206837, 100.43,
      [[106.68, 10.71], [106.76, 10.71], [106.78, 10.62], [106.70, 10.60], [106.66, 10.66]]),
    region('Huyện Củ Chi', 'TP.HCM', 468269, 434.77,
      [[106.42, 11.05], [106.60, 11.08], [106.66, 10.98], [106.58, 10.88], [106.44, 10.92]]),
    region('TP. Biên Hoà', 'Đồng Nai', 1055414, 263.62,
      [[106.78, 10.98], [106.90, 11.00], [106.94, 10.92], [106.86, 10.86], [106.78, 10.90]]),
    region('Huyện Trảng Bom', 'Đồng Nai', 380000, 326.24,
      [[106.94, 11.00], [107.06, 11.02], [107.10, 10.92], [106.98, 10.88], [106.94, 10.92]]),
    region('Huyện Long Thành', 'Đồng Nai', 246000, 430.62,
      [[106.88, 10.86], [107.02, 10.88], [107.06, 10.74], [106.94, 10.70], [106.88, 10.78]]),
    region('Huyện Nhơn Trạch', 'Đồng Nai', 263551, 376.80,
      [[106.78, 10.78], [106.88, 10.78], [106.92, 10.64], [106.80, 10.60], [106.74, 10.68]]),
    region('TP. Thủ Dầu Một', 'Bình Dương', 336705, 118.67,
      [[106.60, 11.02], [106.68, 11.04], [106.70, 10.96], [106.62, 10.94]]),
    region('TP. Dĩ An', 'Bình Dương', 463023, 60.05,
      [[106.72, 10.94], [106.80, 10.94], [106.80, 10.86], [106.72, 10.86]]),
    region('TP. Bến Cát', 'Bình Dương', 355663, 234.35,
      [[106.52, 11.20], [106.66, 11.22], [106.70, 11.10], [106.56, 11.06], [106.50, 11.12]]),
  ],
};

/**
 * Tạo lớp choropleth mật độ dân số. Polygon nằm ở overlayPane (z-index 400)
 * nên luôn dưới marker (markerPane 600) — không đè marker hiện có.
 */
export function createPopulationLayer(): L.GeoJSON {
  return L.geoJSON(POPULATION_GEOJSON, {
    style: feature => {
      const p = feature?.properties as RegionProps;
      return {
        fillColor: densityColor(densityOf(p)),
        fillOpacity: 0.55,
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.9,
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties as RegionProps;
      const d = densityOf(p);
      layer.bindTooltip(
        `<div class="lgmap-region-name">${p.name} <span>· ${p.province}</span></div>` +
        `<div class="lgmap-region-row">Dân số: <b>${fmt(p.population)}</b> người</div>` +
        `<div class="lgmap-region-row">Diện tích: <b>${fmt(Math.round(p.area_km2 * 10) / 10)}</b> km²</div>` +
        `<div class="lgmap-region-row">Mật độ: <b>${fmt(Math.round(d))}</b> người/km²</div>`,
        { sticky: true, className: 'lgmap-region-tooltip' },
      );
      layer.on({
        mouseover: e => {
          const t = e.target as L.Path;
          t.setStyle({ weight: 3, color: '#666', fillOpacity: 0.75 });
          t.bringToFront?.();
        },
        mouseout: e => {
          const t = e.target as L.Path;
          t.setStyle({ weight: 1.5, color: '#ffffff', fillOpacity: 0.55 });
        },
        click: e => {
          const poly = e.target as L.Polygon;
          const map = (poly as unknown as { _map?: L.Map })._map;
          map?.fitBounds(poly.getBounds().pad(0.2));
        },
      });
    },
  });
}

/**
 * Vẽ lớp mật độ dân số từ dữ liệu Xã/Phường thật (bảng population_communes).
 * Có geometry (polygon) thì tô vùng như choropleth chuẩn; chỉ có lat/lng thì vẽ
 * circle marker to/nhỏ + màu theo mật độ (giải pháp tạm khi chưa có ranh giới polygon).
 */
export function createCommuneLayer(rows: CommuneRow[]): L.LayerGroup {
  const group = L.layerGroup();
  rows.forEach(r => {
    const d = densityOfRow(r);
    const color = densityColor(d);
    const tooltipHtml =
      `<div class="lgmap-region-name">${r.commune_name} <span>· ${r.province_new}${r.province_old ? ` (từ ${r.province_old})` : ''}</span></div>` +
      `<div class="lgmap-region-row">Dân số: <b>${fmt(r.population)}</b> người</div>` +
      `<div class="lgmap-region-row">Diện tích: <b>${fmt(Math.round(r.area_km2 * 10) / 10)}</b> km²</div>` +
      `<div class="lgmap-region-row">Mật độ: <b>${fmt(Math.round(d))}</b> người/km²</div>`;

    if (r.geometry) {
      const layer = L.geoJSON(r.geometry, {
        style: { fillColor: color, fillOpacity: 0.55, color: '#ffffff', weight: 1.5, opacity: 0.9 },
      });
      layer.bindTooltip(tooltipHtml, { sticky: true, className: 'lgmap-region-tooltip' });
      layer.on({
        mouseover: e => { const t = e.target as L.Path; t.setStyle({ weight: 3, color: '#666', fillOpacity: 0.75 }); },
        mouseout: e => { const t = e.target as L.Path; t.setStyle({ weight: 1.5, color: '#ffffff', fillOpacity: 0.55 }); },
      });
      group.addLayer(layer);
    } else if (r.lat != null && r.lng != null) {
      // Bán kính tăng dần theo mật độ (chưa có polygon để tô vùng thật).
      const radius = 6 + Math.min(Math.sqrt(d) / 6, 24);
      const marker = L.circleMarker([r.lat, r.lng], {
        radius, fillColor: color, fillOpacity: 0.75, color: '#ffffff', weight: 1.5, opacity: 0.9,
      });
      marker.bindTooltip(tooltipHtml, { sticky: true, className: 'lgmap-region-tooltip' });
      group.addLayer(marker);
    }
  });
  return group;
}

/** Bảng chú thích màu (legend) — đặt góc dưới trái bản đồ. */
export function createDensityLegend(note = 'Số liệu demo — ranh giới đơn giản hoá'): L.Control {
  const legend = new L.Control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'lgmap-legend');
    const rows = DENSITY_COLORS.map((color, i) => {
      const from = i === 0 ? 0 : DENSITY_BREAKS[i - 1];
      const to = DENSITY_BREAKS[i];
      const label = i === 0
        ? `&lt; ${fmt(DENSITY_BREAKS[0])}`
        : to != null ? `${fmt(from)} – ${fmt(to)}` : `&ge; ${fmt(from)}`;
      return `<div class="lgmap-legend-row"><span class="lgmap-legend-swatch" style="background:${color}"></span>${label}</div>`;
    }).join('');
    div.innerHTML =
      `<div class="lgmap-legend-title">Mật độ dân số (người/km²)</div>${rows}` +
      `<div class="lgmap-legend-note">${note}</div>`;
    return div;
  };
  return legend;
}
