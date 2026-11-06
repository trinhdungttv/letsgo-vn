// Trang xem Khảo sát KCN dành cho NGƯỜI NGOÀI — mở bằng link ngắn #/ks/<mã>, không cần đăng nhập, chỉ cần mã 4 số
// (kiểu mở khoá iPhone). Chỉ xem: ảnh chỉ tiêu tuyển dụng + các chuyến của những KCN người gửi cho phép, trong hạn xem.
// Mã được kiểm tra ở server (hàm survey_share_open, migration 209): sai 5 lần thì khoá tạm.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, Loader2, Lock, MapPin, Route, Search, X } from 'lucide-react';
import { loadSharedTracks, openSurveyShare, type SharedPhoto, type SharedSurvey, type SurveyShareFail } from '../lib/kcnSurvey/share';
import { lockMessage } from '../lib/costPlan/api';
import { provinceKey, provinceLabel } from '../lib/kcnSurvey/province';
import { fmtDistance, type TrackSegment } from '../lib/kcnSurvey/track';
import type { SurveyPhoto } from '../lib/kcnSurvey/api';
import PinPad from '../components/workspace/costplan/PinPad';
import { FONT } from '../components/workspace/costplan/ui';
import { MarksSvg } from './market/survey/PhotoMarks';
import { UNVERIFIED_TAG } from '../lib/kcnSurvey/online';

// Bản đồ Leaflet nặng → chỉ nạp khi mở trang xem (dùng đúng bản đồ trong app của người gửi)
const SurveyTripMap = lazy(() => import('./market/survey/SurveyTripMap'));
const NO_VOICE: never[] = [];

const isOnline = (p: SharedPhoto) => p.survey_kind === 'online';

const pinKey = (code: string) => `lgvn_ks_pin_${code}`;
const readStore = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const writeStore = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* chế độ riêng tư — bỏ qua */ } };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

type Phase = 'pin' | 'opening' | 'ready' | 'dead';
const FAIL_TEXT: Partial<Record<SurveyShareFail, string>> = {
  not_found: 'Link không tồn tại hoặc đã bị thu hồi.',
  expired: 'Link này đã hết thời hạn xem.',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]" style={{ minHeight: '100dvh', fontFamily: FONT }}>
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-black/[0.06] px-4 h-12 flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-[#1d1d1f] text-white font-bold text-[9px] flex items-center justify-center tracking-tight">GO</div>
        <div className="text-[13px] font-semibold tracking-tight">Let's Go VN</div>
        <div className="text-[13px] text-[#86868b]">Khảo sát KCN</div>
      </div>
      {children}
    </div>
  );
}

export default function SharedSurvey({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>('pin');
  const [err, setErr] = useState<string | null>(null);
  const [errTick, setErrTick] = useState(0);
  const [locked, setLocked] = useState(false);
  const [deadMsg, setDeadMsg] = useState('');
  const [data, setData] = useState<SharedSurvey | null>(null);

  const [tab, setTab] = useState<'photos' | 'trips'>('trips');
  const [pin, setPin] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Map<string, TrackSegment[]>>(new Map());
  const [tracksErr, setTracksErr] = useState<string | null>(null);
  const [province, setProvince] = useState('all');
  const [zoneId, setZoneId] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<SharedPhoto | null>(null);

  const tryOpen = useCallback(async (pin: string, remember: boolean) => {
    setPhase('opening'); setErr(null);
    try {
      const r = await openSurveyShare(code, pin);
      if (r.ok) {
        if (remember) writeStore(pinKey(code), pin);
        setPin(pin);
        setData(r); setPhase('ready');
        return;
      }
      if (r.reason === 'not_found' || r.reason === 'expired') { setDeadMsg(FAIL_TEXT[r.reason] ?? ''); setPhase('dead'); return; }
      writeStore(pinKey(code), null);
      if (r.reason === 'locked') { setLocked(true); setErr(lockMessage(r.seconds)); }
      else setErr(`Mã chưa đúng${r.remaining != null ? ` — còn ${r.remaining} lần thử` : ''}`);
      setErrTick(t => t + 1);
      setPhase('pin');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setErrTick(t => t + 1);
      setPhase('pin');
    }
  }, [code]);

  // F5 trong cùng tab thì không phải nhập lại mã
  useEffect(() => {
    const saved = readStore(pinKey(code));
    if (saved && /^\d{4}$/.test(saved)) void tryOpen(saved, false);
  }, [code, tryOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const zoneProv = useMemo(() => new Map((data?.zones ?? []).map(z => [z.id, provinceKey(z.location)])), [data]);
  const provinces = useMemo(() => {
    const m = new Map<string, string>();
    (data?.zones ?? []).forEach(z => { const k = provinceKey(z.location); if (k && !m.has(k)) m.set(k, provinceLabel(z.location)); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  }, [data]);
  const zoneOptions = useMemo(() => (data?.zones ?? []).filter(z => province === 'all' || zoneProv.get(z.id) === province), [data, province, zoneProv]);

  const okZone = useCallback((z: string | null) => !!z && (province === 'all' || zoneProv.get(z) === province) && (zoneId === 'all' || z === zoneId), [province, zoneId, zoneProv]);
  const needle = fold(q.trim());
  const photos = useMemo(() => (data?.photos ?? []).filter(p => okZone(p.zone_id)
    && (!needle || fold([p.company_name, p.positions, p.wage_text, p.note, p.zone_name].join(' ')).includes(needle))), [data, okZone, needle]);
  const trips = useMemo(() => (data?.trips ?? []).filter(t => okZone(t.zone_id)
    && (!needle || fold([t.title ?? '', t.zone_name].join(' ')).includes(needle))), [data, okZone, needle]);
  const photoCountByTrip = useMemo(() => {
    const m = new Map<string, number>();
    (data?.photos ?? []).forEach(p => { if (p.trip_id) m.set(p.trip_id, (m.get(p.trip_id) ?? 0) + 1); });
    return m;
  }, [data]);

  // ── Bản đồ lộ trình: vết của chuyến đang chọn, không thì 40 chuyến mới nhất trong bộ lọc (như trong app) ──
  const trackIds = useMemo(() => (tab !== 'trips' ? [] : selected ? [selected] : trips.slice(0, 40).map(t => t.id)), [tab, selected, trips]);
  const trackKey = trackIds.join(',');
  useEffect(() => {
    if (phase !== 'ready' || !trackIds.length) { setTracks(new Map()); return; }
    let alive = true;
    setTracksErr(null);
    loadSharedTracks(code, pin, trackIds).then(m => { if (alive) setTracks(m); }).catch(e => { if (alive) { setTracks(new Map()); setTracksErr((e as Error).message); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey, phase]);
  const selTrip = selected ? trips.find(t => t.id === selected) ?? null : null;
  const mapPhotos = useMemo(() => (selTrip ? photos.filter(p => p.trip_id === selTrip.id) : photos), [photos, selTrip]);
  const tripDays = useMemo(() => {
    const m = new Map<string, typeof trips>();
    for (const t of trips) { const d = new Date(t.started_at).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }); m.set(d, [...(m.get(d) ?? []), t]); }
    return [...m.entries()];
  }, [trips]);

  // ────────────── Nhập mã ──────────────
  if (phase === 'pin' || phase === 'opening') {
    return (
      <Shell>
        <div className="max-w-sm mx-auto px-6 pt-12 pb-10 flex flex-col items-center">
          <div className="w-14 h-14 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_2px_8px_rgba(0,0,0,0.06)] flex items-center justify-center mb-4"><Lock size={22} className="text-[#1d1d1f]" /></div>
          <h1 className="text-[22px] font-semibold tracking-tight mb-1">Nhập mã bảo mật</h1>
          <p className="text-[13px] text-[#6e6e73] mb-8 text-center leading-relaxed">Dữ liệu khảo sát KCN được chia sẻ riêng cho bạn.<br />Nhập mã 4 số có trong tin nhắn của người gửi.</p>
          <PinPad onComplete={p => tryOpen(p, true)} error={err} errorTick={errTick} disabled={locked} busy={phase === 'opening'} />
          <div className="h-12 mt-5 text-center">
            {phase === 'opening' && <div className="flex items-center justify-center gap-1.5 text-[13px] text-[#6e6e73]"><Loader2 size={14} className="animate-spin" />Đang kiểm tra…</div>}
            {phase === 'pin' && err && <div className="text-[13px] font-medium text-[#d70015]">{err}</div>}
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'dead') {
    return (
      <Shell>
        <div className="max-w-sm mx-auto px-6 pt-20 text-center">
          <AlertTriangle size={30} className="mx-auto text-[#ff9f0a] mb-3" />
          <h1 className="text-[20px] font-semibold tracking-tight mb-1">Không mở được link</h1>
          <p className="text-[13px] text-[#6e6e73]">{deadMsg || FAIL_TEXT.not_found}</p>
          <p className="text-[12px] text-[#a1a1a6] mt-3">Liên hệ người gửi để lấy link hoặc mã mới.</p>
        </div>
      </Shell>
    );
  }

  if (!data) return null;
  const chip = 'h-9 px-2.5 rounded-lg border border-black/[0.08] bg-white text-[12.5px] max-w-full';

  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto px-3 sm:px-6 py-5 space-y-4">
        <div className="bg-white rounded-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.05)] p-5">
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight">Khảo sát {data.zones.length} KCN</h1>
          <div className="text-[13px] text-[#6e6e73] mt-0.5">
            {data.provinces.length ? `${data.provinces.join(', ')} · ` : ''}{data.photos.length} ảnh chỉ tiêu · {data.trips.length} chuyến khảo sát
          </div>
          <div className="text-[12px] text-[#86868b] mt-1.5">
            {data.expires_at ? `Link xem được đến hết ngày ${fmtDate(data.expires_at)}` : 'Link không giới hạn thời gian'} · Chỉ xem
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {provinces.length > 1 && (
            <select value={province} onChange={e => { setProvince(e.target.value); setZoneId('all'); }} className={chip} aria-label="Tỉnh / thành phố">
              <option value="all">Mọi tỉnh / thành</option>
              {provinces.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          {data.zones.length > 1 && (
            <select value={zoneId} onChange={e => setZoneId(e.target.value)} className={`${chip} md:w-60`} aria-label="KCN">
              <option value="all">Tất cả KCN</option>
              {zoneOptions.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          )}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1a1a6]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm công ty, vị trí tuyển, lương…" className={`${chip} w-full pl-8`} />
          </div>
        </div>

        <div className="flex gap-1.5">
          {([['photos', `Ảnh chỉ tiêu · ${photos.length}`, <Camera key="c" size={13} />], ['trips', `Chuyến khảo sát · ${trips.length}`, <Route key="r" size={13} />]] as const).map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-medium transition ${tab === id ? 'bg-[#1d1d1f] text-white' : 'bg-white text-[#6e6e73] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]'}`}>{icon}{label}</button>
          ))}
        </div>

        {tab === 'photos' ? (
          photos.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {photos.map(p => (
                <button key={p.id} onClick={() => setOpen(p)} className="text-left bg-white rounded-xl overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition">
                  <div className="relative aspect-square bg-[#ececf0]">
                    <img src={p.thumb_url || p.url} alt={p.company_name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    {p.width && p.height && p.annotations && p.annotations.length > 0 && (
                      <MarksSvg marks={p.annotations} aspect={p.height / p.width} fit="cover" className="absolute inset-0 w-full h-full pointer-events-none" />
                    )}
                    {isOnline(p) && (
                      <span className={`absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold leading-none text-white shadow ${p.verified_at ? 'bg-[#34C759]' : 'bg-[#FF9F0A]'}`}>
                        {p.verified_at ? 'Khảo sát online' : UNVERIFIED_TAG}
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 space-y-0.5">
                    <div className="text-[13px] font-semibold leading-tight line-clamp-2">{p.company_name || 'Chưa ghi tên công ty'}</div>
                    <div className="text-[11.5px] text-[#86868b] truncate">{p.zone_name}</div>
                    {(p.positions || p.wage_text || p.headcount != null) && (
                      <div className="text-[11.5px] text-[#444] leading-snug line-clamp-2">
                        {[p.positions, p.headcount != null ? `${p.headcount} người` : '', p.wage_text].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : <Empty text="Không có ảnh nào khớp bộ lọc." />
        ) : (
          <div className="grid md:grid-cols-[340px_1fr] gap-3">
            <div className="order-2 md:order-1 md:max-h-[72vh] overflow-y-auto space-y-3">
              {tripDays.length ? tripDays.map(([day, list]) => (
                <div key={day}>
                  <div className="text-[12px] font-medium text-[#86868b] mb-1 px-1 capitalize">{day} <span className="text-[#a1a1a6]">· {list.length} chuyến · {fmtDistance(list.reduce((n, t) => n + (Number(t.distance_m) || 0), 0))}</span></div>
                  <div className="bg-white rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.05)] divide-y divide-black/[0.06] overflow-hidden">
                    {list.map(t => (
                      <button key={t.id} onClick={() => setSelected(selected === t.id ? null : t.id)}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition ${selected === t.id ? 'bg-[#fff4e0]' : 'hover:bg-[#fafafa]'}`}>
                        <div className="text-[13px] font-semibold tabular-nums shrink-0 w-11">{new Date(t.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold leading-tight truncate">{t.title || t.zone_name || 'Chuyến khảo sát'}</div>
                          <div className="text-[11.5px] text-[#86868b] truncate">
                            {fmtDistance(Number(t.distance_m) || 0)}{t.road_coverage != null ? ` · phủ ${Math.round(Number(t.road_coverage) * 10) / 10}%` : ''}{t.passed_count ? ` · ${t.passed_count} công ty đi ngang` : ''}
                          </div>
                        </div>
                        {photoCountByTrip.get(t.id) ? <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#444] bg-[#f0f0f2] rounded-md px-1.5 py-0.5 shrink-0"><Camera size={11} />{photoCountByTrip.get(t.id)}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )) : <Empty text="Không có chuyến nào khớp bộ lọc." />}
              {selected && <button onClick={() => setSelected(null)} className="text-[12.5px] font-medium text-[#0071e3] px-1">Bỏ chọn chuyến — xem tất cả</button>}
            </div>
            <div className="order-1 md:order-2 relative rounded-2xl overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,0.05)] bg-[#E5E3DF] h-[56vh] md:h-[72vh]">
              <Suspense fallback={<div className="h-full flex items-center justify-center text-[#86868b]"><Loader2 className="animate-spin" size={20} /></div>}>
                <SurveyTripMap className="w-full h-full" tracks={tracks} selectedId={selected} photos={mapPhotos as unknown as SurveyPhoto[]} voiceNotes={NO_VOICE}
                  fitKey={`${province}|${zoneId}|${q}|${selected ?? ''}|${trackKey}|${mapPhotos.length}`}
                  onPhoto={p => { const hit = photos.find(x => x.id === p.id); if (hit) setOpen(hit); }} onVoice={() => undefined} onTrip={id => setSelected(id)} />
              </Suspense>
              {tracksErr && <div className="absolute left-2 bottom-2 right-2 text-[11.5px] bg-white/95 text-[#b3140a] rounded-lg px-2.5 py-1.5">{tracksErr}</div>}
              <div className="absolute left-2 top-2 text-[11px] bg-white/90 backdrop-blur rounded-lg px-2 py-1 text-[#444] leading-tight pointer-events-none">
                {mapPhotos.length} công ty / ảnh trên bản đồ · chạm ảnh để xem chi tiết
              </div>
            </div>
          </div>
        )}

        <div className="text-[11.5px] text-[#a1a1a6] text-center pb-6">Link riêng tư của Let's Go VN — vui lòng không chuyển tiếp cho người khác.</div>
      </div>

      {open && <Lightbox photo={open} onClose={() => setOpen(null)} />}
    </Shell>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="bg-white rounded-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.05)] py-12 text-center text-[13px] text-[#86868b]">{text}</div>;
}

function Lightbox({ photo: p, onClose }: { photo: SharedPhoto; onClose: () => void }) {
  const aspect = p.width && p.height ? p.height / p.width : null;
  const rows: [string, string][] = [
    ['KCN', p.zone_name], ['Vị trí tuyển', p.positions], ['Số lượng', p.headcount != null ? `${p.headcount} người` : ''],
    ['Mức lương', p.wage_text], ['Ghi chú', p.note], ['Chụp lúc', fmtDateTime(p.taken_at)],
  ];
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col md:flex-row" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <button onClick={onClose} aria-label="Đóng" className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center"><X size={18} /></button>
      <div className="flex-1 min-h-0 flex items-center justify-center p-3" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="relative inline-block max-w-full">
          <img src={p.url} alt={p.company_name} className="block max-w-full max-h-[62vh] md:max-h-[92vh] rounded-lg" />
          {aspect && p.annotations && p.annotations.length > 0 && (
            <MarksSvg marks={p.annotations} aspect={aspect} className="absolute inset-0 w-full h-full pointer-events-none" />
          )}
        </div>
      </div>
      <div className="bg-white md:w-80 md:max-h-none max-h-[34vh] overflow-y-auto p-4 space-y-2.5 rounded-t-2xl md:rounded-none">
        <div className="text-[16px] font-semibold tracking-tight leading-snug">{p.company_name || 'Chưa ghi tên công ty'}</div>
        {isOnline(p) && (
          <div className={`text-[12px] font-medium rounded-lg px-2.5 py-1.5 leading-snug ${p.verified_at ? 'bg-[#e8f8ed] text-[#1d8a3b]' : 'bg-[#fff4e0] text-[#b25e00]'}`}>
            {p.verified_at ? 'Khảo sát online, đã được xác thực.' : `${UNVERIFIED_TAG}: lấy từ tin tuyển dụng trên mạng, vị trí theo Google Maps — chưa tới tận nơi kiểm tra.`}
          </div>
        )}
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] font-medium text-[#86868b]">{k}</div>
            <div className="text-[13.5px] leading-snug whitespace-pre-wrap">{v}</div>
          </div>
        ))}
        <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-[#eef5ff] text-[#0071e3] text-[13px] font-medium"><MapPin size={14} /> Xem chỗ chụp trên Google Maps</a>
      </div>
    </div>
  );
}
