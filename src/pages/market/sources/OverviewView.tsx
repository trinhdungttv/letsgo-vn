// Tổng quan Nguồn LĐ: chỉ số, sắp vào mùa thực tập, nguồn hiệu quả, đợt gần đây, hồ sơ còn thiếu.
import { useMemo } from 'react';
import { AlertCircle, CalendarRange, ChevronRight, Send, Trophy } from 'lucide-react';
import { Panel, Quiet, Row } from '../../../modules/cskh/components/apple';
import { batchStats } from '../../../lib/laborSources/match';
import { addDays, daysBetween, occurrencesBetween } from '../../../lib/laborSources/windows';
import { hasLL } from '../../../lib/laborSources/targets';
import { isSchoolKind, KIND_LABEL, SOURCE_KINDS } from '../../../lib/laborSources/types';
import { useLabor } from './context';
import { Metric, RateBar, SourceAvatar, fmtDateVN } from './parts';

export default function OverviewView({ onGo }: { onGo: (v: 'list' | 'calendar' | 'match') => void }) {
  const L = useLabor();
  const { data, today } = L;
  const byId = useMemo(() => new Map(data.sources.map(s => [s.id, s])), [data.sources]);
  const alive = useMemo(() => data.batches.filter(b => byId.has(b.source_id)), [data.batches, byId]);
  const year = today.slice(0, 4);
  const yearStats = batchStats(alive.filter(b => (b.start_date ?? b.created_at).slice(0, 4) === year));

  // Mùa thực tập trong 90 ngày tới (đang diễn ra cũng hiện)
  const upcoming = useMemo(() => {
    const to = addDays(today, 90);
    const out: { id: string; sourceId: string; start: string; end: string; expected: number | null; cohort: string }[] = [];
    for (const w of data.windows) {
      if (!byId.has(w.source_id)) continue;
      for (const o of occurrencesBetween(w, today, to)) out.push({ id: `${w.id}@${o.start}`, sourceId: w.source_id, start: o.start, end: o.end, expected: w.expected_count, cohort: w.cohort });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }, [data.windows, byId, today]);
  const expectedSoon = upcoming.reduce((s, u) => s + (u.expected ?? 0), 0);

  const ranking = useMemo(() => data.sources.map(s => ({ s, st: batchStats(L.batchesBy.get(s.id) ?? []) }))
    .filter(x => x.st.sent > 0).sort((a, b) => b.st.passed - a.st.passed || (b.st.rate ?? 0) - (a.st.rate ?? 0)).slice(0, 6), [data.sources, L.batchesBy]);

  const byKind = SOURCE_KINDS.map(k => ({ k, n: data.sources.filter(s => s.kind === k).length })).filter(x => x.n > 0);
  const maxKind = Math.max(1, ...byKind.map(x => x.n));

  // Hồ sơ còn thiếu → nhắc bổ sung để ghép / tính đường được
  const gaps = useMemo(() => data.sources.map(s => {
    const miss: string[] = [];
    if (!hasLL(s)) miss.push('vị trí');
    if (isSchoolKind(s.kind) && !(L.programsBy.get(s.id) ?? []).length) miss.push('ngành đào tạo');
    else if (isSchoolKind(s.kind) && (L.programsBy.get(s.id) ?? []).every(p => !p.industry_ids.length)) miss.push('gắn ngành công ty');
    if (isSchoolKind(s.kind) && !(L.windowsBy.get(s.id) ?? []).length) miss.push('lịch thực tập');
    if (!(L.contactsBy.get(s.id) ?? []).length) miss.push('người liên hệ');
    return { s, miss };
  }).filter(x => x.miss.length).sort((a, b) => b.miss.length - a.miss.length), [data.sources, L.programsBy, L.windowsBy, L.contactsBy]);

  const recent = alive.slice(0, 6);

  if (!data.sources.length) {
    return (
      <Panel title="Bắt đầu">
        <Quiet icon={<CalendarRange size={18} />}>Chưa có đơn vị nguồn nào. Bấm "Thêm đơn vị nguồn" để nhập trường đầu tiên — dán link Google Maps để tính đường xe tới KCN.</Quiet>
      </Panel>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <div className="rounded-[18px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-black/[0.06]">
        <Metric label="Đơn vị nguồn" value={data.sources.length} sub={`${data.sources.filter(s => s.status === 'partner').length} đang hợp tác`} />
        <Metric label={`SV gửi đi năm ${year}`} value={yearStats.sent.toLocaleString('vi-VN')} tone="blue" sub={`${yearStats.count} đợt`} />
        <Metric label={`Đạt năm ${year}`} value={yearStats.passed.toLocaleString('vi-VN')} tone="green" sub={yearStats.rate == null ? 'Chưa có đợt' : `Tỷ lệ ${Math.round(yearStats.rate * 100)}%`} />
        <Metric label="Mùa TT trong 90 ngày" value={upcoming.length} tone="orange" sub={expectedSoon ? `~${expectedSoon.toLocaleString('vi-VN')} SV dự kiến` : 'Chưa ghi số dự kiến'} />
      </div>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2 items-start">
        <Panel title="Sắp vào mùa thực tập" icon={<CalendarRange size={16} className="text-[#FF9500]" />} count={upcoming.length}
          action={<button type="button" onClick={() => onGo('calendar')} className="text-[13px] font-medium text-[#0066CC] min-h-[36px] md:min-h-0">Xem lịch</button>}>
          {upcoming.length === 0 ? <Quiet>Không có mùa thực tập nào trong 90 ngày tới.</Quiet> : upcoming.slice(0, 8).map((u, i) => {
            const s = byId.get(u.sourceId)!;
            const started = u.start <= today;
            return (
              <Row key={u.id} first={i === 0} inset={52} onClick={() => L.openSource(s.id)}>
                <SourceAvatar kind={s.kind} logo={s.logo_url} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[#1D1D1F] truncate">{s.short_name || s.name}</p>
                  <p className="text-[12px] text-[#86868B]">{fmtDateVN(u.start)} → {fmtDateVN(u.end)}{u.cohort ? ` · ${u.cohort}` : ''}{u.expected ? ` · ${u.expected} SV` : ''}</p>
                </div>
                <span className={`shrink-0 text-[12px] font-semibold ${started ? 'text-[#248A3D]' : 'text-[#B25000]'}`}>{started ? 'Đang diễn ra' : `Còn ${daysBetween(today, u.start)} ngày`}</span>
              </Row>
            );
          })}
        </Panel>

        <Panel title="Nguồn hiệu quả nhất" icon={<Trophy size={16} className="text-[#FFCC00]" />}
          meta="Theo số SV đạt, mọi thời gian">
          {ranking.length === 0 ? <Quiet>Chưa có đợt gửi SV nào — ghi đợt trong hồ sơ từng trường.</Quiet> : ranking.map(({ s, st }, i) => (
            <Row key={s.id} first={i === 0} inset={52} onClick={() => L.openSource(s.id)}>
              <SourceAvatar kind={s.kind} logo={s.logo_url} size={38} />
              <p className="min-w-0 flex-1 text-[14px] font-medium text-[#1D1D1F] truncate">{s.short_name || s.name}</p>
              <RateBar sent={st.sent} passed={st.passed} />
            </Row>
          ))}
        </Panel>

        <Panel title="Đợt gửi gần đây" icon={<Send size={16} className="text-[#0071E3]" />}>
          {recent.length === 0 ? <Quiet>Chưa có đợt nào.</Quiet> : recent.map((b, i) => {
            const s = byId.get(b.source_id)!;
            return (
              <Row key={b.id} first={i === 0} inset={0} onClick={() => L.openSource(s.id)}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[#1D1D1F] truncate">{s.short_name || s.name} <span className="font-normal text-[#86868B]">→ {b.company_name || '—'}</span></p>
                  <p className="text-[12px] text-[#86868B]">{b.start_date ? fmtDateVN(b.start_date) : 'Chưa ghi ngày'}</p>
                </div>
                <RateBar sent={b.sent_count} passed={b.passed_count} />
              </Row>
            );
          })}
        </Panel>

        <Panel title="Theo loại đơn vị" action={<button type="button" onClick={() => onGo('list')} className="text-[13px] font-medium text-[#0066CC] min-h-[36px] md:min-h-0">Danh sách</button>}>
          <div className="space-y-2 pb-3">
            {byKind.map(({ k, n }) => (
              <div key={k} className="flex items-center gap-3">
                <span className="w-[150px] shrink-0 text-[13px] text-[#1D1D1F] truncate">{KIND_LABEL[k]}</span>
                <span className="flex-1 h-[8px] rounded-full bg-black/[0.05] overflow-hidden"><span className="block h-full rounded-full bg-[#0071E3]" style={{ width: `${(n / maxKind) * 100}%` }} /></span>
                <span className="w-8 text-right text-[13px] tabular-nums text-[#6E6E73]">{n}</span>
              </div>
            ))}
          </div>
        </Panel>

        {gaps.length > 0 && (
          <Panel title="Hồ sơ cần bổ sung" icon={<AlertCircle size={16} className="text-[#FF9500]" />} count={gaps.length}
            meta="Đủ vị trí, ngành, lịch thì gợi ý ghép công ty và tính đường xe mới chính xác">
            {gaps.slice(0, 8).map(({ s, miss }, i) => (
              <Row key={s.id} first={i === 0} inset={52} onClick={() => L.openSource(s.id)}>
                <SourceAvatar kind={s.kind} logo={s.logo_url} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[#1D1D1F] truncate">{s.short_name || s.name}</p>
                  <p className="text-[12px] text-[#B25000] truncate">Thiếu: {miss.join(', ')}</p>
                </div>
                <ChevronRight size={16} className="text-[#C7C7CC]" />
              </Row>
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}
