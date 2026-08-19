import { useState, useEffect, useCallback } from 'react';
import {
  X, Phone, Users, Mail, MessageSquare, Gift,
  Rocket, Star, MapPin, UserCheck, CalendarDays, Pencil, Check,
  ClipboardList, Circle, Clock, CheckCircle2, StickyNote, Send,
  ChevronDown, ChevronUp, GitCompare,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/format';
import type { CRMPipelineEntry, CRMInteraction, CRMGift, CRMPipelineTask, PipelineTaskStatus, CRMProduct, Contact, WorkTask, TaskStatus, PipelineAppendix, ClientGift } from '../../lib/types';
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { queueGoogleSync } from '../../lib/googleSync';
import { logActivity } from '../../lib/audit';
import ContactsTab from '../ContactsTab';
import { KpiTile, SectionCard, QuickNav, useSectionState } from '../ui/PanelKit';

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
  { id: 'note',    label: 'Ghi chú',  icon: <StickyNote size={12} />,   color: 'bg-yellow-100 text-yellow-700'},
];

export type Section = 'info' | 'contacts' | 'history' | 'gifts' | 'preferences';

/** Các khối của biến thể 'panel' — hiển thị inline trong trang Khách hàng. */
export type PanelSection = 'profile' | 'history' | 'contacts' | 'appendix' | 'notes' | 'gifts' | 'prefs';

const PANEL_NAV: { key: PanelSection; label: string; icon: string }[] = [
  { key: 'profile',  label: 'Hồ sơ công ty',    icon: '🏢' },
  { key: 'history',  label: 'Lịch sử chăm sóc', icon: '📞' },
  { key: 'contacts', label: 'Người liên hệ',    icon: '👥' },
  { key: 'notes',    label: 'Ghi chú nội bộ',   icon: '📝' },
  { key: 'gifts',    label: 'Quà tặng',         icon: '🎁' },
  { key: 'appendix', label: 'Phụ lục',          icon: '📑' },
  { key: 'prefs',    label: 'Sở thích',         icon: '⭐' },
];

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
  /**
   * Quà tặng ghi ở bảng cũ `client_gifts` (trước đây nhập tại tab "Chi tiết
   * thương vụ" của trang Khách hàng). Hiển thị dạng chỉ xem bên dưới danh
   * sách quà chính để dữ liệu đã nhập không bị mất dấu.
   */
  legacyGifts?: ClientGift[];
  /**
   * Thương vụ CRM gắn với công ty này — chỉ hiện tóm tắt + lối tắt sang CRM
   * Pipeline (nơi chỉnh giai đoạn, giá trị, sản phẩm của thương vụ).
   */
  dealSummary?: { title: string; value: number; onOpen?: () => void };
}

export function CompanyProfileModal({ entry, contacts, products, onClose, onUpdate, onDelete, toast, isAdmin, variant = 'modal', dealOwner, onDealOwnerChange, legacyGifts, dealSummary }: CompanyProfileModalProps) {
  const { user, token } = useAuth();
  const [interactions, setInteractions] = useState<CRMInteraction[]>([]);
  const [gifts, setGifts] = useState<CRMGift[]>([]);
  const [pipelineTasks, setPipelineTasks] = useState<CRMPipelineTask[]>([]);
  const [workTasks, setWorkTasks] = useState<WorkTask[]>([]);
  const [activeSection, setActiveSection] = useState<Section>('info');
  // Biến thể 'panel' (trang Khách hàng) không dùng tab lồng tab — thay bằng
  // các thẻ gập/mở + thanh "Đi tới", nhớ trạng thái theo trình duyệt.
  const { sections, toggle, goto } = useSectionState<PanelSection>(
    { profile: true, history: true, contacts: false, appendix: false, notes: true, gifts: false, prefs: false },
    'company-profile-sections-v1',
    'cp',
  );
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

  // Internal note thread
  const [noteInput, setNoteInput] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Phụ lục versioning
  const [appendices, setAppendices] = useState<PipelineAppendix[]>([]);
  const [showNewPL, setShowNewPL] = useState(false);
  const [newPLContent, setNewPLContent] = useState('');
  const [addingPL, setAddingPL] = useState(false);
  const [expandedPL, setExpandedPL] = useState<string | null>(null);
  const [diffPL, setDiffPL] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    const [ir, gr, tr, ar] = await Promise.all([
      supabase.from('crm_interactions').select('*').eq('crm_id', entry.id).order('interaction_date', { ascending: false }),
      supabase.from('crm_gifts').select('*').eq('crm_id', entry.id).order('gift_date', { ascending: false }),
      supabase.from('crm_pipeline_tasks').select('*').eq('crm_id', entry.id).order('created_at', { ascending: false }),
      supabase.from('pipeline_appendices').select('*').eq('crm_id', entry.id).order('created_at', { ascending: true }),
    ]);
    if (!ir.error) setInteractions(ir.data as CRMInteraction[]);
    if (!gr.error) setGifts(gr.data as CRMGift[]);
    if (!tr.error) setPipelineTasks(tr.data as CRMPipelineTask[]);
    if (!ar.error) setAppendices(ar.data as PipelineAppendix[]);

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

  const addNote = async () => {
    if (!noteInput.trim()) return;
    setAddingNote(true);
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('crm_interactions').insert({
      crm_id: entry.id, interaction_type: 'note',
      content: noteInput.trim(), interaction_date: today,
    });
    setAddingNote(false);
    if (!error) { setNoteInput(''); loadDetails(); }
    else toast('Lỗi: ' + error.message);
  };

  const addAppendix = async () => {
    if (!newPLContent.trim()) return;
    setAddingPL(true);
    const nextNum = appendices.length + 1;
    const label = `PL - Lần ${nextNum}`;
    const { data, error } = await supabase.from('pipeline_appendices').insert({
      crm_id: entry.id,
      version_label: label,
      content: newPLContent.trim(),
      created_by: (user as any)?.full_name || (user as any)?.email || null,
    }).select().single();
    setAddingPL(false);
    if (!error && data) {
      setAppendices(prev => [...prev, data as PipelineAppendix]);
      setNewPLContent('');
      setShowNewPL(false);
      setExpandedPL((data as PipelineAppendix).id);
      toast('Đã tạo ' + label);
    } else toast('Lỗi: ' + (error?.message || 'unknown'));
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
    queueGoogleSync(token);
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
      queueGoogleSync(token);
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
    ...interactions.filter(i => i.interaction_type !== 'note').map(i => ({ kind: 'interaction' as const, date: i.created_at, data: i })),
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

  /* ═══ Các khối nội dung — dùng chung cho cả biến thể modal và panel ═══ */

  const blkBasicInfo = (
    <>
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
    </>
  );

  const blkWorkerBar = (
    <>
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
    </>
  );

  const blkNotes = (
    <>
      {/* Ghi chú nội bộ — comment thread */}
      <div>
        <div className="text-[12px] font-semibold text-[#333] mb-2">Ghi chú nội bộ</div>
        {/* Comment list */}
        {interactions.filter(i => i.interaction_type === 'note').length > 0 ? (
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto pr-0.5">
            {interactions
              .filter(i => i.interaction_type === 'note')
              .slice()
              .reverse()
              .map(i => (
                <div key={i.id} className="flex gap-2 items-start">
                  <div className="w-6 h-6 rounded-full bg-yellow-100 flex items-center justify-center shrink-0 mt-0.5">
                    <StickyNote size={11} className="text-yellow-600" />
                  </div>
                  <div className="flex-1 bg-[#FAFAF8] border border-[#E8E7E2] rounded-lg px-3 py-2">
                    <div className="text-[12.5px] text-[#222] leading-relaxed whitespace-pre-wrap">{i.content}</div>
                    <div className="text-[10.5px] text-[#aaa] mt-1">{formatDate(i.interaction_date)}</div>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="text-[12px] text-[#aaa] italic mb-3">Chưa có ghi chú nào.</div>
        )}
        {/* Input row */}
        <div className="flex gap-2 items-end">
          <textarea
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } }}
            rows={2}
            placeholder="Viết ghi chú... (Enter để gửi, Shift+Enter xuống dòng)"
            className="flex-1 text-[12.5px] px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-none"
          />
          <button
            onClick={addNote}
            disabled={addingNote || !noteInput.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-[12px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition shrink-0"
          >
            <Send size={13} />
            Gửi
          </button>
        </div>
      </div>
    </>
  );

  const blkAppendix = (
    <>
      {/* Phụ lục versioning */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-semibold text-[#333]">Phụ lục hợp đồng</div>
          <button
            onClick={() => { setShowNewPL(v => !v); setNewPLContent(''); }}
            className="text-[11.5px] font-medium text-blue-600 hover:text-blue-800 transition"
          >
            {showNewPL ? 'Đóng' : '+ Tạo PL mới'}
          </button>
        </div>

        {/* New PL form */}
        {showNewPL && (
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
            <div className="text-[11.5px] font-semibold text-blue-700">
              {appendices.length === 0 ? 'PL - Lần 1' : `PL - Lần ${appendices.length + 1}`}
            </div>
            <textarea
              autoFocus
              value={newPLContent}
              onChange={e => setNewPLContent(e.target.value)}
              rows={4}
              placeholder="Nội dung phụ lục..."
              className="w-full text-[12.5px] px-3 py-2 border border-blue-300 rounded-lg outline-none focus:border-blue-500 resize-none bg-white"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShowNewPL(false); setNewPLContent(''); }} className="flex-1 py-1.5 text-[12px] font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition">Hủy</button>
              <button onClick={addAppendix} disabled={addingPL || !newPLContent.trim()} className="flex-1 py-1.5 text-[12px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
                {addingPL ? 'Đang lưu...' : 'Lưu phụ lục'}
              </button>
            </div>
          </div>
        )}

        {/* PL list */}
        {appendices.length === 0 && !showNewPL ? (
          <div className="text-[12px] text-[#aaa] italic">Chưa có phụ lục nào.</div>
        ) : (
          <div className="space-y-2">
            {[...appendices].reverse().map((pl, revIdx) => {
              const origIdx = appendices.length - 1 - revIdx;
              const prevPL = origIdx > 0 ? appendices[origIdx - 1] : null;
              const isExpanded = expandedPL === pl.id;
              const isDiff = diffPL === pl.id;
              return (
                <div key={pl.id} className="border border-[#E8E7E2] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedPL(isExpanded ? null : pl.id)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-[#FAFAF8] hover:bg-gray-100 transition text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-[#333]">{pl.version_label}</span>
                      {pl.created_by && <span className="text-[11px] text-[#aaa]">— {pl.created_by}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#bbb]">{formatDate(pl.created_at.split('T')[0])}</span>
                      {isExpanded ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-3 py-3 border-t border-[#E8E7E2]">
                      {prevPL && (
                        <button
                          onClick={() => setDiffPL(isDiff ? null : pl.id)}
                          className="flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-800 mb-2 transition"
                        >
                          <GitCompare size={12} />
                          {isDiff ? 'Ẩn so sánh' : `So sánh với ${prevPL.version_label}`}
                        </button>
                      )}
                      {isDiff && prevPL ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-[10.5px] font-semibold text-gray-500 mb-1">{prevPL.version_label}</div>
                            <pre className="text-[11.5px] text-[#555] whitespace-pre-wrap font-sans leading-relaxed bg-red-50 border border-red-100 rounded p-2">{prevPL.content}</pre>
                          </div>
                          <div>
                            <div className="text-[10.5px] font-semibold text-gray-500 mb-1">{pl.version_label} (mới)</div>
                            <pre className="text-[11.5px] text-[#222] whitespace-pre-wrap font-sans leading-relaxed bg-green-50 border border-green-100 rounded p-2">{pl.content}</pre>
                          </div>
                        </div>
                      ) : (
                        <pre className="text-[12.5px] text-[#222] whitespace-pre-wrap font-sans leading-relaxed">{pl.content}</pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  const blkActivate = (
    <>
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
    </>
  );

  const blkContacts = entry.client_id ? (
    <ContactsTab clientId={entry.client_id} toast={toast} />
  ) : null;

  const blkHistory = (
    <>
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
    </>
  );

  const blkGifts = (
    <>
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
      {/* Quà tặng ghi ở bảng cũ (client_gifts) — chỉ xem, không sửa tại đây */}
      {legacyGifts && legacyGifts.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-[#999] uppercase tracking-wide mb-1.5">
            Ghi nhận từ trang Khách hàng trước đây ({legacyGifts.length})
          </div>
          <div className="space-y-2">
            {legacyGifts.map(g => (
              <div key={g.id} className="flex items-center gap-3 p-3 bg-[#FAFAF8] border border-dashed border-[#E0DED7] rounded-lg">
                <Gift size={14} className="text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium text-[#444]">{g.item_name}</div>
                  {g.recipient_name && <div className="text-[11px] text-[#999]">Gửi: {g.recipient_name}</div>}
                  {g.notes && <div className="text-[11px] text-[#999]">{g.notes}</div>}
                </div>
                {g.value != null && (
                  <span className="text-[12px] font-semibold text-[#777] shrink-0">{formatCurrency(g.value)}</span>
                )}
                <div className="flex items-center gap-1 shrink-0 text-[11px] text-[#bbb]">
                  <CalendarDays size={10} />
                  {formatDate(g.gift_date)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const blkPrefs = (
    <>
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
    </>
  );

  /* ═══ Biến thể 'modal' — bảng trượt từ phải, giữ nguyên bố cục cũ ═══ */
  const modalContent = (
    <div className="bg-white w-full max-w-lg h-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
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
      <div className="flex-1 overflow-y-auto">
        {activeSection === 'info' && (
          <div className="p-5 space-y-5">
            {blkBasicInfo}
            {blkWorkerBar}
            {blkNotes}
            {blkAppendix}
            {blkActivate}
          </div>
        )}
        {activeSection === 'contacts' && blkContacts && <div className="p-5">{blkContacts}</div>}
        {activeSection === 'history' && <div className="p-5 space-y-4">{blkHistory}</div>}
        {activeSection === 'gifts' && <div className="p-5 space-y-4">{blkGifts}</div>}
        {activeSection === 'preferences' && <div className="p-5 space-y-4">{blkPrefs}</div>}
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

  if (variant !== 'panel') {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-50" onClick={onClose}>
        {modalContent}
      </div>
    );
  }

  /* ═══ Biến thể 'panel' — hiển thị inline trong trang Khách hàng ═══
     Bố cục giống tab Tổng quan: dải chỉ số → thanh "Đi tới" → 2 cột thẻ.
     Không dùng tab lồng trong tab và không có vùng cuộn riêng bên trong. */
  const navItems = PANEL_NAV.filter(n => n.key !== 'contacts' || !!entry.client_id);
  const totalWorkers = (entry.workers_seasonal ?? 0) + (entry.workers_permanent ?? 0);
  const giftCount = gifts.length + (legacyGifts?.length ?? 0);
  const logQuick = (kind: 'call' | 'meeting') => {
    setHistoryForm('interaction');
    setIntType(kind);
    goto('history');
  };

  return (
    <div className="max-w-[1500px] mx-auto">

      {/* ── Thanh trạng thái & hành động nhanh ── */}
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {stageInfo && (
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${stageInfo.headerBg} ${stageInfo.headerText} ${stageInfo.border}`}>
              {stageInfo.label}
            </span>
          )}
          <button
            onClick={cycleRating}
            title="Bấm để đổi mức đánh giá"
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition hover:opacity-80 ${ratingInfo.badge}`}
          >
            <span className={`w-2 h-2 rounded-full ${ratingInfo.dot}`} />
            {ratingInfo.label}
            <span className="text-[10px] opacity-60">↻</span>
          </button>
          <span className="text-[11.5px] text-[#999] inline-flex items-center gap-1">
            <UserCheck size={12} /> Hồ sơ tạo {new Date(entry.created_at).toLocaleDateString('vi-VN')}
          </span>
          {dealSummary && (
            <span className="text-[11.5px] text-[#666] inline-flex items-center gap-1.5">
              <span className="text-[#bbb]">·</span>
              Thương vụ: <span className="font-medium text-[#111]">{dealSummary.title}</span>
              <span className="font-semibold text-blue-600">{formatCurrency(dealSummary.value)}</span>
              {dealSummary.onOpen && (
                <button onClick={dealSummary.onOpen} className="text-blue-600 hover:underline">Mở trong CRM Pipeline →</button>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => logQuick('call')} className="flex items-center gap-1 px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg text-[11.5px] font-medium hover:bg-green-200 transition">
            <Phone size={11} /> Log cuộc gọi
          </button>
          <button onClick={() => logQuick('meeting')} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-[11.5px] font-medium hover:bg-blue-200 transition">
            <Users size={11} /> Log gặp mặt
          </button>
          <button onClick={() => { setHistoryForm('task'); goto('history'); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-[11.5px] font-medium hover:bg-orange-200 transition">
            <ClipboardList size={11} /> Thêm việc
          </button>
        </div>
      </div>

      {/* ── Dải chỉ số ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3">
        <KpiTile
          label="Việc cần làm"
          value={String(pendingHistoryTasks.length)}
          sub={pendingHistoryTasks.length ? 'đang chờ xử lý' : 'không còn việc tồn'}
          valueColor={pendingHistoryTasks.length ? '#D97706' : '#059669'}
          tone={pendingHistoryTasks.length ? 'warn' : 'good'}
          onClick={() => goto('history')}
        />
        <KpiTile
          label="Lượt chăm sóc"
          value={String(interactions.filter(i => i.interaction_type !== 'note').length)}
          sub={entry.last_contact ? `Gần nhất: ${entry.last_contact}` : 'Chưa có lượt nào'}
          onClick={() => goto('history')}
        />
        <KpiTile
          label="Quà tặng"
          value={String(giftCount)}
          sub={giftCount ? 'lần đã tặng' : 'chưa ghi nhận'}
          onClick={() => goto('gifts')}
        />
        <KpiTile
          label="Lao động đang dùng"
          value={totalWorkers.toLocaleString()}
          sub={`Thời vụ ${(entry.workers_seasonal ?? 0).toLocaleString()} · Chính thức ${(entry.workers_permanent ?? 0).toLocaleString()}`}
          onClick={() => goto('profile')}
        />
      </div>

      {/* ── Thanh điều hướng nhanh ── */}
      <div className="mt-3">
        <QuickNav items={navItems} onGo={goto} />
      </div>

      {/* ── 2 cột: trái = quan hệ & hoạt động, phải = hồ sơ & ghi chú ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start mt-3">
        <div className="xl:col-span-8 space-y-4">

          <SectionCard id="cp-profile" icon="🏢" title="Hồ sơ công ty"
            open={sections.profile} onToggle={() => toggle('profile')}>
            <div className="space-y-5">
              {blkBasicInfo}
              {blkWorkerBar}
            </div>
          </SectionCard>

          <SectionCard id="cp-history" icon="📞" title="Lịch sử chăm sóc"
            badge={pendingHistoryTasks.length ? `${pendingHistoryTasks.length} việc cần làm` : undefined}
            open={sections.history} onToggle={() => toggle('history')}>
            <div className="space-y-4">{blkHistory}</div>
          </SectionCard>

          {blkContacts && (
            <SectionCard id="cp-contacts" icon="👥" title="Người liên hệ"
              badge={`${contacts.length} đầu mối`}
              open={sections.contacts} onToggle={() => toggle('contacts')}>
              {blkContacts}
            </SectionCard>
          )}

          <SectionCard id="cp-appendix" icon="📑" title="Phụ lục hợp đồng"
            badge={appendices.length ? `${appendices.length} bản` : undefined}
            open={sections.appendix} onToggle={() => toggle('appendix')}>
            {blkAppendix}
          </SectionCard>
        </div>

        <div className="xl:col-span-4 space-y-4">

          <SectionCard id="cp-notes" icon="📝" title="Ghi chú nội bộ"
            badge={`${interactions.filter(i => i.interaction_type === 'note').length}`}
            open={sections.notes} onToggle={() => toggle('notes')}>
            {blkNotes}
          </SectionCard>

          <SectionCard id="cp-gifts" icon="🎁" title="Quà tặng"
            badge={giftCount ? `${giftCount}` : undefined}
            open={sections.gifts} onToggle={() => toggle('gifts')}>
            <div className="space-y-4">{blkGifts}</div>
          </SectionCard>

          <SectionCard id="cp-prefs" icon="⭐" title="Sở thích & lưu ý"
            open={sections.prefs} onToggle={() => toggle('prefs')}>
            <div className="space-y-4">{blkPrefs}</div>
          </SectionCard>

          {(showActivateButton || (isAdmin && !isLinkedToClient && onDelete)) && (
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-3">
              {blkActivate}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
