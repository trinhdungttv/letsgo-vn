// Thị trường → Ngành Nghề: khối "Trường đào tạo cho ngành này" — đơn vị nguồn có ngành đào tạo gắn ngành đang xem
// (labor_source_programs.industry_ids). Bấm tên → hồ sơ ở Nguồn LĐ. Chưa chạy migration 213 / chưa có trường nào → ẩn.
import { useEffect, useMemo, useState } from 'react';
import { loadLaborData, LABOR_CHANGED_EVENT, type LaborData } from '../../../lib/laborSources/api';
import { batchStats, monthsLabel } from '../../../lib/laborSources/match';
import { upcomingMonths } from '../../../lib/laborSources/windows';
import { todayVN } from '../../../lib/cskh/dates';
import { requestOpenSource } from './context';

export default function IndustrySchoolsBlock({ industryId, onOpenTab }: { industryId: string; onOpenTab: () => void }) {
  const [data, setData] = useState<LaborData | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => { void loadLaborData().then(d => { if (alive) setData(d); }).catch(() => undefined); };
    run();
    window.addEventListener(LABOR_CHANGED_EVENT, run);
    return () => { alive = false; window.removeEventListener(LABOR_CHANGED_EVENT, run); };
  }, []);

  const rows = useMemo(() => {
    if (!data?.ready) return [];
    const today = todayVN();
    return data.sources.map(s => {
      const progs = data.programs.filter(p => p.source_id === s.id && p.industry_ids.includes(industryId));
      if (!progs.length) return null;
      const st = batchStats(data.batches.filter(b => b.source_id === s.id));
      const months = upcomingMonths(data.windows.filter(w => w.source_id === s.id), today);
      const students = progs.reduce((n, p) => n + (p.students_per_year ?? 0), 0);
      return { s, progs, st, months, students };
    }).filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => (b.s.status === 'partner' ? 1 : 0) - (a.s.status === 'partner' ? 1 : 0) || b.st.passed - a.st.passed);
  }, [data, industryId]);

  if (!rows.length) return null;
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
        <div className="text-[12.5px] font-semibold text-[#111]">🎓 Trường đào tạo cho ngành này <span className="font-normal text-[#999]">{rows.length}</span></div>
        <button onClick={onOpenTab} className="text-[11px] text-blue-600 hover:underline">Mở Nguồn LĐ →</button>
      </div>
      <div className="divide-y divide-[#F0EEE9]">
        {rows.slice(0, 12).map(({ s, progs, st, months, students }) => (
          <button key={s.id} onClick={() => requestOpenSource(s.id)} className="w-full text-left px-4 py-2 hover:bg-[#F9F9F7] flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-[#111] truncate">{s.short_name || s.name} <span className="font-normal text-[#999]">· {s.province || '—'}</span></div>
              <div className="text-[11px] text-[#888] truncate">
                {progs.map(p => p.name).join(', ')}{students ? ` · ~${students} SV/khoá` : ''}{months.length ? ` · thực tập ${monthsLabel(months)}` : ''}
              </div>
            </div>
            {st.sent > 0 && <span className="shrink-0 text-[11px] tabular-nums text-[#666]">đạt {st.passed}/{st.sent}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
