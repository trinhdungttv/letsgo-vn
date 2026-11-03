// Thị trường → Khảo sát KCN: nơi riêng cho mọi dữ liệu đi khảo sát — các chuyến (vết GPS), ảnh chỉ tiêu tuyển dụng
// (kèm ghi chú vẽ trên ảnh), ghi âm nhanh, tổng hợp theo KCN; nút bắt đầu khảo sát.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Camera, ChevronDown, ChevronRight, Download, Loader2, MapPin, Mic, Pencil, Play, Plus, RefreshCw, Route, Search, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Branch } from '../../lib/types';
import type { MarketTabProps } from './shared';
import {
  listPhotos, listTrips, listVoiceNotes, loadTracks, softDeleteTrip, titleColumnMissing, TITLE_MIGRATION_HINT, updateTrip,
  VOICE_MIGRATION_HINT, type SurveyPhoto, type SurveyTrip, type SurveyVoiceNote,
} from '../../lib/kcnSurvey/api';
import { STATUS_META, type SurveyStatus } from '../../lib/kcnSurvey/companies';
import { fmtDistance, fmtDuration, type TrackSegment } from '../../lib/kcnSurvey/track';
import { surveyTitle } from '../../lib/kcnSurvey/zones';
import KcnSurveyMode from './survey/KcnSurveyMode';
import SurveyTripMap from './survey/SurveyTripMap';
import SurveyPhotoViewer, { PhotoThumb } from './survey/SurveyPhotoViewer';
import SurveyVoiceSheet from './survey/SurveyVoiceSheet';
import { fmtClock, fmtDateTime } from './survey/surveyFormat';
import { pendingActiveTrip } from './survey/useSurveyRecorder';
import { fold } from './survey/surveyData';

type Sub = 'trips' | 'photos' | 'voice' | 'zones';
const PERIODS = [{ d: 7, label: '7 ngày' }, { d: 30, label: '30 ngày' }, { d: 90, label: '3 tháng' }, { d: 0, label: 'Tất cả' }];

const card = 'bg-white border border-[#E8E7E2] rounded-[10px]';

export default function SurveyTab({ marketZones, marketLeads, laborHistory, goTab, toast }: MarketTabProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [trips, setTrips] = useState<SurveyTrip[]>([]);
  const [photos, setPhotos] = useState<SurveyPhoto[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<SurveyVoiceNote[]>([]);
  const [voiceMissing, setVoiceMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>('trips');
  const [zoneId, setZoneId] = useState('all');
  const [period, setPeriod] = useState(30);
  const [person, setPerson] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Map<string, TrackSegment[]>>(new Map());
  const [viewer, setViewer] = useState<SurveyPhoto | null>(null);
  const [voiceSheet, setVoiceSheet] = useState<SurveyVoiceNote | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [surveyOpen, setSurveyOpen] = useState<false | 'survey' | 'area'>(false);
  const [pending, setPending] = useState(() => pendingActiveTrip());
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, p] = await Promise.all([listTrips({ limit: 400 }), listPhotos({ limit: 1000 })]);
      setTrips(t);
      setPhotos(p);
      try { setVoiceNotes(await listVoiceNotes({ limit: 1000 })); setVoiceMissing(false); }
      catch { setVoiceNotes([]); setVoiceMissing(true); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    supabase.from('branches').select('*').then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);

  // ── Lọc ───────────────────────────────────────────────────────────────────
  const since = period ? Date.now() - period * 86_400_000 : 0;
  const okTime = useCallback((iso: string) => !since || new Date(iso).getTime() >= since, [since]);
  const okZone = useCallback((z: string | null) => zoneId === 'all' || (zoneId === 'none' ? !z : z === zoneId), [zoneId]);
  const okPerson = useCallback((n: string) => person === 'all' || n === person, [person]);
  const q = fold(search.trim());
  const fTrips = useMemo(() => trips.filter(t => okTime(t.started_at) && okZone(t.zone_id) && okPerson(t.user_name)
    && (!q || fold([t.title, t.zone_name, t.note, t.user_name, ...t.passed.map(p => p.name)].join(' ')).includes(q))), [trips, okTime, okZone, okPerson, q]);
  const fPhotos = useMemo(() => photos.filter(p => okTime(p.taken_at) && okZone(p.zone_id) && okPerson(p.user_name)
    && (!q || fold([p.company_name, p.positions, p.wage_text, p.note, p.zone_name].join(' ')).includes(q))), [photos, okTime, okZone, okPerson, q]);
  const fVoice = useMemo(() => voiceNotes.filter(n => okTime(n.recorded_at) && okZone(n.zone_id) && okPerson(n.user_name)
    && (!q || fold([n.company_name, n.note, n.zone_name].join(' ')).includes(q))), [voiceNotes, okTime, okZone, okPerson, q]);

  const people = useMemo(() => [...new Set([...trips.map(t => t.user_name), ...photos.map(p => p.user_name), ...voiceNotes.map(n => n.user_name)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [trips, photos, voiceNotes]);
  const zoneOptions = useMemo(() => {
    const used = new Set([...trips.map(t => t.zone_id), ...photos.map(p => p.zone_id), ...voiceNotes.map(n => n.zone_id)]);
    return [...marketZones].sort((a, b) => Number(used.has(b.id)) - Number(used.has(a.id)) || a.name.localeCompare(b.name, 'vi'))
      .map(z => ({ id: z.id, name: z.name, used: used.has(z.id) }));
  }, [marketZones, trips, photos, voiceNotes]);

  // ── Vết: chuyến đang chọn, không thì 40 chuyến mới nhất trong bộ lọc ──────
  const trackIds = useMemo(() => (sub !== 'trips' ? [] : selected ? [selected] : fTrips.slice(0, 40).map(t => t.id)), [sub, selected, fTrips]);
  const trackKey = trackIds.join(',');
  useEffect(() => {
    if (!trackIds.length) { setTracks(new Map()); return; }
    let alive = true;
    loadTracks(trackIds).then(m => { if (alive) setTracks(m); }).catch(e => toast((e as Error).message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const selTrip = selected ? trips.find(t => t.id === selected) ?? null : null;
  const mapPhotos = sub === 'voice' ? [] : sub === 'trips' && selTrip ? fPhotos.filter(p => p.trip_id === selTrip.id) : fPhotos;
  const mapVoice = sub === 'photos' ? [] : sub === 'trips' && selTrip ? fVoice.filter(n => n.trip_id === selTrip.id) : fVoice;

  const byTrip = useMemo(() => {
    const ph = new Map<string, number>(), vo = new Map<string, number>();
    photos.forEach(p => { if (p.trip_id) ph.set(p.trip_id, (ph.get(p.trip_id) ?? 0) + 1); });
    voiceNotes.forEach(n => { if (n.trip_id) vo.set(n.trip_id, (vo.get(n.trip_id) ?? 0) + 1); });
    return { ph, vo };
  }, [photos, voiceNotes]);

  // ── Theo KCN (bỏ qua bộ lọc KCN, giữ thời gian + người đi) ────────────────
  const zoneRows = useMemo(() => {
    const m = new Map<string, { id: string; name: string; trips: number; km: number; last: string | null; cover: number | null; photos: number; voice: number }>();
    const row = (id: string | null, name: string) => {
      const k = id ?? 'none';
      let r = m.get(k);
      if (!r) { r = { id: k, name: id ? (marketZones.find(z => z.id === id)?.name ?? name) || 'KCN đã xoá' : 'Không gắn KCN', trips: 0, km: 0, last: null, cover: null, photos: 0, voice: 0 }; m.set(k, r); }
      return r;
    };
    trips.filter(t => okTime(t.started_at) && okPerson(t.user_name)).forEach(t => {
      const r = row(t.zone_id, t.zone_name);
      r.trips += 1; r.km += t.distance_m / 1000;
      if (!r.last || t.started_at > r.last) r.last = t.started_at;
      if (t.road_coverage != null) r.cover = Math.max(r.cover ?? 0, t.road_coverage);
    });
    const touch = (r: { last: string | null }, at: string) => { if (!r.last || at > r.last) r.last = at; };
    photos.filter(p => okTime(p.taken_at) && okPerson(p.user_name)).forEach(p => { const r = row(p.zone_id, p.zone_name); r.photos += 1; touch(r, p.taken_at); });
    voiceNotes.filter(n => okTime(n.recorded_at) && okPerson(n.user_name)).forEach(n => { const r = row(n.zone_id, n.zone_name); r.voice += 1; touch(r, n.recorded_at); });
    return [...m.values()].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || b.photos - a.photos);
  }, [trips, photos, voiceNotes, okTime, okPerson, marketZones]);

  const totalM = fTrips.reduce((s, t) => s + t.distance_m, 0);
  const zonesCount = new Set(fTrips.map(t => t.zone_id).filter(Boolean)).size;

  // ── Thao tác ──────────────────────────────────────────────────────────────
  const saveTitle = async (t: SurveyTrip) => {
    if (!renaming) return;
    const title = renaming.value.trim() || surveyTitle(t.zone_name, new Date(t.started_at));
    try {
      await updateTrip(t.id, { title });
      if (titleColumnMissing()) { toast(TITLE_MIGRATION_HINT); return; }
      setTrips(list => list.map(x => (x.id === t.id ? { ...x, title } : x)));
      setRenaming(null);
    } catch (e) { toast((e as Error).message); }
  };
  const deleteTrip = async (t: SurveyTrip) => {
    if (!window.confirm(`Xoá chuyến khảo sát ${t.title || t.zone_name || ''} ngày ${new Date(t.started_at).toLocaleDateString('vi-VN')}?\n\nChuyến sẽ ẩn khỏi danh sách và bản đồ (không còn tính là đường đã đi). Vết GPS, ảnh chỉ tiêu và ghi âm vẫn được giữ trong cơ sở dữ liệu.`)) return;
    try {
      await softDeleteTrip(t.id);
      setTrips(list => list.filter(x => x.id !== t.id));
      setSelected(null);
      toast('Đã xoá chuyến');
    } catch (e) { toast((e as Error).message); }
  };
  const exportPhotos = () => {
    const head = ['Ngày chụp', 'KCN', 'Công ty', 'Vị trí tuyển', 'Số lượng', 'Lương', 'Ghi chú', 'Người chụp', 'Vĩ độ', 'Kinh độ', 'Link ảnh', 'Google Maps'];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = fPhotos.map(p => [fmtDateTime(p.taken_at), p.zone_name, p.company_name, p.positions, p.headcount ?? '', p.wage_text, p.note, p.user_name,
      p.lat.toFixed(6), p.lng.toFixed(6), p.url, `https://www.google.com/maps?q=${p.lat},${p.lng}`]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `anh-chi-tieu-khao-sat-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const subTabs: { id: Sub; label: string; count?: number; icon: ReactNode }[] = [
    { id: 'trips', label: 'Chuyến đi', count: fTrips.length, icon: <Route size={13} /> },
    { id: 'photos', label: 'Ảnh chỉ tiêu', count: fPhotos.length, icon: <Camera size={13} /> },
    { id: 'voice', label: 'Ghi âm', count: fVoice.length, icon: <Mic size={13} /> },
    { id: 'zones', label: 'Theo KCN', icon: <MapPin size={13} /> },
  ];

  return (
    <div className="space-y-3">
      {/* ── Bắt đầu + tổng quan ── */}
      <div className={`${card} p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3`}>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-[#111]">Khảo sát KCN</div>
          <div className="text-[12px] text-[#888] leading-snug mt-0.5">
            Đi 1 vòng KCN: ghi vết GPS, tô đường chưa đi, dẫn đường tới đoạn còn thiếu, chụp bảng chỉ tiêu (vẽ ghi chú lên ảnh), ghi âm nhanh — mọi dữ liệu lưu ở đây. KCN chưa có trên hệ thống: bấm “Thêm KCN / vùng” để tra trên bản đồ và khoanh vùng.
          </div>
          {pending && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-2.5 py-1">
              Chuyến đang dở: <b>{pending.trip.title || pending.trip.zone_name || 'Không gắn KCN'}</b> · {fmtDistance(pending.distance)}
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button onClick={() => setSurveyOpen('area')}
            className="h-11 px-4 rounded-full bg-white border border-[#D8D6D0] text-[#111] text-[13.5px] font-medium inline-flex items-center justify-center gap-1.5 hover:bg-[#F9F9F7]">
            <Plus size={16} /> Thêm KCN / vùng
          </button>
          <button onClick={() => setSurveyOpen('survey')}
            className="h-11 px-5 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 shadow-[0_6px_20px_rgba(10,132,255,0.35)] active:scale-95 transition">
            <Play size={16} fill="currentColor" /> {pending ? 'Mở chuyến đang dở' : 'Bắt đầu khảo sát'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
        <Stat label="Chuyến đi" value={String(fTrips.length)} />
        <Stat label="Quãng đường" value={fmtDistance(totalM)} />
        <Stat label="KCN đã đi" value={String(zonesCount)} />
        <Stat label="Ảnh chỉ tiêu" value={String(fPhotos.length)} />
        <Stat label="Ghi âm" value={voiceMissing ? '—' : String(fVoice.length)} />
      </div>

      {/* ── Bộ lọc ── */}
      <div className={`${card} p-2.5 flex flex-wrap items-center gap-2`}>
        <select value={zoneId} onChange={e => { setZoneId(e.target.value); setSelected(null); }}
          className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] bg-white max-w-full md:w-60">
          <option value="all">Tất cả KCN</option>
          <option value="none">Không gắn KCN</option>
          {zoneOptions.map(z => <option key={z.id} value={z.id}>{z.name}{z.used ? '' : ' (chưa khảo sát)'}</option>)}
        </select>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => setPeriod(p.d)}
              className={`h-9 px-2.5 rounded-lg text-[12px] font-medium border transition ${period === p.d ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>{p.label}</button>
          ))}
        </div>
        {people.length > 1 && (
          <select value={person} onChange={e => setPerson(e.target.value)} className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] bg-white">
            <option value="all">Mọi người đi</option>
            {people.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aaa]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm công ty, vị trí tuyển, ghi chú…"
            className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] outline-none focus:border-[#1D4ED8]" />
        </div>
        <button onClick={() => void load()} disabled={loading} title="Tải lại"
          className="h-9 w-9 rounded-lg border border-[#E8E7E2] flex items-center justify-center text-[#666] hover:bg-[#F9F9F7] disabled:opacity-40">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {subTabs.map(t => (
          <button key={t.id} onClick={() => { setSub(t.id); setSelected(null); }}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${sub === t.id ? 'bg-[#111] border-[#111] text-white' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>
            {t.icon}{t.label}{t.count != null && <span className={sub === t.id ? 'text-white/70' : 'text-[#aaa]'}>{t.count}</span>}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2">{error}</div>}
      {voiceMissing && sub === 'voice' && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12.5px] px-3 py-2">{VOICE_MIGRATION_HINT}</div>}

      {sub === 'zones' ? (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[12.5px]">
            <thead className="text-[11px] text-[#888] bg-[#FAFAF8]">
              <tr>
                <th className="text-left font-medium px-3 py-2">KCN</th>
                <th className="text-right font-medium px-2 py-2">Chuyến</th>
                <th className="text-right font-medium px-2 py-2">Quãng đường</th>
                <th className="text-right font-medium px-2 py-2">Phủ đường cao nhất</th>
                <th className="text-right font-medium px-2 py-2">Ảnh</th>
                <th className="text-right font-medium px-2 py-2">Ghi âm</th>
                <th className="text-right font-medium px-3 py-2">Lần gần nhất</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9]">
              {zoneRows.map(r => (
                <tr key={r.id} onClick={() => { setZoneId(r.id); setSub('trips'); }} className="cursor-pointer hover:bg-[#F9F9F7]">
                  <td className="px-3 py-2 font-medium text-[#111]">{r.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.trips}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.km ? fmtDistance(r.km * 1000) : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.cover != null ? `${r.cover.toLocaleString('vi-VN')}%` : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.photos || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.voice || '—'}</td>
                  <td className="px-3 py-2 text-right text-[#666] whitespace-nowrap">{r.last ? new Date(r.last).toLocaleDateString('vi-VN') : '—'}</td>
                </tr>
              ))}
              {!zoneRows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-[#aaa]">Chưa có dữ liệu khảo sát trong khoảng thời gian này</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col md:grid md:grid-cols-[minmax(320px,420px)_1fr] gap-3 md:items-start">
          <SurveyTripMap
            className="order-first md:order-none md:col-start-2 md:row-start-1 h-[280px] md:h-[calc(100dvh-330px)] md:min-h-[460px] rounded-[10px] border border-[#E8E7E2] overflow-hidden md:sticky md:top-0"
            tracks={tracks} selectedId={selected} photos={mapPhotos} voiceNotes={mapVoice}
            onPhoto={setViewer} onVoice={setVoiceSheet} onTrip={id => setSelected(id)}
            fitKey={`${sub}:${zoneId}:${period}:${person}:${selected ?? ''}`} focus={focus} />

          <div className="md:col-start-1 md:row-start-1 min-w-0">
            {loading && <div className="py-10 flex justify-center text-[#aaa]"><Loader2 size={20} className="animate-spin" /></div>}

            {!loading && sub === 'trips' && (
              fTrips.length === 0 ? <Empty icon={<Route size={22} />} text="Chưa có chuyến khảo sát nào trong bộ lọc" /> : (
                <div className="space-y-2">
                  {fTrips.map(t => {
                    const open = selected === t.id;
                    const dur = t.ended_at ? (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 1000 : null;
                    const tPhotos = photos.filter(p => p.trip_id === t.id);
                    const tVoice = voiceNotes.filter(n => n.trip_id === t.id);
                    return (
                      <div key={t.id} className={`${card} overflow-hidden ${open ? 'ring-2 ring-[#F59E0B]/50' : ''}`}>
                        <button onClick={() => setSelected(open ? null : t.id)} className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-[#FAFAF8]">
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] font-semibold text-[#111] line-clamp-2">{t.title || t.zone_name || 'Không gắn KCN'}</div>
                            <div className="text-[11.5px] text-[#888] mt-0.5">
                              {t.title && t.zone_name && !t.title.includes(t.zone_name) ? `${t.zone_name} · ` : ''}{fmtDateTime(t.started_at)}{t.user_name ? ` · ${t.user_name}` : ''}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[11px]">
                              <Pill>{fmtDistance(t.distance_m)}</Pill>
                              {dur != null && <Pill>{fmtDuration(dur)}</Pill>}
                              {t.road_coverage != null && <Pill>Phủ {t.road_coverage.toLocaleString('vi-VN')}%</Pill>}
                              {t.passed.length > 0 && <Pill>{t.passed.length} công ty</Pill>}
                              {(byTrip.ph.get(t.id) ?? 0) > 0 && <Pill>📷 {byTrip.ph.get(t.id)}</Pill>}
                              {(byTrip.vo.get(t.id) ?? 0) > 0 && <Pill>🎙 {byTrip.vo.get(t.id)}</Pill>}
                              {!t.ended_at && <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-medium">Chưa kết thúc</span>}
                            </div>
                          </div>
                          {open ? <ChevronDown size={16} className="text-[#C7C7CC] mt-1" /> : <ChevronRight size={16} className="text-[#C7C7CC] mt-1" />}
                        </button>
                        {open && (
                          <div className="px-3 pb-3 pt-2.5 border-t border-[#F0EEE9] space-y-3">
                            <div className="flex gap-1.5 flex-wrap">
                              <button onClick={() => setRenaming({ id: t.id, value: t.title || surveyTitle(t.zone_name, new Date(t.started_at)) })}
                                className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] text-[12px] text-[#333] inline-flex items-center gap-1"><Pencil size={12} /> Đổi tên</button>
                              <button onClick={() => void deleteTrip(t)} className="h-8 px-2.5 rounded-lg border border-red-200 bg-red-50 text-[12px] text-red-600 inline-flex items-center gap-1"><Trash2 size={12} /> Xoá</button>
                            </div>
                            {renaming?.id === t.id && (
                              <div className="flex gap-1.5">
                                <input value={renaming.value} onChange={e => setRenaming({ id: t.id, value: e.target.value })} autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter') void saveTitle(t); }}
                                  className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[13px] outline-none focus:border-[#1D4ED8]" />
                                <button onClick={() => void saveTitle(t)} className="h-9 px-3 rounded-lg bg-[#0A84FF] text-white text-[12.5px] font-semibold shrink-0">Lưu</button>
                                <button onClick={() => setRenaming(null)} className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] shrink-0">Huỷ</button>
                              </div>
                            )}
                            {t.note && <div className="text-[12.5px] text-[#333] whitespace-pre-line">{t.note}</div>}
                            {t.passed.length > 0 && (
                              <div className="space-y-1.5">
                                {groupPassed(t.passed).map(g => (
                                  <div key={g.status}>
                                    <div className="text-[11px] font-semibold" style={{ color: STATUS_META[g.status].color }}>{STATUS_META[g.status].label} ({g.items.length})</div>
                                    <div className="text-[12px] text-[#333] leading-relaxed">{g.items.map(i => i.name).join(' · ')}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {tPhotos.length > 0 && (
                              <div>
                                <div className="text-[11px] font-semibold text-[#888] mb-1">Ảnh chỉ tiêu ({tPhotos.length})</div>
                                <div className="grid grid-cols-4 gap-1">
                                  {tPhotos.map(p => (
                                    <button key={p.id} onClick={() => setViewer(p)} className="relative aspect-square rounded-md overflow-hidden bg-[#EEE]"><PhotoThumb photo={p} /></button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {tVoice.length > 0 && (
                              <div>
                                <div className="text-[11px] font-semibold text-[#888] mb-1">Ghi âm ({tVoice.length})</div>
                                <div className="divide-y divide-[#F0EEE9] border border-[#F0EEE9] rounded-lg">
                                  {tVoice.map(n => <VoiceRow key={n.id} n={n} onOpen={() => setVoiceSheet(n)} />)}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {!loading && sub === 'photos' && (
              <div className="space-y-2">
                {fPhotos.length > 0 && (
                  <div className="flex justify-end">
                    <button onClick={exportPhotos} className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1 hover:bg-[#F9F9F7]">
                      <Download size={12} /> Tải danh sách (CSV / Excel)
                    </button>
                  </div>
                )}
                {fPhotos.length === 0 ? <Empty icon={<Camera size={22} />} text="Chưa có ảnh chỉ tiêu nào trong bộ lọc" /> : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {fPhotos.map(p => (
                      <button key={p.id} onClick={() => setViewer(p)} className="relative aspect-square rounded-lg overflow-hidden bg-[#EEE] text-left">
                        <PhotoThumb photo={p} />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-4 pb-1">
                          <div className="text-[10.5px] font-semibold text-white leading-tight line-clamp-2">{p.company_name || 'Chưa rõ công ty'}</div>
                          <div className="text-[9.5px] text-white/80">{new Date(p.taken_at).toLocaleDateString('vi-VN')}{p.headcount != null ? ` · SL ${p.headcount}` : ''}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!loading && sub === 'voice' && (
              fVoice.length === 0 ? <Empty icon={<Mic size={22} />} text={voiceMissing ? 'Chưa có bảng ghi âm (chạy migration 193)' : 'Chưa có bản ghi âm nào trong bộ lọc'} /> : (
                <div className={`${card} divide-y divide-[#F0EEE9] overflow-hidden`}>
                  {fVoice.map(n => <VoiceRow key={n.id} n={n} onOpen={() => setVoiceSheet(n)} showZone />)}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {viewer && (
        <SurveyPhotoViewer photo={viewer} onClose={() => setViewer(null)} say={toast}
          onShowOnMap={() => { const p = viewer; setViewer(null); setFocus({ lat: p.lat, lng: p.lng, key: Date.now() }); }}
          onSaved={p => { setPhotos(list => list.map(x => (x.id === p.id ? p : x))); setViewer(p); }}
          onDeleted={id => { setPhotos(list => list.filter(x => x.id !== id)); setViewer(null); }} />
      )}
      {voiceSheet && (
        <SurveyVoiceSheet note={voiceSheet} say={toast} onClose={() => setVoiceSheet(null)}
          onShowOnMap={() => { const n = voiceSheet; setVoiceSheet(null); if (n.lat != null && n.lng != null) setFocus({ lat: n.lat, lng: n.lng, key: Date.now() }); }}
          onSaved={n => { setVoiceNotes(list => list.map(x => (x.id === n.id ? n : x))); setVoiceSheet(n); }}
          onDeleted={id => { setVoiceNotes(list => list.filter(x => x.id !== id)); setVoiceSheet(null); }} />
      )}
      {surveyOpen && (
        <KcnSurveyMode marketZones={marketZones} marketLeads={marketLeads} branches={branches} laborHistory={laborHistory} goTab={goTab}
          startWith={surveyOpen === 'area' ? 'area' : undefined}
          onClose={() => { setSurveyOpen(false); setPending(pendingActiveTrip()); void load(); }} />
      )}
    </div>
  );
}

function VoiceRow({ n, onOpen, showZone }: { n: SurveyVoiceNote; onOpen: () => void; showZone?: boolean }) {
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#FAFAF8]">
      <span className="w-8 h-8 rounded-full bg-[#FF3B30] text-white flex items-center justify-center shrink-0"><Mic size={15} /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-[#111] truncate">{n.company_name || 'Ghi âm khảo sát'}</span>
        <span className="block text-[11.5px] text-[#888] truncate">
          {fmtDateTime(n.recorded_at)}{showZone && n.zone_name ? ` · ${n.zone_name}` : ''}{n.user_name ? ` · ${n.user_name}` : ''}
        </span>
        {n.note && <span className="block text-[12px] text-[#444] line-clamp-2 mt-0.5">{n.note}</span>}
      </span>
      <span className="text-[12px] text-[#666] tabular-nums shrink-0">{fmtClock(n.duration_s)}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${card} px-3 py-2`}>
      <div className="text-[11px] text-[#888]">{label}</div>
      <div className="text-[17px] font-semibold text-[#111] tabular-nums">{value}</div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded-md bg-[#F2F2F0] text-[#444]">{children}</span>;
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className={`${card} py-12 flex flex-col items-center gap-2 text-[#aaa]`}>
      {icon}
      <div className="text-[12.5px]">{text}</div>
    </div>
  );
}

function groupPassed(passed: SurveyTrip['passed']) {
  const by = new Map<SurveyStatus, SurveyTrip['passed']>();
  for (const p of passed) {
    const st = (STATUS_META[p.status] ? p.status : 'osm') as SurveyStatus;
    const list = by.get(st);
    if (list) list.push(p); else by.set(st, [p]);
  }
  return [...by.entries()].sort((a, b) => STATUS_META[a[0]].rank - STATUS_META[b[0]].rank).map(([status, items]) => ({ status, items }));
}
