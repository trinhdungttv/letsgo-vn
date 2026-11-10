// Nhà trọ ghi khi khảo sát KCN (giống ảnh chỉ tiêu): chụp ảnh nhà trọ + cơ sở vật chất, SĐT chủ nhà, tổng số phòng, giá,
// tiện ích, vị trí (GPS lúc ghi). Lưu xong tự đo đường XE MÁY và ĐI BỘ tới các công ty gần nhất.
// 2 chế độ: xem (gọi / Zalo / chỉ đường) và sửa. Dùng ở màn khảo sát GPS và tab Khảo sát KCN.
import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bike, Camera, Check, ChevronDown, ExternalLink, Footprints, Home, ImagePlus, Loader2, MapPin, MessageCircle, Pencil, Phone,
  Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import PanoPositionPicker from '../../../components/pano/PanoPositionPicker';
import {
  LODGING_FACILITIES, directionsLink, fmtKm, fmtMin, fmtRent, lodgingTitle, parseRent, phoneDigits, pickRouteTargets,
  type Lodging, type LodgingPhoto, type LodgingPhotoKind, type LodgingRoute, type RouteCandidate,
} from '../../../lib/kcnSurvey/lodgingCore';
import { LodgingMissingTable, LODGING_MIGRATION_HINT, computeLodgingRoutes, saveLodging, softDeleteLodging, uploadLodgingPhoto } from '../../../lib/kcnSurvey/lodgings';
import type { PhotoPosition } from './SurveyPhotoSheet';

export interface LodgingStart {
  position: PhotoPosition | null;
  zoneId: string | null;
  zoneName: string;
  tripId: string | null;
}

interface Props {
  lodging: Lodging | null;
  start?: LodgingStart;
  /** Công ty / KCN để đo đường (có toạ độ). */
  candidates: RouteCandidate[];
  /** Vị trí GPS mới nhất (màn khảo sát) — để bấm "Dùng vị trí hiện tại". */
  livePosition?: () => PhotoPosition | null;
  fallbackCenter: { lat: number; lng: number };
  onClose: () => void;
  onSaved: (l: Lodging) => void;
  onDeleted?: (id: string) => void;
}

type Uploading = { tmp: string; kind: LodgingPhotoKind; preview: string; error?: string };

const label = 'text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1.5';
const input = 'w-full h-11 px-3 rounded-xl bg-[#F2F2F7] text-[15px] text-[#1D1D1F] outline-none focus:ring-2 focus:ring-[#0A84FF]/40';

export default function LodgingSheet({ lodging, start, candidates, livePosition, fallbackCenter, onClose, onSaved, onDeleted }: Props) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.username || '';
  const isNew = !lodging;
  const [mode, setMode] = useState<'view' | 'edit'>(isNew ? 'edit' : 'view');
  const [id] = useState(() => lodging?.id ?? crypto.randomUUID());
  const [cur, setCur] = useState<Lodging | null>(lodging);

  // ── Ô nhập ──
  const [name, setName] = useState(lodging?.name ?? '');
  const [address, setAddress] = useState(lodging?.address ?? '');
  const [landlord, setLandlord] = useState(lodging?.landlord_name ?? '');
  const [phone, setPhone] = useState(lodging?.landlord_phone ?? '');
  const [total, setTotal] = useState(lodging?.total_rooms != null ? String(lodging.total_rooms) : '');
  const [vacant, setVacant] = useState(lodging?.vacant_rooms != null ? String(lodging.vacant_rooms) : '');
  const [rentMin, setRentMin] = useState(lodging?.rent_min != null ? String(lodging.rent_min) : '');
  const [rentMax, setRentMax] = useState(lodging?.rent_max != null ? String(lodging.rent_max) : '');
  const [facilities, setFacilities] = useState<string[]>(lodging?.facilities ?? []);
  const [extraFac, setExtraFac] = useState('');
  const [note, setNote] = useState(lodging?.note ?? '');
  const [photos, setPhotos] = useState<LodgingPhoto[]>(lodging?.photos ?? []);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const initialPos = lodging?.lat != null && lodging.lng != null
    ? { lat: lodging.lat, lng: lodging.lng, acc: null, source: lodging.position_source } as PhotoPosition
    : start?.position ?? null;
  const [pos, setPos] = useState<PhotoPosition | null>(initialPos);
  const [pickMap, setPickMap] = useState(false);
  const [keep, setKeep] = useState<string[]>(() => (lodging?.routes ?? []).map(r => r.key));
  const [addQuery, setAddQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<LodgingPhoto | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<LodgingPhotoKind>('house');

  const rMin = parseRent(rentMin), rMax = parseRent(rentMax);
  const previewTargets = useMemo(() => (pos ? pickRouteTargets(pos, candidates, { keep }) : []), [pos, candidates, keep]);
  const addMatches = useMemo(() => {
    const q = addQuery.trim().toLocaleLowerCase('vi');
    if (q.length < 2) return [];
    return candidates.filter(c => c.name.toLocaleLowerCase('vi').includes(q) && !keep.includes(c.key)).slice(0, 8);
  }, [addQuery, candidates, keep]);

  const pickFiles = (kind: LodgingPhotoKind, fromLib: boolean) => { kindRef.current = kind; (fromLib ? libRef : camRef).current?.click(); };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const kind = kindRef.current;
    const list = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 12);
    const jobs = list.map(f => ({ tmp: crypto.randomUUID(), kind, preview: URL.createObjectURL(f), file: f }));
    setUploading(u => [...u, ...jobs.map(j => ({ tmp: j.tmp, kind: j.kind, preview: j.preview }))]);
    for (const j of jobs) {
      try {
        const p = await uploadLodgingPhoto(id, j.file, kind);
        setPhotos(ps => [...ps, p]);
        setUploading(u => u.filter(x => x.tmp !== j.tmp));
        URL.revokeObjectURL(j.preview);
      } catch (e) {
        setUploading(u => u.map(x => (x.tmp === j.tmp ? { ...x, error: (e as Error).message } : x)));
      }
    }
  };

  const toggleFac = (f: string) => setFacilities(list => (list.includes(f) ? list.filter(x => x !== f) : [...list, f]));
  const addFac = () => { const f = extraFac.trim(); if (f && !facilities.includes(f)) setFacilities([...facilities, f]); setExtraFac(''); };

  const save = async () => {
    if (!pos) { setErr('Chưa có vị trí nhà trọ — bấm "Chọn trên bản đồ" hoặc đợi GPS.'); return; }
    if (uploading.some(u => !u.error)) { setErr('Ảnh đang tải lên — đợi xong rồi lưu.'); return; }
    setErr(null);
    setBusy('Đang lưu…');
    const base = {
      id, name: name.trim(), address: address.trim(), landlord_name: landlord.trim(), landlord_phone: phone.trim(),
      total_rooms: total.trim() ? Math.max(0, parseInt(total, 10) || 0) : null,
      vacant_rooms: vacant.trim() ? Math.max(0, parseInt(vacant, 10) || 0) : null,
      rent_min: rMin, rent_max: rMax,
      facilities, note: note.trim(), photos,
      lat: pos.lat, lng: pos.lng, position_source: pos.source,
      zone_id: cur?.zone_id ?? start?.zoneId ?? null,
      zone_name: cur?.zone_name ?? start?.zoneName ?? '',
      trip_id: cur?.trip_id ?? start?.tripId ?? null,
      routes: cur?.routes ?? [],
    };
    try {
      let row = await saveLodging(base, userName, isNew && !cur);
      setCur(row);
      // Đo đường khi mới tạo, đã dời vị trí, hoặc đổi danh sách công ty
      const moved = !lodging || lodging.lat !== pos.lat || lodging.lng !== pos.lng;
      const keysChanged = keep.join('|') !== (lodging?.routes ?? []).map(r => r.key).join('|');
      if ((moved || keysChanged || !row.routes.length) && candidates.length) {
        setBusy('Đang đo đường xe máy / đi bộ tới công ty gần…');
        const routes = await computeLodgingRoutes(pos, candidates, { keep }).catch(() => [] as LodgingRoute[]);
        if (routes.length) row = await saveLodging({ ...base, routes }, userName, false);
        setCur(row);
      }
      onSaved(row);
      setMode('view');
    } catch (e) {
      setErr(e instanceof LodgingMissingTable ? LODGING_MIGRATION_HINT : 'Không lưu được: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const recompute = async () => {
    if (!cur || cur.lat == null || cur.lng == null) return;
    setBusy('Đang đo lại đường…');
    try {
      const routes = await computeLodgingRoutes({ lat: cur.lat, lng: cur.lng }, candidates, { keep: cur.routes.map(r => r.key) });
      const { created_at: _c, updated_at: _u, created_by: _cb, updated_by: _ub, ...rest } = cur;
      void _c; void _u; void _cb; void _ub;
      const row = await saveLodging({ ...rest, routes }, userName, false);
      setCur(row);
      onSaved(row);
    } catch (e) {
      setErr('Không đo được đường: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!cur) { onClose(); return; }
    if (!window.confirm(`Xoá nhà trọ "${lodgingTitle(cur)}"?\n\n(Vẫn giữ trong hệ thống — khôi phục được ở Lịch sử dữ liệu.)`)) return;
    setBusy('Đang xoá…');
    try {
      await softDeleteLodging(cur.id, userName);
      onDeleted?.(cur.id);
      onClose();
    } catch (e) {
      setErr('Không xoá được: ' + (e as Error).message);
      setBusy(null);
    }
  };

  const photoGrid = (kind: LodgingPhotoKind, editable: boolean) => {
    const list = (editable ? photos : cur?.photos ?? []).filter(p => p.kind === kind);
    const ups = editable ? uploading.filter(u => u.kind === kind) : [];
    if (!editable && !list.length) return null;
    return (
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {list.map(p => (
          <div key={p.id} className="relative shrink-0 w-28">
            <button onClick={() => setZoom(p)} className="block w-28 h-28 rounded-xl overflow-hidden bg-[#E5E5EA]">
              <img src={p.thumb_url} alt={p.caption} loading="lazy" className="w-full h-full object-cover" />
            </button>
            {editable ? (
              <>
                <input value={p.caption} maxLength={200} placeholder="Ghi chú ảnh"
                  onChange={e => setPhotos(ps => ps.map(x => (x.id === p.id ? { ...x, caption: e.target.value } : x)))}
                  className="mt-1 w-full h-7 px-2 rounded-lg bg-[#F2F2F7] text-[11.5px] outline-none" />
                <button onClick={() => setPhotos(ps => ps.filter(x => x.id !== p.id))} aria-label="Bỏ ảnh"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center"><X size={13} /></button>
              </>
            ) : p.caption && <div className="mt-1 text-[11px] text-[#6E6E73] line-clamp-2">{p.caption}</div>}
          </div>
        ))}
        {ups.map(u => (
          <div key={u.tmp} className="relative shrink-0 w-28 h-28 rounded-xl overflow-hidden bg-[#E5E5EA]">
            <img src={u.preview} alt="" className="w-full h-full object-cover opacity-60" />
            <div className="absolute inset-0 flex items-center justify-center text-white text-[11px] font-semibold text-center px-1">
              {u.error ? <span className="bg-red-600/90 rounded px-1">Lỗi tải</span> : <Loader2 size={20} className="animate-spin" />}
            </div>
            {u.error && <button onClick={() => setUploading(x => x.filter(y => y.tmp !== u.tmp))} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center"><X size={13} /></button>}
          </div>
        ))}
        {editable && (
          <div className="shrink-0 flex flex-col gap-2">
            <button onClick={() => pickFiles(kind, false)} className="w-28 h-[52px] rounded-xl bg-[#0A84FF] text-white text-[12.5px] font-semibold flex items-center justify-center gap-1"><Camera size={15} /> Chụp</button>
            <button onClick={() => pickFiles(kind, true)} className="w-28 h-[52px] rounded-xl bg-[#F2F2F7] text-[#1D1D1F] text-[12.5px] font-semibold flex items-center justify-center gap-1"><ImagePlus size={15} /> Chọn ảnh</button>
          </div>
        )}
      </div>
    );
  };

  const routesList = (routes: readonly LodgingRoute[], from: { lat: number; lng: number }) => (
    <div className="rounded-xl bg-[#F2F2F7] divide-y divide-black/5">
      {routes.map(r => (
        <div key={r.key} className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
            <span className="flex-1 min-w-0 text-[14px] font-medium text-[#1D1D1F] truncate">{r.name}</span>
            <span className="text-[11px] text-[#8E8E93] shrink-0">{r.kind}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[12.5px] text-[#3A3A3C] tabular-nums">
            <a href={directionsLink(from, r, 'moto')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[#0A84FF]" title="Xem đường xe máy trên Google Maps">
              <Bike size={14} className="text-[#0A84FF]" /> {fmtKm(r.moto_km)} · {fmtMin(r.moto_min)}
            </a>
            <a href={directionsLink(from, r, 'walk')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[#0A84FF]" title="Xem đường đi bộ trên Google Maps">
              <Footprints size={14} className="text-[#34C759]" /> {fmtKm(r.walk_km)} · {fmtMin(r.walk_min)}
            </a>
            {r.engine === 'estimate' && <span className="text-[10.5px] text-[#FF9500]">ước tính</span>}
          </div>
        </div>
      ))}
    </div>
  );

  const view = cur && mode === 'view';
  const digits = phoneDigits(view ? cur!.landlord_phone : phone);

  return (
    <div className="fixed inset-0 z-[1300] bg-white flex flex-col pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="true" aria-label="Nhà trọ">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { void onFiles(e.target.files); e.target.value = ''; }} />
      <input ref={libRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { void onFiles(e.target.files); e.target.value = ''; }} />

      <div className="flex items-center justify-between h-12 px-2 border-b border-black/5 shrink-0">
        <button onClick={() => (view || isNew ? onClose() : setMode('view'))} disabled={!!busy} className="h-10 px-3 text-[16px] text-[#0A84FF]">{view ? 'Đóng' : 'Huỷ'}</button>
        <div className="text-[16px] font-semibold text-[#1D1D1F] truncate px-2">{view ? lodgingTitle(cur!) : isNew ? 'Nhà trọ mới' : 'Sửa nhà trọ'}</div>
        {view
          ? <button onClick={() => setMode('edit')} className="h-10 px-3 text-[16px] font-semibold text-[#0A84FF] inline-flex items-center gap-1"><Pencil size={15} /> Sửa</button>
          : <button onClick={() => void save()} disabled={!!busy} className="h-10 px-3 text-[16px] font-semibold text-[#0A84FF] disabled:text-[#C7C7CC]">Lưu</button>}
      </div>

      {(busy || err) && (
        <div className={`shrink-0 px-4 py-2 text-[12.5px] flex items-center gap-2 ${err ? 'bg-amber-50 text-amber-900' : 'bg-[#EAF3FF] text-[#0A5FCC]'}`}>
          {err ? <AlertTriangle size={14} className="shrink-0" /> : <Loader2 size={14} className="animate-spin shrink-0" />}
          <span className="flex-1">{err ?? busy}</span>
          {err && <button onClick={() => setErr(null)} aria-label="Đóng"><X size={14} /></button>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-[calc(28px+env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto px-4 pt-3 space-y-5">
          {view ? (
            <>
              {/* ── Xem ── */}
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#FFF4E5] text-[#FF9500] flex items-center justify-center shrink-0"><Home size={22} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] font-semibold text-[#1D1D1F] leading-tight">{lodgingTitle(cur!)}</div>
                  <div className="text-[12.5px] text-[#8E8E93] mt-0.5">{[cur!.zone_name, cur!.address, cur!.created_by && `Ghi bởi ${cur!.created_by}`, cur!.created_at && new Date(cur!.created_at).toLocaleDateString('vi-VN')].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              {(cur!.landlord_name || digits) && (
                <div className="rounded-xl bg-[#F2F2F7] px-3 py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[#8E8E93]">Chủ nhà</div>
                    <div className="text-[15px] font-medium text-[#1D1D1F] truncate">{[cur!.landlord_name, cur!.landlord_phone].filter(Boolean).join(' · ')}</div>
                  </div>
                  {digits && <a href={`tel:${digits}`} className="h-9 px-3 rounded-full bg-[#34C759] text-white text-[13px] font-semibold inline-flex items-center gap-1"><Phone size={14} /> Gọi</a>}
                  {digits && <a href={`https://zalo.me/${digits}`} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-full bg-[#0A84FF] text-white text-[13px] font-semibold inline-flex items-center gap-1"><MessageCircle size={14} /> Zalo</a>}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Fact label="Tổng số phòng" value={cur!.total_rooms != null ? String(cur!.total_rooms) : '—'} />
                <Fact label="Còn trống" value={cur!.vacant_rooms != null ? String(cur!.vacant_rooms) : '—'} />
                <Fact label="Giá / tháng" value={fmtRent(cur!.rent_min, cur!.rent_max) || '—'} />
              </div>
              {cur!.photos.some(p => p.kind === 'house') && <section><div className={label}>Ảnh nhà trọ</div>{photoGrid('house', false)}</section>}
              {cur!.photos.some(p => p.kind === 'facility') && <section><div className={label}>Cơ sở vật chất</div>{photoGrid('facility', false)}</section>}
              {cur!.facilities.length > 0 && (
                <section>
                  <div className={label}>Tiện ích</div>
                  <div className="flex flex-wrap gap-1.5">{cur!.facilities.map(f => <span key={f} className="h-7 px-2.5 rounded-full bg-[#E8F7EE] text-[#137333] text-[12.5px] font-medium inline-flex items-center gap-1"><Check size={12} /> {f}</span>)}</div>
                </section>
              )}
              {cur!.note && <section><div className={label}>Ghi chú</div><div className="text-[14px] text-[#1D1D1F] whitespace-pre-wrap">{cur!.note}</div></section>}
              {cur!.lat != null && cur!.lng != null && (
                <section>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className={label.replace('mb-1.5', '')}>Khoảng cách tới công ty</div>
                    <button onClick={() => void recompute()} disabled={!!busy || !candidates.length} className="text-[12.5px] text-[#0A84FF] font-medium inline-flex items-center gap-1 disabled:opacity-40"><RefreshCw size={12} /> Đo lại</button>
                  </div>
                  {cur!.routes.length ? routesList(cur!.routes, { lat: cur!.lat, lng: cur!.lng }) : (
                    <div className="text-[12.5px] text-[#8E8E93]">Chưa đo — bấm "Đo lại" (cần mạng).</div>
                  )}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${cur!.lat},${cur!.lng}`} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-[#0A84FF]"><ExternalLink size={12} /> Mở vị trí nhà trọ trên Google Maps</a>
                </section>
              )}
            </>
          ) : (
            <>
              {/* ── Sửa ── */}
              <section>
                <div className={label}>Ảnh nhà trọ (mặt tiền, lối vào, dãy phòng)</div>
                {photoGrid('house', true)}
              </section>
              <section>
                <div className={label}>Ảnh cơ sở vật chất (phòng, WC, bếp, chỗ để xe…)</div>
                {photoGrid('facility', true)}
              </section>

              <section className="space-y-2">
                <div className={label}>Chủ nhà</div>
                <input value={landlord} onChange={e => setLandlord(e.target.value)} placeholder="Tên chủ nhà (cô Lan, anh Tú…)" maxLength={120} className={input} />
                <div className="flex gap-2">
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="SĐT chủ nhà" inputMode="tel" type="tel" maxLength={40} className={`${input} flex-1`} />
                  {digits.length >= 9 && <a href={`tel:${digits}`} className="h-11 w-11 rounded-xl bg-[#34C759] text-white flex items-center justify-center shrink-0" aria-label="Gọi thử"><Phone size={17} /></a>}
                </div>
                <input value={name} onChange={e => setName(e.target.value)} placeholder={`Tên nhà trọ (để trống = "${lodgingTitle({ name: '', landlord_name: landlord, landlord_phone: phone })}")`} maxLength={200} className={input} />
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Địa chỉ / mô tả chỗ (hẻm, gần cổng KCN…)" maxLength={300} className={input} />
              </section>

              <section>
                <div className={label}>Phòng & giá</div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Tổng số phòng" value={total} onChange={setTotal} />
                  <NumField label="Còn trống" value={vacant} onChange={setVacant} />
                  <div>
                    <input value={rentMin} onChange={e => setRentMin(e.target.value)} placeholder="Giá từ (2tr5)" className={input} />
                    {rentMin.trim() && <div className={`text-[11px] mt-0.5 ${rMin == null ? 'text-red-600' : 'text-[#8E8E93]'}`}>{rMin == null ? 'Chưa hiểu giá' : `${rMin.toLocaleString('vi-VN')} đ`}</div>}
                  </div>
                  <div>
                    <input value={rentMax} onChange={e => setRentMax(e.target.value)} placeholder="đến (nếu có)" className={input} />
                    {rentMax.trim() && <div className={`text-[11px] mt-0.5 ${rMax == null ? 'text-red-600' : 'text-[#8E8E93]'}`}>{rMax == null ? 'Chưa hiểu giá' : `${rMax.toLocaleString('vi-VN')} đ`}</div>}
                  </div>
                </div>
              </section>

              <section>
                <div className={label}>Tiện ích</div>
                <div className="flex flex-wrap gap-1.5">
                  {[...LODGING_FACILITIES, ...facilities.filter(f => !(LODGING_FACILITIES as readonly string[]).includes(f))].map(f => {
                    const on = facilities.includes(f);
                    return (
                      <button key={f} type="button" onClick={() => toggleFac(f)}
                        className={`h-8 px-2.5 rounded-full text-[12.5px] font-medium border transition ${on ? 'bg-[#0A84FF] border-[#0A84FF] text-white' : 'bg-white border-[#E5E5EA] text-[#3A3A3C]'}`}>{f}</button>
                    );
                  })}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <input value={extraFac} onChange={e => setExtraFac(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addFac(); }} placeholder="Tiện ích khác…" maxLength={60} className="flex-1 h-9 px-3 rounded-lg bg-[#F2F2F7] text-[13.5px] outline-none" />
                  <button onClick={addFac} disabled={!extraFac.trim()} className="h-9 px-3 rounded-lg bg-[#F2F2F7] text-[#0A84FF] text-[13px] font-semibold disabled:opacity-40"><Plus size={14} /></button>
                </div>
              </section>

              <section>
                <div className={label}>Ghi chú</div>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000} placeholder="Đông công nhân công ty nào ở, an ninh, đường vào…"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] text-[15px] outline-none resize-y" />
              </section>

              <section>
                <div className={label}>Vị trí nhà trọ</div>
                <div className={`flex items-center gap-2 text-[13px] ${pos ? 'text-[#3A3A3C]' : 'text-[#D70015] font-medium'}`}>
                  <MapPin size={15} className="shrink-0" />
                  <span className="flex-1">
                    {!pos && 'Chưa có vị trí — đợi GPS hoặc chọn trên bản đồ'}
                    {pos?.source === 'gps' && <>Theo GPS chỗ đang đứng{pos.acc != null && ` (±${Math.round(pos.acc)} m)`}</>}
                    {pos?.source === 'exif' && 'Theo vị trí lưu trong ảnh'}
                    {pos?.source === 'manual' && 'Theo vị trí chọn trên bản đồ'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {livePosition && (
                    <button onClick={() => { const p = livePosition(); if (p) setPos(p); else setErr('Chưa có tín hiệu GPS đủ chính xác.'); }}
                      className="h-9 px-3 rounded-lg bg-[#F2F2F7] text-[13px] font-medium text-[#1D1D1F]">Dùng vị trí hiện tại</button>
                  )}
                  <button onClick={() => setPickMap(v => !v)} className="h-9 px-3 rounded-lg bg-[#F2F2F7] text-[13px] font-medium text-[#1D1D1F] inline-flex items-center gap-1">
                    Chọn trên bản đồ <ChevronDown size={14} className={pickMap ? 'rotate-180 transition' : 'transition'} />
                  </button>
                </div>
                {pickMap && (
                  <div className="mt-2">
                    <PanoPositionPicker value={pos ? { lat: pos.lat, lng: pos.lng } : null} fallbackCenter={pos ?? fallbackCenter} height={240}
                      onChange={p => setPos({ lat: p.lat, lng: p.lng, acc: null, source: 'manual' })} />
                  </div>
                )}
              </section>

              {pos && (
                <section>
                  <div className={label}>Đo đường tới (xe máy + đi bộ, tự đo lúc lưu)</div>
                  {previewTargets.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {previewTargets.map(t => (
                        <span key={t.key} className="h-7 pl-2 pr-1 rounded-full bg-[#F2F2F7] text-[12px] text-[#1D1D1F] inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                          {t.name} <span className="text-[#8E8E93]">· {fmtKm(t.straight_m / 1000)}</span>
                          {keep.includes(t.key) && <button onClick={() => setKeep(k => k.filter(x => x !== t.key))} aria-label="Bỏ" className="w-5 h-5 rounded-full text-[#8E8E93] hover:bg-black/5 flex items-center justify-center"><X size={11} /></button>}
                        </span>
                      ))}
                    </div>
                  ) : <div className="text-[12.5px] text-[#8E8E93]">Không có công ty nào đã ghim trong 5 km — thêm công ty bên dưới.</div>}
                  <div className="relative mt-2">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
                    <input value={addQuery} onChange={e => setAddQuery(e.target.value)} placeholder="Thêm công ty muốn đo (gõ tên)…" className="w-full h-9 pl-8 pr-3 rounded-lg bg-[#F2F2F7] text-[13.5px] outline-none" />
                  </div>
                  {addMatches.length > 0 && (
                    <div className="mt-1 rounded-xl border border-[#E5E5EA] divide-y divide-black/5 overflow-hidden">
                      {addMatches.map(c => (
                        <button key={c.key} onClick={() => { setKeep(k => [...k, c.key]); setAddQuery(''); }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F2F2F7]">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                          <span className="flex-1 min-w-0 text-[13.5px] truncate">{c.name}</span>
                          <span className="text-[11px] text-[#8E8E93]">{c.kind}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {!isNew && (
                <button onClick={() => void remove()} disabled={!!busy} className="w-full h-11 rounded-xl bg-[#FFF1F0] text-[#D70015] text-[14px] font-semibold inline-flex items-center justify-center gap-1.5">
                  <Trash2 size={15} /> Xoá nhà trọ này
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[1350] bg-black flex flex-col" onClick={() => setZoom(null)}>
          <div className="flex-1 min-h-0 flex items-center justify-center p-2"><img src={zoom.url} alt={zoom.caption} className="max-w-full max-h-full object-contain" /></div>
          {zoom.caption && <div className="shrink-0 px-4 py-3 text-white text-[14px] text-center">{zoom.caption}</div>}
          <button aria-label="Đóng" className="absolute top-[calc(12px+env(safe-area-inset-top))] right-3 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center"><X size={20} /></button>
        </div>
      )}
    </div>
  );
}

function Fact({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F2F2F7] px-3 py-2">
      <div className="text-[11px] text-[#8E8E93]">{l}</div>
      <div className="text-[16px] font-semibold text-[#1D1D1F] tabular-nums truncate">{value}</div>
    </div>
  );
}

function NumField({ label: l, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 5))} placeholder={l} inputMode="numeric" className={input} aria-label={l} />
  );
}
