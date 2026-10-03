import { Fragment, useMemo, useRef, useState } from 'react';
import { X, ClipboardPaste, ChevronRight, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';
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
  // Giá trị ĐÃ ghi vào database trong phiên này — bảng cha chỉ được tải lại khi đóng cửa sổ, nên
  // dùng lớp phủ này để biết dòng nào đã lưu xong (không phải lưu lại) và để so sánh đúng.
  const [overrides, setOverrides] = useState<Record<string, Partial<Competitor>>>({});
  const [rowState, setRowState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [paste, setPaste] = useState('');
  const [closing, setClosing] = useState(false);
  const [imgStatus, setImgStatus] = useState<Record<string, 'ok' | 'bad' | null>>({});
  const [onlyBad, setOnlyBad] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Bản đồ đã có cột riêng ở bảng chính nên không lặp lại trong phần mở rộng.
  const linkTypes = useMemo(() => allTypes.filter(t => t.field !== 'map_link' && t.key !== 'map'), [allTypes]);

  // Bản sao đồng bộ (ref) để các lần lưu chạy nền luôn đọc đúng giá trị mới nhất.
  const draftsRef = useRef(drafts); const overridesRef = useRef(overrides);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const errored = useRef(new Set<string>());
  const byId = useMemo(() => new Map(sorted.map(c => [c.id, c])), [sorted]);

  const eff = (c: Competitor): Competitor => ({ ...c, ...overridesRef.current[c.id] });
  const origOf = (c: Competitor): Draft => ({
    image_url: c.image_url ?? '', zone_name: c.zone_name ?? '', map_link: c.map_link ?? '', director: c.director ?? '',
    links: { ...Object.fromEntries(linkTypes.map(t => [t.key, getLinkUrl(c, t) ?? ''])), [OTHER]: c.social_other_url ?? '' },
  });
  const val = (c: Competitor): Draft => drafts[c.id] ?? origOf({ ...c, ...overrides[c.id] });

  // Ô trống không xoá dữ liệu cũ → chỉ tính là thay đổi khi có nội dung mới khác bản đã lưu.
  const buildUpdates = (c: Competitor, d: Draft | undefined): Record<string, unknown> => {
    if (!d) return {};
    const o = origOf(c); const updates: Record<string, unknown> = {};
    for (const k of FIELDS) { const v = d[k].trim(); if (v && v !== o[k]) updates[k] = v; }
    const custom: Record<string, string> = { ...(c.custom_links ?? {}) }; let customChanged = false;
    for (const [k, raw] of Object.entries(d.links)) {
      const v = raw.trim(); if (!v || v === (o.links[k] ?? '')) continue;
      if (k === OTHER) { updates.social_other_url = v; continue; }
      const t = linkTypes.find(x => x.key === k); if (!t) continue;
      if (t.field) updates[t.field] = v; else { custom[k] = v; customChanged = true; }
    }
    if (customChanged) updates.custom_links = custom;
    return updates;
  };
  const hasDiff = (c: Competitor) => Object.keys(buildUpdates({ ...c, ...overrides[c.id] }, drafts[c.id])).length > 0;
  const changed = sorted.filter(hasDiff);
  const busy = Object.values(rowState).includes('saving');
  useBeforeUnloadWarning(changed.length > 0 || busy);

  const updateDraft = (c: Competitor, fn: (d: Draft) => Draft) => {
    const cur = draftsRef.current[c.id] ?? origOf(eff(c));
    draftsRef.current = { ...draftsRef.current, [c.id]: fn(cur) };
    setDrafts(draftsRef.current);
    scheduleSave(c.id);
  };
  const setField = (c: Competitor, k: typeof FIELDS[number], v: string) => updateDraft(c, d => ({ ...d, [k]: v }));
  const setLink = (c: Competitor, k: string, v: string) => updateDraft(c, d => ({ ...d, links: { ...d.links, [k]: v } }));

  // TỰ LƯU: ngừng gõ ~0,8 giây là ghi ngay; rời khỏi ô (blur) hoặc đóng cửa sổ thì ghi tức thì.
  const scheduleSave = (id: string) => {
    const t = timers.current.get(id); if (t) clearTimeout(t);
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); void saveRow(id); }, 800));
  };
  const flushRow = (id: string) => {
    const t = timers.current.get(id); if (!t) return;
    clearTimeout(t); timers.current.delete(id); void saveRow(id);
  };

  const saveRow = async (id: string): Promise<void> => {
    const prev = inflight.current.get(id);
    const run = (async () => {
      if (prev) await prev.catch(() => {});             // lần lưu trước xong rồi mới tính lại phần thay đổi
      const base = byId.get(id); if (!base) return;
      const c = eff(base);
      const updates = buildUpdates(c, draftsRef.current[id]);
      if (!Object.keys(updates).length) return;
      setRowState(r => ({ ...r, [id]: 'saving' }));
      const { error } = await supabase.from('competitors').update(updates).eq('id', id);
      if (error) {
        errored.current.add(id);
        setRowState(r => ({ ...r, [id]: 'error' }));
        toast(`Không lưu được "${c.company_name}": ${error.message}`);
        return;
      }
      errored.current.delete(id);
      overridesRef.current = { ...overridesRef.current, [id]: { ...overridesRef.current[id], ...updates } as Partial<Competitor> };
      setOverrides(overridesRef.current);
      setRowState(r => ({ ...r, [id]: 'saved' }));
      await logActivity({
        user, action: 'update', table: 'competitors', recordId: id,
        description: `Nhập nhanh ảnh/trụ sở/Maps/giám đốc/mạng xã hội cho đối thủ "${c.company_name}"`,
        oldData: c, newData: { ...c, ...updates },
      });
    })();
    inflight.current.set(id, run);
    await run;
    if (inflight.current.get(id) === run) inflight.current.delete(id);
  };

  // Đóng cửa sổ: ghi nốt mọi thứ còn chờ rồi mới đóng — bấm nhầm nút đóng cũng không mất dữ liệu.
  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    timers.current.forEach(t => clearTimeout(t)); timers.current.clear();
    await Promise.all(Object.keys(draftsRef.current).map(saveRow));
    if (errored.current.size && !confirm(`Còn ${errored.current.size} đối thủ CHƯA lưu được (ô viền đỏ). Vẫn đóng và bỏ phần chưa lưu?`)) {
      setClosing(false); return;
    }
    await onRefresh();
    onClose();
  };

  const isProblem = (c: Competitor) => imgStatus[c.id] === 'bad' || ['short', 'bad'].includes(mapLinkStatus(val(c).map_link) ?? '');
  const badCount = sorted.filter(isProblem).length;
  const shown = onlyBad ? sorted.filter(isProblem) : sorted;

  // Dán từ Excel: "Tên đối thủ ⇥ cột… " — link Maps / link ảnh được nhận tự động, chữ thường còn lại
  // lần lượt là Trụ sở rồi Người đứng đầu.
  const applyPaste = () => {
    const byKey = new Map(sorted.map(c => [companyKey(c.company_name), c]));
    let ok = 0; const miss: string[] = [];
    paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
      const [name, ...rest] = line.split('\t').map(x => x.trim());
      const c = byKey.get(companyKey(name));
      if (!c) { miss.push(name); return; }
      updateDraft(c, cur => {
        const upd = { ...cur };
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
        return upd;
      });
      ok++;
    });
    toast(`Điền ${ok} dòng${miss.length ? ` — không khớp đối thủ nào: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}` : ''}. Đang tự lưu.`);
    if (!miss.length) setPaste('');
  };

  const inp = 'w-full text-[12px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-500';
  const inpErr = 'w-full text-[12px] px-2 py-1 border border-red-300 bg-red-50/40 rounded outline-none focus:border-red-500';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="bg-white rounded-[14px] shadow-2xl w-full max-w-[1040px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2]">
          <div>
            <div className="text-[14px] font-semibold text-[#111]">Nhập nhanh Ảnh, Vị trí, Người đứng đầu & Mạng xã hội — Đối thủ</div>
            <div className="text-[11px] text-[#999]">TỰ ĐỘNG LƯU ngay khi bạn gõ xong — không cần bấm Lưu. Ô trống giữ nguyên dữ liệu cũ, không xoá gì.</div>
          </div>
          <button onClick={handleClose} disabled={closing} className="p-1.5 hover:bg-gray-100 rounded"><X size={15} /></button>
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
                const rs = rowState[c.id];
                const pending = hasDiff(c);
                const blur = () => flushRow(c.id);
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
                          {pending && rs !== 'saving' && <span title="Sắp tự lưu…" className="shrink-0 text-[10px] text-[#999] font-normal">…</span>}
                          {rs === 'saving' && <span className="shrink-0 text-[10px] text-blue-600 font-normal">Đang lưu</span>}
                          {rs === 'saved' && !pending && <span title="Đã lưu" className="shrink-0 text-[10px] text-emerald-600 font-medium">✓ Đã lưu</span>}
                          {rs === 'error' && <span title="Lưu thất bại — kiểm tra lại nội dung rồi gõ lại" className="shrink-0 text-[10px] text-red-600 font-medium">⚠ Lỗi lưu</span>}
                          {linkCount > 0 && <span className="shrink-0 text-[9.5px] px-1.5 py-px rounded-full bg-gray-100 text-[#666] font-normal">{linkCount} link</span>}
                        </div>
                      </td>
                      <td className="py-1 pr-2">
                        <div className="flex items-center gap-1.5">
                          <ImageThumb url={d.image_url} onStatus={s => setImgStatus(m => m[c.id] === s ? m : { ...m, [c.id]: s })} />
                          <input value={d.image_url} onChange={e => setField(c, 'image_url', e.target.value)} onBlur={blur} placeholder="https://…" className={rs === 'error' ? inpErr : inp} />
                        </div>
                      </td>
                      <td className="py-1 pr-2"><input value={d.zone_name} onChange={e => setField(c, 'zone_name', e.target.value)} onBlur={blur} placeholder="Biên Hoà…" className={rs === 'error' ? inpErr : inp} /></td>
                      <td className="py-1 pr-2">
                        <input value={d.map_link} onChange={e => setField(c, 'map_link', e.target.value)} onBlur={blur} placeholder="https://maps…" className={rs === 'error' ? inpErr : inp} />
                        {st && <div className={`text-[10.5px] mt-0.5 ${MAP_LINK_STATUS_TEXT[st].cls}`}>{MAP_LINK_STATUS_TEXT[st].text}</div>}
                      </td>
                      <td className="py-1"><input value={d.director} onChange={e => setField(c, 'director', e.target.value)} onBlur={blur} placeholder="Họ tên giám đốc" className={rs === 'error' ? inpErr : inp} /></td>
                    </tr>
                    {isOpen && (
                      <tr className={hasDiff(c) ? 'bg-blue-50/50' : ''}>
                        <td colSpan={5} className="pb-2 pl-6 pr-1">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1.5 rounded-lg border border-[#EEEDE8] bg-[#FBFBF9] p-2.5">
                            {[...linkTypes.map(t => ({ key: t.key, label: t.label, Icon: iconForLinkKey(t.key) })), { key: OTHER, label: 'Khác', Icon: iconForLinkKey(OTHER) }].map(({ key, label, Icon }) => (
                              <div key={key} className="flex items-center gap-1.5">
                                <span className="w-[84px] shrink-0 flex items-center gap-1 text-[11.5px] text-[#666]"><Icon size={11} /> {label}</span>
                                <input value={d.links[key] ?? ''} onChange={e => setLink(c, key, e.target.value)} onBlur={blur} placeholder="https://…" className={rs === 'error' ? inpErr : inp} />
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
            <span className={`text-[11.5px] ${errored.current.size ? 'text-red-600' : busy || changed.length ? 'text-blue-600' : 'text-emerald-600'}`}>
              {errored.current.size ? `⚠ ${errored.current.size} đối thủ chưa lưu được` : busy || changed.length ? 'Đang tự lưu…' : '✓ Mọi thay đổi đã được lưu'}
            </span>
            <button onClick={() => setOnlyBad(v => !v)} className={`text-[11.5px] px-2 py-1 rounded-lg border ${onlyBad ? 'bg-red-50 border-red-300 text-red-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
              {badCount > 0 ? `Chỉ hiện dòng lỗi ảnh/Maps (${badCount})` : 'Không có dòng lỗi'}
            </button>
          </div>
          <button onClick={handleClose} disabled={closing}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-50">
            {closing ? 'Đang lưu nốt…' : 'Xong'}
          </button>
        </div>
      </div>
    </div>
  );
}
