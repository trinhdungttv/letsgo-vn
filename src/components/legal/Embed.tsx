// Pháp lý — xem file Google Drive / Docs / Sheets / Slides / thư mục / YouTube / PDF ngay trong app (iframe).
// Trang ngoài thường chặn nhúng → hiện thẻ "Mở trang" thay vì khung trắng.
import { useEffect, useState } from 'react';
import { ExternalLink, Globe, Loader2, ShieldQuestion } from 'lucide-react';
import { parseDocLink } from '../../lib/legal/drive';
import { BTN_PRIMARY, BTN_SECONDARY } from '../workspace/wsTheme';

const SOURCE_LABEL: Record<string, string> = {
  drive: 'Google Drive', docs: 'Google Docs', sheets: 'Google Sheets', slides: 'Google Slides', forms: 'Google Forms',
  folder: 'Thư mục Google Drive', youtube: 'YouTube', image: 'Ảnh', pdf: 'PDF', web: 'Trang web', invalid: 'Link chưa đúng',
};
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? 'Trang web';

export function EmbedFrame({ url, title, className = '', rounded = true }: { url: string; title: string; className?: string; rounded?: boolean }) {
  const link = parseDocLink(url);
  const [loaded, setLoaded] = useState(false);
  const [force, setForce] = useState(false);
  useEffect(() => { setLoaded(false); setForce(false); }, [url]);

  const embed = link.embedUrl ?? (force ? link.openUrl : null);
  if (!embed) {
    let host = '';
    try { host = new URL(link.openUrl).hostname.replace(/^www\./, ''); } catch { /* link hỏng */ }
    return (
      <div className={`flex flex-col items-center justify-center text-center gap-3 p-8 bg-white ${rounded ? 'rounded-[16px]' : ''} ${className}`}>
        <div className="w-14 h-14 rounded-[16px] bg-[#0071E3]/10 text-[#0071E3] inline-flex items-center justify-center"><Globe size={26} /></div>
        <div className="text-[15px] font-semibold text-[#1D1D1F]">{host || 'Trang web'}</div>
        <div className="text-[12.5px] text-[#86868B] max-w-[420px] break-all">{link.openUrl}</div>
        <div className="text-[12px] text-[#86868B] max-w-[420px]">Hầu hết trang web (cổng văn bản pháp luật, trang cơ quan…) chặn xem bên trong ứng dụng khác — mở ở thẻ mới để đọc.</div>
        <div className="flex gap-2 mt-1">
          <a href={link.openUrl} target="_blank" rel="noreferrer" className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><ExternalLink size={14} /> Mở trang</a>
          {link.source !== 'invalid' && <button type="button" onClick={() => setForce(true)} className={`${BTN_SECONDARY} h-9 px-4 text-[13px]`}>Thử xem trong app</button>}
        </div>
      </div>
    );
  }

  if (link.source === 'image') {
    return (
      <div className={`flex items-center justify-center bg-[#1D1D1F] ${rounded ? 'rounded-[16px]' : ''} overflow-auto ${className}`}>
        <img src={embed} alt={title} className="max-w-full max-h-full object-contain" />
      </div>
    );
  }

  return (
    <div className={`relative bg-white ${rounded ? 'rounded-[16px]' : ''} overflow-hidden ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12.5px] text-[#86868B] pointer-events-none">
          <Loader2 size={20} className="animate-spin" /> Đang mở {sourceLabel(link.source)}…
        </div>
      )}
      <iframe
        key={embed}
        src={embed}
        title={title}
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 w-full h-full border-0"
        allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

/** Dòng nhắc dưới khung xem file Google. */
export function GoogleAccessHint({ url }: { url: string }) {
  const link = parseDocLink(url);
  if (!link.google) return null;
  return (
    <div className="flex items-start gap-1.5 text-[11.5px] text-[#86868B] leading-snug">
      <ShieldQuestion size={13} className="shrink-0 mt-[1px]" />
      <span>Không hiện nội dung? File cần chia sẻ <b className="font-medium text-[#6E6E73]">"Bất kỳ ai có đường liên kết"</b>, hoặc trình duyệt này phải đăng nhập tài khoản Google có quyền xem. Bấm <b className="font-medium text-[#6E6E73]">Mở Drive</b> để sửa trực tiếp.</span>
    </div>
  );
}
