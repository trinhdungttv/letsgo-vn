import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { sameZone } from '../../pages/market/shared';
import type { MarketLeadSupplier } from '../../lib/types';
import ImageThumb from '../ImageThumb';

export interface RefCompetitor { id: string; company_name: string; active_zones: string[] | null; supplying_for: string[] | null }

/** Danh sách KCN chính thức + đối thủ (kèm KCN đã ghi nhận) — dùng để gợi ý NCC theo KCN. */
export function useMarketRefs() {
  const [zones, setZones] = useState<string[]>([]);
  const [competitors, setCompetitors] = useState<RefCompetitor[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [z, c] = await Promise.all([
        supabase.from('market_zones').select('name').order('name'),
        supabase.from('competitors').select('id, company_name, active_zones, supplying_for').order('company_name'),
      ]);
      if (!alive) return;
      setZones((z.data ?? []).map((r: any) => r.name));
      setCompetitors((c.data ?? []) as RefCompetitor[]);
    })();
    return () => { alive = false; };
  }, []);
  return { zones, competitors };
}

/** Đối thủ đã ghi nhận hoạt động tại KCN này (competitors.active_zones). */
export const competitorsInZone = (competitors: RefCompetitor[], zone: string) =>
  zone ? competitors.filter(c => (c.active_zones ?? []).some(a => sameZone(a, zone))) : [];

/** Gắn NCC (đối thủ) vào công ty: ghi "Đang cung cấp cho" và ghi nhận KCN nếu chưa có. */
export async function linkCompetitor(comp: RefCompetitor, companyName: string, zone: string | null) {
  const supplying_for = (comp.supplying_for ?? []).includes(companyName) ? comp.supplying_for : [...(comp.supplying_for ?? []), companyName];
  const zoneMissing = !!zone && !(comp.active_zones ?? []).some(a => sameZone(a, zone));
  const active_zones = zoneMissing ? [...(comp.active_zones ?? []), zone!] : comp.active_zones;
  if (supplying_for === comp.supplying_for && !zoneMissing) return;
  await supabase.from('competitors').update({ supplying_for, active_zones }).eq('id', comp.id);
}

export const notifyMarketChanged = () => window.dispatchEvent(new Event('lgvn:market-changed'));

const US: MarketLeadSupplier = { name: "Let's Go VN", qty: 0, is_us: true };

type Target = { kind: 'lead' | 'client'; id: string | null; zone: string; suppliers: MarketLeadSupplier[]; images: string[] };

interface Props {
  entry: { id: string; company_name: string; client_id?: string | null; branch_id?: string | null };
  toast: (m: string) => void;
}

/** Khối "Thị trường" trong hồ sơ CRM: KCN + nhà cung ứng khác (gợi ý theo KCN) + ảnh tuyển dụng.
 * Cùng nguồn dữ liệu với Thị trường > Công ty/Dự án (market_leads.crm_id, hoặc clients nếu đã là KH). */
export default function MarketSupplyBlock({ entry, toast }: Props) {
  const { user } = useAuth();
  const { zones, competitors } = useMarketRefs();
  const [t, setT] = useState<Target | null>(null);
  const [pick, setPick] = useState('');
  const [imgInput, setImgInput] = useState('');
  const [bad, setBad] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      if (entry.client_id) {
        const { data } = await supabase.from('clients').select('*').eq('id', entry.client_id).maybeSingle();
        if (alive && data) setT({ kind: 'client', id: data.id, zone: data.industrial_zones?.[0] ?? '', suppliers: data.market_suppliers ?? [US], images: data.recruit_image_urls ?? [] });
        return;
      }
      const { data } = await supabase.from('market_leads').select('*').eq('crm_id', entry.id).limit(1).maybeSingle();
      if (!alive) return;
      setT(data
        ? { kind: 'lead', id: data.id, zone: data.region ?? '', suppliers: data.suppliers ?? [US], images: data.recruit_image_urls ?? [] }
        : { kind: 'lead', id: null, zone: '', suppliers: [US], images: [] });
    })();
    return () => { alive = false; };
  }, [entry.id, entry.client_id]);

  const suggestions = useMemo(() => {
    if (!t) return [];
    const have = new Set(t.suppliers.map(s => s.name));
    return competitorsInZone(competitors, t.zone).filter(c => !have.has(c.company_name));
  }, [t, competitors]);
  const others = useMemo(() => {
    if (!t) return [];
    const have = new Set(t.suppliers.map(s => s.name));
    return competitors.filter(c => !have.has(c.company_name));
  }, [t, competitors]);

  if (!t) return <div className="text-[11.5px] text-[#999]">Đang tải dữ liệu thị trường…</div>;

  const save = async (next: Partial<Pick<Target, 'zone' | 'suppliers' | 'images'>>, desc: string) => {
    const merged = { ...t, ...next };
    let id = t.id;
    let error: { message: string } | null = null;
    if (t.kind === 'client') {
      ({ error } = await supabase.from('clients').update({
        ...(next.suppliers ? { market_suppliers: next.suppliers } : {}),
        ...(next.images ? { recruit_image_urls: next.images } : {}),
        ...(next.zone !== undefined ? { industrial_zones: next.zone ? [next.zone] : [] } : {}),
      }).eq('id', id!));
    } else if (id) {
      ({ error } = await supabase.from('market_leads').update({
        ...(next.suppliers ? { suppliers: next.suppliers } : {}),
        ...(next.images ? { recruit_image_urls: next.images } : {}),
        ...(next.zone !== undefined ? { region: next.zone || null } : {}),
      }).eq('id', id));
    } else {
      const res = await supabase.from('market_leads').insert({
        company_name: entry.company_name, region: merged.zone || null, workers_needed: 0, source: 'CRM Pipeline', status: 'Chưa LH',
        suppliers: merged.suppliers, crm_id: entry.id,
        ...(merged.images.length ? { recruit_image_urls: merged.images } : {}),
      }).select('id').single();
      error = res.error; id = res.data?.id ?? null;
    }
    if (error) {
      toast(/recruit_image_urls/.test(error.message) ? 'Chưa chạy migration 147 (cột ảnh tuyển dụng) — chạy xong rồi thử lại' : 'Lỗi: ' + error.message);
      return false;
    }
    setT({ ...merged, id });
    notifyMarketChanged();
    await logActivity({ user, action: 'update', table: t.kind === 'client' ? 'clients' : 'market_leads', recordId: id ?? entry.id, description: `${desc} — "${entry.company_name}"` });
    return true;
  };

  const addSupplier = async (name: string) => {
    if (!name || t.suppliers.some(s => s.name === name)) return;
    const ok = await save({ suppliers: [...t.suppliers, { name, qty: 0, is_us: false }] }, `Thêm NCC "${name}"`);
    if (!ok) return;
    const comp = competitors.find(c => c.company_name === name);
    if (comp) await linkCompetitor(comp, entry.company_name, t.zone || null);
  };
  const addAll = async () => {
    if (!suggestions.length) return;
    const ok = await save({ suppliers: [...t.suppliers, ...suggestions.map(c => ({ name: c.company_name, qty: 0, is_us: false }))] }, `Thêm ${suggestions.length} NCC theo KCN`);
    if (ok) await Promise.all(suggestions.map(c => linkCompetitor(c, entry.company_name, t.zone || null)));
  };
  const changeZone = async (zone: string) => {
    if (await save({ zone }, `Đổi KCN → "${zone || 'trống'}"`)) setPick('');
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
  const addImages = async () => {
    const urls = imgInput.split(/[\s,]+/).map(u => u.trim()).filter(u => /^https?:\/\//i.test(u) && !t.images.includes(u));
    if (!urls.length) { toast('Dán link ảnh (bắt đầu bằng http…)'); return; }
    if (await save({ images: [...t.images, ...urls] }, `Thêm ${urls.length} ảnh tuyển dụng`)) setImgInput('');
  };
  const removeImage = (u: string) => {
    if (!confirm('Bỏ ảnh tuyển dụng này khỏi công ty?')) return;
    void save({ images: t.images.filter(x => x !== u) }, 'Bỏ ảnh tuyển dụng');
  };

  const zoneOptions = t.zone && !zones.includes(t.zone) ? [t.zone, ...zones] : zones;

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-semibold text-[#333]">Thị trường — nhà cung ứng khác & ảnh tuyển dụng</div>
      <div>
        <div className="text-[11px] text-[#888] font-medium mb-0.5">Khu công nghiệp</div>
        <select value={t.zone} onChange={e => changeZone(e.target.value)}
          className="w-full text-[12.5px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500">
          <option value="">Chưa chọn</option>
          {zoneOptions.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
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
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10.5px] text-[#888]">Đối thủ đang hoạt động tại {t.zone}:</span>
              <button onClick={addAll} className="text-[10.5px] text-blue-600 hover:underline">Thêm tất cả ({suggestions.length})</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {suggestions.map(c => (
                <button key={c.id} onClick={() => addSupplier(c.company_name)}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[11px] hover:bg-blue-100">
                  <Plus size={10} /> {c.company_name}
                </button>
              ))}
            </div>
          </div>
        )}
        {!t.zone && <div className="text-[10.5px] text-[#999] mt-1.5">Chọn KCN để tự gợi ý các nhà cung ứng đang hoạt động tại đó.</div>}
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
        {t.images.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-2">
            {t.images.map(u => (
              <div key={u} className="relative group">
                <a href={u} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc">
                  {bad[u]
                    ? <div className="w-full h-24 rounded-lg bg-red-50 border border-red-300 text-red-600 text-[11px] font-semibold flex items-center justify-center text-center px-1">Ảnh lỗi — xoá & dán link khác</div>
                    : <img src={u} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBad(b => ({ ...b, [u]: true }))} className="w-full h-24 object-cover rounded-lg border border-gray-200" />}
                </a>
                <button onClick={() => removeImage(u)} className="absolute top-1 right-1 p-0.5 rounded bg-white/90 text-gray-500 hover:text-red-600 opacity-0 group-hover:opacity-100" title="Bỏ ảnh"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
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
