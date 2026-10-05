import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { MoreHorizontal, X } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   MobileActionSheet — nút "⋯" chỉ hiện trên điện thoại, bấm mở bảng trượt từ dưới
   lên liệt kê các thao tác phụ. Dùng để gom hàng nút dài trên header (File mẫu,
   Import, Xuất…) mà trên màn hình nhỏ bị tràn ra ngoài. Trên máy tính các nút đó
   vẫn hiện như cũ (bọc bằng `hidden md:flex`), component này tự ẩn (`md:hidden`).
   ───────────────────────────────────────────────────────────────────────── */

export interface MobileAction {
  key: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export default function MobileActionSheet({ actions, title = 'Thao tác', label }: {
  actions: MobileAction[];
  title?: string;
  /** Chữ cạnh dấu ⋯ (bỏ trống = chỉ icon) */
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!actions.length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden inline-flex items-center justify-center gap-1 h-9 min-w-9 px-2.5 rounded-lg border border-gray-300 text-gray-600 bg-white active:bg-gray-50"
        aria-label={title}
      >
        <MoreHorizontal size={17} />
        {label && <span className="text-[12.5px] font-medium">{label}</span>}
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-[80]" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-[#0c2340]/40 animate-fade-in" />
          <div
            className="absolute inset-x-0 bottom-0 bg-[#F7F6F2] rounded-t-[20px] shadow-[0_-8px_40px_rgba(12,35,64,0.18)] max-h-[80dvh] flex flex-col animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2.5 pb-0.5 shrink-0">
              <div className="w-9 h-[5px] rounded-full bg-[#D6D4CC]" />
            </div>
            <div className="flex items-center justify-between px-4 py-2 shrink-0">
              <span className="text-[14px] font-bold text-[#111]">{title}</span>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-[#EAE8E1] text-[#666] flex items-center justify-center" aria-label="Đóng">
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
              <div className="bg-white border border-[#E8E7E2] rounded-[14px] overflow-hidden">
                {actions.map((a, i) => (
                  <button
                    key={a.key}
                    type="button"
                    disabled={a.disabled}
                    onClick={() => { setOpen(false); a.onClick(); }}
                    className={`flex items-center gap-3 w-full px-4 py-3.5 text-left active:bg-[#F5F4EF] disabled:opacity-40 ${i ? 'border-t border-[#F0EEE9]' : ''}`}
                  >
                    {a.icon && (
                      <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${a.danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-[#1D4ED8]'}`}>
                        {a.icon}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[14px] font-medium ${a.danger ? 'text-red-600' : 'text-[#111]'}`}>{a.label}</span>
                      {a.hint && <span className="block text-[11.5px] text-[#888] truncate">{a.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
