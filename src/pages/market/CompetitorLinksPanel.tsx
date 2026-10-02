import { useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { LinkHealthDot } from '../../components/LinkHealthDot';
import MapLinkHint from '../../components/MapLinkHint';
import { useLinkHealth } from '../../lib/linkCheck';
import { type CompetitorLinkType, getLinkUrl, iconForLinkKey } from './competitorLinks';
import type { Competitor } from '../../lib/types';

/** Khung mở rộng dưới mỗi dòng đối thủ: nhập/sửa nhanh Website, Facebook, TikTok, Bản đồ và các
 * loại link tự thêm — cùng nguồn dữ liệu với nút "Liên kết nhanh" trong hồ sơ đối thủ. Ô để
 * trống = xoá link đó (khác với bảng nhập nhanh hàng loạt), nên chỉ ghi khi bấm Lưu. */
export default function CompetitorLinksPanel({ competitor, linkTypes, onAddType, onSaved, toast }: {
  competitor: Competitor;
  linkTypes: CompetitorLinkType[];
  onAddType: (label: string) => Promise<string | null>;
  onSaved: () => Promise<void> | void;
  toast: (msg: string) => void;
}) {
  const { user } = useAuth();
  const initial = () => {
    const d: Record<string, string> = {};
    linkTypes.forEach(t => { d[t.key] = getLinkUrl(competitor, t) ?? ''; });
    d.__other = competitor.social_other_url ?? '';
    return d;
  };
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  // Loại link tự thêm sau khi khung đã mở: thêm ô trống, giữ nguyên những gì đang gõ.
  const val = (k: string) => draft[k] ?? '';
  const orig = (t: CompetitorLinkType) => getLinkUrl(competitor, t) ?? '';
  const dirty = linkTypes.some(t => val(t.key).trim() !== orig(t).trim()) || val('__other').trim() !== (competitor.social_other_url ?? '').trim();

  const health = useLinkHealth([...linkTypes.map(t => orig(t)), competitor.social_other_url ?? '']);

  const save = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = {};
    const custom: Record<string, string> = { ...(competitor.custom_links ?? {}) };
    for (const t of linkTypes) {
      const v = val(t.key).trim();
      if (t.field) patch[t.field] = v || null;
      else if (v) custom[t.key] = v; else delete custom[t.key];
    }
    patch.custom_links = custom;
    patch.social_other_url = val('__other').trim() || null;
    const { error } = await supabase.from('competitors').update(patch).eq('id', competitor.id);
    if (error) { setSaving(false); toast('Lỗi: ' + error.message); return; }
    await logActivity({
      user, action: 'update', table: 'competitors', recordId: competitor.id,
      description: `Cập nhật liên kết mạng xã hội của đối thủ "${competitor.company_name}"`,
      oldData: competitor, newData: { ...competitor, ...patch },
    });
    await onSaved();
    setSaving(false);
    toast('Đã lưu liên kết');
  };

  const addType = async () => {
    if (!newLabel.trim()) return;
    const err = await onAddType(newLabel);
    if (err) { toast('Lỗi thêm: ' + err); return; }
    setNewLabel('');
  };

  const inp = 'flex-1 min-w-0 text-[12px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 bg-white';
  const row = (key: string, label: string, Icon: ReturnType<typeof iconForLinkKey>, saved: string, isMap: boolean) => (
    <div key={key} className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="w-[92px] shrink-0 flex items-center gap-1 text-[11.5px] text-[#666]"><Icon size={11} /> {label}</span>
        <input value={val(key)} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} placeholder="https://…" className={inp} />
        {saved.trim() && <LinkHealthDot info={health[saved.trim()]} />}
      </div>
      {isMap && <div className="pl-[98px]"><MapLinkHint value={val(key)} /></div>}
    </div>
  );

  return (
    <div className="px-4 py-3 bg-[#FBFBF9] border-t border-[#F0EEE9]" onClick={e => e.stopPropagation()}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
        {linkTypes.map(t => row(t.key, t.label, iconForLinkKey(t.key), orig(t), t.key === 'map'))}
        {row('__other', 'Khác', iconForLinkKey('__other'), competitor.social_other_url ?? '', false)}
      </div>
      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addType(); }}
            placeholder="Thêm loại mới (Zalo, YouTube…)" className="w-52 text-[11.5px] px-2 py-1.5 rounded-lg border border-dashed border-gray-300 outline-none focus:border-blue-500 bg-white" />
          <button onClick={addType} disabled={!newLabel.trim()} title="Thêm loại liên kết — áp dụng cho mọi đối thủ"
            className="p-1.5 rounded-lg border border-gray-300 text-[#666] hover:bg-white disabled:opacity-40"><Plus size={12} /></button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] text-[#999]">Xoá nội dung ô rồi Lưu = gỡ link đó</span>
          <button onClick={() => setDraft(initial())} disabled={!dirty || saving} className="px-2.5 py-1 rounded-lg text-[11.5px] border border-gray-300 text-[#666] disabled:opacity-40">Hoàn lại</button>
          <button onClick={save} disabled={!dirty || saving} className="px-3 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-40">{saving ? 'Đang lưu…' : 'Lưu liên kết'}</button>
        </div>
      </div>
    </div>
  );
}
