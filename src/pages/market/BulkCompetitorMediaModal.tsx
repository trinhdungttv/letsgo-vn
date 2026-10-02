import { Fragment, useMemo, useState } from 'react';
import { X, ClipboardPaste, ChevronRight, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { mapLinkStatus, MAP_LINK_STATUS_TEXT } from '../../lib/geo';
import ImageThumb from '../../components/ImageThumb';
import { companyKey } from './supplierLink';
import { type CompetitorLinkType, getLinkUrl, iconForLinkKey } from './competitorLinks';
import type { Competitor } from '../../lib/types';

interface Props {
  competitors: Competitor[];
  /** Các loại link dùng chung (Website, Facebook, TikTok, loại tự thêm…) — hiện trong phần mở rộng của mỗi dòng. */
  linkTypes: CompetitorLinkType[];
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  toast: (msg: string) => void;
}

type Draft = { image_url: string; zone_name: string; map_link: string; director: string; links: Record<string, string> };
const FIELDS = ['image_url', 'zone_name', 'map_link', 'director'] as const;
const OTHER = '__other'; // social_other_url

const isMap = (u: string) => /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google|@-?\d+\.\d+,-?\d+\.\d+/i.test(u);
const isUrl = (u: string) => /^https?:\/\//i.test(u);

/** Nhập nhanh Ảnh cover + Trụ sở + Link Google Maps + Người đứng đầu (Giám đốc) cho nhiều đối thủ.
 * Chỉ ghi ô người dùng điền; ô trống giữ nguyên dữ liệu cũ (không xoá gì). */
export default function BulkCompetitorMediaModal({ competitors, linkTypes: allTypes, onClose, onRefresh, toast }: Props) {
  const { user } = useAuth();
  const sorted = useMemo(() => [...competitors].sort((a, b) => a.company_name.localeCompare(b.company_name, 'vi')), [competitors]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [paste, setPaste] = useState('');
  const [saving, setSaving] = useState(false);
  const [imgStatus, setImgStatus] = useState<Record<string, 'ok' | 'bad' | null>>({});
  const [onlyBad, setOnlyBad] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Bản đồ đã có cột riêng ở bảng chính nên không lặp lại trong phần mở rộng.
  const linkTypes = useMemo(() => allTypes.filter(t => t.field !== 'map_link' && t.key !== 'map'), [allTypes]);

  const orig = (c: Competitor): Draft => ({
    image_url: c.image_url ?? '', zone_name: c.zone_name ?? '', map_link: c.map_link ?? '', director: c.director ?? '',
    links: { ...Object.fromEntries(linkTypes.map(t => [t.key, getLinkUrl(c, t) ?? ''])), [OTHER]: c.social_other_url ?? '' },
  });
  const val = (c: Competitor): Draft => drafts[c.id] ?? orig(c);
  const setField = (c: Competitor, k: typeof FIELDS[number], v: string) => setDrafts(d => ({ ...d, [c.id]: { ...val(c), [k]: v } }));
  const setLink = (c: Competitor, k: string, v: string) => setDrafts(d => ({ ...d, [c.id]: { ...val(c), links: { ...val(c).links, [k]: v } } }));
  // Ô trống không xoá dữ liệu cũ → chỉ tính là thay đổi khi có nội dung mới khác bản cũ.
  const diff = (c: Competitor): { fields: Partial<Record<typeof FIELDS[number], string>>; links: Record<string, string> } => {
    const d = drafts[c.id]; if (!d) return { fields: {}, links: {} };
    const o = orig(c); const fields: Partial<Record<typeof FIELDS[number], string>> = {}; const links: Record<string, string> = {};
    for (const k of FIELDS) { const v = d[k].trim(); if (v && v !== o[k]) fields[k] = v; }
    for (const [k, raw] of Object.entries(d.links)) { const v = raw.trim(); if (v && v !== (o.links[k] ?? '')) links[k] = v; }
    return { fields, links };
  };
  const hasDiff = (c: Competitor) => { const x = diff(c); return Object.keys(x.fields).length + Object.keys(x.links).length > 0; };
  const changed = sorted.filter(hasDiff);
  const isProblem = (c: Competitor) => imgStatus[c.id] === 'bad' || ['short', 'bad'].includes(mapLinkStatus(val(c).map_link) ?? '');
  const badCount = sorted.filter(isProblem).length;
  const shown = onlyBad ? sorted.filter(isProblem) : sorted;

  // Dán từ Excel: "Tên đối thủ ⇥ cột… " — link Maps / link ảnh được nhận tự động, chữ thường còn lại
  // lần lượt là Trụ sở rồi Người đứng đầu.
  const applyPaste = () => {
    const next = { ...drafts };
    const byKey = new Map(sorted.map(c => [companyKey(c.company_name), c]));
    let ok = 0; const miss: string[] = [];
    paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
      const [name, ...rest] = line.split('\t').map(x => x.trim());
      const c = byKey.get(companyKey(name));
      if (!c) { miss.push(name); return; }
      const upd = { ...(next[c.id] ?? val(c)) };
      const texts: string[] = [];
      rest.filter(Boolean).forEach(u => {
        const social = isUrl(u) && !isMap(u) ? linkTypes.find(t => t.key === (/facebook\.com|fb\.com|fb\.watch/i.test(u) ? 'facebook' : /tiktok\.com/i.test(u) ? 'tiktok' : '')) : undefined;
        if (isMap(u)) upd.map_link = u;
        else if (social) upd.links = { ...upd.links, [social.key]: u };
        else if (isUrl(u)) upd.image_url = u;
        else texts.push(u);
      });
      if (texts[0]) upd.zone_name = texts[0];
      if (texts[1]) upd.director = texts[1];
      next[c.id] = upd; ok++;
    });
    setDrafts(next);
    toast(`Điền ${ok} dòng${miss.length ? ` — không khớp đối thủ nào: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}` : ''}. Bấm Lưu để ghi.`);
    if (!miss.length) setPaste('');
  };

  const save = async () => {
    if (!changed.length) { toast('Chưa có thay đổi nào'); return; }
    setSaving(true);
    let done = 0, fail = 0;
    for (const c of changed) {
      const { fields, links } = diff(c);
      const updates: Record<string, unknown> = { ...fields };
      const custom: Record<string, string> = { ...(c.custom_links ?? {}) };
      let customChanged = false;
      for (const [k, v] of Object.entries(links)) {
        if (k === OTHER) { updates.social_other_url = v; continue; }
        const t = linkTypes.find(x => x.key === k);
        if (!t) continue;
        if (t.field) updates[t.field] = v; else { custom[k] = v; customChanged = true; }
      }
      if (customChanged) updates.custom_links = custom;
      const { error } = await supabase.from('competitors').update(updates).eq('id', c.id);
      if (error) { fail++; continue; }
      done++;
      await logActivity({
        user, action: 'update', table: 'competitors', recordId: c.id,
        description: `Nhập nhanh ảnh/trụ sở/Maps/giám đốc/mạng xã hội cho đối thủ "${c.company_name}"`,
        oldData: c, newData: { ...c, ...updates },
      });
    }
    await onRefresh();
    setSaving(false);
    toast(fail ? `Đã lưu ${done}, lỗi ${fail} đối thủ` : `Đã cập nhật ${done} đối thủ`);
    if (!fail) onClose(); else setDrafts({});
  };

  const inp = 'w-full text-[12px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[14px] shadow-2xl w-full max-w-[1040px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2]">
          <div>
            <div className="text-[14px] font-semibold text-[#111]">Nhập nhanh Ảnh, Vị trí, Người đứng đầu & Mạng xã hội — Đối thủ</div>
            <div className="text-[11px] text-[#999]">Chỉ ghi ô bạn điền — ô trống giữ nguyên dữ liệu cũ, không xoá gì.</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={15} /></button>
        </div>
        <div className="px-5 py-3 border-b border-[#F0EFEA] space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#666] flex-wrap">
            <ClipboardPaste size={12} /> Dán nhiều dòng từ Excel: <span className="font-mono text-[10.5px] bg-gray-100 px-1 rounded">Tên đối thủ ⇥ Link ảnh ⇥ Link Maps ⇥ Trụ sở ⇥ Người đứng đầu</span> (link ảnh/Maps/Facebook/TikTok tự nhận; chữ còn lại: cột đầu là Trụ sở, cột sau là Người đứng đầu). Mở ▸ từng dòng để nhập Website, Facebook, TikTok…
          </div>
          <div className="flex gap-2">
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2} placeholder="Dán vào đây…"
              className="flex-1 text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-none font-mono" />
            <button onClick={applyPaste} disabled={!paste.trim()}
              className="self-end px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#E8E7E2] text-[#444] hover:bg-[#F9F9F7] disabled:opacity-40">Điền vào bảng</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-5 py-2">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left text-[11px] text-[#888]">
                <th className="py-1.5 pr-2 font-medium w-[19%]">Đối thủ</th>
                <th className="py-1.5 pr-2 font-medium w-[23%]">Link ảnh cover</th>
                <th className="py-1.5 pr-2 font-medium w-[13%]">Trụ sở</th>
                <th className="py-1.5 pr-2 font-medium w-[25%]">Link Google Maps</th>
                <th className="py-1.5 font-medium">Người đứng đầu</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(c => {
                const d = val(c);
                const st = mapLinkStatus(d.map_link);
                const isOpen = expanded.has(c.id);
                const linkCount = Object.values(d.links).filter(v => v.trim()).length;
                return (
                  <Fragment key={c.id}>
                    <tr className={`align-top ${hasDiff(c) ? 'bg-blue-50/50' : ''}`}>
                      <td className="py-1 pr-2 text-[#111] font-medium max-w-[190px]" title={c.company_name}>
                        <div className="flex items-start gap-1">
                          <button onClick={() => toggle(c.id)} title={isOpen ? 'Thu gọn' : 'Mở rộng để nhập mạng xã hội (Website, Facebook, TikTok…)'}
                            className="mt-0.5 p-0.5 rounded hover:bg-gray-100 text-[#999] hover:text-[#333] shrink-0">
                            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                          <span className="truncate">{c.company_name}</span>
                          {linkCount > 0 && <span className="shrink-0 text-[9.5px] px-1.5 py-px rounded-full bg-gray-100 text-[#666] font-normal">{linkCount} link</span>}
                        </div>
                      </td>
                      <td className="py-1 pr-2">
                        <div className="flex items-center gap-1.5">
                          <ImageThumb url={d.image_url} onStatus={s => setImgStatus(m => m[c.id] === s ? m : { ...m, [c.id]: s })} />
                          <input value={d.image_url} onChange={e => setField(c, 'image_url', e.target.value)} placeholder="https://…" className={inp} />
                        </div>
                      </td>
                      <td className="py-1 pr-2"><input value={d.zone_name} onChange={e => setField(c, 'zone_name', e.target.value)} placeholder="Biên Hoà…" className={inp} /></td>
                      <td className="py-1 pr-2">
                        <input value={d.map_link} onChange={e => setField(c, 'map_link', e.target.value)} placeholder="https://maps…" className={inp} />
                        {st && <div className={`text-[10.5px] mt-0.5 ${MAP_LINK_STATUS_TEXT[st].cls}`}>{MAP_LINK_STATUS_TEXT[st].text}</div>}
                      </td>
                      <td className="py-1"><input value={d.director} onChange={e => setField(c, 'director', e.target.value)} placeholder="Họ tên giám đốc" className={inp} /></td>
                    </tr>
                    {isOpen && (
                      <tr className={hasDiff(c) ? 'bg-blue-50/50' : ''}>
                        <td colSpan={5} className="pb-2 pl-6 pr-1">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1.5 rounded-lg border border-[#EEEDE8] bg-[#FBFBF9] p-2.5">
                            {[...linkTypes.map(t => ({ key: t.key, label: t.label, Icon: iconForLinkKey(t.key) })), { key: OTHER, label: 'Khác', Icon: iconForLinkKey(OTHER) }].map(({ key, label, Icon }) => (
                              <div key={key} className="flex items-center gap-1.5">
                                <span className="w-[84px] shrink-0 flex items-center gap-1 text-[11.5px] text-[#666]"><Icon size={11} /> {label}</span>
                                <input value={d.links[key] ?? ''} onChange={e => setLink(c, key, e.target.value)} placeholder="https://…" className={inp} />
                              </div>
                            ))}
                            <div className="md:col-span-2 text-[10.5px] text-[#999]">Ô trống giữ nguyên link cũ. Muốn gỡ link, mở ▸ hàng đó ở bảng danh sách bên ngoài.</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#E8E7E2]">
          <div className="flex items-center gap-3">
            <span className="text-[11.5px] text-[#888]">{changed.length} đối thủ có thay đổi</span>
            <button onClick={() => setOnlyBad(v => !v)} className={`text-[11.5px] px-2 py-1 rounded-lg border ${onlyBad ? 'bg-red-50 border-red-300 text-red-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
              {badCount > 0 ? `Chỉ hiện dòng lỗi ảnh/Maps (${badCount})` : 'Không có dòng lỗi'}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px] border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]">Đóng</button>
            <button onClick={save} disabled={saving || !changed.length}
              className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-40">
              {saving ? 'Đang lưu…' : `Lưu ${changed.length || ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
