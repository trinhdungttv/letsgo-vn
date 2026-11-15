// Ảnh 360° trong trang chia sẻ Khảo sát KCN cho NGƯỜI NGOÀI (#/ks/<mã>) — CHỈ XEM (migration 228):
// lưới thẻ + trình xem toàn màn (kéo xoay, chụm phóng to) kèm nét vẽ của người khảo sát. Không có sửa / xoá / căn hướng.
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Box, MapPin, X } from 'lucide-react';
import PanoStage, { type PanoStageHandle } from '../../../components/pano/PanoStage';
import { PanoShapesLayer } from '../../../components/pano/PanoOverlay';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { panoSources, panoThumb, type MapPanorama } from '../../../lib/pano/panoramas';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

export function SharedPanoCard({ p, onOpen }: { p: MapPanorama; onOpen: () => void }) {
  const thumb = panoThumb(p);
  return (
    <button onClick={onOpen} className="text-left bg-white rounded-xl overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition">
      <div className="relative aspect-[2/1] bg-[#1d1d1f] flex items-center justify-center text-white/70">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : <Box size={26} />}
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold leading-none text-white bg-black/55">360°</span>
      </div>
      <div className="p-2.5 space-y-0.5">
        <div className="text-[13px] font-semibold leading-tight line-clamp-2">{p.title || 'Ảnh 360°'}</div>
        <div className="text-[11.5px] text-[#86868b] truncate">{[p.zone_name, fmtDate(p.taken_at ?? p.created_at)].filter(Boolean).join(' · ')}</div>
      </div>
    </button>
  );
}

export function SharedPanoViewer({ pano: p, onClose }: { pano: MapPanorama; onClose: () => void }) {
  const mobile = useIsMobile();
  const stageRef = useRef<PanoStageHandle>(null);
  const sources = useMemo(() => panoSources(p), [p.pano_url, p.google_url]); // eslint-disable-line react-hooks/exhaustive-deps
  const coverage = useMemo(() => ({ haov: p.haov, vaov: p.vaov, voffset: p.voffset }), [p.haov, p.vaov, p.voffset]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1300] bg-black flex flex-col pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="true" aria-label="Ảnh 360">
      <div className="relative flex-1 min-h-0">
        <PanoStage ref={stageRef} sources={sources} coverage={coverage} initialView={p.view} mobile={mobile}
          overlay={v => <PanoShapesLayer v={v} shapes={p.annotations} selected={null} editing={false} draft={null} hover={null} />} />
        <div className="absolute top-0 inset-x-0 z-20 pt-2 pb-6 pl-[max(8px,env(safe-area-inset-left))] pr-2 bg-gradient-to-b from-black/60 to-transparent flex items-start gap-2 pointer-events-none">
          <div className="min-w-0 flex-1 text-white pt-1">
            <div className="text-[14px] font-semibold truncate">{p.title || 'Ảnh 360°'}</div>
            <div className="text-[11.5px] text-white/75 truncate">{[p.zone_name, fmtDate(p.taken_at ?? p.created_at), 'kéo để xoay, chụm để phóng to'].filter(Boolean).join(' · ')}</div>
          </div>
          {p.lat != null && p.lng != null && (
            <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer" aria-label="Xem chỗ chụp trên Google Maps"
              className="pointer-events-auto w-11 h-11 rounded-full bg-white/90 text-[#111] flex items-center justify-center shadow"><MapPin size={18} /></a>
          )}
          <button onClick={onClose} aria-label="Đóng" className="pointer-events-auto w-11 h-11 rounded-full bg-white/90 text-[#111] flex items-center justify-center shadow"><X size={19} /></button>
        </div>
        {p.note && (
          <div className="absolute bottom-0 inset-x-0 z-20 p-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/60 to-transparent text-white text-[12.5px] leading-snug pointer-events-none whitespace-pre-wrap">{p.note}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
