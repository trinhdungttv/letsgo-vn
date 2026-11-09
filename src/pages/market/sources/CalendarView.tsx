// Lịch thực tập 12 tháng tới — mỗi đơn vị 1 dòng, thanh = mùa SV đi thực tập. Dòng cuối: tổng SV dự kiến theo tháng.
import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Panel, PillSelect, Quiet } from '../../../modules/cskh/components/apple';
import { addDays, daysBetween, occurrencesBetween } from '../../../lib/laborSources/windows';
import { KIND_LABEL, SOURCE_KINDS } from '../../../lib/laborSources/types';
import { useLabor } from './context';
import { KIND_COLOR, fmtDateVN } from './parts';

export default function CalendarView() {
  const L = useLabor();
  const { data, today } = L;
  const [kind, setKind] = useState('all');
  const [industry, setIndustry] = useState('all');

  // Mốc: ngày 1 tháng này → 12 tháng sau
  const from = `${today.slice(0, 7)}-01`;
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const y = +from.slice(0, 4) + Math.floor((+from.slice(5, 7) - 1 + i) / 12);
    const m = ((+from.slice(5, 7) - 1 + i) % 12) + 1;
    return { y, m, start: `${y}-${String(m).padStart(2, '0')}-01` };
  }), [from]);
  const to = addDays(`${months[11].y + (months[11].m === 12 ? 1 : 0)}-${String(months[11].m === 12 ? 1 : months[11].m + 1).padStart(2, '0')}-01`, -1);
  const span = daysBetween(from, to) + 1;
  const pos = (iso: string) => Math.min(1, Math.max(0, daysBetween(from, iso) / span));

  const usedIndustries = useMemo(() => {
    const ids = new Set(data.programs.flatMap(p => p.industry_ids));
    return L.industries.filter(i => ids.has(i.id));
  }, [data.programs, L.industries]);

  const rows = useMemo(() => data.sources.filter(s => {
    if (kind !== 'all' && s.kind !== kind) return false;
    if (industry !== 'all' && !(L.programsBy.get(s.id) ?? []).some(p => p.industry_ids.includes(industry))) return false;
    return true;
  }).map(s => {
    const bars = (L.windowsBy.get(s.id) ?? []).flatMap(w => occurrencesBetween(w, from, to).map(o => ({ w, o })));
    return { s, bars };
  }).filter(r => r.bars.length).sort((a, b) => a.bars.map(x => x.o.start).sort()[0].localeCompare(b.bars.map(x => x.o.start).sort()[0])),
  [data.sources, kind, industry, L.programsBy, L.windowsBy, from, to]);

  // Tổng SV dự kiến theo tháng (mùa chạm tháng nào thì tính vào tháng đó)
  const perMonth = months.map(mo => {
    const mEnd = addDays(mo.m === 12 ? `${mo.y + 1}-01-01` : `${mo.y}-${String(mo.m + 1).padStart(2, '0')}-01`, -1);
    let n = 0;
    for (const r of rows) for (const b of r.bars) if (b.o.start <= mEnd && b.o.end >= mo.start) n += b.w.expected_count ?? 0;
    return n;
  });
  const maxMonth = Math.max(1, ...perMonth);
  const todayPos = pos(today);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0">
        <PillSelect label="Loại" value={kind} active={kind !== 'all'} onChange={setKind}>
          <option value="all">Mọi loại</option>
          {SOURCE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </PillSelect>
        <PillSelect label="Ngành" value={industry} active={industry !== 'all'} onChange={setIndustry} disabled={!usedIndustries.length}>
          <option value="all">Mọi ngành</option>
          {usedIndustries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </PillSelect>
      </div>

      <Panel title="Lịch thực tập 12 tháng tới" icon={<CalendarRange size={16} className="text-[#FF9500]" />} count={rows.length}
        meta="Thanh màu = mùa SV đi thực tập · số trên thanh = SV dự kiến" flush>
        {rows.length === 0 ? (
          <div className="px-4 md:px-5 pb-4"><Quiet>Chưa có lịch thực tập nào — mở hồ sơ trường → "Lịch thực tập" → +.</Quiet></div>
        ) : (
          <div className="overflow-x-auto pb-3">
            <div className="min-w-[760px] px-4 md:px-5">
              {/* Đầu cột tháng */}
              <div className="grid grid-cols-[180px_1fr] items-end">
                <span />
                <div className="grid grid-cols-12 text-[11.5px] font-semibold text-[#86868B] border-b border-[#E5E5EA] pb-1.5">
                  {months.map(mo => <span key={mo.start} className="text-center">T{mo.m}{mo.m === 1 ? <span className="font-normal">/{String(mo.y).slice(2)}</span> : ''}</span>)}
                </div>
              </div>
              {rows.map(({ s, bars }) => (
                <div key={s.id} className="grid grid-cols-[180px_1fr] items-center border-b border-[#F2F2F7] last:border-0">
                  <button type="button" onClick={() => L.openSource(s.id)} className="text-left pr-2 py-2 min-w-0">
                    <span className="block text-[13px] font-medium text-[#1D1D1F] truncate hover:text-[#0066CC]">{s.short_name || s.name}</span>
                    <span className="block text-[11px] text-[#86868B] truncate">{s.province || KIND_LABEL[s.kind]}</span>
                  </button>
                  <div className="relative h-9">
                    {/* lưới tháng */}
                    <div className="absolute inset-0 grid grid-cols-12 pointer-events-none">{months.map(mo => <span key={mo.start} className="border-l border-[#F2F2F7] first:border-l-0" />)}</div>
                    <span className="absolute top-0 bottom-0 w-px bg-[#FF3B30]/60" style={{ left: `${todayPos * 100}%` }} />
                    {bars.map(({ w, o }) => {
                      const left = pos(o.start);
                      const width = Math.max(0.012, pos(o.end) - left + 1 / span);
                      return (
                        <button key={`${w.id}@${o.start}`} type="button" onClick={() => L.openSource(s.id)}
                          title={`${fmtDateVN(o.start)} → ${fmtDateVN(o.end)}${w.cohort ? ` · ${w.cohort}` : ''}${w.expected_count ? ` · ${w.expected_count} SV` : ''}`}
                          className="absolute top-1.5 h-6 rounded-[7px] text-white text-[11px] font-semibold px-1.5 overflow-hidden whitespace-nowrap text-left shadow-[0_1px_2px_rgba(0,0,0,0.15)] hover:brightness-110"
                          style={{ left: `${left * 100}%`, width: `${width * 100}%`, background: KIND_COLOR[s.kind] }}>
                          {w.expected_count ? w.expected_count : ''}{w.cohort ? ` ${w.cohort}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* Tổng SV dự kiến theo tháng */}
              <div className="grid grid-cols-[180px_1fr] items-end pt-3">
                <span className="text-[12px] font-semibold text-[#6E6E73] pb-1">SV dự kiến / tháng</span>
                <div className="grid grid-cols-12 gap-1 items-end h-[64px]">
                  {perMonth.map((n, i) => (
                    <div key={months[i].start} className="flex flex-col items-center justify-end h-full">
                      {n > 0 && <span className="text-[10.5px] tabular-nums text-[#6E6E73] mb-0.5">{n.toLocaleString('vi-VN')}</span>}
                      <span className="w-full max-w-[28px] rounded-t-[4px] bg-[#0071E3]/70" style={{ height: `${(n / maxMonth) * 44}px` }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
