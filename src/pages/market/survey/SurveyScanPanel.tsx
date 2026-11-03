// Tải thông tin KCN trước khi khảo sát: quét công ty trong KCN + nhà cung ứng lao động quanh KCN (bộ từ khoá tự lên,
// sửa được), đối chiếu với khách hàng / Pipeline / Thị trường / Đối thủ, rồi thêm những nơi MỚI vào Thị trường (công ty)
// hoặc Đối thủ (nhà cung ứng). Kết quả nhớ trong máy 30 ngày và hiện trên bản đồ khảo sát (đi ngang là báo tên).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ExternalLink, Loader2, MapPin, Plus, RefreshCw, Search, Users, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { logActivity } from '../../../lib/audit';
import { pruneMissing } from '../../../lib/serviceMode';
import { invalidateCompanyIndex } from '../../../hooks/useCompanyDuplicates';
import type { LatLng } from '../../../lib/geo';
import type { MarketZone } from '../../../lib/types';
import { STATUS_META, type SurveyCompany } from '../../../lib/kcnSurvey/companies';
import { distM, fmtDistance } from '../../../lib/kcnSurvey/track';
import {
  fromGoogle, googleEnabled, googleSearch, matchScan, mergeScan, photonSuppliers, readScanCache, scanArea, scanKeywords, scanOsm,
  writeScanCache, type CompetitorLite, type ScanMatch, type ScanPlace, type ScanSource,
} from '../../../lib/kcnSurvey/marketScan';

interface Props {
  zone: MarketZone;
  rings: [number, number][][] | null;
  center: LatLng;
  companies: SurveyCompany[];
  onClose: () => void;
  /** Có kết quả mới → hiện công ty lên bản đồ khảo sát */
  onResults: (places: ScanPlace[]) => void;
  onFocus: (p: ScanPlace) => void;
  say: (m: string) => void;
}

type Tab = 'company' | 'supplier';
interface Kw { text: string; on: boolean }

export default function SurveyScanPanel({ zone, rings, center, companies, onClose, onResults, onFocus, say }: Props) {
  const { user, token } = useAuth();
  const cached = useMemo(() => readScanCache(zone.id), [zone.id]);
  const auto = useMemo(() => scanKeywords(zone.name), [zone.name]);
  const [kwCompany, setKwCompany] = useState<Kw[]>(() => auto.company.map(text => ({ text, on: true })));
  const [kwSupplier, setKwSupplier] = useState<Kw[]>(() => auto.supplier.map(text => ({ text, on: true })));
  const [newKw, setNewKw] = useState('');
  const [google, setGoogle] = useState<boolean | null>(null);
  const [useGoogle, setUseGoogle] = useState(true);
  const [places, setPlaces] = useState<ScanPlace[]>(cached?.places ?? []);
  const [lastAt, setLastAt] = useState<number | null>(cached?.at ?? null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('company');
  const [onlyNew, setOnlyNew] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [competitors, setCompetitors] = useState<CompetitorLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [showKw, setShowKw] = useState(!cached);
  const ctrlRef = useRef<AbortController | null>(null);

  const loadCompetitors = async () => {
    const { data } = await supabase.from('competitors').select('id, company_name, active_zones, zone_name');
    setCompetitors(((data ?? []) as CompetitorLite[]).map(c => ({ ...c, active_zones: Array.isArray(c.active_zones) ? c.active_zones : [] })));
  };
  useEffect(() => {
    void googleEnabled().then(setGoogle);
    void loadCompetitors();
    return () => ctrlRef.current?.abort();
  }, []);

  const area = useMemo(() => scanArea(center, rings), [center, rings]);

  const run = async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const signal = ctrl.signal;
    setRunning(true);
    setErrors([]);
    setShowKw(false);
    const sKw = kwSupplier.filter(k => k.on).map(k => k.text);
    const cKw = kwCompany.filter(k => k.on).map(k => k.text);
    const withGoogle = !!google && useGoogle;
    const tasks: { label: string; google?: boolean; fn: () => Promise<ScanPlace[]> }[] = [
      { label: 'OpenStreetMap — nhà máy, văn phòng trong KCN', fn: () => scanOsm(area, signal) },
      ...sKw.slice(0, 8).map(kw => ({ label: `Bản đồ mở: “${kw}”`, fn: () => photonSuppliers(kw, area, signal) })),
    ];
    if (withGoogle) {
      tasks.push(
        ...cKw.map(kw => ({ label: `Google Maps: “${kw}”`, google: true, fn: async () => fromGoogle(await googleSearch(kw, { rect: area.company }, token, 3, signal), 'company', kw, area) })),
        ...sKw.map(kw => ({
          label: `Google Maps: “${kw}”`, google: true,
          fn: async () => fromGoogle(await googleSearch(kw, { circle: { center, radius: area.supplierRadiusM } }, token, 2, signal), 'supplier', kw, area)
            .filter(p => distM(center, p) <= area.supplierRadiusM * 1.5),
        })),
      );
    }
    const lists: ScanPlace[][] = [];
    const errs: string[] = [];
    let googleDown = false;
    for (let i = 0; i < tasks.length; i++) {
      if (signal.aborted) break;
      const t = tasks[i];
      if (t.google && googleDown) continue;
      setProgress({ done: i, total: tasks.length, label: t.label });
      try {
        lists.push(await t.fn());
        setPlaces(mergeScan(lists));
      } catch (e) {
        if (signal.aborted) break;
        const msg = (e as Error).message;
        errs.push(`${t.label}: ${msg}`);
        // Khoá sai / hết hạn mức → bỏ các từ khoá Google còn lại
        if (t.google && /khoá|hạn mức|thanh toán|Places API|Phiên đăng nhập/i.test(msg)) googleDown = true;
      }
      if (!t.google) await new Promise(r => setTimeout(r, 350));
    }
    const merged = mergeScan(lists);
    if (!signal.aborted) {
      setPlaces(merged);
      setErrors(errs);
      const sources: ScanSource[] = withGoogle && !googleDown ? ['osm', 'google'] : ['osm'];
      const at = Date.now();
      writeScanCache(zone.id, { at, places: merged, sources });
      setLastAt(at);
      onResults(merged);
      const nc = merged.filter(p => p.kind === 'company').length, ns = merged.filter(p => p.kind === 'supplier').length;
      say(`Đã quét: ${nc} công ty, ${ns} nhà cung ứng`);
    }
    setProgress(null);
    setRunning(false);
  };

  // ── Đối chiếu ─────────────────────────────────────────────────────────────
  const rows = useMemo(() => places.map(p => ({ p, m: matchScan(p, companies, competitors, zone.name), d: distM(center, p) })), [places, companies, competitors, zone.name, center]);
  const actionable = (r: { p: ScanPlace; m: ScanMatch }) => r.m.type === 'new' || (r.m.type === 'competitor' && !r.m.activeHere);
  const tabRows = rows.filter(r => r.p.kind === tab).sort((a, b) => Number(actionable(b)) - Number(actionable(a)) || a.d - b.d);
  const shown = onlyNew ? tabRows.filter(actionable) : tabRows;
  const counts = {
    company: rows.filter(r => r.p.kind === 'company'), supplier: rows.filter(r => r.p.kind === 'supplier'),
  };
  const selRows = shown.filter(r => selected.has(r.p.key) && actionable(r));
  const toggle = (k: string) => setSelected(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const selectAll = () => setSelected(s => { const n = new Set(s); shown.filter(actionable).forEach(r => n.add(r.p.key)); return n; });

  // ── Thêm vào hệ thống ─────────────────────────────────────────────────────
  const addCompanies = async () => {
    const list = selRows.filter(r => r.m.type === 'new').map(r => r.p);
    if (!list.length) return;
    if (!window.confirm(`Thêm ${list.length} công ty vào Thị trường → Công ty/Dự án (KCN ${zone.name}), ghim theo vị trí trên bản đồ?`)) return;
    setSaving(true);
    let ok = 0;
    try {
      for (const p of list) {
        const row = await pruneMissing('market_leads', {
          company_name: p.name, region: zone.name, industry: null, workers_needed: 0,
          source: p.sources.includes('google') ? 'Quét Google Maps' : 'Quét bản đồ (OSM)', status: 'Chưa LH',
          suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }],
          map_link: p.mapsUrl || `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`, lat: p.lat, lng: p.lng, geocoded_at: new Date().toISOString(),
          website_url: p.website || null,
        }, ['geocoded_at', 'website_url']);
        const { data, error } = await supabase.from('market_leads').insert(row).select('id').single();
        if (error) throw error;
        ok += 1;
        await logActivity({ user, action: 'insert', table: 'market_leads', recordId: data.id, description: `Thêm công ty "${p.name}" từ quét thông tin KCN ${zone.name}`, newData: row });
      }
      say(`Đã thêm ${ok} công ty vào Thị trường`);
    } catch (e) {
      say(`Đã thêm ${ok}/${list.length} — lỗi: ${(e as Error).message}`);
    } finally {
      invalidateCompanyIndex();
      window.dispatchEvent(new Event('lgvn:market-changed'));
      setSelected(new Set());
      setSaving(false);
    }
  };

  const addSuppliers = async () => {
    const fresh = selRows.filter(r => r.m.type === 'new').map(r => r.p);
    const mark = selRows.filter(r => r.m.type === 'competitor' && !r.m.activeHere).map(r => (r.m as Extract<ScanMatch, { type: 'competitor' }>).competitor);
    if (!fresh.length && !mark.length) return;
    const parts = [fresh.length && `thêm ${fresh.length} đối thủ mới`, mark.length && `ghi nhận ${mark.length} đối thủ đã có đang hoạt động tại ${zone.name}`].filter(Boolean).join(' và ');
    if (!window.confirm(`Sẽ ${parts} (Thị trường → Đối thủ). Tiếp tục?`)) return;
    setSaving(true);
    let ok = 0;
    try {
      for (const p of fresh) {
        const row = await pruneMissing('competitors', {
          company_name: p.name, zone_name: zone.name, trend: 'stable', active_zones: [zone.name],
          map_link: p.mapsUrl || `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`,
          website_url: p.website || null,
          notes: [`Tìm thấy khi quét thông tin KCN ${zone.name} (${new Date().toLocaleDateString('vi-VN')})`, p.address && `Địa chỉ: ${p.address}`, p.phone && `ĐT: ${p.phone}`].filter(Boolean).join('\n'),
        }, ['active_zones', 'map_link', 'website_url']);
        const { data, error } = await supabase.from('competitors').insert(row).select('id').single();
        if (error) throw error;
        ok += 1;
        await logActivity({ user, action: 'insert', table: 'competitors', recordId: data.id, description: `Thêm đối thủ "${p.name}" từ quét thông tin KCN ${zone.name}`, newData: row });
      }
      for (const c of mark) {
        const next = [...new Set([...(c.active_zones ?? []), zone.name])];
        const { error } = await supabase.from('competitors').update({ active_zones: next }).eq('id', c.id);
        if (error) throw error;
        ok += 1;
        await logActivity({ user, action: 'update', table: 'competitors', recordId: c.id, description: `Ghi nhận đối thủ "${c.company_name}" hoạt động tại ${zone.name} (quét thông tin KCN)`, oldData: { active_zones: c.active_zones }, newData: { active_zones: next } });
      }
      say(`Đã cập nhật ${ok} đối thủ`);
    } catch (e) {
      say(`Đã cập nhật ${ok}/${fresh.length + mark.length} — lỗi: ${(e as Error).message}`);
    } finally {
      window.dispatchEvent(new Event('lgvn:market-changed'));
      await loadCompetitors();
      setSelected(new Set());
      setSaving(false);
    }
  };

  const addKw = () => {
    const t = newKw.trim();
    if (!t) return;
    (tab === 'company' ? setKwCompany : setKwSupplier)(list => (list.some(k => k.text === t) ? list : [...list, { text: t, on: true }]));
    setNewKw('');
  };

  const matchChip = (m: ScanMatch) => {
    if (m.type === 'new') return <span className="px-1.5 py-0.5 rounded-md bg-[#E8F7EE] text-[#137333] font-semibold">Mới</span>;
    if (m.type === 'company') {
      const meta = STATUS_META[m.company.status];
      return <span className="px-1.5 py-0.5 rounded-md font-medium" style={{ background: `${meta.color}1A`, color: meta.color }}>Đã có · {meta.label}</span>;
    }
    return <span className={`px-1.5 py-0.5 rounded-md font-medium ${m.activeHere ? 'bg-[#F2F2F7] text-[#3A3A3C]' : 'bg-[#FFF4E5] text-[#B25000]'}`}>{m.activeHere ? 'Đối thủ đã theo dõi' : 'Đối thủ — chưa ghi nhận ở KCN này'}</span>;
  };

  const kws = tab === 'company' ? kwCompany : kwSupplier;
  const setKws = tab === 'company' ? setKwCompany : setKwSupplier;

  return (
    <div className="fixed inset-0 z-[1300] bg-[#F2F2F7] flex flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-2 h-12 px-2 shrink-0 bg-white border-b border-black/5">
        <button onClick={onClose} className="h-10 px-3 text-[16px] text-[#0A84FF]">Đóng</button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-[15px] font-semibold text-[#1D1D1F] truncate">Tải thông tin {zone.name}</div>
          <div className="text-[11px] text-[#8E8E93] truncate">{lastAt ? `Quét lần cuối ${new Date(lastAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : 'Chưa quét lần nào trên máy này'}</div>
        </div>
        <div className="w-[64px]" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[calc(110px+env(safe-area-inset-bottom))] space-y-3">
        {/* Nguồn */}
        <div className="rounded-xl bg-white px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2 text-[13px]">
            <Check size={15} className="text-[#34C759] shrink-0" />
            <span className="flex-1 min-w-0"><b>OpenStreetMap</b> — miễn phí: nhà máy / văn phòng có tên trong KCN, văn phòng việc làm và tên có chữ “cung ứng, nhân lực, việc làm, tuyển dụng…” trong bán kính 6 km</span>
          </div>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={useGoogle && !!google} disabled={!google} onChange={e => setUseGoogle(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#0A84FF]" />
            <span className="flex-1 min-w-0">
              <b>Google Maps</b> — đầy đủ hơn nhiều (tìm theo từng từ khoá, mỗi từ khoá tới 60 nơi).{' '}
              {google === null && <span className="text-[#8E8E93]">Đang kiểm tra…</span>}
              {google === false && <span className="text-[#B25000]">Chưa bật: cần khoá Google Places API (GOOGLE_MAPS_API_KEY) cài trên Vercel.</span>}
              {google && <span className="text-[#8E8E93]">Mỗi lần quét khoảng {kwCompany.filter(k => k.on).length * 3 + kwSupplier.filter(k => k.on).length * 2} lượt gọi Google.</span>}
            </span>
          </label>
        </div>

        {/* Từ khoá */}
        <div className="rounded-xl bg-white overflow-hidden">
          <button onClick={() => setShowKw(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
            <Search size={15} className="text-[#8E8E93]" />
            <span className="flex-1 text-[13.5px] font-medium text-[#1D1D1F]">Từ khoá quét (tự lên — bấm để bật / tắt, thêm từ khoá riêng)</span>
            <span className="text-[12px] text-[#8E8E93]">{kwCompany.filter(k => k.on).length + kwSupplier.filter(k => k.on).length}</span>
          </button>
          {showKw && (
            <div className="px-3 pb-3 space-y-2">
              <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[#E5E5EA]">
                {(['company', 'supplier'] as Tab[]).map(t => (
                  <button key={t} onClick={() => setTab(t)} className={`h-8 rounded-md text-[12.5px] font-medium ${tab === t ? 'bg-white shadow-sm' : 'text-[#3A3A3C]'}`}>
                    {t === 'company' ? 'Công ty trong KCN' : 'Nhà cung ứng quanh KCN'}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {kws.map((k, i) => (
                  <button key={k.text} onClick={() => setKws(list => list.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                    className={`h-7 px-2.5 rounded-full text-[12px] ${k.on ? 'bg-[#0A84FF] text-white' : 'bg-[#F2F2F7] text-[#8E8E93] line-through'}`}>{k.text}</button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addKw(); }}
                  placeholder={tab === 'company' ? 'Thêm từ khoá, VD: công ty bao bì' : 'Thêm từ khoá, VD: tuyển lao động phổ thông'}
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-[#F2F2F7] text-[13px] outline-none" />
                <button onClick={addKw} className="h-9 px-3 rounded-lg bg-[#F2F2F7] text-[#0A84FF] shrink-0"><Plus size={16} /></button>
              </div>
            </div>
          )}
        </div>

        <button onClick={() => void run()} disabled={running}
          className="w-full h-12 rounded-2xl bg-[#0A84FF] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {running ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={17} />}
          {running ? 'Đang quét…' : places.length ? 'Quét lại thông tin mới' : 'Bắt đầu quét'}
        </button>
        {progress && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-[#E5E5EA] overflow-hidden"><div className="h-full bg-[#0A84FF] transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
            <div className="text-[11.5px] text-[#8E8E93] truncate">{progress.done + 1}/{progress.total} · {progress.label}</div>
          </div>
        )}
        {errors.length > 0 && (
          <div className="rounded-xl bg-[#FFF4E5] text-[#8A4B00] text-[12px] px-3 py-2 space-y-0.5">
            {errors.slice(0, 4).map(e => <div key={e}>• {e}</div>)}
            {errors.length > 4 && <div>… và {errors.length - 4} lỗi khác</div>}
          </div>
        )}

        {/* Kết quả */}
        {places.length > 0 && (
          <>
            <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[#E5E5EA]">
              {(['company', 'supplier'] as Tab[]).map(t => {
                const all = counts[t], fresh = all.filter(actionable).length;
                return (
                  <button key={t} onClick={() => { setTab(t); setSelected(new Set()); }} className={`h-9 rounded-md text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 ${tab === t ? 'bg-white shadow-sm' : 'text-[#3A3A3C]'}`}>
                    {t === 'company' ? <Building2 size={14} /> : <Users size={14} />}
                    {t === 'company' ? 'Công ty' : 'Nhà cung ứng'} {all.length}{fresh ? <span className="text-[#137333]">· {fresh} mới</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12.5px] text-[#3A3A3C]">
                <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" /> Chỉ hiện chỗ chưa có / cần cập nhật
              </label>
              <div className="flex-1" />
              {shown.some(actionable) && <button onClick={selectAll} className="text-[12.5px] text-[#0A84FF] font-medium">Chọn tất cả</button>}
            </div>
            <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
              {shown.slice(0, 300).map(({ p, m, d }) => {
                const can = actionable({ p, m });
                return (
                  <div key={p.key} className="flex items-start gap-2 px-3 py-2.5">
                    {can
                      ? <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} className="mt-1 w-4 h-4 accent-[#0A84FF] shrink-0" aria-label={`Chọn ${p.name}`} />
                      : <span className="w-4 shrink-0" />}
                    <button onClick={() => onFocus(p)} className="flex-1 min-w-0 text-left">
                      <span className="block text-[14px] text-[#1D1D1F] leading-snug">{p.name}</span>
                      <span className="block text-[11.5px] text-[#8E8E93] truncate">{[p.category, p.address].filter(Boolean).join(' · ')}</span>
                      <span className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px]">
                        {matchChip(m)}
                        {p.sources.map(s => <span key={s} className="px-1.5 py-0.5 rounded-md bg-[#F2F2F7] text-[#3A3A3C]">{s === 'google' ? 'Google' : 'OSM'}</span>)}
                        <span className="text-[#8E8E93]">{fmtDistance(d)} từ tâm KCN</span>
                      </span>
                    </button>
                    <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Mở trên Google Maps" title="Mở trên Google Maps"
                      className="w-8 h-8 rounded-full bg-[#F2F2F7] text-[#0A84FF] flex items-center justify-center shrink-0"><ExternalLink size={13} /></a>
                  </div>
                );
              })}
              {!shown.length && <div className="px-3 py-8 text-center text-[13px] text-[#8E8E93]">{onlyNew ? 'Không có chỗ nào mới — bỏ chọn ô "Chỉ hiện chỗ chưa có" để xem tất cả' : 'Không có kết quả'}</div>}
            </div>
            <div className="text-[11px] text-[#8E8E93] leading-snug">
              Bấm tên để xem chỗ đó trên bản đồ. Công ty quét được hiện trên bản đồ khảo sát (chấm xám có tên) — đi ngang là app báo.
              Dữ liệu Google chỉ nhớ trong máy 30 ngày; bấm “Thêm” thì lưu tên + vị trí + link Google Maps vào hệ thống.
            </div>
          </>
        )}
      </div>

      {selRows.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 bg-white/95 backdrop-blur border-t border-black/5 px-4 pt-2.5 pb-[calc(12px+env(safe-area-inset-bottom))] flex items-center gap-2">
          <button onClick={() => setSelected(new Set())} className="w-10 h-11 rounded-xl bg-[#F2F2F7] flex items-center justify-center text-[#3A3A3C] shrink-0" aria-label="Bỏ chọn"><X size={16} /></button>
          <button onClick={() => void (tab === 'company' ? addCompanies() : addSuppliers())} disabled={saving}
            className="flex-1 h-11 rounded-xl bg-[#137333] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
            {tab === 'company' ? `Thêm ${selRows.length} công ty vào Thị trường` : `Cập nhật ${selRows.length} vào Đối thủ`}
          </button>
        </div>
      )}
    </div>
  );
}
