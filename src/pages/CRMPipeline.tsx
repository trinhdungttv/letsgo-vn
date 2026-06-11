import { useState, useEffect, useCallback } from 'react';
import {
  Plus, X, Phone, Users, Mail, MessageSquare, Gift,
  Rocket, Star, MapPin, UserCheck, CalendarDays, Pencil, Check,
  ClipboardList, Circle, Clock, CheckCircle2,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { CRMPipelineEntry, CRMInteraction, CRMGift, CRMPipelineTask, PipelineTaskStatus } from '../lib/types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';

interface CRMPipelineProps {
  pipeline: CRMPipelineEntry[];
  onRefresh: () => Promise<void>;
  toast: (msg: string) => void;
}

const STAGES = [
  { id: 'tiem-nang',  label: 'Tiềm năng',    headerBg: 'bg-blue-50',    headerText: 'text-blue-700',    border: 'border-blue-200'   },
  { id: 'dang-lh',    label: 'Đang liên hệ', headerBg: 'bg-amber-50',   headerText: 'text-amber-700',   border: 'border-amber-200'  },
  { id: 'quan-tam',   label: 'Quan tâm/Chờ', headerBg: 'bg-emerald-50', headerText: 'text-emerald-700', border: 'border-emerald-200'},
  { id: 'dam-phan',   label: 'Đàm phán HĐ',  headerBg: 'bg-violet-50',  headerText: 'text-violet-700',  border: 'border-violet-200' },
  { id: 'hop-tac',    label: 'Đang HT',       headerBg: 'bg-teal-50',    headerText: 'text-teal-700',    border: 'border-teal-200'   },
];

const RATING_CONFIG: Record<string, { dot: string; label: string; badge: string }> = {
  hot:    { dot: 'bg-red-500',   label: 'Tiềm năng cao', badge: 'bg-red-100 text-red-700 border-red-200'      },
  normal: { dot: 'bg-amber-400', label: 'Bình thường',   badge: 'bg-amber-100 text-amber-700 border-amber-200'},
  low:    { dot: 'bg-gray-400',  label: 'Thấp',          badge: 'bg-gray-100 text-gray-600 border-gray-200'   },
};

const INTERACTION_TYPES = [
  { id: 'call',    label: 'Gọi điện', icon: <Phone size={12} />,        color: 'bg-green-100 text-green-700'  },
  { id: 'meeting', label: 'Gặp mặt', icon: <Users size={12} />,        color: 'bg-blue-100 text-blue-700'    },
  { id: 'email',   label: 'Email',    icon: <Mail size={12} />,         color: 'bg-violet-100 text-violet-700'},
  { id: 'zalo',    label: 'Zalo',     icon: <MessageSquare size={12} />, color: 'bg-teal-100 text-teal-700'   },
];

type Section = 'info' | 'interactions' | 'gifts' | 'preferences' | 'tasks';

// ── Inline editable field ────────────────────────────────────────────────────
function InlineEdit({ label, value, onSave, type = 'text' }: {
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

// ── Profile Modal ────────────────────────────────────────────────────────────
interface ProfileModalProps {
  entry: CRMPipelineEntry;
  onClose: () => void;
  onUpdate: (updated: CRMPipelineEntry) => void;
  onDelete: () => void;
  toast: (msg: string) => void;
  isAdmin: boolean;
}

function ProfileModal({ entry, onClose, onUpdate, onDelete, toast, isAdmin }: ProfileModalProps) {
  const { user } = useAuth();
  const [interactions, setInteractions] = useState<CRMInteraction[]>([]);
  const [gifts, setGifts] = useState<CRMGift[]>([]);
  const [pipelineTasks, setPipelineTasks] = useState<CRMPipelineTask[]>([]);
  const [activeSection, setActiveSection] = useState<Section>('info');

  // Info section state
  const [rating, setRating] = useState(entry.rating || 'normal');

  // Interaction form
  const [intType, setIntType] = useState('call');
  const [intContent, setIntContent] = useState('');
  const [intDate, setIntDate] = useState(new Date().toISOString().split('T')[0]);
  const [addingInt, setAddingInt] = useState(false);

  // Gift form
  const [giftItem, setGiftItem] = useState('');
  const [giftValue, setGiftValue] = useState('');
  const [giftDate, setGiftDate] = useState(new Date().toISOString().split('T')[0]);
  const [addingGift, setAddingGift] = useState(false);

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
  }, [entry.id]);

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
    setAddingGift(true);
    const { data, error } = await supabase.from('crm_gifts').insert({
      crm_id: entry.id, item_name: giftItem.trim(),
      value: giftValue.trim() || null, gift_date: giftDate,
    }).select().single();
    setAddingGift(false);
    if (!error) {
      setGiftItem(''); setGiftValue('');
      setGiftDate(new Date().toISOString().split('T')[0]);
      loadDetails();
      toast('Đã ghi nhận quà tặng');
      await logActivity({
        user, action: 'insert', table: 'crm_gifts', recordId: data.id,
        description: `Thêm quà tặng "${data.item_name}" cho "${entry.company_name}"`,
        newData: data,
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
      onClose();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    finally { setActivating(false); }
  };

  const stageInfo = STAGES.find(s => s.id === entry.stage);
  const ratingInfo = RATING_CONFIG[rating] || RATING_CONFIG.normal;
  const showActivateButton = ['dam-phan', 'hop-tac', 'quan-tam'].includes(entry.stage);

  const SECTIONS: { id: Section; label: string; count?: number }[] = [
    { id: 'info',         label: 'Thông tin'                                    },
    { id: 'tasks',        label: 'Việc cần xử lý', count: pipelineTasks.filter(t => t.status !== 'done').length },
    { id: 'interactions', label: 'Trao đổi',        count: interactions.length  },
    { id: 'gifts',        label: 'Quà tặng',        count: gifts.length         },
    { id: 'preferences',  label: 'Sở thích'                                     },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full max-w-lg h-full flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
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
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition shrink-0">
              <X size={16} className="text-gray-500" />
            </button>
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

              {isAdmin && (
                <button
                  onClick={() => { if (confirm(`Xóa "${entry.company_name}"?`)) onDelete(); }}
                  className="text-[12px] text-red-400 hover:text-red-600 transition"
                >
                  Xóa công ty này
                </button>
              )}
            </div>
          )}

          {/* ── Lịch sử trao đổi ── */}
          {activeSection === 'interactions' && (
            <div className="p-5 space-y-4">
              {/* Add form */}
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
                  onClick={addInteraction}
                  disabled={addingInt || !intContent.trim()}
                  className="w-full py-1.5 bg-blue-600 text-white rounded-lg text-[12px] font-medium hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {addingInt ? 'Đang lưu...' : 'Lưu log'}
                </button>
              </div>

              {/* Log list */}
              <div className="space-y-2">
                {interactions.length === 0 ? (
                  <div className="text-center text-[12px] text-gray-400 py-6">Chưa có lịch sử trao đổi</div>
                ) : interactions.map(i => {
                  const t = INTERACTION_TYPES.find(x => x.id === i.interaction_type);
                  return (
                    <div key={i.id} className="flex items-start gap-3 p-3 bg-white border border-[#E8E7E2] rounded-lg">
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
                })}
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
                ) : gifts.map(g => (
                  <div key={g.id} className="flex items-center gap-3 p-3 bg-white border border-[#E8E7E2] rounded-lg">
                    <Gift size={14} className="text-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium text-[#222]">{g.item_name}</div>
                    </div>
                    {g.value && (
                      <span className="text-[12px] font-semibold text-emerald-600 shrink-0">{g.value}</span>
                    )}
                    <div className="flex items-center gap-1 shrink-0 text-[11px] text-[#aaa]">
                      <CalendarDays size={10} />
                      {g.gift_date}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Việc cần xử lý ── */}
          {activeSection === 'tasks' && (
            <div className="p-5 space-y-4">
              {/* Add form */}
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
                  onClick={addTask}
                  disabled={addingTask || !taskTitle.trim()}
                  className="w-full py-1.5 bg-orange-500 text-white rounded-lg text-[12px] font-medium hover:bg-orange-600 disabled:opacity-50 transition"
                >
                  {addingTask ? 'Đang lưu...' : 'Thêm việc'}
                </button>
              </div>

              {/* Tasks list */}
              <div className="space-y-2">
                {pipelineTasks.length === 0 ? (
                  <div className="text-center text-[12px] text-gray-400 py-6">Chưa có việc cần xử lý</div>
                ) : pipelineTasks.map(task => {
                  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';
                  return (
                    <div key={task.id} className={`p-3 bg-white border rounded-lg ${isOverdue ? 'border-red-200 bg-red-50/30' : 'border-[#E8E7E2]'}`}>
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
                          <div className={`text-[12.5px] font-medium leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-[#222]'}`}>
                            {task.title}
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
                })}
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
            onClick={() => { setActiveSection('interactions'); setIntType('call'); }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg text-[11.5px] font-medium hover:bg-green-200 transition"
          >
            <Phone size={11} /> Log cuộc gọi
          </button>
          <button
            onClick={() => { setActiveSection('interactions'); setIntType('meeting'); }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-[11.5px] font-medium hover:bg-blue-200 transition"
          >
            <Users size={11} /> Log gặp mặt
          </button>
          <button
            onClick={() => setActiveSection('tasks')}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-[11.5px] font-medium hover:bg-orange-200 transition"
          >
            <ClipboardList size={11} /> Thêm việc
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main CRMPipeline ────────────────────────────────────────────────────────
export default function CRMPipeline({ pipeline, onRefresh, toast }: CRMPipelineProps) {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [profileEntry, setProfileEntry] = useState<CRMPipelineEntry | null>(null);
  const [modalForm, setModalForm] = useState({ name: '', region: '', estimate: '', rating: 'normal' });
  const [localPipeline, setLocalPipeline] = useState(pipeline);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => { setLocalPipeline(pipeline); }, [pipeline]);

  const handleAdd = async () => {
    if (!modalForm.name) { toast('Nhập tên công ty'); return; }
    try {
      const { data, error } = await supabase.from('crm_pipeline').insert({
        company_name: modalForm.name, region: modalForm.region || null,
        worker_estimate: parseInt(modalForm.estimate) || null,
        stage: 'tiem-nang', rating: modalForm.rating,
        last_contact: new Date().toISOString().split('T')[0],
      }).select().single();
      if (error) throw error;
      await onRefresh();
      setModalForm({ name: '', region: '', estimate: '', rating: 'normal' });
      setShowModal(false);
      toast('Đã thêm vào pipeline!');
      await logActivity({
        user, action: 'insert', table: 'crm_pipeline', recordId: data.id,
        description: `Thêm công ty "${data.company_name}" vào pipeline`,
        newData: data,
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleDrop = async (targetStage: string) => {
    if (!dragId) return;
    const entry = localPipeline.find(e => e.id === dragId);
    if (!entry || entry.stage === targetStage) { setDragId(null); setDragOver(null); return; }
    const stageLabel = STAGES.find(s => s.id === targetStage)?.label || targetStage;
    setLocalPipeline(prev => prev.map(e => e.id === dragId ? { ...e, stage: targetStage } : e));
    setDragId(null); setDragOver(null);
    try {
      const { error } = await supabase.from('crm_pipeline').update({ stage: targetStage }).eq('id', dragId);
      if (error) throw error;
      await onRefresh();
      toast(`${entry.company_name} → ${stageLabel}`);
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: dragId,
        description: `Chuyển "${entry.company_name}" sang giai đoạn "${stageLabel}"`,
        oldData: entry, newData: { ...entry, stage: targetStage },
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); await onRefresh(); }
  };

  const handleDelete = async (id: string) => {
    try {
      const existing = localPipeline.find(e => e.id === id);
      const { error } = await supabase.from('crm_pipeline').delete().eq('id', id);
      if (error) throw error;
      setProfileEntry(null);
      await onRefresh();
      toast('Đã xóa');
      if (existing) {
        await logActivity({
          user, action: 'delete', table: 'crm_pipeline', recordId: id,
          description: `Xóa công ty "${existing.company_name}" khỏi pipeline`,
          oldData: existing,
        });
      }
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleUpdate = (updated: CRMPipelineEntry) => {
    setLocalPipeline(prev => prev.map(e => e.id === updated.id ? updated : e));
    if (profileEntry?.id === updated.id) setProfileEntry(updated);
  };

  const archivedKNN = localPipeline.filter(e => e.stage === 'khong-nhu-cau');
  const archivedNgung = localPipeline.filter(e => e.stage === 'ngung');

  return (
    <>
      <PageHeader
        title="CRM Pipeline BD"
        subtitle="Phễu bán hàng — kéo thả thẻ để chuyển giai đoạn"
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"
          >
            <Plus size={13} /> Thêm công ty
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        {/* Kanban */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {STAGES.map(stage => {
            const items = localPipeline.filter(e => e.stage === stage.id);
            const isOver = dragOver === stage.id;
            return (
              <div
                key={stage.id}
                className={`bg-[#F5F4EF] rounded-lg transition-all ${isOver ? 'ring-2 ring-blue-400 bg-blue-50' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(stage.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(stage.id)}
              >
                <div className={`px-3 py-2 rounded-t-lg flex items-center justify-between ${stage.headerBg}`}>
                  <span className={`text-[11.5px] font-semibold ${stage.headerText}`}>{stage.label}</span>
                  <span className={`text-[11px] font-medium ${stage.headerText} opacity-60`}>{items.length}</span>
                </div>
                <div className="p-1.5 flex flex-col gap-1.5 min-h-[80px]">
                  {items.map(entry => {
                    const rc = RATING_CONFIG[entry.rating || 'normal'] || RATING_CONFIG.normal;
                    return (
                      <div
                        key={entry.id}
                        draggable
                        onDragStart={() => setDragId(entry.id)}
                        onDragEnd={() => { setDragId(null); setDragOver(null); }}
                        onClick={() => setProfileEntry(entry)}
                        className={`bg-white border border-[#E8E7E2] rounded-lg px-2.5 py-2 cursor-grab hover:border-blue-400 hover:shadow-sm transition select-none ${dragId === entry.id ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-1 mb-0.5">
                          <div className="text-[12px] font-semibold text-[#111] leading-tight truncate">{entry.company_name}</div>
                          <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${rc.dot}`} title={rc.label} />
                        </div>
                        <div className="text-[11px] text-[#888] truncate">
                          {entry.region || ''}
                          {entry.worker_estimate ? ` · ~${entry.worker_estimate} LĐ` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Archived */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'Không nhu cầu', items: archivedKNN },
            { label: 'Ngưng HĐ',      items: archivedNgung },
          ].map(sec => (
            <div key={sec.label} className="bg-[#F5F4EF] rounded-lg p-3">
              <div className="text-[11.5px] font-semibold text-[#888] mb-2">{sec.label} ({sec.items.length})</div>
              <div className="space-y-1">
                {sec.items.slice(0, 3).map(e => (
                  <button key={e.id} onClick={() => setProfileEntry(e)}
                    className="w-full text-left text-[12px] text-[#555] hover:text-[#111] transition truncate py-0.5">
                    {e.company_name}{e.region ? ` · ${e.region}` : ''}
                  </button>
                ))}
                {sec.items.length > 3 && <div className="text-[11px] text-[#bbb]">+{sec.items.length - 3} khác</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-[10px] border border-[#E8E7E2] w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-[15px] font-semibold text-[#111] mb-4">Thêm công ty mới</h2>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Tên công ty *</label>
                <input value={modalForm.name} onChange={e => setModalForm(f => ({ ...f, name: e.target.value }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Khu vực/KCN</label>
                <input value={modalForm.region} onChange={e => setModalForm(f => ({ ...f, region: e.target.value }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="KCN Biên Hòa 2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Ước tính LĐ</label>
                  <input type="number" value={modalForm.estimate} onChange={e => setModalForm(f => ({ ...f, estimate: e.target.value }))}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="50" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Đánh giá</label>
                  <select value={modalForm.rating} onChange={e => setModalForm(f => ({ ...f, rating: e.target.value }))}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                    <option value="hot">Tiềm năng cao</option>
                    <option value="normal">Bình thường</option>
                    <option value="low">Thấp</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={handleAdd}
                className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF]">Thêm</button>
            </div>
          </div>
        </div>
      )}

      {/* Profile drawer */}
      {profileEntry && (
        <ProfileModal
          entry={profileEntry}
          onClose={() => setProfileEntry(null)}
          onUpdate={handleUpdate}
          onDelete={() => handleDelete(profileEntry.id)}
          toast={toast}
          isAdmin={user?.role === 'admin'}
        />
      )}
    </>
  );
}
