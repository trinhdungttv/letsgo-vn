// Bản đồ nguồn lao động: mỗi xã/phường ứng viên đang ở = 1 vòng tròn (to = nhiều hồ sơ, xanh đậm = tỷ lệ đi làm
// cao, đỏ = hay nghỉ sớm), cùng vị trí các nhà máy — trả lời "vùng nào nhiều lao động, đi làm bền" (nhóm B).
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { streetTiles } from '../../lib/mapTiles';
import type { GeoRow } from '../../lib/recruit/api';
import type { RecruitSite } from '../../lib/recruit/types';

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

export default function SourceMap({ rows, sites }: { rows: GeoRow[]; sites: RecruitSite[] }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!divRef.current) return;
    const map = L.map(divRef.current, { scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    streetTiles().addTo(map);
    map.setView([10.95, 106.8], 10);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: L.LatLngExpression[] = [];
    const max = Math.max(1, ...rows.map(r => r.total));
    for (const r of rows) {
      if (r.lat == null || r.lng == null) continue;
      const rate = r.total ? r.started / r.total : 0;
      const early = r.started ? r.early_left / r.started : 0;
      const color = early >= 0.3 ? '#FF3B30' : rate >= 0.3 ? '#1E7B34' : rate > 0 ? '#34C759' : '#8E8E93';
      L.circleMarker([r.lat, r.lng], { radius: 6 + 22 * Math.sqrt(r.total / max), color, weight: 1.5, fillColor: color, fillOpacity: 0.35 })
        .bindTooltip(`<b>${esc(r.commune || 'Không rõ xã')}</b>${r.province ? `, ${esc(r.province)}` : ''}<br>${r.total} hồ sơ · ${r.started} đi làm${r.early_left ? ` · ${r.early_left} nghỉ sớm` : ''}`)
        .addTo(layer);
      pts.push([r.lat, r.lng]);
    }
    for (const s of sites) {
      if (s.lat == null || s.lng == null) continue;
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html: `<div style="background:#0071E3;color:#fff;font:600 11px -apple-system,sans-serif;padding:3px 7px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.25);display:inline-block">🏭 ${esc(s.name)}</div>`, iconSize: [110, 22], iconAnchor: [14, 11] }),
      }).addTo(layer);
      pts.push([s.lat, s.lng]);
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 12 });
  }, [rows, sites]);

  return <div ref={divRef} className="w-full h-[360px] md:h-[440px] rounded-[14px] overflow-hidden z-0" />;
}
