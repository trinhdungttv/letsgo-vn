// Module Tuyển dụng — khung chung: nạp tổng quan (recruit_rpc 'bootstrap'), chọn dự án, chia tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { usePersistedState } from '../../hooks/usePersistedState';
import { errText, loadBootstrap, RecruitError } from '../../lib/recruit/api';
import type { RecruitBootstrap } from '../../lib/recruit/types';
import type { Client } from '../../lib/types';
import { RecruitContext, loadSales, loadZones, useRecruit } from './context';
import type { RecruitCtx, RecruitTab, SaleRef, ZoneRef } from './context';
import { ErrorBanner, PILL_GRAY, PillSelect, SetupNotice, Spinner } from './ui';
import OverviewTab from './OverviewTab';
import PipelineTab from './PipelineTab';
import CandidatesTab from './CandidatesTab';
import PlanTab from './PlanTab';
import BatchesTab from './BatchesTab';
import SettleTab from './SettleTab';
import InsightsTab from './InsightsTab';
import WorkforceTab from './WorkforceTab';

export default function RecruitModule({ tab, onTab, clients, toast }: {
  tab: RecruitTab;
  onTab: (t: RecruitTab) => void;
  clients: Client[];
  toast: (m: string) => void;
}) {
  const [boot, setBoot] = useState<RecruitBootstrap | null>(null);
  const [error, setError] = useState<{ msg: string; missing: boolean } | null>(null);
  const [reloading, setReloading] = useState(false);
  const [projectId, setProjectId] = usePersistedState<string>('lgvn_recruit_project', '');
  const [creating, setCreating] = useState(false);
  const { branches } = useBranchLookup();
  const [zones, setZones] = useState<ZoneRef[]>([]);
  const [sales, setSales] = useState<SaleRef[]>([]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      setBoot(await loadBootstrap());
      setError(null);
    } catch (e) {
      setError({ msg: errText(e), missing: e instanceof RecruitError && e.missingMigration });
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    loadZones().then(setZones, () => {});
    loadSales().then(setSales, () => {});
  }, [reload]);

  const ctx = useMemo<RecruitCtx | null>(() => {
    if (!boot) return null;
    const project = boot.projects.find(p => p.id === projectId)
      ?? boot.projects.find(p => p.status === 'active') ?? boot.projects[0] ?? null;
    return {
      boot, reload, canEdit: boot.me.level === 'full', project,
      setProjectId: (id: string) => { setCreating(false); setProjectId(id); },
      creating: creating || boot.projects.length === 0, setCreating,
      sites: project ? boot.sites.filter(s => s.project_id === project.id) : [],
      positions: project ? boot.positions.filter(p => p.project_id === project.id) : [],
      clients, branches, zones, sales, toast, onTab,
    };
  }, [boot, projectId, setProjectId, creating, reload, clients, branches, zones, sales, toast, onTab]);

  if (error?.missing) return <SetupNotice migration="20261101100000_180_recruit_core.sql" />;
  if (error && !boot) {
    return (
      <div className="max-w-xl mx-auto space-y-3">
        <ErrorBanner>{error.msg}</ErrorBanner>
        <button type="button" onClick={reload} className={PILL_GRAY}><RefreshCw size={14} /> Thử lại</button>
      </div>
    );
  }
  if (!ctx) return <div className="py-16 flex justify-center"><Spinner /></div>;

  return (
    <RecruitContext.Provider value={ctx}>
      {error && <ErrorBanner>{error.msg}</ErrorBanner>}
      <ProjectBar reloading={reloading} />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'candidates' && <CandidatesTab />}
      {tab === 'batches' && <BatchesTab />}
      {tab === 'settle' && <SettleTab />}
      {tab === 'insights' && <InsightsTab />}
      {tab === 'workforce' && <WorkforceTab />}
      {tab === 'plan' && <PlanTab />}
    </RecruitContext.Provider>
  );
}

/** Thanh chọn dự án (mọi tab dùng chung). */
function ProjectBar({ reloading }: { reloading: boolean }) {
  const { boot, project, setProjectId, setCreating, creating, reload, onTab, canEdit } = useRecruit();
  if (!boot.projects.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PillSelect label="Dự án tuyển dụng" value={creating ? '' : project?.id ?? ''} active={!creating} onChange={setProjectId}>
        {creating && <option value="">— Dự án mới —</option>}
        {boot.projects.map(p => (
          <option key={p.id} value={p.id}>{p.name}{p.status === 'paused' ? ' (tạm dừng)' : p.status === 'closed' ? ' (đã đóng)' : ''}</option>
        ))}
      </PillSelect>
      {canEdit && !creating && (
        <button type="button" onClick={() => { setCreating(true); onTab('plan'); }}
          className="inline-flex items-center gap-1 h-9 md:h-8 px-3 rounded-full text-[13px] font-medium text-[#0066CC] hover:bg-[#0071E3]/10 transition">
          <Plus size={14} strokeWidth={2.4} /> Dự án mới
        </button>
      )}
      <button type="button" onClick={reload} title="Tải lại số liệu" aria-label="Tải lại số liệu"
        className="ml-auto w-9 h-9 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.05] hover:text-[#1D1D1F] transition">
        <RefreshCw size={15} className={reloading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
