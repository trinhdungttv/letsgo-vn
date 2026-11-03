// Xem 1 ảnh chỉ tiêu (dùng ở Lịch sử khảo sát và tab Khảo sát KCN): ảnh + lớp ghi chú vẽ, thông tin bảng tuyển,
// chỗ chụp, sửa nội dung / vẽ thêm ghi chú lên ảnh / xoá mềm.
import { useEffect, useState } from 'react';
import { ExternalLink, MapPin, PenLine, Pencil, Trash2, X } from 'lucide-react';
import { softDeletePhoto, updatePhoto, type SurveyPhoto } from '../../../lib/kcnSurvey/api';
import type { PhotoMark } from '../../../lib/kcnSurvey/markup';
import { MarkedImage, MarksSvg } from './PhotoMarks';
import PhotoMarkupEditor from './PhotoMarkupEditor';
import { fmtDateTime } from './surveyFormat';

const POS_SOURCE: Record<SurveyPhoto['position_source'], string> = { gps: 'GPS lúc chụp', exif: 'Vị trí lưu trong ảnh', manual: 'Chọn trên bản đồ' };

/** Ô ảnh nhỏ trong lưới (cắt vuông) + lớp ghi chú cắt cùng kiểu. */
export function PhotoThumb({ photo, className = '' }: { photo: SurveyPhoto; className?: string }) {
  const aspect = photo.width && photo.height ? photo.height / photo.width : null;
  return (
    <>
      <img src={photo.thumb_url || photo.url} alt={photo.company_name} loading="lazy" className={`absolute inset-0 w-full h-full object-cover ${className}`} />
      {aspect && photo.annotations.length > 0 && (
        <MarksSvg marks={photo.annotations} aspect={aspect} fit="cover" className="absolute inset-0 w-full h-full pointer-events-none" />
      )}
      {photo.annotations.length > 0 && (
        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center" title="Có ghi chú trên ảnh"><PenLine size={11} /></span>
      )}
    </>
  );
}

export default function SurveyPhotoViewer({ photo, onClose, onShowOnMap, onSaved, onDeleted, say }: {
  photo: SurveyPhoto;
  onClose: () => void;
  /** null = không có nút "Xem chỗ chụp" (đã có bản đồ ngay cạnh) */
  onShowOnMap: (() => void) | null;
  onSaved: (p: SurveyPhoto) => void;
  onDeleted: (id: string) => void;
  say: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [form, setForm] = useState({ company_name: photo.company_name, positions: photo.positions, headcount: photo.headcount?.toString() ?? '', wage_text: photo.wage_text, note: photo.note });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({ company_name: photo.company_name, positions: photo.positions, headcount: photo.headcount?.toString() ?? '', wage_text: photo.wage_text, note: photo.note });
    setEditing(false);
  }, [photo]);

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
  const del = async () => {
    if (!window.confirm('Xoá ảnh chỉ tiêu này khỏi danh sách?\n\nẢnh sẽ ẩn khỏi lịch sử và bản đồ; file ảnh vẫn được giữ trong kho lưu trữ.')) return;
    try { await softDeletePhoto(photo.id); onDeleted(photo.id); say('Đã xoá ảnh'); } catch (e) { say((e as Error).message); }
  };
  const gmaps = `https://www.google.com/maps?q=${photo.lat},${photo.lng}`;
  const field = 'w-full h-10 px-3 rounded-xl bg-white/10 text-[14px] text-white outline-none placeholder:text-white/40';

  return (
    <div className="fixed inset-0 z-[1350] bg-black flex flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between h-12 px-2 shrink-0">
        <button onClick={onClose} className="h-10 px-3 text-[16px] text-white inline-flex items-center gap-1"><X size={18} /> Đóng</button>
        <a href={photo.url} target="_blank" rel="noopener noreferrer" className="h-10 px-3 text-[14px] text-white/80 inline-flex items-center gap-1"><ExternalLink size={15} /> Ảnh gốc</a>
      </div>
      <MarkedImage src={photo.url} alt={photo.company_name} marks={photo.annotations} className="flex-1 min-h-0 w-full" />
      <div className="shrink-0 bg-[#1C1C1E] text-white px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] space-y-2 max-h-[48vh] overflow-y-auto">
        {!editing ? (
          <>
            <div className="text-[16px] font-semibold leading-snug">{photo.company_name || 'Chưa rõ công ty'}</div>
            <div className="text-[12.5px] text-white/70">
              {fmtDateTime(photo.taken_at)}{photo.zone_name ? ` · ${photo.zone_name}` : ''}{photo.user_name ? ` · ${photo.user_name}` : ''}
            </div>
            {(photo.positions || photo.headcount != null || photo.wage_text) && (
              <div className="text-[13.5px] leading-snug">
                {photo.positions && <div>Tuyển: <b>{photo.positions}</b></div>}
                {photo.headcount != null && <div>Số lượng: <b>{photo.headcount}</b></div>}
                {photo.wage_text && <div>Lương: <b>{photo.wage_text}</b></div>}
              </div>
            )}
            {photo.note && <div className="text-[13px] text-white/85 whitespace-pre-line">{photo.note}</div>}
            <div className="text-[11.5px] text-white/55">
              📍 {photo.lat.toFixed(5)}, {photo.lng.toFixed(5)} · {POS_SOURCE[photo.position_source]}{photo.accuracy_m != null ? ` ±${Math.round(photo.accuracy_m)} m` : ''}
            </div>
            <div className="flex gap-1.5 flex-wrap pt-1">
              {onShowOnMap && <button onClick={onShowOnMap} className="h-9 px-3 rounded-full bg-[#0A84FF] text-[12.5px] font-semibold inline-flex items-center gap-1"><MapPin size={13} /> Xem chỗ chụp</button>}
              <a href={gmaps} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-full bg-white/15 text-[12.5px] font-medium inline-flex items-center gap-1"><ExternalLink size={13} /> Google Maps</a>
              <button onClick={() => setMarking(true)} className="h-9 px-3 rounded-full bg-white/15 text-[12.5px] font-medium inline-flex items-center gap-1">
                <PenLine size={13} /> {photo.annotations.length ? 'Sửa ghi chú trên ảnh' : 'Ghi chú lên ảnh'}
              </button>
              <button onClick={() => setEditing(true)} className="h-9 px-3 rounded-full bg-white/15 text-[12.5px] font-medium inline-flex items-center gap-1"><Pencil size={13} /> Sửa</button>
              <button onClick={del} className="h-9 px-3 rounded-full bg-[#D70015]/80 text-[12.5px] font-medium inline-flex items-center gap-1"><Trash2 size={13} /> Xoá</button>
            </div>
          </>
        ) : (
          <>
            <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Tên công ty" className={field} />
            <input value={form.positions} onChange={e => setForm(f => ({ ...f, positions: e.target.value }))} placeholder="Vị trí tuyển" className={field} />
            <div className="grid grid-cols-2 gap-2">
              <input value={form.headcount} onChange={e => setForm(f => ({ ...f, headcount: e.target.value.replace(/[^\d]/g, '') }))} inputMode="numeric" placeholder="Số lượng" className={field} />
              <input value={form.wage_text} onChange={e => setForm(f => ({ ...f, wage_text: e.target.value }))} placeholder="Lương" className={field} />
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
