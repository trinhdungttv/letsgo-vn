// ============================================================================
// Ghi nhanh khách — khung nổi ở Workspace mở thẳng tab "Ma trận khách hàng" của CSKH.
// Mục đích: vừa trao đổi xong với ai → chọn nhanh người đó, bấm Ghi (hoặc mở hồ sơ) để
// lưu điều họ nói / yêu cầu ngay, khỏi quên. Dùng đúng module CSKH (cùng dữ liệu, cùng
// hộp thoại Ghi tương tác / Hồ sơ) nên không có bảng dữ liệu riêng.
// Hộp thoại của module dùng z-50 → khung này z-40 để chúng luôn nằm trên.
// ============================================================================
import { lazy, Suspense, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Client, Page } from '../../lib/types';

const CskhModule = lazy(() => import('../../modules/cskh'));

interface Props {
  clients: Client[];
  toast: (msg: string) => void;
  onNavigate: (page: Page) => void;
  onClose: () => void;
}

export function CskhQuickPanel({ clients, toast, onNavigate, onClose }: Props) {
  // Esc đóng khung (hộp thoại bên trong tự xử lý Esc của nó trước nếu có)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.fixed.z-50')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex justify-center md:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[1200px] bg-[#F5F5F7] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 bg-white border-b border-black/[0.06] shrink-0">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[#1D1D1F]">Ghi nhanh khách</div>
            <div className="text-[12px] text-[#86868B]">Chọn người vừa trao đổi → Ghi tương tác để lưu điều họ nói / yêu cầu</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { onClose(); onNavigate('crm-leads'); }} className="text-[12.5px] text-[#0066CC] hover:underline hidden sm:inline">Mở CSKH đầy đủ</button>
            <button onClick={onClose} aria-label="Đóng" className="w-8 h-8 rounded-full bg-black/[0.06] hover:bg-black/10 flex items-center justify-center text-[#1D1D1F]"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 md:px-6 pt-4 pb-8 space-y-4">
          <Suspense fallback={<div className="py-16 flex justify-center"><div className="w-5 h-5 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin" /></div>}>
            <CskhModule
              space="client"
              tab="matrix"
              onTab={() => { onClose(); onNavigate('crm-leads'); }}
              clients={clients}
              toast={toast}
              onOpenWorkspace={onClose}
              onOpenClient={() => { onClose(); onNavigate('clients'); }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
