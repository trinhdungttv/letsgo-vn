import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Chức vụ đã dùng ở mọi chi nhánh + gợi ý mặc định — chọn từ danh sách hoặc gõ chức vụ mới.
const DEFAULT_ROLES = ['Quản lý dự án', 'Nhân viên kinh doanh', 'Nhân viên nhân sự', 'Kế toán', 'Hành chính', 'Trưởng chi nhánh'];

export default function RoleCombo({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from('branch_staffs').select('role').not('role', 'is', null).then(({ data }) => {
      setUsed([...new Set((data ?? []).map((r: any) => String(r.role).trim()).filter(Boolean))]);
    });
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const options = useMemo(() => {
    const all = [...new Set([...used, ...DEFAULT_ROLES])].sort((a, b) => a.localeCompare(b, 'vi'));
    const q = value.trim().toLowerCase();
    return q ? all.filter(r => r.toLowerCase().includes(q)) : all;
  }, [used, value]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Chọn hoặc gõ chức vụ mới"
        className="w-full text-[13px] pl-3 pr-8 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
      <button type="button" tabIndex={-1} onClick={() => setOpen(o => !o)} className="absolute right-0 top-0 h-full px-2.5 text-gray-400 hover:text-gray-600">
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-[#E8E7E2] rounded-lg shadow-lg py-1">
          {options.map(r => (
            <button type="button" key={r} onMouseDown={e => e.preventDefault()} onClick={() => { onChange(r); setOpen(false); }}
              className="w-full flex items-center justify-between text-left text-[12.5px] px-3 py-1.5 hover:bg-blue-50 text-[#222]">
              {r}{r === value.trim() && <Check size={12} className="text-blue-600" />}
            </button>
          ))}
          {value.trim() && !options.some(r => r.toLowerCase() === value.trim().toLowerCase()) && (
            <div className="px-3 py-1.5 text-[12px] text-[#888] border-t border-gray-100">Dùng chức vụ mới: <b className="text-[#111]">{value.trim()}</b></div>
          )}
          {options.length === 0 && !value.trim() && <div className="px-3 py-2 text-[12px] text-[#aaa]">Chưa có chức vụ nào</div>}
        </div>
      )}
    </div>
  );
}
