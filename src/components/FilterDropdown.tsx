import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export const ALL_OPTION = 'Tất cả';

export function toggleOption(selected: string[], opt: string): string[] {
  if (opt === ALL_OPTION) return [ALL_OPTION];
  const next = selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected.filter(o => o !== ALL_OPTION), opt];
  return next.length === 0 ? [ALL_OPTION] : next;
}

interface FilterDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  allLabel?: string;
}

export default function FilterDropdown({ label, options, selected, onChange, allLabel }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const display = selected.includes(ALL_OPTION) || selected.length === 0
    ? (allLabel || ALL_OPTION)
    : selected.length === 1 ? selected[0] : `${selected.length} đã chọn`;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium border transition ${open ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-600 bg-white hover:border-blue-400'}`}>
        <span className="text-[#888] font-normal">{label}:</span> {display}
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-[180px] max-h-[260px] overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-gray-700 hover:bg-blue-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt) || (opt === ALL_OPTION && selected.length === 0)}
                onChange={() => onChange(toggleOption(selected, opt))}
                className="w-3.5 h-3.5 text-blue-600 rounded"
              />
              {opt === ALL_OPTION ? (allLabel || ALL_OPTION) : opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
