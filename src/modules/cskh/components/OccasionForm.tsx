// Form thêm / sửa sự kiện (port PRM OccasionsPage): người liên hệ · tên · loại · ngày /
// tháng / năm (tuỳ chọn) · Âm lịch · "Của người thân?" · Nhắc trước N ngày · ghi chú.
// Âm lịch thì xem trước luôn ngày dương lần tới.
import { useState } from 'react';
import { formatDateVN, isValidDayMonth, todayVN } from '../../../lib/cskh/dates';
import { nextOccurrenceIso } from '../../../lib/cskh/lunar';
import type { CskhContact, CskhOccasion, OccasionType } from '../../../lib/cskh/types';
import { BUSINESS_OCCASION_TITLES, OCCASION_LABEL } from '../../../lib/cskh/types';
import type { OccasionInput } from '../data/api';
import { inputCls } from '../ui';
import { ContactPicker } from './ContactPicker';
import { ChoiceChip, Sheet } from './Sheet';

const TYPES: OccasionType[] = ['birthday', 'anniversary', 'memorial', 'other'];
const TITLE_HINTS = ['Sinh nhật', 'Sinh nhật vợ', 'Sinh nhật con', 'Ngày cưới', 'Giỗ bố', 'Giỗ mẹ', ...BUSINESS_OCCASION_TITLES];
const labelCls = 'block text-[11.5px] font-medium text-[#666] mb-1';

export function OccasionForm({ contacts, existing, initialContactId, onSave, onClose }: {
  contacts: readonly CskhContact[];
  existing: CskhOccasion | null;
  initialContactId?: string;
  /** Trả về câu lỗi hoặc null khi đã lưu. */
  onSave: (input: OccasionInput) => Promise<string | null>;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState(existing?.contactId ?? initialContactId ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [type, setType] = useState<OccasionType>(existing?.occasionType ?? 'birthday');
  const [day, setDay] = useState(existing ? String(existing.day) : '');
  const [month, setMonth] = useState(existing ? String(existing.month) : '');
  const [year, setYear] = useState(existing?.year ? String(existing.year) : '');
  const [isLunar, setIsLunar] = useState(existing?.isLunar ?? false);
  const [related, setRelated] = useState(existing?.relatedPerson ?? '');
  const [remind, setRemind] = useState(String(existing?.remindDaysBefore ?? 7));
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const d = Number(day);
  const m = Number(month);
  const y = year.trim() ? Number(year) : null;
  const dateOk = isLunar ? d >= 1 && d <= 30 && m >= 1 && m <= 12 && Number.isInteger(d) && Number.isInteger(m) : isValidDayMonth(d, m, y);
  const nextIso = dateOk ? nextOccurrenceIso(d, m, isLunar, todayVN()) : null;

  const handleSave = async () => {
    if (!contactId) { setError('Chọn người liên hệ'); return; }
    if (!title.trim()) { setError('Nhập tên sự kiện'); return; }
    if (!dateOk) { setError('Ngày / tháng không hợp lệ'); return; }
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > 2200)) { setError('Năm không hợp lệ (để trống nếu không rõ)'); return; }
    const r = Number(remind);
    if (!Number.isInteger(r) || r < 0 || r > 60) { setError('Nhắc trước 0–60 ngày'); return; }
    setSaving(true);
    setError('');
    const err = await onSave({
      contactId, title, occasionType: type, day: d, month: m, year: y, isLunar,
      relatedPerson: related, remindDaysBefore: r, note,
    });
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <Sheet label={existing ? 'Sửa sự kiện' : 'Thêm sự kiện'} onClose={onClose} wide>
      <h2 className="text-[16px] md:text-[15px] font-semibold text-[#111] mb-3">{existing ? 'Sửa sự kiện' : 'Thêm sự kiện'}</h2>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Người liên hệ</label>
          <ContactPicker contacts={contacts} value={contactId} onChange={c => setContactId(c?.id ?? '')} autoFocus={!existing} />
        </div>
        <div>
          <label className={labelCls}>Tên sự kiện</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="VD: Sinh nhật con gái, Ngày thành lập công ty" maxLength={120} />
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {TITLE_HINTS.map(t => (
              <button key={t} type="button" onClick={() => setTitle(t)}
                className="px-2.5 h-8 md:h-6 rounded-full text-[11.5px] border border-[#E0DFDA] bg-white text-[#555] hover:border-[#C9C7BE]">{t}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Loại</label>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map(t => <ChoiceChip key={t} active={type === t} onClick={() => setType(t)}>{OCCASION_LABEL[t]}</ChoiceChip>)}
          </div>
          {type === 'anniversary' && <p className="text-[10.5px] text-[#aaa] mt-1">Sự kiện doanh nghiệp (thành lập, khai trương, ngày ký HĐ đầu tiên) chọn "Kỷ niệm".</p>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>Ngày</label>
            <input type="number" inputMode="numeric" min={1} max={31} value={day} onChange={e => setDay(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tháng</label>
            <input type="number" inputMode="numeric" min={1} max={12} value={month} onChange={e => setMonth(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Năm (tuỳ chọn)</label>
            <input type="number" inputMode="numeric" min={1900} max={2200} value={year} onChange={e => setYear(e.target.value)} className={inputCls} placeholder="Không rõ" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-[#444] cursor-pointer min-h-[40px] md:min-h-0">
          <input type="checkbox" checked={isLunar} onChange={e => setIsLunar(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          Âm lịch (giỗ, sinh nhật âm…)
        </label>
        {nextIso && (
          <p className="text-[11.5px] text-[#666] -mt-1">
            Lần tới: <b>{formatDateVN(nextIso)}</b>{isLunar ? ' (dương lịch, đã quy đổi)' : ''}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Của người thân? (tuỳ chọn)</label>
            <input value={related} onChange={e => setRelated(e.target.value)} className={inputCls} placeholder="VD: con gái, mẹ, vợ" maxLength={60} />
          </div>
          <div>
            <label className={labelCls}>Nhắc trước (ngày)</label>
            <input type="number" inputMode="numeric" min={0} max={60} value={remind} onChange={e => setRemind(e.target.value)} className={inputCls} />
            <p className="text-[10.5px] text-[#aaa] mt-0.5">Tự tạo việc "Chuẩn bị quà" trong Workspace trước bấy nhiêu ngày</p>
          </div>
        </div>
        <div>
          <label className={labelCls}>Ghi chú</label>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className={`${inputCls} resize-y`} placeholder="VD: thích hoa lan, năm ngoái tặng giỏ trái cây" />
        </div>
      </div>
      {error && <p className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onClose} className="flex-1 h-11 md:h-9 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-600">Huỷ</button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-[2] h-11 md:h-9 rounded-lg bg-[#1D4ED8] text-white text-[13px] font-semibold disabled:bg-gray-400">
          {saving ? 'Đang lưu…' : existing ? 'Lưu sự kiện' : 'Thêm sự kiện'}
        </button>
      </div>
    </Sheet>
  );
}
