// Thị trường → Đối thủ → hồ sơ: "Trường đối thủ đã làm" — đơn vị nguồn có gắn đối thủ này (labor_sources.competitor_ids,
// migration 214). Cùng 1 công ty có nhiều dòng đối thủ (mỗi KCN 1 dòng) → so theo tên công ty. Không có trường nào → ẩn.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { foldVn } from '../../../lib/companyMatch';
import { requestOpenSource } from './context';

interface Row { id: string; name: string; short_name: string; province: string; competitor_note: string }

export default function CompetitorSchoolsBlock({ companyName }: { companyName: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const key = foldVn(companyName).trim();
      const { data: comps } = await supabase.from('competitors').select('id, company_name');
      const ids = ((comps ?? []) as { id: string; company_name: string | null }[]).filter(c => foldVn(c.company_name ?? '').trim() === key).map(c => c.id);
      if (!ids.length) { if (alive) setRows([]); return; }
      const { data, error } = await supabase.from('labor_sources').select('id, name, short_name, province, competitor_note')
        .overlaps('competitor_ids', ids).is('deleted_at', null).order('name');
      if (alive) setRows(error ? [] : (data ?? []) as Row[]); // chưa chạy 213/214 → ẩn
    })();
    return () => { alive = false; };
  }, [companyName]);

  if (!rows.length) return null;
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">🎓 Trường đối thủ đã làm <span className="font-normal text-[#999]">{rows.length}</span></div>
      <div className="divide-y divide-[#F0EEE9]">
        {rows.map(r => (
          <button key={r.id} onClick={() => requestOpenSource(r.id)} className="w-full text-left px-4 py-2 hover:bg-[#F9F9F7]">
            <div className="text-[12.5px] font-medium text-[#111] truncate">{r.short_name || r.name}{r.province ? <span className="font-normal text-[#999]"> · {r.province}</span> : null}</div>
            {r.competitor_note && <div className="text-[11px] text-[#888] truncate">{r.competitor_note}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
