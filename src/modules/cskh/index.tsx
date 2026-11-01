// ============================================================================
// Khung module CSKH — được trang CSKH (CRMLeads.tsx) nạp bằng React.lazy.
// ----------------------------------------------------------------------------
// • Trang có 2 tệp: Khách hàng / Sale – CTV (lib/cskh/space). Mỗi lúc chỉ hiện 1 tệp;
//   dữ liệu các tệp được hiện tải chung 1 lượt nên chuyển tệp là có ngay.
// • Tải dữ liệu MỘT lần cho mọi tab (chuyển tab không tải lại); nơi khác ghi xong
//   thì phát `cskh:data-changed` để tải lại.
// • Giữ các hộp thoại dùng chung: Hồ sơ, Ghi tương tác, Chọn người chăm sóc, Nhóm.
// • Gắn bottom sheet ghi nhận nhanh (gọi/Zalo xong quay lại app).
// • Chạy việc nhắc tự động (chuẩn bị quà, kết nối lại) 1 lần mỗi phiên — App cũng chạy
//   mỗi ngày 1 lần khi mở app (CareAutomationRunner); hai nơi dùng chung automationRunner.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { todayVN } from '../../lib/cskh/dates';
import type { CskhSpace } from '../../lib/cskh/space';
import { buildTodayQueue } from '../../lib/cskh/todayQueue';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import type { Client } from '../../lib/types';
import { addGroup, addInteraction, archiveGroup, assignGroups, logToast, saveGroupLog, setGender, updateGroup } from './data/api';
import { automationMessage, runCareAutomationOnce } from './automationRunner';
import type { CskhData } from './data/api';
import { useCskhSpaces } from './data/useCskhData';
import { useCareScope } from './useCareScope';
import { CskhContext, type CskhContextValue, type CskhTabKey } from './context';
import { SpaceContext } from './space';
import CskhDashboard from './Dashboard';
import CskhMatrix from './Matrix';
import CskhMap from './MapView';
import CskhCadence from './Cadence';
import CskhInteractionLog from './InteractionLog';
import CskhEvents from './Events';
import QuickLogHost from './components/QuickLogHost';
import { SaleMigrationBanner } from './components/Card';
import { CarePickerModal } from './components/CarePickerModal';
import { GroupLogModal } from './components/GroupLogModal';
import { ContactProfileModal } from './components/ContactProfileModal';
import { GroupManagerModal } from './components/GroupManagerModal';
import { LogInteractionModal } from './components/LogInteractionModal';

interface ViewProps {
  tab: CskhTabKey;
  onTab: (tab: CskhTabKey) => void;
  clients: Client[];
  toast: (msg: string) => void;
  onOpenWorkspace: () => void;
  onOpenClient: (id: string) => void;
}

export default function CskhModule({ space = 'client', spaces, onDueCounts, ...view }: ViewProps & {
  /** Tệp đang hiện: 'client' = Khách hàng (mặc định), 'sale' = Sale / CTV — dữ liệu 2 tệp không lẫn. */
  space?: CskhSpace;
  /** Các tệp được hiện trên trang (nạp chung 1 lượt); thiếu = chỉ tệp đang hiện. */
  spaces?: readonly CskhSpace[];
  /** Báo số người cần liên hệ hôm nay của các tệp KHÔNG đang hiện (hiện trên nút chuyển tệp). */
  onDueCounts?: (space: CskhSpace, count: number) => void;
}) {
  const { clients, toast } = view;
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const loadSpaces = spaces?.includes(space) ? spaces : [...(spaces ?? []), space];
  const { data: bySpace, loading } = useCskhSpaces(toast, loadSpaces);
  const data = bySpace?.[space] ?? null;

  // ── Việc nhắc tự động: 1 lần mỗi phiên cho từng tệp, sau khi dữ liệu tải xong (App có thể đã chạy trước) ──
  useEffect(() => {
    if (!bySpace || !user || !branches.length) return;
    for (const d of Object.values(bySpace)) {
      if (!d?.migrationReady || (d.space === 'sale' && !d.saleReady)) continue;
      runCareAutomationOnce({ ctx: { user, clients, branches }, today: todayVN(), data: d })
        .then(r => { const msg = automationMessage(r, d.space); if (msg) toast(msg); })
        .catch(e => toast('Lỗi tạo việc nhắc CSKH: ' + (e as Error).message));
    }
  }, [bySpace, user, clients, branches, toast]);

  return (
    <>
      {/* Đổi tệp = dựng lại toàn bộ hộp thoại / bộ lọc trong tab → không sót trạng thái của tệp kia */}
      <SpaceView key={space} space={space} data={data} loading={loading} {...view} />
      {onDueCounts && bySpace && Object.values(bySpace).map(d => (d && d.space !== space && (
        // key theo cả tệp đang hiện: chuyển tệp là đọc lại bộ lọc vừa dùng ở tệp kia
        <DueCounter key={`${d.space}:${space}`} data={d} clients={clients} onCount={onDueCounts} />
      )))}
    </>
  );
}

/**
 * Đếm người cần liên hệ hôm nay của 1 tệp đang ẩn — cùng cách tính và cùng bộ lọc phạm vi với
 * khối "Hôm nay cần liên hệ" của tệp đó, để con số trên nút chuyển tệp khớp khi bấm sang.
 */
function DueCounter({ data, clients, onCount }: { data: CskhData; clients: Client[]; onCount: (space: CskhSpace, count: number) => void }) {
  const { scoped } = useCareScope(data.contacts, clients, data.space);
  const today = todayVN();
  const count = useMemo(() => buildTodayQueue({
    contacts: scoped,
    interactions: data.interactions.filter(i => !i.isArchived),
    occasions: data.occasions.filter(o => !o.isArchived),
    gifts: data.gifts.filter(g => !g.isArchived),
    cadence: data.settings.cadence,
    today,
  }, Number.MAX_SAFE_INTEGER).items.length, [scoped, data, today]);
  useEffect(() => { onCount(data.space, count); }, [data.space, count, onCount]);
  return null;
}

/** Các tab + hộp thoại dùng chung của 1 tệp. */
function SpaceView({ space, data, loading, tab, onTab, clients, toast, onOpenWorkspace, onOpenClient }: ViewProps & {
  space: CskhSpace;
  data: CskhData | null;
  loading: boolean;
}) {
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [creatingContact, setCreatingContact] = useState(false);
  /** '' = form chưa chọn người; id = chọn sẵn; null = đóng. */
  const [logFor, setLogFor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [managingGroups, setManagingGroups] = useState(false);
  /** null = đóng; mảng = người chọn sẵn (rỗng = tự chọn trong hộp). */
  const [groupLogFor, setGroupLogFor] = useState<readonly string[] | null>(null);

  const openLog = useCallback((contactId?: string) => { setProfileId(null); setLogFor(contactId ?? ''); }, []);
  const openGroups = useCallback(() => { setProfileId(null); setManagingGroups(true); }, []);
  const openGroupLog = useCallback((ids?: readonly string[]) => { setProfileId(null); setGroupLogFor(ids ?? []); }, []);

  const ctx = useMemo<CskhContextValue>(() => ({
    space,
    data,
    loading,
    clients,
    toast,
    openProfile: setProfileId,
    openNewContact: () => setCreatingContact(true),
    openLog,
    openPicker: () => setPicking(true),
    openGroups,
    openGroupLog,
    goTab: onTab,
    openWorkspace: onOpenWorkspace,
    openClient: onOpenClient,
  }), [space, data, loading, clients, toast, openLog, openGroups, openGroupLog, onTab, onOpenWorkspace, onOpenClient]);

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data?.contacts ?? []) if (c.groupId) m.set(c.groupId, (m.get(c.groupId) ?? 0) + 1);
    return m;
  }, [data]);

  return (
    <SpaceContext.Provider value={space}>
    <CskhContext.Provider value={ctx}>
      {/* Mạng lưới Sale cần migration 178 — báo 1 lần ở đầu mọi tab */}
      {space === 'sale' && data && data.migrationReady && !data.saleReady && <SaleMigrationBanner />}
      {tab === 'dashboard' && <CskhDashboard />}
      {tab === 'matrix' && <CskhMatrix />}
      {tab === 'map' && <CskhMap />}
      {tab === 'cadence' && <CskhCadence />}
      {tab === 'log' && <CskhInteractionLog />}
      {tab === 'events' && <CskhEvents />}

      {data && profileId && data.rawContacts.has(profileId) && data.contacts.some(c => c.id === profileId) && (
        <ContactProfileModal
          key={profileId}
          contactId={profileId}
          data={data}
          clients={clients}
          toast={toast}
          onClose={() => setProfileId(null)}
          onLog={openLog}
          onOpenClient={onOpenClient}
          onManageGroups={openGroups}
        />
      )}
      {data && creatingContact && (
        <ContactProfileModal
          contactId={null}
          data={data}
          clients={clients}
          toast={toast}
          onClose={() => setCreatingContact(false)}
          onLog={openLog}
          onManageGroups={openGroups}
        />
      )}
      {data && logFor !== null && (
        <LogInteractionModal
          contacts={data.contacts}
          clients={clients}
          gifts={data.gifts}
          occasions={data.occasions}
          initialContactId={logFor || undefined}
          today={todayVN()}
          onClose={() => setLogFor(null)}
          onSave={async input => {
            try {
              await addInteraction(input, { user, clients, branches });
            } catch (e) {
              return (e as Error).message;
            }
            setLogFor(null);
            emitCskhDataChanged();
            toast(logToast(input));
            return null;
          }}
        />
      )}
      {data && picking && (
        <CarePickerModal
          contacts={data.contacts}
          clients={clients}
          groups={data.groups}
          cadence={data.settings.cadence}
          onClose={() => setPicking(false)}
          onApply={async rows => {
            try {
              await assignGroups(rows, user);
            } catch (e) {
              return (e as Error).message;
            }
            setPicking(false);
            emitCskhDataChanged();
            toast(`Đã đưa ${rows.length} người vào danh sách chăm sóc`);
            return null;
          }}
        />
      )}
      {data && groupLogFor !== null && (
        <GroupLogModal
          contacts={data.contacts}
          groups={data.groups}
          clients={clients}
          today={todayVN()}
          initialSelected={groupLogFor}
          onClose={() => setGroupLogFor(null)}
          onSave={async plan => {
            try {
              const r = await saveGroupLog(plan, data.contacts, { user, clients, branches });
              setGroupLogFor(null);
              emitCskhDataChanged();
              toast(`Đã ghi “${plan.content.trim()}” cho ${r.logs} người${r.gifts ? ` + ${r.gifts} dòng quà` : ''}`
                + (r.noGiftNames.length ? ` · ${r.noGiftNames.length} người chưa gắn công ty nên không ghi quà` : '')
                + ' — nhầm thì sửa cả đợt ở Nhật ký');
              return null;
            } catch (e) {
              return (e as Error).message;
            }
          }}
          onSetGender={async (ids, gender) => {
            try {
              await setGender(ids, gender, user);
            } catch (e) {
              return (e as Error).message;
            }
            emitCskhDataChanged();
            return null;
          }}
        />
      )}
      {data && managingGroups && (
        <GroupManagerModal
          groups={data.groups}
          counts={groupCounts}
          cadence={data.settings.cadence}
          onClose={() => setManagingGroups(false)}
          onAdd={async d => {
            try { await addGroup(d.name, d.color, d.baseTier, user, space); } catch (e) { return (e as Error).message; }
            emitCskhDataChanged();
            toast(`Đã tạo nhóm "${d.name.trim()}"`);
            return null;
          }}
          onUpdate={async (g, d) => {
            try { await updateGroup(g, d, user); } catch (e) { return (e as Error).message; }
            emitCskhDataChanged();
            toast(`Đã lưu nhóm "${d.name.trim()}"`);
            return null;
          }}
          onRemove={async g => {
            try { await archiveGroup(g, user); } catch (e) { return (e as Error).message; }
            emitCskhDataChanged();
            toast(`Đã xoá nhóm "${g.name}"`);
            return null;
          }}
        />
      )}

      <QuickLogHost clients={clients} toast={toast} />
    </CskhContext.Provider>
    </SpaceContext.Provider>
  );
}
