import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, X, FileText, FilePlus, Send, ClipboardList,
  CalendarClock, Building2, Phone, TrendingUp, Wallet, CheckCircle2,
  Settings, GripVertical, Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw,
  History, Search,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { WorkspaceModulesTabs } from '../components/workspace/WorkspaceModulesTabs';
import { WorkTasksCard } from '../components/workspace/WorkTasksCard';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { Client, FinanceRecord, CRMPipelineEntry, Page, WorkTask, TaskStatus, WorkTaskComment } from '../lib/types';
import { ROLE_LABELS, CRM_STAGES } from '../lib/constants';
import { formatDate, daysUntil } from '../lib/format';
import { usePersistedState } from '../hooks/usePersistedState';

interface WorkspaceProps {
  clients: Client[];
  finance: FinanceRecord[];
  pipeline: CRMPipelineEntry[];
  onNavigate: (page: Page) => void;
  onClientUpdate: (client: Client) => void;
  toast: (msg: string) => void;
}

// --- Việc đang treo (bảng workspace_tasks) ----------------------
interface WorkspaceTask {
  id: string;
  title: string;
  type: 'doc' | 'task' | string;
  status: 'drafting' | 'pending_approval' | 'pending_sign' | 'done' | 'not_started' | 'overdue' | string;
  assignee: string | null;
  deadline: string | null;
  created_at: string;
}

const WS_STATUS: Record<string, { label: string; cls: string }> = {
  drafting:         { label: 'Đang soạn',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pending_approval: { label: 'Chờ duyệt',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending_sign:     { label: 'Chờ ký',       cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  done:             { label: 'Hoàn thành',   cls: 'bg-green-50 text-green-700 border-green-200' },
  not_started:      { label: 'Chưa bắt đầu', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  overdue:          { label: 'Quá hạn',      cls: 'bg-red-50 text-red-700 border-red-200' },
};

function SectionCard({ title, icon, children, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] bg-[#F9F9F7]">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
          {icon}{title}
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// --- Workspace layout customization (show/hide + reorder supplementary sections, font size) ---
type SectionKey = 'alerts' | 'prospects';

const SECTION_LABELS: Record<SectionKey, string> = {
  alerts: 'Thông báo theo vai trò',
  prospects: 'Prospects cần follow-up',
};

const DEFAULT_ORDER: SectionKey[] = ['alerts', 'prospects'];

interface WorkspaceLayout {
  order: SectionKey[];
  hidden: SectionKey[];
  fontScale: number;
}

const DEFAULT_LAYOUT: WorkspaceLayout = { order: DEFAULT_ORDER, hidden: [], fontScale: 1 };

function sectionAvailable(key: SectionKey, role: string): boolean {
  if (key === 'prospects') return role === 'kinhdoanh';
  if (key === 'alerts') return role === 'admin' || role === 'ketoan' || role === 'bdh';
  return true;
}

const FONT_MIN = 0.8;
const FONT_MAX = 1.3;
const FONT_STEP = 0.05;

export default function Workspace({ clients, pipeline, onNavigate, onClientUpdate, toast }: WorkspaceProps) {
  const { user } = useAuth();
  const [branchRegion, setBranchRegion] = useState<string | null>(null);

  const [layout, setLayout] = usePersistedState<WorkspaceLayout>('lgvn_workspace_layout', DEFAULT_LAYOUT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragKey, setDragKey] = useState<SectionKey | null>(null);
  const [activeModule, setActiveModule] = useState<'morning' | 'winloss' | 'kcn'>('morning');

  // Merge in any new section keys and drop ones that no longer exist
  const order = [...layout.order.filter(k => DEFAULT_ORDER.includes(k)), ...DEFAULT_ORDER.filter(k => !layout.order.includes(k))];

  // Dismissible banners (session-scoped)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Việc đang treo
  const [wsTasks, setWsTasks] = useState<WorkspaceTask[]>([]);
  const [wsLoading, setWsLoading] = useState(true);
  const [taskTab, setTaskTab] = useState<'all' | 'doc' | 'task'>('all');

  // Standalone WorkTasksCard state (bottom-right)
  const [myTasks, setMyTasks] = useState<WorkTask[]>([]);
  const [doneTasks, setDoneTasks] = useState<WorkTask[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyWeek, setHistoryWeek] = useState<string>('all');
  const [taskComments, setTaskComments] = useState<Record<string, WorkTaskComment[]>>({});
  const [commentInput, setCommentInput] = useState<Record<string, string>>({});
  const [submittingComment, setSubmittingComment] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'bdh') return;
    (async () => {
      const { data } = await supabase
        .from('managers')
        .select('region')
        .eq('name', user.full_name)
        .maybeSingle();
      setBranchRegion((data as { region: string | null } | null)?.region || null);
    })();
  }, [user]);

  useEffect(() => {
    supabase
      .from('workspace_tasks')
      .select('*')
      .neq('status', 'done')
      .order('deadline', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setWsTasks(data as WorkspaceTask[]);
        setWsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    // Load done tasks (last 30 days)
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    supabase.from('work_tasks').select('*')
      .eq('user_id', user.id).eq('status', 'done')
      .gte('completed_at', since).order('completed_at', { ascending: false })
      .then(({ data }) => { if (data) setDoneTasks(data as WorkTask[]); });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('work_tasks')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'done')
      .order('due_date', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        setMyTasks(data as WorkTask[]);
        const ids = (data as WorkTask[]).map(t => t.id);
        if (!ids.length) return;
        supabase.from('work_task_comments').select('*').in('task_id', ids).order('created_at', { ascending: true })
          .then(({ data: cData }) => {
            if (!cData) return;
            const map: Record<string, WorkTaskComment[]> = {};
            for (const c of cData as WorkTaskComment[]) {
              if (!map[c.task_id]) map[c.task_id] = [];
              map[c.task_id].push(c);
            }
            setTaskComments(map);
          });
      });
  }, [user]);

  const adjustFont = (delta: number) => {
    setLayout(prev => ({ ...prev, fontScale: Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round((prev.fontScale + delta) * 100) / 100)) }));
  };

  const resetLayout = () => setLayout(DEFAULT_LAYOUT);

  const toggleHidden = (key: SectionKey) => {
    setLayout(prev => ({
      ...prev,
      hidden: prev.hidden.includes(key) ? prev.hidden.filter(k => k !== key) : [...prev.hidden, key],
    }));
  };

  const handleDropSection = (targetKey: SectionKey) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); return; }
    setLayout(prev => {
      const newOrder = [...order];
      const from = newOrder.indexOf(dragKey);
      const to = newOrder.indexOf(targetKey);
      newOrder.splice(from, 1);
      newOrder.splice(to, 0, dragKey);
      return { ...prev, order: newOrder };
    });
    setDragKey(null);
  };

  const dismiss = (key: string) => setDismissed(prev => new Set(prev).add(key));

  // --- Derived data ---
  const dangerClients = useMemo(() =>
    clients.filter(c => c.client_type === 'active' && c.status === 'danger' && c.cooperation_status !== 'suspended'),
  [clients]);

  const expiring7 = useMemo(() =>
    clients.filter(c => {
      const d = daysUntil(c.contract_end);
      return c.client_type === 'active' && c.cooperation_status !== 'suspended' && d !== null && d >= 0 && d <= 7;
    }),
  [clients]);

  const expiringList = useMemo(() =>
    clients
      .filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended')
      .map(c => ({ c, d: daysUntil(c.contract_end) }))
      .filter((x): x is { c: Client; d: number } => x.d !== null && x.d >= 0 && x.d <= 30)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6),
  [clients]);

  const branchGroups = useMemo(() => {
    const map = new Map<string, { region: string; count: number; lastUpdate: string | null }>();
    for (const c of clients) {
      if (c.client_type !== 'active' || c.cooperation_status === 'suspended') continue;
      const region = c.region || 'Chưa phân CN';
      const g = map.get(region) || { region, count: 0, lastUpdate: null };
      g.count++;
      if (c.updated_at && (!g.lastUpdate || c.updated_at > g.lastUpdate)) g.lastUpdate = c.updated_at;
      map.set(region, g);
    }
    return Array.from(map.values())
      .map(g => ({ ...g, days: g.lastUpdate ? Math.floor((Date.now() - new Date(g.lastUpdate).getTime()) / 86400000) : null }))
      .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999))
      .slice(0, 6);
  }, [clients]);

  const unpaidClients = useMemo(() => clients.filter(c => c.client_type === 'active' && !c.paid_this_month), [clients]);
  const alertClients = useMemo(() => clients.filter(c => c.client_type === 'active' && (c.status === 'warn' || c.status === 'danger')), [clients]);
  const branchExpiring = branchRegion ? expiringList.filter(x => x.c.region === branchRegion).map(x => x.c) : [];
  const staleProspects = useMemo(() => pipeline.filter(p => {
    if (p.stage === 'hop-tac') return false;
    const d = daysUntil(p.last_contact);
    return d === null || d > 14;
  }).slice(0, 6), [pipeline]);

  const suspendedClientIds = useMemo(
    () => new Set(clients.filter(c => c.cooperation_status === 'suspended').map(c => c.id)),
    [clients]
  );

  const visibleMyTasks = useMemo(
    () => myTasks.filter(t => !t.client_id || !suspendedClientIds.has(t.client_id)),
    [myTasks, suspendedClientIds]
  );

  const visibleWsTasks = useMemo(() => {
    if (taskTab === 'doc') return wsTasks.filter(t => t.type === 'doc');
    if (taskTab === 'task') return wsTasks.filter(t => t.type === 'task');
    return wsTasks;
  }, [wsTasks, taskTab]);

  // --- Week label helper ---
  function getWeekLabel(dateStr: string | null): string {
    if (!dateStr) return 'Không rõ';
    const d = new Date(dateStr);
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `Tuần ${week} (${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })})`;
  }

  function getWeekKey(dateStr: string | null): string {
    if (!dateStr) return 'unknown';
    const d = new Date(dateStr);
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
  }

  const availableWeeks = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of doneTasks) {
      const key = getWeekKey(t.completed_at);
      if (!map.has(key)) map.set(key, getWeekLabel(t.completed_at));
    }
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [doneTasks]);

  const filteredDoneTasks = useMemo(() => {
    return doneTasks.filter(t => {
      const matchWeek = historyWeek === 'all' || getWeekKey(t.completed_at) === historyWeek;
      const matchSearch = !historySearch.trim() || t.title.toLowerCase().includes(historySearch.toLowerCase());
      return matchWeek && matchSearch;
    });
  }, [doneTasks, historyWeek, historySearch]);

  // --- Badge color helpers ---
  function expBadge(d: number) {
    if (d <= 5) return 'bg-red-50 text-red-700 border-red-200';
    if (d <= 15) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-slate-100 text-slate-600 border-slate-300';
  }

  function contactBadge(days: number | null): { cls: string; label: string } {
    if (days === null || days > 7) return { cls: 'bg-red-50 text-red-700 border-red-200', label: days === null ? 'Chưa rõ' : `${days} ngày` };
    if (days >= 3) return { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: `${days} ngày` };
    return { cls: 'bg-green-50 text-green-700 border-green-200', label: days <= 1 ? 'Mới' : `${days} ngày` };
  }

  // --- Việc đang treo: đánh dấu xong ---
  async function markWsTaskDone(id: string) {
    setWsTasks(prev => prev.filter(t => t.id !== id));
    await supabase.from('workspace_tasks').update({ status: 'done' }).eq('id', id);
  }

  // --- WorkTasksCard (standalone) handlers ---
  function handleTaskCreated(task: WorkTask) {
    setMyTasks(prev => [task, ...prev]);
    setTaskComments(prev => ({ ...prev, [task.id]: [] }));
  }

  async function submitComment(taskId: string) {
    const content = (commentInput[taskId] ?? '').trim();
    if (!content || !user) return;
    setSubmittingComment(taskId);
    const userName = (user as any).full_name || (user as any).name || (user as any).email || 'Người dùng';
    const { data, error } = await supabase.from('work_task_comments')
      .insert({ task_id: taskId, user_id: user.id, user_name: userName, content })
      .select().single();
    if (!error && data) {
      setTaskComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] ?? []), data as WorkTaskComment] }));
      setCommentInput(prev => ({ ...prev, [taskId]: '' }));
    }
    setSubmittingComment(null);
  }
  async function handleTaskStatus(id: string, status: TaskStatus) {
    setMyTasks(prev => status === 'done' ? prev.filter(t => t.id !== id) : prev.map(t => t.id === id ? { ...t, status } : t));
    await supabase.from('work_tasks').update({
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
  }
  async function handleTaskDelete(id: string) {
    setMyTasks(prev => prev.filter(t => t.id !== id));
    await supabase.from('work_tasks').delete().eq('id', id);
  }

  if (!user) return null;

  // --- Supplementary role-based sections ---
  const renderRoleCard = (): React.ReactNode => {
    if (user.role === 'admin') {
      return (
        <SectionCard title="Thông báo hợp đồng" icon={<AlertTriangle size={14} className="text-[#888]" />}>
          {alertClients.length === 0 ? (
            <div className="text-[12.5px] text-[#999] py-4 text-center">Không có cảnh báo</div>
          ) : (
            <div className="space-y-1.5">
              {alertClients.slice(0, 6).map(c => (
                <div key={c.id} onClick={() => onNavigate('clients')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-[#333] truncate">{c.name}</div>
                    <div className="text-[11px] text-[#999]">HĐ hết: {formatDate(c.contract_end)}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${c.status === 'danger' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {c.status === 'danger' ? 'Khẩn cấp' : 'Sắp hết HĐ'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }
    if (user.role === 'ketoan') {
      return (
        <SectionCard title="Khách hàng chưa thanh toán tháng này" icon={<Wallet size={14} className="text-[#888]" />}>
          {unpaidClients.length === 0 ? (
            <div className="text-[12.5px] text-[#999] py-4 text-center">Tất cả đã thanh toán</div>
          ) : (
            <div className="space-y-1.5">
              {unpaidClients.slice(0, 8).map(c => (
                <div key={c.id} onClick={() => onNavigate('finance')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
                  <div className="text-[12.5px] font-medium text-[#333] truncate">{c.name}</div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Chưa TT</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }
    if (user.role === 'bdh') {
      return (
        <SectionCard title="Hợp đồng sắp hết hạn (chi nhánh) — cập nhật thông tin" icon={<CalendarClock size={14} className="text-[#888]" />}>
          {branchExpiring.length === 0 ? (
            <div className="text-[12.5px] text-[#999] py-4 text-center">Không có hợp đồng sắp hết hạn</div>
          ) : (
            <div className="space-y-1.5">
              {branchExpiring.slice(0, 8).map(c => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7]">
                  <div className="text-[12.5px] font-medium text-[#333] truncate">{c.name}</div>
                  <div className="text-[11px] text-amber-700">{formatDate(c.contract_end)} ({daysUntil(c.contract_end)} ngày)</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }
    return null;
  };

  const renderSection = (key: SectionKey): React.ReactNode => {
    switch (key) {
      case 'alerts':
        return renderRoleCard();
      case 'prospects':
        if (user.role !== 'kinhdoanh') return null;
        return (
          <SectionCard title="Prospects cần follow-up" icon={<TrendingUp size={14} className="text-[#888]" />} action={
            <button onClick={() => onNavigate('crm-pipeline')} className="text-[11.5px] text-blue-600 hover:underline">Xem BD Pipeline →</button>
          }>
            {staleProspects.length === 0 ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Không có prospect cần follow</div>
            ) : (
              <div className="space-y-1.5">
                {staleProspects.map(p => {
                  const stageInfo = CRM_STAGES.find(s => s.id === p.stage);
                  return (
                    <div key={p.id} onClick={() => onNavigate('crm-pipeline')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-[#333] truncate">{p.company_name}</div>
                        <div className="text-[11px] text-[#999]">Liên hệ gần nhất: {p.last_contact ? formatDate(p.last_contact) : 'Chưa liên hệ'}</div>
                      </div>
                      {stageInfo && <span className={`text-[11px] px-2 py-0.5 rounded-full border ${stageInfo.color}`}>{stageInfo.label}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        );
      default:
        return null;
    }
  };

  const visibleSections = order.filter(k => sectionAvailable(k, user.role) && !layout.hidden.includes(k));
  const configurableSections = order.filter(k => sectionAvailable(k, user.role));

  // --- Quick actions ---
  const quickActions: { label: string; icon: React.ReactNode; onClick: () => void }[] = [
    { label: 'Tạo báo giá', icon: <FileText size={14} />, onClick: () => onNavigate('market') },
    { label: 'Thêm HĐ', icon: <FilePlus size={14} />, onClick: () => onNavigate('clients') },
    { label: 'Giao việc', icon: <Send size={14} />, onClick: () => toast('Tính năng sắp ra mắt') },
    { label: 'Ghi nhận LĐ', icon: <ClipboardList size={14} />, onClick: () => onNavigate('clients') },
  ];

  return (
    <>
      <PageHeader
        title="Workspace"
        subtitle={`Xin chào, ${user.full_name} · ${ROLE_LABELS[user.role] || user.role}`}
        actions={
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${settingsOpen ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            <Settings size={14} /> Tuỳ chỉnh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-5" style={{ zoom: layout.fontScale }}>
        {settingsOpen && (
          <div className="mb-4 bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-4">
            {/* Font size */}
            <div>
              <div className="text-[12px] font-semibold text-[#333] mb-2">Cỡ chữ / không gian làm việc</div>
              <div className="flex items-center gap-2">
                <button onClick={() => adjustFont(-FONT_STEP)} disabled={layout.fontScale <= FONT_MIN} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                  <ZoomOut size={14} />
                </button>
                <span className="text-[12.5px] text-[#555] w-12 text-center">{Math.round(layout.fontScale * 100)}%</span>
                <button onClick={() => adjustFont(FONT_STEP)} disabled={layout.fontScale >= FONT_MAX} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                  <ZoomIn size={14} />
                </button>
                <button onClick={resetLayout} className="ml-2 inline-flex items-center gap-1 text-[11.5px] text-[#999] hover:text-blue-600 transition">
                  <RotateCcw size={12} /> Khôi phục mặc định
                </button>
              </div>
            </div>

            {/* Show/hide + reorder supplementary sections */}
            {configurableSections.length > 0 && (
              <div>
                <div className="text-[12px] font-semibold text-[#333] mb-2">Hiển thị &amp; sắp xếp các bảng phụ (kéo thả để đổi vị trí)</div>
                <div className="space-y-1">
                  {configurableSections.map(key => {
                    const isHidden = layout.hidden.includes(key);
                    return (
                      <div
                        key={key}
                        draggable
                        onDragStart={() => setDragKey(key)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleDropSection(key)}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#F0EFEA] cursor-move transition ${isHidden ? 'opacity-50' : 'bg-[#FAFAF8]'} hover:bg-[#F4F4F1]`}
                      >
                        <GripVertical size={14} className="text-[#bbb] shrink-0" />
                        <span className="flex-1 text-[12.5px] text-[#333]">{SECTION_LABELS[key]}</span>
                        <button onClick={() => toggleHidden(key)} className="text-[#999] hover:text-blue-600 transition shrink-0" title={isHidden ? 'Hiện' : 'Ẩn'}>
                          {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 1. QUICK ACTIONS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {quickActions.map(a => (
            <button
              key={a.label}
              onClick={a.onClick}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#E8E7E2] bg-white text-[12px] font-medium text-[#333] hover:border-blue-300 hover:bg-blue-50 transition-colors"
            >
              {a.icon}{a.label}
            </button>
          ))}
        </div>

        {/* 3. MODULES (Morning Priority, Win/Loss, KCN Grid) */}
        <div className="mt-4">
          <WorkspaceModulesTabs clients={clients} onClientUpdate={onClientUpdate} toast={toast} onTabChange={setActiveModule} />
        </div>

        {/* chỉ hiện khi tab Morning Priority */}
        {activeModule === 'morning' && <>

        {/* BOTTOM — 2 cột */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3 mt-4">
          {/* Left: Việc đang treo (full) */}
          <SectionCard
            title="Việc đang treo"
            icon={<ClipboardList size={14} className="text-[#888]" />}
            action={
              <div className="flex items-center gap-2">
                {wsTasks.length > 0 && (
                  <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{wsTasks.length} mục</span>
                )}
                <div className="flex gap-1">
                  {([['all', 'Tất cả'], ['doc', 'Hồ sơ·HĐ'], ['task', 'Task nội bộ']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setTaskTab(key)}
                      className={`text-[10.5px] px-2 py-0.5 rounded-md border transition ${taskTab === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            }
          >
            {wsLoading ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Đang tải...</div>
            ) : visibleWsTasks.length === 0 ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Không có việc đang treo</div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-0.5">
                {visibleWsTasks.map(t => {
                  const st = WS_STATUS[t.status] || WS_STATUS.not_started;
                  const overdue = t.deadline ? new Date(t.deadline) < new Date(new Date().toDateString()) : false;
                  return (
                    <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-[#F0EFEB] bg-[#fafafa]">
                      {t.type === 'doc'
                        ? <FileText size={14} className="text-[#888] shrink-0 mt-0.5" />
                        : <ClipboardList size={14} className="text-[#888] shrink-0 mt-0.5" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-semibold text-[#111] truncate">{t.title}</div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                          {t.assignee && <span className="text-[11px] text-[#666]">{t.assignee}</span>}
                          {t.deadline && (
                            <span className={`text-[10.5px] ${overdue ? 'text-red-600 font-semibold' : 'text-[#999]'}`}>
                              Hạn {formatDate(t.deadline)}{overdue ? ' · quá hạn' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => markWsTaskDone(t.id)}
                        className="flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-white hover:text-green-600 hover:border-green-300 transition-colors shrink-0"
                        title="Đánh dấu hoàn thành"
                      >
                        <CheckCircle2 size={12} /> Xong
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Right: Công việc sắp tới */}
          <WorkTasksCard
            clients={clients}
            tasks={visibleMyTasks}
            onTaskCreated={handleTaskCreated}
            onStatusChange={handleTaskStatus}
            onDelete={handleTaskDelete}
          />
        </div>

        </>}

        {/* Supplementary role-based sections (settings-controlled) */}
        {visibleSections.length > 0 && (
          <div className="space-y-4 mt-4">
            {visibleSections.map(key => (
              <div key={key}>{renderSection(key)}</div>
            ))}
          </div>
        )}

        {/* LỊCH SỬ CÔNG VIỆC HOÀN THÀNH — dưới cùng */}
        <div className="mt-6 bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] bg-[#F9F9F7]">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
              <History size={14} className="text-[#888]" />
              Lịch sử công việc hoàn thành
              {doneTasks.length > 0 && (
                <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{doneTasks.length}</span>
              )}
            </div>
            {/* Filter + Search */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#bbb]" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="Tìm theo tên..."
                  className="text-[11px] pl-6 pr-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-white w-36"
                />
              </div>
              <select
                value={historyWeek}
                onChange={e => setHistoryWeek(e.target.value)}
                className="text-[11px] px-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-white"
              >
                <option value="all">Tất cả tuần</option>
                {availableWeeks.map(w => (
                  <option key={w.key} value={w.key}>{w.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="p-3">
            {filteredDoneTasks.length === 0 ? (
              <div className="text-[12.5px] text-[#999] py-6 text-center">
                {doneTasks.length === 0 ? 'Chưa có công việc nào hoàn thành trong 30 ngày qua' : 'Không có kết quả phù hợp'}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-0.5">
                {filteredDoneTasks.map(t => (
                  <div key={t.id} className="flex items-start gap-2.5 px-3 py-2 border border-[#F0EFEB] bg-[#fafafa] rounded-lg">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-[#111] truncate">{t.title}</div>
                      <div className="text-[11px] text-[#888] mt-0.5">
                        Hoàn thành {t.completed_at ? formatDate(t.completed_at.split('T')[0]) : ''}
                        {t.kcn ? ` · ${t.kcn}` : ''}
                        {t.completed_at ? ` · ${getWeekLabel(t.completed_at)}` : ''}
                      </div>
                      {t.notes && (
                        <div className="text-[11.5px] text-[#555] mt-1 bg-white border border-[#F0EFEB] rounded-md px-2 py-1">{t.notes}</div>
                      )}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${t.priority === 'high' ? 'bg-red-50 text-red-700 border-red-200' : t.priority === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                      {t.priority === 'high' ? 'Cao' : t.priority === 'medium' ? 'TB' : 'Thấp'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
