import { useEffect, useRef, useState } from 'react';
import { Users2, Plus, Trash2, Loader2, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { IndustryPosition } from '../../lib/types';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';

const DIFF = ['—', 'Dễ tuyển', 'Bình thường', 'Hơi khó', 'Khó', 'Rất khó'];
const DIFF_STYLE = ['text-[#bbb]', 'text-emerald-700', 'text-[#666]', 'text-amber-700', 'text-orange-700', 'text-red-700'];
const BAR = ['#1D4ED8', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D'];

interface Props { industryId: string; toast: (m: string) => void; }

type Row = Partial<IndustryPosition> & { _key: string; _wageMinText?: string; _wageMaxText?: string };

export default function IndustryPositions({ industryId, toast }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [confirmDel, setConfirmDel] = useState<Row | null>(null);
  // Chốt lại nội dung ngay sau khi tải/lưu — dùng để so sánh phát hiện thay đổi cần tự lưu.
  const [savedRows, setSavedRows] = useState<Row[]>([]);
  const canonical = (rs: Row[]) => JSON.stringify(rs.map(r => ({
    key: r._key, position: r.position ?? '', ratio_pct: r.ratio_pct ?? null,
    wage_min: r._wageMinText ?? '', wage_max: r._wageMaxText ?? '',
    requirements: r.requirements ?? '', difficulty: r.difficulty ?? null,
  })));

  // Tự động lưu — gõ/click xong 700ms không thao tác gì thêm là tự ghi DB, không cần bấm
  // nút "Lưu" nữa (trước đây nút Lưu riêng của bảng này rất dễ bị quên, gây mất dữ liệu khi F5).
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  useBeforeUnloadWarning(saveStatus === 'pending' || saveStatus === 'saving');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const skipAutosaveRef = useRef(true);

  // Lương vẫn lưu VNĐ trong DB — chỉ đổi đơn vị hiển thị/nhập sang triệu (tr) cho dễ đọc.
  const trVal = (v: number | null | undefined) => v != null ? String(v / 1_000_000) : '';
  const numTr = (v: string) => v.trim() === '' ? null : Math.round(Number(v) * 1_000_000);
  // Giữ nguyên chuỗi đang gõ (kể cả dấu "." ở cuối) thay vì quy đổi qua số rồi hiển thị lại
  // ngay lập tức — nếu không, gõ "6." sẽ bị ép về "6" và không bao giờ gõ tiếp được "6.5".
  const sanitizeDecimal = (v: string) => {
    let s = v.replace(/[^\d.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    return s;
  };

  useEffect(() => {
    skipAutosaveRef.current = true;
    supabase.from('industry_positions').select('*').eq('industry_id', industryId)
      .order('sort_order').order('created_at')
      .then(({ data }) => {
        const loaded = ((data ?? []) as IndustryPosition[]).map(p => (
          { ...p, _key: p.id, _wageMinText: trVal(p.wage_min), _wageMaxText: trVal(p.wage_max) }
        ));
        setRows(loaded);
        setSavedRows(loaded);
        setSaveStatus('idle');
        setTimeout(() => { skipAutosaveRef.current = false; }, 0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industryId]);

  const set = (key: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));

  const num = (v: string) => v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, ''));

  const addRow = () => setRows(prev => [...prev, { _key: 'new-' + Date.now(), position: '', sort_order: prev.length, _wageMinText: '', _wageMaxText: '' }]);

  const persistRows = async () => {
    const base = rowsRef.current.map(r => ({ ...r }));
    const valid = base.filter(r => (r.position ?? '').trim());
    if (valid.length === 0) { setSaveStatus('idle'); return; }
    setSaveStatus('saving');
    for (const [i, r] of valid.entries()) {
      const payload = {
        industry_id: industryId,
        position: (r.position ?? '').trim(),
        ratio_pct: r.ratio_pct ?? null,
        wage_min: numTr(r._wageMinText ?? ''),
        wage_max: numTr(r._wageMaxText ?? ''),
        requirements: (r.requirements ?? '').trim() || null,
        difficulty: r.difficulty ?? null,
        sort_order: i,
      };
      if (r.id) {
        const { error } = await supabase.from('industry_positions').update(payload).eq('id', r.id);
        if (error) { setSaveStatus('idle'); toast('Lỗi: ' + error.message); return; }
      } else {
        const { data, error } = await supabase.from('industry_positions').insert(payload).select().single();
        if (error) { setSaveStatus('idle'); toast('Lỗi: ' + error.message); return; }
        r.id = data.id;
        setRows(prev => prev.map(row => row._key === r._key ? { ...row, id: data.id } : row));
      }
    }
    setSavedRows(base);
    setSaveStatus('saved');
  };

  // Gõ/click xong 700ms không đổi gì thêm là tự lưu.
  useEffect(() => {
    if (skipAutosaveRef.current) return;
    if (canonical(rows) === canonical(savedRows)) return;
    setSaveStatus('pending');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; persistRows(); }, 700);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, savedRows]);

  const handleDelete = async () => {
    if (!confirmDel) return;
    if (confirmDel.id) {
      const { error } = await supabase.from('industry_positions').delete().eq('id', confirmDel.id);
      if (error) { toast('Lỗi: ' + error.message); return; }
    }
    setRows(prev => prev.filter(r => r._key !== confirmDel._key));
    setSavedRows(prev => prev.filter(r => r._key !== confirmDel._key));
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
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 text-[11px] text-[#999]">
            {(saveStatus === 'pending' || saveStatus === 'saving') && <><Loader2 size={12} className="animate-spin" /> Đang lưu…</>}
            {saveStatus === 'saved' && <><Check size={12} className="text-emerald-600" /> Đã lưu</>}
          </div>
          <button onClick={addRow} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] hover:bg-[#F9F9F7]"><Plus size={12} /> Thêm vị trí</button>
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
            <th className="text-left font-medium px-1 py-1.5 w-[11%]">Lương từ (tr)</th>
            <th className="text-left font-medium px-1 py-1.5 w-[11%]">Lương đến (tr)</th>
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
              <td className="px-1 py-1"><input value={r._wageMinText ?? ''} onChange={e => set(r._key, { _wageMinText: sanitizeDecimal(e.target.value) })} placeholder="6.5" className={cell} /></td>
              <td className="px-1 py-1"><input value={r._wageMaxText ?? ''} onChange={e => set(r._key, { _wageMaxText: sanitizeDecimal(e.target.value) })} placeholder="8.5" className={cell} /></td>
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
