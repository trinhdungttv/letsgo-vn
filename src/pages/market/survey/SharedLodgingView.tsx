// Nhà trọ trong trang chia sẻ Khảo sát KCN cho NGƯỜI NGOÀI (#/ks/<mã>) — CHỈ XEM: dòng danh sách + bảng chi tiết.
// Không có Sửa / Xoá / Đo lại, không hiện người ghi. Tên + SĐT chủ nhà chỉ có khi người gửi bật "Hiện tên & SĐT chủ nhà"
// (server đã xoá trắng 2 trường này nếu không bật — migration 222).
import { useEffect, useState } from 'react';
import { Bike, Check, ExternalLink, Footprints, Home, MapPin, MessageCircle, Phone, X } from 'lucide-react';
import {
  directionsLink, fmtKm, fmtMin, fmtRent, lodgingTitle, phoneDigits, type Lodging, type LodgingPhoto, type LodgingPhotoKind,
} from '../../../lib/kcnSurvey/lodgingCore';

const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/** 1 dòng nhà trọ trong danh sách (ảnh bìa, phòng / giá, công ty gần nhất). */
export function SharedLodgingRow({ l, active, onOpen, onMap }: { l: Lodging; active?: boolean; onOpen: () => void; onMap?: () => void }) {
  const cover = l.photos.find(p => p.kind === 'house') ?? l.photos[0];
  const near = l.routes[0];
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 transition ${active ? 'bg-[#fff4e0]' : 'hover:bg-[#fafafa]'}`}>
      <button onClick={onOpen} className="w-14 h-14 rounded-lg overflow-hidden bg-[#FFF4E5] text-[#FF9500] flex items-center justify-center shrink-0" aria-label={`Xem ${lodgingTitle(l)}`}>
        {cover ? <img src={cover.thumb_url || cover.url} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Home size={22} />}
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="text-[13px] font-semibold leading-tight truncate">{lodgingTitle(l)}</div>
        <div className="text-[11.5px] text-[#6e6e73] truncate">
          {[l.total_rooms != null && `${l.total_rooms} phòng`, l.vacant_rooms != null && `trống ${l.vacant_rooms}`, fmtRent(l.rent_min, l.rent_max), l.zone_name].filter(Boolean).join(' · ') || 'Chưa ghi số phòng / giá'}
        </div>
        {near && (
          <div className="text-[11.5px] text-[#0071e3] truncate flex items-center gap-1">
            <Bike size={12} className="shrink-0" /> <span className="truncate">{near.name} · {fmtMin(near.moto_min)}{near.walk_min != null ? ` · đi bộ ${fmtMin(near.walk_min)}` : ''}</span>
          </div>
        )}
      </button>
      {onMap && l.lat != null && l.lng != null && (
        <button onClick={onMap} title="Xem trên bản đồ" aria-label="Xem trên bản đồ" className="w-9 h-9 rounded-full bg-[#f0f0f2] text-[#444] flex items-center justify-center shrink-0"><MapPin size={15} /></button>
      )}
    </div>
  );
}

/** Bảng chi tiết nhà trọ (bottom sheet trên điện thoại, hộp giữa màn trên máy tính). */
export function SharedLodgingDetail({ lodging: l, showLandlord, onClose }: { lodging: Lodging; showLandlord: boolean; onClose: () => void }) {
  const [zoom, setZoom] = useState<LodgingPhoto | null>(null);
  const digits = showLandlord ? phoneDigits(l.landlord_phone) : '';
  const hasLandlord = showLandlord && !!(l.landlord_name || l.landlord_phone);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (zoom) setZoom(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, onClose]);

  const photoStrip = (kind: LodgingPhotoKind, title: string) => {
    const list = l.photos.filter(p => p.kind === kind);
    if (!list.length) return null;
    return (
      <section>
        <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wide mb-1.5">{title} · {list.length}</div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {list.map(p => (
            <div key={p.id} className="shrink-0 w-28">
              <button onClick={() => setZoom(p)} className="block w-28 h-28 rounded-xl overflow-hidden bg-[#ececf0]">
                <img src={p.thumb_url || p.url} alt={p.caption} loading="lazy" className="w-full h-full object-cover" />
              </button>
              {p.caption && <div className="mt-1 text-[11px] text-[#6e6e73] line-clamp-2">{p.caption}</div>}
            </div>
          ))}
        </div>
      </section>
    );
  };

  const from = l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null;

  return (
    <div className="fixed inset-0 z-[1300] bg-black/45 flex items-end md:items-center justify-center md:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl max-h-[92dvh] flex flex-col shadow-[0_24px_80px_rgba(0,0,0,0.3)]" role="dialog" aria-modal="true" aria-label={lodgingTitle(l)}>
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-black/[0.06]">
          <div className="w-11 h-11 rounded-2xl bg-[#FFF4E5] text-[#FF9500] flex items-center justify-center shrink-0"><Home size={22} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold tracking-tight leading-tight">{lodgingTitle(l)}</div>
            <div className="text-[12px] text-[#86868b] mt-0.5 leading-snug">{[l.zone_name, l.address, l.created_at && `khảo sát ${fmtDate(l.created_at)}`].filter(Boolean).join(' · ')}</div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="w-8 h-8 -mr-1 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f0f0f2] shrink-0"><X size={17} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          {hasLandlord ? (
            <div className="rounded-xl bg-[#f5f5f7] px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[11.5px] text-[#86868b]">Chủ nhà</div>
                <div className="text-[14.5px] font-medium truncate">{[l.landlord_name, l.landlord_phone].filter(Boolean).join(' · ')}</div>
              </div>
              {digits && <a href={`tel:${digits}`} className="h-9 px-3 rounded-full bg-[#34C759] text-white text-[13px] font-semibold inline-flex items-center gap-1 shrink-0"><Phone size={14} /> Gọi</a>}
              {digits && <a href={`https://zalo.me/${digits}`} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-full bg-[#0A84FF] text-white text-[13px] font-semibold inline-flex items-center gap-1 shrink-0"><MessageCircle size={14} /> Zalo</a>}
            </div>
          ) : !showLandlord && (
            <div className="rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-[12.5px] text-[#6e6e73] leading-snug">Cần thông tin chủ nhà? Liên hệ Let's Go VN để được giới thiệu.</div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Fact label="Tổng số phòng" value={l.total_rooms != null ? String(l.total_rooms) : '—'} />
            <Fact label="Còn trống" value={l.vacant_rooms != null ? String(l.vacant_rooms) : '—'} />
            <Fact label="Giá / tháng" value={fmtRent(l.rent_min, l.rent_max) || '—'} />
          </div>

          {photoStrip('house', 'Ảnh nhà trọ')}
          {photoStrip('facility', 'Cơ sở vật chất')}

          {l.facilities.length > 0 && (
            <section>
              <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wide mb-1.5">Tiện ích</div>
              <div className="flex flex-wrap gap-1.5">
                {l.facilities.map(f => <span key={f} className="h-7 px-2.5 rounded-full bg-[#E8F7EE] text-[#137333] text-[12.5px] font-medium inline-flex items-center gap-1"><Check size={12} /> {f}</span>)}
              </div>
            </section>
          )}

          {l.note && (
            <section>
              <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wide mb-1">Ghi chú</div>
              <div className="text-[13.5px] leading-snug whitespace-pre-wrap">{l.note}</div>
            </section>
          )}

          {from && (
            <section>
              <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wide mb-1.5">Khoảng cách tới công ty</div>
              {l.routes.length ? (
                <div className="rounded-xl bg-[#f5f5f7] divide-y divide-black/[0.06]">
                  {l.routes.map(r => (
                    <div key={r.key} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                        <span className="flex-1 min-w-0 text-[13.5px] font-medium truncate">{r.name}</span>
                        {r.kind && <span className="text-[11px] text-[#86868b] shrink-0">{r.kind}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-[#3a3a3c] tabular-nums">
                        <a href={directionsLink(from, r, 'moto')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[#0071e3]" title="Xem đường xe máy trên Google Maps">
                          <Bike size={14} className="text-[#0A84FF]" /> {fmtKm(r.moto_km)} · {fmtMin(r.moto_min)}
                        </a>
                        <a href={directionsLink(from, r, 'walk')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[#0071e3]" title="Xem đường đi bộ trên Google Maps">
                          <Footprints size={14} className="text-[#34C759]" /> {fmtKm(r.walk_km)} · {fmtMin(r.walk_min)}
                        </a>
                        {r.engine === 'estimate' && <span className="text-[10.5px] text-[#FF9500]">ước tính</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-[12.5px] text-[#86868b]">Chưa có số liệu khoảng cách.</div>}
              <a href={`https://www.google.com/maps/search/?api=1&query=${from.lat},${from.lng}`} target="_blank" rel="noopener noreferrer"
                className="mt-2.5 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-[#eef5ff] text-[#0071e3] text-[13px] font-medium"><ExternalLink size={13} /> Mở vị trí nhà trọ trên Google Maps</a>
            </section>
          )}
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[1350] bg-black flex flex-col" onClick={() => setZoom(null)}>
          <button aria-label="Đóng ảnh" className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center"><X size={18} /></button>
          <div className="flex-1 min-h-0 flex items-center justify-center p-2"><img src={zoom.url} alt={zoom.caption} className="max-w-full max-h-full object-contain" /></div>
          {zoom.caption && <div className="shrink-0 px-4 py-3 text-white text-[14px] text-center">{zoom.caption}</div>}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
      <div className="text-[11px] text-[#86868b]">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums truncate">{value}</div>
    </div>
  );
}
