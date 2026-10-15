import { useEffect, useMemo, useState } from 'react';
import { Camera, ImagePlus, MapPin, ExternalLink, Pencil, X, Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { parseLatLngFromLink, isValidVnLatLng } from '../../lib/geo';
import CoverImageEditor, { type CoverImageValue } from '../CoverImageEditor';
import MapLinkHint from '../MapLinkHint';
import MiniMap, { type LatLngLite } from '../MiniMap';
import { usePersistedState } from '../../hooks/usePersistedState';
import { MAP_GROUPS, fetchMapContextPoints, type MapContextPoint, type MapGroup } from '../../lib/mapGroups';
import { notifyMarketChanged, US } from './MarketSupplyBlock';

/* ═══ Ảnh bìa + vị trí bản đồ của 1 công ty trong CRM Pipeline ═══
   Cùng nguồn dữ liệu với khối "Thị trường" (MarketSupplyBlock):
   - Công ty đã là Khách hàng (client_id) → clients.cover_image_* (migration 141) + clients.map_link/lat/lng (094).
   - Chưa là Khách hàng → dòng market_leads gắn crm_id (map 095, ảnh bìa 163); chưa có dòng thì tạo khi lưu lần đầu.
   Nhờ vậy ảnh bìa hiện luôn ở thẻ Khách hàng / Thị trường và ghim hiện trên Bản đồ Thị trường —
   không có bản sao thứ 2 nằm riêng trong crm_pipeline. */

export interface CompanyMediaData {
  kind: 'client' | 'lead';
  /** null = công ty chưa có dòng market_leads — sẽ tạo khi lưu lần đầu */
  id: string | null;
  cover: CoverImageValue;
  mapLink: string;
  lat: number | null;
  lng: number | null;
}

type MediaRow = Record<string, unknown> | null;

const num = (v: unknown, d: number | null) => (typeof v === 'number' ? v : v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : d);

function fromRow(kind: 'client' | 'lead', row: MediaRow): CompanyMediaData {
  return {
    kind,
    id: (row?.id as string) ?? null,
    cover: {
      url: (row?.cover_image_url as string) || null,
      fit: (row?.cover_image_fit as string) || 'cover',
      posX: num(row?.cover_image_pos_x, 50),
      posY: num(row?.cover_image_pos_y, 50),
    },
    mapLink: (row?.map_link as string) || '',
    lat: num(row?.lat, null),
    lng: num(row?.lng, null),
  };
}

export function useCompanyMedia(
  entry: { id: string; company_name: string; client_id?: string | null },
  toast: (m: string) => void,
  enabled = true,
) {
  const { user } = useAuth();
  const [media, setMedia] = useState<CompanyMediaData | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setMedia(null);
    (async () => {
      if (entry.client_id) {
        const { data } = await supabase.from('clients').select('*').eq('id', entry.client_id).maybeSingle();
        if (alive) setMedia(fromRow('client', data ?? { id: entry.client_id }));
        return;
      }
      const { data } = await supabase.from('market_leads').select('*').eq('crm_id', entry.id).limit(1).maybeSingle();
      if (alive) setMedia(fromRow('lead', data));
    })();
    return () => { alive = false; };
  }, [entry.id, entry.client_id, enabled]);

  const save = async (patch: { cover?: CoverImageValue; mapLink?: string; pin?: LatLngLite }, description: string): Promise<boolean> => {
    if (!media) return false;
    const row: Record<string, unknown> = {};
    const next: CompanyMediaData = { ...media };
    if (patch.pin) {
      // Ghim đặt tay trên bản đồ → sinh link Google Maps dạng ?q=lat,lng (mở được, tab Bản đồ đọc được toạ độ)
      if (!isValidVnLatLng(patch.pin)) { toast('Vị trí nằm ngoài Việt Nam — chọn lại trên bản đồ'); return false; }
      const lat = +patch.pin.lat.toFixed(6), lng = +patch.pin.lng.toFixed(6);
      patch = { ...patch, pin: undefined, mapLink: `https://www.google.com/maps?q=${lat},${lng}` };
    }
    if (patch.cover) {
      const url = (patch.cover.url ?? '').trim() || null;
      const cover = { url, fit: patch.cover.fit ?? 'cover', posX: Math.round(patch.cover.posX ?? 50), posY: Math.round(patch.cover.posY ?? 50) };
      Object.assign(row, { cover_image_url: cover.url, cover_image_fit: cover.fit, cover_image_pos_x: cover.posX, cover_image_pos_y: cover.posY });
      next.cover = cover;
    }
    if (patch.mapLink !== undefined) {
      const link = patch.mapLink.trim();
      const pos = parseLatLngFromLink(link);
      row.map_link = link || null;
      next.mapLink = link;
      // Đọc được toạ độ → ghim luôn; xoá link hoặc đổi sang link không có toạ độ → bỏ toạ độ cũ
      // (để không ghim sai chỗ — tab Bản đồ sẽ tự dò lại theo tên/địa chỉ).
      if (isValidVnLatLng(pos)) {
        Object.assign(row, { lat: pos.lat, lng: pos.lng, geocoded_at: new Date().toISOString() });
        next.lat = pos.lat; next.lng = pos.lng;
      } else if (link !== media.mapLink) {
        Object.assign(row, { lat: null, lng: null, geocoded_at: null });
        next.lat = null; next.lng = null;
      }
    }

    let id = media.id;
    let error: { message: string } | null = null;
    if (media.kind === 'client') {
      ({ error } = await supabase.from('clients').update(row).eq('id', id!));
    } else {
      // Khối Thị trường có thể vừa tạo dòng market_leads sau khi hồ sơ nạp — tìm lại trước khi tạo mới.
      if (!id) {
        const { data } = await supabase.from('market_leads').select('id').eq('crm_id', entry.id).limit(1).maybeSingle();
        id = data?.id ?? null;
      }
      if (id) {
        ({ error } = await supabase.from('market_leads').update(row).eq('id', id));
      } else {
        const res = await supabase.from('market_leads').insert({
          company_name: entry.company_name, region: null, workers_needed: 0, source: 'CRM Pipeline', status: 'Chưa LH',
          suppliers: [US], crm_id: entry.id, ...row,
        }).select('id').single();
        error = res.error; id = res.data?.id ?? null;
      }
    }
    if (error) {
      toast(/cover_image/.test(error.message)
        ? 'Chưa lưu được ảnh bìa — cần chạy migration 163 (ảnh bìa Công ty/Dự án) trên Supabase.'
        : 'Lỗi: ' + error.message);
      return false;
    }
    setMedia({ ...next, id });
    notifyMarketChanged();
    await logActivity({
      user, action: 'update', table: media.kind === 'client' ? 'clients' : 'market_leads', recordId: id ?? entry.id,
      description: `${description} — "${entry.company_name}"`,
    });
    return true;
  };

  return { media, save };
}

const coverImgStyle = (c: CoverImageValue) => ({ objectPosition: `${c.posX ?? 50}% ${c.posY ?? 50}%` });

/** Dải ảnh bìa đầu hồ sơ (kiểu giữa màn hình / toàn màn hình). `children` = các nút nổi góc trên. */
export function CoverBanner({ media, onEdit, tall, children }: {
  media: CompanyMediaData | null;
  onEdit: () => void;
  tall?: boolean;
  children?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const cover = media?.cover;
  useEffect(() => { setBroken(false); }, [cover?.url]);

  if (!cover?.url || broken) {
    return (
      <div className="relative h-[72px] md:h-[88px] shrink-0 bg-gradient-to-r from-slate-100 via-blue-50 to-violet-50 border-b border-[#E8E7E2]">
        {media && (
          <button onClick={onEdit}
            className="absolute left-5 bottom-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/90 border border-[#E2E0D9] text-[11.5px] font-medium text-[#555] hover:text-blue-700 hover:border-blue-300 shadow-sm transition">
            <ImagePlus size={13} /> {broken ? 'Ảnh bìa lỗi — đổi ảnh khác' : 'Thêm ảnh bìa'}
          </button>
        )}
        {children}
      </div>
    );
  }
  const contain = cover.fit === 'contain';
  return (
    <div className={`relative shrink-0 overflow-hidden bg-slate-200 ${tall ? 'h-44 md:h-64' : 'h-40 md:h-52'}`}>
      {/* Chế độ tự khớp: nền là chính ảnh làm mờ để không lộ dải trống hai bên */}
      {contain && <img src={cover.url} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-70" />}
      <img src={cover.url} alt="Ảnh bìa công ty" onError={() => setBroken(true)}
        className={`relative w-full h-full ${contain ? 'object-contain' : 'object-cover'}`} style={coverImgStyle(cover)} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/25 pointer-events-none" />
      <button onClick={onEdit}
        className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur text-[11.5px] font-medium text-[#333] hover:bg-white shadow-sm transition">
        <Camera size={13} /> Đổi ảnh bìa
      </button>
      {children}
    </div>
  );
}

/** Hộp thoại sửa ảnh bìa: dán link + lấp đầy/tự khớp + kéo vị trí, xem trước cả thẻ 16:9 lẫn dải bìa hồ sơ. */
export function CoverEditDialog({ media, onSave, onClose }: {
  media: CompanyMediaData;
  onSave: (v: CoverImageValue) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CoverImageValue>(media.cover);
  const [saving, setSaving] = useState(false);
  const url = (draft.url ?? '').trim();
  const submit = async () => {
    if (!url && media.cover.url && !confirm('Gỡ ảnh bìa khỏi hồ sơ công ty này?\n(Chỉ gỡ đường link — ảnh gốc ở nơi lưu trữ không bị xoá.)')) return;
    if (url && !/^https?:\/\//i.test(url)) { alert('Link ảnh phải bắt đầu bằng http:// hoặc https://'); return; }
    setSaving(true);
    const ok = await onSave({ ...draft, url: url || null });
    setSaving(false);
    if (ok) onClose();
  };
  const where = media.kind === 'client' ? 'thẻ Khách hàng' : 'Thị trường → Công ty/Dự án';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-3 md:p-0" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="bg-white rounded-[12px] w-full max-w-md p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[14px] font-semibold text-[#111]">Ảnh bìa công ty</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={15} className="text-gray-500" /></button>
        </div>
        <p className="text-[11.5px] text-[#888] mb-3">
          Hiện ở đầu hồ sơ khi mở dạng <b>Giữa màn hình</b> / <b>Toàn màn hình</b>, và ở {where}.
        </p>
        <CoverImageEditor value={draft} onChange={setDraft} urlPlaceholder="Dán link ảnh cổng / nhà xưởng công ty…"
          previewHint="Kéo ảnh để chỉnh vị trí — khung này là thẻ 16:9" />
        {url && (
          <div className="mt-2.5">
            <div className="text-[10.5px] text-[#999] mb-1">Xem trước dải ảnh bìa trong hồ sơ</div>
            <div className="relative h-16 rounded-lg overflow-hidden border border-gray-200 bg-slate-200">
              {draft.fit === 'contain' && <img src={url} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-70" />}
              <img src={url} alt="" className={`relative w-full h-full ${draft.fit === 'contain' ? 'object-contain' : 'object-cover'}`} style={coverImgStyle(draft)} />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mt-4">
          {media.cover.url ? (
            <button onClick={() => setDraft(d => ({ ...d, url: null }))} className="text-[12px] text-red-500 hover:text-red-600">Gỡ ảnh bìa</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px] border border-gray-300 text-[#666] hover:bg-gray-50">Huỷ</button>
            <button onClick={submit} disabled={saving} className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Đang lưu…' : 'Lưu ảnh bìa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Khối "Vị trí trên bản đồ": bản đồ nhỏ có ghim đỏ của công ty + các điểm của Bản đồ Thị trường
 *  (chi nhánh, KCN, khách hàng, công ty/dự án) để phóng ra là thấy xung quanh. Đặt vị trí bằng
 *  cách bấm/kéo ghim trên bản đồ hoặc dán link Google Maps. */
export function CompanyLocationCard({ media, companyName, crmId, onSave, mapClassName = 'h-44' }: {
  media: CompanyMediaData | null;
  companyName: string;
  /** id dòng crm_pipeline — để bỏ chính công ty này khỏi lớp điểm xung quanh */
  crmId: string;
  onSave: (patch: { mapLink?: string; pin?: LatLngLite }, description: string) => Promise<boolean>;
  mapClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<LatLngLite | null>(null);
  const [saving, setSaving] = useState(false);
  const [big, setBig] = useState(false);
  const [points, setPoints] = useState<MapContextPoint[]>([]);
  const [shownGroups, setShownGroups] = usePersistedState<MapGroup[]>('crm_minimap_groups', MAP_GROUPS.map(g => g.id));
  const saved = media?.mapLink ?? '';
  useEffect(() => { setDraft(saved); setEditing(false); setPending(null); }, [saved]);
  useEffect(() => {
    let alive = true;
    fetchMapContextPoints().then(p => { if (alive) setPoints(p); });
    return () => { alive = false; };
  }, [media?.mapLink]);

  const ownId = media?.id ?? null;
  const around = useMemo(() => points.filter(p => p.id !== ownId && p.crmId !== crmId), [points, ownId, crmId]);
  const others = useMemo(() => around.filter(p => shownGroups.includes(p.group)), [around, shownGroups]);
  const countBy = useMemo(() => {
    const m: Partial<Record<MapGroup, number>> = {};
    around.forEach(p => { m[p.group] = (m[p.group] ?? 0) + 1; });
    return m;
  }, [around]);

  if (!media) return <div className="text-[11.5px] text-[#999]">Đang tải vị trí…</div>;
  const savedPin = media.lat != null && media.lng != null ? { lat: media.lat, lng: media.lng } : null;
  const picking = editing || !savedPin;
  const showInput = editing || !saved;

  const cancel = () => { setDraft(saved); setPending(null); setEditing(false); };
  const savePin = async () => {
    if (!pending) return;
    setSaving(true);
    const ok = await onSave({ pin: pending }, savedPin ? 'Dời ghim vị trí trên bản đồ' : 'Đặt ghim vị trí trên bản đồ');
    setSaving(false);
    if (ok) { setPending(null); setEditing(false); }
  };
  const saveLink = async () => {
    const link = draft.trim();
    if (link === saved) { setEditing(false); return; }
    if (!link && !confirm('Xoá link Google Maps và ghim bản đồ của công ty này?')) return;
    setSaving(true);
    const ok = await onSave({ mapLink: link }, link ? 'Cập nhật vị trí bản đồ' : 'Xoá link bản đồ');
    setSaving(false);
    if (ok) { setEditing(false); setPending(null); }
  };
  const toggleGroup = (g: MapGroup) => setShownGroups(cur => cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[12px] font-semibold text-[#333] inline-flex items-center gap-1"><MapPin size={13} className="text-red-500" /> Vị trí trên bản đồ</div>
        <div className="flex items-center gap-2.5 shrink-0 text-[11.5px]">
          <button onClick={() => setBig(v => !v)} className="text-[#888] hover:text-blue-600" title={big ? 'Thu nhỏ bản đồ' : 'Phóng to bản đồ'}>
            {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {saved && (
            <a href={saved} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
              Google Maps <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      <MiniMap pin={pending ?? savedPin} pinLabel={companyName} others={others}
        picking={picking} onPick={setPending}
        className={`w-full rounded-lg border border-[#E8E7E2] overflow-hidden transition-[height] ${big ? 'h-[420px]' : mapClassName}`} />

      {/* Chú thích = bật/tắt từng nhóm điểm (nhớ theo máy) */}
      <div className="flex flex-wrap gap-1 mt-1.5">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium bg-red-50 text-red-700 border border-red-200">
          <span className="w-2 h-2 rounded-full bg-red-600" /> Công ty này
        </span>
        {MAP_GROUPS.map(g => {
          const on = shownGroups.includes(g.id);
          return (
            <button key={g.id} onClick={() => toggleGroup(g.id)} title={on ? 'Bấm để ẩn nhóm này' : 'Bấm để hiện nhóm này'}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] border transition ${on ? 'bg-white border-[#E2E0D9] text-[#555]' : 'bg-transparent border-dashed border-[#DDD] text-[#bbb]'}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: on ? g.color : '#ddd' }} />
              {g.label}{countBy[g.id] ? ` ${countBy[g.id]}` : ''}
            </button>
          );
        })}
      </div>

      {pending ? (
        <div className="mt-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
          <span className="flex-1 text-[11.5px] text-red-800">{savedPin ? 'Dời ghim tới vị trí mới?' : 'Đặt ghim tại vị trí này?'}</span>
          <button onClick={() => setPending(null)} className="px-2 py-1 rounded-md text-[11.5px] text-[#777] hover:bg-white">Bỏ</button>
          <button onClick={savePin} disabled={saving} className="px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Đang lưu…' : 'Lưu vị trí'}
          </button>
        </div>
      ) : picking && (
        <div className="mt-1.5 text-[11px] text-[#888]">
          {savedPin ? 'Bấm lên bản đồ hoặc kéo ghim đỏ để dời vị trí' : 'Chưa có vị trí — bấm lên bản đồ để đặt ghim'}, hoặc dán link Google Maps:
        </div>
      )}

      {showInput ? (
        <div className="mt-1.5">
          <div className="flex gap-1.5">
            <input value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveLink(); if (e.key === 'Escape' && saved) cancel(); }}
              placeholder="Dán link Google Maps (…/@lat,lng…)"
              className="flex-1 min-w-0 text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
            <button onClick={saveLink} disabled={saving || draft.trim() === saved}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 shrink-0">
              Lưu
            </button>
            {editing && saved && (
              <button onClick={cancel} className="px-2 py-1.5 rounded-lg text-[12px] text-[#888] hover:bg-gray-100 shrink-0">Xong</button>
            )}
          </div>
          <MapLinkHint value={draft} className="mt-1" />
          {saved && !savedPin && (
            <div className="text-[11px] text-amber-600 mt-1">Link đang lưu chưa có toạ độ — bấm lên bản đồ để đặt ghim, hoặc dán lại link dài.</div>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[11.5px] text-[#888] hover:text-blue-600">
            <Pencil size={11} /> Sửa vị trí
          </button>
          <a href="#/market/map" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#999] hover:text-blue-600">
            Mở Bản đồ Thị trường <ExternalLink size={10} />
          </a>
        </div>
      )}
    </div>
  );
}

/** Dòng ảnh bìa gọn cho kiểu "bên phải" (không có dải bìa) — xem ảnh nhỏ + nút đổi. */
export function CoverThumbRow({ media, onEdit }: { media: CompanyMediaData | null; onEdit: () => void }) {
  if (!media) return null;
  const c = media.cover;
  return (
    <div className="flex items-center gap-3">
      <button onClick={onEdit} title={c.url ? 'Đổi ảnh bìa' : 'Thêm ảnh bìa'}
        className="w-24 aspect-video rounded-lg overflow-hidden border border-[#E8E7E2] bg-gradient-to-r from-slate-100 to-violet-50 flex items-center justify-center shrink-0 hover:border-blue-300 transition">
        {c.url
          ? <img src={c.url} alt="" className={`w-full h-full ${c.fit === 'contain' ? 'object-contain' : 'object-cover'}`} style={coverImgStyle(c)} />
          : <ImagePlus size={16} className="text-[#aaa]" />}
      </button>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-[#333]">Ảnh bìa</div>
        <div className="text-[11px] text-[#999] leading-snug">Hiện ở đầu hồ sơ khi mở dạng Giữa màn hình / Toàn màn hình.</div>
        <button onClick={onEdit} className="text-[11.5px] text-blue-600 hover:underline mt-0.5">{c.url ? 'Đổi ảnh bìa' : '+ Thêm ảnh bìa'}</button>
      </div>
    </div>
  );
}
