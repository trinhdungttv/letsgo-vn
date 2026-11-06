// Thẻ (tag) của 1 ghi chú / sơ đồ, giống TickTick: chip màu + ô gõ thẻ mới (gợi ý từ các thẻ đã dùng).
// Enter / dấu phẩy / Tab = thêm · Backspace khi ô trống = bỏ thẻ cuối. Chỉ xem (khoá / đã xoá) thì không có ô nhập.
import { useState } from 'react';
import { Hash, X } from 'lucide-react';
import { MAX_TAGS, normTag, normTags } from '../../lib/quickNotes/noteText';

const HUES = [210, 28, 150, 285, 340, 175, 45, 0];
/** Cùng 1 thẻ luôn cùng 1 màu. */
export function tagHue(tag: string): number {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
export const tagStyle = (tag: string) => ({ background: `hsla(${tagHue(tag)}, 70%, 50%, 0.14)`, color: `hsl(${tagHue(tag)}, 65%, 30%)` });

export function TagChip({ tag, onRemove, onClick, active, count }: { tag: string; onRemove?: () => void; onClick?: () => void; active?: boolean; count?: number }) {
  const body = (
    <>
      <Hash size={10} className="opacity-60 shrink-0" />
      <span className="truncate max-w-[140px]">{tag}</span>
      {count !== undefined && <span className="opacity-55 tabular-nums">{count}</span>}
    </>
  );
  const cls = `shrink-0 inline-flex items-center gap-0.5 h-[22px] px-2 rounded-full text-[12px] font-medium ${active ? 'ring-2 ring-offset-1 ring-black/40' : ''}`;
  return (
    <span className={cls} style={tagStyle(tag)}>
      {onClick ? <button type="button" onClick={onClick} className="inline-flex items-center gap-0.5">{body}</button> : body}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Bỏ thẻ ${tag}`} className="ml-0.5 opacity-60 hover:opacity-100"><X size={11} /></button>}
    </span>
  );
}

export default function TagBar({ tags, suggestions, editable, onChange }: {
  tags: string[]; suggestions: string[]; editable: boolean; onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState('');
  if (!editable && !tags.length) return null;

  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map(normTag).filter(Boolean);
    if (parts.length) onChange(normTags([...tags, ...parts]));
    setText('');
  };
  const options = suggestions.filter(s => !tags.includes(s));
  const listId = 'qn-tag-options';

  return (
    <div className="flex items-center gap-1.5 flex-wrap px-3 py-1.5 shrink-0 border-b border-black/[0.05]">
      {tags.map(t => <TagChip key={t} tag={t} onRemove={editable ? () => onChange(tags.filter(x => x !== t)) : undefined} />)}
      {editable && tags.length < MAX_TAGS && (
        <>
          <input value={text} list={listId} placeholder={tags.length ? '+ Thẻ' : '+ Thêm thẻ để phân loại'} aria-label="Thêm thẻ"
            onChange={e => { const v = e.target.value; if (/[,;]$/.test(v)) add(v); else setText(v); }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === 'Tab') { if (text.trim()) { e.preventDefault(); add(text); } }
              else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
            }}
            onBlur={() => { if (text.trim()) add(text); }}
            className="h-[22px] min-w-[96px] flex-1 bg-transparent outline-none text-[12px] placeholder:opacity-50" />
          <datalist id={listId}>{options.map(o => <option key={o} value={o} />)}</datalist>
        </>
      )}
    </div>
  );
}
