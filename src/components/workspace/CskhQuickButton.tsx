// ============================================================================
// Nút cuốn sổ "Ghi nhanh khách" — nổi ở góc dưới bên phải, NGAY TRÊN chuông thông báo,
// hiện ở MỌI trang (gắn ở gốc App, cạnh Ghi chú nhanh). Bấm → CskhQuickPanel: chọn người vừa
// trao đổi rồi Ghi tương tác. Trước đây nút nằm trong trang Workspace nên sang trang khác là mất.
// Vị trí khớp với chuông (DailyAttentionAlert: bottom-5 / điện thoại 76px) cộng thêm 52px.
// ============================================================================
import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import type { Client, Page } from '../../lib/types';
import { CskhQuickPanel } from './CskhQuickPanel';

interface Props {
  clients: Client[];
  toast: (msg: string) => void;
  onNavigate: (page: Page) => void;
}

export function CskhQuickButton({ clients, toast, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Ghi nhanh khách — chọn người vừa trao đổi để ghi lại"
        aria-label="Ghi nhanh khách"
        className="fixed z-[47] right-3 bottom-[calc(128px+env(safe-area-inset-bottom))] md:right-14 md:bottom-[72px] w-10 h-10 rounded-full bg-white text-[#0071E3] shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_6px_18px_-4px_rgba(0,0,0,0.3)] flex items-center justify-center hover:scale-105 active:scale-95 transition"
      >
        <NotebookPen size={17} />
      </button>
      {open && <CskhQuickPanel clients={clients} toast={toast} onNavigate={onNavigate} onClose={() => setOpen(false)} />}
    </>
  );
}
