// Thêm ảnh khảo sát ONLINE: ảnh tuyển dụng lấy trên mạng (chọn file / kéo thả / dán Ctrl+V) + vị trí công ty lấy từ link Google Maps.
// Không đi thực địa → không có chuyến, không có đường vết đi qua; ảnh được gắn loại 'online' + tag "Chưa xác thực"
// cho tới khi có người đánh dấu đã xác thực (migration 210).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import MapLinkHint from '../../../components/MapLinkHint';
import { parsePosition } from '../../../lib/kcnSurvey/online';
import { uploadPhoto, type SurveyPhoto } from '../../../lib/kcnSurvey/api';
import type { MarketLead, MarketZone } from '../../../lib/types';
import { fold } from './surveyData';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const lab = 'block text-[11px] font-medium text-[#666] mb-1';
const inp = 'w-full h-10 px-3 rounded-lg border border-[#E8E7E2] text-[13px] outline-none focus:border-[#0A84FF] bg-white';

interface Pic { key: string; file: File; url: string }

export default function OnlinePhotoDialog({ zones, leads, user, defaultZoneId, onClose, onSaved, say }: {
  zones: readonly MarketZone[];
  leads: readonly MarketLead[];
  user: { id: string; full_name: string } | null;
  defaultZoneId: string | null;
  onClose: () => void;
  onSaved: (photos: SurveyPhoto[]) => void;
  say: (m: string) => void;
}) {
  const [pics, setPics] = useState<Pic[]>([]);
  const [zoneId, setZoneId] = useState(defaultZoneId ?? '');
  const [company, setCompany] = useState('');
  const [mapLink, setMapLink] = useState('');
  const [source, setSource] = useState('');
  const [positions, setPositions] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [wage, setWage] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | File[] | null) => {
    const files = [...(list ?? [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    setPics(p => [...p, ...files.map(f => ({ key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, file: f, url: URL.createObjectURL(f) }))].slice(0, 12));
  }, []);
  const removePic = (key: string) => setPics(p => { const x = p.find(i => i.key === key); if (x) URL.revokeObjectURL(x.url); return p.filter(i => i.key !== key); });
  const picsRef = useRef(pics);
  picsRef.current = pics;
  useEffect(() => () => picsRef.current.forEach(p => URL.revokeObjectURL(p.url)), []);

  // Dán ảnh (Ctrl+V / ⌘V) — copy ảnh trên web rồi dán thẳng vào đây
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); addFiles(files); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('paste', onPaste); window.removeEventListener('keydown', onKey); };
  }, [addFiles, onClose, busy]);

  const pos = useMemo(() => parsePosition(mapLink), [mapLink]);
  const zone = zones.find(z => z.id === zoneId) ?? null;
  const sortedZones = useMemo(() => [...zones].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [zones]);
  const leadNames = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const l of leads) { const n = l.company_name?.trim(); if (n && !seen.has(fold(n))) { seen.add(fold(n)); out.push(n); } }
    return out.sort((a, b) => a.localeCompare(b, 'vi')).slice(0, 800);
  }, [leads]);

  const save = async () => {
    if (!pics.length) { setErr('Chọn, kéo thả hoặc dán ít nhất 1 ảnh'); return; }
    if (!company.trim()) { setErr('Nhập tên công ty'); return; }
    if (!pos) { setErr('Dán link Google Maps của công ty (link dài có toạ độ) hoặc gõ "vĩ độ, kinh độ"'); return; }
    setErr(null);
    const lead = leads.find(l => fold(l.company_name ?? '') === fold(company.trim())) ?? null;
    const takenAt = new Date(`${day || today()}T09:00:00`).toISOString();
    const noteText = [source.trim() && `Nguồn: ${source.trim()}`, note.trim()].filter(Boolean).join('\n');
    const saved: SurveyPhoto[] = [];
    try {
      for (let i = 0; i < pics.length; i++) {
        setBusy(`Đang lưu ảnh ${i + 1}/${pics.length}…`);
        saved.push(await uploadPhoto(crypto.randomUUID(), pics[i].file, {
          trip_id: null, zone_id: zone?.id ?? null, zone_name: zone?.name ?? '',
          lat: pos.lat, lng: pos.lng, accuracy_m: null, position_source: 'manual', taken_at: takenAt,
          company_name: company.trim(), client_id: null, lead_id: lead?.id ?? null, crm_id: null,
          positions: positions.trim(), headcount: headcount.trim() ? Math.max(0, parseInt(headcount, 10) || 0) : null,
          wage_text: wage.trim(), note: noteText, annotations: [],
          user_id: user?.id ?? null, user_name: user?.full_name ?? '', survey_kind: 'online',
        }));
      }
      onSaved(saved);
      say(`Đã thêm ${saved.length} ảnh khảo sát online — tag “Chưa xác thực”`);
      onClose();
    } catch (e) {
      if (saved.length) onSaved(saved);
      setErr(`${(e as Error).message}${saved.length ? ` (đã lưu ${saved.length}/${pics.length} ảnh — ảnh còn lại bấm Lưu lại)` : ''}`);
      if (saved.length) setPics(p => p.slice(saved.length));
    }
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px] flex items-end md:items-center justify-center md:p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-white w-full md:max-w-xl rounded-t-2xl md:rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] max-h-[92vh] flex flex-col text-[#111]">
        <div className="flex items-start justify-between px-5 pt-4 pb-2">
          <div>
            <div className="text-[17px] font-semibold tracking-tight">Thêm ảnh khảo sát online</div>
            <div className="text-[12px] text-[#888] mt-0.5">Ảnh tuyển dụng trên mạng + vị trí Google Maps của công ty — không cần đi thực địa</div>
          </div>
          <button onClick={onClose} disabled={!!busy} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-[#666] hover:bg-[#F3F3F0] disabled:opacity-40" aria-label="Đóng"><X size={17} /></button>
        </div>

        <div className="p-5 pt-2 space-y-3.5 overflow-y-auto">
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2 leading-snug">
            Ảnh thêm ở đây có tag <b>Chưa xác thực</b> và không có đường vết đã đi. Sau khi tới tận nơi kiểm tra, mở ảnh → “Đánh dấu đã xác thực”.
          </div>

          <div>
            <span className={lab}>Ảnh tuyển dụng (tối đa 12) · chọn file, kéo thả hoặc dán Ctrl+V</span>
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              className={`rounded-xl border-2 border-dashed p-3 transition ${drag ? 'border-[#0A84FF] bg-blue-50' : 'border-[#D8D6D0] bg-[#FAFAF8]'}`}>
              {pics.length > 0 && (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-2.5">
                  {pics.map(p => (
                    <div key={p.key} className="relative aspect-square rounded-lg overflow-hidden bg-[#eee]">
                      <img src={p.url} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => removePic(p.key)} disabled={!!busy} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Bỏ ảnh"><X size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full h-10 rounded-lg bg-white border border-[#E8E7E2] text-[13px] font-medium text-[#333] inline-flex items-center justify-center gap-1.5 hover:bg-[#F9F9F7]">
                <ImagePlus size={15} /> {pics.length ? 'Thêm ảnh' : 'Chọn ảnh từ máy'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className={lab}>KCN</span>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)} className={inp}>
                <option value="">Không gắn KCN</option>
                {sortedZones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={lab}>Ngày đăng tin</span>
              <input type="date" value={day} max={today()} onChange={e => setDay(e.target.value)} className={inp} />
            </label>
          </div>

          <label className="block">
            <span className={lab}>Công ty</span>
            <input value={company} onChange={e => setCompany(e.target.value)} list="online-photo-leads" placeholder="Tên công ty đăng tuyển" className={inp} />
            <datalist id="online-photo-leads">{leadNames.map(n => <option key={n} value={n} />)}</datalist>
          </label>

          <label className="block">
            <span className={lab}>Vị trí công ty — link Google Maps</span>
            <input value={mapLink} onChange={e => setMapLink(e.target.value)} placeholder="Dán link Google Maps (dài, có …@10.9,106.8…) hoặc gõ 10.9482, 106.8431" className={inp} />
            {pos ? <div className="text-[11px] text-emerald-600 mt-0.5">✓ Đọc được toạ độ {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</div> : <MapLinkHint value={mapLink} className="mt-0.5" />}
          </label>

          <label className="block">
            <span className={lab}>Link bài đăng tuyển dụng <span className="text-[#aaa]">· nguồn, không bắt buộc</span></span>
            <input value={source} onChange={e => setSource(e.target.value)} placeholder="https://… (Facebook, website công ty, trang việc làm)" className={inp} />
          </label>

          <div className="space-y-2.5">
            <input value={positions} onChange={e => setPositions(e.target.value)} placeholder="Vị trí tuyển — VD: Công nhân may, QC, kho" className={inp} />
            <div className="grid grid-cols-2 gap-2">
              <input value={headcount} onChange={e => setHeadcount(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="Số lượng" className={inp} />
              <input value={wage} onChange={e => setWage(e.target.value)} placeholder="Lương — VD: 8–10tr" className={inp} />
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Ghi chú"
              className="w-full px-3 py-2 rounded-lg border border-[#E8E7E2] text-[13px] outline-none focus:border-[#0A84FF] resize-none" />
          </div>

          {err && <div className="text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-lg px-3 py-2">{err}</div>}
          <button onClick={save} disabled={!!busy}
            className="w-full h-11 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition">
            {busy ? <><Loader2 size={15} className="animate-spin" /> {busy}</> : `Lưu ${pics.length > 1 ? `${pics.length} ảnh` : 'ảnh'} (Chưa xác thực)`}
          </button>
        </div>
      </div>
    </div>
  );
}
