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
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    // Cuộn trang khi dropdown đang mở dễ làm lệch vị trí panel — đóng lại cho an toàn.
    const onScroll = () => setOpen(false);
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
    }
    setOpen(v => !v);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  const selected = options.find(o => o.value === value);
  const canAdd = !!allowAdd && !!query.trim() && !options.some(o => o.label.toLowerCase() === q);

  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <div className={className}>
      <button ref={triggerRef} type="button" onClick={toggle}
        className="w-full flex items-center justify-between gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white hover:border-gray-400 transition text-left">
        <span className={`truncate ${selected ? 'text-[#222]' : 'text-[#999]'}`}>{selected?.label ?? placeholder ?? 'Chọn…'}</span>
        <ChevronDown size={13} className="text-[#999] flex-none" />
      </button>
      {open && rect && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', top: rect.top, left: rect.left, width: Math.max(rect.width, 200) }}
          className="z-[9999] bg-white border border-[#E8E7E2] rounded-lg shadow-lg overflow-hidden">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filtered.length === 1) pick(filtered[0].value);
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Gõ để tìm…"
            className="w-full text-[12px] px-2.5 py-2 border-b border-[#F0EEE9] outline-none"
          />
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map(o => (
              <button key={o.value} type="button" onClick={() => pick(o.value)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left text-[12px] hover:bg-[#F5F4F1] ${o.value === value ? 'font-medium text-blue-700' : 'text-[#333]'}`}>
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check size={12} className="flex-none" />}
              </button>
            ))}
            {canAdd && (
              <button type="button"
                onClick={async () => { await onAdd?.(query.trim()); pick(query.trim()); }}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-blue-700 font-medium hover:bg-blue-50">
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
