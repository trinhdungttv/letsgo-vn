import { useEffect, useState } from 'react';
import { Workflow, Plus, Trash2, ArrowRight, PackageSearch, Building2, Globe2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { IndustryValueChainItem, ValueChainKind } from '../../lib/types';

const COLS: { kind: ValueChainKind; label: string; hint: string; icon: React.ReactNode; accent: string; summaryField: 'value_chain_input_summary' | 'value_chain_customer_summary' | 'value_chain_market_summary' }[] = [
  { kind: 'input', label: 'Đầu vào', hint: 'Nguyên liệu, linh kiện nhập từ đâu', icon: <PackageSearch size={12} />, accent: 'border-l-slate-400', summaryField: 'value_chain_input_summary' },
  { kind: 'customer', label: 'Khách của khách', hint: 'Nhà máy trong ngành bán cho ai', icon: <Building2 size={12} />, accent: 'border-l-blue-500', summaryField: 'value_chain_customer_summary' },
  { kind: 'market', label: 'Thị trường cuối', hint: 'Hàng đi nước nào, phụ thuộc ai', icon: <Globe2 size={12} />, accent: 'border-l-emerald-500', summaryField: 'value_chain_market_summary' },
];

interface Props { industryId: string; toast: (m: string) => void; }

export default function IndustryValueChain({ industryId, toast }: Props) {
  const [items, setItems] = useState<IndustryValueChainItem[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmDel, setConfirmDel] = useState<IndustryValueChainItem | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [showSummary, setShowSummary] = useState<Record<ValueChainKind, boolean>>({ input: false, customer: false, market: false });

  useEffect(() => {
    supabase.from('industry_value_chain').select('*').eq('industry_id', industryId).order('created_at')
      .then(({ data }) => setItems((data ?? []) as IndustryValueChainItem[]));
    supabase.from('industries').select('value_chain_input_summary, value_chain_customer_summary, value_chain_market_summary').eq('id', industryId).single()
      .then(({ data }) => setSummaries({
        value_chain_input_summary: data?.value_chain_input_summary ?? '',
        value_chain_customer_summary: data?.value_chain_customer_summary ?? '',
        value_chain_market_summary: data?.value_chain_market_summary ?? '',
      }));
  }, [industryId]);

  const saveSummary = async (field: string, html: string) => {
    if ((summaries[field] ?? '') === html) return;
    setSummaries(prev => ({ ...prev, [field]: html }));
    const { error } = await supabase.from('industries').update({ [field]: html || null }).eq('id', industryId);
    if (error) toast('Lỗi: ' + error.message);
  };

  const add = async (kind: ValueChainKind) => {
    const name = (draft[kind] ?? '').trim();
    if (!name) return;
    const { data, error } = await supabase.from('industry_value_chain')
      .insert({ industry_id: industryId, kind, name }).select().single();
    if (error) { toast('Lỗi: ' + error.message); return; }
    setItems(prev => [...prev, data as IndustryValueChainItem]);
    setDraft(d => ({ ...d, [kind]: '' }));
  };

  const saveNote = async (it: IndustryValueChainItem, note: string) => {
    if ((it.note ?? '') === note) return;
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, note } : x));
    const { error } = await supabase.from('industry_value_chain').update({ note: note || null }).eq('id', it.id);
    if (error) toast('Lỗi: ' + error.message);
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    const { error } = await supabase.from('industry_value_chain').delete().eq('id', confirmDel.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setItems(prev => prev.filter(x => x.id !== confirmDel.id));
    setConfirmDel(null);
    toast('Đã xoá: ' + confirmDel.name);
  };

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
        <Workflow size={13} className="text-slate-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Chuỗi giá trị ngành</div>
        <span className="text-[10.5px] text-[#999]">đọc trước biến động: đơn hàng giảm ở đâu thì nhà máy nào cắt LĐ</span>
      </div>

      <div className="p-3 grid grid-cols-3 gap-2">
        {COLS.map((c, ci) => (
          <div key={c.kind} className="relative">
            {ci > 0 && <ArrowRight size={12} className="absolute -left-[13px] top-2 text-[#ccc]" />}
            <div className={`bg-[#F9F9F7] rounded-lg border-l-[3px] ${c.accent} px-2.5 py-2 h-full`}>
              <div className="flex items-center gap-1 text-[11.5px] font-medium text-[#111]">
                {c.icon} {c.label}
                <button
                  onClick={() => setShowSummary(s => ({ ...s, [c.kind]: !s[c.kind] }))}
                  title={showSummary[c.kind] ? 'Ẩn tổng quan' : 'Hiện tổng quan'}
                  className="ml-auto p-0.5 rounded text-[#bbb] hover:text-[#666] hover:bg-white"
                >
                  {showSummary[c.kind] ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
              </div>
              <div className="text-[10px] text-[#999] mb-1.5">{c.hint}</div>
              {showSummary[c.kind] && (
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={e => saveSummary(c.summaryField, e.currentTarget.innerHTML.trim())}
                  dangerouslySetInnerHTML={{ __html: summaries[c.summaryField] ?? '' }}
                  data-placeholder="Tổng quan tình hình… (Ctrl+B để in đậm)"
                  className="w-full min-h-[9.5em] max-h-[220px] overflow-y-auto text-[10.5px] text-[#555] leading-snug outline-none bg-white border border-dashed border-[#D8D6D0] rounded px-1.5 py-1 mb-1.5 focus:border-blue-500 empty:before:content-[attr(data-placeholder)] empty:before:text-[#999]"
                />
              )}
              <div className="space-y-1 max-h-[220px] overflow-y-auto pr-0.5">
                {items.filter(i => i.kind === c.kind).map(it => (
                  <div key={it.id} className="bg-white rounded px-2 py-1 group">
                    <div className="flex items-center gap-1">
                      <span className="text-[11.5px] font-medium text-[#111] flex-1 truncate">{it.name}</span>
                      <button onClick={() => setConfirmDel(it)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[#ccc] hover:text-red-600"><Trash2 size={11} /></button>
                    </div>
                    <input defaultValue={it.note ?? ''} onBlur={e => saveNote(it, e.target.value.trim())}
                      placeholder="ghi chú…" className="w-full text-[10.5px] text-[#777] outline-none bg-transparent" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <input value={draft[c.kind] ?? ''} onChange={e => setDraft(d => ({ ...d, [c.kind]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && add(c.kind)}
                  placeholder={c.kind === 'input' ? 'VD: Thịt heo nội địa' : c.kind === 'customer' ? 'VD: Unilever' : 'VD: Nhật Bản 40%'}
                  className="flex-1 text-[11px] px-2 py-1 rounded border border-dashed border-[#D8D6D0] outline-none focus:border-blue-500 bg-white" />
                <button onClick={() => add(c.kind)} className="p-1 rounded text-[#999] hover:text-[#111] hover:bg-white"><Plus size={12} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {confirmDel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-sm p-5 shadow-xl">
            <div className="text-[14px] font-semibold text-[#111] mb-1.5">Xoá mắt xích?</div>
            <div className="text-[12px] text-[#666] leading-relaxed"><b>{confirmDel.name}</b> và ghi chú kèm theo sẽ bị xoá vĩnh viễn.</div>
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
