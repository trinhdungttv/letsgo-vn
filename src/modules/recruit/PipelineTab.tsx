// Tab Ứng tuyển: hồ sơ của dự án chia theo bước, lọc nhà máy / vị trí / tìm tên-SĐT, chuyển bước từng người
// hoặc chọn nhiều (VD điểm danh cả đợt nhận việc).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet, Inbox, UserPlus } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { usePersistedState } from '../../hooks/usePersistedState';
import { errText, listApplications, moveApplications } from '../../lib/recruit/api';
import { formatPhone } from '../../lib/recruit/normalize';
import { ACTION_LABEL, STAGE_CHAIN, STAGE_META, STAGE_TABS, CLOSED_STAGES, tabCount } from '../../lib/recruit/stages';
import type { StageTab } from '../../lib/recruit/stages';
import type { AppListResult, RecruitApplication, RecruitStage } from '../../lib/recruit/types';
import { nameOf, useRecruit } from './context';
import AppActions from './AppActions';
import CandidateSheet, { appDates } from './CandidateSheet';
import ImportSheet from './ImportSheet';
import MoveStageSheet, { needsSheet } from './MoveStageSheet';
import QuickAddSheet from './QuickAddSheet';
import { ErrorBanner, MoreButton, PILL_GRAY, PILL_PRIMARY, PageTitle, PillSelect, Quiet, SearchField, Segmented, Spinner, StageBadge, fmtNum } from './ui';

const PAGE = 100;

export default function PipelineTab() {
  const { project, sites, positions, toast, canEdit, reload } = useRecruit();
  const isMobile = useIsMobile();
  const [tab, setTab] = usePersistedState<StageTab>('lgvn_recruit_stage_tab', 'new');
  const [siteId, setSiteId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<AppListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<RecruitStage | null>(null);
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setSiteId(''); setPositionId(''); setSelected(new Set()); }, [project?.id]);
  useEffect(() => { setLimit(PAGE); setSelected(new Set()); }, [tab, siteId, positionId, qDebounced]);

  const stages = useMemo(() => STAGE_TABS.find(t => t.key === tab)?.stages ?? [], [tab]);
  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      setData(await listApplications({ project_id: project.id, site_id: siteId || null, position_id: positionId || null, stages, q: qDebounced, limit }));
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [project, siteId, positionId, stages, qDebounced, limit]);
  useEffect(() => { load(); }, [load]);

  const changed = useCallback(() => { load(); reload(); }, [load, reload]);

  if (!project) return <Quiet>Chọn hoặc tạo dự án tuyển dụng trước.</Quiet>;

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  const selectedApps = rows.filter(r => selected.has(r.id));
  const toggle = (id: string) => setSelected(cur => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every(r => selected.has(r.id));

  const bulkMove = async (stage: RecruitStage) => {
    if (needsSheet(stage)) { setBulkStage(stage); return; }
    try {
      const r = await moveApplications(selectedApps.map(a => a.id), stage);
      toast(`Đã chuyển ${r.moved} hồ sơ → ${STAGE_META[stage].label}`);
      setSelected(new Set());
      changed();
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle eyebrow="Ứng tuyển" title={project.name}
        subtitle={`${fmtNum(Object.values(counts).reduce((s, n) => s + (n ?? 0), 0))} hồ sơ theo bộ lọc`}
        actions={canEdit ? (<>
          <button type="button" onClick={() => setImporting(true)} className={PILL_GRAY}><FileSpreadsheet size={14} /> Nhập Excel</button>
          <button type="button" onClick={() => setAdding(true)} className={PILL_PRIMARY}><UserPlus size={14} /> Ứng viên</button>
        </>) : undefined} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Tìm tên, SĐT, CCCD…" className="w-full md:w-[260px]" />
        {sites.length > 1 && (
          <PillSelect label="Nhà máy" value={siteId} active={!!siteId} onChange={setSiteId}>
            <option value="">Mọi nhà máy</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </PillSelect>
        )}
        {positions.length > 0 && (
          <PillSelect label="Vị trí" value={positionId} active={!!positionId} onChange={setPositionId}>
            <option value="">Mọi vị trí</option>
            {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </PillSelect>
        )}
      </div>

      <Segmented label="Bước" value={tab} onChange={setTab} fit={isMobile}
        options={STAGE_TABS.map(t => ({ key: t.key, label: t.label, badge: tabCount(t.key, counts) }))} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {canEdit && selectedApps.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[14px] bg-[#1D1D1F] text-white px-3.5 py-2 shadow-lg">
          <span className="text-[13px] font-semibold">Đã chọn {selectedApps.length}</span>
          <select aria-label="Chuyển các hồ sơ đã chọn" value="" onChange={e => { const v = e.target.value as RecruitStage; if (v) bulkMove(v); }}
            className="h-8 rounded-full bg-white/15 text-white text-[12.5px] font-medium px-3 outline-none cursor-pointer [&>option]:text-black [&>optgroup]:text-black">
            <option value="">Chuyển sang…</option>
            <optgroup label="Bước">{STAGE_CHAIN.map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}</optgroup>
            <optgroup label="Đóng hồ sơ">{CLOSED_STAGES.filter(s => s !== 'converted').map(s => <option key={s} value={s}>{ACTION_LABEL[s]}</option>)}</optgroup>
          </select>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[12.5px] text-white/70 hover:text-white">Bỏ chọn</button>
        </div>
      )}

      <div className="bg-white rounded-[18px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.08)] px-3 md:px-4 py-1">
        {loading && !data && <div className="py-10 flex justify-center"><Spinner /></div>}
        {data && rows.length === 0 && (
          <Quiet icon={<Inbox size={18} />}>{qDebounced ? 'Không tìm thấy hồ sơ phù hợp.' : `Chưa có hồ sơ ở bước “${STAGE_TABS.find(t => t.key === tab)?.label}”.`}</Quiet>
        )}
        {rows.length > 0 && canEdit && (
          <label className="flex items-center gap-2 py-2 text-[12px] text-[#86868B] border-b border-[#E5E5EA] cursor-pointer">
            <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(rows.map(r => r.id)))} className="w-4 h-4 accent-[#0071E3]" />
            Chọn tất cả {rows.length} hồ sơ đang hiện
          </label>
        )}
        {rows.map((a, i) => (
          <AppRow key={a.id} app={a} first={i === 0} showStage={tab === 'working' || tab === 'closed'}
            siteName={nameOf(sites, a.site_id)} positionName={positions.find(p => p.id === a.position_id)?.title ?? ''}
            checked={selected.has(a.id)} onToggle={canEdit ? () => toggle(a.id) : undefined}
            onOpen={() => setOpenCandidate(a.candidate_id)} onChanged={changed} />
        ))}
        {data && data.total > rows.length && (
          <MoreButton onClick={() => setLimit(l => l + PAGE)}>Hiện thêm (còn {fmtNum(data.total - rows.length)})</MoreButton>
        )}
      </div>

      {bulkStage && createPortal(
        <MoveStageSheet apps={selectedApps} stage={bulkStage} onClose={() => setBulkStage(null)}
          onDone={n => { setBulkStage(null); setSelected(new Set()); toast(`Đã chuyển ${n} hồ sơ → ${STAGE_META[bulkStage].label}`); changed(); }} />,
        document.body,
      )}
      {openCandidate && <CandidateSheet candidateId={openCandidate} onClose={() => setOpenCandidate(null)} onChanged={load} />}
      {adding && <QuickAddSheet onClose={() => setAdding(false)} onDone={changed} defaultSiteId={siteId || undefined} defaultPositionId={positionId || undefined} />}
      {importing && <ImportSheet onClose={() => setImporting(false)} onDone={changed} />}
    </div>
  );
}

function AppRow({ app: a, first, showStage, siteName, positionName, checked, onToggle, onOpen, onChanged }: {
  app: RecruitApplication;
  first: boolean;
  showStage: boolean;
  siteName: string;
  positionName: string;
  checked: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const c = a.candidate;
  return (
    <div className={`relative flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-1.5 py-2.5 ${first ? '' : 'border-t border-[#E5E5EA]'}`}>
      {onToggle && <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Chọn ${c?.full_name ?? ''}`} className="w-4 h-4 accent-[#0071E3] shrink-0" />}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 basis-[calc(100%-2rem)] md:basis-auto text-left hover:opacity-80">
        <div className="text-[14px] font-medium text-[#1D1D1F] truncate">
          {c?.full_name}
          {c?.blacklisted && <span className="ml-1.5 text-[10.5px] px-1.5 py-0.5 rounded-full bg-[#1D1D1F] text-white align-middle">DS đen</span>}
          <span className="font-normal text-[#86868B]"> · {formatPhone(c?.phone ?? '')}{c?.birth_year ? ` · ${c.birth_year}` : ''}{c?.gender ? ` · ${c.gender === 'male' ? 'Nam' : 'Nữ'}` : ''}</span>
        </div>
        <div className="text-[12px] text-[#86868B] truncate">{[positionName, siteName, appDates(a)].filter(Boolean).join(' · ')}</div>
      </button>
      {/* điện thoại: bước + nút chuyển bước xuống dòng riêng, tên không bị cắt */}
      <div className="w-full md:w-auto flex items-center justify-end gap-2 pl-7 md:pl-0">
        {showStage && <StageBadge stage={a.stage} className="mr-auto md:mr-0" />}
        <AppActions app={a} onChanged={onChanged} />
      </div>
    </div>
  );
}
