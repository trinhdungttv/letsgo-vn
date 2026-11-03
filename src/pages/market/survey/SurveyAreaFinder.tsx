// Thêm nhanh KCN / vùng chưa có trên hệ thống, hoặc khoanh lại ranh giới cho KCN đang chọn:
//  1. Tra: gõ tên (Photon / OpenStreetMap), dán link Google Maps (lấy toạ độ → tìm khu công nghiệp quanh đó),
//     hoặc "quanh chỗ tôi đứng" / "quanh tâm bản đồ".
//  2. Xem trước vùng trên bản đồ → dùng; không có ranh giới → tự chấm vùng hoặc lấy khung đang nhìn.
//  3. Lưu: gắn vào KCN có sẵn hoặc tạo KCN mới (Thị trường → Khu vực) + lưu vùng (kcn_survey_areas).
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, ChevronLeft, Crosshair, Frame, Loader2, LocateFixed, MapPin, PenLine, Search, Trash2, Undo2 } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { logActivity } from '../../../lib/audit';
import { streetTiles } from '../../../lib/mapTiles';
import { escapeMapHtml } from '../../../lib/mapGroups';
import { mapLinkCoords } from '../../../modules/cskh/data/mapLink';
import { placeNameFromLink } from '../../../lib/cskh/nearby';
import type { LatLng } from '../../../lib/geo';
import type { MarketZone } from '../../../lib/types';
import {
  boundsRing, closeRing, fetchCandidateRings, fmtArea, industrialAround, photonSearch, provinceOf, ringsAreaM2, ringsBounds, ringsCenter, shortZoneName,
  type AreaCandidate, type Ring,
} from '../../../lib/kcnSurvey/areaSearch';
import { createMarketZoneQuick, saveSurveyArea, type SurveyArea } from '../../../lib/kcnSurvey/api';
import { zoneNameMatch } from '../../../lib/kcnSurvey/zones';
import { fmtDistance, distM } from '../../../lib/kcnSurvey/track';

export interface AreaSaved {
  zone: { id: string; name: string; location: string | null; lat: number | null; lng: number | null };
  /** null = lưu vùng lỗi (thường do chưa chạy migration 194) — vẫn dùng `rings` trong phiên này */
  area: SurveyArea | null;
  rings: Ring[];
  areaError: string | null;
  createdZone: boolean;
}

interface Props {
  zones: MarketZone[];
  /** Khoanh lại vùng cho KCN này; null = thêm KCN / vùng mới */
  target: MarketZone | null;
  existing: Ring[] | null;
  fix: LatLng | null;
  viewCenter: LatLng | null;
  onCancel: () => void;
  onSaved: (r: AreaSaved) => void;
}

const isLink = (s: string) => /^https?:\/\//i.test(s.trim()) || /goo\.gl|google\.[a-z.]+\/maps/i.test(s);

type Step = 'search' | 'draw' | 'confirm';

export default function SurveyAreaFinder({ zones, target, existing, fix, viewCenter, onCancel, onSaved }: Props) {
  const { user, token } = useAuth();
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState(target ? target.name : '');
  const [results, setResults] = useState<AreaCandidate[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<AreaCandidate | null>(null);
  const [drawPts, setDrawPts] = useState<[number, number][]>([]);
  const [final, setFinal] = useState<{ rings: Ring[]; source: 'osm' | 'drawn' | 'view'; osmRef: string | null } | null>(null);
  const [name, setName] = useState(target?.name ?? '');
  const [province, setProvince] = useState(target?.location ?? '');
  const [mapLink, setMapLink] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState<string>('new');
  const [saving, setSaving] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  // ── Bản đồ xem trước ──────────────────────────────────────────────────────
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<{ cands: L.LayerGroup; draw: L.LayerGroup; me: L.LayerGroup } | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: true, maxZoom: 19 });
    map.attributionControl.setPrefix(false);
    streetTiles().addTo(map);
    const start = existing?.length ? ringsCenter(existing) : target?.lat != null && target?.lng != null ? { lat: target.lat, lng: target.lng } : fix ?? viewCenter;
    map.setView(start ? [start.lat, start.lng] : [10.95, 106.85], start ? 15 : 9);
    layerRef.current = { cands: L.layerGroup().addTo(map), draw: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map) };
    map.on('click', e => { if (stepRef.current === 'draw') setDrawPts(p => [...p, [e.latlng.lat, e.latlng.lng]]); });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(divRef.current);
    if (existing?.length) map.fitBounds(L.polygon(existing).getBounds(), { padding: [24, 24] });
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  useEffect(() => {
    const ly = layerRef.current;
    if (!ly) return;
    ly.me.clearLayers();
    if (fix) L.circleMarker([fix.lat, fix.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1, interactive: false }).addTo(ly.me);
  }, [fix]);

  // Vùng: ứng viên (viền mảnh), vùng đang chọn (tô), vùng đang có (nét đứt)
  useEffect(() => {
    const ly = layerRef.current;
    if (!ly) return;
    ly.cands.clearLayers();
    if (existing?.length && step !== 'confirm') {
      L.polygon(existing, { color: '#64748B', weight: 2, dashArray: '4 6', fillOpacity: 0.04, interactive: false }).addTo(ly.cands);
    }
    const show = step === 'confirm' && final ? [] : results;
    for (const c of show) {
      if (!c.rings?.length) continue;
      const sel = selected?.key === c.key;
      const poly = L.polygon(c.rings, { color: sel ? '#D97706' : '#0A84FF', weight: sel ? 3 : 1.5, fillColor: sel ? '#F59E0B' : '#0A84FF', fillOpacity: sel ? 0.18 : 0.05 });
      poly.bindTooltip(escapeMapHtml(c.name), { sticky: true, className: 'lgmap-tooltip' });
      poly.on('click', () => { if (stepRef.current === 'search') void pick(c); });
      poly.addTo(ly.cands);
    }
    if (final) L.polygon(final.rings, { color: '#D97706', weight: 3, fillColor: '#F59E0B', fillOpacity: 0.2, interactive: false }).addTo(ly.cands);
    if (!final && selected && !selected.rings?.length && selected.extent) {
      L.polygon(boundsRing(selected.extent), { color: '#D97706', weight: 2, dashArray: '6 6', fillOpacity: 0.06, interactive: false }).addTo(ly.cands);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, selected, final, step, existing]);

  useEffect(() => {
    const ly = layerRef.current;
    if (!ly) return;
    ly.draw.clearLayers();
    if (step !== 'draw' || !drawPts.length) return;
    if (drawPts.length >= 3) L.polygon(drawPts, { color: '#D97706', weight: 3, fillColor: '#F59E0B', fillOpacity: 0.18, interactive: false }).addTo(ly.draw);
    else L.polyline(drawPts, { color: '#D97706', weight: 3, interactive: false }).addTo(ly.draw);
    drawPts.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: '#fff', weight: 2, fillColor: '#D97706', fillOpacity: 1, interactive: false }).addTo(ly.draw));
  }, [drawPts, step]);

  const fitRings = (rings: Ring[]) => { if (mapRef.current && rings.length) mapRef.current.fitBounds(L.polygon(rings).getBounds(), { padding: [28, 28] }); };

  // ── Tra cứu ───────────────────────────────────────────────────────────────
  const begin = (label: string) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setLoading(label);
    setError(null);
    setNote(null);
    return ctrl.signal;
  };
  const finishLoad = () => setLoading(null);

  const around = async (p: LatLng, label: string) => {
    const signal = begin(label);
    try {
      mapRef.current?.setView([p.lat, p.lng], 15);
      const list = await industrialAround(p, 2500, signal);
      setResults(list);
      setSelected(null);
      if (list.length) {
        const all = list.flatMap(c => c.rings ?? []);
        if (all.length) fitRings(all);
      } else {
        setNote('OpenStreetMap chưa có khu công nghiệp nào được vẽ quanh đây — bấm "Tự khoanh vùng" để chấm trên bản đồ.');
      }
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
    } finally { if (!signal.aborted) finishLoad(); }
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    if (isLink(q)) {
      const signal = begin('Đang đọc link Google Maps…');
      try {
        const p = await mapLinkCoords(q, token);
        if (signal.aborted) return;
        if (!p) { setError('Không đọc được toạ độ trong link. Trên Google Maps: bấm vào KCN → Chia sẻ → Sao chép đường liên kết, rồi dán lại.'); finishLoad(); return; }
        setMapLink(q);
        const place = placeNameFromLink(q);
        if (place && !name) setName(shortZoneName(place));
        const [near, named] = await Promise.all([
          industrialAround(p, 2500, signal),
          place ? photonSearch(place, p, signal).catch(() => [] as AreaCandidate[]) : Promise.resolve([] as AreaCandidate[]),
        ]);
        if (signal.aborted) return;
        const merged = [...near, ...named.filter(n => !near.some(x => x.key === n.key) && distM(p, n.center) < 8000)];
        setResults(merged);
        setSelected(null);
        mapRef.current?.setView([p.lat, p.lng], 15);
        const all = merged.flatMap(c => c.rings ?? []);
        if (all.length) fitRings(all);
        if (!merged.length) setNote('Quanh toạ độ trong link chưa có khu công nghiệp nào trên OpenStreetMap — bấm "Tự khoanh vùng".');
        L.marker([p.lat, p.lng]).bindTooltip('Vị trí trong link Google Maps', { permanent: false }).addTo(layerRef.current!.me);
      } catch (e) {
        if (!signal.aborted) setError((e as Error).message);
      } finally { if (!signal.aborted) finishLoad(); }
      return;
    }
    const signal = begin('Đang tìm…');
    try {
      const list = await photonSearch(q, fix ?? viewCenter, signal);
      if (signal.aborted) return;
      setResults(list);
      setSelected(null);
      if (!list.length) setNote('Không tìm thấy tên này trên bản đồ — thử gõ khác (VD "Khu công nghiệp Long Đức"), dán link Google Maps, hoặc tự khoanh vùng.');
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message.includes('fetch') ? 'Không kết nối được máy tìm kiếm bản đồ — kiểm tra mạng rồi thử lại' : (e as Error).message);
    } finally { if (!signal.aborted) finishLoad(); }
  };

  /** Chọn 1 kết quả: có ranh giới → tải hình; chỉ là điểm / không có hình → tìm KCN quanh điểm đó. */
  const pick = async (c: AreaCandidate) => {
    setSelected(c);
    // Thêm mới: điền sẵn tên + tỉnh theo kết quả (khoanh lại KCN có sẵn thì giữ tên KCN)
    if (!target) { setName(shortZoneName(c.name)); if (c.province) setProvince(provinceOf(c.province)); }
    if (c.rings?.length) { fitRings(c.rings); return; }
    // Chỉ bản đồ tới ngay (khung của kết quả) trong lúc chờ tải hình chi tiết
    if (c.extent && mapRef.current) mapRef.current.fitBounds([[c.extent.minLat, c.extent.minLng], [c.extent.maxLat, c.extent.maxLng]], { padding: [28, 28] });
    else mapRef.current?.setView([c.center.lat, c.center.lng], 15);
    if (!c.osm) { await around(c.center, `Đang tìm khu công nghiệp quanh ${c.name}…`); return; }
    const signal = begin('Đang tải hình khoanh vùng (máy chủ bản đồ công cộng, có lúc mất 10–30 giây)…');
    try {
      const rings = await fetchCandidateRings(c, signal);
      if (signal.aborted) return;
      if (!rings.length) {
        finishLoad();
        await around(c.center, `“${c.name}” chưa có hình trên bản đồ — đang tìm vùng quanh đó…`);
        return;
      }
      const full = { ...c, rings, areaM2: ringsAreaM2(rings), extent: ringsBounds(rings) };
      setResults(list => list.map(x => (x.key === c.key ? full : x)));
      setSelected(full);
      fitRings(rings);
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
    } finally { if (!signal.aborted) finishLoad(); }
  };

  const useSelected = () => {
    if (!selected?.rings?.length) return;
    setFinal({ rings: selected.rings, source: 'osm', osmRef: selected.osm ? `${selected.osm.type[0]}${selected.osm.id}` : null });
    setStep('confirm');
  };
  const useView = () => {
    const b = mapRef.current?.getBounds();
    if (!b) return;
    const rings = [boundsRing({ minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast() })];
    setFinal({ rings, source: 'view', osmRef: null });
    setStep('confirm');
  };
  const finishDraw = () => {
    const r = closeRing(drawPts);
    if (!r) return;
    setFinal({ rings: [r], source: 'drawn', osmRef: null });
    setStep('confirm');
    fitRings([r]);
  };

  // ── Lưu ───────────────────────────────────────────────────────────────────
  const matches = useMemo(() => (target || !name.trim() ? [] : zones.filter(z => zoneNameMatch(z.name, name)).slice(0, 4)), [zones, name, target]);
  useEffect(() => { setLinkTo(matches[0]?.id ?? 'new'); }, [matches]);

  const save = async () => {
    if (!final) return;
    const nm = name.trim();
    if (!target && linkTo === 'new' && !nm) { setError('Nhập tên KCN / vùng'); return; }
    setSaving(true);
    setError(null);
    const center = ringsCenter(final.rings);
    try {
      let zone: AreaSaved['zone'];
      let created = false;
      const existingZone = target ?? (linkTo !== 'new' ? zones.find(z => z.id === linkTo) ?? null : null);
      if (existingZone) {
        zone = { id: existingZone.id, name: existingZone.name, location: existingZone.location, lat: existingZone.lat ?? null, lng: existingZone.lng ?? null };
      } else {
        zone = await createMarketZoneQuick({
          name: nm, location: province.trim() || null, lat: center.lat, lng: center.lng,
          map_link: mapLink ?? `https://www.google.com/maps?q=${center.lat.toFixed(6)},${center.lng.toFixed(6)}`,
        });
        created = true;
        await logActivity({ user, action: 'insert', table: 'market_zones', recordId: zone.id, description: `Thêm nhanh khu vực "${nm}" từ Khảo sát KCN (khoanh vùng trên bản đồ)`, newData: zone });
        window.dispatchEvent(new Event('lgvn:market-changed'));
      }
      let area: SurveyArea | null = null;
      let areaError: string | null = null;
      try {
        area = await saveSurveyArea({
          zone_id: zone.id, name: zone.name, rings: final.rings, source: final.source, osm_ref: final.osmRef,
          center_lat: center.lat, center_lng: center.lng, area_m2: Math.round(ringsAreaM2(final.rings) * 10) / 10,
          user_id: user?.id ?? null, user_name: user?.full_name ?? '',
        });
      } catch (e) { areaError = (e as Error).message; }
      onSaved({ zone, area, rings: final.rings, areaError, createdZone: created });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full h-11 px-3 rounded-xl bg-white text-[15px] text-[#1D1D1F] outline-none border border-black/5 focus:ring-2 focus:ring-[#0A84FF]/40 placeholder:text-[#8E8E93]';
  const title = target ? `Khoanh vùng ${target.name}` : 'Thêm KCN / vùng khảo sát';

  return (
    <div className="fixed inset-0 z-[1300] bg-[#F2F2F7] flex flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-2 h-12 px-2 shrink-0 bg-white border-b border-black/5">
        <button onClick={step === 'search' ? onCancel : () => { setStep('search'); setFinal(null); }} className="h-10 px-2 text-[16px] text-[#0A84FF] inline-flex items-center">
          <ChevronLeft size={19} /> {step === 'search' ? 'Huỷ' : 'Quay lại'}
        </button>
        <div className="flex-1 min-w-0 text-center text-[15.5px] font-semibold text-[#1D1D1F] truncate">{title}</div>
        <div className="w-[72px]" />
      </div>

      <div className="relative shrink-0 h-[42vh] md:h-[50vh]">
        <div ref={divRef} className="absolute inset-0 bg-[#E5E3DF]" />
        {step === 'draw' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] rounded-full bg-black/70 text-white text-[12.5px] px-3 py-1.5 whitespace-nowrap pointer-events-none">
            Chạm lần lượt các góc của vùng ({drawPts.length} điểm)
          </div>
        )}
        <div className="absolute right-2 bottom-2 z-[1000] flex flex-col gap-1.5">
          {fix && (
            <button onClick={() => mapRef.current?.setView([fix.lat, fix.lng], 16)} aria-label="Về chỗ tôi đứng"
              className="w-10 h-10 rounded-xl bg-white shadow flex items-center justify-center text-[#1D1D1F]"><LocateFixed size={18} /></button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] space-y-3">
        {error && <div className="rounded-xl bg-[#FFECEC] text-[#B00020] text-[13px] px-3 py-2">{error}</div>}

        {step === 'search' && (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
                <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void search(); }}
                  placeholder="Tên KCN (VD: KCN Long Đức) hoặc dán link Google Maps" className={`${input} pl-9`} />
              </div>
              <button onClick={() => void search()} disabled={!query.trim() || !!loading}
                className="h-11 px-4 rounded-xl bg-[#0A84FF] text-white text-[14px] font-semibold shrink-0 disabled:opacity-40">Tìm</button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {fix && <Chip onClick={() => void around(fix, 'Đang tìm khu công nghiệp quanh chỗ bạn đứng…')} icon={<LocateFixed size={13} />}>Quanh chỗ tôi đứng</Chip>}
              <Chip onClick={() => { const c = mapRef.current?.getCenter(); if (c) void around({ lat: c.lat, lng: c.lng }, 'Đang tìm quanh tâm bản đồ…'); }} icon={<Crosshair size={13} />}>Quanh tâm bản đồ</Chip>
              <Chip onClick={() => { setStep('draw'); setDrawPts([]); setSelected(null); }} icon={<PenLine size={13} />}>Tự khoanh vùng</Chip>
              <Chip onClick={useView} icon={<Frame size={13} />}>Lấy khung đang nhìn</Chip>
            </div>
            <div className="text-[11.5px] text-[#8E8E93] leading-snug">
              Google Maps không cho tải ranh giới / mạng đường về, nên app tra trên OpenStreetMap: theo tên, hoặc theo toạ độ trong link Google Maps (tìm khu công nghiệp quanh điểm đó).
            </div>
            {loading && <div className="flex items-center gap-2 text-[13px] text-[#3A3A3C]"><Loader2 size={15} className="animate-spin" /> {loading}</div>}
            {note && !loading && <div className="rounded-xl bg-[#FFF8E6] text-[#7A4B00] text-[12.5px] px-3 py-2">{note}</div>}
            {results.length > 0 && (
              <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
                {results.map(c => {
                  const sel = selected?.key === c.key;
                  const d = fix ? distM(fix, c.center) : null;
                  return (
                    <button key={c.key} onClick={() => void pick(c)} className={`w-full px-3 py-2.5 text-left flex items-start gap-2 ${sel ? 'bg-[#FFF8E6]' : ''}`}>
                      <MapPin size={15} className={`shrink-0 mt-0.5 ${c.kind === 'industrial' ? 'text-[#D97706]' : 'text-[#8E8E93]'}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14.5px] text-[#1D1D1F] truncate">{c.name}</span>
                        <span className="block text-[11.5px] text-[#8E8E93] truncate">
                          {c.kind === 'industrial' ? 'Khu công nghiệp' : c.kind === 'point' ? 'Địa điểm (chưa có ranh giới)' : 'Vùng trên bản đồ'}
                          {c.areaM2 ? ` · ${fmtArea(c.areaM2)}` : ''}{c.place ? ` · ${c.place}` : ''}
                        </span>
                      </span>
                      {d != null && <span className="text-[11.5px] text-[#8E8E93] shrink-0">{fmtDistance(d)}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {selected && !selected.rings?.length && selected.extent && !loading && (
              <button onClick={() => { setFinal({ rings: [boundsRing(selected.extent!)], source: 'view', osmRef: selected.osm ? `${selected.osm.type[0]}${selected.osm.id}` : null }); setStep('confirm'); }}
                className="w-full h-11 rounded-2xl bg-white text-[14px] font-medium text-[#1D1D1F] inline-flex items-center justify-center gap-2">
                <Frame size={16} /> Dùng tạm khung chữ nhật của “{selected.name}”
              </button>
            )}
            {loading && (
              <button onClick={() => { ctrlRef.current?.abort(); setLoading(null); }} className="text-[12.5px] text-[#0A84FF] font-medium">Huỷ chờ</button>
            )}
            {selected?.rings?.length ? (
              <button onClick={useSelected} className="w-full h-12 rounded-2xl bg-[#0A84FF] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2">
                <Check size={18} /> Dùng vùng “{selected.name}”{selected.areaM2 ? ` · ${fmtArea(selected.areaM2)}` : ''}
              </button>
            ) : null}
          </>
        )}

        {step === 'draw' && (
          <>
            <div className="text-[13px] text-[#3A3A3C] leading-snug">Chạm lên bản đồ ở từng góc của KCN / vùng muốn khảo sát (theo đường bao ngoài). Phóng to bằng 2 ngón để chấm cho chính xác.</div>
            <div className="flex gap-2">
              <button onClick={() => setDrawPts(p => p.slice(0, -1))} disabled={!drawPts.length} className="flex-1 h-11 rounded-xl bg-white text-[14px] text-[#1D1D1F] inline-flex items-center justify-center gap-1.5 disabled:opacity-40"><Undo2 size={16} /> Lùi 1 điểm</button>
              <button onClick={() => setDrawPts([])} disabled={!drawPts.length} className="flex-1 h-11 rounded-xl bg-white text-[14px] text-[#D70015] inline-flex items-center justify-center gap-1.5 disabled:opacity-40"><Trash2 size={16} /> Xoá</button>
            </div>
            <button onClick={finishDraw} disabled={drawPts.length < 3} className="w-full h-12 rounded-2xl bg-[#0A84FF] text-white text-[15px] font-semibold disabled:opacity-40">
              {drawPts.length < 3 ? `Cần ít nhất 3 điểm (đang có ${drawPts.length})` : `Xong · ${fmtArea(ringsAreaM2([closeRing(drawPts)!]))}`}
            </button>
          </>
        )}

        {step === 'confirm' && final && (
          <>
            <div className="rounded-xl bg-white px-3 py-2.5 text-[13px] text-[#3A3A3C]">
              Vùng {final.source === 'osm' ? 'lấy từ ranh giới OpenStreetMap' : final.source === 'drawn' ? 'tự khoanh' : 'theo khung bản đồ'} · {fmtArea(ringsAreaM2(final.rings))}
            </div>
            {target ? (
              <div className="text-[13px] text-[#3A3A3C]">Lưu làm vùng khảo sát của <b>{target.name}</b>. Lần sau khảo sát KCN này, app chỉ tô các đường trong vùng.</div>
            ) : (
              <>
                <div>
                  <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">Tên KCN / vùng</div>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="VD: KCN Long Đức" className={input} />
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">Tỉnh / thành</div>
                  <input value={province} onChange={e => setProvince(e.target.value)} placeholder="VD: Đồng Nai" className={input} />
                </div>
                <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
                  {matches.map(z => (
                    <Radio key={z.id} on={linkTo === z.id} onClick={() => setLinkTo(z.id)} title={`Gắn vào KCN có sẵn: ${z.name}`} hint={z.location ?? 'Đã có trong Thị trường → Khu vực'} />
                  ))}
                  <Radio on={linkTo === 'new'} onClick={() => setLinkTo('new')} title={`Tạo KCN mới${name.trim() ? `: ${name.trim()}` : ''}`} hint="Thêm vào Thị trường → Khu vực (bổ sung thông tin sau ở tab Khu vực)" />
                </div>
              </>
            )}
            <button onClick={() => void save()} disabled={saving} className="w-full h-12 rounded-2xl bg-[#0A84FF] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Lưu & khảo sát vùng này
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Chip({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="h-9 px-3 rounded-full bg-white text-[12.5px] font-medium text-[#1D1D1F] inline-flex items-center gap-1.5 shadow-sm">
      {icon}{children}
    </button>
  );
}

function Radio({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button onClick={onClick} className="w-full px-3 py-2.5 text-left flex items-start gap-2.5">
      <span className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${on ? 'border-[#0A84FF]' : 'border-[#C7C7CC]'}`}>
        {on && <span className="w-2.5 h-2.5 rounded-full bg-[#0A84FF]" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-[#1D1D1F]">{title}</span>
        <span className="block text-[11.5px] text-[#8E8E93]">{hint}</span>
      </span>
    </button>
  );
}
