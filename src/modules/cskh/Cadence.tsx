// ============================================================================
// Nhịp độ Chăm sóc (port PRM CadencePage): 3 khu Quá hạn / Sắp đến hạn / Ổn định,
// mỗi khu xếp theo hạn gấp nhất. Mỗi dòng: avatar, tên, chip nhóm, "Tương tác cuối
// dd/mm/yyyy · chu kỳ 30 ngày", chip hạn, nút + ghi tương tác. Chạm tên → hồ sơ.
// ============================================================================
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlarmClock, CheckCircle2, Clock, Plus, UserPlus } from 'lucide-react';
import { buildContactStats, dueLabel, type ContactStats } from '../../lib/cskh/cadence';
import { formatDateVN, todayVN } from '../../lib/cskh/dates';
import type { CskhContact } from '../../lib/cskh/types';
import { useCskh } from './context';
import { CARE_STATUS_COLOR, chipStyle, groupDisplayOf, scoreColor } from './ui';
import { useCareScope } from './useCareScope';
import { Card, Empty, MigrationBanner, Spinner } from './components/Card';
import { CareScopeBar } from './components/CareScopeBar';
import { ContactAvatar } from './components/ContactAvatar';

/** Mỗi khu hiện bấy nhiêu dòng trước, còn lại bấm "Hiện thêm". */
const PAGE = 30;

type Section = 'overdue' | 'due_soon' | 'ok';
const SECTIONS: { key: Section; title: string; icon: ReactNode; empty: string }[] = [
  { key: 'overdue', title: 'Quá hạn', icon: <AlarmClock size={14} />, empty: 'Không ai quá hạn — tốt lắm!' },
  { key: 'due_soon', title: 'Sắp đến hạn', icon: <Clock size={14} />, empty: 'Không ai sắp đến hạn trong 3 ngày tới.' },
  { key: 'ok', title: 'Ổn định', icon: <CheckCircle2 size={14} />, empty: 'Chưa có ai trong nhịp.' },
];

export default function CskhCadence() {
  const { data, loading, clients, openProfile, openLog, openPicker } = useCskh();
  const today = todayVN();
  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const groupById = useMemo(() => new Map((data?.groups ?? []).map(g => [g.id, g])), [data]);
  const scope = useCareScope(contacts, clients);
  const [limits, setLimits] = useState<Record<Section, number>>({ overdue: PAGE, due_soon: PAGE, ok: PAGE });

  const sections = useMemo(() => {
    const out: Record<Section, { contact: CskhContact; st: ContactStats }[]> = { overdue: [], due_soon: [], ok: [] };
    if (!data) return out;
    const stats = buildContactStats(scope.scoped, data.interactions, data.gifts, data.occasions, data.settings.cadence, today);
    for (const c of scope.scoped) {
      const st = stats.get(c.id);
      if (!st || st.status === 'unclassified') continue;
      out[st.status].push({ contact: c, st });
    }
    for (const k of Object.keys(out) as Section[]) {
      out[k].sort((a, b) => (a.st.daysUntilDue ?? 0) - (b.st.daysUntilDue ?? 0) || a.contact.fullName.localeCompare(b.contact.fullName, 'vi'));
    }
    return out;
  }, [data, scope.scoped, today]);

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[12.5px] text-[#999]">Chưa tải được dữ liệu CSKH.</p>;
  const careTotal = sections.overdue.length + sections.due_soon.length + sections.ok.length;

  return (
    <div className="space-y-3 md:space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] md:text-[20px] font-bold text-[#111] leading-tight">Nhịp độ Chăm sóc</h1>
          <p className="text-[12.5px] text-[#666] mt-0.5">
            {careTotal} người đang chăm sóc · {sections.overdue.length} quá hạn · {sections.due_soon.length} sắp đến hạn (≤ 3 ngày)
          </p>
        </div>
        <button type="button" onClick={openPicker}
          className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg border border-gray-300 bg-white text-[12.5px] font-medium text-[#333]">
          <UserPlus size={14} /> Chọn người chăm sóc
        </button>
      </header>

      {!data.migrationReady && <MigrationBanner />}
      <CareScopeBar scope={scope} users={data.users} total={contacts.length} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 md:gap-4 items-start">
        {SECTIONS.map(sec => {
          const rows = sections[sec.key];
          const shown = rows.slice(0, limits[sec.key]);
          return (
            <Card key={sec.key} icon={<span style={{ color: CARE_STATUS_COLOR[sec.key] }}>{sec.icon}</span>} title={sec.title} count={rows.length}
              footer={rows.length > shown.length && (
                <button type="button" onClick={() => setLimits({ ...limits, [sec.key]: limits[sec.key] + PAGE })}
                  className="text-[12px] text-[#1D4ED8] hover:underline min-h-[32px] md:min-h-0">
                  Hiện thêm {Math.min(PAGE, rows.length - shown.length)} người (còn {rows.length - shown.length})
                </button>
              )}>
              {rows.length === 0 ? <Empty>{sec.empty}</Empty> : (
                <div className="divide-y divide-[#F0EFEB]">
                  {shown.map(({ contact: c, st }) => {
                    const g = groupDisplayOf(c, groupById);
                    return (
                      <div key={c.id} className="flex items-center gap-2.5 py-2">
                        <button type="button" onClick={() => openProfile(c.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left group">
                          <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={36} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <b className="text-[13px] text-[#111] truncate group-hover:text-[#1D4ED8]">{c.fullName}</b>
                              <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium" style={chipStyle(g.color)}>{g.label}</span>
                            </span>
                            <span className="block text-[11px] text-[#999] truncate">
                              {c.lastInteractionAt ? `Tương tác cuối ${formatDateVN(c.lastInteractionAt)}` : 'Chưa có tương tác nào'} · chu kỳ {st.cadence} ngày
                              {c.organization ? ` · ${c.organization}` : ''}
                            </span>
                          </span>
                        </button>
                        <span className="shrink-0 flex flex-col items-end gap-0.5">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap" style={chipStyle(CARE_STATUS_COLOR[sec.key])}>{dueLabel(st)}</span>
                          {st.score && <span className="text-[10.5px] font-semibold" style={{ color: scoreColor(st.score.total) }}>{st.score.total} điểm</span>}
                        </span>
                        <button type="button" onClick={() => openLog(c.id)} title="Ghi tương tác" aria-label={`Ghi tương tác với ${c.fullName}`}
                          className="shrink-0 w-10 h-10 md:w-8 md:h-8 rounded-lg border border-[#E8E7E2] bg-white text-[#666] hover:text-[#1D4ED8] hover:border-blue-200 flex items-center justify-center">
                          <Plus size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
