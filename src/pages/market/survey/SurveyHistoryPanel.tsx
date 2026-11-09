// Lịch sử khảo sát: các chuyến đã đi (xem lại vết trên bản đồ) + thư viện ảnh chỉ tiêu (xem ảnh chụp ở đâu).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Camera, ChevronDown, ChevronRight, Loader2, MapPin, Pencil, Route, Trash2, X } from 'lucide-react';
import type { MarketZone } from '../../../lib/types';
import {
  listPhotos, listTrips, loadTracks, deleteTripWithPin, titleColumnMissing, TITLE_MIGRATION_HINT, updateTrip,
  type SurveyPhoto, type SurveyTrip,
} from '../../../lib/kcnSurvey/api';
import { surveyTitle } from '../../../lib/kcnSurvey/zones';
import { STATUS_META, type SurveyStatus } from '../../../lib/kcnSurvey/companies';
import { fmtDistance, fmtDuration, trackBounds, trackLength, type TrackSegment } from '../../../lib/kcnSurvey/track';
import { fold } from './surveyData';
import SurveyPhotoViewer, { PhotoThumb } from './SurveyPhotoViewer';
import { fmtDateTime } from './surveyFormat';
import SurveyPinGate from './SurveyPinGate';
import type { PinRequest } from '../../../components/quickNotes/PinDialog';

export interface PhotoFilter {
  label: string;
  match: (p: SurveyPhoto) => boolean;
}

interface Props {
  zones: MarketZone[];
  defaultZoneId: string | null;
  initialTab: 'trips' | 'photos';
  photoFilter: PhotoFilter | null;
  activeTripId: string | null;
  onShowTrip: (trip: SurveyTrip, segments: TrackSegment[]) => void;
  onShowPhoto: (photo: SurveyPhoto) => void;
  onChanged: () => void;
  onClose: () => void;
  say: (msg: string) => void;
  /** Sao công ty (cần chú trọng) của ảnh — dùng chung với bản đồ khảo sát */
  starOf?: (p: SurveyPhoto) => boolean;
  onStar?: (p: SurveyPhoto) => void;
}

export default function SurveyHistoryPanel({ zones, defaultZoneId, initialTab, photoFilter, activeTripId, onShowTrip, onShowPhoto, onChanged, onClose, say, starOf, onStar }: Props) {
  const [tab, setTab] = useState<'trips' | 'photos'>(initialTab);
  const [zoneFilter, setZoneFilter] = useState<string>(defaultZoneId ?? 'all');
  const [filter, setFilter] = useState<PhotoFilter | null>(photoFilter);
  const [trips, setTrips] = useState<SurveyTrip[]>([]);
  const [photos, setPhotos] = useState<SurveyPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const [viewer, setViewer] = useState<SurveyPhoto | null>(null);
  const [search, setSearch] = useState('');
  const [busyTrip, setBusyTrip] = useState<string | null>(null);
  const [pinReq, setPinReq] = useState<Extract<PinRequest, { kind: 'verify' }> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const zoneId = zoneFilter === 'all' ? null : zoneFilter;
      const [t, p] = await Promise.all([listTrips({ zoneId, limit: 120 }), listPhotos({ zoneId, limit: 400 })]);
      setTrips(t);
      setPhotos(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [zoneFilter]);

  useEffect(() => { void load(); }, [load]);

  const zoneOptions = useMemo(() => [...zones].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [zones]);

  const shownPhotos = useMemo(() => {
    const q = fold(search.trim());
    return photos.filter(p => (!filter || filter.match(p)) && (!q || fold([p.company_name, p.positions, p.note, p.zone_name, p.wage_text].join(' ')).includes(q)));
  }, [photos, filter, search]);

  const photosByTrip = useMemo(() => {
    const m = new Map<string, number>();
    photos.forEach(p => { if (p.trip_id) m.set(p.trip_id, (m.get(p.trip_id) ?? 0) + 1); });
    return m;
  }, [photos]);

  const showTrip = async (t: SurveyTrip) => {
    setBusyTrip(t.id);
    try {
      const tracks = await loadTracks([t.id]);
      onShowTrip(t, tracks.get(t.id) ?? []);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusyTrip(null);
    }
  };

  /** Chuyến bị ngắt giữa chừng trên máy khác / đã xoá dữ liệu máy → tính tổng kết từ vết đã lưu. */
  const closeTrip = async (t: SurveyTrip) => {
    setBusyTrip(t.id);
    try {
      const segs = (await loadTracks([t.id])).get(t.id) ?? [];
      const b = trackBounds(segs);
      const lastT = segs.length ? Math.max(...segs.map(s => s[s.length - 1][2])) : 0;
      await updateTrip(t.id, {
        ended_at: new Date(new Date(t.started_at).getTime() + lastT * 1000).toISOString(),
        distance_m: Math.round(trackLength(segs) * 10) / 10,
        min_lat: b?.minLat ?? null, min_lng: b?.minLng ?? null, max_lat: b?.maxLat ?? null, max_lng: b?.maxLng ?? null,
      });
      say('Đã kết thúc chuyến');
      await load();
      onChanged();
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusyTrip(null);
    }
  };

  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const saveTitle = async (t: SurveyTrip) => {
    if (!renaming) return;
    const title = renaming.value.trim() || surveyTitle(t.zone_name, new Date(t.started_at));
    try {
      await updateTrip(t.id, { title });
      if (titleColumnMissing()) { say(TITLE_MIGRATION_HINT); return; }
      setTrips(list => list.map(x => (x.id === t.id ? { ...x, title } : x)));
      setRenaming(null);
      onChanged();
    } catch (e) { say((e as Error).message); }
  };

  // Xoá chuyến BẮT BUỘC nhập mã 4 số (mã phụ của hệ thống) — server cũng chặn nếu thiếu mã (migration 212)
  const deleteTrip = (t: SurveyTrip) => {
    setPinReq({
      kind: 'verify', danger: true, confirmLabel: 'Xoá chuyến',
      title: 'Nhập mã để xoá chuyến khảo sát',
      message: `${t.title || t.zone_name || 'Chuyến khảo sát'} · ${new Date(t.started_at).toLocaleDateString('vi-VN')}. Chuyến vào Lưu trữ 30 ngày (tab Khảo sát KCN → Lưu trữ, khôi phục được), không còn tính là đường đã đi. Ảnh chỉ tiêu và ghi âm của chuyến vẫn giữ nguyên.`,
      run: async pin => {
        await deleteTripWithPin(t.id, pin);
        say('Đã chuyển chuyến vào Lưu trữ (30 ngày)');
        await load();
        onChanged();
      },
    });
  };

  return (
    <div className="pointer-events-auto fixed md:absolute inset-0 md:inset-auto md:right-3 md:top-[68px] md:bottom-3 md:w-[400px] z-[1250] bg-[#F2F2F7] md:rounded-2xl md:shadow-2xl flex flex-col pt-[env(safe-area-inset-top)] md:pt-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
        <div className="flex-1 text-[17px] font-semibold text-[#1D1D1F]">Lịch sử khảo sát</div>
        <button onClick={onClose} className="h-9 px-3 rounded-full bg-[#E5E5EA] flex items-center gap-1 text-[13px] font-medium text-[#3A3A3C]" aria-label="Đóng">
          <X size={15} /> Đóng
        </button>
      </div>
      <div className="px-4 pb-2 space-y-2 shrink-0">
        <div className="grid grid-cols-2 p-0.5 rounded-lg bg-[#E5E5EA]">
          {(['trips', 'photos'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`h-8 rounded-md text-[13px] font-medium transition ${tab === t ? 'bg-white shadow-sm text-[#1D1D1F]' : 'text-[#3A3A3C]'}`}>
              {t === 'trips' ? `Chuyến đi (${trips.length})` : `Ảnh chỉ tiêu (${photos.length})`}
            </button>
          ))}
        </div>
        <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-white text-[14px] text-[#1D1D1F] outline-none border border-black/5">
          <option value="all">Tất cả KCN</option>
          {zoneOptions.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        {tab === 'photos' && (
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm công ty, vị trí tuyển, ghi chú…"
            className="w-full h-10 px-3 rounded-xl bg-white text-[14px] outline-none border border-black/5 placeholder:text-[#8E8E93]" />
        )}
        {tab === 'photos' && filter && (
          <div className="flex items-center gap-2 rounded-xl bg-[#E8F1FF] px-3 py-2 text-[12.5px] text-[#0A4DB5]">
            <span className="flex-1 min-w-0 truncate">Đang lọc: {filter.label}</span>
            <button onClick={() => setFilter(null)} className="font-semibold shrink-0">Bỏ lọc</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
        {loading && <div className="py-10 flex justify-center text-[#8E8E93]"><Loader2 className="animate-spin" size={20} /></div>}
        {!loading && error && <div className="rounded-xl bg-[#FFECEC] text-[#B00020] text-[13px] px-3 py-2.5">{error}</div>}

        {!loading && !error && tab === 'trips' && (
          trips.length === 0
            ? <Empty icon={<Route size={22} />} text="Chưa có chuyến khảo sát nào" />
            : <div className="space-y-2">
              {trips.map(t => {
                const open = openTrip === t.id;
                const dur = t.ended_at ? (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 1000 : null;
                const groups = groupPassed(t.passed);
                return (
                  <div key={t.id} className="rounded-xl bg-white overflow-hidden">
                    <button onClick={() => setOpenTrip(open ? null : t.id)} className="w-full flex items-start gap-2 px-3 py-2.5 text-left">
                      <div className="flex-1 min-w-0">
                        <div className="text-[14.5px] font-semibold text-[#1D1D1F] line-clamp-2">{t.title || t.zone_name || 'Không gắn KCN'}</div>
                        <div className="text-[12px] text-[#8E8E93] mt-0.5">
                          {t.title && t.zone_name && !t.title.includes(t.zone_name) ? `${t.zone_name} · ` : ''}{fmtDateTime(t.started_at)}{t.user_name ? ` · ${t.user_name}` : ''}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[11.5px]">
                          <Pill>{fmtDistance(t.distance_m)}</Pill>
                          {dur != null && <Pill>{fmtDuration(dur)}</Pill>}
                          {t.road_coverage != null && <Pill>Phủ {t.road_coverage.toLocaleString('vi-VN')}% đường</Pill>}
                          {t.passed.length > 0 && <Pill>{t.passed.length} công ty</Pill>}
                          {(photosByTrip.get(t.id) ?? 0) > 0 && <Pill>📷 {photosByTrip.get(t.id)}</Pill>}
                          {!t.ended_at && <span className="px-1.5 py-0.5 rounded-md bg-[#FFF4E5] text-[#B25000] font-medium">{t.id === activeTripId ? 'Đang đi' : 'Chưa kết thúc'}</span>}
                        </div>
                      </div>
                      {open ? <ChevronDown size={16} className="text-[#C7C7CC] mt-1" /> : <ChevronRight size={16} className="text-[#C7C7CC] mt-1" />}
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-2.5 border-t border-black/5 pt-2.5">
                        <div className="flex gap-1.5 flex-wrap">
                          <button onClick={() => showTrip(t)} disabled={busyTrip === t.id}
                            className="h-9 px-3 rounded-full bg-[#0A84FF] text-white text-[12.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                            {busyTrip === t.id ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />} Xem trên bản đồ
                          </button>
                          {!t.ended_at && t.id !== activeTripId && (
                            <button onClick={() => closeTrip(t)} disabled={busyTrip === t.id}
                              className="h-9 px-3 rounded-full bg-[#F2F2F7] text-[12.5px] font-medium text-[#1D1D1F] disabled:opacity-50">Kết thúc chuyến</button>
                          )}
                          <button onClick={() => setRenaming({ id: t.id, value: t.title || surveyTitle(t.zone_name, new Date(t.started_at)) })}
                            className="h-9 px-3 rounded-full bg-[#F2F2F7] text-[12.5px] font-medium text-[#1D1D1F] inline-flex items-center gap-1">
                            <Pencil size={13} /> Đổi tên
                          </button>
                          {t.id !== activeTripId && (
                            <button onClick={() => deleteTrip(t)} className="h-9 px-3 rounded-full bg-[#FFECEC] text-[12.5px] font-medium text-[#D70015] inline-flex items-center gap-1">
                              <Trash2 size={13} /> Xoá
                            </button>
                          )}
                        </div>
                        {renaming?.id === t.id && (
                          <div className="flex gap-1.5">
                            <input value={renaming.value} onChange={e => setRenaming({ id: t.id, value: e.target.value })} autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') void saveTitle(t); }}
                              className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-[#F2F2F7] text-[14px] outline-none" />
                            <button onClick={() => void saveTitle(t)} className="h-10 px-3 rounded-xl bg-[#0A84FF] text-white text-[13px] font-semibold shrink-0">Lưu</button>
                            <button onClick={() => setRenaming(null)} className="h-10 px-2.5 rounded-xl bg-[#F2F2F7] text-[13px] shrink-0">Huỷ</button>
                          </div>
                        )}
                        {t.note && <div className="text-[12.5px] text-[#3A3A3C] whitespace-pre-line">{t.note}</div>}
                        {groups.length > 0 && (
                          <div className="space-y-2">
                            {groups.map(g => (
                              <div key={g.status}>
                                <div className="text-[11px] font-semibold mb-0.5" style={{ color: STATUS_META[g.status].color }}>{STATUS_META[g.status].label} ({g.items.length})</div>
                                <div className="text-[12.5px] text-[#1D1D1F] leading-relaxed">{g.items.map(i => i.name).join(' · ')}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
        )}

        {!loading && !error && tab === 'photos' && (
          shownPhotos.length === 0
            ? <Empty icon={<Camera size={22} />} text={photos.length ? 'Không có ảnh khớp bộ lọc' : 'Chưa có ảnh chỉ tiêu nào'} />
            : <div className="grid grid-cols-3 gap-1.5">
              {shownPhotos.map(p => (
                <button key={p.id} onClick={() => setViewer(p)} className="relative aspect-square rounded-lg overflow-hidden bg-[#E5E5EA] text-left">
                  <PhotoThumb photo={p} />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-4 pb-1">
                    <div className="text-[10.5px] font-semibold text-white leading-tight line-clamp-2">{starOf?.(p) ? '★ ' : ''}{p.company_name || 'Chưa rõ công ty'}</div>
                    <div className="text-[9.5px] text-white/80">{new Date(p.taken_at).toLocaleDateString('vi-VN')}</div>
                  </div>
                </button>
              ))}
            </div>
        )}
      </div>

      {pinReq && <SurveyPinGate req={pinReq} onClose={() => setPinReq(null)} onDone={() => setPinReq(null)} />}
      {viewer && (
        <SurveyPhotoViewer photo={viewer} onClose={() => setViewer(null)} say={say}
          starred={starOf?.(viewer)} onStar={onStar}
          nav={{ index: Math.max(0, shownPhotos.findIndex(x => x.id === viewer.id)), total: shownPhotos.length,
            onPrev: shownPhotos.findIndex(x => x.id === viewer.id) > 0 ? () => setViewer(shownPhotos[shownPhotos.findIndex(x => x.id === viewer.id) - 1]) : null,
            onNext: shownPhotos.findIndex(x => x.id === viewer.id) < shownPhotos.length - 1 ? () => setViewer(shownPhotos[shownPhotos.findIndex(x => x.id === viewer.id) + 1]) : null }}
          onShowOnMap={() => { onShowPhoto(viewer); setViewer(null); }}
          onSaved={p => { setPhotos(list => list.map(x => x.id === p.id ? p : x)); setViewer(p); onChanged(); }}
          onDeleted={id => { setPhotos(list => list.filter(x => x.id !== id)); setViewer(null); onChanged(); }} />
      )}
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded-md bg-[#F2F2F7] text-[#3A3A3C]">{children}</span>;
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="py-12 flex flex-col items-center gap-2 text-[#8E8E93]">
      {icon}
      <div className="text-[13px]">{text}</div>
    </div>
  );
}

function groupPassed(passed: SurveyTrip['passed']) {
  const by = new Map<SurveyStatus, SurveyTrip['passed']>();
  for (const p of passed) {
    const st = (STATUS_META[p.status] ? p.status : 'osm') as SurveyStatus;
    const list = by.get(st);
    if (list) list.push(p); else by.set(st, [p]);
  }
  return [...by.entries()].sort((a, b) => STATUS_META[a[0]].rank - STATUS_META[b[0]].rank).map(([status, items]) => ({ status, items }));
}
