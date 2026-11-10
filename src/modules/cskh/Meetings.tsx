// ============================================================================
// Đi họp (CSKH → tệp Khách hàng, cạnh "Sự kiện & Quà tặng").
// ----------------------------------------------------------------------------
// • Lịch đi họp: họp tại công ty nào (Khách hàng / KH tiềm năng / tên tự do), ngày giờ, địa điểm – cổng, nội dung,
//   thành viên tham dự, người bên khách, trạng thái + kết quả.
// • Thành viên đi họp (Ban điều hành…): họ tên, giới tính, năm sinh, CCCD, ngày cấp, nơi cấp, địa chỉ thường trú,
//   chức vụ, SĐT, biển số xe — nhập tay hoặc từ file Excel danh sách vào cổng cũ.
// • "Danh sách vào cổng" của từng buổi: dựng đúng mẫu công ty, xuất PDF / Excel / In, chèn logo + chữ ký + con dấu.
// • Pháp nhân + chữ ký + con dấu = quote_entities — DÙNG CHUNG với Phương án giá (sửa ở đây hay ở đó đều như nhau).
// Dữ liệu khoá qua meeting_rpc (migration 217) vì có số CCCD; quyền module 'Đi họp' (view = chỉ xem).
// ============================================================================
import { useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Briefcase, CalendarClock, Check, ClipboardList, FileSpreadsheet, Landmark, MapPin, NotebookPen, Pencil, Plus, Users,
} from 'lucide-react';
import { ICON_TILE } from '../../components/workspace/wsTheme';
import EntityManager from '../../components/workspace/costplan/EntityManager';
import { useEntities } from '../../components/workspace/costplan/useEntities';
import { meetingLevel, useAuth } from '../../lib/auth';
import { todayVN } from '../../lib/cskh/dates';
import { diffDays } from '../../lib/cskh/lunar';
import { deleteMeeting, deleteMember, importMembers, MEETING_MIGRATION_HINT, reorderMembers, saveMeeting, saveMember } from '../../lib/meetings/api';
import { buildGateRows, gateIssues, shortWeekday } from '../../lib/meetings/gateList';
import { MEETING_STATUS_LABEL, type Meeting, type MeetingMember } from '../../lib/meetings/types';
import { personInitial } from '../../lib/vnName';
import { useCskh } from './context';
import { CAPTION, PILL_PRIMARY, PILL_TINTED, ROUND_ADD, ROUND_ICON } from './ui';
import { Spinner } from './components/Card';
import { CompanyTag, MoreButton, PageTitle, Panel, Quiet, Row, SearchField, Segmented } from './components/apple';
import { useMeetingsData } from './meetings/useMeetingsData';
import { MemberForm } from './meetings/MemberForm';
import { MemberImportSheet } from './meetings/MemberImportSheet';
import { MeetingForm } from './meetings/MeetingForm';
import { GateListDialog } from './meetings/GateListDialog';
import { foldVn } from '../../lib/companyMatch';

type ListFilter = 'upcoming' | 'past' | 'all';
const PAGE = 20;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function CskhMeetings() {
  const { data: cskh, clients, toast, openLog, openClient } = useCskh();
  const { token, user, rolePermissions } = useAuth();
  const level = user ? meetingLevel(user.role, rolePermissions) : 'none';
  const { data, loading, error, missing, reload } = useMeetingsData();
  const { entities, canSign, reload: reloadEntities, err: entityErr } = useEntities(token);
  const canEdit = level === 'full' && data?.me.level === 'full';
  const today = todayVN();

  const [filter, setFilter] = useState<ListFilter>('upcoming');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [meetingForm, setMeetingForm] = useState<{ existing: Meeting | null } | null>(null);
  const [memberForm, setMemberForm] = useState<{ existing: MeetingMember | null; fromMeeting?: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const [gateFor, setGateFor] = useState<string | null>(null);
  const [entityDlg, setEntityDlg] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  /** Thành viên vừa tạo từ trong form lịch họp → tự thêm vào người tham dự */
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const members = useMemo(() => data?.members ?? [], [data]);
  const live = members.filter(m => !m.deleted_at);
  const activeMembers = live.filter(m => m.active);
  const inactiveMembers = live.filter(m => !m.active);
  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const entityById = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);

  const meetings = useMemo(() => data?.meetings ?? [], [data]);
  const isUpcoming = (m: Meeting) => m.status === 'planned' && m.meet_date >= today;
  const upcomingCount = meetings.filter(isUpcoming).length;
  const list = useMemo(() => {
    const q = foldVn(query.trim());
    const rows = meetings.filter(m => (filter === 'upcoming' ? isUpcoming(m) : filter === 'past' ? !isUpcoming(m) : true))
      .filter(m => !q || foldVn([m.company_name, m.location, m.purpose, m.note, m.result,
        ...m.attendees.map(a => memberById.get(a.id)?.full_name ?? '')].join(' ')).includes(q));
    // Sắp tới: gần nhất trước; đã qua / tất cả: mới nhất trước
    return filter === 'upcoming'
      ? [...rows].sort((a, b) => a.meet_date.localeCompare(b.meet_date) || a.meet_time.localeCompare(b.meet_time))
      : rows;
  }, [meetings, filter, query, memberById, today]); // eslint-disable-line react-hooks/exhaustive-deps

  if (level === 'none') {
    return <p className="py-16 text-center text-[13px] text-[#86868B]">Tài khoản chưa được cấp quyền “Đi họp” — nhờ admin bật ở Ma trận phân quyền.</p>;
  }
  if (loading) return <Spinner />;

  const header = (
    <PageTitle
      eyebrow="Lịch gặp khách hàng"
      title="Đi họp"
      subtitle={data ? <>{upcomingCount} buổi sắp tới · {activeMembers.length} thành viên hay đi họp</> : 'Lịch họp và danh sách đăng ký ra vào cổng'}
      actions={(
        <>
          <button type="button" onClick={() => setEntityDlg(true)} className={PILL_TINTED} title="Pháp nhân, logo, chữ ký, con dấu — dùng chung với Phương án giá">
            <Landmark size={15} strokeWidth={2.2} /> Pháp nhân
          </button>
          {canEdit && (
            <button type="button" onClick={() => setMeetingForm({ existing: null })} className={PILL_PRIMARY}>
              <Plus size={15} strokeWidth={2.4} /> Lịch họp
            </button>
          )}
        </>
      )}
    />
  );

  if (!data) {
    return (
      <div className="space-y-4 md:space-y-5">
        {header}
        <div className="rounded-[18px] bg-[#FFF8E6] px-4 md:px-5 py-4 text-[13px] text-[#8A5A00] leading-relaxed">
          {missing ? (
            <>
              <p className="font-semibold">Tab Đi họp chưa được cài trên cơ sở dữ liệu</p>
              <p className="mt-1">{MEETING_MIGRATION_HINT}</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Chưa tải được dữ liệu Đi họp</p>
              <p className="mt-1">{error}</p>
              <button type="button" onClick={() => void reload()} className="mt-2 font-semibold text-[#0066CC]">Thử lại</button>
            </>
          )}
        </div>
        {entityDlg && <EntityManager entities={entities} canSign={canSign} selectedId={null} onClose={() => setEntityDlg(false)} onChanged={reloadEntities} onSelect={() => undefined} />}
      </div>
    );
  }

  // ── Ghi ──
  const wrap = async (fn: () => Promise<unknown>, ok: string): Promise<string | null> => {
    try { await fn(); } catch (e) { return errMsg(e); }
    await reload();
    toast(ok);
    return null;
  };
  const moveMember = async (m: MeetingMember, d: -1 | 1) => {
    const ids = activeMembers.map(x => x.id);
    const i = ids.indexOf(m.id), j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorderMembers([...ids, ...inactiveMembers.map(x => x.id)]); await reload(); } catch (e) { toast(errMsg(e)); }
  };

  const gateMeeting = gateFor ? meetings.find(m => m.id === gateFor) ?? null : null;

  return (
    <div className="space-y-4 md:space-y-5">
      {header}
      {data.me.level === 'view' && (
        <p className="text-[12.5px] text-[#86868B] bg-black/[0.04] rounded-[12px] px-3.5 py-2.5">Bạn đang ở quyền chỉ xem — xem lịch họp và in danh sách vào cổng, không thêm / sửa được.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4 md:gap-5 items-start">
        {/* ── Lịch họp ── */}
        <Panel title="Lịch họp" count={filter === 'upcoming' ? upcomingCount : undefined}
          icon={<span className={`w-7 h-7 rounded-[8px] ${ICON_TILE.blue} text-white flex items-center justify-center`}><CalendarClock size={15} /></span>}
          meta="Bấm “Danh sách vào cổng” để in / gửi danh sách đăng ký cho bảo vệ nhà máy"
          footer={list.length > limit && <MoreButton onClick={() => setLimit(limit + PAGE)}>Hiện thêm (còn {list.length - limit})</MoreButton>}>
          <div className="flex flex-col sm:flex-row gap-2 pb-2">
            <Segmented label="Lọc lịch họp" keepLabels value={filter} onChange={v => { setFilter(v); setLimit(PAGE); }} options={[
              { key: 'upcoming', label: 'Sắp tới', badge: upcomingCount },
              { key: 'past', label: 'Đã qua' },
              { key: 'all', label: 'Tất cả' },
            ]} />
            <SearchField value={query} onChange={setQuery} placeholder="Tìm công ty, người, nội dung…" className="sm:w-[240px] shrink-0" />
          </div>
          {list.length === 0 ? (
            <Quiet icon={<Briefcase size={18} />}>
              {query ? 'Không có buổi họp khớp ô tìm.' : filter === 'upcoming' ? 'Chưa có lịch họp sắp tới — bấm “Lịch họp” để thêm.' : 'Chưa có buổi họp nào.'}
            </Quiet>
          ) : (
            <div>
              {list.slice(0, limit).map((m, idx) => (
                <MeetingRow key={m.id} m={m} first={idx === 0} today={today}
                  memberById={memberById} entityLabel={m.entity_id ? entityById.get(m.entity_id)?.label ?? '' : ''}
                  contactName={id => cskh?.contacts.find(c => c.id === id)?.fullName ?? ''}
                  canEdit={canEdit}
                  warn={gateIssues(buildGateRows(m, members), { entityMissing: false }).length > 0}
                  onGate={() => setGateFor(m.id)}
                  onEdit={() => setMeetingForm({ existing: m })}
                  onLog={m.contact_ids[0] ? () => openLog(m.contact_ids[0]) : undefined}
                  onClient={m.client_id && clients.some(c => c.id === m.client_id) ? () => openClient(m.client_id as string) : undefined} />
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-4 md:space-y-5 min-w-0">
          {/* ── Thành viên ── */}
          <Panel title="Thành viên đi họp" count={activeMembers.length}
            icon={<span className={`w-7 h-7 rounded-[8px] ${ICON_TILE.indigo} text-white flex items-center justify-center`}><Users size={15} /></span>}
            meta="Ban điều hành hay đi họp — thứ tự ở đây là thứ tự in mặc định"
            action={canEdit && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button type="button" onClick={() => setImporting(true)} className={ROUND_ICON} title="Nhập từ file Excel danh sách vào cổng" aria-label="Nhập từ Excel"><FileSpreadsheet size={15} /></button>
                <button type="button" onClick={() => setMemberForm({ existing: null })} className={ROUND_ADD} title="Thêm thành viên" aria-label="Thêm thành viên"><Plus size={16} strokeWidth={2.4} /></button>
              </div>
            )}
            footer={inactiveMembers.length > 0 && (
              <MoreButton onClick={() => setShowInactive(v => !v)}>{showInactive ? 'Ẩn' : 'Hiện'} người ít đi họp ({inactiveMembers.length})</MoreButton>
            )}>
            {live.length === 0 ? (
              <Quiet icon={<Users size={18} />}>
                Chưa có thành viên.{canEdit && <> Bấm <b>+</b> để thêm, hoặc <button type="button" onClick={() => setImporting(true)} className="font-semibold text-[#0066CC]">nhập từ file Excel</button> danh sách vào cổng cũ.</>}
              </Quiet>
            ) : (
              <div>
                {[...activeMembers, ...(showInactive ? inactiveMembers : [])].map((m, idx) => (
                  <MemberRow key={m.id} m={m} first={idx === 0} canEdit={canEdit}
                    canUp={m.active && idx > 0} canDown={m.active && idx < activeMembers.length - 1}
                    onMove={d => void moveMember(m, d)} onOpen={() => setMemberForm({ existing: m })} />
                ))}
              </div>
            )}
          </Panel>

          {/* ── Pháp nhân (dùng chung Phương án giá) ── */}
          <Panel title="Pháp nhân · chữ ký · con dấu" count={entities.length}
            icon={<span className={`w-7 h-7 rounded-[8px] ${ICON_TILE.orange} text-white flex items-center justify-center`}><Landmark size={15} /></span>}
            meta="Dùng chung với Phương án giá — sửa ở đâu cũng là một"
            action={<button type="button" onClick={() => setEntityDlg(true)} className="text-[13px] font-medium text-[#0066CC] hover:opacity-70 min-h-[36px] md:min-h-0 shrink-0">{canSign ? 'Quản lý' : 'Xem'}</button>}>
            {entityErr ? <p className="text-[12.5px] text-[#B25000] pb-2">{entityErr}</p>
              : entities.length === 0 ? <Quiet icon={<Landmark size={18} />}>Chưa có pháp nhân{canSign ? ' — bấm “Quản lý” để tạo' : ' — nhờ admin tạo'}.</Quiet>
              : (
                <div>
                  {entities.map((e, idx) => (
                    <Row key={e.id} first={idx === 0} inset={0} onClick={() => setEntityDlg(true)}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-[#1D1D1F] truncate">{e.label}</p>
                        <p className={`${CAPTION} truncate`}>{e.data.name || 'Chưa ghi tên công ty'}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {[['Logo', !!e.logo], ['Ký', e.has_signature], ['Dấu', e.has_seal]].map(([l, on]) => (
                          <span key={l as string} className={`inline-flex items-center gap-0.5 px-1.5 h-5 rounded-full text-[10.5px] font-semibold ${on ? 'bg-[#34C759]/15 text-[#248A3D]' : 'bg-black/[0.05] text-[#AEAEB2]'}`}>
                            {on && <Check size={10} strokeWidth={3} />}{l as string}
                          </span>
                        ))}
                      </div>
                    </Row>
                  ))}
                </div>
              )}
          </Panel>
        </div>
      </div>

      {/* Hộp thoại — thứ tự quan trọng: cái mở sau nằm trên (cùng z-index). Key có tiền tố riêng: các hộp là anh em
          cùng mảng con, 2 hộp cùng key "new" (lịch họp + thành viên) làm React nhân đôi form lịch họp. */}
      {meetingForm && (
        <MeetingForm
          key={`meeting:${meetingForm.existing?.id ?? 'new'}`}
          existing={meetingForm.existing}
          members={members}
          entities={entities}
          clients={clients}
          contacts={cskh?.contacts ?? []}
          today={today}
          readOnly={!canEdit}
          addAttendee={justAdded}
          onOpenEntities={() => setEntityDlg(true)}
          onNewMember={() => setMemberForm({ existing: null, fromMeeting: true })}
          onSave={async d => {
            const isNew = !meetingForm.existing;
            const err = await wrap(() => saveMeeting(meetingForm.existing?.id ?? null, d), isNew ? 'Đã thêm lịch họp' : 'Đã lưu lịch họp');
            if (!err) { setMeetingForm(null); setJustAdded(null); }
            return err;
          }}
          onDelete={meetingForm.existing ? async () => {
            const id = meetingForm.existing?.id as string;
            const err = await wrap(() => deleteMeeting(id), 'Đã xoá lịch họp');
            if (!err) setMeetingForm(null);
            return err;
          } : undefined}
          onClose={() => { setMeetingForm(null); setJustAdded(null); }}
        />
      )}
      {gateMeeting && (
        <GateListDialog
          key={`gate:${gateMeeting.id}`}
          meeting={gateMeeting}
          members={members}
          entities={entities}
          canSign={canSign}
          canEdit={canEdit}
          onOpenEntities={() => setEntityDlg(true)}
          onSave={async patch => {
            try { await saveMeeting(gateMeeting.id, patch); } catch (e) { return errMsg(e); }
            void reload();
            return null;
          }}
          onClose={() => setGateFor(null)}
        />
      )}
      {memberForm && (
        <MemberForm
          key={`member:${memberForm.existing?.id ?? 'new'}`}
          existing={memberForm.existing}
          readOnly={!canEdit}
          onSave={async d => {
            const ex = memberForm.existing;
            let createdId: string | null = null;
            const err = await wrap(async () => { createdId = (await saveMember(ex?.id ?? null, d)).id; }, ex ? `Đã lưu ${d.full_name.trim()}` : `Đã thêm ${d.full_name.trim()}`);
            if (!err) {
              if (memberForm.fromMeeting && createdId) setJustAdded(createdId);
              setMemberForm(null);
            }
            return err;
          }}
          onDelete={memberForm.existing ? async () => {
            const ex = memberForm.existing as MeetingMember;
            const err = await wrap(() => deleteMember(ex.id), `Đã xoá ${ex.full_name}`);
            if (!err) setMemberForm(null);
            return err;
          } : undefined}
          onClose={() => setMemberForm(null)}
        />
      )}
      {importing && (
        <MemberImportSheet
          members={members}
          onImport={async rows => {
            try {
              const r = await importMembers(rows);
              await reload();
              toast(`Đã nhập: ${r.inserted} người mới, cập nhật ${r.updated} người`);
              setImporting(false);
              return null;
            } catch (e) { return errMsg(e); }
          }}
          onClose={() => setImporting(false)}
        />
      )}
      {entityDlg && (
        <EntityManager entities={entities} canSign={canSign} selectedId={null}
          onClose={() => setEntityDlg(false)} onChanged={reloadEntities} onSelect={() => undefined} />
      )}
    </div>
  );
}

// ── Dòng lịch họp ─────────────────────────────────────────────────────────────
function MeetingRow({ m, first, today, memberById, entityLabel, contactName, canEdit, warn, onGate, onEdit, onLog, onClient }: {
  m: Meeting;
  first: boolean;
  today: string;
  memberById: Map<string, MeetingMember>;
  entityLabel: string;
  contactName: (id: string) => string;
  canEdit: boolean;
  /** Người tham dự còn thiếu thông tin in danh sách */
  warn: boolean;
  onGate: () => void;
  onEdit: () => void;
  onLog?: () => void;
  onClient?: () => void;
}) {
  const [y, mo, d] = m.meet_date.split('-');
  const days = diffDays(today, m.meet_date);
  const isToday = days === 0;
  const badge = m.status === 'done' ? { t: 'Đã họp', c: 'bg-[#34C759]/15 text-[#248A3D]' }
    : m.status === 'cancelled' ? { t: MEETING_STATUS_LABEL.cancelled, c: 'bg-black/[0.06] text-[#6E6E73]' }
    : isToday ? { t: 'Hôm nay', c: 'bg-[#FF3B30]/12 text-[#D70015]' }
    : days === 1 ? { t: 'Ngày mai', c: 'bg-[#FF9500]/15 text-[#B25000]' }
    : days > 1 ? { t: `Còn ${days} ngày`, c: 'bg-[#0071E3]/10 text-[#0066CC]' }
    : { t: 'Chưa cập nhật kết quả', c: 'bg-[#FF9500]/15 text-[#B25000]' };
  const names = m.attendees.map(a => memberById.get(a.id)?.full_name).filter(Boolean) as string[];
  const contacts = m.contact_ids.map(contactName).filter(Boolean);
  return (
    <Row first={first} inset={60} align="start">
      <div className={`w-12 shrink-0 rounded-[12px] text-center py-1.5 ${isToday && m.status === 'planned' ? 'bg-[#FF3B30] text-white' : 'bg-[#F2F2F7] text-[#1D1D1F]'} ${m.status === 'cancelled' ? 'opacity-50' : ''}`}>
        <div className={`text-[10.5px] font-semibold uppercase ${isToday && m.status === 'planned' ? 'text-white/85' : 'text-[#FF3B30]'}`}>{shortWeekday(m.meet_date)}</div>
        <div className="text-[20px] font-bold leading-none tabular-nums">{d}</div>
        <div className={`text-[10.5px] ${isToday && m.status === 'planned' ? 'text-white/85' : 'text-[#86868B]'}`}>Th{Number(mo)}{y !== today.slice(0, 4) ? `/${y.slice(2)}` : ''}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {m.company_name
            ? (onClient ? <button type="button" onClick={onClient} title="Mở hồ sơ khách hàng"><CompanyTag name={m.company_name} /></button> : <CompanyTag name={m.company_name} />)
            : <span className="text-[13.5px] font-semibold text-[#1D1D1F]">{m.location || 'Buổi họp'}</span>}
          {m.meet_time && <span className="text-[13px] font-semibold tabular-nums text-[#1D1D1F]">{m.meet_time}</span>}
          <span className={`inline-flex px-2 h-5 items-center rounded-full text-[11px] font-semibold ${badge.c}`}>{badge.t}</span>
        </div>
        {m.purpose && <p className={`text-[13px] text-[#1D1D1F] mt-0.5 ${m.status === 'cancelled' ? 'line-through text-[#86868B]' : ''}`}>{m.purpose}</p>}
        {m.location && m.company_name && <p className={`${CAPTION} mt-0.5 flex items-center gap-1`}><MapPin size={11} className="shrink-0" /><span className="truncate">{m.location}</span></p>}
        <p className={`${CAPTION} mt-0.5`}>
          <Users size={11} className="inline -mt-0.5 mr-1" />
          {names.length ? names.join(', ') : <span className="text-[#B25000]">Chưa chọn người tham dự</span>}
          {contacts.length > 0 && <> · gặp {contacts.join(', ')}</>}
          {entityLabel && <> · {entityLabel}</>}
        </p>
        {m.status === 'done' && m.result && <p className="text-[12.5px] text-[#3A3A3C] mt-1 bg-[#F2F2F7] rounded-[8px] px-2.5 py-1.5 whitespace-pre-line line-clamp-3">{m.result}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <button type="button" onClick={onGate} className={`${PILL_TINTED} !h-8 !px-3 !text-[12.5px]`} title="Danh sách đăng ký ra vào cổng — PDF / Excel / In">
            <ClipboardList size={14} /> Danh sách vào cổng{warn && <span className="w-1.5 h-1.5 rounded-full bg-[#FF9500]" aria-label="còn thiếu thông tin" />}
          </button>
          {onLog && m.status === 'done' && (
            <button type="button" onClick={onLog} className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-medium text-[#0066CC] hover:bg-[#0071E3]/10 transition" title="Ghi vào Nhật ký CSKH của người bên khách">
              <NotebookPen size={13} /> Ghi nhật ký
            </button>
          )}
        </div>
      </div>
      <button type="button" onClick={onEdit} className={ROUND_ICON} aria-label={canEdit ? 'Sửa lịch họp' : 'Xem lịch họp'} title={canEdit ? 'Sửa' : 'Xem'}><Pencil size={14} /></button>
    </Row>
  );
}

// ── Dòng thành viên ───────────────────────────────────────────────────────────
function MemberRow({ m, first, canEdit, canUp, canDown, onMove, onOpen }: {
  m: MeetingMember;
  first: boolean;
  canEdit: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (d: -1 | 1) => void;
  onOpen: () => void;
}) {
  const digits = m.id_number.replace(/\D/g, '');
  const missing = [!digits && 'CCCD', !m.id_issued_on && 'ngày cấp', !m.address.trim() && 'địa chỉ'].filter(Boolean) as string[];
  return (
    <div className="group">
      <Row first={first} inset={44}>
        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-semibold shrink-0 ${m.active ? 'bg-[#5856D6]/12 text-[#3634A3]' : 'bg-black/[0.05] text-[#AEAEB2]'}`}>{personInitial(m.full_name)}</span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className={`text-[13.5px] font-semibold truncate ${m.active ? 'text-[#1D1D1F]' : 'text-[#86868B]'}`}>{m.full_name}</p>
          <p className={`${CAPTION} truncate`}>
            {[m.title, m.gender, m.birth, digits ? `CCCD …${digits.slice(-4)}` : ''].filter(Boolean).join(' · ') || 'Chưa có thông tin'}
          </p>
          {missing.length > 0 && <p className="text-[11.5px] text-[#B25000] truncate">Thiếu {missing.join(', ')}</p>}
        </button>
        {canEdit && m.active && (
          <div className="flex shrink-0 md:opacity-0 md:group-hover:opacity-100 transition">
            <button type="button" disabled={!canUp} onClick={() => onMove(-1)} aria-label="Lên" className="w-8 h-8 rounded-full flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.05] disabled:opacity-25"><ArrowUp size={14} /></button>
            <button type="button" disabled={!canDown} onClick={() => onMove(1)} aria-label="Xuống" className="w-8 h-8 rounded-full flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.05] disabled:opacity-25"><ArrowDown size={14} /></button>
          </div>
        )}
      </Row>
    </div>
  );
}
