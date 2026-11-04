// Ô "Ngày sinh" dạng Ngày / Tháng / Năm — năm KHÔNG bắt buộc (nhiều khách chỉ biết ngày + tháng).
// Dùng ở form đầy đủ (ContactFormModal) và tạo nhanh (QuickContactForm). Giá trị là chuỗi của form
// (xem lib/birthday): '' · "YYYY-MM-DD" (không rõ năm = 1604-MM-DD) · bản nháp '~d/m/y' khi đang
// nhập dở — saveContact báo lỗi bản nháp thay vì lưu nhầm thành "không có ngày sinh".
import { useEffect, useRef, useState } from 'react';
import { birthdayAge, birthdayDraftError, birthdayOfDraft, draftOfBirthday, type BirthdayDraft } from '../../lib/birthday';
import { todayVN } from '../../lib/cskh/dates';

const SOLAR_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export default function BirthdayInput({ value, onChange, className = '', compact = false }: {
  value: string;
  onChange: (v: string) => void;
  /** Class chung cho 3 ô (viền, cỡ chữ…). */
  className?: string;
  /** Ô gọn (form tạo nhanh): không hiện dòng tuổi. */
  compact?: boolean;
}) {
  const today = todayVN();
  const currentYear = Number(today.slice(0, 4));
  const [draft, setDraft] = useState<BirthdayDraft>(() => draftOfBirthday(value));
  // Giá trị vừa phát ra — để nhận ra khi form đổi giá trị từ bên ngoài (VD chọn người đã có)
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setDraft(draftOfBirthday(value));
    }
  }, [value]);

  const patch = (p: Partial<BirthdayDraft>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    const v = birthdayOfDraft(next, currentYear);
    emitted.current = v;
    onChange(v);
  };

  const err = birthdayDraftError(draft, currentYear);
  // Chỉ báo lỗi khi đã chọn đủ ngày + tháng, hoặc gõ đủ 4 số năm — đang chọn dở thì chưa la
  const showErr = err && ((draft.day !== null && draft.month !== null) || draft.yearText.length >= 4);
  const dayMax = Math.max(draft.month ? SOLAR_MAX_DAY[draft.month - 1] : 31, draft.day ?? 0);
  const age = !err && draft.yearText ? birthdayAge(value, today) : null;
  const filled = draft.day !== null || draft.month !== null || draft.yearText !== '';

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <select value={draft.day ?? ''} aria-label="Ngày sinh — ngày"
          onChange={e => patch({ day: e.target.value === '' ? null : Number(e.target.value) })}
          className={`${className} !w-auto min-w-[64px]`}>
          <option value="">Ngày</option>
          {Array.from({ length: dayMax }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={draft.month ?? ''} aria-label="Ngày sinh — tháng"
          onChange={e => patch({ month: e.target.value === '' ? null : Number(e.target.value) })}
          className={`${className} !w-auto min-w-[92px]`}>
          <option value="">Tháng</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>Tháng {m}</option>)}
        </select>
        {/* type=text + inputMode=numeric: tránh kiểu ô số xấu trên iPhone */}
        <input type="text" inputMode="numeric" value={draft.yearText} placeholder="Năm" aria-label="Năm sinh (không bắt buộc)"
          onChange={e => patch({ yearText: e.target.value.replace(/\D/g, '').slice(0, 4) })}
          className={`${className} !w-[72px] min-w-0`} />
        {filled && (
          <button type="button" onClick={() => patch({ day: null, month: null, yearText: '' })} title="Xoá ngày sinh"
            className="shrink-0 text-[11px] text-gray-400 hover:text-red-500 px-1">Xoá</button>
        )}
      </div>
      {showErr ? (
        <p className="text-[11px] text-red-600 mt-1">{err}</p>
      ) : !compact && draft.day !== null && draft.month !== null && (
        <p className="text-[11px] text-gray-500 mt-1">
          {age !== null ? `${age} tuổi` : 'Không rõ năm sinh — vẫn nhắc sinh nhật hằng năm, chỉ không tính tuổi'}
        </p>
      )}
    </div>
  );
}
