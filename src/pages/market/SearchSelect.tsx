import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Plus } from 'lucide-react';

/** Dropdown có ô gõ để tìm kiếm; tuỳ chọn cho phép thêm giá trị mới khi không tìm thấy.
 * Panel render qua portal vào <body> (position: fixed) để không bị cắt bởi các container
 * cha có overflow-hidden (thẻ bo góc, bảng cuộn ngang…). */
export default function SearchSelect({ value, onChange, options, placeholder, className, allowAdd, onAdd }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  allowAdd?: boolean;
  onAdd?: (name: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    // Cuộn TRANG (ngoài panel) khi dropdown đang mở dễ làm lệch vị trí panel — đóng lại cho
    // an toàn. Nhưng bỏ qua khi cuộn xảy ra ngay bên trong danh sách lựa chọn (overflow-y-auto)
    // hoặc ngay lúc vừa mở (autofocus có thể tự cuộn trang) — nếu không panel sẽ tự đóng
    // ngay khi gõ tìm hoặc khi rê chuột cuộn xuống chọn mục ở dưới.
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      if (Date.now() - openedAtRef.current < 300) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', h);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
      openedAtRef.current = Date.now();
    }
    setOpen(v => !v);
    setQuery('');
    setHighlight(0);
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  const selected = options.find(o => o.value === value);
  // `value` có thể là 1 tên vừa gõ/thêm mới (allowAdd) chưa kịp có trong `options` — vẫn phải
  // hiển thị đúng tên đó thay vì rơi về placeholder, nếu không sẽ trông như chưa chọn được gì.
  const displayLabel = selected?.label ?? value;
  const canAdd = !!allowAdd && !!query.trim() && !options.some(o => o.label.toLowerCase() === q);
  const rowCount = filtered.length + (canAdd ? 1 : 0);

  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); setHighlight(0); };

  return (
    <div className={className}>
      <button ref={triggerRef} type="button" onClick={toggle}
        className="w-full flex items-center justify-between gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white hover:border-gray-400 transition text-left">
        <span className={`truncate ${displayLabel ? 'text-[#222]' : 'text-[#999]'}`}>{displayLabel || placeholder || 'Chọn…'}</span>
        <ChevronDown size={13} className="text-[#999] flex-none" />
      </button>
      {open && rect && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', top: rect.top, left: rect.left, width: Math.max(rect.width, 200) }}
          className="z-[9999] bg-white border border-[#E8E7E2] rounded-lg shadow-lg overflow-hidden">
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, rowCount - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlight < filtered.length) pick(filtered[highlight].value);
                else if (canAdd) { onAdd?.(query.trim()); pick(query.trim()); }
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Gõ để tìm…"
            className="w-full text-[12px] px-2.5 py-2 border-b border-[#F0EEE9] outline-none"
          />
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((o, i) => (
              <button key={o.value} type="button" onClick={() => pick(o.value)} onMouseEnter={() => setHighlight(i)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left text-[12px] ${i === highlight ? 'bg-[#F5F4F1]' : ''} ${o.value === value ? 'font-medium text-blue-700' : 'text-[#333]'}`}>
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check size={12} className="flex-none" />}
              </button>
            ))}
            {canAdd && (
              <button type="button" onMouseEnter={() => setHighlight(filtered.length)}
                onClick={async () => { await onAdd?.(query.trim()); pick(query.trim()); }}
                className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-blue-700 font-medium ${filtered.length === highlight ? 'bg-blue-50' : ''}`}>
                <Plus size={12} className="flex-none" /> Thêm «{query.trim()}»
              </button>
            )}
            {!filtered.length && !canAdd && (
              <div className="px-2.5 py-2 text-[11.5px] text-[#999]">Không tìm thấy</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
