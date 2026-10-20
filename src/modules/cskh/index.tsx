// ============================================================================
// Khung module CSKH — được trang CSKH (CRMLeads.tsx) nạp bằng React.lazy.
// ----------------------------------------------------------------------------
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
import { emitCskhDataChanged } from '../../lib/cskh/events';
import type { Client } from '../../lib/types';
import { addGroup, addInteraction, archiveGroup, assignGroups, updateGroup } from './data/api';
import { automationMessage, runCareAutomationOnce } from './automationRunner';
import { useCskhData } from './data/useCskhData';
import { CskhContext, type CskhContextValue, type CskhTabKey } from './context';
import CskhDashboard from './Dashboard';
import CskhMatrix from './Matrix';
import CskhMap from './MapView';
import CskhCadence from './Cadence';
import CskhInteractionLog from './InteractionLog';
import CskhEvents from './Events';
import QuickLogHost from './components/QuickLogHost';
import { CarePickerModal } from './components/CarePickerModal';
import { ContactProfileModal } from './components/ContactProfileModal';
import { GroupManagerModal } from './components/GroupManagerModal';
import { LogInteractionModal } from './components/LogInteractionModal';

export default function CskhModule({ tab, onTab, clients, toast, onOpenWorkspace, onOpenClient }: {
  tab: CskhTabKey;
  onTab: (tab: CskhTabKey) => void;
  clients: Client[];
  toast: (msg: string) => void;
  onOpenWorkspace: () => void;
  onOpenClient: (id: string) => void;
}) {
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const { data, loading } = useCskhData(toast);
  const [profileId, setProfileId] = useState<string | null>(null);
  /** '' = form chưa chọn người; id = chọn sẵn; null = đóng. */
  const [logFor, setLogFor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [managingGroups, setManagingGroups] = useState(false);

  // ── Việc nhắc tự động: 1 lần mỗi phiên, sau khi dữ liệu tải xong (App có thể đã chạy trước) ──
  useEffect(() => {
    if (!data?.migrationReady || !user || !branches.length) return;
    runCareAutomationOnce({ ctx: { user, clients, branches }, today: todayVN(), data })
      .then(r => { const msg = automationMessage(r); if (msg) toast(msg); })
      .catch(e => toast('Lỗi tạo việc nhắc CSKH: ' + (e as Error).message));
  }, [data, user, clients, branches, toast]);

  const openLog = useCallback((contactId?: string) => { setProfileId(null); setLogFor(contactId ?? ''); }, []);
  const openGroups = useCallback(() => { setProfileId(null); setManagingGroups(true); }, []);

  const ctx = useMemo<CskhContextValue>(() => ({
    data,
    loading,
    clients,
    toast,
    openProfile: setProfileId,
    openLog,
    openPicker: () => setPicking(true),
    openGroups,
    goTab: onTab,
    openWorkspace: onOpenWorkspace,
    openClient: onOpenClient,
  }), [data, loading, clients, toast, openLog, openGroups, onTab, onOpenWorkspace, onOpenClient]);

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data?.contacts ?? []) if (c.groupId) m.set(c.groupId, (m.get(c.groupId) ?? 0) + 1);
    return m;
  }, [data]);

  return (
    <CskhContext.Provider value={ctx}>
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
      {data && logFor !== null && (
        <LogInteractionModal
          contacts={data.contacts}
          clients={clients}
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
            toast(input.followUpAction.trim() ? 'Đã ghi nhật ký + tạo việc trong Workspace' : 'Đã ghi nhật ký tương tác');
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
      {data && managingGroups && (
        <GroupManagerModal
          groups={data.groups}
          counts={groupCounts}
          cadence={data.settings.cadence}
          onClose={() => setManagingGroups(false)}
          onAdd={async d => {
            try { await addGroup(d.name, d.color, d.baseTier, user); } catch (e) { return (e as Error).message; }
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
  );
}
