import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AlertCircle, RefreshCw, ClipboardList, CheckCircle2, Clock, Circle } from 'lucide-react';
import type { Client } from '../lib/types';
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
  source_type?: 'contract' | 'pipeline';
  due_date?: string | null;
}

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; icon: React.ReactNode; cls: string; bg: string }> = {
  pending:     { label: 'Cần làm',    icon: <Circle size={13} />,       cls: 'text-slate-600',   bg: 'bg-slate-100'   },
  in_progress: { label: 'Đang làm',   icon: <Clock size={13} />,        cls: 'text-blue-600',    bg: 'bg-blue-100'    },
  done:        { label: 'Hoàn thành', icon: <CheckCircle2 size={13} />, cls: 'text-emerald-600', bg: 'bg-emerald-100' },
};

interface Props {
  // Clients used to derive contract alerts/expiring contracts and to resolve a task's related client.
  clients: Client[];
  // Extra filter applied to the task list (e.g. region scope).
  regionFilter?: string | null;
  // When provided, client names become clickable links.
  onSelectClient?: (client: Client) => void;
}

export default function AlertsTasksPanel({ clients, regionFilter, onSelectClient }: Props) {
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const [{ data: contractTasks }, { data: pipelineTasks }] = await Promise.all([
        supabase.from('dashboard_tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_pipeline_tasks').select('*').neq('status', 'done').order('created_at', { ascending: false }),
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
        _real_id: t.id,
      } as any));

      setTasks([...ct, ...pt]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

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
    if (id.startsWith('pt_')) {
      const realId = id.replace('pt_', '');
      await supabase.from('crm_pipeline_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', realId);
      if (status === 'done') {
        setTasks(prev => prev.filter(t => t.id !== id));
        return;
      }
    } else {
      await supabase.from('dashboard_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const findClientForTask = useCallback((task: DashboardTask): Client | null => {
    if (task.client_id) return clients.find(c => c.id === task.client_id) || null;
    return clients.find(c => c.name === task.client_name) || null;
  }, [clients]);

  const visibleTasks = useMemo(() => {
    if (!regionFilter) return tasks;
    return tasks.filter(t => t.client_region === regionFilter);
  }, [tasks, regionFilter]);

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
      <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
        {visibleTasks.length === 0 ? (
          <div className="text-center text-[#aaa] text-[13px] py-4">Không có việc cần làm</div>
        ) : (
          <div className="grid grid-cols-2">
            {visibleTasks.map(task => {
              const cfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.pending;
              const relatedClient = findClientForTask(task);
              const daysLeft = task.source_type !== 'pipeline' && relatedClient ? daysUntil(relatedClient.contract_end) : null;
              return (
                <div key={task.id} className="flex items-center gap-2 px-3 py-2 border-b border-r border-[#F0EEE9] [&:nth-child(2n)]:border-r-0">
                  {task.source_type === 'pipeline' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 bg-orange-100 text-orange-700">
                      <ClipboardList size={10} /> BD
                    </span>
                  ) : daysLeft !== null ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 bg-red-100 text-red-700">
                      {daysLeft <= 0 ? 'Hết hạn' : `${daysLeft} ngày`}
                    </span>
                  ) : null}
                  <div className="flex-1 min-w-0">
                    {relatedClient && onSelectClient ? (
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}
