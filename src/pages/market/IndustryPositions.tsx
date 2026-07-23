import { useEffect, useState } from 'react';
import { Users2, Plus, Trash2, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { IndustryPosition } from '../../lib/types';

const DIFF = ['—', 'Dễ tuyển', 'Bình thường', 'Hơi khó', 'Khó', 'Rất khó'];
const DIFF_STYLE = ['text-[#bbb]', 'text-emerald-700', 'text-[#666]', 'text-amber-700', 'text-orange-700', 'text-red-700'];
const BAR = ['#1D4ED8', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D'];

interface Props { industryId: string; toast: (m: string) => void; }

type Row = Partial<IndustryPosition> & { _key: string };

export default function IndustryPositions({ industryId, toast }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Row | null>(null);

  useEffect(() => {
    supabase.from('industry_positions').select('*').eq('industry_id', industryId)
      .order('sort_order').order('created_at')
      .then(({ data }) => setRows(((data ?? []) as IndustryPosition[]).map(p => ({ ...p, _key: p.id }))));
  }, [industryId]);

  const set = (key: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));

  const num = (v: string) => v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, ''));

  const addRow = () => setRows(prev => [...prev, { _key: 'new-' + Date.now(), position: '', sort_order: prev.length }]);

  const handleSave = async () => {
    const valid = rows.filter(r => (r.position ?? '').trim());
    setSaving(true);
    for (const [i, r] of valid.entries()) {
      const payload = {
        industry_id: industryId,
        position: (r.position ?? '').trim(),
        ratio_pct: r.ratio_pct ?? null,
        wage_min: r.wage_min ?? null,
        wage_max: r.wage_max ?? null,
        requirements: (r.requirements ?? '').trim() || null,
        difficulty: r.difficulty ?? null,
        sort_order: i,
      };
      const { error } = r.id
        ? await supabase.from('industry_positions').update(payload).eq('id', r.id)
        : await supabase.from('industry_positions').insert(payload);
      if (error) { setSaving(false); toast('Lỗi: ' + error.message); return; }
    }
    setSaving(false);
    toast('Đã lưu bản đồ vị trí');
    const { data } = await supabase.from('industry_positions').select('*').eq('industry_id', industryId)
      .order('sort_order').order('created_at');
    setRows(((data ?? []) as IndustryPosition[]).map(p => ({ ...p, _key: p.id })));
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    if (confirmDel.id) {
      const { error } = await supabase.from('industry_positions').delete().eq('id', confirmDel.id);
      if (error) { toast('Lỗi: ' + error.message); return; }
    }
    setRows(prev => prev.filter(r => r._key !== confirmDel._key));
    setConfirmDel(null);
    toast('Đã xoá vị trí');
  };

  const totalRatio = rows.reduce((s, r) => s + (r.ratio_pct ?? 0), 0);
  const cell = 'w-full text-[12px] px-1.5 py-1 rounded border border-transparent hover:border-[#E8E7E2] focus:border-blue-500 outline-none bg-transparent';

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
        <Users2 size={13} className="text-indigo-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Bản đồ vị trí & lương trong ngành</div>
        <span className="text-[10.5px] text-[#999]">cơ cấu quân số một nhà máy điển hình</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={addRow} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] hover:bg-[#F9F9F7]"><Plus size={12} /> Thêm vị trí</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60"><Save size={12} /> {saving ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>

      {rows.some(r => r.ratio_pct) && (
        <div className="px-4 pt-3">
          <div className="flex h-4 rounded overflow-hidden bg-[#F4F3EF]">
            {rows.filter(r => r.ratio_pct).map((r, i) => (
              <div key={r._key} title={`${r.position}: ${r.ratio_pct}%`}
                style={{ width: `${r.ratio_pct}%`, background: BAR[i % BAR.length] }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10.5px] text-[#666]">
            {rows.filter(r => r.ratio_pct).map((r, i) => (
              <span key={r._key} className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: BAR[i % BAR.length] }} />{r.position} {r.ratio_pct}%
              </span>
            ))}
            {totalRatio !== 100 && <span className="text-amber-700">Tổng {totalRatio}% — {totalRatio > 100 ? 'vượt' : 'thiếu'} {Math.abs(100 - totalRatio)}%</span>}
          </div>
        </div>
      )}

      <table className="w-full text-[12px] mt-2">
        <thead>
          <tr className="text-[10.5px] text-[#888] bg-[#FBFBF9]">
            <th className="text-left font-medium px-3 py-1.5 w-[20%]">Vị trí</th>
            <th className="text-left font-medium px-1 py-1.5 w-[8%]">Tỷ lệ %</th>
            <th className="text-left font-medium px-1 py-1.5 w-[11%]">Lương từ</th>
            <th className="text-left font-medium px-1 py-1.5 w-[11%]">Lương đến</th>
            <th className="text-left font-medium px-1 py-1.5 w-[13%]">Độ khó tuyển</th>
            <th className="text-left font-medium px-1 py-1.5">Yêu cầu đặc thù</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EEE9]">
          {rows.map(r => (
            <tr key={r._key} className="hover:bg-[#FBFBF9]">
              <td className="px-3 py-1"><input value={r.position ?? ''} onChange={e => set(r._key, { position: e.target.value })} placeholder="VD: Công nhân đóng gói" className={cell + ' font-medium'} /></td>
              <td className="px-1 py-1"><input value={r.ratio_pct ?? ''} onChange={e => set(r._key, { ratio_pct: num(e.target.value) })} placeholder="—" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.wage_min ?? ''} onChange={e => set(r._key, { wage_min: num(e.target.value) })} placeholder="6500000" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.wage_max ?? ''} onChange={e => set(r._key, { wage_max: num(e.target.value) })} placeholder="8500000" className={cell} /></td>
              <td className="px-1 py-1">
                <select value={r.difficulty ?? 0} onChange={e => set(r._key, { difficulty: Number(e.target.value) || null })}
                  className={`${cell} ${DIFF_STYLE[r.difficulty ?? 0]} cursor-pointer`}>
                  {DIFF.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </td>
              <td className="px-1 py-1"><input value={r.requirements ?? ''} onChange={e => set(r._key, { requirements: e.target.value })} placeholder="Nữ 18–35, thị lực tốt, không dị ứng lạnh…" className={cell} /></td>
              <td className="px-1"><button onClick={() => setConfirmDel(r)} className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-600"><Trash2 size={12} /></button></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="text-center py-6 text-[12px] text-[#aaa]">Chưa có vị trí nào. Bấm "Thêm vị trí" để dựng cơ cấu quân số ngành này.</td></tr>
          )}
        </tbody>
      </table>

      {confirmDel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-sm p-5 shadow-xl">
            <div className="text-[14px] font-semibold text-[#111] mb-1.5">Xoá vị trí?</div>
            <div className="text-[12px] text-[#666] leading-relaxed">Vị trí <b>{confirmDel.position || '(chưa đặt tên)'}</b> sẽ bị xoá vĩnh viễn, không khôi phục được.</div>
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
