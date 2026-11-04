// Pháp lý — xem nhanh 1 file Google Drive (Giấy chứng nhận ĐKDN, giấy phép con) ngay trong app: khung phủ gần kín màn hình.
import { useEffect } from 'react';
import { ExternalLink, FileText, X } from 'lucide-react';
import { parseDocLink } from '../../lib/legal/drive';
import { BTN_SECONDARY } from '../workspace/wsTheme';
import { EmbedFrame, GoogleAccessHint } from './Embed';

/** Nút icon file — chỉ hiện khi có link; bấm để mở FileViewer. */
export function FileIconButton({ url, onOpen, label = 'Xem file gốc' }: { url: string; onOpen: () => void; label?: string }) {
  if (!url.trim()) return null;
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onOpen(); }} title={label} aria-label={label}
      className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-[#0071E3]/10 text-[#0071E3] hover:bg-[#0071E3]/[0.18] active:scale-95 transition">
      <FileText size={16} />
    </button>
  );
}

export default function FileViewer({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const link = parseDocLink(url);
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#F5F5F7] animate-fade-in" role="dialog" aria-modal="true" aria-label={title}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="shrink-0 flex items-center gap-3 px-3 md:px-4 h-[54px] bg-white/90 backdrop-blur-xl border-b border-black/[0.06]">
        <span className="w-8 h-8 rounded-[10px] bg-[#0071E3]/10 text-[#0071E3] inline-flex items-center justify-center shrink-0"><FileText size={16} /></span>
        <h2 className="flex-1 min-w-0 truncate text-[14.5px] font-semibold text-[#1D1D1F]">{title}</h2>
        <a href={link.openUrl} target="_blank" rel="noreferrer" className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`}><ExternalLink size={13} /> <span className="hidden sm:inline">{link.google ? 'Mở Drive' : 'Mở trang'}</span></a>
        <button type="button" onClick={onClose} aria-label="Đóng" className="w-8 h-8 rounded-full bg-black/[0.06] text-[#1D1D1F] inline-flex items-center justify-center hover:bg-black/[0.1]"><X size={16} /></button>
      </header>
      <div className="flex-1 min-h-0 flex flex-col p-2 md:p-4 gap-2">
        <EmbedFrame url={url} title={title} className="flex-1 min-h-0 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_10px_30px_-18px_rgba(0,0,0,0.3)]" />
        <GoogleAccessHint url={url} />
      </div>
    </div>
  );
}
