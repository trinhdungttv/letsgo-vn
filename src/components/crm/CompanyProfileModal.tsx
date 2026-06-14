import { useState, useEffect, useCallback } from 'react';
import {
  X, Phone, Users, Mail, MessageSquare, Gift,
  Rocket, Star, MapPin, UserCheck, CalendarDays, Pencil, Check,
  ClipboardList, Circle, Clock, CheckCircle2,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/format';
import type { CRMPipelineEntry, CRMInteraction, CRMGift, CRMPipelineTask, PipelineTaskStatus, CRMProduct, Contact, WorkTask, TaskStatus } from '../../lib/types';
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import ContactsTab from '../ContactsTab';

export const STAGES = [
  { id: 'tiem-nang',  label: 'Tiềm năng',    headerBg: 'bg-blue-50',    headerText: 'text-blue-700',    border: 'border-blue-200'   },
  { id: 'dang-lh',    label: 'Đang liên hệ', headerBg: 'bg-amber-50',   headerText: 'text-amber-700',   border: 'border-amber-200'  },
  { id: 'quan-tam',   label: 'Quan tâm/Chờ', headerBg: 'bg-emerald-50', headerText: 'text-emerald-700', border: 'border-emerald-200'},
  { id: 'dam-phan',   label: 'Đàm phán HĐ',  headerBg: 'bg-violet-50',  headerText: 'text-violet-700',  border: 'border-violet-200' },
  { id: 'hop-tac',    label: 'Đang HT',       headerBg: 'bg-teal-50',    headerText: 'text-teal-700',    border: 'border-teal-200'   },
];

export const RATING_CONFIG: Record<string, { dot: string; label: string; badge: string }> = {
  hot:    { dot: 'bg-red-500',   label: 'Tiềm năng cao', badge: 'bg-red-100 text-red-700 border-red-200'      },
  normal: { dot: 'bg-amber-400', label: 'Bình thường',   badge: 'bg-amber-100 text-amber-700 border-amber-200'},
  low:    { dot: 'bg-gray-400',  label: 'Thấp',          badge: 'bg-gray-100 text-gray-600 border-gray-200'   },
};

export const INTERACTION_TYPES = [
  { id: 'call',    label: 'Gọi điện', icon: <Phone size={12} />,        color: 'bg-green-100 text-green-700'  },
  { id: 'meeting', label: 'Gặp mặt', icon: <Users size={12} />,        color: 'bg-blue-100 text-blue-700'    },
  { id: 'email',   label: 'Email',    icon: <Mail size={12} />,         color: 'bg-violet-100 text-violet-700'},
  { id: 'zalo',    label: 'Zalo',     icon: <MessageSquare size={12} />, color: 'bg-teal-100 text-teal-700'   },
];

export type Section = 'info' | 'contacts' | 'history' | 'gifts' | 'preferences';

function giftMissingFields(date: string, item: string, value: string, recipientId: string): string[] {
  const missing: string[] = [];
  if (!date.trim()) missing.push('ngày tặng');
  if (!item.trim()) missing.push('tên quà');
  if (!value.trim()) missing.push('giá trị');
  if (!recipientId) missing.push('người nhận');
  return missing;
}

// ── Inline editable field ────────────────────────────────────────────────────
export function InlineEdit({ label, value, onSave, type = 'text' }: {
  label: string; value: string; onSave: (v: string) => void; type?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const commit = () => { setEditing(false); onSave(val); };
  return (
    <div>
      <div className="text-[11px] text-[#888] font-medium mb-0.5">{label}</div>
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type={type}
            value={val}
            onChange={e => setVal(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(value); setEditing(false); } }}
            className="flex-1 text-[12.5px] px-2 py-1 border border-blue-500 rounded-lg outline-none"
          />
          <button onClick={commit} className="p-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Check size={12} /></button>
          <button onClick={() => { setVal(value); setEditing(false); }} className="p-1 text-gray-400 hover:text-gray-600"><X size={12} /></button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="group flex items-center gap-1.5 w-full text-left text-[12.5px] font-medium text-[#111] hover:text-blue-600 transition"
        >
          <span className={val ? '' : 'text-gray-400 italic'}>{val || 'Chưa có'}</span>
          <Pencil size={11} className="text-gray-300 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition shrink-0" />
        </button>
      )}
    </div>
  );
}

// ── Company Profile Modal ────────────────────────────────────────────────────
// Bảng hồ sơ công ty dùng chung cho: CRM Pipeline BD, CSKH Relationship Radar
// và trang Khách hàng (ClientDetail) — cùng 1 "gốc" dữ liệu (crm_pipeline +
// crm_interactions/crm_gifts/crm_pipeline_tasks).
export interface CompanyProfileModalProps {
  entry: CRMPipelineEntry;
  contacts: Contact[];
  products: CRMProduct[];
  onClose?: () => void;
  onUpdate: (updated: CRMPipelineEntry) => void;
  onDelete?: () => void;
  toast: (msg: string) => void;
  isAdmin: boolean;
  /** 'modal' (mặc định): overlay trượt từ phải. 'panel': hiển thị inline trong trang. */
  variant?: 'modal' | 'panel';
  /** Người phụ trách (deal owner) từ crm_deals — hiển thị/sửa ngay tại trang Thông tin. */
  dealOwner?: string | null;
  onDealOwnerChange?: (owner: string) => void;
}

export function CompanyProfileModal({ entry, contacts, products, onClose, onUpdate, onDelete, toast, isAdmin, variant = 'modal', dealOwner, onDealOwnerChange }: CompanyProfileModalProps) {
  const { user } = useAuth();
  const [interactions, setInteractions] = useState<CRMInteraction[]>([]);
  const [gifts, setGifts] = useState<CRMGift[]>([]);
  const [pipelineTasks, setPipelineTasks] = useState<CRMPipelineTask[]>([]);
  const [workTasks, setWorkTasks] = useState<WorkTask[]>([]);
  const [activeSection, setActiveSection] = useState<Section>('info');
  const [historyForm, setHistoryForm] = useState<'interaction' | 'task' | null>(null);
  const [reportTarget, setReportTarget] = useState<{ kind: 'pipeline_task' | 'work_task'; id: string; title: string } | null>(null);
  const [reportNote, setReportNote] = useState('');

  // Info section state
  const [rating, setRating] = useState(entry.rating || 'normal');
  const [customPriceInput, setCustomPriceInput] = useState(entry.custom_price != null ? String(entry.custom_price) : '');
  useEffect(() => { setCustomPriceInput(entry.custom_price != null ? String(entry.custom_price) : ''); }, [entry.id, entry.custom_price]);

  // Interaction form
  const [intType, setIntType] = useState('call');
  const [intContent, setIntContent] = useState('');
  const [intDate, setIntDate] = useState(new Date().toISOString().split('T')[0]);
  const [addingInt, setAddingInt] = useState(false);

  // Gift form
  const [giftItem, setGiftItem] = useState('');
  const [giftValue, setGiftValue] = useState('');
  const [giftDate, setGiftDate] = useState(new Date().toISOString().split('T')[0]);
  const [giftRecipientId, setGiftRecipientId] = useState('');
  const [addingGift, setAddingGift] = useState(false);
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);
  const [editGiftDate, setEditGiftDate] = useState('');
  const [editGiftItem, setEditGiftItem] = useState('');
  const [editGiftValue, setEditGiftValue] = useState('');
  const [editGiftRecipientId, setEditGiftRecipientId] = useState('');
  const [savingGift, setSavingGift] = useState(false);

  // Task form
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  // Preferences
  const [prefs, setPrefs] = useState(entry.preferences || '');
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Activating
  const [activating, setActivating] = useState(false);

  const loadDetails = useCallback(async () => {
    const [ir, gr, tr] = await Promise.all([
      supabase.from('crm_interactions').select('*').eq('crm_id', entry.id).order('interaction_date', { ascending: false }),
      supabase.from('crm_gifts').select('*').eq('crm_id', entry.id).order('gift_date', { ascending: false }),
      supabase.from('crm_pipeline_tasks').select('*').eq('crm_id', entry.id).order('created_at', { ascending: false }),
    ]);
    if (!ir.error) setInteractions(ir.data as CRMInteraction[]);
    if (!gr.error) setGifts(gr.data as CRMGift[]);
    if (!tr.error) setPipelineTasks(tr.data as CRMPipelineTask[]);

    if (entry.client_id) {
      const { data, error } = await supabase
        .from('work_tasks')
        .select('*')
        .eq('client_id', entry.client_id)
        .order('due_date', { ascending: false });
      if (!error) setWorkTasks(data as WorkTask[]);
    }
  }, [entry.id, entry.client_id]);

  useEffect(() => { loadDetails(); }, [loadDetails]);

  const patchEntry = async (patch: Partial<CRMPipelineEntry>, description: string) => {
    const { error } = await supabase.from('crm_pipeline').update(patch).eq('id', entry.id);
    if (!error) {
      onUpdate({ ...entry, ...patch });
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: entry.id,
        description, oldData: entry, newData: { ...entry, ...patch },
      });
    } else toast('Lỗi: ' + error.message);
  };

  const updateLink = async (dbPatch: Partial<CRMPipelineEntry>, localPatch: Partial<CRMPipelineEntry>, description: string) => {
    const { error } = await supabase.from('crm_pipeline').update(dbPatch).eq('id', entry.id);
    if (!error) {
      onUpdate({ ...entry, ...localPatch });
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: entry.id,
        description, oldData: entry, newData: { ...entry, ...localPatch },
      });
    } else toast('Lỗi: ' + error.message);
  };

  const cycleRating = async () => {
    const order = ['hot', 'normal', 'low'] as const;
    const next = order[(order.indexOf(rating as 'hot' | 'normal' | 'low') + 1) % order.length];
    setRating(next);
    const ratingLabel = RATING_CONFIG[next]?.label || next;
    await patchEntry({ rating: next }, `Đổi đánh giá "${entry.company_name}" thành "${ratingLabel}"`);
  };

  const addInteraction = async () => {
    if (!intContent.trim()) return;
    setAddingInt(true);
    const { data, error } = await supabase.from('crm_interactions').insert({
      crm_id: entry.id, interaction_type: intType,
      content: intContent.trim(), interaction_date: intDate,
    }).select().single();
    setAddingInt(false);
    if (!error) {
      setIntContent('');
      setIntDate(new Date().toISOString().split('T')[0]);
      loadDetails();
      toast('Đã ghi log tương tác');
      const typeLabel = INTERACTION_TYPES.find(t => t.id === intType)?.label || intType;
      await logActivity({
        user, action: 'insert', table: 'crm_interactions', recordId: data.id,
        description: `Thêm log "${typeLabel}" cho "${entry.company_name}"`,
        newData: data,
      });
    } else toast('Lỗi: ' + error.message);
  };

  const addGift = async () => {
    if (!giftItem.trim()) return;
    const missing = giftMissingFields(giftDate, giftItem, giftValue, giftRecipientId);
    if (missing.length > 0 && !confirm(`Bạn chưa nhập: ${missing.join(', ')}. Vẫn lưu quà tặng này?`)) return;
    setAddingGift(true);
    const recipient = contacts.find(c => c.id === giftRecipientId);
    const { data, error } = await supabase.from('crm_gifts').insert({
      crm_id: entry.id, item_name: giftItem.trim(),
      value: giftValue.trim() || null, gift_date: giftDate,
      recipient_contact_id: recipient?.id || null,
      recipient_name: recipient?.name || null,
    }).select().single();
    setAddingGift(false);
    if (!error) {
      setGiftItem(''); setGiftValue(''); setGiftRecipientId('');
      setGiftDate(new Date().toISOString().split('T')[0]);
      loadDetails();
      toast('Đã ghi nhận quà tặng');
      await logActivity({
        user, action: 'insert', table: 'crm_gifts', recordId: data.id,
        description: `Thêm quà tặng "${data.item_name}" cho "${entry.company_name}"${recipient ? ` — gửi ${recipient.name}` : ''}`,
        newData: data,
      });
    } else toast('Lỗi: ' + error.message);
  };

  const startEditGift = (g: CRMGift) => {
    setEditingGiftId(g.id);
    setEditGiftDate(g.gift_date);
    setEditGiftItem(g.item_name || '');
    setEditGiftValue(g.value || '');
    setEditGiftRecipientId(g.recipient_contact_id || '');
  };

  const cancelEditGift = () => setEditingGiftId(null);

  const saveEditGift = async (g: CRMGift) => {
    if (!editGiftItem.trim()) return;
    const missing = giftMissingFields(editGiftDate, editGiftItem, editGiftValue, editGiftRecipientId);
    if (missing.length > 0 && !confirm(`Bạn chưa nhập: ${missing.join(', ')}. Vẫn lưu thay đổi này?`)) return;
    setSavingGift(true);
    const recipient = contacts.find(c => c.id === editGiftRecipientId);
    const { data, error } = await supabase.from('crm_gifts').update({
      item_name: editGiftItem.trim(),
      value: editGiftValue.trim() || null,
      gift_date: editGiftDate,
      recipient_contact_id: recipient?.id || null,
      recipient_name: recipient?.name || null,
    }).eq('id', g.id).select().single();
    setSavingGift(false);
    if (!error) {
      setEditingGiftId(null);
      loadDetails();
      toast('Đã cập nhật quà tặng');
      await logActivity({
        user, action: 'update', table: 'crm_gifts', recordId: g.id,
        description: `Cập nhật quà tặng "${data.item_name}" cho "${entry.company_name}"${recipient ? ` — gửi ${recipient.name}` : ''}`,
        oldData: g, newData: data,
      });
    } else toast('Lỗi: ' + error.message);
  };

  const savePrefs = async () => {
    setSavingPrefs(true);
    await patchEntry({ preferences: prefs }, `Cập nhật sở thích/lưu ý cho "${entry.company_name}"`);
    setSavingPrefs(false);
    toast('Đã lưu sở thích/lưu ý');
  };

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    setAddingTask(true);
    const { data, error } = await supabase.from('crm_pipeline_tasks').insert({
      crm_id: entry.id,
      company_name: entry.company_name,
      title: taskTitle.trim(),
      description: taskDesc.trim() || null,
      due_date: taskDue || null,
    }).select().single();
    setAddingTask(false);
    if (!error) {
      setTaskTitle(''); setTaskDesc(''); setTaskDue('');
      loadDetails();
      toast('Đã thêm việc cần xử lý');
      await logActivity({
        user, action: 'insert', table: 'crm_pipeline_tasks', recordId: data.id,
        description: `Thêm việc "${data.title}" cho "${entry.company_name}"`,
        newData: data,
      });
    } else toast('Lỗi: ' + error.message);
  };

  const TASK_STATUS_LABELS: Record<PipelineTaskStatus, string> = {
    pending: 'Chưa xử lý', in_progress: 'Đang xử lý', done: 'Đã xong',
  };

  const updateTaskStatus = async (id: string, status: PipelineTaskStatus) => {
    if (status === 'done') {
      const existing = pipelineTasks.find(t => t.id === id);
      setReportTarget({ kind: 'pipeline_task', id, title: existing?.title || '' });
      setReportNote('');
      return;
    }
    const existing = pipelineTasks.find(t => t.id === id);
    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from('crm_pipeline_tasks').update({ status, updated_at: updatedAt }).eq('id', id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setPipelineTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    if (existing) {
      await logActivity({
        user, action: 'update', table: 'crm_pipeline_tasks', recordId: id,
        description: `Đổi trạng thái việc "${existing.title}" thành "${TASK_STATUS_LABELS[status]}"`,
        oldData: existing, newData: { ...existing, status, updated_at: updatedAt },
      });
    }
  };

  const updateWorkTaskStatus = async (id: string, status: TaskStatus) => {
    if (status === 'done') {
      const existing = workTasks.find(t => t.id === id);
      setReportTarget({ kind: 'work_task', id, title: existing?.title || '' });
      setReportNote('');
      return;
    }
    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from('work_tasks').update({ status, updated_at: updatedAt, completed_at: null }).eq('id', id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setWorkTasks(prev => prev.map(t => t.id === id ? { ...t, status, completed_at: null } : t));
  };

  const confirmTaskDone = async () => {
    if (!reportTarget || !reportNote.trim()) return;
    const note = reportNote.trim();
    const updatedAt = new Date().toISOString();
    if (reportTarget.kind === 'pipeline_task') {
      const existing = pipelineTasks.find(t => t.id === reportTarget.id);
      const { error } = await supabase.from('crm_pipeline_tasks').update({ status: 'done', result_note: note, updated_at: updatedAt }).eq('id', reportTarget.id);
      if (error) { toast('Lỗi: ' + error.message); return; }
      setPipelineTasks(prev => prev.map(t => t.id === reportTarget.id ? { ...t, status: 'done', result_note: note } : t));
      if (existing) {
        await logActivity({
          user, action: 'update', table: 'crm_pipeline_tasks', recordId: reportTarget.id,
          description: `Hoàn thành việc "${existing.title}" — ${note}`,
          oldData: existing, newData: { ...existing, status: 'done', result_note: note, updated_at: updatedAt },
        });
      }
    } else {
      const { error } = await supabase.from('work_tasks').update({ status: 'done', notes: note, completed_at: updatedAt, updated_at: updatedAt }).eq('id', reportTarget.id);
      if (error) { toast('Lỗi: ' + error.message); return; }
      setWorkTasks(prev => prev.map(t => t.id === reportTarget.id ? { ...t, status: 'done', notes: note, completed_at: updatedAt } : t));
    }
    setReportTarget(null);
    setReportNote('');
  };

  const deleteTask = async (id: string) => {
    const existing = pipelineTasks.find(t => t.id === id);
    const { error } = await supabase.from('crm_pipeline_tasks').delete().eq('id', id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setPipelineTasks(prev => prev.filter(t => t.id !== id));
    if (existing) {
      await logActivity({
        user, action: 'delete', table: 'crm_pipeline_tasks', recordId: id,
        description: `Xóa việc "${existing.title}" của "${entry.company_name}"`,
        oldData: existing,
      });
    }
  };

  const handleActivate = async () => {
    if (!confirm(`Chuyển "${entry.company_name}" sang Khách hàng đang hợp tác?`)) return;
    setActivating(true);
    try {
      const { error } = await supabase.from('clients').insert({
        name: entry.company_name, region: entry.region || null,
        client_type: 'active', pipeline_stage: 'won',
        won_date: new Date().toISOString().slice(0, 10),
        notes: entry.notes || null, status: 'ok',
        cutoff_day: 25, payment_start: 5, payment_end: 8,
      });
      if (error) throw error;
      await supabase.from('crm_pipeline').update({ stage: 'hop-tac' }).eq('id', entry.id);
      onUpdate({ ...entry, stage: 'hop-tac' });
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: entry.id,
        description: `Chuyển "${entry.company_name}" sang Khách hàng đang hợp tác`,
        oldData: entry, newData: { ...entry, stage: 'hop-tac' },
      });
      toast(`Đã chuyển "${entry.company_name}" sang Khách hàng!`);
      onClose?.();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    finally { setActivating(false); }
  };

  const stageInfo = STAGES.find(s => s.id === entry.stage);
  const ratingInfo = RATING_CONFIG[rating] || RATING_CONFIG.normal;
  // Công ty đã liên kết với 1 Khách hàng (gốc dữ liệu dùng chung) thì không
  // cần "Bắt đầu hợp tác" / xoá — các hành động đó chỉ dành cho công ty
  // còn ở dạng Pipeline (chưa có trong Khách hàng).
  const isLinkedToClient = !!entry.client_id;
  const showActivateButton = !isLinkedToClient && ['dam-phan', 'hop-tac', 'quan-tam'].includes(entry.stage);

  const SECTIONS: { id: Section; label: string; count?: number }[] = [
    { id: 'info',        label: 'Thông tin'                                    },
    ...(isLinkedToClient ? [{ id: 'contacts' as Section, label: 'Người liên hệ' }] : []),
    { id: 'history',     label: 'Lịch sử chăm sóc', count: pipelineTasks.filter(t => t.status !== 'done').length + workTasks.length + interactions.length },
    { id: 'gifts',       label: 'Quà tặng',         count: gifts.length         },
    { id: 'preferences', label: 'Sở thích'                                     },
  ];

  type HistoryEntry =
    | { kind: 'interaction'; date: string; data: CRMInteraction }
    | { kind: 'pipeline_task'; date: string; data: CRMPipelineTask }
    | { kind: 'work_task'; date: string; data: WorkTask };

  const historyEntries: HistoryEntry[] = [
    ...interactions.map(i => ({ kind: 'interaction' as const, date: i.created_at, data: i })),
    ...pipelineTasks.map(t => ({ kind: 'pipeline_task' as const, date: t.created_at, data: t })),
    ...workTasks.map(t => ({ kind: 'work_task' as const, date: t.created_at, data: t })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const isPendingTask = (e: HistoryEntry) => (e.kind === 'pipeline_task' || e.kind === 'work_task') && e.data.status !== 'done';
  const pendingHistoryTasks = historyEntries.filter(isPendingTask);
  const historyLog = historyEntries.filter(e => !isPendingTask(e));

  const renderHistoryEntry = (entry: HistoryEntry) => {
    if (entry.kind === 'interaction') {
      const i = entry.data;
      const t = INTERACTION_TYPES.find(x => x.id === i.interaction_type);
      return (
        <div key={`int_${i.id}`} className="flex items-start gap-3 p-3 bg-white border border-[#E8E7E2] rounded-lg">
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${t?.color || 'bg-gray-100 text-gray-600'}`}>
            {t?.icon}
            <span>{t?.label}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] text-[#222] leading-snug">{i.content}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0 text-[11px] text-[#aaa]">
            <CalendarDays size={10} />
            {i.interaction_date}
          </div>
        </div>
      );
    }
    if (entry.kind === 'pipeline_task') {
      const task = entry.data;
      const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';
      return (
        <div key={`pt_${task.id}`} className={`p-3 bg-white border rounded-lg ${isOverdue ? 'border-red-200 bg-red-50/30' : 'border-[#E8E7E2]'}`}>
          <div className="flex items-start gap-2">
            <button
              onClick={() => updateTaskStatus(task.id, task.status === 'done' ? 'pending' : task.status === 'pending' ? 'in_progress' : 'done')}
              className="mt-0.5 shrink-0"
              title="Chuyển trạng thái"
            >
              {task.status === 'done'
                ? <CheckCircle2 size={15} className="text-emerald-500" />
                : task.status === 'in_progress'
                ? <Clock size={15} className="text-amber-500" />
                : <Circle size={15} className="text-gray-300" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700 shrink-0">
                  <ClipboardList size={9} /> BD
                </span>
                <div className={`text-[12.5px] font-medium leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-[#222]'}`}>
                  {task.title}
                </div>
              </div>
              {task.description && (
                <div className="text-[11.5px] text-gray-500 mt-0.5">{task.description}</div>
              )}
              {task.due_date && (
                <div className={`flex items-center gap-1 mt-1 text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                  <CalendarDays size={10} />
                  {isOverdue ? 'Quá hạn: ' : 'Hạn: '}{task.due_date}
                </div>
              )}
              {task.status === 'done' && task.result_note && (
                <div className="text-[11.5px] text-gray-600 bg-[#F9F9F7] border border-[#F0EFEB] rounded-md px-2.5 py-1.5 mt-1.5">
                  <span className="font-medium text-[#555]">Báo cáo: </span>{task.result_note}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={task.status}
                onChange={e => updateTaskStatus(task.id, e.target.value as PipelineTaskStatus)}
                className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full border-0 focus:outline-none cursor-pointer ${
                  task.status === 'done' ? 'bg-emerald-100 text-emerald-700' :
                  task.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600'
                }`}
              >
                <option value="pending">Chưa xử lý</option>
                <option value="in_progress">Đang xử lý</option>
                <option value="done">Đã xong</option>
              </select>
              <button onClick={() => deleteTask(task.id)} className="p-0.5 text-gray-300 hover:text-red-400 transition">
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      );
    }
    // work_task — đồng bộ từ Workspace (Morning Priority)
    const t = entry.data;
    const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
    return (
      <div key={`wt_${t.id}`} className={`p-3 bg-white border rounded-lg space-y-1.5 ${isOverdue ? 'border-red-200 bg-red-50/30' : 'border-[#E8E7E2]'}`}>
        <div className="flex items-start gap-2">
          <button
            onClick={() => updateWorkTaskStatus(t.id, t.status === 'done' ? 'pending' : t.status === 'pending' ? 'in_progress' : 'done')}
            className="mt-0.5 shrink-0"
            title="Chuyển trạng thái"
          >
            {t.status === 'done'
              ? <CheckCircle2 size={15} className="text-emerald-500" />
              : t.status === 'in_progress'
              ? <Clock size={15} className="text-amber-500" />
              : <Circle size={15} className="text-gray-300" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700 shrink-0">
                <ClipboardList size={9} /> WS
              </span>
              <div className={`text-[12.5px] font-medium leading-snug ${t.status === 'done' ? 'line-through text-gray-400' : 'text-[#222]'}`}>
                {t.title}
              </div>
            </div>
            <div className={`flex items-center gap-1 mt-1 text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              <CalendarDays size={10} />
              {isOverdue ? 'Quá hạn: ' : 'Hạn: '}{formatDate(t.due_date)}
              {t.kcn ? ` · ${t.kcn}` : ''}
            </div>
            {t.status === 'done' && t.notes && (
              <div className="text-[11.5px] text-gray-600 bg-[#F9F9F7] border border-[#F0EFEB] rounded-md px-2.5 py-1.5 mt-1.5">
                <span className="font-medium text-[#555]">Báo cáo: </span>{t.notes}
              </div>
            )}
          </div>
          <span className={`text-[10.5px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${TASK_PRIORITY_COLORS[t.priority]}`}>
            {TASK_PRIORITY_LABELS[t.priority]}
          </span>
        </div>
      </div>
    );
  };

  const content = (
    <div className={variant === 'modal' ? 'bg-white w-full max-w-lg h-full flex flex-col shadow-2xl' : 'bg-white border border-[#E8E7E2] rounded-[10px] flex flex-col'} onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="bg-white border-b border-[#E8E7E2] px-5 py-4 shrink-0">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-[#111] leading-tight">{entry.company_name}</h2>
            {entry.region && (
              <div className="flex items-center gap-1 mt-1 text-[12px] text-[#888]">
                <MapPin size={11} />
                {entry.region}
              </div>
            )}
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition shrink-0">
              <X size={16} className="text-gray-500" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stageInfo && (
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${stageInfo.headerBg} ${stageInfo.headerText} ${stageInfo.border}`}>
              {stageInfo.label}
            </span>
          )}
          <button
            onClick={cycleRating}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition hover:opacity-80 ${ratingInfo.badge}`}
          >
            <span className={`w-2 h-2 rounded-full ${ratingInfo.dot}`} />
            {ratingInfo.label}
          </button>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex border-b border-[#E8E7E2] bg-[#FAFAFA] shrink-0">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex-1 py-2.5 text-[12px] font-medium transition border-b-2 ${
              activeSection === s.id
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {s.label}
            {s.count !== undefined && s.count > 0 && (
              <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-px">{s.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className={variant === 'modal' ? 'flex-1 overflow-y-auto' : 'overflow-y-auto max-h-[600px]'}>

        {/* ── Thông tin cơ bản ── */}
        {activeSection === 'info' && (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <InlineEdit
                label="Tên công ty"
                value={entry.company_name}
                onSave={v => patchEntry({ company_name: v }, `Đổi tên công ty "${entry.company_name}" thành "${v}"`)}
              />
              <InlineEdit
                label="Khu vực / KCN"
                value={entry.region || ''}
                onSave={v => patchEntry({ region: v || null }, `Cập nhật khu vực/KCN cho "${entry.company_name}"`)}
              />
              <InlineEdit
                label="Tổng Thời Vụ"
                value={String(entry.workers_seasonal ?? 0)}
                type="number"
                onSave={v => patchEntry({ workers_seasonal: parseInt(v) || 0 }, `Cập nhật tổng LĐ thời vụ cho "${entry.company_name}"`)}
              />
              <InlineEdit
                label="Tổng Chính Thức"
                value={String(entry.workers_permanent ?? 0)}
                type="number"
                onSave={v => patchEntry({ workers_permanent: parseInt(v) || 0 }, `Cập nhật tổng LĐ chính thức cho "${entry.company_name}"`)}
              />
              <div>
                <div className="text-[11px] text-[#888] font-medium mb-0.5">Đánh giá</div>
                <button
                  onClick={cycleRating}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium transition hover:opacity-80 ${ratingInfo.badge}`}
                >
                  <span className={`w-2 h-2 rounded-full ${ratingInfo.dot}`} />
                  {ratingInfo.label}
                  <span className="text-[10px] opacity-60 ml-0.5">↻</span>
                </button>
              </div>
              <div>
                <div className="text-[11px] text-[#888] font-medium mb-0.5">Liên hệ cuối</div>
                <div className="text-[12.5px] font-medium text-[#111]">
                  {entry.last_contact || '—'}
                </div>
              </div>
              {onDealOwnerChange ? (
                <InlineEdit
                  label="Người phụ trách"
                  value={dealOwner || ''}
                  onSave={v => onDealOwnerChange(v)}
                />
              ) : dealOwner !== undefined && (
                <div>
                  <div className="text-[11px] text-[#888] font-medium mb-0.5">Người phụ trách</div>
                  <div className="text-[12.5px] font-medium text-[#111]">{dealOwner || '—'}</div>
                </div>
              )}
              <div>
                <div className="text-[11px] text-[#888] font-medium mb-0.5">Người liên hệ (CSKH)</div>
                <select
                  value={entry.contact_id || ''}
                  onChange={e => {
                    const v = e.target.value || null;
                    const contact = contacts.find(c => c.id === v);
                    updateLink(
                      { contact_id: v },
                      { contact_id: v, contacts: contact ? { name: contact.name, phone: contact.phone } : null },
                      `Cập nhật người liên hệ cho "${entry.company_name}"${contact ? ` → ${contact.name}` : ''}`
                    );
                  }}
                  className="w-full text-[12.5px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                >
                  <option value="">Chưa chọn</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.role ? ` — ${c.role}` : ''}{(c as any).clients?.name ? ` (${(c as any).clients.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[11px] text-[#888] font-medium mb-0.5">Sản phẩm / Dịch vụ quan tâm</div>
                <select
                  value={entry.product_id || ''}
                  onChange={e => {
                    const v = e.target.value || null;
                    const product = products.find(p => p.id === v);
                    updateLink(
                      { product_id: v, custom_price: null },
                      { product_id: v, custom_price: null, crm_products: product ? { name: product.name, category: product.category, price: product.price } : null },
                      `Cập nhật sản phẩm/dịch vụ quan tâm cho "${entry.company_name}"${product ? ` → ${product.category || 'Khác'} — ${product.name}` : ''}`
                    );
                  }}
                  className="w-full text-[12.5px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                >
                  <option value="">Chưa chọn</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.category || 'Khác'} — {p.name}</option>)}
                </select>
                {entry.product_id && (() => {
                  const product = products.find(p => p.id === entry.product_id);
                  const standardPrice = product?.price || 0;
                  return (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[11px] text-[#888]">Giá chuẩn: {formatCurrency(standardPrice)}</span>
                      <input
                        type="number"
                        value={customPriceInput}
                        placeholder="Giá tuỳ chỉnh"
                        onChange={e => setCustomPriceInput(e.target.value)}
                        onBlur={e => {
                          const raw = e.target.value;
                          const v = raw === '' ? null : parseFloat(raw);
                          if (v === entry.custom_price) return;
                          updateLink(
                            { custom_price: v },
                            { custom_price: v },
                            `Cập nhật giá tuỳ chỉnh cho "${entry.company_name}" → ${v !== null ? formatCurrency(v) : 'dùng giá chuẩn'}`
                          );
                        }}
                        className="flex-1 text-[12.5px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                      />
                      {entry.custom_price !== null && (
                        <span className="text-[11px] font-medium text-purple-700">Đang dùng giá tuỳ chỉnh</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Worker summary bar */}
            {((entry.workers_seasonal ?? 0) + (entry.workers_permanent ?? 0)) > 0 && (
              <div className="bg-[#F9F9F7] rounded-lg p-3.5">
                <div className="text-[11.5px] font-semibold text-[#555] mb-2.5">Cơ cấu lao động</div>
                <div className="grid grid-cols-2 gap-3 text-center mb-3">
                  <div>
                    <div className="text-[20px] font-bold text-blue-600">{(entry.workers_seasonal ?? 0).toLocaleString()}</div>
                    <div className="text-[11px] text-[#888]">Thời Vụ</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-bold text-emerald-600">{(entry.workers_permanent ?? 0).toLocaleString()}</div>
                    <div className="text-[11px] text-[#888]">Chính Thức</div>
                  </div>
                </div>
                {/* Progress bar */}
                {(() => {
                  const total = (entry.workers_seasonal ?? 0) + (entry.workers_permanent ?? 0);
                  const seasonPct = total > 0 ? ((entry.workers_seasonal ?? 0) / total) * 100 : 50;
                  return (
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden flex">
                      <div className="h-full bg-blue-400 rounded-l-full" style={{ width: `${seasonPct}%` }} />
                      <div className="h-full bg-emerald-400 flex-1 rounded-r-full" />
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Ghi chú */}
            <div>
              <div className="text-[12px] font-semibold text-[#333] mb-1.5">Ghi chú nội bộ</div>
              <textarea
                defaultValue={entry.notes || ''}
                onBlur={e => patchEntry({ notes: e.target.value || null }, `Cập nhật ghi chú nội bộ cho "${entry.company_name}"`)}
                rows={3}
                placeholder="Ghi chú về công ty..."
                className="w-full text-[12.5px] px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-none"
              />
            </div>

            {/* Activate button */}
            {showActivateButton && (
              <button
                onClick={handleActivate}
                disabled={activating}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                <Rocket size={14} />
                {activating ? 'Đang xử lý...' : 'Bắt đầu hợp tác'}
              </button>
            )}

            {isAdmin && !isLinkedToClient && onDelete && (
              <button
                onClick={() => { if (confirm(`Xóa "${entry.company_name}"?`)) onDelete(); }}
                className="text-[12px] text-red-400 hover:text-red-600 transition"
              >
                Xóa công ty này
              </button>
            )}
          </div>
        )}

        {/* ── Người liên hệ (đầu mối làm việc của công ty) ── */}
        {activeSection === 'contacts' && entry.client_id && (
          <div className="p-5">
            <ContactsTab clientId={entry.client_id} toast={toast} />
          </div>
        )}

        {/* ── Lịch sử chăm sóc (Trao đổi + Việc cần xử lý + Workspace) ── */}
        {activeSection === 'history' && (
          <div className="p-5 space-y-4">
            {/* Toggle add forms */}
            <div className="flex gap-2">
              <button
                onClick={() => setHistoryForm(historyForm === 'interaction' ? null : 'interaction')}
                className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium border transition ${
                  historyForm === 'interaction' ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white border-gray-300 text-gray-500 hover:border-blue-300'
                }`}
              >
                + Trao đổi
              </button>
              <button
                onClick={() => setHistoryForm(historyForm === 'task' ? null : 'task')}
                className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium border transition ${
                  historyForm === 'task' ? 'bg-orange-100 border-orange-400 text-orange-700' : 'bg-white border-gray-300 text-gray-500 hover:border-blue-300'
                }`}
              >
                + Việc cần làm
              </button>
            </div>

            {/* Add interaction form */}
            {historyForm === 'interaction' && (
              <div className="bg-[#F9F9F7] rounded-lg p-4 space-y-3">
                <div className="text-[12px] font-semibold text-[#333]">Thêm log mới</div>
                <div className="flex gap-1.5 flex-wrap">
                  {INTERACTION_TYPES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setIntType(t.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition ${
                        intType === t.id
                          ? 'bg-blue-100 border-blue-400 text-blue-700'
                          : 'bg-white border-gray-300 text-gray-500 hover:border-blue-300'
                      }`}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={intDate}
                    onChange={e => setIntDate(e.target.value)}
                    className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                  />
                  <input
                    value={intContent}
                    onChange={e => setIntContent(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addInteraction()}
                    placeholder="Nội dung..."
                    className="col-span-2 text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={async () => { await addInteraction(); setHistoryForm(null); }}
                  disabled={addingInt || !intContent.trim()}
                  className="w-full py-1.5 bg-blue-600 text-white rounded-lg text-[12px] font-medium hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {addingInt ? 'Đang lưu...' : 'Lưu log'}
                </button>
              </div>
            )}

            {/* Add pipeline task form */}
            {historyForm === 'task' && (
              <div className="bg-[#F9F9F7] rounded-lg p-4 space-y-3">
                <div className="text-[12px] font-semibold text-[#333]">Thêm việc mới</div>
                <input
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  placeholder="Tên việc cần làm..."
                  className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={taskDesc}
                    onChange={e => setTaskDesc(e.target.value)}
                    placeholder="Mô tả chi tiết..."
                    className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                  />
                  <input
                    type="date"
                    value={taskDue}
                    onChange={e => setTaskDue(e.target.value)}
                    className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={async () => { await addTask(); setHistoryForm(null); }}
                  disabled={addingTask || !taskTitle.trim()}
                  className="w-full py-1.5 bg-orange-500 text-white rounded-lg text-[12px] font-medium hover:bg-orange-600 disabled:opacity-50 transition"
                >
                  {addingTask ? 'Đang lưu...' : 'Thêm việc'}
                </button>
              </div>
            )}

            {/* Report prompt — yêu cầu nhập nội dung kết quả trước khi đánh dấu hoàn thành */}
            {reportTarget && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                <div className="text-[12px] font-semibold text-[#333]">
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
            )}

            {/* Việc cần làm (chưa hoàn thành) */}
            {pendingHistoryTasks.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-[#999] uppercase tracking-wide px-0.5">
                  Việc cần làm ({pendingHistoryTasks.length})
                </div>
                {pendingHistoryTasks.map(renderHistoryEntry)}
              </div>
            )}

            {/* Lịch sử trao đổi & công việc đã hoàn thành */}
            <div className="space-y-2">
              {pendingHistoryTasks.length > 0 && (
                <div className="text-[11px] font-semibold text-[#999] uppercase tracking-wide px-0.5">
                  Lịch sử chăm sóc
                </div>
              )}
              {historyLog.length === 0 ? (
                <div className="text-center text-[12px] text-gray-400 py-6">Chưa có lịch sử chăm sóc</div>
              ) : historyLog.map(renderHistoryEntry)}
            </div>
          </div>
        )}

        {/* ── Quà tặng ── */}
        {activeSection === 'gifts' && (
          <div className="p-5 space-y-4">
            {/* Add form */}
            <div className="bg-[#F9F9F7] rounded-lg p-4 space-y-3">
              <div className="text-[12px] font-semibold text-[#333]">Thêm quà mới</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="date"
                  value={giftDate}
                  onChange={e => setGiftDate(e.target.value)}
                  className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                />
                <input
                  value={giftItem}
                  onChange={e => setGiftItem(e.target.value)}
                  placeholder="Tên quà..."
                  className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                />
                <input
                  value={giftValue}
                  onChange={e => setGiftValue(e.target.value)}
                  placeholder="Giá trị (VD: 500k)"
                  className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                />
              </div>
              <select
                value={giftRecipientId}
                onChange={e => setGiftRecipientId(e.target.value)}
                className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
              >
                <option value="">Gửi cho ai? (chọn người liên hệ)</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ''}{!c.is_active ? ' (đã nghỉ)' : ''}</option>
                ))}
              </select>
              <button
                onClick={addGift}
                disabled={addingGift || !giftItem.trim()}
                className="w-full py-1.5 bg-emerald-600 text-white rounded-lg text-[12px] font-medium hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {addingGift ? 'Đang lưu...' : 'Lưu quà tặng'}
              </button>
            </div>

            {/* Gifts list */}
            <div className="space-y-2">
              {gifts.length === 0 ? (
                <div className="text-center text-[12px] text-gray-400 py-6">Chưa có quà tặng</div>
              ) : gifts.map(g => editingGiftId === g.id ? (
                <div key={g.id} className="bg-[#F9F9F7] rounded-lg p-3 space-y-2 border border-blue-200">
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="date"
                      value={editGiftDate}
                      onChange={e => setEditGiftDate(e.target.value)}
                      className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                    />
                    <input
                      value={editGiftItem}
                      onChange={e => setEditGiftItem(e.target.value)}
                      placeholder="Tên quà..."
                      className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                    />
                    <input
                      value={editGiftValue}
                      onChange={e => setEditGiftValue(e.target.value)}
                      placeholder="Giá trị (VD: 500k)"
                      className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                    />
                  </div>
                  <select
                    value={editGiftRecipientId}
                    onChange={e => setEditGiftRecipientId(e.target.value)}
                    className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                  >
                    <option value="">Gửi cho ai? (chọn người liên hệ)</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ''}{!c.is_active ? ' (đã nghỉ)' : ''}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={cancelEditGift} className="flex-1 py-1.5 border border-gray-300 text-gray-500 rounded-lg text-[12px] font-medium hover:bg-gray-50 transition">Huỷ</button>
                    <button onClick={() => saveEditGift(g)} disabled={savingGift} className="flex-1 py-1.5 bg-emerald-600 text-white rounded-lg text-[12px] font-medium hover:bg-emerald-700 disabled:opacity-50 transition">
                      {savingGift ? 'Đang lưu...' : 'Lưu thay đổi'}
                    </button>
                  </div>
                </div>
              ) : (
                <div key={g.id} className="flex items-center gap-3 p-3 bg-white border border-[#E8E7E2] rounded-lg">
                  <Gift size={14} className="text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-[#222]">{g.item_name}</div>
                    {g.recipient_name && (
                      <div className="text-[11px] text-[#888]">Gửi: {g.recipient_name}</div>
                    )}
                  </div>
                  {g.value && (
                    <span className="text-[12px] font-semibold text-emerald-600 shrink-0">{g.value}</span>
                  )}
                  <div className="flex items-center gap-1 shrink-0 text-[11px] text-[#aaa]">
                    <CalendarDays size={10} />
                    {g.gift_date}
                  </div>
                  <button onClick={() => startEditGift(g)} className="shrink-0 p-1 text-gray-400 hover:text-blue-600 transition">
                    <Pencil size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Sở thích / Lưu ý ── */}
        {activeSection === 'preferences' && (            <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-[12px] text-gray-500">
              <Star size={13} className="text-amber-400" />
              Ghi lại sở thích, thói quen, lưu ý khi tiếp cận nhân vật chủ chốt
            </div>
            <div>
              <div className="text-[12px] font-semibold text-[#333] mb-1.5">Sở thích & Lưu ý tiếp cận</div>
              <textarea
                value={prefs}
                onChange={e => setPrefs(e.target.value)}
                rows={8}
                placeholder={`VD:\n• Thích gặp buổi sáng sớm\n• Ưa chuộng quà là đặc sản địa phương\n• Không gọi điện sau 5pm\n• Kỵ nói về đối thủ X`}
                className="w-full text-[12.5px] px-3 py-2.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-none leading-relaxed"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={savePrefs}
                disabled={savingPrefs}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[12.5px] font-medium hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {savingPrefs ? 'Đang lưu...' : 'Lưu'}
              </button>
              <button
                onClick={() => setPrefs(entry.preferences || '')}
                className="px-4 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-600 hover:bg-gray-50 transition"
              >
                Hủy
              </button>
            </div>

            {/* Contact preferences quick-tags */}
            <div>
              <div className="text-[11.5px] font-semibold text-[#888] mb-2">Gợi ý nhanh</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Thích gặp buổi sáng', 'Ưa quà tặng thực phẩm', 'Không gọi cuối tuần',
                  'Liên hệ qua Zalo', 'Thích được mời ăn', 'Ra quyết định nhanh',
                  'Cần xin ý kiến BGĐ', 'Thích báo cáo số liệu rõ ràng',
                ].map(tag => (
                  <button
                    key={tag}
                    onClick={() => setPrefs(p => p ? `${p}\n• ${tag}` : `• ${tag}`)}
                    className="text-[11px] px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full hover:bg-amber-100 transition"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer: contact quick actions */}
      <div className="border-t border-[#E8E7E2] px-5 py-3 flex items-center gap-2 shrink-0 bg-[#FAFAFA]">
        <UserCheck size={13} className="text-gray-400" />
        <span className="text-[11.5px] text-gray-500 flex-1">
          Tạo: {new Date(entry.created_at).toLocaleDateString('vi-VN')}
        </span>
        <button
          onClick={() => { setActiveSection('history'); setHistoryForm('interaction'); setIntType('call'); }}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg text-[11.5px] font-medium hover:bg-green-200 transition"
        >
          <Phone size={11} /> Log cuộc gọi
        </button>
        <button
          onClick={() => { setActiveSection('history'); setHistoryForm('interaction'); setIntType('meeting'); }}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-[11.5px] font-medium hover:bg-blue-200 transition"
        >
          <Users size={11} /> Log gặp mặt
        </button>
        <button
          onClick={() => { setActiveSection('history'); setHistoryForm('task'); }}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-[11.5px] font-medium hover:bg-orange-200 transition"
        >
          <ClipboardList size={11} /> Thêm việc
        </button>
      </div>
    </div>
  );

  if (variant === 'panel') return content;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-50" onClick={onClose}>
      {content}
    </div>
  );
}
