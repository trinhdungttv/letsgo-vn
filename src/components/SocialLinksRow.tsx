// Nút gộp "Kênh online" kiểu Apple — 1 icon tròn duy nhất, ấn vào mới xổ ra popover với đủ
// Website/Facebook/YouTube/TikTok (đỡ rối mắt trên card danh sách). DÙNG CHUNG cho Khách hàng
// (ClientDetail) và Công ty/Dự án thị trường (LeadsTab). Panel render qua portal vào <body>
// (position: fixed) để không bị cắt bởi container cha có overflow-hidden (thẻ bo góc card).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Facebook, Youtube, Link as LinkIcon, Link2, type LucideIcon } from 'lucide-react';

interface Props {
  websiteUrl?: string | null;
  facebookUrl?: string | null;
  youtubeUrl?: string | null;
  tiktokUrl?: string | null;
}

const ITEMS: { key: string; get: (p: Props) => string | null | undefined; Icon: LucideIcon; label: string; color: string }[] = [
  { key: 'website', get: p => p.websiteUrl, Icon: Globe, label: 'Website', color: 'text-slate-600 bg-slate-100' },
  { key: 'facebook', get: p => p.facebookUrl, Icon: Facebook, label: 'Facebook', color: 'text-blue-600 bg-blue-100' },
  { key: 'youtube', get: p => p.youtubeUrl, Icon: Youtube, label: 'YouTube', color: 'text-red-600 bg-red-100' },
  { key: 'tiktok', get: p => p.tiktokUrl, Icon: LinkIcon, label: 'TikTok', color: 'text-fuchsia-600 bg-fuchsia-100' },
];

export default function SocialLinksRow(p: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setOpen(v => !v);
  };

  const activeCount = ITEMS.filter(it => it.get(p)).length;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={e => { e.stopPropagation(); toggle(); }}
        title="Kênh online"
        className={`relative inline-flex items-center justify-center w-6 h-6 rounded-full border transition ${
          open ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-[#E8E7E2] bg-[#F9F9F7] text-[#999] hover:bg-white hover:text-[#555]'
        }`}
      >
        <Link2 size={12} />
        {activeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] px-[3px] rounded-full bg-blue-600 text-white text-[8px] font-bold flex items-center justify-center leading-none">
            {activeCount}
          </span>
        )}
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: rect.top, right: rect.right }}
          className="z-[9999] w-48 rounded-2xl border border-black/5 bg-white/95 backdrop-blur-md shadow-[0_8px_28px_rgba(0,0,0,0.14)] py-1.5"
        >
          {ITEMS.map(({ key, get, Icon, label, color }) => {
            const url = get(p);
            return url ? (
              <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-1.5 text-[12px] font-medium text-[#222] hover:bg-black/[0.04] transition">
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${color}`}><Icon size={11} /></span>
                {label}
              </a>
            ) : (
              <div key={key} className="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-[#c8c8c4]">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 bg-[#F3F2EE] text-[#d4d4d0]"><Icon size={11} /></span>
                {label}
                <span className="ml-auto text-[10px]">—</span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
