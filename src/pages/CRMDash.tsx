import React, { useMemo, useState } from 'react';
import { Phone, Mail, PenTool, Calendar } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { formatCurrency } from '../lib/format';
import type { Client, CRMDeal, CRMActivity, Page } from '../lib/types';

interface Props {
  deals: CRMDeal[];
  leads: Client[];
  activities: CRMActivity[];
  clients: Client[];
  isAdmin: boolean;
  onNavigate: (p: Page) => void;
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

const STAGES = {
  new: { label: 'Mới', color: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700' },
  contacted: { label: 'Đã liên hệ', color: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'Đang xử lý', color: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
  proposal: { label: 'Báo giá', color: 'bg-violet-500', badge: 'bg-violet-100 text-violet-700' },
  won: { label: 'Đã thắng', color: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  lost: { label: 'Thua', color: 'bg-red-500', badge: 'bg-red-100 text-red-700' },
} as const;

type StageKey = keyof typeof STAGES;

const CRMDash: React.FC<Props> = ({ deals, activities, clients, isAdmin, onNavigate }) => {
  const [period, setPeriod] = useState<PeriodFilter>('all');

  const stats = useMemo(() => {
    const pipelineValue = deals
      .filter(d => d.stage !== 'won' && d.stage !== 'lost')
      .reduce((sum, d) => sum + (d.value || 0), 0);
    const wonCount = deals.filter(d => d.stage === 'won').length;
    const lostCount = deals.filter(d => d.stage === 'lost').length;
    const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentActivities = activities.filter(a => new Date(a.created_at || '') > sevenDaysAgo).length;

    return {
      pipelineValue,
      winRate,
      recentActivities,
    };
  }, [deals, activities]);

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
    const distribution: Record<string, number> = {
      new: 0,
      contacted: 0,
      in_progress: 0,
      proposal: 0,
      won: 0,
      lost: 0,
    };
    deals.forEach(d => {
      if (distribution.hasOwnProperty(d.stage)) {
        distribution[d.stage as StageKey] += 1;
      }
    });
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    return { distribution, total };
  }, [deals]);

  const topDeals = useMemo(() => {
    return deals
      .filter(d => d.stage !== 'lost')
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 5);
  }, [deals]);

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
          {Object.entries(stageDistribution.distribution).map(([stage, count]) => {
            const pct = stageDistribution.total > 0 ? (count / stageDistribution.total) * 100 : 0;
            if (pct === 0) return null;
            const stageKey = stage as StageKey;
            const stageConfig = STAGES[stageKey];
            return (
              <div
                key={stage}
                className={`${stageConfig.color} transition-all`}
                style={{ width: `${pct}%` }}
                title={`${stageConfig.label}: ${count}`}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(stageDistribution.distribution).map(([stage, count]) => {
            const stageKey = stage as StageKey;
            const stageConfig = STAGES[stageKey];
            return (
              <div key={stage} className="text-center">
                <div className="text-xs font-medium text-gray-900 mb-1">{stageConfig.label}</div>
                <div className="text-sm font-bold text-gray-900">{count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Deals & Recent Activities */}
      <div className="grid grid-cols-2 gap-6">
        {/* Top Deals */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Thương vụ hàng đầu</h3>
          <div className="space-y-3">
            {topDeals.length > 0 ? (
              topDeals.map(deal => (
                <div key={deal.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-900 truncate">{deal.title}</div>
                    <div className="text-xs text-gray-500 truncate">{deal.crm_leads?.name || deal.clients?.name || '—'}</div>
                  </div>
                  <div className="ml-4 text-right">
                    <div className="text-xs font-bold text-gray-900">{formatCurrency(deal.value || 0)}</div>
                    <div className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-block ${STAGES[deal.stage as StageKey].badge}`}>
                      {STAGES[deal.stage as StageKey].label}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-gray-500 py-4 text-center">Không có thương vụ</div>
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
    </div>
  );
};

export default CRMDash;
