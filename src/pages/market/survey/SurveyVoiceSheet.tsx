// Nghe lại 1 bản ghi âm khảo sát: phát, chỗ ghi, công ty gần đó, ghi chú (gõ lại ý chính), tải file, xoá mềm.
import { useEffect, useState } from 'react';
import { Download, ExternalLink, MapPin, Mic, Trash2, X } from 'lucide-react';
import { softDeleteVoiceNote, updateVoiceNote, type SurveyVoiceNote } from '../../../lib/kcnSurvey/api';
import { fmtDuration } from '../../../lib/kcnSurvey/track';
import { fmtDateTime } from './surveyFormat';

export default function SurveyVoiceSheet({ note, onClose, onSaved, onDeleted, onShowOnMap, say }: {
  note: SurveyVoiceNote;
  onClose: () => void;
  onSaved: (n: SurveyVoiceNote) => void;
  onDeleted: (id: string) => void;
  onShowOnMap: (() => void) | null;
  say: (m: string) => void;
}) {
  const [text, setText] = useState(note.note);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(note.note); }, [note]);
  const dirty = text.trim() !== note.note;

  const save = async () => {
    setSaving(true);
    try {
      await updateVoiceNote(note.id, { note: text.trim() });
      onSaved({ ...note, note: text.trim() });
      say('Đã lưu ghi chú');
    } catch (e) { say((e as Error).message); } finally { setSaving(false); }
  };
  const del = async () => {
    if (!window.confirm('Xoá bản ghi âm này?\n\nBản ghi chuyển vào Lưu trữ (tab Khảo sát KCN → Lưu trữ) 30 ngày — khôi phục được trong thời gian đó, quá 30 ngày mới tự xoá hẳn.')) return;
    try { await softDeleteVoiceNote(note.id); onDeleted(note.id); say('Đã chuyển bản ghi âm vào Lưu trữ (30 ngày)'); } catch (e) { say((e as Error).message); }
  };
  const ext = note.mime_type.includes('mp4') ? 'm4a' : note.mime_type.includes('ogg') ? 'ogg' : 'webm';

  return (
    <div className="fixed inset-0 z-[1360] flex items-end md:items-center justify-center bg-black/30" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full md:w-[440px] max-h-[85vh] bg-[#F2F2F7] rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
          <span className="w-8 h-8 rounded-full bg-[#FF3B30] text-white flex items-center justify-center shrink-0"><Mic size={16} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-[15.5px] font-semibold text-[#1D1D1F] truncate">{note.company_name || 'Ghi âm khảo sát'}</div>
            <div className="text-[11.5px] text-[#8E8E93] truncate">{fmtDateTime(note.recorded_at)} · {fmtDuration(note.duration_s)}{note.zone_name ? ` · ${note.zone_name}` : ''}{note.user_name ? ` · ${note.user_name}` : ''}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#E5E5EA] flex items-center justify-center text-[#3A3A3C] shrink-0" aria-label="Đóng"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] space-y-3">
          <audio src={note.url} controls preload="metadata" className="w-full" />
          <div>
            <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">Ghi chú (gõ lại ý chính để tìm sau)</div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="VD: cổng sau Changshin đang tuyển 100 CN may, lương 9tr, liên hệ chị Hoa"
              className="w-full px-3 py-2.5 rounded-xl bg-white text-[14px] outline-none border border-black/5 resize-none placeholder:text-[#8E8E93]" />
            {dirty && (
              <button onClick={save} disabled={saving} className="mt-1.5 h-9 px-4 rounded-full bg-[#0A84FF] text-white text-[13px] font-semibold disabled:opacity-50">{saving ? 'Đang lưu…' : 'Lưu ghi chú'}</button>
            )}
          </div>
          <div className="text-[11.5px] text-[#8E8E93]">
            {note.lat != null && note.lng != null ? `📍 ${note.lat.toFixed(5)}, ${note.lng.toFixed(5)}${note.accuracy_m != null ? ` ±${Math.round(note.accuracy_m)} m` : ''} — chỗ bấm ghi âm` : 'Lúc ghi chưa có GPS nên không có vị trí'}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {onShowOnMap && note.lat != null && <button onClick={onShowOnMap} className="h-9 px-3 rounded-full bg-[#0A84FF] text-white text-[12.5px] font-semibold inline-flex items-center gap-1"><MapPin size={13} /> Xem chỗ ghi</button>}
            {note.lat != null && note.lng != null && (
              <a href={`https://www.google.com/maps?q=${note.lat},${note.lng}`} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-full bg-white text-[12.5px] font-medium text-[#1D1D1F] inline-flex items-center gap-1"><ExternalLink size={13} /> Google Maps</a>
            )}
            <a href={note.url} download={`ghi-am-khao-sat-${note.recorded_at.slice(0, 10)}.${ext}`} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-full bg-white text-[12.5px] font-medium text-[#1D1D1F] inline-flex items-center gap-1"><Download size={13} /> Tải file</a>
            <button onClick={del} className="h-9 px-3 rounded-full bg-[#FFECEC] text-[12.5px] font-medium text-[#D70015] inline-flex items-center gap-1"><Trash2 size={13} /> Xoá</button>
          </div>
        </div>
      </div>
    </div>
  );
}
