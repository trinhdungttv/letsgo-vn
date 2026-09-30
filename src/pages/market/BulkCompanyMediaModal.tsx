import { useMemo, useState } from 'react';
import { X, ClipboardPaste } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { parseLatLngFromLink, isValidVnLatLng, mapLinkStatus, MAP_LINK_STATUS_TEXT } from '../../lib/geo';
import ImageThumb from '../../components/ImageThumb';
import type { Client, MarketLead } from '../../lib/types';

interface Props {
  clients: Client[];       // KH đang hợp tác đã thiết lập theo dõi thị trường
  leads: MarketLead[];     // Công ty/dự án tiềm năng (chưa có cột ảnh)
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  toast: (msg: string) => void;
}

type Row = { key: string; kind: 'client' | 'lead'; id: string; name: string; image: string; map: string; raw: Client | MarketLead };
type Draft = { image: string; map: string };

const norm = (s?: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const isMap = (u: string) => /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google|@-?\d+\.\d+,-?\d+\.\d+/i.test(u);

/** Nhập nhanh Ảnh cover + Link Google Maps cho nhiều công ty cùng lúc.
 * Chỉ ghi ô người dùng điền; ô trống giữ nguyên dữ liệu cũ (không xoá gì). */
export default function BulkCompanyMediaModal({ clients, leads, onClose, onRefresh, toast }: Props) {
  const { user } = useAuth();
  const rows: Row[] = useMemo(() => [
    ...clients.map(c => ({ key: 'c' + c.id, kind: 'client' as const, id: c.id, name: c.name, image: c.cover_image_url ?? '', map: c.map_link ?? '', raw: c })),
    ...leads.map(l => ({ key: 'l' + l.id, kind: 'lead' as const, id: l.id, name: l.company_name, image: '', map: l.map_link ?? '', raw: l })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [clients, leads]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [paste, setPaste] = useState('');
  const [saving, setSaving] = useState(false);
  const [imgStatus, setImgStatus] = useState<Record<string, 'ok' | 'bad' | null>>({});
  const [onlyBad, setOnlyBad] = useState(false);

  const val = (r: Row): Draft => drafts[r.key] ?? { image: r.image, map: r.map };
  const setField = (r: Row, k: keyof Draft, v: string) => setDrafts(d => ({ ...d, [r.key]: { ...val(r), [k]: v } }));
  const isChanged = (r: Row) => {
    const d = drafts[r.key];
    if (!d) return false;
    const img = d.image.trim(), map = d.map.trim();
    return (r.kind === 'client' && !!img && img !== r.image) || (!!map && map !== r.map);
  };
  const changed = rows.filter(isChanged);
  const isProblem = ((r: any) => imgStatus[r.key] === 'bad' || ['short','bad'].includes(mapLinkStatus(val(r).map) ?? ''));
  const badCount = rows.filter(isProblem).length;
  const shown = onlyBad ? rows.filter(isProblem) : rows;

  const applyPaste = () => {
    const next = { ...drafts };
    const byName = new Map<string, Row[]>();
    rows.forEach(r => byName.set(norm(r.name), [...(byName.get(norm(r.name)) ?? []), r]));
    let ok = 0; const miss: string[] = [];
    paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
      const [name, a, b] = line.split('\t').map(c => c.trim());
      const hits = byName.get(norm(name));
      if (!hits) { miss.push(name); return; }
      hits.forEach(r => {
        const upd = { ...(next[r.key] ?? val(r)) };
        [a, b].filter(Boolean).forEach(u => { if (isMap(u)) upd.map = u; else if (r.kind === 'client') upd.image = u; });
        next[r.key] = upd;
      });
      ok++;
    });
    setDrafts(next);
    toast(`Điền ${ok} dòng${miss.length ? ` — không khớp công ty nào: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}` : ''}. Bấm Lưu để ghi.`);
    if (!miss.length) setPaste('');
  };

  const save = async () => {
    if (!changed.length) { toast('Chưa có thay đổi nào'); return; }
    setSaving(true);
    let done = 0, fail = 0;
    for (const r of changed) {
      const d = drafts[r.key];
      const updates: Record<string, unknown> = {};
      if (r.kind === 'client' && d.image.trim()) updates.cover_image_url = d.image.trim();
      if (d.map.trim()) {
        updates.map_link = d.map.trim();
        const p = parseLatLngFromLink(d.map);
        if (isValidVnLatLng(p)) Object.assign(updates, { lat: p.lat, lng: p.lng, geocoded_at: new Date().toISOString() });
      }
      const table = r.kind === 'client' ? 'clients' : 'market_leads';
      const { error } = await supabase.from(table).update(updates).eq('id', r.id);
      if (error) { fail++; continue; }
      done++;
      await logActivity({
        user, action: 'update', table, recordId: r.id,
        description: `Nhập nhanh ảnh/link Maps cho "${r.name}"`,
        oldData: r.raw, newData: { ...r.raw, ...updates },
      });
    }
    await onRefresh();
    setSaving(false);
    toast(fail ? `Đã lưu ${done}, lỗi ${fail} công ty` : `Đã cập nhật ${done} công ty`);
    if (!fail) onClose(); else setDrafts({});
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[14px] shadow-2xl w-full max-w-[860px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2]">
          <div>
            <div className="text-[14px] font-semibold text-[#111]">Nhập nhanh Ảnh & Google Maps — Công ty</div>
            <div className="text-[11px] text-[#999]">Chỉ ghi ô bạn điền — ô trống giữ nguyên dữ liệu cũ. Công ty/dự án tiềm năng chưa có ảnh cover nên chỉ nhập link Maps.</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={15} /></button>
        </div>
        <div className="px-5 py-3 border-b border-[#F0EFEA] space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#666]">
            <ClipboardPaste size={12} /> Dán nhiều dòng từ Excel: <span className="font-mono text-[10.5px] bg-gray-100 px-1 rounded">Tên công ty ⇥ Link ảnh ⇥ Link Maps</span> (tự nhận link nào là ảnh, link nào là Maps)
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
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-[11px] text-[#888]">
                <th className="py-1.5 pr-2 font-medium w-[26%]">Công ty</th>
                <th className="py-1.5 pr-2 font-medium">Link ảnh cover</th>
                <th className="py-1.5 font-medium">Link Google Maps</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const d = val(r);
                return (
                  <tr key={r.key} className={isChanged(r) ? 'bg-blue-50/50' : ''}>
                    <td className="py-1 pr-2 text-[#111] truncate max-w-[200px]" title={r.name}>
                      {r.name} <span className={`text-[9.5px] px-1 rounded ${r.kind === 'client' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700'}`}>{r.kind === 'client' ? 'KH' : 'TN'}</span>
                    </td>
                    <td className="py-1 pr-2 flex items-center gap-1.5">
                      <ImageThumb url={d.image} onStatus={st => setImgStatus(m => m[r.key] === st ? m : { ...m, [r.key]: st })} />
                      <input value={d.image} disabled={r.kind === 'lead'} onChange={e => setField(r, 'image', e.target.value)} placeholder={r.kind === 'lead' ? '—' : 'https://…'}
                        className="w-full text-[12px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-500 disabled:bg-gray-50" />
                    </td>
                    <td className="py-1">
                      <input value={d.map} onChange={e => setField(r, 'map', e.target.value)} placeholder="https://maps…"
                        className="w-full text-[12px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-500" />
                      {(() => { const st = mapLinkStatus(d.map); return st ? <div className={`text-[10.5px] mt-0.5 ${MAP_LINK_STATUS_TEXT[st].cls}`}>{MAP_LINK_STATUS_TEXT[st].text}</div> : null; })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#E8E7E2]">
          <div className="flex items-center gap-3">
            <span className="text-[11.5px] text-[#888]">{changed.length} công ty có thay đổi</span>
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
