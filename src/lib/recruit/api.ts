// Gọi module Tuyển dụng — MỌI thao tác đi qua 1 hàm DB recruit_rpc(p_token, p_action, p_args) (migration 180):
// bảng recruit_* khoá với anon key vì chứa SĐT / CCCD; hàm kiểm phiên đăng nhập + quyền module 'Tuyển dụng'.
import { supabase } from '../supabase';
import { getStoredSessionToken } from '../sessionToken';
import type {
  AppListResult, CandidateListRow, CandidateMatch, ImportResult, RecruitApplication, RecruitApplicationFull, RecruitBatch,
  RecruitBootstrap, RecruitCandidate, RecruitEvent, RecruitPosition, RecruitProject, RecruitSettlement, RecruitSite,
  RecruitStage, RecruitTarget, TodayExtra, TodayList, WorkforceSummary,
} from './types';
import type { ImportRow } from './importRows';
import type { FunnelReport } from './funnel';

export class RecruitError extends Error {
  /** true = DB chưa có hàm recruit_rpc (chưa chạy migration 180) */
  readonly missingMigration: boolean;
  constructor(message: string, missingMigration = false) {
    super(message);
    this.missingMigration = missingMigration;
  }
}

/** Lỗi "chưa có hàm" của PostgREST — dùng để hiện hướng dẫn chạy migration thay vì câu lỗi kỹ thuật. */
export function isMissingFunction(err: { code?: string; message?: string } | null | undefined, fn: string): boolean {
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883' || (!!err.message && err.message.includes(fn) && /could not find|does not exist/i.test(err.message));
}

export async function recruitRpc<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc('recruit_rpc', { p_token: getStoredSessionToken(), p_action: action, p_args: args });
  if (error) {
    if (isMissingFunction(error, 'recruit_rpc')) {
      throw new RecruitError('Module Tuyển dụng chưa được cài trên cơ sở dữ liệu (chưa chạy migration 180).', true);
    }
    throw new RecruitError(error.message);
  }
  return data as T;
}

/** Câu lỗi tiếng Việt từ mọi kiểu lỗi. */
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── Đọc ──
export const loadBootstrap = () => recruitRpc<RecruitBootstrap>('bootstrap');

export interface AppListFilter {
  project_id?: string | null;
  site_id?: string | null;
  position_id?: string | null;
  client_id?: string | null;
  employment_type?: 'direct' | 'leasing' | null;
  stages?: readonly RecruitStage[] | null;
  month?: string | null;
  q?: string;
  limit?: number;
  offset?: number;
}
export const listApplications = (f: AppListFilter) => recruitRpc<AppListResult>('app.list', { ...f });

export interface CandidateFilter {
  q?: string;
  education?: string;
  province?: string;
  source_channel?: string;
  blacklisted?: boolean | null;
  free_only?: boolean;
  limit?: number;
  offset?: number;
}
export const listCandidates = (f: CandidateFilter) => recruitRpc<{ total: number; rows: CandidateListRow[] }>('cand.list', { ...f });
export const getCandidate = (id: string) =>
  recruitRpc<{ candidate: RecruitCandidate | null; applications: RecruitApplication[]; events: RecruitEvent[] }>('cand.get', { id });
export const findCandidates = (q: { phone?: string; id_number?: string; exclude_id?: string | null }) =>
  recruitRpc<CandidateMatch[]>('cand.find', q);
export const loadToday = (projectId: string | null, today: string) => recruitRpc<TodayList>('today', { project_id: projectId, today });

// ── Ghi ──
export const saveProject = (p: Partial<RecruitProject>) => recruitRpc<RecruitProject>('project.save', p);
export const deleteProject = (id: string) => recruitRpc<{ ok: boolean }>('project.delete', { id });
export const saveSite = (s: Partial<RecruitSite>) => recruitRpc<RecruitSite>('site.save', s);
export const deleteSite = (id: string) => recruitRpc<{ ok: boolean }>('site.delete', { id });
export const savePosition = (p: Partial<RecruitPosition>) => recruitRpc<RecruitPosition>('position.save', p);
export const deletePosition = (id: string) => recruitRpc<{ ok: boolean }>('position.delete', { id });

export interface TargetCellInput { site_id: string; position_id: string | null; month: string; qty: number; status?: string; note?: string }
export const saveTargets = (projectId: string, cells: TargetCellInput[]) =>
  recruitRpc<RecruitTarget[]>('targets.save', { project_id: projectId, cells });

/** Trùng SĐT/CCCD → `{ duplicate }` (KHÔNG ghi); ngược lại `{ candidate }`. */
export const saveCandidate = (c: Partial<RecruitCandidate>) =>
  recruitRpc<{ candidate?: RecruitCandidate; duplicate?: CandidateMatch }>('cand.save', c);
export const deleteCandidate = (id: string) => recruitRpc<{ ok: boolean }>('cand.delete', { id });

export interface NewApplication {
  candidate_id: string;
  project_id?: string | null;
  client_id?: string | null;
  site_id?: string | null;
  position_id?: string | null;
  employment_type?: 'direct' | 'leasing';
  stage?: RecruitStage;
  source_channel?: string;
  interview_at?: string | null;
  planned_start?: string | null;
  start_date?: string | null;
  replaces_id?: string | null;
  /** HĐ thời vụ đến ngày (migration 183) */
  contract_end?: string | null;
  note?: string;
}
export const createApplication = (a: NewApplication) => recruitRpc<RecruitApplication>('app.create', { ...a });
export const updateApplication = (id: string, fields: Partial<RecruitApplication> & { note_event?: string }) =>
  recruitRpc<RecruitApplication>('app.update', { ...fields, id });
export const deleteApplication = (id: string) => recruitRpc<{ ok: boolean }>('app.delete', { id });

export interface MoveArgs {
  interview_at?: string | null;
  planned_start?: string | null;
  start_date?: string | null;
  fee_date?: string | null;
  left_date?: string | null;
  reason?: string;
  note?: string;
  employee_code?: string;
}
export const moveApplications = (ids: string[], stage: RecruitStage, args: MoveArgs = {}) =>
  recruitRpc<{ moved: number }>('app.move', { ...args, ids, stage });

export interface ImportDefaults {
  project_id?: string | null;
  client_id?: string | null;
  site_id?: string | null;
  position_id?: string | null;
  employment_type?: 'direct' | 'leasing';
  stage?: RecruitStage;
  source_channel?: string;
}
export const importCandidates = (rows: ImportRow[], defaults: ImportDefaults) => recruitRpc<ImportResult>('import', { rows, defaults });

// ── GĐ2 (migration 181): đợt nhận việc, phí / bảo hành, đối soát, CTV, link ứng tuyển ──
export const loadTodayExtra = (projectId: string | null, today: string) => recruitRpc<TodayExtra>('today.get', { project_id: projectId, today });

export const listBatches = (projectId: string, from?: string) => recruitRpc<RecruitBatch[]>('batch.list', { project_id: projectId, from: from ?? '' });
export const getBatch = (id: string) => recruitRpc<{ batch: RecruitBatch | null; rows: RecruitApplicationFull[] }>('batch.get', { id });
export const saveBatch = (b: Partial<RecruitBatch>) => recruitRpc<RecruitBatch>('batch.save', b);
export const deleteBatch = (id: string) => recruitRpc<{ ok: boolean }>('batch.delete', { id });
export const assignBatch = (batchId: string, ids: string[]) => recruitRpc<{ assigned: number }>('batch.assign', { batch_id: batchId, ids });
export const unassignBatch = (ids: string[]) => recruitRpc<{ ok: boolean }>('batch.unassign', { ids });

export const previewSettlement = (projectId: string, period: string) => recruitRpc<RecruitApplicationFull[]>('settle.preview', { project_id: projectId, period });
export const setFeeAmount = (applicationId: string, amount: number | null) => recruitRpc<{ ok: boolean }>('settle.set_amount', { id: applicationId, amount });
export const createSettlement = (projectId: string, clientId: string | null, period: string, ids: string[], note = '') =>
  recruitRpc<RecruitSettlement>('settle.create', { project_id: projectId, client_id: clientId, period, ids, note });
export const listSettlements = (projectId: string) => recruitRpc<RecruitSettlement[]>('settle.list', { project_id: projectId });
export const getSettlement = (id: string) => recruitRpc<{ settlement: RecruitSettlement | null; rows: RecruitApplicationFull[] }>('settle.get', { id });
export const updateSettlement = (id: string, fields: Partial<Pick<RecruitSettlement, 'status' | 'note' | 'pnl_id' | 'pnl_line_id'>>) =>
  recruitRpc<RecruitSettlement>('settle.update', { ...fields, id });
export const deleteSettlement = (id: string) => recruitRpc<{ ok: boolean }>('settle.delete', { id });

export const listCtv = (projectId: string | null, unpaidOnly = false) => recruitRpc<RecruitApplicationFull[]>('ctv.list', { project_id: projectId, unpaid_only: unpaidOnly });
export const payCtv = (ids: string[], paid = true) => recruitRpc<{ updated: number }>('ctv.pay', { ids, paid });

export const shareProject = (id: string, open: boolean) => recruitRpc<RecruitProject>('project.share', { id, open });

// ── GĐ3 (migration 182): phễu & dự báo, nguồn theo xã, chi phí kênh, báo cáo tuần ──
/** Thao tác của giai đoạn chưa chạy migration → câu "Thao tác không hỗ trợ". */
export const isUnsupported = (e: unknown): boolean => errText(e).includes('Thao tác không hỗ trợ');

export const loadFunnel = (projectId: string) => recruitRpc<FunnelReport>('report.funnel', { project_id: projectId });

export interface GeoRow { province: string; commune: string; lat: number | null; lng: number | null; total: number; started: number; early_left: number }
export const loadGeo = (projectId: string) => recruitRpc<GeoRow[]>('report.geo', { project_id: projectId });

export const loadWeekly = (projectId: string, from: string, to: string) =>
  recruitRpc<{ started: RecruitApplicationFull[]; left: RecruitApplicationFull[] }>('report.weekly', { project_id: projectId, from, to });

export interface ChannelCost { id: string; project_id: string; month: string; channel: string; amount: number; note: string }
export const listCosts = (projectId: string) => recruitRpc<ChannelCost[]>('cost.list', { project_id: projectId });
export const saveCost = (c: { project_id: string; month: string; channel: string; amount: number; note?: string }) => recruitRpc<ChannelCost>('cost.save', c);
export const deleteCost = (id: string) => recruitRpc<{ ok: boolean }>('cost.delete', { id });

// ── GĐ4 (migration 183): lao động thời vụ theo từng người ──
export const listWorkforce = (clientId: string | null, over10 = false) =>
  recruitRpc<RecruitApplicationFull[]>('workforce.list', { client_id: clientId, over10 });
export const loadWorkforceSummary = () => recruitRpc<WorkforceSummary[]>('report.workforce', {});
export const convertWorkforce = (ids: string[], date: string, feeAmount: number | null, projectId: string | null, note = '') =>
  recruitRpc<{ converted: number }>('workforce.convert', { ids, date, fee_amount: feeAmount, project_id: projectId, note });
