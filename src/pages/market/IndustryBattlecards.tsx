import { useEffect, useState } from 'react';
import { Swords, ChevronDown, ChevronUp, Plus, Trash2, Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { IndustryBattlecard } from '../../lib/types';

interface Props { industryId: string; toast: (m: string) => void; }

const CATEGORIES = ['Vụ mùa', 'Giữ chân LĐ', 'An toàn LĐ', 'Chi phí & phí dịch vụ', 'Khác'];

const emptyDraft = () => ({ pain_point: '', our_weapon: '', pitching_script: '', category: '' });

export default function IndustryBattlecards({ industryId, toast }: Props) {
  const [items, setItems] = useState<IndustryBattlecard[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<IndustryBattlecard | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || loaded) return;
    supabase.from('industry_battlecards').select('*').eq('industry_id', industryId).order('sort_order').order('created_at')
      .then(({ data }) => { setItems((data ?? []) as IndustryBattlecard[]); setLoaded(true); });
  }, [expanded, loaded, industryId]);

  const handleAdd = async () => {
    const pain = draft.pain_point.trim();
    const weapon = draft.our_weapon.trim();
    if (!pain || !weapon) { toast('Nhập ít nhất Điểm đau và Vũ khí'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('industry_battlecards').insert({
      industry_id: industryId,
      pain_point: pain,
      our_weapon: weapon,
      pitching_script: draft.pitching_script.trim() || null,
      category: draft.category || null,
      sort_order: items.length,
    }).select().single();
    setSaving(false);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setItems(prev => [...prev, data as IndustryBattlecard]);
    setDraft(emptyDraft());
    setShowAdd(false);
    toast('Đã thêm kịch bản BD');
  };

  const saveField = async (it: IndustryBattlecard, field: 'pain_point' | 'our_weapon' | 'pitching_script', value: string) => {
    const v = value.trim();
    if ((it[field] ?? '') === v) return;
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, [field]: v || null } : x));
    const { error } = await supabase.from('industry_battlecards').update({ [field]: v || null }).eq('id', it.id);
    if (error) toast('Lỗi: ' + error.message);
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    const { error } = await supabase.from('industry_battlecards').delete().eq('id', confirmDel.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setItems(prev => prev.filter(x => x.id !== confirmDel.id));
    setConfirmDel(null);
    toast('Đã xoá kịch bản BD');
  };

  const copyCard = async (it: IndustryBattlecard) => {
    const text = [
      `Điểm đau: ${it.pain_point}`,
      `Vũ khí: ${it.our_weapon}`,
      it.pitching_script ? `Lời thoại: ${it.pitching_script}` : null,
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(it.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast('Không copy được');
    }
  };

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <button onClick={() => setExpanded(e => !e)} className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-[#F9F9F7] transition text-left">
        <Swords size={13} className="text-red-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Kịch bản tư vấn BD & Battlecard</div>
        {loaded && <span className="text-[10.5px] text-[#999]">{items.length} kịch bản</span>}
        {expanded ? <ChevronUp size={14} className="ml-auto text-[#999]" /> : <ChevronDown size={14} className="ml-auto text-[#999]" />}
      </button>

      {expanded && (
        <div className="border-t border-[#E8E7E2] p-3 space-y-2">
          {!loaded && <div className="text-center py-4 text-[11.5px] text-[#999]">Đang tải...</div>}
          {loaded && items.length === 0 && !showAdd && (
            <div className="text-center py-4 text-[11.5px] text-[#aaa]">Chưa có kịch bản BD nào cho ngành này.</div>
          )}
          {items.map(it => (
            <div key={it.id} className="bg-[#F9F9F7] rounded-lg border-l-[3px] border-l-red-400 p-3 group">
              <div className="flex items-start justify-between gap-2">
                {it.category && <span className="text-[10px] font-medium text-red-700 bg-red-50 rounded-full px-2 py-0.5">{it.category}</span>}
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => copyCard(it)} title="Copy lời thoại" className="p-1 rounded text-[#999] hover:text-blue-600 hover:bg-white">
                    {copiedId === it.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  </button>
                  <button onClick={() => setConfirmDel(it)} title="Xoá" className="p-1 rounded text-[#999] hover:text-red-600 hover:bg-white"><Trash2 size={12} /></button>
                </div>
              </div>
              <div className="mt-1.5">
                <div className="text-[10px] font-medium text-[#999]">Điểm đau / Tình huống khách hàng</div>
                <textarea defaultValue={it.pain_point} onBlur={e => saveField(it, 'pain_point', e.target.value)} rows={2}
                  className="w-full text-[12px] text-[#111] outline-none bg-transparent resize-none border-b border-dashed border-transparent hover:border-[#D8D6D0] focus:border-blue-500" />
              </div>
              <div className="mt-1.5">
                <div className="text-[10px] font-medium text-[#999]">Vũ khí / Solution</div>
                <textarea defaultValue={it.our_weapon} onBlur={e => saveField(it, 'our_weapon', e.target.value)} rows={2}
                  className="w-full text-[12px] text-emerald-700 font-medium outline-none bg-transparent resize-none border-b border-dashed border-transparent hover:border-[#D8D6D0] focus:border-blue-500" />
              </div>
              <div className="mt-1.5">
                <div className="text-[10px] font-medium text-[#999]">Lời thoại mẫu cho BD</div>
                <textarea defaultValue={it.pitching_script ?? ''} onBlur={e => saveField(it, 'pitching_script', e.target.value)} rows={2}
                  placeholder="Văn bản BD nói/gửi cho khách…"
                  className="w-full text-[11.5px] text-[#555] italic outline-none bg-transparent resize-none border-b border-dashed border-transparent hover:border-[#D8D6D0] focus:border-blue-500" />
              </div>
            </div>
          ))}

          {showAdd ? (
            <div className="bg-white border border-dashed border-blue-300 rounded-lg p-3 space-y-2">
              <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="text-[11px] px-2 py-1 rounded border border-gray-300 outline-none focus:border-blue-500">
                <option value="">Phân loại (tuỳ chọn)</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <textarea value={draft.pain_point} onChange={e => setDraft(d => ({ ...d, pain_point: e.target.value }))} rows={2}
                placeholder="Điểm đau / Tình huống khách hàng…"
                className="w-full text-[12px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-500 resize-none" />
              <textarea value={draft.our_weapon} onChange={e => setDraft(d => ({ ...d, our_weapon: e.target.value }))} rows={2}
                placeholder="Vũ khí / Solution của bên mình…"
                className="w-full text-[12px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-500 resize-none" />
              <textarea value={draft.pitching_script} onChange={e => setDraft(d => ({ ...d, pitching_script: e.target.value }))} rows={2}
                placeholder="Lời thoại mẫu cho BD…"
                className="w-full text-[12px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-500 resize-none" />
              <div className="flex gap-2">
                <button onClick={() => { setShowAdd(false); setDraft(emptyDraft()); }}
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-[11.5px] font-medium text-gray-600">Huỷ</button>
                <button onClick={handleAdd} disabled={saving}
                  className="flex-1 px-3 py-1.5 bg-[#1D4ED8] text-white rounded-lg text-[11.5px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Thêm kịch bản'}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)} className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[11.5px] font-medium border border-dashed border-[#D8D6D0] text-[#777] hover:border-blue-400 hover:text-blue-600 transition">
              <Plus size={12} /> Thêm kịch bản BD
            </button>
          )}
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-sm p-5 shadow-xl">
            <div className="text-[14px] font-semibold text-[#111] mb-1.5">Xoá kịch bản BD?</div>
            <div className="text-[12px] text-[#666] leading-relaxed">Kịch bản "<b>{confirmDel.pain_point}</b>" sẽ bị xoá vĩnh viễn.</div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmDel(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleDelete} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-[12px] font-medium hover:bg-red-700">Xoá</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
