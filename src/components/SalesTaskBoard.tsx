import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, AlertTriangle, Clock, CalendarClock, Circle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/audit';
import type { SalesTask, SalesTaskStatus } from '../lib/types';
import { formatDate } from '../lib/format';

interface SalesTaskBoardProps {
  toast: (msg: string) => void;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

type FilterKey = 'all' | 'mine' | 'open' | 'today' | 'week';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'mine', label: 'Của tôi' },
  { key: 'open', label: 'Chưa xong' },
  { key: 'today', label: 'Hôm nay' },
  { key: 'week', label: 'Tuần này' },
];

const STATUS_LABELS: Record<SalesTaskStatus, { label: string; cls: string }> = {
  todo: { label: 'Chưa làm', cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
  inprogress: { label: 'Đang làm', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  done: { label: 'Xong', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  overdue: { label: 'Trễ', cls: 'bg-red-50 text-red-700 border border-red-200' },
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekRange(): { start: string; end: string } {
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay(); // Mon=1..Sun=7
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

function displayStatus(task: SalesTask): SalesTaskStatus {
  if (task.status === 'done') return 'done';
  if (task.deadline && task.deadline < todayStr()) return 'overdue';
  return task.status;
}

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash)];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface TaskGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  cls: string;
  tasks: SalesTask[];
}

export default function SalesTaskBoard({ toast }: SalesTaskBoardProps) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<SalesTask[]>([]);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);

  const [newTitle, setNewTitle] = useState('');
  const [newClient, setNewClient] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [showDone, setShowDone] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sales_tasks')
      .select('*')
      .order('deadline', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) toast('Lỗi tải danh sách: ' + errMsg(error));
    setTasks((data || []) as SalesTask[]);
    setLoading(false);
  }, [toast]);

  const loadUsers = useCallback(async () => {
    const { data } = await supabase
      .from('app_users')
      .select('id, full_name')
      .in('role', ['admin', 'kinhdoanh', 'bdh'])
      .order('full_name');
    setUsers((data || []) as { id: string; full_name: string }[]);
  }, []);

  useEffect(() => { loadTasks(); loadUsers(); }, [loadTasks, loadUsers]);

  useEffect(() => {
    if (user && !newAssignee) setNewAssignee(user.id);
  }, [user, newAssignee]);

  const filtered = useMemo(() => {
    const { start, end } = weekRange();
    const today = todayStr();
    return tasks.filter(t => {
      switch (filter) {
        case 'mine': return t.assigned_to === user?.id;
        case 'open': return displayStatus(t) !== 'done';
        case 'today': return t.deadline === today;
        case 'week': return !!t.deadline && t.deadline >= start && t.deadline <= end;
        default: return true;
      }
    });
  }, [tasks, filter, user]);

  const canEdit = (t: SalesTask) => user?.role === 'admin' || t.created_by === user?.id;

  const stats = useMemo(() => ({
    total: tasks.length,
    overdue: tasks.filter(t => displayStatus(t) === 'overdue').length,
    inprogress: tasks.filter(t => t.status === 'inprogress').length,
    done: tasks.filter(t => t.status === 'done').length,
  }), [tasks]);

  const groups = useMemo((): TaskGroup[] => {
    const { start, end } = weekRange();
    const today = todayStr();
    const open = filtered.filter(t => displayStatus(t) !== 'done');
    const done = filtered.filter(t => displayStatus(t) === 'done');

    const result: TaskGroup[] = [
      { key: 'overdue', label: 'Quá hạn', icon: <AlertTriangle size={11} />, cls: 'text-red-700 bg-red-50', tasks: open.filter(t => displayStatus(t) === 'overdue') },
      { key: 'today', label: 'Hôm nay', icon: <Clock size={11} />, cls: 'text-amber-700 bg-amber-50', tasks: open.filter(t => t.deadline === today && displayStatus(t) !== 'overdue') },
      { key: 'week', label: 'Trong tuần', icon: <CalendarClock size={11} />, cls: 'text-blue-700 bg-blue-50', tasks: open.filter(t => !!t.deadline && t.deadline !== today && t.deadline >= start && t.deadline <= end && displayStatus(t) !== 'overdue') },
      { key: 'later', label: 'Sắp tới', icon: <CalendarClock size={11} />, cls: 'text-violet-700 bg-violet-50', tasks: open.filter(t => !!t.deadline && t.deadline > end) },
      { key: 'none', label: 'Chưa có hạn', icon: <Circle size={11} />, cls: 'text-gray-600 bg-gray-100', tasks: open.filter(t => !t.deadline) },
    ].filter(g => g.tasks.length > 0);

    if (done.length > 0 && showDone) {
      result.push({ key: 'done', label: 'Hoàn thành', icon: <CheckCircle2 size={11} />, cls: 'text-emerald-700 bg-emerald-50', tasks: done });
    }
    return result;
  }, [filtered, showDone]);

  const doneCount = useMemo(() => filtered.filter(t => displayStatus(t) === 'done').length, [filtered]);

  const handleAdd = async () => {
    if (!newTitle.trim() || !user) return;
    const assigneeId = newAssignee || user.id;
    const assigneeName = users.find(u => u.id === assigneeId)?.full_name || user.full_name;
    const payload = {
      title: newTitle.trim(),
      sub_label: null,
      client_name: newClient.trim() || null,
      deadline: newDeadline || null,
      assigned_to: assigneeId,
      assigned_name: assigneeName,
      status: 'todo' as SalesTaskStatus,
      created_by: user.id,
    };
    try {
      const { data, error } = await supabase.from('sales_tasks').insert(payload).select().single();
      if (error) throw error;
      setTasks(prev => [data as SalesTask, ...prev]);
      await logActivity({
        user, action: 'insert', table: 'sales_tasks', recordId: (data as SalesTask).id,
        description: `Thêm task "${payload.title}"`, newData: data,
      });
      setNewTitle('');
      setNewClient('');
      setNewDeadline('');
    } catch (e) {
      toast('Lỗi thêm task: ' + errMsg(e));
    }
  };

  const updateTask = async (task: SalesTask, updates: Partial<SalesTask>) => {
    try {
      const { data, error } = await supabase.from('sales_tasks').update(updates).eq('id', task.id).select().single();
      if (error) throw error;
      setTasks(prev => prev.map(t => t.id === task.id ? (data as SalesTask) : t));
      await logActivity({
        user, action: 'update', table: 'sales_tasks', recordId: task.id,
        description: `Cập nhật task "${task.title}"`, oldData: task, newData: data,
      });
    } catch (e) {
      toast('Lỗi cập nhật: ' + errMsg(e));
    }
  };

  const toggleDone = (task: SalesTask) => {
    const newStatus: SalesTaskStatus = task.status === 'done' ? 'todo' : 'done';
    updateTask(task, { status: newStatus });
  };

  const handleDelete = async (task: SalesTask) => {
    if (!confirm(`Xóa task "${task.title}"?`)) return;
    try {
      const { error } = await supabase.from('sales_tasks').delete().eq('id', task.id);
      if (error) throw error;
      setTasks(prev => prev.filter(t => t.id !== task.id));
      await logActivity({
        user, action: 'delete', table: 'sales_tasks', recordId: task.id,
        description: `Xóa task "${task.title}"`, oldData: task,
      });
    } catch (e) {
      toast('Lỗi xóa: ' + errMsg(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white border border-[#E8E7E2] rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center shrink-0"><Circle size={13} /></span>
          <div>
            <div className="text-[14px] font-semibold text-[#1a1a1a] leading-tight">{stats.total}</div>
            <div className="text-[11px] text-[#999]">Tổng công việc</div>
          </div>
        </div>
        <div className="bg-white border border-[#E8E7E2] rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0"><AlertTriangle size={13} /></span>
          <div>
            <div className="text-[14px] font-semibold text-[#1a1a1a] leading-tight">{stats.overdue}</div>
            <div className="text-[11px] text-[#999]">Quá hạn</div>
          </div>
        </div>
        <div className="bg-white border border-[#E8E7E2] rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Clock size={13} /></span>
          <div>
            <div className="text-[14px] font-semibold text-[#1a1a1a] leading-tight">{stats.inprogress}</div>
            <div className="text-[11px] text-[#999]">Đang làm</div>
          </div>
        </div>
        <div className="bg-white border border-[#E8E7E2] rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><CheckCircle2 size={13} /></span>
          <div>
            <div className="text-[14px] font-semibold text-[#1a1a1a] leading-tight">{stats.done}</div>
            <div className="text-[11px] text-[#999]">Hoàn thành</div>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition ${filter === f.key ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap w-10"></th>
              <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Nội dung</th>
              <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Khách hàng</th>
              <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Deadline</th>
              <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Người làm</th>
              <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Trạng thái</th>
              <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap w-10"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center py-6 text-[#999]">Đang tải...</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-[#999]">Không có công việc nào</td></tr>
            )}
            {!loading && groups.flatMap(g => [
              <tr key={`g-${g.key}`} className="bg-[#FBFBF9]">
                <td colSpan={7} className="px-3 py-1.5">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${g.cls}`}>
                    {g.icon} {g.label} <span className="opacity-60 font-normal">({g.tasks.length})</span>
                  </span>
                </td>
              </tr>,
              ...g.tasks.map(task => {
              const ds = displayStatus(task);
              const editable = canEdit(task);
              const borderCls = ds === 'overdue' ? 'border-l-2 border-l-red-400' : ds === 'todo' && task.deadline === todayStr() ? 'border-l-2 border-l-amber-400' : 'border-l-2 border-l-transparent';
              return (
                <tr key={task.id} className={`border-t border-[#F0EFEA] hover:bg-[#FAFAF8] ${borderCls}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={task.status === 'done'}
                      onChange={() => editable && toggleDone(task)}
                      disabled={!editable}
                      className="w-4 h-4 accent-blue-600"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <input
                        defaultValue={task.title}
                        onBlur={(e) => { if (e.target.value.trim() && e.target.value !== task.title) updateTask(task, { title: e.target.value.trim() }); }}
                        className="font-medium text-[#333] bg-transparent border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 -mx-1 w-full"
                      />
                    ) : (
                      <div className="font-medium text-[#333]">{task.title}</div>
                    )}
                    {editable ? (
                      <input
                        placeholder="Ghi chú nhỏ..."
                        defaultValue={task.sub_label || ''}
                        onBlur={(e) => { if (e.target.value !== (task.sub_label || '')) updateTask(task, { sub_label: e.target.value.trim() || null }); }}
                        className="text-[11px] text-[#999] bg-transparent border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 -mx-1 w-full mt-0.5"
                      />
                    ) : (
                      task.sub_label && <div className="text-[11px] text-[#999] mt-0.5">{task.sub_label}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <input
                        defaultValue={task.client_name || ''}
                        onBlur={(e) => { if (e.target.value !== (task.client_name || '')) updateTask(task, { client_name: e.target.value.trim() || null }); }}
                        className="bg-transparent border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 -mx-1 w-full text-[#555]"
                        placeholder="—"
                      />
                    ) : (
                      <span className="text-[#555]">{task.client_name || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {editable ? (
                      <input
                        type="date"
                        defaultValue={task.deadline || ''}
                        onBlur={(e) => { if (e.target.value !== (task.deadline || '')) updateTask(task, { deadline: e.target.value || null }); }}
                        className="bg-transparent border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 -mx-1 text-[#555]"
                      />
                    ) : (
                      <span className="text-[#555]">{task.deadline ? formatDate(task.deadline) : '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {editable ? (
                      <select
                        value={task.assigned_to || ''}
                        onChange={(e) => {
                          const u = users.find(x => x.id === e.target.value);
                          updateTask(task, { assigned_to: e.target.value || null, assigned_name: u?.full_name || null });
                        }}
                        className="bg-transparent border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 -mx-1 text-[#555]"
                      >
                        <option value="">—</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    ) : task.assigned_name ? (
                      <div className="flex items-center gap-1.5">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9.5px] font-semibold shrink-0 ${avatarColor(task.assigned_name)}`}>
                          {initials(task.assigned_name)}
                        </span>
                        <span className="text-[#555] truncate">{task.assigned_name}</span>
                      </div>
                    ) : (
                      <span className="text-[#555]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {editable && ds !== 'overdue' ? (
                      <select
                        value={task.status}
                        onChange={(e) => updateTask(task, { status: e.target.value as SalesTaskStatus })}
                        className={`text-[11px] px-2 py-0.5 rounded-full border-none outline-none ${STATUS_LABELS[ds].cls}`}
                      >
                        <option value="todo">Chưa làm</option>
                        <option value="inprogress">Đang làm</option>
                        <option value="done">Xong</option>
                      </select>
                    ) : (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_LABELS[ds].cls}`}>{STATUS_LABELS[ds].label}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {(user?.role === 'admin' || task.created_by === user?.id) && (
                      <button onClick={() => handleDelete(task)} className="text-[#bbb] hover:text-red-500 transition">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            }),
            ])}
            {!loading && doneCount > 0 && (
              <tr className="border-t border-[#F0EFEA]">
                <td colSpan={7} className="px-3 py-1.5">
                  <button onClick={() => setShowDone(v => !v)} className="inline-flex items-center gap-1 text-[11px] text-[#999] hover:text-blue-600 transition">
                    {showDone ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {showDone ? 'Ẩn' : 'Hiện'} {doneCount} công việc đã hoàn thành
                  </button>
                </td>
              </tr>
            )}
            {/* Quick add row */}
            <tr className="border-t border-[#F0EFEA] bg-[#FAFAF8]">
              <td className="px-3 py-2 text-[#bbb]"><Plus size={14} /></td>
              <td className="px-3 py-2">
                <input
                  placeholder="Thêm công việc mới..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                  className="bg-transparent border-none outline-none w-full text-[#333] placeholder:text-[#bbb]"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  placeholder="Khách hàng"
                  value={newClient}
                  onChange={(e) => setNewClient(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                  className="bg-transparent border-none outline-none w-full text-[#555] placeholder:text-[#bbb]"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="date"
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                  className="bg-transparent border-none outline-none text-[#555]"
                />
              </td>
              <td className="px-3 py-2">
                <select
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="bg-transparent border-none outline-none text-[#555]"
                >
                  {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2">
                <button onClick={handleAdd} className="text-blue-600 hover:text-blue-700 transition" title="Thêm">
                  <Plus size={16} />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
