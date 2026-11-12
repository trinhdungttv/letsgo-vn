// Xem 1 ảnh chỉ tiêu (dùng ở Lịch sử khảo sát và tab Khảo sát KCN): ảnh + lớp ghi chú vẽ, thông tin bảng tuyển,
// chỗ chụp, sửa nội dung / vẽ thêm ghi chú lên ảnh / xoá mềm.
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, ChevronLeft, ChevronRight, ExternalLink, MapPin, PenLine, Pencil, Star, Trash2, X } from 'lucide-react';
import { softDeletePhoto, updatePhoto, type SurveyPhoto } from '../../../lib/kcnSurvey/api';
import type { PhotoMark } from '../../../lib/kcnSurvey/markup';
import { MarkedImage, MarksSvg } from './PhotoMarks';
import PhotoMarkupEditor from './PhotoMarkupEditor';
import { HEADCOUNT_BUCKETS, UNVERIFIED_TAG, headcountText } from '../../../lib/kcnSurvey/online';
import { fmtDateTime } from './surveyFormat';
import PositionPicker, { WagePicker } from './PositionPicker';

const POS_SOURCE: Record<SurveyPhoto['position_source'], string> = { gps: 'GPS lúc chụp', exif: 'Vị trí lưu trong ảnh', manual: 'Chọn trên bản đồ', track: 'Theo giờ chụp trên đường đã đi' };
const posText = (p: SurveyPhoto) => (p.survey_kind === 'online' ? 'Vị trí từ link Google Maps (khảo sát online)' : POS_SOURCE[p.position_source]);

/** Ô ảnh nhỏ trong lưới (cắt vuông) + lớp ghi chú cắt cùng kiểu. */
export function PhotoThumb({ photo, className = '' }: { photo: SurveyPhoto; className?: string }) {
  const aspect = photo.width && photo.height ? photo.height / photo.width : null;
  return (
    <>
      <img src={photo.thumb_url || photo.url} alt={photo.company_name} loading="lazy" className={`absolute inset-0 w-full h-full object-cover ${className}`} />
      {aspect && photo.annotations.length > 0 && (
        <MarksSvg marks={photo.annotations} aspect={aspect} fit="cover" className="absolute inset-0 w-full h-full pointer-events-none" />
      )}
      {photo.survey_kind === 'online' && (
        <span className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none shadow ${photo.verified_at ? 'bg-[#34C759] text-white' : 'bg-[#FF9F0A] text-white'}`}>
          {photo.verified_at ? 'Online ✓' : UNVERIFIED_TAG}
        </span>
      )}
      {photo.annotations.length > 0 && (
        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center" title="Có ghi chú trên ảnh"><PenLine size={11} /></span>
      )}
    </>
  );
}

export default function SurveyPhotoViewer({ photo, onClose, onShowOnMap, onSaved, onDeleted, say, starred, onStar, nav }: {
  /** Chuyển ảnh trước / sau trong danh sách đang xem (phím ← →) */
  nav?: { index: number; total: number; onPrev: (() => void) | null; onNext: (() => void) | null };
  photo: SurveyPhoto;
  onClose: () => void;
  /** null = không có nút "Xem chỗ chụp" (đã có bản đồ ngay cạnh) */
  onShowOnMap: (() => void) | null;
  onSaved: (p: SurveyPhoto) => void;
  onDeleted: (id: string) => void;
  say: (m: string) => void;
  /** Công ty của ảnh đã gắn sao (cần chú trọng) — không truyền onStar thì không có nút sao */
  starred?: boolean;
  onStar?: (p: SurveyPhoto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [form, setForm] = useState({ company_name: photo.company_name, positions: photo.positions, headcount: photo.headcount?.toString() ?? '', wage_text: photo.wage_text, note: photo.note });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({ company_name: photo.company_name, positions: photo.positions, headcount: photo.headcount?.toString() ?? '', wage_text: photo.wage_text, note: photo.note });
    setEditing(false);
  }, [photo]);

  // Phím tắt: Esc đóng (đang sửa thì thoát sửa trước) · ← → chuyển ảnh (không khi đang gõ / vẽ ghi chú)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = e => {
    if (marking) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? '');
    if (e.key === 'Escape') { e.preventDefault(); if (editing) setEditing(false); else onClose(); }
    else if (!editing && !typing && e.key === 'ArrowLeft' && nav?.onPrev) { e.preventDefault(); nav.onPrev(); }
    else if (!editing && !typing && e.key === 'ArrowRight' && nav?.onNext) { e.preventDefault(); nav.onNext(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const patch = {
        company_name: form.company_name.trim(), positions: form.positions.trim(), wage_text: form.wage_text.trim(), note: form.note.trim(),
        headcount: form.headcount.trim() ? Math.max(0, parseInt(form.headcount, 10) || 0) : null,
      };
      await updatePhoto(photo.id, patch);
      onSaved({ ...photo, ...patch });
      setEditing(false);
      say('Đã lưu');
    } catch (e) { say((e as Error).message); } finally { setSaving(false); }
  };
  const saveMarks = async (marks: PhotoMark[]) => {
    setMarking(false);
    try {
      await updatePhoto(photo.id, { annotations: marks });
      onSaved({ ...photo, annotations: marks });
      say(marks.length ? 'Đã lưu ghi chú trên ảnh' : 'Đã xoá ghi chú trên ảnh');
    } catch (e) { say((e as Error).message); }
  };
  const toggleVerified = async () => {
    const verified_at = photo.verified_at ? null : new Date().toISOString();
    try {
      await updatePhoto(photo.id, { verified_at });
      onSaved({ ...photo, verified_at });
      say(verified_at ? 'Đã đánh dấu đã xác thực' : `Đã đặt lại “${UNVERIFIED_TAG}”`);
    } catch (e) { say((e as Error).message); }
  };
  const del = async () => {
    if (!window.confirm('Xoá ảnh chỉ tiêu này?\n\nẢnh chuyển vào Lưu trữ (tab Khảo sát KCN → Lưu trữ) 30 ngày — khôi phục được trong thời gian đó, quá 30 ngày mới tự xoá hẳn.')) return;
    try { await softDeletePhoto(photo.id); onDeleted(photo.id); say('Đã chuyển ảnh vào Lưu trữ (30 ngày)'); } catch (e) { say((e as Error).message); }
  };
  const gmaps = `https://www.google.com/maps?q=${photo.lat},${photo.lng}`;
  const field = 'w-full h-10 px-3 rounded-xl bg-white/10 text-[14px] text-white outline-none placeholder:text-white/40';

  return (
    <div className="fixed inset-0 z-[1350] bg-black flex flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between h-12 px-2 shrink-0">
        <button onClick={onClose} className="h-10 px-3 text-[16px] text-white inline-flex items-center gap-1"><X size={18} /> Đóng</button>
        <a href={photo.url} target="_blank" rel="noopener noreferrer" className="h-10 px-3 text-[14px] text-white/80 inline-flex items-center gap-1"><ExternalLink size={15} /> Ảnh gốc</a>
      </div>
      <div className="relative flex-1 min-h-0 w-full flex">
        <MarkedImage src={photo.url} alt={photo.company_name} marks={photo.annotations} className="flex-1 min-h-0 w-full" />
        {nav?.onPrev && <button onClick={nav.onPrev} aria-label="Ảnh trước (←)" className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center"><ChevronLeft size={24} /></button>}
        {nav?.onNext && <button onClick={nav.onNext} aria-label="Ảnh sau (→)" className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center"><ChevronRight size={24} /></button>}
        {nav && nav.total > 1 && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-black/55 text-white text-[12px] tabular-nums">{nav.index + 1} / {nav.total}</div>}
      </div>
      <div className="shrink-0 bg-[#1C1C1E] text-white px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] space-y-2 max-h-[48vh] overflow-y-auto">
        {!editing ? (
          <>
            <div className="text-[16px] font-semibold leading-snug flex items-start gap-1.5">
              {starred && <Star size={16} className="mt-0.5 shrink-0 text-[#FFD60A]" fill="#FFD60A" aria-label="Đã gắn sao" />}
              <span className="min-w-0">{photo.company_name || 'Chưa rõ công ty'}</span>
            </div>
            {photo.survey_kind === 'online' && (
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${photo.verified_at ? 'bg-[#34C759]/25 text-[#7BE495]' : 'bg-[#FF9F0A]/25 text-[#FFC266]'}`}>
                {photo.verified_at ? `Khảo sát online · đã xác thực ${fmtDateTime(photo.verified_at)}` : `Khảo sát online · ${UNVERIFIED_TAG} (không đi thực địa)`}
              </div>
            )}
            <div className="text-[12.5px] text-white/70">
              {fmtDateTime(photo.taken_at)}{photo.zone_name ? ` · ${photo.zone_name}` : ''}{photo.user_name ? ` · ${photo.user_name}` : ''}
            </div>
            {(photo.positions || photo.headcount != null || photo.wage_text) && (
              <div className="text-[13.5px] leading-snug">
                {photo.positions && <div>Tuyển: <b>{photo.positions}</b></div>}
                {photo.headcount != null && <div>Số lượng: <b>{headcountText(photo)}</b></div>}
                {photo.wage_text && <div>Lương: <b>{photo.wage_text}</b></div>}
              </div>
            )}
            {photo.note && <div className="text-[13px] text-white/85 whitespace-pre-line">{photo.note}</div>}
            <div className="text-[11.5px] text-white/55">
              📍 {photo.lat.toFixed(5)}, {photo.lng.toFixed(5)} · {posText(photo)}{photo.accuracy_m != null ? ` ±${Math.round(photo.accuracy_m)} m` : ''}
            </div>
            <div className="flex gap-1.5 flex-wrap pt-1">
              {onShowOnMap && <button onClick={onShowOnMap} className="h-9 px-3 rounded-full bg-[#0A84FF] text-[12.5px] font-semibold inline-flex items-center gap-1"><MapPin size={13} /> Xem chỗ chụp</button>}
              <a href={gmaps} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-full bg-white/15 text-[12.5px] font-medium inline-flex items-center gap-1"><ExternalLink size={13} /> Google Maps</a>
              <button onClick={() => setMarking(true)} className="h-9 px-3 rounded-full bg-white/15 text-[12.5px] font-medium inline-flex items-center gap-1">
                <PenLine size={13} /> {photo.annotations.length ? 'Sửa ghi chú trên ảnh' : 'Ghi chú lên ảnh'}
              </button>
              {onStar && (photo.company_name.trim() || photo.client_id || photo.crm_id || photo.lead_id) && (
                <button onClick={() => onStar(photo)} className={`h-9 px-3 rounded-full text-[12.5px] font-medium inline-flex items-center gap-1 ${starred ? 'bg-[#FFD60A] text-[#1D1D1F]' : 'bg-white/15'}`}>
                  <Star size={13} fill={starred ? 'currentColor' : 'none'} /> {starred ? 'Bỏ sao' : 'Gắn sao công ty'}
                </button>
              )}
              {photo.survey_kind === 'online' && (
                <button onClick={() => void toggleVerified()} className={`h-9 px-3 rounded-full text-[12.5px] font-medium inline-flex items-center gap-1 ${photo.verified_at ? 'bg-white/15' : 'bg-[#34C759] text-white'}`}>
                  <BadgeCheck size={13} /> {photo.verified_at ? 'Bỏ xác thực' : 'Đánh dấu đã xác thực'}
                </button>
              )}
              <button onClick={() => setEditing(true)} className="h-9 px-3 rounded-full bg-white/15 text-[12.5px] font-medium inline-flex items-center gap-1"><Pencil size={13} /> Ghi nhanh / Sửa</button>
              <button onClick={del} className="h-9 px-3 rounded-full bg-[#D70015]/80 text-[12.5px] font-medium inline-flex items-center gap-1"><Trash2 size={13} /> Xoá</button>
            </div>
          </>
        ) : (
          <>
            <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Tên công ty" className={field} />
            <PositionPicker dark value={form.positions} onChange={v => setForm(f => ({ ...f, positions: v }))} />
            <div className="grid grid-cols-2 gap-2">
              {photo.survey_kind === 'online'
                ? <select value={form.headcount} onChange={e => setForm(f => ({ ...f, headcount: e.target.value }))} className={field}>
                    <option value="">Số lượng — chưa rõ</option>
                    {HEADCOUNT_BUCKETS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                : <input value={form.headcount} onChange={e => setForm(f => ({ ...f, headcount: e.target.value.replace(/[^\d]/g, '') }))} inputMode="numeric" placeholder="Số lượng" className={field} />}
              </div>
            <div>
              <div className="text-[11.5px] text-white/60 mb-1">Khoảng lương lao động nhận được</div>
              <WagePicker dark value={form.wage_text} onChange={w => setForm(f => ({ ...f, wage_text: w }))} />
            </div>
            <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} placeholder="Ghi chú"
              className="w-full px-3 py-2 rounded-xl bg-white/10 text-[14px] text-white outline-none placeholder:text-white/40 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="flex-1 h-10 rounded-full bg-white/15 text-[14px]">Huỷ</button>
              <button onClick={save} disabled={saving} className="flex-1 h-10 rounded-full bg-[#0A84FF] text-[14px] font-semibold disabled:opacity-50">{saving ? 'Đang lưu…' : 'Lưu'}</button>
            </div>
          </>
        )}
      </div>
      {marking && <PhotoMarkupEditor src={photo.url} initial={photo.annotations} onCancel={() => setMarking(false)} onDone={m => void saveMarks(m)} />}
    </div>
  );
}
