import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { sameZone } from '../../pages/market/shared';
import type { MarketLeadSupplier } from '../../lib/types';
import { hasColumn } from '../../lib/serviceMode';
import { pipelineZones, zoneIdsFromNames, zoneNames, PIPELINE_ZONES_MIGRATION_HINT, type ZoneRef } from '../../lib/pipelineZones';
import { CatalogPick } from '../../modules/cskh/components/CatalogPick';
import ImageThumb from '../ImageThumb';
import RecruitImageGallery, { MIGRATION_216_HINT } from './RecruitImageGallery';
import { appendImages, buildStore, parseStore, removeImageAt, setTagsAt, tagsForImages, type RecruitTag } from '../../lib/recruitImages';

export interface RefCompetitor { id: string; company_name: string; active_zones: string[] | null; supplying_for: string[] | null }

/** Danh sách KCN chính thức + đối thủ (kèm KCN đã ghi nhận) — dùng để gợi ý NCC theo KCN.
 * `zoneRefs` (mã + tên) cho ô chọn nhiều KCN; `branchNames` để nhận ra tên chi nhánh từng ghi tạm vào ô KCN. */
export function useMarketRefs() {
  const [zones, setZones] = useState<string[]>([]);
  const [zoneRefs, setZoneRefs] = useState<ZoneRef[]>([]);
  const [competitors, setCompetitors] = useState<RefCompetitor[]>([]);
  const [branchNames, setBranchNames] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [z, c, b] = await Promise.all([
        supabase.from('market_zones').select('id, name').order('name'),
        supabase.from('competitors').select('id, company_name, active_zones, supplying_for').order('company_name'),
        supabase.from('branches').select('name'),
      ]);
      if (!alive) return;
      const refs = ((z.data ?? []) as { id: string; name: string | null }[])
        .map(r => ({ id: r.id, name: (r.name ?? '').trim() })).filter(r => r.name);
      setZones(refs.map(r => r.name));
      setZoneRefs(refs);
      setCompetitors((c.data ?? []) as RefCompetitor[]);
      setBranchNames(((b.data ?? []) as { name: string | null }[]).map(r => r.name ?? '').filter(Boolean));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);
  return { zones, zoneRefs, competitors, branchNames, loaded };
}

/** Đối thủ đã ghi nhận hoạt động tại KCN này (competitors.active_zones). */
export const competitorsInZone = (competitors: RefCompetitor[], zone: string) =>
  zone ? competitors.filter(c => (c.active_zones ?? []).some(a => sameZone(a, zone))) : [];

/** Gợi ý NCC theo từng KCN của công ty (bỏ NCC đã có / đã hiện ở KCN trước) — công ty nhiều KCN thì gộp theo KCN. */
export function competitorsByZone(competitors: RefCompetitor[], zones: string[], exclude: ReadonlySet<string> = new Set()) {
  const seen = new Set(exclude);
  return zones.map(zone => {
    const list = competitorsInZone(competitors, zone).filter(c => !seen.has(c.company_name));
    list.forEach(c => seen.add(c.company_name));
    return { zone, list };
  }).filter(g => g.list.length);
}

/** Gắn NCC (đối thủ) vào công ty: ghi "Đang cung cấp cho" và ghi nhận KCN nếu chưa có.
 * Công ty nhiều KCN thì truyền zone = null (không biết NCC cung ứng ở KCN nào) — chỉ ghi "Đang cung cấp cho". */
export async function linkCompetitor(comp: RefCompetitor, companyName: string, zone: string | null) {
  const supplying_for = (comp.supplying_for ?? []).includes(companyName) ? comp.supplying_for : [...(comp.supplying_for ?? []), companyName];
  const zoneMissing = !!zone && !(comp.active_zones ?? []).some(a => sameZone(a, zone));
  const active_zones = zoneMissing ? [...(comp.active_zones ?? []), zone!] : comp.active_zones;
  if (supplying_for === comp.supplying_for && !zoneMissing) return;
  await supabase.from('competitors').update({ supplying_for, active_zones }).eq('id', comp.id);
}

export const notifyMarketChanged = () => window.dispatchEvent(new Event('lgvn:market-changed'));

export const US: MarketLeadSupplier = { name: "Let's Go VN", qty: 0, is_us: true };

/** region = KCN dạng chữ ở market_leads (KCN chính); clientZones = clients.industrial_zones khi đã là khách. */
type Target = {
  kind: 'lead' | 'client'; id: string | null; region: string | null; clientZones: string[]; suppliers: MarketLeadSupplier[];
  images: string[];
  /** Thẻ đối thủ của từng ảnh, cùng vị trí với images (cột recruit_image_tags, migration 216). */
  imageTags: RecruitTag[][];
};

/** Đọc ảnh tuyển dụng + thẻ từ 1 dòng clients / market_leads (cột thẻ chưa có → ảnh nào cũng "chưa gắn"). */
const imagesOf = (row: { recruit_image_urls?: string[] | null; recruit_image_tags?: unknown } | null) => {
  const images = row?.recruit_image_urls ?? [];
  return { images, imageTags: tagsForImages(images, parseStore(row?.recruit_image_tags)) };
};

interface Props {
  entry: { id: string; company_name: string; client_id?: string | null; branch_id?: string | null; zone_ids?: string[] | null };
  toast: (m: string) => void;
  /** Đã lưu crm_pipeline.zone_ids — báo trang cha để thẻ Pipeline / bộ lọc KCN cập nhật ngay. */
  onZonesSaved?: (ids: string[]) => void;
  /** Danh sách KCN hiện tại của công ty (mã + tên, KCN chính trước) — cho thẻ bản đồ "Nhà máy theo KCN". */
  onZonesResolved?: (zones: ZoneRef[]) => void;
}

/** Khối "Thị trường" trong hồ sơ CRM: các KCN + nhà cung ứng khác (gợi ý theo từng KCN) + ảnh tuyển dụng.
 * Cùng nguồn dữ liệu với Thị trường > Công ty/Dự án (market_leads.crm_id, hoặc clients nếu đã là KH).
 * KCN chọn nhiều, lưu mã ở crm_pipeline.zone_ids — xem src/lib/pipelineZones.ts. */
export default function MarketSupplyBlock({ entry, toast, onZonesSaved, onZonesResolved }: Props) {
  const { user } = useAuth();
  const { zoneRefs, competitors, branchNames, loaded } = useMarketRefs();
  const [t, setT] = useState<Target | null>(null);
  // Bản mới nhất của `t` — các thao tác ảnh nối đuôi nhau (gắn thẻ liền tay) luôn xuất phát từ dữ liệu mới nhất, không từ bản cũ của lần vẽ trước.
  const tRef = useRef<Target | null>(null);
  const commit = useCallback((n: Target | null) => { tRef.current = n; setT(n); }, []);
  const imgChain = useRef<Promise<unknown>>(Promise.resolve());
  /** DB đã có cột recruit_image_tags (migration 216) chưa — chưa có thì vẫn dùng ảnh bình thường, chỉ chưa gắn được thẻ. */
  const [tagsReady, setTagsReady] = useState(false);
  const [pick, setPick] = useState('');
  const [imgInput, setImgInput] = useState('');
  // Chọn liền tay nhiều KCN: hiện ngay lựa chọn mới, lưu lần lượt để lần sau không đè lần trước.
  const [draftZones, setDraftZones] = useState<string[] | null>(null);
  const zoneChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    (async () => {
      if (entry.client_id) {
        const { data } = await supabase.from('clients').select('*').eq('id', entry.client_id).maybeSingle();
        if (alive && data) {
          setTagsReady(await hasColumn('clients', 'recruit_image_tags'));
          if (alive) commit({ kind: 'client', id: data.id, region: null, clientZones: data.industrial_zones ?? [], suppliers: data.market_suppliers ?? [US], ...imagesOf(data) });
        }
        return;
      }
      const { data } = await supabase.from('market_leads').select('*').eq('crm_id', entry.id).limit(1).maybeSingle();
      if (!alive) return;
      const ready = await hasColumn('market_leads', 'recruit_image_tags');
      if (!alive) return;
      setTagsReady(ready);
      commit(data
        ? { kind: 'lead', id: data.id, region: data.region ?? null, clientZones: [], suppliers: data.suppliers ?? [US], ...imagesOf(data) }
        : { kind: 'lead', id: null, region: null, clientZones: [], suppliers: [US], images: [], imageTags: [] });
    })();
    return () => { alive = false; };
  }, [entry.id, entry.client_id, commit]);

  // Các KCN đang có của công ty (KCN cũ 1 ô → tự thành danh sách 1 KCN)
  const zoneState = useMemo(() => (t && loaded
    ? pipelineZones(entry, { clientZones: t.kind === 'client' ? t.clientZones : null, leadRegion: t.region, ignoreNames: branchNames }, zoneRefs)
    : { ids: [], legacy: [] }), [t, loaded, entry, branchNames, zoneRefs]);
  const zoneIds = draftZones ?? zoneState.ids;
  const names = useMemo(() => zoneNames(zoneIds, zoneRefs), [zoneIds, zoneRefs]);
  const resolvedKey = loaded && t ? `${entry.id}|${zoneIds.join(',')}|${names.join(',')}` : null;
  useEffect(() => {
    if (resolvedKey === null) return;
    onZonesResolved?.(zoneIds.map((id, i) => ({ id, name: names[i] ?? '' })).filter(z => z.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey]);
  // Chỉ 1 KCN thì ghi nhận NCC hoạt động tại KCN đó; nhiều KCN thì không đoán NCC ở KCN nào.
  const soleZone = names.length === 1 ? names[0] : null;

  const groups = useMemo(() => {
    if (!t) return [];
    return competitorsByZone(competitors, names, new Set(t.suppliers.map(s => s.name)));
  }, [t, competitors, names]);
  const suggestions = useMemo(() => groups.flatMap(g => g.list), [groups]);
  const others = useMemo(() => {
    if (!t) return [];
    const have = new Set(t.suppliers.map(s => s.name));
    return competitors.filter(c => !have.has(c.company_name));
  }, [t, competitors]);

  if (!t) return <div className="text-[11.5px] text-[#999]">Đang tải dữ liệu thị trường…</div>;

  const save = async (next: Partial<Pick<Target, 'region' | 'clientZones' | 'suppliers' | 'images' | 'imageTags'>>, desc: string) => {
    // Xuất phát từ bản mới nhất (không phải bản của lần vẽ cũ) để các lần lưu liền nhau không đè lẫn nhau
    const base = tRef.current ?? t;
    const merged = { ...base, ...next };
    let id = base.id;
    let error: { message: string } | null = null;
    const table = base.kind === 'client' ? 'clients' : 'market_leads';
    // Ảnh + thẻ đối thủ xếp song song. DB chưa chạy migration 216 (chưa có cột thẻ) → chỉ lưu ảnh như cũ, không lỗi.
    const imgCols: Record<string, unknown> = {};
    if (next.images || next.imageTags) {
      if (next.images) imgCols.recruit_image_urls = next.images;
      if (await hasColumn(table, 'recruit_image_tags')) imgCols.recruit_image_tags = buildStore(merged.images, merged.imageTags);
    }
    if (base.kind === 'client') {
      const patch = {
        ...(next.suppliers ? { market_suppliers: next.suppliers } : {}),
        ...imgCols,
        ...(next.clientZones ? { industrial_zones: next.clientZones } : {}),
      };
      if (Object.keys(patch).length) ({ error } = await supabase.from('clients').update(patch).eq('id', id!));
    } else {
      // Ảnh bìa / vị trí bản đồ (CompanyMedia) có thể vừa tạo dòng market_leads cho công ty này
      // sau khi khối này nạp — tìm lại trước khi tạo mới để không sinh 2 dòng cho 1 công ty.
      if (!id) {
        const { data } = await supabase.from('market_leads').select('id').eq('crm_id', entry.id).limit(1).maybeSingle();
        id = data?.id ?? null;
      }
      if (id) {
        const patch = {
          ...(next.suppliers ? { suppliers: next.suppliers } : {}),
          ...imgCols,
          ...(next.region !== undefined ? { region: next.region } : {}),
        };
        if (Object.keys(patch).length) ({ error } = await supabase.from('market_leads').update(patch).eq('id', id));
      } else {
        const res = await supabase.from('market_leads').insert({
          company_name: entry.company_name, region: merged.region, workers_needed: 0, source: 'CRM Pipeline', status: 'Chưa LH',
          suppliers: merged.suppliers, crm_id: entry.id,
          ...(merged.images.length ? { recruit_image_urls: merged.images, ...(imgCols.recruit_image_tags ? { recruit_image_tags: imgCols.recruit_image_tags } : {}) } : {}),
        }).select('id').single();
        error = res.error; id = res.data?.id ?? null;
      }
    }
    if (error) {
      toast(/recruit_image_tags/.test(error.message) ? MIGRATION_216_HINT
        : /recruit_image_urls/.test(error.message) ? 'Chưa chạy migration 147 (cột ảnh tuyển dụng) — chạy xong rồi thử lại' : 'Lỗi: ' + error.message);
      return false;
    }
    commit({ ...merged, id });
    notifyMarketChanged();
    await logActivity({ user, action: 'update', table, recordId: id ?? entry.id, description: `${desc} — "${entry.company_name}"` });
    return true;
  };

  const addSupplier = async (name: string) => {
    if (!name || t.suppliers.some(s => s.name === name)) return;
    const ok = await save({ suppliers: [...t.suppliers, { name, qty: 0, is_us: false }] }, `Thêm NCC "${name}"`);
    if (!ok) return;
    const comp = competitors.find(c => c.company_name === name);
    if (comp) await linkCompetitor(comp, entry.company_name, soleZone);
  };
  const addAll = async () => {
    if (!suggestions.length) return;
    const ok = await save({ suppliers: [...t.suppliers, ...suggestions.map(c => ({ name: c.company_name, qty: 0, is_us: false }))] }, `Thêm ${suggestions.length} NCC theo KCN`);
    if (ok) await Promise.all(suggestions.map(c => linkCompetitor(c, entry.company_name, soleZone)));
  };
  // Lưu danh sách KCN: crm_pipeline.zone_ids (thẻ Pipeline + bộ lọc) và chép sang nơi Thị trường đang đọc —
  // khách: clients.industrial_zones (đủ các KCN, giữ cả tên cũ ngoài danh mục); chưa là khách: market_leads.region = KCN chính.
  const changeZones = async (ids: string[]) => {
    const nextNames = zoneNames(ids, zoneRefs);
    let savedIds = false;
    if (await hasColumn('crm_pipeline', 'zone_ids')) {
      const { error } = await supabase.from('crm_pipeline').update({ zone_ids: ids }).eq('id', entry.id);
      if (error) { toast('Lỗi: ' + error.message); return; }
      savedIds = true;
    }
    const desc = `Đổi KCN → ${nextNames.join(', ') || 'trống'}`;
    // Khách: giữ nguyên các tên cũ không có trong danh mục (chỉ bỏ khi bấm × ở dòng báo dữ liệu cũ)
    const keepOld = zoneIdsFromNames(t.clientZones, zoneRefs).unmatched;
    const ok = t.kind === 'client'
      ? await save({ clientZones: [...nextNames, ...keepOld] }, desc)
      : await save({ region: nextNames[0] ?? null }, desc);
    if (savedIds) onZonesSaved?.(ids);
    if (ok && !savedIds && t.kind === 'lead' && ids.length > 1) toast(PIPELINE_ZONES_MIGRATION_HINT);
  };
  const pickZones = (ids: string[]) => {
    setDraftZones(ids);
    zoneChain.current = zoneChain.current
      .then(() => changeZones(ids))
      .catch((e: Error) => toast('Lỗi: ' + e.message))
      .finally(() => setDraftZones(d => (d === ids ? null : d)));
  };
  // Tên KCN cũ ngoài danh mục (chỉ có ở khách hàng) — bỏ hẳn khi người dùng bấm ×
  const dropLegacy = (name: string) => {
    if (!confirm(`Bỏ KCN cũ “${name}” khỏi hồ sơ khách hàng?`)) return;
    void save({ clientZones: t.clientZones.filter(z => z !== name) }, `Bỏ KCN cũ "${name}"`);
  };
  const setQty = (name: string, qty: number) => {
    const cur = t.suppliers.find(s => s.name === name);
    if (!cur || cur.qty === qty) return;
    void save({ suppliers: t.suppliers.map(s => s.name === name ? { ...s, qty } : s) }, `Sửa số LĐ NCC "${name}"`);
  };
  const removeSupplier = (name: string) => {
    if (!confirm(`Bỏ NCC "${name}" khỏi công ty này? (kèm số LĐ và lương đã nhập cho NCC này tại đây)`)) return;
    void save({ suppliers: t.suppliers.filter(s => s.name !== name) }, `Bỏ NCC "${name}"`);
  };
  // Mọi thao tác ảnh (thêm / bỏ / gắn thẻ) xếp hàng lưu lần lượt, mỗi lần xuất phát từ dữ liệu mới nhất.
  const queueImg = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = imgChain.current.then(job, job);
    imgChain.current = run.catch(() => undefined);
    return run;
  };
  const addImages = async () => {
    const urls = imgInput.split(/[\s,]+/).map(u => u.trim()).filter(u => /^https?:\/\//i.test(u) && !t.images.includes(u));
    if (!urls.length) { toast('Dán link ảnh (bắt đầu bằng http…)'); return; }
    const ok = await queueImg(async () => {
      const cur = tRef.current ?? t;
      const fresh = [...new Set(urls)].filter(u => !cur.images.includes(u));
      if (!fresh.length) return true;
      const next = appendImages(cur.images, cur.imageTags, fresh);
      return save({ images: next.urls, imageTags: next.tags }, `Thêm ${fresh.length} ảnh tuyển dụng`);
    });
    if (ok) setImgInput('');
  };
  const removeImage = (index: number) => {
    if (!confirm('Bỏ ảnh tuyển dụng này khỏi công ty?' + ((t.imageTags[index]?.length ?? 0) > 0 ? ' (thẻ đối thủ của ảnh cũng bị bỏ)' : ''))) return;
    const url = t.images[index];
    void queueImg(async () => {
      const cur = tRef.current ?? t;
      const at = cur.images.indexOf(url);
      if (at < 0) return true;
      const next = removeImageAt(cur.images, cur.imageTags, at);
      return save({ images: next.urls, imageTags: next.tags }, 'Bỏ ảnh tuyển dụng');
    });
  };
  // Gắn / gỡ thẻ đối thủ của 1 ảnh: hiện ngay, lưu nền; lưu lỗi thì trả lại thẻ cũ.
  const changeImageTags = (index: number, nextTags: RecruitTag[]) => {
    if (!tagsReady) { toast(MIGRATION_216_HINT); return; }
    const before = tRef.current ?? t;
    const url = before.images[index];
    if (url === undefined) return;
    const prevTags = before.imageTags[index] ?? [];
    commit({ ...before, imageTags: setTagsAt(before.imageTags, index, nextTags) });
    void queueImg(async () => {
      const cur = tRef.current ?? before;
      const ok = await save({ imageTags: cur.imageTags }, `Gắn thẻ đối thủ ảnh tuyển dụng → ${nextTags.map(x => x.n).join(', ') || 'bỏ hết thẻ'}`);
      if (!ok) {
        const now = tRef.current ?? cur;
        const at = now.images.indexOf(url);
        if (at >= 0) commit({ ...now, imageTags: setTagsAt(now.imageTags, at, prevTags) });
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-semibold text-[#333]">Thị trường — nhà cung ứng khác & ảnh tuyển dụng</div>
      <div>
        <div className="text-[11px] text-[#888] font-medium mb-1">Khu công nghiệp <span className="font-normal text-[#bbb]">— chọn nhiều nếu công ty có nhà máy ở nhiều KCN</span></div>
        {loaded ? (
          <CatalogPick items={zoneRefs} value={zoneIds} onChange={pickZones}
            addLabel={zoneIds.length ? 'Thêm KCN…' : 'Chọn KCN…'} emptyText="Chưa có KCN nào trong Thị trường → Khu vực." />
        ) : <div className="text-[11.5px] text-[#999]">Đang tải danh mục KCN…</div>}
        {zoneState.legacy.map(name => (
          <div key={name} className="flex items-center gap-1 text-[10.5px] text-amber-600 mt-1">
            <span>Dữ liệu cũ ghi “{name}” — không có trong danh mục KCN, chọn lại ở trên.</span>
            {t.kind === 'client' && (
              <button onClick={() => dropLegacy(name)} className="p-0.5 text-amber-400 hover:text-red-500" title="Bỏ KCN cũ này"><X size={11} /></button>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="text-[11px] text-[#888] font-medium mb-1">Nhà cung ứng khác</div>
        <div className="space-y-1">
          {t.suppliers.filter(s => !s.is_us).map(s => (
            <div key={s.name} className="flex items-center gap-2 text-[12.5px]">
              <span className="flex-1 truncate text-[#111]" title={s.name}>{s.name}</span>
              <input type="number" defaultValue={s.qty || ''} placeholder="LĐ" onBlur={e => setQty(s.name, parseInt(e.target.value) || 0)}
                className="w-16 text-[12px] px-1.5 py-0.5 border border-gray-200 rounded outline-none focus:border-blue-500 text-right" />
              <span className="text-[11px] text-[#999]">LĐ</span>
              <button onClick={() => removeSupplier(s.name)} className="p-0.5 text-gray-300 hover:text-red-500" title="Bỏ NCC"><X size={12} /></button>
            </div>
          ))}
          {t.suppliers.every(s => s.is_us) && <div className="text-[11.5px] text-[#aaa] italic">Chưa có nhà cung ứng khác</div>}
        </div>
        {suggestions.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {groups.map((g, i) => (
              <div key={g.zone}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10.5px] text-[#888]">Đối thủ đang hoạt động tại {g.zone}:</span>
                  {i === 0 && <button onClick={addAll} className="text-[10.5px] text-blue-600 hover:underline">Thêm tất cả ({suggestions.length})</button>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.list.map(c => (
                    <button key={c.id} onClick={() => addSupplier(c.company_name)}
                      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[11px] hover:bg-blue-100">
                      <Plus size={10} /> {c.company_name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {!zoneIds.length && <div className="text-[10.5px] text-[#999] mt-1.5">Chọn KCN để tự gợi ý các nhà cung ứng đang hoạt động tại đó.</div>}
        <div className="flex gap-1.5 mt-2">
          <select value={pick} onChange={e => setPick(e.target.value)}
            className="flex-1 text-[12px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500">
            <option value="">Thêm nhà cung ứng khác…</option>
            {others.map(c => <option key={c.id} value={c.company_name}>{c.company_name}</option>)}
          </select>
          <button disabled={!pick} onClick={() => { void addSupplier(pick); setPick(''); }}
            className="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white disabled:opacity-40">Thêm</button>
        </div>
      </div>

      <div>
        <div className="text-[11px] text-[#888] font-medium mb-1">Ảnh tuyển dụng</div>
        <RecruitImageGallery urls={t.images} tags={t.imageTags} competitors={competitors} tagsReady={tagsReady}
          onChangeTags={changeImageTags} onRemove={removeImage} />
        <div className="flex gap-1.5">
          <ImageThumb url={imgInput.split(/[\s,]+/)[0] ?? ''} onStatus={() => {}} />
          <input value={imgInput} onChange={e => setImgInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addImages(); }}
            placeholder="Dán link ảnh tuyển dụng (nhiều link cách nhau bằng dấu cách)"
            className="flex-1 text-[12px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
          <button onClick={addImages} className="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white">Thêm</button>
        </div>
      </div>
    </div>
  );
}
