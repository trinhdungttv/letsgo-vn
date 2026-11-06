// Bản đồ nhỏ trong tab Khảo sát KCN: vết các chuyến (chuyến đang chọn tô cam), ảnh chỉ tiêu và ghi âm ở đúng chỗ ghi.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { streetTiles } from '../../../lib/mapTiles';
import { escapeMapHtml, SOUTH_VN_BOUNDS } from '../../../lib/mapGroups';
import type { SurveyPhoto, SurveyVoiceNote } from '../../../lib/kcnSurvey/api';
import { UNVERIFIED_TAG } from '../../../lib/kcnSurvey/online';
import type { TrackSegment } from '../../../lib/kcnSurvey/track';
import { fmtClock } from './surveyFormat';

interface Props {
  /** tripId → vết; chuyến `selectedId` vẽ nổi bật */
  tracks: Map<string, TrackSegment[]>;
  selectedId: string | null;
  photos: readonly SurveyPhoto[];
  voiceNotes: readonly SurveyVoiceNote[];
  onPhoto: (p: SurveyPhoto) => void;
  onVoice: (n: SurveyVoiceNote) => void;
  onTrip?: (tripId: string) => void;
  /** đổi giá trị này → bản đồ tự canh lại khung nhìn */
  fitKey: string;
  /** đưa bản đồ tới 1 điểm (bấm "Xem chỗ chụp") */
  focus?: { lat: number; lng: number; key: number } | null;
  className?: string;
}

export default function SurveyTripMap({ tracks, selectedId, photos, voiceNotes, onPhoto, onVoice, onTrip, fitKey, focus, className = '' }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<{ tracks: L.LayerGroup; marks: L.LayerGroup; renderer: L.Canvas } | null>(null);
  const cb = useRef({ onPhoto, onVoice, onTrip });
  cb.current = { onPhoto, onVoice, onTrip };

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: true, maxZoom: 19 });
    map.attributionControl.setPrefix(false);
    map.fitBounds(SOUTH_VN_BOUNDS);
    streetTiles().addTo(map);
    const renderer = L.canvas({ padding: 0.5 });
    layerRef.current = { tracks: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map), renderer };
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(divRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, ly = layerRef.current;
    if (!map || !ly) return;
    // Khung có thể vừa đổi cỡ (phóng bản đồ kín màn hình) → đo lại trước khi canh vùng
    map.invalidateSize({ pan: false });
    ly.tracks.clearLayers();
    ly.marks.clearLayers();
    const bounds = L.latLngBounds([]);
    const sel: L.LatLngExpression[][] = [];
    for (const [id, segs] of tracks) {
      const lines = segs.filter(s => s.length >= 2).map(s => s.map(p => [p[0], p[1]] as [number, number]));
      if (!lines.length) continue;
      if (id === selectedId) { sel.push(...lines); continue; }
      const pl = L.polyline(lines, { color: '#64748B', weight: 4, opacity: selectedId ? 0.35 : 0.7, renderer: ly.renderer });
      if (cb.current.onTrip) pl.on('click', () => cb.current.onTrip?.(id));
      pl.addTo(ly.tracks);
      if (!selectedId) lines.forEach(l => l.forEach(p => bounds.extend(p)));
    }
    if (sel.length) {
      L.polyline(sel, { color: '#fff', weight: 9, opacity: 0.9, renderer: ly.renderer, interactive: false }).addTo(ly.tracks);
      L.polyline(sel, { color: '#F59E0B', weight: 5, opacity: 1, renderer: ly.renderer, interactive: false }).addTo(ly.tracks);
      sel.forEach(l => (l as [number, number][]).forEach(p => bounds.extend(p)));
    }
    for (const p of photos) {
      const icon = L.divIcon({
        className: p.survey_kind === 'online' ? (p.verified_at ? 'kcs-photo kcs-online-ok' : 'kcs-photo kcs-online') : 'kcs-photo',
        html: p.thumb_url ? `<img src="${escapeMapHtml(p.thumb_url)}" alt="" />` : '<span>📷</span>',
        iconSize: [34, 34], iconAnchor: [17, 17],
      });
      const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: 500 });
      m.bindTooltip(escapeMapHtml([p.company_name || 'Ảnh chỉ tiêu', ...(p.survey_kind === 'online' ? [p.verified_at ? 'Online' : UNVERIFIED_TAG] : []), new Date(p.taken_at).toLocaleDateString('vi-VN')].join(' · ')), { direction: 'top', offset: [0, -16], className: 'lgmap-tooltip' });
      m.on('click', () => cb.current.onPhoto(p));
      m.addTo(ly.marks);
      if (!sel.length || p.trip_id === selectedId) bounds.extend([p.lat, p.lng]);
    }
    for (const n of voiceNotes) {
      if (n.lat == null || n.lng == null) continue;
      const icon = L.divIcon({ className: 'kcs-voice', html: '<span>🎙</span>', iconSize: [30, 30], iconAnchor: [15, 15] });
      const m = L.marker([n.lat, n.lng], { icon, zIndexOffset: 450 });
      m.bindTooltip(escapeMapHtml([n.company_name || 'Ghi âm', fmtClock(n.duration_s), new Date(n.recorded_at).toLocaleDateString('vi-VN')].join(' · ')), { direction: 'top', offset: [0, -14], className: 'lgmap-tooltip' });
      m.on('click', () => cb.current.onVoice(n));
      m.addTo(ly.marks);
      if (!sel.length || n.trip_id === selectedId) bounds.extend([n.lat, n.lng]);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
  }, [tracks, selectedId, photos, voiceNotes, fitKey]);

  useEffect(() => {
    if (focus && mapRef.current) mapRef.current.setView([focus.lat, focus.lng], Math.max(mapRef.current.getZoom(), 18));
  }, [focus]);

  return <div ref={divRef} className={`bg-[#E5E3DF] ${className}`} />;
}
