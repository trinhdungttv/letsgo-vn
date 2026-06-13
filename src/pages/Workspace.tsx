import { useState, useEffect, useCallback } from 'react';
import {
  Bell, AlertTriangle, ShieldQuestion, Wallet, Users, Building2,
  TrendingUp, ClipboardList, CalendarClock, CheckCircle2, X,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { Client, FinanceRecord, CRMPipelineEntry, AppNotification, Page } from '../lib/types';
import { ROLE_LABELS, CRM_STAGES } from '../lib/constants';
import { formatCurrency, formatDate, daysUntil } from '../lib/format';

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

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function KpiCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11.5px] text-[#888]">{label}</div>
        <div className="text-[18px] font-semibold text-[#1a1a1a] leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[11px] text-[#999] mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

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

export default function Workspace({ clients, finance, pipeline, onNavigate, toast }: WorkspaceProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [myTasks, setMyTasks] = useState<{ id: string; title: string; deadline: string | null; status: string }[]>([]);
  const [branchRegion, setBranchRegion] = useState<string | null>(null);

  const month = currentMonth();

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
    if (!user || user.role !== 'admin') return;
    (async () => {
      const { count } = await supabase
        .from('permission_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      setPendingRequests(count || 0);
    })();
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== 'kinhdoanh') return;
    (async () => {
      const { data } = await supabase
        .from('sales_tasks')
        .select('id, title, deadline, status')
        .eq('assigned_to', user.id)
        .neq('status', 'done')
        .order('deadline', { ascending: true })
        .limit(6);
      setMyTasks((data || []) as { id: string; title: string; deadline: string | null; status: string }[]);
    })();
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

  if (!user) return null;

  const monthFinance = finance.filter(f => f.month === month);
  const totalRevenue = monthFinance.reduce((s, f) => s + (f.revenue || 0), 0);
  const paidCount = monthFinance.filter(f => f.paid_status).length;
  const unpaidClients = clients.filter(c => c.client_type === 'active' && !c.paid_this_month);
  const clientsMissingFinance = clients.filter(c => c.client_type === 'active' && !monthFinance.some(f => f.client_id === c.id));
  const alertClients = clients.filter(c => c.client_type === 'active' && (c.status === 'warn' || c.status === 'danger'));
  const activeClients = clients.filter(c => c.client_type === 'active');
  const expiringSoon = clients.filter(c => {
    const d = daysUntil(c.contract_end);
    return c.client_type === 'active' && d !== null && d >= 0 && d <= 30;
  });
  const branchClients = branchRegion ? activeClients.filter(c => c.region === branchRegion) : [];
  const branchExpiring = branchRegion ? expiringSoon.filter(c => c.region === branchRegion) : [];
  const branchWorkers = branchClients.reduce((s, c) => s + (c.current_workers || 0), 0);
  const staleProspects = pipeline.filter(p => {
    if (p.stage === 'hop-tac') return false;
    const d = daysUntil(p.last_contact);
    return d === null || d > 14;
  }).slice(0, 6);

  return (
    <div className="space-y-4">
      <PageHeader title="Workspace" subtitle={`Xin chào, ${user.full_name} · ${ROLE_LABELS[user.role] || user.role}`} />

      {/* KPI cards by role */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {user.role === 'admin' && (
          <>
            <KpiCard label="Khách hàng đang hoạt động" value={String(activeClients.length)} icon={<Building2 size={16} />} color="bg-blue-50 text-blue-600" />
            <KpiCard label="Doanh thu tháng" value={formatCurrency(totalRevenue)} icon={<TrendingUp size={16} />} color="bg-emerald-50 text-emerald-600" />
            <KpiCard label="Cảnh báo HĐ" value={String(alertClients.length)} sub="sắp hết / khẩn cấp" icon={<AlertTriangle size={16} />} color="bg-red-50 text-red-600" />
            <KpiCard label="Yêu cầu quyền chờ duyệt" value={String(pendingRequests)} icon={<ShieldQuestion size={16} />} color="bg-violet-50 text-violet-600" />
          </>
        )}
        {user.role === 'ketoan' && (
          <>
            <KpiCard label="Doanh thu tháng" value={formatCurrency(totalRevenue)} icon={<TrendingUp size={16} />} color="bg-emerald-50 text-emerald-600" />
            <KpiCard label="Đã thu tiền" value={`${paidCount}/${monthFinance.length}`} sub="bản ghi tài chính tháng này" icon={<Wallet size={16} />} color="bg-blue-50 text-blue-600" />
            <KpiCard label="KH chưa thanh toán" value={String(unpaidClients.length)} icon={<AlertTriangle size={16} />} color="bg-amber-50 text-amber-600" />
            <KpiCard label="CP chưa nhập" value={String(clientsMissingFinance.length)} sub="khách hàng chưa có dữ liệu tháng" icon={<ClipboardList size={16} />} color="bg-red-50 text-red-600" />
          </>
        )}
        {user.role === 'kinhdoanh' && (
          <>
            {CRM_STAGES.map(stage => (
              <KpiCard
                key={stage.id}
                label={stage.label}
                value={String(pipeline.filter(p => p.stage === stage.id).length)}
                icon={<span className={`w-2.5 h-2.5 rounded-full ${stage.dot}`} />}
                color={stage.headerBg}
              />
            ))}
          </>
        )}
        {user.role === 'bdh' && (
          <>
            <KpiCard label="Khách hàng chi nhánh" value={String(branchClients.length)} sub={branchRegion || '—'} icon={<Building2 size={16} />} color="bg-blue-50 text-blue-600" />
            <KpiCard label="Lao động đang làm" value={String(branchWorkers)} icon={<Users size={16} />} color="bg-emerald-50 text-emerald-600" />
            <KpiCard label="HĐ sắp hết hạn" value={String(branchExpiring.length)} sub="trong 30 ngày" icon={<CalendarClock size={16} />} color="bg-amber-50 text-amber-600" />
            <KpiCard label="Cảnh báo HĐ" value={String(branchClients.filter(c => c.status === 'warn' || c.status === 'danger').length)} icon={<AlertTriangle size={16} />} color="bg-red-50 text-red-600" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Notifications - common */}
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

        {/* Role-specific second card */}
        {user.role === 'admin' && (
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
        )}

        {user.role === 'ketoan' && (
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
        )}

        {user.role === 'kinhdoanh' && (
          <SectionCard title="Việc của tôi chưa xong" icon={<ClipboardList size={14} className="text-[#888]" />} action={
            <button onClick={() => onNavigate('sales-board')} className="text-[11.5px] text-blue-600 hover:underline">Xem bảng KD →</button>
          }>
            {myTasks.length === 0 ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Không có việc nào</div>
            ) : (
              <div className="space-y-1.5">
                {myTasks.map(t => (
                  <div key={t.id} onClick={() => onNavigate('sales-board')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
                    <div className="text-[12.5px] font-medium text-[#333] truncate">{t.title}</div>
                    <div className="text-[11px] text-[#999] shrink-0 ml-2">{t.deadline ? formatDate(t.deadline) : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {user.role === 'bdh' && (
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
        )}
      </div>

      {/* kinhdoanh: prospects need follow-up */}
      {user.role === 'kinhdoanh' && (
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
      )}
    </div>
  );
}
