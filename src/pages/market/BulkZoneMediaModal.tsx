import { useMemo, useState } from 'react';
import { X, ClipboardPaste } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { parseLatLngFromLink, isValidVnLatLng, mapLinkStatus, MAP_LINK_STATUS_TEXT } from '../../lib/geo';
import ImageThumb from '../../components/ImageThumb';
import type { MarketZone } from '../../lib/types';
import { zoneKey } from './shared';

interface Props {
  zones: MarketZone[];
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  toast: (msg: string) => void;
}

type Draft = { image_url: string; map_link: string };

/** Nhập nhanh Ảnh cover + Link Google Maps cho nhiều KCN cùng lúc.
 * Chỉ GHI những ô người dùng đã sửa và không bao giờ xoá dữ liệu cũ: ô để trống = giữ nguyên. */
export default function BulkZoneMediaModal({ zones, onClose, onRefresh, toast }: Props) {
  const { user } = useAuth();
  const sorted = useMemo(() => [...zones].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [zones]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [paste, setPaste] = useState('');
  const [saving, setSaving] = useState(false);
  const [imgStatus, setImgStatus] = useState<Record<string, 'ok' | 'bad' | null>>({});
  const [onlyBad, setOnlyBad] = useState(false);

  const val = (z: MarketZone): Draft => drafts[z.id] ?? { image_url: z.image_url ?? '', map_link: z.map_link ?? '' };
  const setField = (z: MarketZone, k: keyof Draft, v: string) =>
    setDrafts(d => ({ ...d, [z.id]: { ...val(z), [k]: v } }));

  const isChanged = (z: MarketZone) => {
    const d = drafts[z.id];
    if (!d) return false;
    const img = d.image_url.trim(), map = d.map_link.trim();
    // Ô trống không xoá dữ liệu cũ → chỉ tính là thay đổi khi có nội dung mới khác bản cũ
    return (!!img && img !== (z.image_url ?? '')) || (!!map && map !== (z.map_link ?? ''));
  };
  const changed = sorted.filter(isChanged);
  const isProblem = ((z: any) => imgStatus[z.id] === 'bad' || ['short','bad'].includes(mapLinkStatus(val(z).map_link) ?? ''));
  const badCount = sorted.filter(isProblem).length;
  const shown = onlyBad ? sorted.filter(isProblem) : sorted;

  // Dán từ Excel/Sheets: mỗi dòng "Tên KCN [tab] Link ảnh [tab] Link Google Maps"
  const applyPaste = () => {
    const next = { ...drafts };
    const byKey = new Map(sorted.map(z => [zoneKey(z.name), z]));
    let ok = 0; const miss: string[] = [];
    paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
      const cols = line.split('\t').map(c => c.trim());
      const [name, a, b] = cols;
      const z = byKey.get(zoneKey(name));
      if (!z) { miss.push(name); return; }
      const urls = [a, b].filter(Boolean);
      const isMap = (u: string) => /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google|@-?\d+\.\d+,-?\d+\.\d+/i.test(u);
      const cur = next[z.id] ?? val(z);
      const upd = { ...cur };
      urls.forEach(u => { if (isMap(u)) upd.map_link = u; else upd.image_url = u; });
      next[z.id] = upd; ok++;
    });
    setDrafts(next);
    toast(`Điền ${ok} dòng${miss.length ? ` — không khớp KCN nào: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}` : ''}. Bấm Lưu để ghi.`);
    if (!miss.length) setPaste('');
  };

  const save = async () => {
    if (!changed.length) { toast('Chưa có thay đổi nào'); return; }
    setSaving(true);
    let done = 0, fail = 0;
    for (const z of changed) {
      const d = drafts[z.id];
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (d.image_url.trim()) updates.image_url = d.image_url.trim();
      if (d.map_link.trim()) {
        updates.map_link = d.map_link.trim();
        const p = parseLatLngFromLink(d.map_link);
        if (isValidVnLatLng(p)) Object.assign(updates, { lat: p.lat, lng: p.lng, geocoded_at: new Date().toISOString() });
      }
      const { error } = await supabase.from('market_zones').update(updates).eq('id', z.id);
      if (error) { fail++; continue; }
      done++;
      await logActivity({
        user, action: 'update', table: 'market_zones', recordId: z.id,
        description: `Nhập nhanh ảnh/link Maps cho KCN "${z.name}"`,
        oldData: z, newData: { ...z, ...updates },
      });
    }
    await onRefresh();
    setSaving(false);
    toast(fail ? `Đã lưu ${done}, lỗi ${fail} KCN` : `Đã cập nhật ${done} KCN`);
    if (!fail) onClose();
    else setDrafts({});
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[14px] shadow-2xl w-full max-w-[860px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2]">
          <div>
            <div className="text-[14px] font-semibold text-[#111]">Nhập nhanh Ảnh & Google Maps</div>
            <div className="text-[11px] text-[#999]">Chỉ ghi ô bạn điền — ô trống giữ nguyên dữ liệu cũ, không xoá gì.</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={15} /></button>
        </div>

        <div className="px-5 py-3 border-b border-[#F0EFEA] space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#666]">
            <ClipboardPaste size={12} /> Dán nhiều dòng từ Excel: <span className="font-mono text-[10.5px] bg-gray-100 px-1 rounded">Tên KCN ⇥ Link ảnh ⇥ Link Maps</span> (tự nhận link nào là ảnh, link nào là Maps)
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
                <th className="py-1.5 pr-2 font-medium w-[26%]">KCN</th>
                <th className="py-1.5 pr-2 font-medium">Link ảnh cover</th>
                <th className="py-1.5 font-medium">Link Google Maps</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(z => {
                const d = val(z);
                const mark = isChanged(z);
                return (
                  <tr key={z.id} className={mark ? 'bg-blue-50/50' : ''}>
                    <td className="py-1 pr-2 text-[#111] truncate max-w-[200px]" title={z.name}>{z.name}</td>
                    <td className="py-1 pr-2 flex items-center gap-1.5">
                      <ImageThumb url={d.image_url} onStatus={st => setImgStatus(m => m[z.id] === st ? m : { ...m, [z.id]: st })} />
                      <input value={d.image_url} onChange={e => setField(z, 'image_url', e.target.value)} placeholder="https://…"
                        className="w-full text-[12px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-500" />
                    </td>
                    <td className="py-1">
                      <input value={d.map_link} onChange={e => setField(z, 'map_link', e.target.value)} placeholder="https://maps…"
                        className="w-full text-[12px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-500" />
                      {(() => { const st = mapLinkStatus(d.map_link); return st ? <div className={`text-[10.5px] mt-0.5 ${MAP_LINK_STATUS_TEXT[st].cls}`}>{MAP_LINK_STATUS_TEXT[st].text}</div> : null; })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-[#E8E7E2]">
          <div className="flex items-center gap-3">
            <span className="text-[11.5px] text-[#888]">{changed.length} KCN có thay đổi</span>
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
