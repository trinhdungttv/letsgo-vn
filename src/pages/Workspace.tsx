import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell, AlertTriangle, Wallet,
  TrendingUp, CalendarClock, CheckCircle2, X, Sparkles, Send, Trash2,
  Settings, GripVertical, Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { WorkspaceModulesTabs } from '../components/workspace/WorkspaceModulesTabs';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { Client, FinanceRecord, CRMPipelineEntry, AppNotification, Page } from '../lib/types';
import { ROLE_LABELS, CRM_STAGES } from '../lib/constants';
import { formatDate, daysUntil } from '../lib/format';
import { askGemini, buildWorkspaceContext, geminiConfigured, type ChatMessage } from '../lib/gemini';
import { usePersistedState } from '../hooks/usePersistedState';

interface WorkspaceProps {
  clients: Client[];
  finance: FinanceRecord[];
  pipeline: CRMPipelineEntry[];
  onNavigate: (page: Page) => void;
  toast: (msg: string) => void;
}

const NOTIF_ICON: Record<string, { icon: React.ReactNode; cls: string }> = {
  alert: { icon: <AlertTriangle size={14} />, cls: 'text-red-500 bg-red-50' },
  warning: { icon: <AlertTriangle size={14} />, cls: 'text-amber-500 bg-amber-50' },
  success: { icon: <CheckCircle2 size={14} />, cls: 'text-emerald-500 bg-emerald-50' },
  info: { icon: <Bell size={14} />, cls: 'text-blue-500 bg-blue-50' },
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

// --- Workspace layout customization (show/hide + reorder sections, font size) ---
type SectionKey = 'overview' | 'aiChat' | 'prospects' | 'morning';

const SECTION_LABELS: Record<SectionKey, string> = {
  morning: 'Ưu tiên hôm nay (khai báo buổi sáng)',
  overview: 'Thông báo cá nhân & Thẻ theo vai trò',
  aiChat: 'Trợ lý AI',
  prospects: 'Prospects cần follow-up',
};

const DEFAULT_ORDER: SectionKey[] = ['morning', 'overview', 'aiChat', 'prospects'];

interface WorkspaceLayout {
  order: SectionKey[];
  hidden: SectionKey[];
  fontScale: number;
}

const DEFAULT_LAYOUT: WorkspaceLayout = { order: DEFAULT_ORDER, hidden: [], fontScale: 1 };

function sectionAvailable(key: SectionKey, role: string): boolean {
  if (key === 'prospects') return role === 'kinhdoanh';
  return true;
}

const FONT_MIN = 0.8;
const FONT_MAX = 1.3;
const FONT_STEP = 0.05;

export default function Workspace({ clients, finance, pipeline, onNavigate, toast }: WorkspaceProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [branchRegion, setBranchRegion] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [layout, setLayout] = usePersistedState<WorkspaceLayout>('lgvn_workspace_layout', DEFAULT_LAYOUT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragKey, setDragKey] = useState<SectionKey | null>(null);

  // Migrate previously-saved layouts that used the old separate 'notifications'/'roleCard' keys
  useEffect(() => {
    const oldKeys = new Set(['notifications', 'roleCard']);
    const merge = (arr: SectionKey[]): SectionKey[] => {
      const out: SectionKey[] = [];
      for (const k of arr) {
        const mapped = oldKeys.has(k) ? 'overview' : k;
        if (!out.includes(mapped)) out.push(mapped);
      }
      return out;
    };
    setLayout(prev => {
      const hasOld = prev.order.some(k => oldKeys.has(k)) || prev.hidden.some(k => oldKeys.has(k));
      if (!hasOld) return prev;
      return { ...prev, order: merge(prev.order), hidden: merge(prev.hidden) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merge in any new section keys that may not exist yet in a previously-saved layout
  const order = [...layout.order, ...DEFAULT_ORDER.filter(k => !layout.order.includes(k))];

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8);
    setNotifications((data || []) as AppNotification[]);
  }, [user]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  useEffect(() => {
    if (!user) return;
    supabase.from('ai_chat_messages')
      .select('role, text')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setChatMessages(data as ChatMessage[]);
      });
  }, [user]);

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

  const markRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  };

  const dismissNotif = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatSending]);

  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatSending || !user) return;
    const nextHistory: ChatMessage[] = [...chatMessages, { role: 'user', text }];
    setChatMessages(nextHistory);
    setChatInput('');
    setChatSending(true);
    await supabase.from('ai_chat_messages').insert({ user_id: user.id, role: 'user', text });
    try {
      const context = buildWorkspaceContext(clients, finance, pipeline);
      const reply = await askGemini(context, nextHistory);
      setChatMessages(prev => [...prev, { role: 'model', text: reply }]);
      await supabase.from('ai_chat_messages').insert({ user_id: user.id, role: 'model', text: reply });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const icon = msg.includes('chờ khoảng') && msg.includes('giây') ? '⏳' : '⚠️';
      const errText = `${icon} ${msg}`;
      setChatMessages(prev => [...prev, { role: 'model', text: errText }]);
      await supabase.from('ai_chat_messages').insert({ user_id: user.id, role: 'model', text: errText });
    } finally {
      setChatSending(false);
    }
  };

  const handleClearChat = async () => {
    if (!user) return;
    if (!confirm('Xóa toàn bộ lịch sử chat?')) return;
    setChatMessages([]);
    await supabase.from('ai_chat_messages').delete().eq('user_id', user.id);
  };

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

  if (!user) return null;

  const unpaidClients = clients.filter(c => c.client_type === 'active' && !c.paid_this_month);
  const alertClients = clients.filter(c => c.client_type === 'active' && (c.status === 'warn' || c.status === 'danger'));
  const expiringSoon = clients.filter(c => {
    const d = daysUntil(c.contract_end);
    return c.client_type === 'active' && d !== null && d >= 0 && d <= 30;
  });
  const branchExpiring = branchRegion ? expiringSoon.filter(c => c.region === branchRegion) : [];
  const staleProspects = pipeline.filter(p => {
    if (p.stage === 'hop-tac') return false;
    const d = daysUntil(p.last_contact);
    return d === null || d > 14;
  }).slice(0, 6);

  // --- Section renderers ---
  const renderNotifications = (): React.ReactNode => (
    <SectionCard title="Thông báo cá nhân" icon={<Bell size={14} className="text-[#888]" />}>
      {notifications.length === 0 ? (
        <div className="text-[12.5px] text-[#999] py-4 text-center">Không có thông báo mới</div>
      ) : (
        <div className="space-y-1.5">
          {notifications.map(n => {
            const ic = NOTIF_ICON[n.type] || NOTIF_ICON.info;
            return (
              <div
                key={n.id}
                onClick={() => !n.is_read && markRead(n.id)}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition ${n.is_read ? 'opacity-60' : 'bg-[#F9F9F7]'} hover:bg-[#F4F4F1]`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${ic.cls}`}>{ic.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-[#333] flex items-center gap-1.5">
                    {n.title}
                    {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />}
                  </div>
                  {n.body && <div className="text-[11.5px] text-[#888] mt-0.5">{n.body}</div>}
                  <div className="text-[10.5px] text-[#aaa] mt-0.5">{formatDate(n.created_at)}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissNotif(n.id); }}
                  className="text-[#bbb] hover:text-red-500 transition shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );

  const renderRoleCard = (): React.ReactNode => {
    if (user.role === 'admin') {
      return (
        <SectionCard title="Cảnh báo hệ thống" icon={<AlertTriangle size={14} className="text-[#888]" />}>
          {alertClients.length === 0 ? (
            <div className="text-[12.5px] text-[#999] py-4 text-center">Không có cảnh báo</div>
          ) : (
            <div className="space-y-1.5">
              {alertClients.slice(0, 6).map(c => (
                <div key={c.id} onClick={() => toast('Mở chi tiết khách hàng từ trang Khách hàng')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
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
        <SectionCard title="Hợp đồng sắp hết hạn (chi nhánh)" icon={<CalendarClock size={14} className="text-[#888]" />}>
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
      case 'morning':
        return <WorkspaceModulesTabs />;

      case 'overview': {
        const roleCard = renderRoleCard();
        return (
          <div className={`grid grid-cols-1 ${roleCard ? 'lg:grid-cols-2' : ''} gap-4`}>
            {renderNotifications()}
            {roleCard}
          </div>
        );
      }

      case 'aiChat':
        return (
          <SectionCard title="Trợ lý AI" icon={<Sparkles size={14} className="text-[#888]" />} action={
            chatMessages.length > 0 ? (
              <button onClick={handleClearChat} className="inline-flex items-center gap-1 text-[11.5px] text-[#999] hover:text-red-500 transition">
                <Trash2 size={12} /> Xóa lịch sử
              </button>
            ) : undefined
          }>
            {!geminiConfigured() ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Chưa cấu hình Gemini API key (VITE_GEMINI_API_KEY)</div>
            ) : (
              <div className="flex flex-col">
                <div className="max-h-[360px] overflow-y-auto space-y-2 mb-2">
                  {chatMessages.length === 0 && (
                    <div className="text-[12.5px] text-[#999] py-3 text-center">
                      Hỏi về khách hàng, doanh thu, hợp đồng sắp hết hạn, pipeline kinh doanh...
                    </div>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap ${
                        m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-[#F4F4F1] text-[#333]'
                      }`}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                  {chatSending && (
                    <div className="flex justify-start">
                      <div className="bg-[#F4F4F1] text-[#999] rounded-lg px-3 py-2 text-[12.5px]">Đang trả lời...</div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                    placeholder="Nhập câu hỏi..."
                    disabled={chatSending}
                    className="flex-1 border border-[#E8E7E2] rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-blue-400"
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={chatSending || !chatInput.trim()}
                    className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center disabled:opacity-40 hover:bg-blue-700 transition shrink-0"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        );

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

  return (
    <div style={{ zoom: layout.fontScale }} className="relative">
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

      {settingsOpen && (
        <div className="mt-3 bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-4">
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

          {/* Show/hide + reorder sections */}
          <div>
            <div className="text-[12px] font-semibold text-[#333] mb-2">Hiển thị & sắp xếp các bảng (kéo thả để đổi vị trí)</div>
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
        </div>
      )}

      <div className="space-y-4 mt-4">
        {visibleSections.map(key => (
          <div key={key}>{renderSection(key)}</div>
        ))}
      </div>
    </div>
  );
}
