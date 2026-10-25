// Ô nhập dạng THẺ (port PRM TagInput): gõ rồi Enter / dấu phẩy để tạo thẻ; dán "a, b, c" tạo
// 3 thẻ; Backspace ở ô trống xoá thẻ cuối; rời ô thì chữ đang gõ thành thẻ. Hàng gợi ý: thẻ người
// khác đã dùng (kèm số người) + thẻ mẫu; gõ không dấu vẫn ra. Trùng thẻ đã có (khác dấu/hoa)
// thì dùng chung cách viết — để lọc được "những ai cùng thích golf".
import { useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { addTag, joinTags, splitTags, suggestTags, tagKey, type TagStat } from '../../../lib/cskh/traits';

/** Giữ con trỏ trong ô gõ khi bấm gợi ý (không để blur tạo thẻ từ chữ đang gõ dở). */
const keepFocus = (e: SyntheticEvent) => e.preventDefault();

export function TagInput({ value, onChange, stats, presets = [], placeholder, label, alwaysSuggest = false }: {
  /** Các thẻ nối bằng ", " (đúng dạng lưu trong DB). */
  value: string;
  onChange: (next: string) => void;
  /** Thẻ của các người liên hệ KHÁC (đếm số người). */
  stats: readonly TagStat[];
  presets?: readonly string[];
  placeholder: string;
  label: string;
  /** true: luôn hiện hàng gợi ý; false: chỉ hiện khi đang gõ / đang chọn ô. */
  alwaysSuggest?: boolean;
}) {
  const tags = useMemo(() => splitTags(value), [value]);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    setDraft('');
    if (raw.trim()) onChange(joinTags(addTag(tags, raw, stats, presets)));
  };
  const remove = (i: number) => onChange(joinTags(tags.filter((_, j) => j !== i)));

  const typing = draft.trim() !== '';
  const sugs = alwaysSuggest || focused || typing
    ? suggestTags(stats, presets, tags, draft, typing ? 8 : alwaysSuggest ? 12 : 10)
    : [];
  const isNew = typing && !sugs.some(s => s.key === tagKey(draft)) && !tags.some(t => tagKey(t) === tagKey(draft));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // đang gõ dấu tiếng Việt (Telex/VNI)
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      remove(tags.length - 1);
    } else if (e.key === 'Escape' && draft) {
      e.stopPropagation();
      setDraft('');
    }
  };

  return (
    <div>
      <div onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 min-h-[40px] md:min-h-[36px] px-2 py-1.5 rounded-[10px] border border-black/[0.12] bg-white cursor-text focus-within:border-[#0071E3] focus-within:ring-4 focus-within:ring-[#0071E3]/15 transition">
        {tags.map((t, i) => (
          <span key={tagKey(t)} className="inline-flex items-center gap-0.5 h-7 md:h-6 pl-2.5 pr-1 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12.5px] font-medium">
            {t}
            <button type="button" aria-label={`Bỏ ${t}`} onPointerDown={keepFocus} onMouseDown={keepFocus}
              onClick={e => { e.stopPropagation(); remove(i); }}
              className="w-6 h-6 md:w-5 md:h-5 rounded-full flex items-center justify-center hover:bg-[#0071E3]/15">
              <X size={11} strokeWidth={2.8} />
            </button>
          </span>
        ))}
        <input ref={inputRef} type="text" value={draft}
          onChange={e => (/[,;]/.test(e.target.value) ? commit(e.target.value) : setDraft(e.target.value))}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(draft); }}
          placeholder={tags.length > 0 ? 'Thêm…' : placeholder}
          aria-label={label} enterKeyHint="done" maxLength={60}
          className="flex-1 min-w-[90px] h-7 md:h-6 bg-transparent outline-none text-[13px] text-[#1D1D1F] placeholder:text-[#AEAEB2] px-1" />
      </div>
      {(sugs.length > 0 || isNew) && (
        <div className="flex flex-wrap gap-1.5 mt-1.5" role="group" aria-label={`Gợi ý ${label.toLowerCase()}`}>
          {isNew && (
            <button type="button" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => commit(draft)}
              className="inline-flex items-center gap-1 h-8 md:h-7 px-3 rounded-full bg-[#0071E3] text-white text-[12.5px] font-medium active:scale-[0.97] transition">
              <Plus size={12} strokeWidth={2.6} /> Thêm “{draft.trim()}”
            </button>
          )}
          {sugs.map(s => (
            <button key={s.key} type="button" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => commit(s.label)}
              title={s.count > 0 ? `${s.count} người khác cũng có` : 'Gợi ý'}
              className="inline-flex items-center gap-1 h-8 md:h-7 px-3 rounded-full bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] text-[12.5px] font-medium hover:bg-[rgba(118,118,128,0.2)] active:scale-[0.97] transition">
              {s.label}
              {s.count > 0 && <span className="text-[11px] font-semibold text-[#86868B] tabular-nums">{s.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
