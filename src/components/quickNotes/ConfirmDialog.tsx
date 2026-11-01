// Hộp hỏi lại kiểu iOS (xoá ghi chú, xoá / huỷ bản ghi âm). Esc = huỷ, Enter = đồng ý.
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmDialog({ req, onClose }: { req: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ok = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await req.onConfirm();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Enter') { e.preventDefault(); void ok(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="fixed inset-0 z-[95] bg-black/35 flex items-center justify-center p-4" data-qn-keep data-qn-confirm
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="alertdialog" aria-modal="true" aria-label={req.title}
        className="qn-pop w-full max-w-[330px] bg-white/95 backdrop-blur-xl rounded-[16px] p-5 text-center shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_24px_60px_-12px_rgba(0,0,0,0.4)]">
        <div className="text-[16px] font-semibold text-[#1D1D1F]">{req.title}</div>
        {req.message && <div className="mt-1.5 text-[13px] leading-[1.45] text-[#6E6E73]">{req.message}</div>}
        {err && <div className="mt-2 text-[12.5px] text-[#D70015]">{err}</div>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="flex-1 h-10 rounded-[10px] bg-black/[0.05] text-[14px] font-medium text-[#1D1D1F] hover:bg-black/[0.08] disabled:opacity-40">Huỷ</button>
          <button type="button" onClick={() => void ok()} disabled={busy} autoFocus
            className={`flex-1 h-10 rounded-[10px] text-[14px] font-semibold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-60 ${req.danger ? 'bg-[#FF3B30] hover:bg-[#E5352B]' : 'bg-[#0071E3] hover:bg-[#0077ED]'}`}>
            {busy && <Loader2 size={14} className="animate-spin" />} {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
