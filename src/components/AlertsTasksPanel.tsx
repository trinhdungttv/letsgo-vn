import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AlertCircle, RefreshCw, ClipboardList, CheckCircle2, Clock, Circle } from 'lucide-react';
import type { Client, CooperationSuspensionRequest } from '../lib/types';
import { daysUntil } from '../lib/format';
import { supabase } from '../lib/supabase';

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
}

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; icon: React.ReactNode; cls: string; bg: string }> = {
  pending:     { label: 'Cần làm',    icon: <Circle size={13} />,       cls: 'text-slate-600',   bg: 'bg-slate-100'   },
  in_progress: { label: 'Đang làm',   icon: <Clock size={13} />,        cls: 'text-blue-600',    bg: 'bg-blue-100'    },
  done:        { label: 'Hoàn thành', icon: <CheckCircle2 size={13} />, cls: 'text-emerald-600', bg: 'bg-emerald-100' },
};

interface Props {
  clients: Client[];
  regionFilter?: string | null;
  onSelectClient?: (client: Client) => void;
  onOpenClient?: (id: string) => void;
  onOpenPipelineEntry?: (crmId: string) => void;
  isAdmin?: boolean;
  onClientUpdate?: (client: Client) => void;
}

export default function AlertsTasksPanel({ clients, regionFilter, onSelectClient, onOpenClient, onOpenPipelineEntry, isAdmin, onClientUpdate }: Props) {
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; title: string } | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [suspendRequests, setSuspendRequests] = useState<CooperationSuspensionRequest[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const [{ data: contractTasks }, { data: pipelineTasks }, { data: workTasks }] = await Promise.all([
        supabase.from('dashboard_tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_pipeline_tasks').select('*').neq('status', 'done').order('created_at', { ascending: false }),
        supabase.from('work_tasks').select('*').neq('status', 'done').order('due_date', { ascending: true }),
      ]);

      // De-dupe contract tasks by client_id (keep most recent, list is ordered by created_at desc)
      const seenClientIds = new Set<string>();
      const ct: DashboardTask[] = [];
      for (const t of (contractTasks || []) as any[]) {
        const key = t.client_id || t.id;
        if (seenClientIds.has(key)) continue;
        seenClientIds.add(key);
        ct.push({ ...t, source_type: 'contract' as const });
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
      } as any));
      const wt: DashboardTask[] = (workTasks || []).map((t: any) => {
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
        } as any;
      });

      setTasks([...ct, ...pt, ...wt]);
    } finally {
      setTasksLoading(false);
    }
  }, [clients]);

  // Sync alerts → tasks (insert missing ones; guarded against concurrent runs to avoid duplicates)
  const syncInFlight = useRef(false);
  const syncAlertTasks = useCallback(async (alertClients: Client[]) => {
    if (!alertClients.length || syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      const ids = alertClients.map(c => c.id);
      const { data: existing } = await supabase.from('dashboard_tasks').select('client_id').in('client_id', ids);
      const existingIds = new Set((existing || []).map((r: any) => r.client_id));
      const missing = alertClients.filter(c => !existingIds.has(c.id));
      if (!missing.length) return;
      const upserts = missing.map(c => {
        const d = daysUntil(c.contract_end);
        let description = 'Hợp đồng sắp hết hạn';
        if (c.status === 'danger') description = 'Hợp đồng khẩn cấp cần xử lý';
        else if (d !== null && d <= 0) description = 'Hợp đồng đã hết hạn';
        else if (d !== null) description = `Hợp đồng sắp hết hạn (còn ${d} ngày)`;
        return {
          client_id: c.id,
          client_name: c.name,
          client_region: c.region,
          description,
          source_status: c.status,
        };
      });
      await supabase.from('dashboard_tasks').insert(upserts);
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

  const expiringClients = useMemo(() => clients.filter(c => { const d = daysUntil(c.contract_end); return d !== null && d <= 30; }), [clients]);

  // Clients needing attention: hard alerts (danger/warn) + contracts expiring within 30 days
  const alertAndExpiringClients = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) {
      if (c.status === 'danger' || c.status === 'warn') map.set(c.id, c);
    }
    for (const c of expiringClients) map.set(c.id, c);
    return [...map.values()];
  }, [clients, expiringClients]);

  useEffect(() => {
    if (alertAndExpiringClients.length && tasks.length >= 0) syncAlertTasks(alertAndExpiringClients);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertAndExpiringClients.length]);

  const updateTaskStatus = async (id: string, status: TaskStatus) => {
    if ((id.startsWith('pt_') || id.startsWith('wt_')) && status === 'done') {
      const task = tasks.find(t => t.id === id);
      setReportTarget({ id, title: task?.description || task?.client_name || '' });
      setReportNote('');
      return;
    }
    if (id.startsWith('pt_')) {
      const realId = id.replace('pt_', '');
      await supabase.from('crm_pipeline_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', realId);
    } else if (id.startsWith('wt_')) {
      const realId = id.replace('wt_', '');
      await supabase.from('work_tasks').update({ status, updated_at: new Date().toISOString(), completed_at: null }).eq('id', realId);
    } else {
      await supabase.from('dashboard_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const confirmTaskDone = async () => {
    if (!reportTarget || !reportNote.trim()) return;
    const note = reportNote.trim();
    const id = reportTarget.id;
    const updatedAt = new Date().toISOString();
    if (id.startsWith('pt_')) {
      const realId = id.replace('pt_', '');
      await supabase.from('crm_pipeline_tasks').update({ status: 'done', result_note: note, updated_at: updatedAt }).eq('id', realId);
    } else if (id.startsWith('wt_')) {
      const realId = id.replace('wt_', '');
      await supabase.from('work_tasks').update({ status: 'done', notes: note, completed_at: updatedAt, updated_at: updatedAt }).eq('id', realId);
    }
    setTasks(prev => prev.filter(t => t.id !== id));
    setReportTarget(null);
    setReportNote('');
  };

  const findClientForTask = useCallback((task: DashboardTask): Client | null => {
    if (task.client_id) return clients.find(c => c.id === task.client_id) || null;
    return clients.find(c => c.name === task.client_name) || null;
  }, [clients]);

  const visibleTasks = useMemo(() => {
    if (!regionFilter) return tasks;
    return tasks.filter(t => t.client_region === regionFilter);
  }, [tasks, regionFilter]);

  const contractTasks = useMemo(() => visibleTasks.filter(t => t.source_type === 'contract'), [visibleTasks]);
  const workTasks = useMemo(() => visibleTasks.filter(t => t.source_type !== 'contract'), [visibleTasks]);

  const renderTask = (task: DashboardTask) => {
    const cfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.pending;
    const relatedClient = findClientForTask(task);
    const daysLeft = task.source_type === 'contract' && relatedClient ? daysUntil(relatedClient.contract_end) : null;
    return (
      <div key={task.id} className="flex items-center gap-2 px-3 py-2 border-b border-[#F0EEE9]">
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
          {task.source_type === 'pipeline' && task.crm_id && onOpenPipelineEntry ? (
            <button onClick={() => onOpenPipelineEntry(task.crm_id!)} className="font-medium text-[12px] truncate text-blue-700 hover:underline text-left block w-full">{task.client_name}</button>
          ) : relatedClient && onOpenClient ? (
            <button onClick={() => onOpenClient(relatedClient.id)} className="font-medium text-[12px] truncate text-blue-700 hover:underline text-left block w-full">{task.client_name}</button>
          ) : relatedClient && onSelectClient ? (
            <button onClick={() => onSelectClient(relatedClient)} className="font-medium text-[12px] truncate text-blue-700 hover:underline text-left block w-full">{task.client_name}</button>
          ) : (
            <div className="font-medium text-[12px] truncate">{task.client_name}</div>
          )}
          <div className="text-[11px] text-gray-500 truncate">{task.description}</div>
          {task.due_date && (
            <div className={`text-[10.5px] mt-0.5 ${new Date(task.due_date) < new Date() ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              Hạn: {task.due_date}
            </div>
          )}
        </div>
        {task.client_region && (
          <span className="text-[10.5px] text-gray-400 shrink-0">{task.client_region}</span>
        )}
        {/* Status selector */}
        <div className="relative shrink-0">
          <select
            value={task.status}
            onChange={e => updateTaskStatus(task.id, e.target.value as TaskStatus)}
            className={`appearance-none text-[10.5px] font-medium pl-5 pr-4 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 ${cfg.bg} ${cfg.cls}`}
          >
            {(Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, typeof TASK_STATUS_CONFIG[TaskStatus]][]).map(([val, c]) => (
              <option key={val} value={val}>{c.label}</option>
            ))}
          </select>
          <span className={`absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none ${cfg.cls}`}>
            {cfg.icon}
          </span>
        </div>
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
      <div className="grid grid-cols-2 divide-x divide-[#F0EEE9]">
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

      {reportTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => { setReportTarget(null); setReportNote(''); }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-2.5" onClick={e => e.stopPropagation()}>
            <div className="text-[12.5px] font-semibold text-[#333]">
              Hoàn thành: <span className="font-normal">{reportTarget.title}</span>
            </div>
            <textarea
              value={reportNote}
              onChange={e => setReportNote(e.target.value)}
              placeholder="Anh chị vui lòng nhập kết quả công việc tại đây, để team cùng nắm thông tin , thanks."
              rows={3}
              autoFocus
              className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setReportTarget(null); setReportNote(''); }}
                className="flex-1 py-1.5 border border-gray-300 text-gray-500 rounded-lg text-[12px] font-medium hover:bg-gray-50 transition"
              >
                Huỷ
              </button>
              <button
                onClick={confirmTaskDone}
                disabled={!reportNote.trim()}
                className="flex-1 py-1.5 bg-emerald-600 text-white rounded-lg text-[12px] font-medium hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                Xác nhận hoàn thành
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
