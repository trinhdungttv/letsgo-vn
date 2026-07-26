import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Search, Pin, PinOff, Pencil, Trash2, X, Globe, ChevronDown, ChevronRight, Quote } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { IndustryTerm } from '../../lib/types';

export const TERM_CATEGORIES = [
  'Sản xuất', 'Chất lượng', 'Nhân sự & LĐ', 'Thương mại & đơn hàng', 'Chứng chỉ & tiêu chuẩn', 'Viết tắt', 'Khác',
] as const;

const CAT_STYLE: Record<string, string> = {
  'Sản xuất': 'bg-blue-50 text-blue-700',
  'Chất lượng': 'bg-emerald-50 text-emerald-700',
  'Nhân sự & LĐ': 'bg-violet-50 text-violet-700',
  'Thương mại & đơn hàng': 'bg-amber-50 text-amber-700',
  'Chứng chỉ & tiêu chuẩn': 'bg-cyan-50 text-cyan-700',
  'Viết tắt': 'bg-pink-50 text-pink-700',
  'Khác': 'bg-gray-100 text-gray-600',
};

interface Props {
  industryId: string;
  industryName: string;
  toast: (msg: string) => void;
}

type Form = {
  term: string; aliasesText: string; category: string;
  short_def: string; detail: string; example: string; shared: boolean;
};

const emptyForm: Form = { term: '', aliasesText: '', category: 'Sản xuất', short_def: '', detail: '', example: '', shared: false };

export default function IndustryTerms({ industryId, industryName, toast }: Props) {
  const [terms, setTerms] = useState<IndustryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<IndustryTerm | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<IndustryTerm | null>(null);

  // Lấy thuật ngữ của ngành này + thuật ngữ dùng chung (industry_id null)
  const load = async () => {
    const { data, error } = await supabase.from('industry_terms').select('*')
      .or(`industry_id.eq.${industryId},industry_id.is.null`).order('term');
    if (!error && data) setTerms(data as IndustryTerm[]);
    setLoading(false);
  };
  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [industryId]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return terms
      .filter(t => !cat || t.category === cat)
      .filter(t => !kw || [t.term, t.short_def, t.detail, t.example, ...(t.aliases ?? [])]
        .some(v => (v ?? '').toLowerCase().includes(kw)))
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || a.term.localeCompare(b.term, 'vi'));
  }, [terms, q, cat]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of terms) m.set(t.category || 'Khác', (m.get(t.category || 'Khác') ?? 0) + 1);
    return m;
  }, [terms]);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (t: IndustryTerm) => {
    setEditing(t);
    setForm({
      term: t.term, aliasesText: (t.aliases ?? []).join(', '), category: t.category || 'Khác',
      short_def: t.short_def ?? '', detail: t.detail ?? '', example: t.example ?? '', shared: t.industry_id == null,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    const term = form.term.trim();
    if (!term) { toast('Nhập tên thuật ngữ'); return; }
    setSaving(true);
    const payload = {
      industry_id: form.shared ? null : industryId,
      term,
      aliases: form.aliasesText.split(',').map(s => s.trim()).filter(Boolean),
      category: form.category,
      short_def: form.short_def.trim() || null,
      detail: form.detail.trim() || null,
      example: form.example.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (editing) {
      const { error } = await supabase.from('industry_terms').update(payload).eq('id', editing.id);
      setSaving(false);
      if (error) { toast('Lỗi: ' + error.message); return; }
      setTerms(prev => prev.map(t => t.id === editing.id ? { ...t, ...payload } : t));
      toast('Đã cập nhật: ' + term);
    } else {
      const { data, error } = await supabase.from('industry_terms').insert(payload).select().single();
      setSaving(false);
      if (error) { toast('Lỗi: ' + error.message); return; }
      setTerms(prev => [...prev, data as IndustryTerm]);
      toast('Đã thêm thuật ngữ: ' + term);
    }
    setShowModal(false);
  };

  const togglePin = async (t: IndustryTerm) => {
    const pinned = !t.pinned;
    setTerms(prev => prev.map(x => x.id === t.id ? { ...x, pinned } : x));
    const { error } = await supabase.from('industry_terms').update({ pinned }).eq('id', t.id);
    if (error) { toast('Lỗi: ' + error.message); setTerms(prev => prev.map(x => x.id === t.id ? { ...x, pinned: !pinned } : x)); }
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    const { error } = await supabase.from('industry_terms').delete().eq('id', confirmDel.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setTerms(prev => prev.filter(t => t.id !== confirmDel.id));
    toast('Đã xoá: ' + confirmDel.term);
    setConfirmDel(null);
  };

  const toggleOpen = (id: string) => setOpen(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
        <BookOpen size={13} className="text-blue-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Thuật ngữ ngành</div>
        <span className="text-[10.5px] text-[#999]">{terms.length} thuật ngữ · dùng khi trao đổi với khách</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#bbb]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm thuật ngữ, viết tắt…"
              className="w-[190px] text-[12px] pl-7 pr-2 py-1.5 rounded-lg border border-[#E8E7E2] outline-none focus:border-blue-500" />
          </div>
          <button onClick={openAdd} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
            <Plus size={13} /> Thêm thuật ngữ
          </button>
        </div>
      </div>

      {terms.length > 0 && (
        <div className="px-4 py-2 border-b border-[#F0EEE9] flex flex-wrap gap-1.5">
          <button onClick={() => setCat('')} className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition ${!cat ? 'bg-[#111] text-white' : 'bg-[#F4F3EF] text-[#666] hover:bg-[#EAE8E2]'}`}>
            Tất cả ({terms.length})
          </button>
          {TERM_CATEGORIES.filter(c => catCounts.get(c)).map(c => (
            <button key={c} onClick={() => setCat(cat === c ? '' : c)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition ${cat === c ? 'bg-[#111] text-white' : `${CAT_STYLE[c]} hover:opacity-80`}`}>
              {c} ({catCounts.get(c)})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-[12px] text-[#999] text-center py-6">Đang tải…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-[12px] text-[#aaa]">
          {terms.length === 0
            ? <>Chưa có thuật ngữ nào cho ngành <b>{industryName}</b>. Bấm "Thêm thuật ngữ" để bắt đầu từ điển của anh.</>
            : 'Không tìm thấy thuật ngữ phù hợp.'}
        </div>
      ) : (
        <div className="divide-y divide-[#F0EEE9]">
          {filtered.map(t => {
            const isOpen = open.has(t.id);
            const hasMore = !!(t.detail || t.example);
            return (
              <div key={t.id} className="px-4 py-2.5 hover:bg-[#FBFBF9] transition group">
                <div className="flex items-start gap-2">
                  <button onClick={() => hasMore && toggleOpen(t.id)} className={`mt-0.5 ${hasMore ? 'text-[#bbb] hover:text-[#666]' : 'text-transparent cursor-default'}`}>
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {t.pinned && <Pin size={10} className="text-amber-500 fill-amber-400" />}
                      <span className="text-[12.5px] font-semibold text-[#111]">{t.term}</span>
                      {(t.aliases ?? []).map(a => (
                        <span key={a} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F4F3EF] text-[#777]">{a}</span>
                      ))}
                      {t.category && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${CAT_STYLE[t.category] ?? CAT_STYLE['Khác']}`}>{t.category}</span>}
                      {t.industry_id == null && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600"><Globe size={9} /> Dùng chung</span>
                      )}
                    </div>
                    {t.short_def && <div className="text-[11.5px] text-[#666] mt-0.5 leading-relaxed">{t.short_def}</div>}
                    {isOpen && (
                      <div className="mt-2 space-y-2">
                        {t.detail && <div className="text-[12px] text-[#333] leading-relaxed whitespace-pre-wrap bg-[#F9F9F7] rounded-lg px-3 py-2">{t.detail}</div>}
                        {t.example && (
                          <div className="text-[12px] text-[#0f5132] leading-relaxed bg-emerald-50 rounded-lg px-3 py-2 flex gap-1.5">
                            <Quote size={12} className="shrink-0 mt-0.5 text-emerald-600" />
                            <span className="italic">{t.example}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                    <button onClick={() => togglePin(t)} title={t.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'} className="p-1 rounded hover:bg-[#F0EEE9] text-[#999]">
                      {t.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </button>
                    <button onClick={() => openEdit(t)} title="Sửa" className="p-1 rounded hover:bg-[#F0EEE9] text-[#999]"><Pencil size={12} /></button>
                    <button onClick={() => setConfirmDel(t)} title="Xoá" className="p-1 rounded hover:bg-red-50 text-[#999] hover:text-red-600"><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-lg p-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111]">{editing ? 'Sửa thuật ngữ' : 'Thêm thuật ngữ'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#888]">Thuật ngữ *</label>
                  <input value={form.term} onChange={e => setForm(f => ({ ...f, term: e.target.value }))} placeholder="VD: HACCP"
                    className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-[11px] text-[#888]">Nhóm</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 bg-white">
                    {TERM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#888]">Tên gọi khác / viết tắt (phân cách bằng dấu phẩy)</label>
                <input value={form.aliasesText} onChange={e => setForm(f => ({ ...f, aliasesText: e.target.value }))} placeholder="VD: 食品衛生, Food Safety"
                  className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[11px] text-[#888]">Định nghĩa ngắn (1 dòng)</label>
                <input value={form.short_def} onChange={e => setForm(f => ({ ...f, short_def: e.target.value }))} placeholder="Câu ngắn gọn giải thích thuật ngữ"
                  className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[11px] text-[#888]">Giải thích chi tiết</label>
                <textarea value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} rows={3} placeholder="Hiểu sâu hơn: liên quan gì tới lao động, chi phí, yêu cầu tuyển dụng…"
                  className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-y" />
              </div>
              <div>
                <label className="text-[11px] text-[#888]">Câu nói mẫu khi gặp khách</label>
                <textarea value={form.example} onChange={e => setForm(f => ({ ...f, example: e.target.value }))} rows={2} placeholder='VD: "Bên em đã cung ứng LĐ cho 3 nhà máy đạt HACCP nên quen quy trình phòng sạch."'
                  className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-y" />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                <input type="checkbox" checked={form.shared} onChange={e => setForm(f => ({ ...f, shared: e.target.checked }))} className="accent-blue-600" />
                <Globe size={12} className="text-slate-500" /> Thuật ngữ dùng chung — hiện ở tất cả các ngành
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu…' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-sm p-5 shadow-xl">
            <div className="text-[14px] font-semibold text-[#111] mb-1.5">Xoá thuật ngữ?</div>
            <div className="text-[12px] text-[#666] leading-relaxed">
              Thuật ngữ <b>{confirmDel.term}</b> sẽ bị xoá vĩnh viễn khỏi từ điển, không khôi phục được.
            </div>
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
