import React, { useMemo, useState } from 'react';
import { Phone, Mail, PenTool, Calendar } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { WinLossSection } from '../components/workspace/WinLossSection';
import { formatCurrency } from '../lib/format';
import type { Client, CRMActivity, CRMPipelineEntry, Page } from '../lib/types';

interface Props {
  leads: Client[];
  activities: CRMActivity[];
  clients: Client[];
  pipeline: CRMPipelineEntry[];
  isAdmin: boolean;
  onNavigate: (p: Page) => void;
}

// Các giai đoạn của BD Pipeline (đồng bộ với src/pages/CRMPipeline.tsx)
const PIPELINE_STAGES = [
  { id: 'tiem-nang', label: 'Tiềm năng', badge: 'bg-blue-100 text-blue-700', color: 'bg-blue-500' },
  { id: 'dang-lh', label: 'Đang liên hệ', badge: 'bg-amber-100 text-amber-700', color: 'bg-amber-500' },
  { id: 'quan-tam', label: 'Quan tâm/Chờ', badge: 'bg-emerald-100 text-emerald-700', color: 'bg-emerald-500' },
  { id: 'dam-phan', label: 'Đàm phán HĐ', badge: 'bg-violet-100 text-violet-700', color: 'bg-violet-500' },
  { id: 'hop-tac', label: 'Đang HT', badge: 'bg-teal-100 text-teal-700', color: 'bg-teal-500' },
] as const;

// Giá hiệu lực của 1 công ty trong pipeline: ưu tiên giá tuỳ chỉnh, nếu không có thì lấy giá chuẩn của sản phẩm
function effectivePrice(entry: CRMPipelineEntry): number {
  return entry.custom_price ?? entry.crm_products?.price ?? 0;
}

type PeriodFilter = 'all' | 'month' | 'quarter' | 'year';

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  all: 'Tất cả',
  month: 'Tháng này',
  quarter: 'Quý này',
  year: 'Năm này',
};

function isWithinPeriod(dateStr: string | null | undefined, period: PeriodFilter): boolean {
  if (period === 'all') return true;
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const now = new Date();
  if (date.getFullYear() !== now.getFullYear()) return false;
  if (period === 'year') return true;
  if (period === 'month') return date.getMonth() === now.getMonth();
  const quarterOf = (m: number) => Math.floor(m / 3);
  return quarterOf(date.getMonth()) === quarterOf(now.getMonth());
}

const CRMDash: React.FC<Props> = ({ activities, clients, pipeline, isAdmin, onNavigate }) => {
  const [period, setPeriod] = useState<PeriodFilter>('all');

  const stats = useMemo(() => {
    // Giá trị pipeline: tổng giá (tuỳ chỉnh hoặc giá chuẩn) của các công ty chưa "Đang HT"
    const pipelineValue = pipeline
      .filter(e => e.stage !== 'hop-tac')
      .reduce((sum, e) => sum + effectivePrice(e), 0);
    // Tỷ lệ thắng: % công ty đã chuyển sang "Đang HT" trên tổng số công ty trong pipeline
    const wonCount = pipeline.filter(e => e.stage === 'hop-tac').length;
    const winRate = pipeline.length > 0 ? Math.round((wonCount / pipeline.length) * 100) : 0;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentActivities = activities.filter(a => new Date(a.created_at || '') > sevenDaysAgo).length;

    return {
      pipelineValue,
      winRate,
      recentActivities,
    };
  }, [pipeline, activities]);

  const runningProjects = useMemo(() => {
    const active = clients.filter(c => c.client_type === 'active');
    const filtered = active.filter(c => isWithinPeriod(c.source === 'excel_import' ? c.contract_start : (c.won_date || c.contract_start), period));
    const legacyCount = filtered.filter(c => c.source === 'excel_import').length;
    return {
      total: filtered.length,
      legacyCount,
      newCount: filtered.length - legacyCount,
    };
  }, [clients, period]);

  const stageDistribution = useMemo(() => {
    const distribution: Record<string, number> = {};
    PIPELINE_STAGES.forEach(s => { distribution[s.id] = 0; });
    pipeline.forEach(e => {
      if (Object.prototype.hasOwnProperty.call(distribution, e.stage)) {
        distribution[e.stage] += 1;
      }
    });
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    return { distribution, total };
  }, [pipeline]);

  const topPipeline = useMemo(() => {
    return pipeline
      .filter(e => e.stage !== 'hop-tac')
      .slice()
      .sort((a, b) => effectivePrice(b) - effectivePrice(a))
      .slice(0, 5);
  }, [pipeline]);

  const recentActivitiesData = useMemo(() => {
    return activities
      .sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime())
      .slice(0, 8);
  }, [activities]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'call':
        return <Phone className="w-4 h-4 text-blue-600" />;
      case 'email':
        return <Mail className="w-4 h-4 text-orange-600" />;
      case 'note':
        return <PenTool className="w-4 h-4 text-amber-600" />;
      case 'meeting':
        return <Calendar className="w-4 h-4 text-emerald-600" />;
      default:
        return <PenTool className="w-4 h-4 text-gray-600" />;
    }
  };

  const timeAgo = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diff = now.getTime() - then.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 60) return `${minutes}m trước`;
    if (hours < 24) return `${hours}h trước`;
    if (days < 7) return `${days}d trước`;
    return then.toLocaleDateString('vi-VN');
  };

  const truncate = (text: string, len: number) => {
    if (text.length <= len) return text;
    return text.substring(0, len) + '...';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM Dashboard"
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select
                value={period}
                onChange={e => setPeriod(e.target.value as PeriodFilter)}
                className="px-2.5 py-1.5 rounded-lg text-[12px] border border-gray-300 text-gray-600 outline-none focus:border-blue-500"
                title="Lọc 'Dự án đang chạy' theo kỳ ký mới"
              >
                {Object.entries(PERIOD_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            )}
            <button onClick={() => onNavigate('crm-leads')} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Leads</button>
            <button onClick={() => onNavigate('crm-board')} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">Pipeline</button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-600 mb-1">Dự án đang chạy</div>
          <div className="text-2xl font-bold text-gray-900 mb-1">{runningProjects.total}</div>
          <div className="text-xs text-gray-500">Cũ: {runningProjects.legacyCount} · CRM mới: {runningProjects.newCount}</div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-600 mb-1">Pipeline Value</div>
          <div className="text-xl font-bold text-gray-900 mb-1">{formatCurrency(stats.pipelineValue)}</div>
          <div className="text-xs text-gray-500">tổng giá trị</div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-600 mb-1">Tỷ lệ thắng</div>
          <div className="text-2xl font-bold text-emerald-600 mb-1">{stats.winRate}%</div>
          <div className="text-xs text-gray-500">won vs lost</div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-600 mb-1">Hoạt động</div>
          <div className="text-2xl font-bold text-blue-600 mb-1">{stats.recentActivities}</div>
          <div className="text-xs text-gray-500">7 ngày qua</div>
        </div>
      </div>

      {/* Stage Distribution */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Phân bố giai đoạn</h3>
        <div className="flex gap-1 h-8 mb-4 rounded-full overflow-hidden border border-gray-200 bg-gray-50">
          {PIPELINE_STAGES.map(stageConfig => {
            const count = stageDistribution.distribution[stageConfig.id] || 0;
            const pct = stageDistribution.total > 0 ? (count / stageDistribution.total) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div
                key={stageConfig.id}
                className={`${stageConfig.color} transition-all`}
                style={{ width: `${pct}%` }}
                title={`${stageConfig.label}: ${count}`}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {PIPELINE_STAGES.map(stageConfig => (
            <div key={stageConfig.id} className="text-center">
              <div className="text-xs font-medium text-gray-900 mb-1">{stageConfig.label}</div>
              <div className="text-sm font-bold text-gray-900">{stageDistribution.distribution[stageConfig.id] || 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Pipeline & Recent Activities */}
      <div className="grid grid-cols-2 gap-6">
        {/* Top Pipeline */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Công ty tiềm năng hàng đầu</h3>
          <div className="space-y-3">
            {topPipeline.length > 0 ? (
              topPipeline.map(entry => {
                const stageConfig = PIPELINE_STAGES.find(s => s.id === entry.stage);
                return (
                  <div key={entry.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-900 truncate">{entry.company_name}</div>
                      <div className="text-xs text-gray-500 truncate">{entry.region || '—'}{entry.crm_products?.category ? ` · ${entry.crm_products.category}` : ''}</div>
                    </div>
                    <div className="ml-4 text-right">
                      <div className="text-xs font-bold text-gray-900">{formatCurrency(effectivePrice(entry))}</div>
                      {stageConfig && (
                        <div className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-block ${stageConfig.badge}`}>
                          {stageConfig.label}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-gray-500 py-4 text-center">Không có công ty trong pipeline</div>
            )}
          </div>
        </div>

        {/* Recent Activities */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Hoạt động gần đây</h3>
          <div className="space-y-3">
            {recentActivitiesData.length > 0 ? (
              recentActivitiesData.map(activity => (
                <div key={activity.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                  <div className="mt-1 flex-shrink-0">{getActivityIcon(activity.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-900">
                      {activity.created_by}
                    </div>
                    <div className="text-xs text-gray-600 line-clamp-2">{truncate(activity.content || '', 60)}</div>
                  </div>
                  <div className="text-xs text-gray-500 flex-shrink-0 whitespace-nowrap">
                    {timeAgo(activity.created_at || '')}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-gray-500 py-4 text-center">Không có hoạt động</div>
            )}
          </div>
        </div>
      </div>

      {/* Win/Loss Tracker — chuyển từ Workspace sang (dữ liệu bán hàng thuộc khu CRM) */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Win/Loss Tracker</h3>
        </div>
        <WinLossSection clients={clients} />
      </div>
    </div>
  );
};

export default CRMDash;
