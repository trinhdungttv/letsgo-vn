// Bổ sung ảnh vào 1 chuyến khảo sát (kể cả chuyến đã kết thúc): chọn nhiều ảnh đã chụp sẵn trong máy, app tự ghim đúng chỗ chụp.
// Vị trí lấy theo thứ tự: GPS lưu trong ảnh (EXIF) → GIỜ CHỤP khớp với vết GPS của chuyến (ảnh bị bỏ vị trí, VD chọn qua
// trình duyệt iPhone) → không đoán được thì chọn "ghim ở tâm KCN" hoặc bỏ ảnh đó. Thông tin công ty / lương sửa sau ở từng ảnh.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, ImagePlus, Loader2, MapPin, X } from 'lucide-react';
import { readFileExif } from '../../../lib/kcnSurvey/exif';
import { isValidVnLatLng, type LatLng } from '../../../lib/geo';
import { loadTracks, uploadPhoto, type SurveyPhoto, type SurveyTrip } from '../../../lib/kcnSurvey/api';
import { distToTrack, exifTimeMs, positionAtTime } from '../../../lib/kcnSurvey/planStops';
import { fmtDistance, type TrackSegment } from '../../../lib/kcnSurvey/track';

type Where = { lat: number; lng: number; src: 'exif' | 'track' | 'manual'; note: string };
interface Pic {
  key: string;
  file: File;
  url: string;
  /** đang đọc EXIF */
  reading: boolean;
  takenMs: number | null;
  /** giờ lấy từ đâu: EXIF / ngày sửa file */
  timeSrc: 'exif' | 'file' | null;
  where: Where | null;
  /** cách vết của chuyến (m) — ảnh có GPS mà chụp xa chuyến */
  farM: number | null;
  company: string;
}

const lab = 'block text-[11px] font-medium text-[#666] mb-1';
const MAX = 40;
const fmtTime = (ms: number) => new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
/** Chưa chạy migration 223 thì DB chưa nhận 'track' → lưu 'manual' như cũ */
let trackSourceOk = true;

export default function TripPhotoImportDialog({ trip, zoneCenter, user, onClose, onSaved, say }: {
  trip: SurveyTrip;
  /** Tâm KCN của chuyến — ghim ảnh không đoán được vị trí */
  zoneCenter: LatLng | null;
  user: { id: string; full_name: string } | null;
  onClose: () => void;
  onSaved: (photos: SurveyPhoto[]) => void;
  say: (m: string) => void;
}) {
  const [pics, setPics] = useState<Pic[]>([]);
  const [segs, setSegs] = useState<TrackSegment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const segsRef = useRef<TrackSegment[] | null>(null);
  segsRef.current = segs;
  const tripStart = new Date(trip.started_at).getTime();
  const tripEnd = trip.ended_at ? new Date(trip.ended_at).getTime() : null;

  useEffect(() => {
    let alive = true;
    loadTracks([trip.id]).then(m => { if (alive) setSegs(m.get(trip.id) ?? []); }).catch(() => { if (alive) setSegs([]); });
    return () => { alive = false; };
  }, [trip.id]);

  /** Vị trí 1 ảnh từ EXIF GPS / giờ chụp trên vết */
  const locate = useCallback((gps: LatLng | null, takenMs: number | null, timeSrc: Pic['timeSrc'], track: TrackSegment[] | null): Pick<Pic, 'where' | 'farM'> => {
    if (gps) {
      const farM = track?.length ? Math.round(distToTrack(gps, track)) : null;
      return { where: { ...gps, src: 'exif', note: 'Vị trí lưu trong ảnh' }, farM };
    }
    if (takenMs != null && track?.length) {
      const hit = positionAtTime(track, tripStart, takenMs);
      if (hit) {
        const lag = hit.gapS > 60 ? ` (lệch ${Math.round(hit.gapS / 60)} phút)` : '';
        return { where: { lat: hit.lat, lng: hit.lng, src: 'track', note: `Theo giờ chụp${timeSrc === 'file' ? ' (giờ lưu file)' : ''} trên đường đã đi${lag}` }, farM: null };
      }
    }
    return { where: null, farM: null };
  }, [tripStart]);

  const addFiles = useCallback((list: FileList | File[] | null) => {
    const files = [...(list ?? [])].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    if (!files.length) return;
    const fresh: Pic[] = files.map(f => ({
      key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, file: f, url: URL.createObjectURL(f),
      reading: true, takenMs: null, timeSrc: null, where: null, farM: null, company: '',
    }));
    setPics(p => [...p, ...fresh].slice(0, MAX));
    fresh.forEach(pic => void readFileExif(pic.file).catch(() => null).then(x => {
      const gps = x?.lat != null && x.lng != null && isValidVnLatLng({ lat: x.lat, lng: x.lng }) ? { lat: x.lat, lng: x.lng } : null;
      let takenMs = exifTimeMs(x?.takenAt);
      let timeSrc: Pic['timeSrc'] = takenMs != null ? 'exif' : null;
      // Không có giờ chụp: dùng giờ lưu file nếu rơi đúng khung giờ chuyến (± 15 phút)
      if (takenMs == null && pic.file.lastModified) {
        const lm = pic.file.lastModified;
        if (lm >= tripStart - 15 * 60_000 && lm <= (tripEnd ?? tripStart + 12 * 3600_000) + 15 * 60_000) { takenMs = lm; timeSrc = 'file'; }
      }
      setPics(list => list.map(i => (i.key === pic.key ? { ...i, reading: false, takenMs, timeSrc, ...locate(gps, takenMs, timeSrc, segsRef.current) } : i)));
    }));
  }, [locate, tripStart, tripEnd]);

  // Vết tải xong sau khi đã chọn ảnh → tính lại vị trí theo giờ cho ảnh chưa có GPS
  useEffect(() => {
    if (!segs) return;
    setPics(list => list.map(p => (p.reading || p.where?.src === 'exif' || p.where?.src === 'manual' ? p : { ...p, ...locate(null, p.takenMs, p.timeSrc, segs) })));
  }, [segs, locate]);

  const removePic = (key: string) => setPics(p => { const x = p.find(i => i.key === key); if (x) URL.revokeObjectURL(x.url); return p.filter(i => i.key !== key); });
  const picsRef = useRef(pics);
  picsRef.current = pics;
  useEffect(() => () => picsRef.current.forEach(p => URL.revokeObjectURL(p.url)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const passedNames = useMemo(() => [...new Set(trip.passed.map(p => p.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [trip.passed]);
  const noPos = pics.filter(p => !p.reading && !p.where);
  const reading = pics.some(p => p.reading) || segs === null;
  const pinNoPosToCenter = () => {
    if (!zoneCenter) return;
    setPics(list => list.map(p => (!p.reading && !p.where ? { ...p, where: { ...zoneCenter, src: 'manual', note: 'Ghim ở tâm KCN (không rõ chỗ chụp)' } } : p)));
  };

  const save = async () => {
    const ready = pics.filter(p => p.where);
    if (!ready.length) { setErr('Chưa có ảnh nào có vị trí để lưu'); return; }
    if (noPos.length && !window.confirm(`${noPos.length} ảnh chưa có vị trí sẽ KHÔNG được lưu (bấm “Ghim ở tâm KCN” nếu muốn giữ). Lưu ${ready.length} ảnh còn lại?`)) return;
    setErr(null);
    const saved: SurveyPhoto[] = [];
    const doneKeys: string[] = [];
    try {
      for (let i = 0; i < ready.length; i++) {
        const p = ready[i], w = p.where!;
        setBusy(`Đang lưu ảnh ${i + 1}/${ready.length}…`);
        const meta = (src: 'gps' | 'exif' | 'manual' | 'track') => ({
          trip_id: trip.id, zone_id: trip.zone_id, zone_name: trip.zone_name,
          lat: w.lat, lng: w.lng, accuracy_m: null, position_source: src,
          taken_at: new Date(p.takenMs ?? tripStart).toISOString(),
          company_name: p.company.trim(), client_id: null, lead_id: null, crm_id: null,
          positions: '', headcount: null, wage_text: '', note: '', annotations: [],
          user_id: user?.id ?? null, user_name: user?.full_name ?? '',
        });
        const id = crypto.randomUUID();
        let row: SurveyPhoto;
        if (w.src === 'track' && trackSourceOk) {
          try { row = await uploadPhoto(id, p.file, meta('track')); }
          catch (e) {
            if (!/position_source|check constraint|23514/i.test((e as Error).message)) throw e;
            trackSourceOk = false; // chưa chạy 223
            row = await uploadPhoto(id, p.file, meta('manual'));
          }
        } else row = await uploadPhoto(id, p.file, meta(w.src === 'track' ? 'manual' : w.src));
        saved.push(row);
        doneKeys.push(p.key);
      }
      onSaved(saved);
      say(`Đã bổ sung ${saved.length} ảnh vào chuyến${trip.title ? ` “${trip.title}”` : ''}`);
      onClose();
    } catch (e) {
      if (saved.length) onSaved(saved);
      setPics(list => list.filter(p => !doneKeys.includes(p.key)));
      setErr(`${(e as Error).message}${saved.length ? ` (đã lưu ${saved.length} ảnh — bấm Lưu lại cho ảnh còn lại)` : ''}`);
    }
    setBusy(null);
  };

  const exifN = pics.filter(p => p.where?.src === 'exif').length;
  const trackN = pics.filter(p => p.where?.src === 'track').length;

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px] flex items-end md:items-center justify-center md:p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-white w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] max-h-[92dvh] flex flex-col text-[#111]">
        <div className="flex items-start justify-between px-5 pt-4 pb-2">
          <div className="min-w-0">
            <div className="text-[17px] font-semibold tracking-tight">Bổ sung ảnh vào chuyến</div>
            <div className="text-[12px] text-[#888] mt-0.5 truncate">{trip.title || trip.zone_name || 'Chuyến khảo sát'} · {new Date(trip.started_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
          </div>
          <button onClick={onClose} disabled={!!busy} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-[#666] hover:bg-[#F3F3F0] disabled:opacity-40" aria-label="Đóng"><X size={17} /></button>
        </div>

        <div className="p-5 pt-2 space-y-3 overflow-y-auto">
          <div className="text-[12px] text-[#666] leading-snug">
            Chọn ảnh đã chụp sẵn trong máy — app ghim đúng chỗ chụp theo <b>vị trí lưu trong ảnh</b>, ảnh không có vị trí thì theo <b>giờ chụp</b> khớp với đường đã đi của chuyến này.
            Thông tin công ty / vị trí tuyển / lương sửa sau ở từng ảnh (tab Ảnh chỉ tiêu).
          </div>

          <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
            className={`rounded-xl border-2 border-dashed p-3 transition ${drag ? 'border-[#0A84FF] bg-blue-50' : 'border-[#D8D6D0] bg-[#FAFAF8]'}`}>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy || pics.length >= MAX}
              className="w-full h-11 rounded-lg bg-white border border-[#E8E7E2] text-[13.5px] font-medium text-[#333] inline-flex items-center justify-center gap-1.5 hover:bg-[#F9F9F7] disabled:opacity-50">
              <ImagePlus size={16} /> {pics.length ? `Chọn thêm ảnh (${pics.length}/${MAX})` : 'Chọn ảnh từ máy (chọn nhiều được)'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {pics.length > 0 && (
            <div className="text-[11.5px] text-[#555] flex flex-wrap gap-x-3 gap-y-0.5">
              {reading && <span className="inline-flex items-center gap-1 text-[#888]"><Loader2 size={11} className="animate-spin" /> Đang đọc vị trí / giờ chụp…</span>}
              {exifN > 0 && <span className="text-[#137333]">📍 {exifN} ảnh có vị trí trong ảnh</span>}
              {trackN > 0 && <span className="text-[#0A5FCC]">⏱ {trackN} ảnh ghim theo giờ chụp</span>}
              {noPos.length > 0 && <span className="text-[#b25e00]">⚠ {noPos.length} ảnh chưa rõ vị trí</span>}
            </div>
          )}
          {noPos.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[12px] px-3 py-2 leading-snug flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                {noPos.length} ảnh không có vị trí và giờ chụp không nằm trong lúc đi chuyến này{segs && !segs.length ? ' (chuyến không có vết GPS)' : ''}.
                {zoneCenter && <> <button onClick={pinNoPosToCenter} className="font-semibold text-[#0A84FF]">Ghim ở tâm KCN</button> (sửa lại vị trí sau trong ảnh) hoặc bỏ các ảnh đó.</>}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {pics.map(p => (
              <div key={p.key} className="flex items-start gap-2.5 rounded-xl border border-[#EFEEE9] p-2">
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-[#eee] shrink-0">
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-[11.5px] leading-snug">
                    {p.reading ? <span className="text-[#888]">Đang đọc…</span>
                      : p.where ? (
                        <span className={p.where.src === 'exif' ? 'text-[#137333]' : p.where.src === 'track' ? 'text-[#0A5FCC]' : 'text-[#b25e00]'}>
                          {p.where.src === 'track' ? <Clock size={11} className="inline -mt-0.5 mr-0.5" /> : <MapPin size={11} className="inline -mt-0.5 mr-0.5" />}{p.where.note}
                        </span>
                      ) : <span className="text-[#b25e00]">⚠ Chưa rõ vị trí</span>}
                    {p.takenMs != null && <span className="text-[#999]"> · chụp {fmtTime(p.takenMs)}</span>}
                    {p.farM != null && p.farM > 1500 && <span className="text-[#d97706] font-medium"> · cách đường đi {fmtDistance(p.farM)}</span>}
                  </div>
                  <input value={p.company} onChange={e => setPics(list => list.map(x => (x.key === p.key ? { ...x, company: e.target.value } : x)))}
                    list="trip-import-companies" placeholder="Công ty (không bắt buộc)" maxLength={200}
                    className="w-full h-8 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] outline-none focus:border-[#0A84FF]" />
                </div>
                <button onClick={() => removePic(p.key)} disabled={!!busy} className="w-7 h-7 rounded-full text-[#888] hover:bg-[#F3F3F0] flex items-center justify-center shrink-0" aria-label="Bỏ ảnh"><X size={14} /></button>
              </div>
            ))}
          </div>
          <datalist id="trip-import-companies">{passedNames.map(n => <option key={n} value={n} />)}</datalist>

          {err && <div className="text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-lg px-3 py-2">{err}</div>}
          {pics.length > 0 && (
            <div>
              <span className={lab}>{passedNames.length ? `Gợi ý tên công ty: ${passedNames.length} công ty đã đi ngang trong chuyến này` : ''}</span>
              <button onClick={() => void save()} disabled={!!busy || reading || !pics.some(p => p.where)}
                className="w-full h-11 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition">
                {busy ? <><Loader2 size={15} className="animate-spin" /> {busy}</> : `Lưu ${pics.filter(p => p.where).length} ảnh vào chuyến`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
