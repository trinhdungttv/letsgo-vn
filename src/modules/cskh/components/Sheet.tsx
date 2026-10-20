// Khung dùng chung: điện thoại = bottom sheet trượt từ dưới lên (chừa safe-area iOS),
// máy tính = hộp thoại giữa màn hình. Bấm nền hoặc Esc để đóng.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Sheet({ label, onClose, children, wide = false }: {
  /** Đọc bởi trình đọc màn hình. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Hộp rộng hơn trên máy tính: true = form nhiều cột, 'xl' = hồ sơ đầy đủ. */
  wide?: boolean | 'xl';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center md:justify-center md:p-4" onClick={onClose} role="presentation">
      <div className="absolute inset-0 bg-[#0c2340]/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
        className={`relative w-full ${wide === 'xl' ? 'md:max-w-[760px]' : wide ? 'md:max-w-[560px]' : 'md:max-w-[440px]'} bg-[#F7F6F2] md:bg-white rounded-t-[20px] md:rounded-[14px] md:border md:border-[#E8E7E2] shadow-[0_-8px_40px_rgba(12,35,64,0.18)] max-h-[92dvh] overflow-y-auto px-4 md:px-5 pt-2 md:pt-4 pb-[max(16px,env(safe-area-inset-bottom))] animate-fade-in`}
      >
        <div className="md:hidden flex justify-center pb-2">
          <div className="w-9 h-[5px] rounded-full bg-[#D6D4CC]" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="hidden md:inline-flex absolute right-3 top-3 w-7 h-7 rounded-full items-center justify-center text-[#888] hover:bg-[#F4F3EF]"
        >
          <X size={15} />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Nút dạng viên thuốc chọn 1 trong nhiều (hình thức, hạn nhanh, kết quả…). */
export function ChoiceChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 h-9 md:h-7 rounded-full text-[12.5px] md:text-[12px] font-medium border transition ${
        active ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white' : 'bg-white border-[#E0DFDA] text-[#555] hover:border-[#C9C7BE]'
      }`}
    >
      {children}
    </button>
  );
}
