// Thêm ảnh 360° khi khảo sát KCN: dán link Google Photos / Google Drive (hoặc tải ảnh từ máy) → máy chủ lấy ảnh + đọc GPS / hướng
// → chỗ đứng chụp: GPS trong ảnh > GPS điện thoại đang bật (màn khảo sát) > chọn trên bản đồ nhỏ → lưu rồi mở ngay trình xem.
// Ảnh flycam DJI: GPS + hướng + độ cao bay đọc từ XMP drone-dji → tự đặt chỗ, hướng, "Flycam" đúng độ cao, không phải căn tay.
// Ảnh có GPS mà xa chỗ đang khảo sát (> 5 km) → không gắn vào chuyến / KCN đang khảo sát, tên ảnh theo KCN gần ảnh.
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, Camera, Check, ExternalLink, ImagePlus, Link2, Loader2, X } from 'lucide-react';
import PanoPositionPicker from './PanoPositionPicker';
import { useAuth } from '../../lib/auth';
import { classifyPanoLink, looksSpherical } from '../../lib/pano/links';
import {
  createPanorama, importPanoLink, panoThumb, uploadPanoFile, PanoMissingTable, PANO_MIGRATION_HINT,
  type MapPanorama, type PanoCandidate, type PanoImageInfo,
} from '../../lib/pano/panoramas';
import { distanceM } from '../../lib/pano/sphere';
import { isValidVnLatLng, type LatLng } from '../../lib/geo';

/** Độ cao bay (m) từ đó coi là ảnh chụp trên cao. */
const AERIAL_MIN_M = 15;
/** Ảnh cách chỗ đang khảo sát xa hơn chừng này (km) thì coi là chụp nơi khác. */
const FAR_FROM_SURVEY_KM = 5;

export default function AddPanoModal({ mapCenter, livePos, survey, zones, onClose, onCreated }: {
  mapCenter: LatLng;
  /** Vị trí GPS điện thoại lúc bấm thêm (đang khảo sát) — dùng khi ảnh không có GPS. */
  livePos?: LatLng | null;
  /** Chuyến + KCN đang khảo sát → gắn vào ảnh. */
  survey?: { tripId: string | null; zoneId: string | null; zoneName: string };
  /** KCN có toạ độ — gợi ý tên ảnh theo KCN gần nhất. */
  zones: { name: string; lat: number; lng: number }[];
  onClose: () => void;
  onCreated: (p: MapPanorama) => void;
}) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.username || '';
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [cands, setCands] = useState<PanoCandidate[] | null>(null);
  const [info, setInfo] = useState<PanoImageInfo | null>(null);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [aerial, setAerial] = useState(false);

  const linkKind = classifyPanoLink(link)?.kind ?? null;

  const gotImage = (i: PanoImageInfo) => {
    setInfo(i);
    setCands(null);
    setErr(null);
    const gps = i.meta.lat != null && i.meta.lng != null ? { lat: i.meta.lat, lng: i.meta.lng } : null;
    setPos(gps && isValidVnLatLng(gps) ? gps : livePos && isValidVnLatLng(livePos) ? livePos : null);
    setAerial((i.meta.heightM ?? 0) >= AERIAL_MIN_M);
  };

  const fetchLink = async (pick?: string) => {
    if (!link.trim()) return;
    if (!linkKind) { setErr({ code: 'badlink', message: 'Chưa nhận ra link — dán link chia sẻ Google Photos, Google Drive hoặc link ảnh (https://…).' }); return; }
    setErr(null);
    setBusy(pick ? 'Đang lấy ảnh đã chọn…' : 'Đang lấy ảnh 360 từ link… (ảnh to có thể mất 10–20 giây)');
    const r = await importPanoLink(link.trim(), pick);
    setBusy(null);
    if (r.status === 'ok') gotImage(r.info);
    else if (r.status === 'pick') setCands(r.candidates);
    else setErr({ code: r.code, message: r.message });
  };

  const fromFile = async (file: File) => {
    setErr(null);
    setBusy('Đang tải ảnh lên…');
    try {
      gotImage(await uploadPanoFile(file));
    } catch (e) {
      setErr({ code: 'upload', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const nearestZone = useMemo(() => {
    if (!pos) return null;
    let best: { name: string; d: number } | null = null;
    for (const z of zones) {
      const d = distanceM(pos, z);
      if (d < 4000 && (!best || d < best.d)) best = { name: z.name, d };
    }
    return best?.name ?? null;
  }, [pos, zones]);
  // Ảnh có GPS riêng mà cách chỗ đang khảo sát quá xa → ảnh chụp nơi khác (vd ảnh flycam cũ), không gắn vào KCN / chuyến này
  // (chỉ so với GPS điện thoại lúc bấm thêm — tâm bản đồ ở tab có thể là toạ độ mặc định khi KCN chưa có toạ độ)
  const photoGps = info?.meta.lat != null && info.meta.lng != null ? { lat: info.meta.lat, lng: info.meta.lng } : null;
  const farKm = photoGps && livePos ? distanceM(photoGps, livePos) / 1000 : 0;
  const farFromSurvey = farKm > FAR_FROM_SURVEY_KM;
  const zoneForTitle = (farFromSurvey ? '' : survey?.zoneName) || nearestZone;
  const autoTitle = zoneForTitle ? `Ảnh 360 — KCN ${zoneForTitle.replace(/^KCN\s+/i, '')}` : `Ảnh 360 — ${new Date().toLocaleDateString('vi-VN')}`;
  const finalTitle = titleTouched ? title : autoTitle;
  // Flycam DJI ghi độ cao bay → ghim công ty trong ảnh nằm đúng chỗ hơn so với mặc định 100 m
  const metaHeight = info?.meta.heightM && info.meta.heightM >= AERIAL_MIN_M ? info.meta.heightM : null;
  const aerialHeight = metaHeight ?? 100;

  const save = async () => {
    if (!info || !pos) return;
    setBusy('Đang lưu…');
    setErr(null);
    try {
      const row = await createPanorama({
        title: finalTitle || 'Ảnh 360', info, lat: pos.lat, lng: pos.lng,
        heading: info.meta.heading ?? null, cameraHeight: aerial ? aerialHeight : 2, userName,
        tripId: farFromSurvey ? null : survey?.tripId ?? null,
        zoneId: farFromSurvey ? null : survey?.zoneId ?? null,
        zoneName: farFromSurvey ? '' : survey?.zoneName ?? '',
      });
      onCreated(row);
    } catch (e) {
      setErr({ code: 'save', message: e instanceof PanoMissingTable ? PANO_MIGRATION_HINT : 'Không lưu được: ' + (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const ratioOk = !info?.width || !info.height || looksSpherical(info.width, info.height) || !!info.meta.isPano;
  const preview = info ? (panoThumb({ google_url: info.googleUrl }, 960, 480) ?? info.panoUrl) : null;
  const gps = photoGps;
  const headingFrom = info?.meta.headingFrom === 'dji' ? ' · hướng flycam' : '';

  // Gắn thẳng vào <body>: trang Khảo sát render form này trong `space-y-3` → lớp `fixed inset-0` bị margin-top 12 px (lệch, hở mép trên).
  // Điện thoại: không cao quá vùng dưới thanh trạng thái, chừa thanh home ở đáy.
  return createPortal(
    <div className="fixed inset-0 z-[1300] m-0 bg-black/45 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full md:max-w-xl bg-white rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)-8px))] overflow-y-auto pb-[env(safe-area-inset-bottom)] md:pb-0" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white flex items-center gap-2 px-4 pt-4 pb-3 border-b border-[#F0F0F2]">
          {info && <button onClick={() => { setInfo(null); setPos(null); }} disabled={!!busy} aria-label="Quay lại" className="w-11 h-11 -my-1.5 -ml-2.5 md:w-8 md:h-8 md:my-0 md:-ml-1 inline-flex items-center justify-center rounded-lg text-[#555] hover:bg-black/[0.05]"><ArrowLeft size={16} /></button>}
          <div className="w-9 h-9 rounded-xl bg-[#EAF3FF] text-[#0A84FF] flex items-center justify-center shrink-0"><Camera size={18} /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[14.5px] font-semibold text-[#111]">{info ? 'Chỗ đứng chụp' : 'Thêm ảnh 360°'}</div>
            <div className="text-[11.5px] text-[#888]">{info ? 'Đặt đúng chỗ để hệ thống biết công ty nào ở gần ảnh' : 'Từ Google Photos, Google Drive hoặc tải từ máy'}</div>
          </div>
          <button onClick={onClose} disabled={!!busy} aria-label="Đóng" className="w-11 h-11 -my-1.5 -mr-2.5 md:w-8 md:h-8 md:my-0 md:-mr-1 inline-flex items-center justify-center rounded-lg text-[#999] hover:text-[#444] hover:bg-black/[0.05]"><X size={17} /></button>
        </div>

        <div className="p-4 space-y-3">
          {!info ? (
            <>
              <div>
                <div className="text-[12px] font-medium text-[#444] mb-1.5">Dán link ảnh 360</div>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
                    <input value={link} autoFocus onChange={e => { setLink(e.target.value); setErr(null); setCands(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') void fetchLink(); }}
                      placeholder="https://photos.google.com/share/… hoặc https://drive.google.com/file/d/…"
                      className="w-full h-10 pl-8 pr-3 rounded-xl border border-[#D5D5DC] text-[13px] outline-none focus:border-[#1D4ED8]" />
                  </div>
                  <button onClick={() => void fetchLink()} disabled={!link.trim() || !!busy}
                    className="h-10 px-4 rounded-xl bg-[#1D4ED8] text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#1E40AF]">Lấy ảnh</button>
                </div>
                {linkKind && !busy && !err && (
                  <div className="mt-1 text-[11.5px] text-[#888]">
                    Nhận ra: {linkKind === 'gphotos' ? 'Google Photos' : linkKind === 'gdrive' ? 'Google Drive' : linkKind === 'gimage' ? 'ảnh Google' : 'link ảnh'}
                  </div>
                )}
              </div>

              {busy && <div className="flex items-center gap-2 text-[12.5px] text-[#555]"><Loader2 size={15} className="animate-spin text-[#1D4ED8]" /> {busy}</div>}

              {err && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
                  <AlertTriangle size={15} className="shrink-0 mt-px" />
                  <div className="flex-1 space-y-1.5">
                    <div>{err.message}</div>
                    {err.code === 'shortlink' && (
                      <a href={link.trim()} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-white border border-amber-300 font-semibold text-amber-900">
                        <ExternalLink size={12} /> Mở link
                      </a>
                    )}
                  </div>
                </div>
              )}

              {cands && (
                <div>
                  <div className="text-[12px] font-medium text-[#444] mb-1.5">Album có {cands.length} ảnh — chọn ảnh 360 cần thêm</div>
                  <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                    {cands.map(c => (
                      <button key={c.url} onClick={() => void fetchLink(c.url)} disabled={!!busy}
                        className="relative rounded-xl overflow-hidden border border-[#E0E0E5] hover:border-[#1D4ED8] text-left">
                        <img src={c.thumb} alt="" loading="lazy" className="w-full aspect-[2/1] object-cover bg-[#EEE]" />
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10.5px]">
                          {c.width}×{c.height}{looksSpherical(c.width, c.height) ? ' · 360°' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-[#F7F7F9] p-3 text-[11.5px] text-[#555] space-y-1.5">
                <div><b>Google Photos:</b> mở ảnh → Chia sẻ → Tạo đường liên kết → dán vào đây.</div>
                <div><b>Không mở được vì quyền riêng tư?</b> Tải ảnh lên Google Drive → Chia sẻ → "Bất kỳ ai có đường liên kết" → dán link Drive. Hệ thống tự làm ảnh xoay được như Google Photos.</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#EEE]" /><span className="text-[11px] text-[#AAA]">hoặc</span><div className="flex-1 h-px bg-[#EEE]" />
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromFile(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={!!busy}
                className="w-full h-10 rounded-xl border border-dashed border-[#B9B9C3] text-[13px] font-medium text-[#444] inline-flex items-center justify-center gap-1.5 hover:bg-[#F7F7F9] disabled:opacity-50">
                <ImagePlus size={15} /> Tải ảnh 360 từ máy
              </button>
            </>
          ) : (
            <>
              {preview && <img src={preview} alt="" className="w-full aspect-[3/1] object-cover rounded-xl bg-[#EEE]" />}
              {!ratioOk && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11.5px] text-amber-900">
                  <AlertTriangle size={14} className="shrink-0 mt-px" /> Ảnh không theo tỉ lệ 2:1 nên có thể không phải ảnh 360 trọn — vẫn xem xoay được như ảnh toàn cảnh.
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {gps ? <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Có GPS trong ảnh</span>
                  : <span className="px-2 py-0.5 rounded-full bg-[#F2F2F5] text-[#666]">Ảnh không có GPS — chọn vị trí trên bản đồ</span>}
                {info.meta.device && <span className="px-2 py-0.5 rounded-full bg-[#EAF3FF] text-[#0A64D8] border border-[#CFE3FF]">{info.meta.device}{metaHeight ? ` · bay cao ${metaHeight} m` : ''}</span>}
                {info.meta.heading != null ? <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Có hướng la bàn ({Math.round(info.meta.heading)}°{headingFrom}) — không cần căn</span>
                  : <span className="px-2 py-0.5 rounded-full bg-[#F2F2F5] text-[#666]">Chưa có hướng — căn 1 lần sau khi lưu</span>}
                {info.width && info.height && <span className="px-2 py-0.5 rounded-full bg-[#F2F2F5] text-[#666]">{info.width}×{info.height}</span>}
              </div>

              <div>
                <div className="text-[12px] font-medium text-[#444] mb-1">Tên ảnh</div>
                <input value={finalTitle} onChange={e => { setTitle(e.target.value); setTitleTouched(true); }} maxLength={120}
                  className="w-full h-9 px-3 rounded-lg border border-[#D5D5DC] text-[13px] outline-none focus:border-[#1D4ED8]" />
              </div>

              {farFromSurvey && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11.5px] text-amber-900">
                  <AlertTriangle size={14} className="shrink-0 mt-px" />
                  <span>Theo GPS trong ảnh, ảnh chụp cách chỗ đang khảo sát ~{Math.round(farKm)} km — đặt ghim theo GPS ảnh{survey?.zoneName ? `, không gắn vào ${survey.zoneName}` : ''}.</span>
                </div>
              )}
              {livePos && !gps && pos && pos.lat === livePos.lat && pos.lng === livePos.lng && (
                <div className="text-[11.5px] text-emerald-700">Đang dùng vị trí GPS điện thoại lúc bấm thêm — kéo ghim nếu chụp ở chỗ khác.</div>
              )}
              <PanoPositionPicker value={pos} onChange={setPos} fallbackCenter={livePos ?? mapCenter} photoGps={gps} height={240} />

              <div className="flex items-center gap-1.5 text-[12px]">
                <span className="text-[#666] mr-1">Chụp từ</span>
                {[{ v: false, label: 'Dưới đất' }, { v: true, label: metaHeight ? `Flycam ${metaHeight} m` : 'Flycam / trên cao' }].map(o => (
                  <button key={String(o.v)} onClick={() => setAerial(o.v)}
                    className={`h-8 px-3 rounded-lg border font-medium ${aerial === o.v ? 'border-[#1D4ED8] bg-[#1D4ED8]/[0.07] text-[#1D4ED8]' : 'border-[#D8D6D0] text-[#444]'}`}>{o.label}</button>
                ))}
              </div>

              {err && <div className="text-[12px] text-red-600">{err.message}</div>}

              <button onClick={() => void save()} disabled={!pos || !!busy}
                className="w-full h-10 rounded-xl bg-[#1D4ED8] text-white text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 hover:bg-[#1E40AF]">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Lưu & mở ảnh 360
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
