// Kế hoạch ghé công ty của 1 KCN (migration 223): lên trước danh sách công ty tiêu biểu cần đi qua, lúc đi thực tế app
// tự sắp thứ tự ghé ngắn nhất (đường xe máy thật — Valhalla) và dẫn đường lần lượt.
// Thêm công ty: dán link Google Maps (dài / rút gọn, dán nhiều dòng một lúc được — cả văn bản "Chia sẻ" của app Google Maps),
// gõ "vĩ độ, kinh độ", hoặc GÕ TÊN để app tự tìm: trong hệ thống → bản đồ quanh KCN (Overture) → OpenStreetMap → Google (khi có khoá).
// Dùng ở tab Khảo sát KCN (lên kế hoạch trên máy tính) và màn khảo sát GPS (xem + "Dẫn đường qua N công ty").
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, ExternalLink, Loader2, MapPin, Navigation, Pencil, Plus, Route, Search, Trash2, X } from 'lucide-react';
import { streetTiles } from '../../../lib/mapTiles';
import { escapeMapHtml } from '../../../lib/mapGroups';
import type { LatLng } from '../../../lib/geo';
import type { MarketZone } from '../../../lib/types';
import type { SurveyCompany } from '../../../lib/kcnSurvey/companies';
import { placeNameFromLink } from '../../../lib/cskh/nearby';
import { readScanCache, scanArea, writeScanCache, type ScanPlace } from '../../../lib/kcnSurvey/marketScan';
import { scanOverture } from '../../../lib/kcnSurvey/overtureScan';
import { listSurveyAreas } from '../../../lib/kcnSurvey/api';
import { distM, fmtDistance } from '../../../lib/kcnSurvey/track';
import { googleDirectionsLinks, orderOpenPath, parseStopLines, STOP_SOURCE_LABEL, stopTitle, type PlanStop } from '../../../lib/kcnSurvey/planStops';
import {
  addPlanStops, deletePlanStop, googlePlacesEnabled, googleSearchUrl, PLAN_MIGRATION_HINT, resolveMapLink, routeMatrix, routeShape,
  searchGoogle, searchPhoton, searchScanPlaces, searchSystem, updatePlanStop, type NewStop, type StopCandidate,
} from '../../../lib/kcnSurvey/planStopsApi';
import { fold } from './surveyData';

type StartMode = 'here' | 'center' | 'free';
interface PlanResult { ids: string[]; legs: Record<string, { km: number; sec: number } | null>; engine: 'valhalla' | 'estimate'; km: number; sec: number; start: LatLng | null }
interface SearchState { q: string; items: StopCandidate[]; loading: number; notes: string[] }
interface BatchRow { name: string; best: StopCandidate | null; done: boolean }

const fmtMin = (sec: number) => { const m = Math.max(1, Math.round(sec / 60)); return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60 ? `${m % 60} phút` : ''}`.trim(); };
const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`);
const SOURCE_RANK: Record<string, number> = { system: 0, google: 1, overture: 2, osm: 3 };
const FAR_M = 15_000;

/** Gộp kết quả nhiều nguồn: cùng tên (bỏ dấu) và cách < 150 m → giữ nguồn tin cậy hơn */
function mergeCands(a: readonly StopCandidate[], b: readonly StopCandidate[]): StopCandidate[] {
  const out = [...a];
  for (const c of b) {
    const i = out.findIndex(x => x.key === c.key || (fold(x.name) === fold(c.name) && distM(x, c) < 150));
    if (i < 0) out.push(c);
    else if ((SOURCE_RANK[c.source] ?? 9) < (SOURCE_RANK[out[i].source] ?? 9)) out[i] = { ...c, score: Math.max(c.score, out[i].score) };
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 14);
}

interface Props {
  zones: readonly MarketZone[];
  initialZoneId: string | null;
  /** Công ty trong hệ thống (khách hàng / Pipeline / Thị trường) — tìm theo tên */
  companies: readonly SurveyCompany[];
  /** Toàn bộ kế hoạch (mọi KCN) — cha giữ để vẽ ghim / đếm */
  stops: readonly PlanStop[];
  setStops: (fn: (list: PlanStop[]) => PlanStop[]) => void;
  missing: boolean;
  token: string | null;
  userName: string;
  /** Vị trí GPS hiện tại (màn khảo sát) — xuất phát từ đây */
  here?: LatLng | null;
  /** Chuyến đang đi — "đã ghé" tính theo chuyến này */
  tripId?: string | null;
  /** Màn khảo sát: bấm "Dẫn đường qua N công ty" */
  onNavigate?: (ordered: PlanStop[]) => void;
  onClose: () => void;
  say: (m: string) => void;
  zIndex?: number;
}

export default function SurveyPlanDialog({ zones, initialZoneId, companies, stops, setStops, missing, token, userName, here = null, tripId = null, onNavigate, onClose, say, zIndex = 80 }: Props) {
  const countByZone = useMemo(() => {
    const m = new Map<string, number>();
    stops.forEach(s => { if (s.zone_id) m.set(s.zone_id, (m.get(s.zone_id) ?? 0) + 1); });
    return m;
  }, [stops]);
  const sortedZones = useMemo(() => [...zones].sort((a, b) => (countByZone.get(b.id) ?? 0) - (countByZone.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'vi')), [zones, countByZone]);
  const [zoneId, setZoneId] = useState<string>(() => initialZoneId ?? sortedZones.find(z => countByZone.get(z.id))?.id ?? '');
  const zone = zones.find(z => z.id === zoneId) ?? null;

  const zoneStops = useMemo(() => stops.filter(s => s.zone_id === zoneId), [stops, zoneId]);
  const visitedNow = useCallback((s: PlanStop) => !!tripId && s.visited_trip_id === tripId, [tripId]);
  const todoStops = useMemo(() => zoneStops.filter(s => !visitedNow(s)), [zoneStops, visitedNow]);
  const doneStops = useMemo(() => zoneStops.filter(visitedNow), [zoneStops, visitedNow]);
  const center = useMemo<LatLng | null>(() => {
    if (zone?.lat != null && zone.lng != null) return { lat: zone.lat, lng: zone.lng };
    if (!zoneStops.length) return null;
    return { lat: zoneStops.reduce((n, s) => n + s.lat, 0) / zoneStops.length, lng: zoneStops.reduce((n, s) => n + s.lng, 0) / zoneStops.length };
  }, [zone, zoneStops]);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [batch, setBatch] = useState<BatchRow[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [startMode, setStartMode] = useState<StartMode>(here ? 'here' : 'free');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // ── Bản đồ quanh KCN (Overture) — dùng kết quả "Tải thông tin KCN" đã quét, chưa có thì quét khi tìm theo tên ──
  const [scanPlaces, setScanPlaces] = useState<ScanPlace[]>([]);
  const [scanState, setScanState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const scanRef = useRef<{ zone: string; p: Promise<ScanPlace[]> } | null>(null);
  const ringsRef = useRef<Map<string, [number, number][][]>>(new Map());
  useEffect(() => {
    listSurveyAreas().then(list => { ringsRef.current = new Map(list.filter(a => a.zone_id).map(a => [a.zone_id!, a.rings])); }).catch(() => { /* chưa có vùng khoanh — quét quanh tâm KCN */ });
  }, []);
  useEffect(() => {
    const c = zoneId ? readScanCache(zoneId) : null;
    setScanPlaces(c?.places ?? []);
    setScanState(c ? 'done' : 'idle');
    setSearch(null); setBatch(null); setErr(null); setFocusId(null);
  }, [zoneId]);
  const ensureScan = useCallback((signal?: AbortSignal): Promise<ScanPlace[]> => {
    if (scanPlaces.length) return Promise.resolve(scanPlaces);
    if (!zoneId || !center) return Promise.resolve([]);
    if (scanRef.current?.zone === zoneId) return scanRef.current.p;
    setScanState('running');
    const p = scanOverture(scanArea(center, ringsRef.current.get(zoneId) ?? null), signal)
      .then(r => {
        const places = r.places;
        if (!readScanCache(zoneId)) writeScanCache(zoneId, { at: Date.now(), places, sources: ['overture'] });
        setScanPlaces(places);
        setScanState('done');
        return places;
      })
      .catch(() => { setScanState('error'); scanRef.current = null; return [] as ScanPlace[]; });
    scanRef.current = { zone: zoneId, p };
    return p;
  }, [scanPlaces, zoneId, center]);

  // ── Lưu ──
  const newStop = (p: Partial<NewStop> & Pick<NewStop, 'name' | 'lat' | 'lng' | 'source'>): NewStop => ({
    zone_id: zoneId || null, zone_name: zone?.name ?? '', address: '', ref_key: '', map_link: '', note: '', ...p,
  });
  const saveRows = async (rows: NewStop[]): Promise<number> => {
    const fresh = rows.filter(r => !zoneStops.some(s => distM(s, r) < 25 || (r.name && fold(s.name) === fold(r.name))));
    const dup = rows.length - fresh.length;
    if (!fresh.length) { if (dup) say(dup > 1 ? `${dup} công ty đã có trong kế hoạch` : 'Công ty này đã có trong kế hoạch'); return 0; }
    const saved = await addPlanStops(fresh, userName);
    setStops(list => [...list, ...saved]);
    say(`Đã thêm ${saved.length} công ty vào kế hoạch${dup ? ` (bỏ ${dup} trùng)` : ''}`);
    return saved.length;
  };

  const addCandidate = async (c: StopCandidate) => {
    setErr(null);
    try {
      await saveRows([newStop({ name: c.name, address: c.address, lat: c.lat, lng: c.lng, source: c.source, ref_key: c.refKey, map_link: c.mapLink })]);
      setAdded(s => new Set(s).add(c.key));
    } catch (e) { setErr((e as Error).message); }
  };

  // ── Tìm theo tên ──
  const searchCtrl = useRef<AbortController | null>(null);
  const runSearch = async (q: string) => {
    searchCtrl.current?.abort();
    const ctrl = new AbortController();
    searchCtrl.current = ctrl;
    setBatch(null);
    const first = mergeCands(searchSystem(q, companies, center), searchScanPlaces(q, scanPlaces, center));
    const tasks: { label: string; run: () => Promise<StopCandidate[]> }[] = [
      { label: 'OpenStreetMap', run: () => searchPhoton(q, center, ctrl.signal) },
    ];
    if (!scanPlaces.length && center) tasks.push({ label: 'bản đồ quanh KCN', run: async () => searchScanPlaces(q, await ensureScan(), center) });
    if (await googlePlacesEnabled()) tasks.push({ label: 'Google Maps', run: () => searchGoogle(q, center, token, ctrl.signal) });
    setSearch({ q, items: first, loading: tasks.length, notes: [] });
    await Promise.all(tasks.map(t => t.run()
      .then(res => { if (!ctrl.signal.aborted) setSearch(s => (s && s.q === q ? { ...s, items: mergeCands(s.items, res), loading: s.loading - 1 } : s)); })
      .catch(() => { if (!ctrl.signal.aborted) setSearch(s => (s && s.q === q ? { ...s, loading: s.loading - 1, notes: [...s.notes, `${t.label} không trả lời`] } : s)); })));
  };

  /** Nhiều tên 1 lúc: mỗi tên lấy kết quả khớp nhất (≥ 0,5) ở các nguồn */
  const runBatch = async (names: string[]) => {
    setSearch(null);
    const rows: BatchRow[] = names.map(name => ({ name, best: null, done: false }));
    setBatch(rows);
    const places = center ? await ensureScan() : [];
    const google = await googlePlacesEnabled();
    let i = 0;
    const worker = async () => {
      while (i < names.length) {
        const k = i++;
        const q = names[k];
        let cands = mergeCands(searchSystem(q, companies, center), searchScanPlaces(q, places, center));
        if (!cands.some(c => c.score >= 0.75)) {
          try { cands = mergeCands(cands, await searchPhoton(q, center)); } catch { /* bỏ qua nguồn lỗi */ }
          if (google) { try { cands = mergeCands(cands, await searchGoogle(q, center, token)); } catch { /* bỏ qua */ } }
        }
        const best = cands.find(c => c.score >= 0.5) ?? null;
        setBatch(list => (list ? list.map((r, j) => (j === k ? { ...r, best, done: true } : r)) : list));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  // ── Nút Thêm / Tìm ──
  const submit = async () => {
    if (missing) { setErr(PLAN_MIGRATION_HINT); return; }
    if (!zoneId) { setErr('Chọn KCN trước'); return; }
    const lines = parseStopLines(text);
    if (!lines.length) return;
    setErr(null);
    const geo = lines.filter(l => l.kind !== 'name');
    const names = lines.filter((l): l is Extract<typeof l, { kind: 'name' }> => l.kind === 'name').map(l => l.name);
    if (geo.length) {
      const rows: NewStop[] = [];
      const failed: string[] = [];
      for (let k = 0; k < geo.length; k++) {
        const l = geo[k];
        setBusy(`Đang đọc vị trí ${k + 1}/${geo.length}…`);
        if (l.kind === 'coords') { rows.push(newStop({ name: l.name, lat: l.coords.lat, lng: l.coords.lng, source: 'coords' })); continue; }
        if (l.kind !== 'link') continue;
        let coords = l.coords, url = l.url;
        if (!coords) { const r = await resolveMapLink(l.url, token); coords = r?.coords ?? null; if (r) url = r.url; }
        // Link rút gọn chia sẻ từ app Google Maps: máy chủ không mở được (Google chỉ cho trình duyệt chạy JS) →
        // có tên đi kèm (văn bản Chia sẻ: tên + địa chỉ + link) thì tìm theo tên, không thì báo cách lấy link đầy đủ
        if (!coords) { if (l.name) names.push(l.name); else failed.push(l.url); continue; }
        rows.push(newStop({ name: l.name || placeNameFromLink(url), address: l.address, lat: coords.lat, lng: coords.lng, source: 'maps_link', map_link: l.url }));
      }
      try { await saveRows(rows); } catch (e) { setErr((e as Error).message); setBusy(null); return; }
      setBusy(null);
      if (failed.length) setErr(`${failed.length} link rút gọn (maps.app.goo.gl) chưa đọc được: Google không cho máy chủ mở loại link này. Cách nhanh: gõ tên công ty (app tự tìm), hoặc mở link trên trình duyệt rồi copy link đầy đủ trên thanh địa chỉ (google.com/maps/place/…) và dán lại — app tự lấy đúng tên + vị trí.`);
    }
    if (names.length === 1) void runSearch(names[0]);
    else if (names.length > 1) void runBatch(names);
    setText(names.length === 1 ? names[0] : '');
  };

  // ── Sắp thứ tự ghé ──
  const startPt = startMode === 'here' && here ? here : startMode === 'center' ? center : null;
  const hereKey = startMode === 'here' && here ? `${here.lat.toFixed(3)},${here.lng.toFixed(3)}` : '';
  const planKey = `${startMode}|${hereKey}|${todoStops.map(s => `${s.id}:${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join(';')}`;
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [shape, setShape] = useState<[number, number][][] | null>(null);
  const [planning, setPlanning] = useState(false);
  useEffect(() => {
    setShape(null);
    if (!todoStops.length) { setPlan(null); setPlanning(false); return; }
    const ctrl = new AbortController();
    setPlanning(true);
    const timer = window.setTimeout(() => {
      const pts: LatLng[] = [...(startPt ? [startPt] : []), ...todoStops.map(s => ({ lat: s.lat, lng: s.lng }))];
      const off = startPt ? 1 : 0;
      void (async () => {
        const m = await routeMatrix(pts, ctrl.signal);
        const order = orderOpenPath(pts.length, (i, j) => m.sec[i][j], startPt ? 0 : null);
        const legs: PlanResult['legs'] = {};
        let km = 0, sec = 0;
        order.forEach((pi, k) => {
          if (pi < off) return;
          const id = todoStops[pi - off].id;
          if (k === 0) { legs[id] = null; return; }
          const leg = { km: m.km[order[k - 1]][pi], sec: m.sec[order[k - 1]][pi] };
          legs[id] = leg; km += leg.km; sec += leg.sec;
        });
        if (ctrl.signal.aborted) return;
        setPlan({ ids: order.filter(pi => pi >= off).map(pi => todoStops[pi - off].id), legs, engine: m.engine, km, sec, start: startPt });
        setPlanning(false);
        const shp = await routeShape(order.map(i => pts[i]), ctrl.signal);
        if (!ctrl.signal.aborted) setShape(shp?.lines ?? null);
      })().catch(() => { if (!ctrl.signal.aborted) setPlanning(false); });
    }, 350);
    return () => { ctrl.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const ordered = useMemo(() => {
    if (!plan) return todoStops;
    const byId = new Map(todoStops.map(s => [s.id, s]));
    const list = plan.ids.map(id => byId.get(id)).filter((s): s is PlanStop => !!s);
    return [...list, ...todoStops.filter(s => !plan.ids.includes(s.id))];
  }, [plan, todoStops]);
  const gLinks = useMemo(() => googleDirectionsLinks(startMode === 'center' ? center : null, ordered.map(s => ({ lat: s.lat, lng: s.lng }))), [ordered, startMode, center]);

  // ── Sửa / xoá ──
  const saveName = async () => {
    if (!editing) return;
    const { id, value } = editing;
    setEditing(null);
    try {
      const row = await updatePlanStop(id, { name: value.trim() }, userName);
      if (row) setStops(list => list.map(s => (s.id === id ? row : s)));
    } catch (e) { say((e as Error).message); }
  };
  const remove = async (s: PlanStop) => {
    if (!window.confirm(`Bỏ “${stopTitle(s)}” khỏi kế hoạch ghé của ${zone?.name ?? 'KCN này'}?`)) return;
    try { await deletePlanStop(s.id, userName); setStops(list => list.filter(x => x.id !== s.id)); } catch (e) { say((e as Error).message); }
  };

  const lineCount = parseStopLines(text).length;
  const numberOf = (id: string) => ordered.findIndex(s => s.id === id) + 1;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-end md:items-center justify-center md:p-4" style={{ zIndex }}
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-white w-full md:max-w-5xl rounded-t-2xl md:rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] h-[94dvh] md:h-[88vh] flex flex-col text-[#111] overflow-hidden">
        <div className="flex items-start gap-3 px-4 md:px-5 pt-4 pb-2 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-semibold tracking-tight">Kế hoạch ghé công ty</div>
            <div className="text-[12px] text-[#888] mt-0.5 leading-snug">Lên trước các công ty cần đi qua — lúc khảo sát app tự sắp thứ tự ngắn nhất và dẫn đường lần lượt</div>
          </div>
          <button onClick={onClose} disabled={!!busy} className="w-8 h-8 -mr-1 rounded-full flex items-center justify-center text-[#666] hover:bg-[#F3F3F0] disabled:opacity-40 shrink-0" aria-label="Đóng"><X size={17} /></button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Bản đồ */}
          <div className="h-[30dvh] md:h-auto md:flex-1 md:order-2 relative bg-[#E5E3DF] shrink-0 md:shrink">
            <PlanMap center={center} start={plan?.start ?? null} ordered={ordered} done={doneStops} lines={shape} focusId={focusId} onPick={id => setFocusId(id)} />
            {planning && <div className="absolute left-2 top-2 z-[500] text-[11.5px] bg-white/95 rounded-lg px-2 py-1 shadow inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Đang tính thứ tự ghé…</div>}
          </div>

          {/* Danh sách */}
          <div className="md:w-[440px] md:order-1 flex-1 md:flex-none min-h-0 overflow-y-auto px-4 md:px-5 pb-4 pt-2 space-y-3 md:border-r md:border-[#F0EFEA]">
            {missing && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12.5px] px-3 py-2">{PLAN_MIGRATION_HINT}</div>}

            <label className="block">
              <span className="block text-[11px] font-medium text-[#666] mb-1">KCN</span>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)} className="w-full h-10 px-2.5 rounded-lg border border-[#E8E7E2] text-[13px] bg-white outline-none focus:border-[#0A84FF]">
                <option value="">— Chọn KCN —</option>
                {sortedZones.map(z => <option key={z.id} value={z.id}>{z.name}{countByZone.get(z.id) ? ` (${countByZone.get(z.id)})` : ''}</option>)}
              </select>
            </label>

            <div>
              <span className="block text-[11px] font-medium text-[#666] mb-1">Thêm công ty <span className="text-[#aaa]">· gõ tên để tìm, hoặc dán link Google Maps / toạ độ — dán nhiều dòng một lúc được (Shift+Enter xuống dòng)</span></span>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={text.includes('\n') ? 4 : 2} disabled={!zoneId || missing}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !text.includes('\n')) { e.preventDefault(); void submit(); } }}
                placeholder={'VD: Pouchen\nhoặc dán: https://maps.app.goo.gl/…  ·  10.9512, 106.7034'}
                className="w-full px-3 py-2 rounded-lg border border-[#E8E7E2] text-[13px] leading-snug outline-none focus:border-[#0A84FF] resize-y disabled:bg-[#F7F7F5]" />
              <div className="flex items-center gap-2 mt-1.5">
                <button onClick={() => void submit()} disabled={!text.trim() || !!busy || !zoneId || missing}
                  className="h-9 px-3.5 rounded-full bg-[#0A84FF] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} {busy ?? (lineCount > 1 ? `Tìm / thêm ${lineCount} dòng` : 'Tìm / thêm')}
                </button>
                {scanState === 'running' && <span className="text-[11.5px] text-[#888] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Đang quét bản đồ quanh KCN…</span>}
              </div>
            </div>

            {err && <div className="text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-lg px-3 py-2 leading-snug">{err}</div>}

            {/* Kết quả tìm 1 tên */}
            {search && (
              <div className="rounded-xl border border-[#E8E7E2] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-[#FAFAF8] text-[11.5px]">
                  <span className="font-medium text-[#555] truncate">Kết quả cho “{search.q}”{search.loading > 0 && <Loader2 size={11} className="inline animate-spin ml-1.5" />}</span>
                  <button onClick={() => setSearch(null)} className="text-[#888]" aria-label="Đóng kết quả"><X size={14} /></button>
                </div>
                <div className="divide-y divide-[#F0EFEA] max-h-[38vh] overflow-y-auto">
                  {search.items.map(c => <CandRow key={c.key} c={c} added={added.has(c.key)} onAdd={() => void addCandidate(c)} />)}
                  {!search.items.length && search.loading === 0 && <div className="px-3 py-3 text-[12.5px] text-[#888]">Không tìm thấy công ty khớp tên.</div>}
                </div>
                <div className="px-3 py-2 bg-[#FAFAF8] text-[11.5px] text-[#777] leading-snug">
                  {search.notes.length > 0 && <div className="text-[#b25e00]">{search.notes.join(' · ')}</div>}
                  Không thấy đúng công ty? <a href={googleSearchUrl(search.q, center)} target="_blank" rel="noopener noreferrer" className="text-[#0A84FF] font-medium inline-flex items-center gap-0.5">Tìm trên Google Maps <ExternalLink size={11} /></a> → bấm Chia sẻ → Sao chép đường liên kết → dán vào ô trên.
                </div>
              </div>
            )}

            {/* Nhiều tên 1 lúc */}
            {batch && (
              <div className="rounded-xl border border-[#E8E7E2] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-[#FAFAF8] text-[11.5px]">
                  <span className="font-medium text-[#555]">Tìm {batch.length} tên · khớp {batch.filter(r => r.best).length}{batch.some(r => !r.done) && <Loader2 size={11} className="inline animate-spin ml-1.5" />}</span>
                  <div className="flex items-center gap-2">
                    {batch.some(r => r.best && !added.has(r.best.key)) && (
                      <button onClick={async () => {
                        const list = batch.map(r => r.best).filter((c): c is StopCandidate => !!c && !added.has(c.key));
                        try {
                          await saveRows(list.map(c => newStop({ name: c.name, address: c.address, lat: c.lat, lng: c.lng, source: c.source, ref_key: c.refKey, map_link: c.mapLink })));
                          setAdded(s => { const n = new Set(s); list.forEach(c => n.add(c.key)); return n; });
                        } catch (e) { setErr((e as Error).message); }
                      }} className="text-[#0A84FF] font-semibold">Thêm tất cả đã khớp</button>
                    )}
                    <button onClick={() => setBatch(null)} className="text-[#888]" aria-label="Đóng"><X size={14} /></button>
                  </div>
                </div>
                <div className="divide-y divide-[#F0EFEA] max-h-[42vh] overflow-y-auto">
                  {batch.map((r, k) => (
                    <div key={k} className="px-3 py-2">
                      <div className="text-[11px] text-[#999] truncate">“{r.name}”</div>
                      {!r.done ? <div className="text-[12px] text-[#888] inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Đang tìm…</div>
                        : r.best ? <CandRow c={r.best} added={added.has(r.best.key)} onAdd={() => void addCandidate(r.best!)} compact onMore={() => { setText(r.name); void runSearch(r.name); }} />
                        : <div className="text-[12px] text-[#b25e00]">Không tìm thấy — <button onClick={() => { setText(r.name); void runSearch(r.name); }} className="text-[#0A84FF] font-medium">xem kết quả khác</button> · <a href={googleSearchUrl(r.name, center)} target="_blank" rel="noopener noreferrer" className="text-[#0A84FF] font-medium">Google Maps</a></div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Kế hoạch */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[12px] font-semibold text-[#333]">{zone ? `${todoStops.length} công ty cần ghé` : 'Chọn KCN để xem kế hoạch'}{doneStops.length ? ` · đã ghé ${doneStops.length}` : ''}</span>
                {plan && plan.ids.length > 1 && (
                  <span className="text-[11.5px] text-[#666] tabular-nums">~{fmtKm(plan.km)} · {fmtMin(plan.sec)}{plan.engine === 'estimate' ? ' (ước tính)' : ' xe máy'}</span>
                )}
              </div>
              {todoStops.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2 text-[11.5px]">
                  <span className="text-[#888]">Xuất phát:</span>
                  {([['here', 'Chỗ đang đứng', !!here], ['center', 'Tâm KCN', !!center], ['free', 'Tự chọn điểm đầu', true]] as const).filter(([, , ok]) => ok).map(([id, label]) => (
                    <button key={id} onClick={() => setStartMode(id)}
                      className={`h-7 px-2.5 rounded-full border font-medium ${startMode === id ? 'bg-[#EEF0FF] border-[#B9B8F5] text-[#3634A3]' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>{label}</button>
                  ))}
                </div>
              )}
              {zone && !zoneStops.length && (
                <div className="rounded-xl bg-[#F7F7F5] px-3 py-3 text-[12.5px] text-[#777] leading-relaxed">
                  Chưa có công ty nào. Tra Google được các công ty tiêu biểu thì dán link (hoặc gõ tên) vào ô trên — dán cả danh sách nhiều dòng cũng được.
                </div>
              )}
              <div className="rounded-xl border border-[#E8E7E2] divide-y divide-[#F0EFEA] overflow-hidden empty:hidden">
                {ordered.map(s => {
                  const leg = plan?.legs[s.id];
                  return (
                    <StopRow key={s.id} s={s} no={numberOf(s.id)} leg={leg ?? null} active={focusId === s.id}
                      editing={editing?.id === s.id ? editing.value : null} onEdit={v => setEditing(v == null ? null : { id: s.id, value: v })} onSaveName={() => void saveName()}
                      onFocus={() => setFocusId(s.id)} onDelete={() => void remove(s)} />
                  );
                })}
                {doneStops.map(s => (
                  <StopRow key={s.id} s={s} no={0} leg={null} active={focusId === s.id} done
                    editing={editing?.id === s.id ? editing.value : null} onEdit={v => setEditing(v == null ? null : { id: s.id, value: v })} onSaveName={() => void saveName()}
                    onFocus={() => setFocusId(s.id)} onDelete={() => void remove(s)} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Chân: dẫn đường */}
        {ordered.length > 0 && (
          <div className="shrink-0 border-t border-[#F0EFEA] px-4 md:px-5 py-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] flex flex-wrap items-center gap-2">
            {onNavigate ? (
              <button onClick={() => onNavigate(ordered)}
                className="flex-1 md:flex-none h-11 px-5 rounded-full bg-[#137333] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 active:scale-95 transition">
                <Navigation size={16} fill="currentColor" /> Dẫn đường qua {ordered.length} công ty
              </button>
            ) : (
              <div className="flex-1 min-w-[200px] text-[11.5px] text-[#888] leading-snug">Lúc đi: bấm <b>Bắt đầu khảo sát</b> → nút <b>Kế hoạch</b> → <b>Dẫn đường</b> — app dẫn lần lượt theo thứ tự trên, tới nơi tự đánh dấu đã ghé.</div>
            )}
            {gLinks.map((u, k) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer"
                className="h-11 px-4 rounded-full border border-[#D8D6D0] text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#F9F9F7]">
                <Route size={15} /> Google Maps{gLinks.length > 1 ? ` chặng ${k + 1}` : ''}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CandRow({ c, added, onAdd, compact, onMore }: { c: StopCandidate; added: boolean; onAdd: () => void; compact?: boolean; onMore?: () => void }) {
  const far = c.distM != null && c.distM > FAR_M;
  return (
    <div className={`flex items-center gap-2.5 ${compact ? 'pt-0.5' : 'px-3 py-2'}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium leading-tight truncate">{c.name}</div>
        <div className="text-[11px] text-[#888] truncate">
          <span className={`font-medium ${c.source === 'system' ? 'text-[#137333]' : 'text-[#5E5CE6]'}`}>{STOP_SOURCE_LABEL[c.source]}</span>
          {c.hint ? ` · ${c.hint}` : ''}{c.distM != null ? <span className={far ? 'text-[#d97706] font-medium' : ''}> · cách KCN {fmtDistance(c.distM)}</span> : null}{c.address ? ` · ${c.address}` : ''}
        </div>
      </div>
      {onMore && <button onClick={onMore} className="text-[11.5px] text-[#888] shrink-0">Khác</button>}
      <a href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`} target="_blank" rel="noopener noreferrer" title="Xem chỗ này trên Google Maps"
        className="w-8 h-8 rounded-full bg-[#F3F2EE] text-[#555] flex items-center justify-center shrink-0"><MapPin size={14} /></a>
      <button onClick={onAdd} disabled={added}
        className={`h-8 px-2.5 rounded-full text-[12px] font-semibold inline-flex items-center gap-1 shrink-0 ${added ? 'bg-[#E8F7EE] text-[#137333]' : 'bg-[#0A84FF] text-white'}`}>
        {added ? <><Check size={13} /> Đã thêm</> : <><Plus size={13} /> Thêm</>}
      </button>
    </div>
  );
}

function StopRow({ s, no, leg, active, done, editing, onEdit, onSaveName, onFocus, onDelete }: {
  s: PlanStop; no: number; leg: { km: number; sec: number } | null; active: boolean; done?: boolean;
  editing: string | null; onEdit: (v: string | null) => void; onSaveName: () => void; onFocus: () => void; onDelete: () => void;
}) {
  const visitedBefore = !done && s.visited_at ? new Date(s.visited_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : null;
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 ${active ? 'bg-[#F4F3FF]' : ''} ${done ? 'opacity-70' : ''}`}>
      <button onClick={onFocus} className={`w-7 h-7 rounded-lg text-white text-[12.5px] font-bold flex items-center justify-center shrink-0 ${done ? 'bg-[#34C759]' : 'bg-[#5E5CE6]'}`} aria-label="Xem trên bản đồ">
        {done ? <Check size={14} strokeWidth={3} /> : no}
      </button>
      <div className="flex-1 min-w-0">
        {editing != null ? (
          <div className="flex gap-1.5">
            <input value={editing} onChange={e => onEdit(e.target.value)} autoFocus maxLength={200}
              onKeyDown={e => { if (e.key === 'Enter') onSaveName(); if (e.key === 'Escape') { e.stopPropagation(); onEdit(null); } }}
              className="flex-1 min-w-0 h-8 px-2 rounded-md border border-[#E8E7E2] text-[13px] outline-none focus:border-[#0A84FF]" />
            <button onClick={onSaveName} className="h-8 px-2.5 rounded-md bg-[#0A84FF] text-white text-[12px] font-semibold shrink-0">Lưu</button>
          </div>
        ) : (
          <button onClick={onFocus} className="block w-full text-left">
            <span className="block text-[13px] font-medium leading-tight truncate">{stopTitle(s)}</span>
            <span className="block text-[11px] text-[#888] truncate">
              {done ? 'Đã ghé trong chuyến này' : leg ? `+${fmtKm(leg.km)} · ${fmtMin(leg.sec)}` : no === 1 ? 'Điểm đầu' : ''}
              {visitedBefore ? ` · lần trước ghé ${visitedBefore}` : ''}
              {` · ${STOP_SOURCE_LABEL[s.source]}`}{s.address ? ` · ${s.address}` : ''}
            </span>
          </button>
        )}
      </div>
      {editing == null && (
        <>
          <button onClick={() => onEdit(s.name)} title="Đổi tên" className="w-8 h-8 rounded-full text-[#888] hover:bg-[#F3F2EE] flex items-center justify-center shrink-0"><Pencil size={13} /></button>
          <a href={s.map_link || `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`} target="_blank" rel="noopener noreferrer" title="Mở trên Google Maps"
            className="w-8 h-8 rounded-full text-[#888] hover:bg-[#F3F2EE] flex items-center justify-center shrink-0"><ExternalLink size={13} /></a>
          <button onClick={onDelete} title="Bỏ khỏi kế hoạch" className="w-8 h-8 rounded-full text-[#d70015] hover:bg-[#FFF1F0] flex items-center justify-center shrink-0"><Trash2 size={13} /></button>
        </>
      )}
    </div>
  );
}

/** Bản đồ kế hoạch: ghim tím đánh số theo thứ tự ghé, đường xe máy thật (hoặc nét đứt khi chưa có), điểm xuất phát xanh. */
function PlanMap({ center, start, ordered, done, lines, focusId, onPick }: {
  center: LatLng | null; start: LatLng | null; ordered: readonly PlanStop[]; done: readonly PlanStop[];
  lines: [number, number][][] | null; focusId: string | null; onPick: (id: string) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: true, maxZoom: 19 });
    map.attributionControl.setPrefix(false);
    map.setView(center ? [center.lat, center.lng] : [10.95, 106.75], center ? 14 : 9);
    streetTiles().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(divRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fitKey = `${ordered.map(s => s.id).join(',')}|${done.length}|${center?.lat ?? ''}`;
  useEffect(() => {
    const map = mapRef.current, ly = layerRef.current;
    if (!map || !ly) return;
    ly.clearLayers();
    markers.current = new Map();
    const bounds = L.latLngBounds([]);
    if (lines?.length) {
      for (const ln of lines) {
        L.polyline(ln, { color: '#fff', weight: 8, opacity: 0.9, interactive: false }).addTo(ly);
        L.polyline(ln, { color: '#5E5CE6', weight: 4.5, opacity: 0.95, interactive: false }).addTo(ly);
      }
    } else if (ordered.length > 1 || (start && ordered.length)) {
      const pts: [number, number][] = [...(start ? [[start.lat, start.lng] as [number, number]] : []), ...ordered.map(s => [s.lat, s.lng] as [number, number])];
      L.polyline(pts, { color: '#5E5CE6', weight: 3, opacity: 0.7, dashArray: '6 7', interactive: false }).addTo(ly);
    }
    if (start) {
      L.marker([start.lat, start.lng], { icon: L.divIcon({ className: 'kcs-voice kcs-plan kcs-plan-start', html: '<span>Đi</span>', iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false }).addTo(ly);
      bounds.extend([start.lat, start.lng]);
    }
    const add = (s: PlanStop, label: string, cls: string) => {
      const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: `kcs-voice kcs-plan ${cls}`, html: `<span>${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: cls ? 0 : 500 });
      m.bindTooltip(escapeMapHtml(stopTitle(s)), { direction: 'top', offset: [0, -14], className: 'lgmap-tooltip' });
      m.on('click', () => pickRef.current(s.id));
      m.addTo(ly);
      markers.current.set(s.id, m);
      bounds.extend([s.lat, s.lng]);
    };
    done.forEach(s => add(s, '✓', 'kcs-plan-done'));
    ordered.forEach((s, i) => add(s, String(i + 1), ''));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
    else if (center) map.setView([center.lat, center.lng], 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, lines, start?.lat, start?.lng]);

  useEffect(() => {
    if (!focusId) return;
    const m = markers.current.get(focusId);
    if (m && mapRef.current) { mapRef.current.setView(m.getLatLng(), Math.max(mapRef.current.getZoom(), 16)); m.openTooltip(); }
  }, [focusId]);

  return <div ref={divRef} className="absolute inset-0" />;
}

