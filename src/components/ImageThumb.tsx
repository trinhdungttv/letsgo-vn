import { useEffect, useState } from 'react';

/** Ảnh xem trước nhỏ + báo trạng thái tải (ok/bad) để biết link ảnh nào hỏng. */
export default function ImageThumb({ url, onStatus }: { url: string; onStatus: (s: 'ok' | 'bad' | null) => void }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); onStatus(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [url]);
  if (!url.trim()) return <div className="w-10 h-7 rounded bg-gray-50 border border-dashed border-gray-200 shrink-0" title="Chưa có ảnh" />;
  if (bad) return <div className="w-10 h-7 rounded bg-red-50 border border-red-300 text-red-600 text-[9px] font-semibold flex items-center justify-center shrink-0" title="Ảnh lỗi — link không tải được, hãy dán link khác">LỖI</div>;
  return (
    <img src={url.trim()} alt="" referrerPolicy="no-referrer" loading="lazy"
      onLoad={() => onStatus('ok')} onError={() => { setBad(true); onStatus('bad'); }}
      className="w-10 h-7 rounded object-cover border border-gray-200 shrink-0" />
  );
}
