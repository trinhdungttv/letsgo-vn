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
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
        className={`relative w-full ${wide === 'xl' ? 'md:max-w-[760px]' : wide ? 'md:max-w-[560px]' : 'md:max-w-[440px]'} bg-[#F2F2F7] md:bg-white rounded-t-[22px] md:rounded-[22px] shadow-[0_-8px_40px_rgba(0,0,0,0.16)] md:shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_24px_64px_-12px_rgba(0,0,0,0.28)] max-h-[92dvh] overflow-y-auto px-4 md:px-6 pt-2 md:pt-5 pb-[max(16px,env(safe-area-inset-bottom))] animate-fade-in`}
      >
        <div className="md:hidden flex justify-center pb-2">
          <div className="w-9 h-[5px] rounded-full bg-[#C7C7CC]" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="hidden md:inline-flex absolute right-4 top-4 w-[30px] h-[30px] rounded-full items-center justify-center bg-black/[0.05] text-[#86868B] hover:bg-black/[0.09] hover:text-[#1D1D1F] transition"
        >
          <X size={15} strokeWidth={2.5} />
        </button>
        {children}
      </div>
    </div>
  );
}

/**
 * Chân sheet dính đáy: bù phần đệm đáy của Sheet (16px / vùng an toàn iOS) để không lộ
 * nội dung cuộn bên dưới nút.
 */
export const SHEET_FOOTER = 'sticky -mx-4 md:-mx-6 px-4 md:px-6 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] bottom-[calc(-1*max(16px,env(safe-area-inset-bottom)))] backdrop-blur-xl border-t border-black/[0.06]';

/** Nút dạng viên thuốc chọn 1 trong nhiều (hình thức, hạn nhanh, kết quả…). */
export function ChoiceChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3.5 h-9 md:h-8 rounded-full text-[13px] font-medium transition active:scale-[0.97] ${
        active ? 'bg-[#0071E3] text-white shadow-[0_1px_2px_rgba(0,113,227,0.3)]' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]'
      }`}
    >
      {children}
    </button>
  );
}
