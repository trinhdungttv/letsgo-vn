import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AlertCircle, RefreshCw, ClipboardList, Trash2, X, Eye } from 'lucide-react';
import type { Client, CooperationSuspensionRequest, WorkTask, WorkTaskComment } from '../lib/types';
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, DOC_STATUS_STEPS, type DocStatus, type TaskStatus as WTaskStatus } from '../lib/types';
import { daysUntil, formatDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { queueGoogleSync } from '../lib/googleSync';

export type TaskStatus = 'pending' | 'in_progress' | 'done';

interface DashboardTask {
  id: string;
  client_id: string | null;
  client_name: string;
  client_region: string | null;
  description: string;
  status: TaskStatus;
  source_status: string | null;
  created_at: string;
  source_type?: 'contract' | 'pipeline' | 'workspace';
  due_date?: string | null;
  crm_id?: string | null;
  // enriched from work_tasks
  _work_task?: WorkTask;
  _real_id?: string;
}

const DOC_STATUS_BTN: Record<string, string> = {
  chua_soan: 'bg-gray-100 text-gray-600',
  dang_soan: 'bg-blue-100 text-blue-700',
  cho_duyet: 'bg-amber-100 text-amber-700',
  cho_kh_ky: 'bg-violet-100 text-violet-700',
  hoan_tat:  'bg-green-100 text-green-700',
  ngung_hd:  'bg-red-100 text-red-700',
};

interface Props {
  clients: Client[];
  regionFilter?: string | null;
  onSelectClient?: (client: Client) => void;
  onOpenClient?: (id: string) => void;
  onOpenPipelineEntry?: (crmId: string) => void;
  isAdmin?: boolean;
  onClientUpdate?: (client: Client) => void;
  clientToBranch?: Record<string, string>;
}

export default function AlertsTasksPanel({ clients, regionFilter, onSelectClient, onOpenClient, onOpenPipelineEntry, isAdmin, onClientUpdate, clientToBranch }: Props) {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [suspendRequests, setSuspendRequests] = useState<CooperationSuspensionRequest[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<DashboardTask | null>(null);
  const [detailComments, setDetailComments] = useState<WorkTaskComment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rawWorkTasks, setRawWorkTasks] = useState<WorkTask[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<DashboardTask | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const [{ data: contractTasks }, { data: pipelineTasks }, { data: workTasks }] = await Promise.all([
        supabase.from('dashboard_tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_pipeline_tasks').select('*').neq('status', 'done').order('created_at', { ascending: false }),
        supabase.from('work_tasks').select('*').neq('status', 'done').order('due_date', { ascending: true }),
      ]);

      const allWorkTasks = (workTasks || []) as WorkTask[];
      setRawWorkTasks(allWorkTasks);

      // Build map: client_id → work_task (Tái ký HĐ) for merging with contract alerts
      const renewalByClient = new Map<string, WorkTask>();
      for (const wt of allWorkTasks) {
        if (wt.task_type === 'Tái ký HĐ' && wt.client_id) {
          renewalByClient.set(wt.client_id, wt);
        }
      }

      // De-dupe contract tasks by client_id, enrich with work_task if exists
      const seenClientIds = new Set<string>();
      const ct: DashboardTask[] = [];
      for (const t of (contractTasks || []) as any[]) {
        const key = t.client_id || t.id;
        if (seenClientIds.has(key)) continue;
        seenClientIds.add(key);
        const linkedWt = t.client_id ? renewalByClient.get(t.client_id) : undefined;
        ct.push({
          ...t,
          source_type: 'contract' as const,
          status: linkedWt ? (linkedWt.status as TaskStatus) : t.status,
          _work_task: linkedWt,
        });
      }

      const pt: DashboardTask[] = (pipelineTasks || []).map((t: any) => ({
        id: `pt_${t.id}`,
        client_id: null,
        client_name: t.company_name,
        client_region: null,
        description: t.title + (t.description ? ` — ${t.description}` : ''),
        status: t.status as TaskStatus,
        source_status: null,
        created_at: t.created_at,
        source_type: 'pipeline' as const,
        due_date: t.due_date,
        crm_id: t.crm_id,
        _real_id: t.id,
      }));

      // Non-renewal work tasks only (renewal ones are merged into contract column)
      const wt: DashboardTask[] = allWorkTasks
        .filter(t => t.task_type !== 'Tái ký HĐ')
        .map((t) => {
          const relatedClient = t.client_id ? clients.find(c => c.id === t.client_id) : null;
          return {
            id: `wt_${t.id}`,
            client_id: t.client_id,
            client_name: relatedClient?.name || t.title,
            client_region: relatedClient?.region || null,
            description: relatedClient ? t.title : (t.task_type || ''),
            status: t.status as TaskStatus,
            source_status: null,
            created_at: t.created_at,
            source_type: 'workspace' as const,
            due_date: t.due_date,
            _real_id: t.id,
            _work_task: t,
          };
        });

      setTasks([...ct, ...pt, ...wt]);
    } finally {
      setTasksLoading(false);
    }
  }, [clients]);

  // Sync alerts → tasks
  const syncInFlight = useRef(false);
  const syncAlertTasks = useCallback(async (alertClients: Client[]) => {
    if (!alertClients.length || syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      const ids = alertClients.map(c => c.id);
      const { data: existing } = await supabase.from('dashboard_tasks').select('id, client_id, client_name, client_region').in('client_id', ids);
      const existingIds = new Set((existing || []).map((r: any) => r.client_id));

      // Update stale name/region on existing tasks
      for (const row of (existing || []) as any[]) {
        const client = alertClients.find(c => c.id === row.client_id);
        if (!client) continue;
        if (row.client_name !== client.name || row.client_region !== client.region) {
          await supabase.from('dashboard_tasks').update({ client_name: client.name, client_region: client.region }).eq('id', row.id);
        }
      }

      const missing = alertClients.filter(c => !existingIds.has(c.id));
      if (missing.length) {
        const upserts = missing.map(c => {
          const d = daysUntil(c.contract_end);
          let description = 'Hợp đồng sắp hết hạn';
          if (c.status === 'danger') description = 'Hợp đồng khẩn cấp cần xử lý';
          else if (d !== null && d <= 0) description = 'Hợp đồng đã hết hạn';
          else if (d !== null) description = `Hợp đồng sắp hết hạn (còn ${d} ngày)`;
          return { client_id: c.id, client_name: c.name, client_region: c.region, description, source_status: c.status };
        });
        await supabase.from('dashboard_tasks').insert(upserts);
      }
      await loadTasks();
    } finally {
      syncInFlight.current = false;
    }
  }, [loadTasks]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('cooperation_suspension_requests').select('*').eq('status', 'pending').order('created_at', { ascending: true }).then(({ data }) => {
      if (data) setSuspendRequests(data as CooperationSuspensionRequest[]);
    });
  }, [isAdmin]);

  async function reviewSuspendRequest(req: CooperationSuspensionRequest, approve: boolean) {
    setReviewingId(req.id);
    const now = new Date().toISOString();
    const newStatus = approve ? 'approved' : 'rejected';
    await supabase.from('cooperation_suspension_requests').update({ status: newStatus, reviewed_at: now }).eq('id', req.id);
    if (approve) {
      await supabase.from('clients').update({ cooperation_status: 'suspended', suspension_reason: req.reason, suspended_at: now, updated_at: now }).eq('id', req.client_id);
      const client = clients.find(c => c.id === req.client_id);
      if (client && onClientUpdate) onClientUpdate({ ...client, cooperation_status: 'suspended', suspension_reason: req.reason, suspended_at: now });
    }
    setSuspendRequests(prev => prev.filter(r => r.id !== req.id));
    setReviewingId(null);
  }

  const expiringClients = useMemo(() => clients.filter(c => c.cooperation_status !== 'suspended' && (() => { const d = daysUntil(c.contract_end); return d !== null && d <= 30; })()), [clients]);

  const alertAndExpiringClients = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) {
      if (c.cooperation_status === 'suspended') continue;
      if (c.status === 'danger' || c.status === 'warn') map.set(c.id, c);
    }
    for (const c of expiringClients) map.set(c.id, c);
    return [...map.values()];
  }, [clients, expiringClients]);

  useEffect(() => {
    if (alertAndExpiringClients.length && tasks.length >= 0) syncAlertTasks(alertAndExpiringClients);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertAndExpiringClients.length]);

  const confirmDeleteTask = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const task = deleteConfirm;
    if (task.source_type === 'contract') {
      // Xoá dashboard_task alert + xoá work_task liên kết → client quay lại "HĐ cần xử lý" trong Workspace
      await supabase.from('dashboard_tasks').delete().eq('id', task.id);
      if (task._work_task) {
        await supabase.from('work_tasks').delete().eq('id', task._work_task.id);
      }
    } else if (task.id.startsWith('pt_')) {
      // Pipeline task: reset về pending thay vì xoá
      const realId = task._real_id || task.id.replace('pt_', '');
      await supabase.from('crm_pipeline_tasks').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', realId);
    } else if (task.id.startsWith('wt_')) {
      // Work task: reset về pending, xoá doc_status → quay lại "Công việc chưa hoàn thành" trong Workspace
      const realId = task._real_id || task.id.replace('wt_', '');
      await supabase.from('work_tasks').update({ status: 'pending', doc_status: null, updated_at: new Date().toISOString() }).eq('id', realId);
    }
    setTasks(prev => prev.filter(t => t.id !== task.id));
    if (detailTask?.id === task.id) setDetailTask(null);
    setDeleteConfirm(null);
    setDeleting(false);
    queueGoogleSync(token);
  };

  const openDetail = async (task: DashboardTask) => {
    setDetailTask(task);
    setDetailComments([]);
    const workTaskId = task._work_task?.id || (task.id.startsWith('wt_') ? (task._real_id || task.id.replace('wt_', '')) : null);
    if (workTaskId) {
      setDetailLoading(true);
      const { data } = await supabase.from('work_task_comments').select('*').eq('task_id', workTaskId).order('created_at', { ascending: true });
      if (data) setDetailComments(data as WorkTaskComment[]);
      setDetailLoading(false);
    }
  };

  const findClientForTask = useCallback((task: DashboardTask): Client | null => {
    if (task.client_id) return clients.find(c => c.id === task.client_id) || null;
    return clients.find(c => c.name === task.client_name) || null;
  }, [clients]);

  const suspendedClientIds = useMemo(() => new Set(clients.filter(c => c.cooperation_status === 'suspended').map(c => c.id)), [clients]);

  const visibleTasks = useMemo(() => {
    let list = tasks.filter(t => !t.client_id || !suspendedClientIds.has(t.client_id));
    if (regionFilter) list = list.filter(t => t.client_region === regionFilter);
    return list;
  }, [tasks, regionFilter, suspendedClientIds]);

  const contractTasks = useMemo(() => visibleTasks.filter(t => t.source_type === 'contract'), [visibleTasks]);
  const workTasks = useMemo(() => visibleTasks.filter(t => t.source_type !== 'contract'), [visibleTasks]);

  const renderDocStatusBadge = (docStatus: string | null | undefined) => {
    if (!docStatus) return null;
    const step = DOC_STATUS_STEPS.find(s => s.key === docStatus);
    if (!step) return null;
    const cls = DOC_STATUS_BTN[docStatus] ?? 'bg-gray-100 text-gray-600';
    return (
      <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${cls}`}>
        {step.label}
      </span>
    );
  };

  const renderTaskStatusBadge = (status: string) => {
    const label = (TASK_STATUS_LABELS as Record<string, string>)[status] ?? status;
    const cls = (TASK_STATUS_COLORS as Record<string, string>)[status] ?? 'bg-slate-100 text-slate-600 border-slate-300';
    return (
      <span className={`text-[10px] px-2 py-0.5 rounded-md border font-medium ${cls}`}>
        {label}
      </span>
    );
  };

  const renderTask = (task: DashboardTask) => {
    const relatedClient = findClientForTask(task);
    const daysLeft = task.source_type === 'contract' && relatedClient ? daysUntil(relatedClient.contract_end) : null;
    const wt = task._work_task;

    return (
      <div
        key={task.id}
        className="flex items-center gap-2 px-3 py-2 border-b border-[#F0EEE9] hover:bg-[#FAFAF8] cursor-pointer group transition-colors"
        onClick={() => openDetail(task)}
      >
        {task.source_type === 'pipeline' ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 bg-orange-100 text-orange-700">
            <ClipboardList size={10} /> BD
          </span>
        ) : task.source_type === 'workspace' ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 bg-indigo-100 text-indigo-700">
            <ClipboardList size={10} /> WS
          </span>
        ) : daysLeft !== null ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 bg-red-100 text-red-700">
            {daysLeft <= 0 ? 'Hết hạn' : `${daysLeft} ngày`}
          </span>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[12px] truncate text-[#111]">{task.client_name}</div>
          <div className="text-[11px] text-gray-500 truncate">{task.description}</div>
          {task.due_date && (
            <div className={`text-[10.5px] mt-0.5 ${new Date(task.due_date) < new Date() ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              Hạn: {task.due_date}
            </div>
          )}
        </div>
        {task.client_region && (
          <span className="text-[10.5px] text-gray-400 shrink-0">{(task.client_id && clientToBranch?.[task.client_id]) || task.client_region}</span>
        )}
        {/* Status badge (read-only, mirroring Workspace) */}
        <div className="shrink-0">
          {task.source_type === 'contract' && wt?.doc_status
            ? renderDocStatusBadge(wt.doc_status)
            : task.source_type === 'contract' && !wt
            ? <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-gray-100 text-gray-600">Chưa xử lý</span>
            : wt
            ? renderTaskStatusBadge(wt.status)
            : renderTaskStatusBadge(task.status)
          }
        </div>
        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); setDeleteConfirm(task); }}
          title="Xoá"
          className="p-1 rounded hover:bg-red-50 text-transparent group-hover:text-[#ccc] hover:!text-red-500 transition shrink-0"
        >
          <Trash2 size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <AlertCircle size={13} className="text-amber-500" />
          <span className="text-[12.5px] font-semibold text-[#111]">Cảnh báo & Việc cần làm</span>
        </div>
        <button onClick={loadTasks} className="text-gray-400 hover:text-gray-600 transition">
          <RefreshCw size={13} className={tasksLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      {isAdmin && suspendRequests.length > 0 && (
        <div className="border-b border-[#F0EEE9]">
          <div className="px-3 py-1.5 text-[10.5px] font-semibold text-orange-700 uppercase tracking-wide bg-orange-50 border-b border-orange-100 flex items-center gap-1.5">
            🚫 Yêu cầu ngưng hợp tác chờ duyệt
            <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{suspendRequests.length}</span>
          </div>
          <div className="divide-y divide-[#F0EEE9]">
            {suspendRequests.map(req => {
              const client = clients.find(c => c.id === req.client_id);
              return (
                <div key={req.id} className="px-3 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-[#111]">{client?.name ?? req.client_id}</div>
                    <div className="text-[11px] text-[#888] mt-0.5">Người yêu cầu: <span className="text-[#555] font-medium">{req.requester_name}</span></div>
                    <div className="text-[11px] text-[#555] mt-0.5 italic">"{req.reason}"</div>
                    <div className="text-[10.5px] text-[#bbb] mt-0.5">{new Date(req.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <div className="flex gap-1.5 shrink-0 mt-0.5">
                    <button
                      disabled={reviewingId === req.id}
                      onClick={() => reviewSuspendRequest(req, true)}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition"
                    >Duyệt</button>
                    <button
                      disabled={reviewingId === req.id}
                      onClick={() => reviewSuspendRequest(req, false)}
                      className="text-[11px] px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
                    >Từ chối</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#F0EEE9]">
        <div>
          <div className="px-3 py-1.5 text-[10.5px] font-semibold text-[#888] uppercase tracking-wide bg-[#FAFAFA] border-b border-[#F0EEE9]">
            Tái ký hợp đồng
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {contractTasks.length === 0 ? (
              <div className="text-center text-[#aaa] text-[13px] py-4">Không có cảnh báo</div>
            ) : contractTasks.map(renderTask)}
          </div>
        </div>
        <div>
          <div className="px-3 py-1.5 text-[10.5px] font-semibold text-[#888] uppercase tracking-wide bg-[#FAFAFA] border-b border-[#F0EEE9]">
            Việc cần làm (BD &amp; Workspace)
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {workTasks.length === 0 ? (
              <div className="text-center text-[#aaa] text-[13px] py-4">Không có việc cần làm</div>
            ) : workTasks.map(renderTask)}
          </div>
        </div>
      </div>

      {/* Detail popup */}
      {detailTask && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setDetailTask(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2 min-w-0">
                <Eye size={16} className="text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-[14px] font-semibold text-[#111] truncate">{detailTask.client_name}</h2>
                  <p className="text-[11px] text-[#888] mt-0.5 truncate">{detailTask.description}</p>
                </div>
              </div>
              <button onClick={() => setDetailTask(null)} className="p-1.5 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600 transition shrink-0">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1">Trạng thái</div>
                  {detailTask.source_type === 'contract' && detailTask._work_task?.doc_status
                    ? renderDocStatusBadge(detailTask._work_task.doc_status)
                    : detailTask.source_type === 'contract' && !detailTask._work_task
                    ? <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-gray-100 text-gray-600">Chưa xử lý</span>
                    : detailTask._work_task
                    ? renderTaskStatusBadge(detailTask._work_task.status)
                    : renderTaskStatusBadge(detailTask.status)
                  }
                </div>
                {detailTask.client_region && (
                  <div>
                    <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1">Khu vực</div>
                    <span className="text-[12px] text-[#333]">{(detailTask.client_id && clientToBranch?.[detailTask.client_id]) || detailTask.client_region}</span>
                  </div>
                )}
                {detailTask.due_date && (
                  <div>
                    <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1">Hạn</div>
                    <span className={`text-[12px] ${new Date(detailTask.due_date) < new Date() ? 'text-red-500 font-medium' : 'text-[#333]'}`}>
                      {detailTask.due_date}
                    </span>
                  </div>
                )}
                {detailTask._work_task?.priority && (
                  <div>
                    <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1">Ưu tiên</div>
                    <span className="text-[12px] text-[#333]">
                      {detailTask._work_task.priority === 'high' ? 'Cao' : detailTask._work_task.priority === 'medium' ? 'TB' : 'Thấp'}
                    </span>
                  </div>
                )}
                {detailTask.source_type === 'contract' && (() => {
                  const c = findClientForTask(detailTask);
                  const d = c ? daysUntil(c.contract_end) : null;
                  if (d === null) return null;
                  return (
                    <div>
                      <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1">Hạn hợp đồng</div>
                      <span className={`text-[12px] font-medium ${d <= 0 ? 'text-red-600' : d <= 7 ? 'text-red-500' : 'text-amber-600'}`}>
                        {d <= 0 ? `Đã hết hạn ${Math.abs(d)} ngày` : `Còn ${d} ngày`}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Doc status progress for Tái ký HĐ */}
              {detailTask.source_type === 'contract' && detailTask._work_task?.doc_status && (
                <div>
                  <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-2">Tiến trình hồ sơ</div>
                  <div className="flex gap-0.5">
                    {DOC_STATUS_STEPS.filter(s => !s.danger).map((step, i) => {
                      const currentIdx = DOC_STATUS_STEPS.filter(s => !s.danger).findIndex(s => s.key === detailTask._work_task?.doc_status);
                      const isActive = i <= currentIdx;
                      const isCurrent = step.key === detailTask._work_task?.doc_status;
                      return (
                        <div
                          key={step.key}
                          className={`flex-1 text-center py-1.5 text-[9.5px] font-medium rounded-md transition ${
                            isCurrent ? (DOC_STATUS_BTN[step.key] ?? 'bg-gray-100 text-gray-600') + ' ring-1 ring-offset-1 ring-gray-300' :
                            isActive ? 'bg-gray-100 text-gray-500' :
                            'bg-gray-50 text-gray-300'
                          }`}
                        >
                          {step.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Notes */}
              {detailTask._work_task?.notes && (
                <div>
                  <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1">Ghi chú</div>
                  <div className="text-[12px] text-[#333] bg-[#FAFAFA] border border-[#E8E7E2] rounded-lg px-3 py-2 whitespace-pre-wrap">
                    {detailTask._work_task.notes}
                  </div>
                </div>
              )}

              {/* Comments */}
              <div>
                <div className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1.5">
                  Bình luận {detailLoading && <span className="text-[#ccc] normal-case">(đang tải...)</span>}
                </div>
                {detailComments.length === 0 && !detailLoading ? (
                  <div className="text-[11px] text-[#bbb] py-2 text-center border border-dashed border-[#E8E7E2] rounded-lg">Chưa có bình luận</div>
                ) : (
                  <div className="border border-[#E8E7E2] rounded-lg divide-y divide-[#F0EEE9] overflow-hidden">
                    {detailComments.map(cm => (
                      <div key={cm.id} className="px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10.5px] font-semibold text-[#1D4ED8]">{cm.user_name}</span>
                          <span className="text-[10px] text-[#bbb]">
                            {new Date(cm.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-[#333] whitespace-pre-wrap">{cm.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Navigations */}
              <div className="flex gap-2 pt-1">
                {detailTask.source_type === 'pipeline' && detailTask.crm_id && onOpenPipelineEntry && (
                  <button
                    onClick={() => { onOpenPipelineEntry(detailTask.crm_id!); setDetailTask(null); }}
                    className="text-[11px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
                  >Mở Pipeline</button>
                )}
                {detailTask.source_type !== 'pipeline' && (() => {
                  const c = findClientForTask(detailTask);
                  if (!c) return null;
                  return onOpenClient ? (
                    <button
                      onClick={() => { onOpenClient(c.id); setDetailTask(null); }}
                      className="text-[11px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
                    >Xem khách hàng</button>
                  ) : onSelectClient ? (
                    <button
                      onClick={() => { onSelectClient(c); setDetailTask(null); }}
                      className="text-[11px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
                    >Xem khách hàng</button>
                  ) : null;
                })()}
                <button
                  onClick={() => { setDeleteConfirm(detailTask); }}
                  className="text-[11px] px-3 py-1.5 rounded-md border border-amber-200 text-amber-600 font-medium hover:bg-amber-50 transition ml-auto"
                >Gỡ khỏi Dashboard</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => { if (!deleting) setDeleteConfirm(null); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-[14px] font-semibold text-[#111]">Gỡ khỏi Dashboard</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-[12.5px] text-[#333] leading-relaxed">
                Gỡ <strong>"{deleteConfirm.client_name}"</strong> khỏi bảng cảnh báo?
              </p>
              <p className="text-[11px] text-[#888] mt-2 leading-relaxed">
                {deleteConfirm.source_type === 'contract'
                  ? 'Công việc sẽ quay về mục "HĐ cần xử lý" trong Workspace để xử lý lại.'
                  : 'Công việc sẽ được đặt lại trạng thái và hiển thị lại trong Workspace.'
                }
              </p>
            </div>
            <div className="px-5 pb-4 flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 px-3 py-2 text-[12px] font-medium text-[#555] bg-gray-100 hover:bg-gray-200 rounded-lg transition disabled:opacity-50"
              >Huỷ</button>
              <button
                onClick={confirmDeleteTask}
                disabled={deleting}
                className="flex-1 px-3 py-2 text-[12px] font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition disabled:opacity-50"
              >{deleting ? 'Đang xử lý...' : 'Xác nhận'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
