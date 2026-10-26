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
import {
  CARE_STATUS_COLOR, chipStyle, groupDisplayOf, PILL_TINTED, ROUND_ADD, scoreColor,
} from './ui';
import { useCareScope } from './useCareScope';
import { MigrationBanner, Spinner } from './components/Card';
import { CompanyTag, MoreButton, PageTitle, Panel, Quiet, Row } from './components/apple';
import { CareScopeBar } from './components/CareScopeBar';
import { ContactAvatar } from './components/ContactAvatar';

/** Mỗi khu hiện bấy nhiêu dòng trước, còn lại bấm "Hiện thêm". */
const PAGE = 30;

type Section = 'overdue' | 'due_soon' | 'ok';
const SECTIONS: { key: Section; title: string; meta: string; icon: ReactNode; empty: string }[] = [
  { key: 'overdue', title: 'Quá hạn', meta: 'Đã quá nhịp chăm sóc — liên hệ trước', icon: <AlarmClock size={14} strokeWidth={2.3} />, empty: 'Không ai quá hạn — tốt lắm!' },
  { key: 'due_soon', title: 'Sắp đến hạn', meta: 'Đến hạn trong 3 ngày tới', icon: <Clock size={14} strokeWidth={2.3} />, empty: 'Không ai sắp đến hạn trong 3 ngày tới.' },
  { key: 'ok', title: 'Ổn định', meta: 'Đang trong nhịp, chưa cần liên hệ', icon: <CheckCircle2 size={14} strokeWidth={2.3} />, empty: 'Chưa có ai trong nhịp.' },
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

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[13px] text-[#86868B]">Chưa tải được dữ liệu CSKH.</p>;
  const careTotal = sections.overdue.length + sections.due_soon.length + sections.ok.length;

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle
        eyebrow="Nhắc liên hệ đều đặn"
        title="Nhịp độ Chăm sóc"
        subtitle={<>{careTotal} người đang chăm sóc · {sections.overdue.length} quá hạn · {sections.due_soon.length} sắp đến hạn (≤ 3 ngày)</>}
        actions={(
          <button type="button" onClick={openPicker} className={PILL_TINTED}>
            <UserPlus size={15} strokeWidth={2.2} /> Chọn người chăm sóc
          </button>
        )}
      />

      {!data.migrationReady && <MigrationBanner />}
      <CareScopeBar scope={scope} users={data.users} total={contacts.length} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5 items-start">
        {SECTIONS.map(sec => {
          const rows = sections[sec.key];
          const shown = rows.slice(0, limits[sec.key]);
          return (
            <Panel key={sec.key} title={sec.title} count={rows.length} meta={sec.meta}
              icon={<span className="w-7 h-7 rounded-full flex items-center justify-center" style={chipStyle(CARE_STATUS_COLOR[sec.key])}>{sec.icon}</span>}
              footer={rows.length > shown.length && (
                <MoreButton onClick={() => setLimits({ ...limits, [sec.key]: limits[sec.key] + PAGE })}>
                  Hiện thêm {Math.min(PAGE, rows.length - shown.length)} người (còn {rows.length - shown.length})
                </MoreButton>
              )}>
              {rows.length === 0 ? <Quiet>{sec.empty}</Quiet> : (
                <div>
                  {shown.map(({ contact: c, st }, idx) => {
                    const g = groupDisplayOf(c, groupById);
                    return (
                      <Row key={c.id} first={idx === 0} inset={52}>
                        <button type="button" onClick={() => openProfile(c.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left group">
                          <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={40} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <b className="text-[15px] font-semibold text-[#1D1D1F] truncate group-hover:text-[#0066CC] transition-colors">{c.fullName}</b>
                              <span className="hidden md:inline shrink-0 px-2 py-px rounded-full text-[11px] font-medium" style={chipStyle(g.color)}>{g.label}</span>
                            </span>
                            {/* Điện thoại: nhóm + hạn + điểm xuống 1 dòng riêng (cột phải bị ẩn) */}
                            <span className="md:hidden flex flex-wrap items-center gap-1 mt-0.5">
                              <span className="px-2 py-px rounded-full text-[11px] font-medium" style={chipStyle(g.color)}>{g.label}</span>
                              <span className="px-2 py-px rounded-full text-[11px] font-medium whitespace-nowrap" style={chipStyle(CARE_STATUS_COLOR[sec.key])}>{dueLabel(st)}</span>
                              {st.score && <span className="text-[11px] font-semibold tabular-nums" style={{ color: scoreColor(st.score.total) }}>{st.score.total} điểm</span>}
                            </span>
                            {c.organization && <span className="block mt-0.5"><CompanyTag name={c.organization} /></span>}
                            <span className="block text-[12px] text-[#86868B] truncate">
                              {c.lastInteractionAt ? `Lần cuối ${formatDateVN(c.lastInteractionAt)}` : 'Chưa có tương tác nào'} · {st.cadence} ngày/lần
                            </span>
                          </span>
                        </button>
                        <span className="hidden md:flex shrink-0 flex-col items-end gap-1">
                          <span className="px-2.5 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={chipStyle(CARE_STATUS_COLOR[sec.key])}>{dueLabel(st)}</span>
                          {st.score && <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: scoreColor(st.score.total) }}>{st.score.total} điểm</span>}
                        </span>
                        <button type="button" onClick={() => openLog(c.id)} title="Ghi tương tác" aria-label={`Ghi tương tác với ${c.fullName}`} className={ROUND_ADD}>
                          <Plus size={15} strokeWidth={2.4} />
                        </button>
                      </Row>
                    );
                  })}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
