import { useState, useEffect } from 'react';
import {
  TrendingUp, AlertTriangle, Wallet, CalendarClock,
  Settings, GripVertical, Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { WorkspaceModulesTabs } from '../components/workspace/WorkspaceModulesTabs';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { Client, FinanceRecord, CRMPipelineEntry, Page } from '../lib/types';
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
type SectionKey = 'prospects' | 'morning' | 'alerts';

const SECTION_LABELS: Record<SectionKey, string> = {
  morning: 'Ưu tiên hôm nay (khai báo buổi sáng)',
  alerts: 'Thông báo hợp đồng & cập nhật chi nhánh',
  prospects: 'Prospects cần follow-up',
};

const DEFAULT_ORDER: SectionKey[] = ['morning', 'alerts', 'prospects'];

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

  // Merge in any new section keys that may not exist yet in a previously-saved layout,
  // and drop section keys ('overview', 'aiChat', etc.) that no longer exist
  const order = [...layout.order.filter(k => DEFAULT_ORDER.includes(k)), ...DEFAULT_ORDER.filter(k => !layout.order.includes(k))];

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
  const renderRoleCard = (): React.ReactNode => {
    if (user.role === 'admin') {
      return (
        <SectionCard title="Thông báo hợp đồng" icon={<AlertTriangle size={14} className="text-[#888]" />}>
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
      case 'morning':
        return <WorkspaceModulesTabs clients={clients} onClientUpdate={onClientUpdate} toast={toast} />;

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
    </>
  );
}
