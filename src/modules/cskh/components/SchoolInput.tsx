// Ô tên trường có gợi ý từ người liên hệ khác (port PRM SchoolInput): gõ vài chữ (không dấu cũng
// được) là ra trường đã có, chọn bằng chuột / chạm / phím mũi tên + Enter; vẫn gõ được trường mới.
// Rời ô thì tên trùng trường đã có (khác hoa/thường, dấu, khoảng trắng) tự đổi về đúng tên đó.
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { canonicalSchoolName, suggestSchools, type SchoolEntry } from '../../../lib/cskh/education';
import { inputCls } from '../ui';

export function SchoolInput({ value, onChange, index }: {
  value: string;
  onChange: (next: string) => void;
  /** Danh bạ trường của các người liên hệ KHÁC (số người hiện bên phải mỗi gợi ý). */
  index: ReadonlyMap<string, SchoolEntry>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const items = useMemo(() => (open ? suggestSchools(index, value) : []), [open, index, value]);
  // Chỉ còn đúng trường đang chọn → ẩn danh sách cho đỡ rối
  const shown = items.length === 1 && items[0].name === value.trim() ? [] : items;

  const pick = (s: SchoolEntry) => {
    onChange(s.name);
    setOpen(false);
    setCursor(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setCursor(c => Math.min(c + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, -1));
    } else if (e.key === 'Enter' && cursor >= 0 && shown[cursor]) {
      e.preventDefault();
      pick(shown[cursor]);
    } else if (e.key === 'Escape' && shown.length > 0) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="relative flex-1 min-w-0">
      <input type="text" value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setCursor(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setCursor(-1);
          const canonical = canonicalSchoolName(value, index);
          if (canonical !== value) onChange(canonical);
        }}
        onKeyDown={onKeyDown}
        placeholder="Tên trường" aria-label="Tên trường" role="combobox" aria-autocomplete="list"
        aria-expanded={shown.length > 0} aria-controls={listId} autoComplete="off" maxLength={160}
        className={inputCls} />
      {shown.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Trường đã có"
          className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-[12px] bg-white py-1 shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_12px_32px_-8px_rgba(0,0,0,0.25)]">
          {shown.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === cursor}
              onMouseDown={e => e.preventDefault()} onMouseEnter={() => setCursor(i)} onClick={() => pick(s)}
              className={`flex items-center gap-2 px-3 min-h-[40px] md:min-h-[34px] text-[13px] cursor-pointer ${i === cursor ? 'bg-[#0071E3]/10 text-[#0066CC]' : 'text-[#1D1D1F]'}`}>
              <span className="flex-1 min-w-0 truncate">{s.name}</span>
              <span className="shrink-0 text-[11.5px] text-[#86868B] tabular-nums">{s.contactIds.length} người</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
