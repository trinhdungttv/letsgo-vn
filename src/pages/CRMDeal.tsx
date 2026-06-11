import React, { useState } from 'react';
import { ChevronLeft, CheckCircle2, MessageCircle, Phone, Mail, Calendar, Pencil } from 'lucide-react';
import { formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import type { Client, CRMProduct, CRMDeal as CRMDealType, CRMActivity } from '../lib/types';

// Stage configuration
const STAGE_ORDER = ['new', 'contacted', 'in_progress', 'proposal', 'won', 'lost'] as const;
type StageKey = typeof STAGE_ORDER[number];

const STAGES: Record<StageKey, { label: string; color: string; colBg: string; textCol: string; prob: number }> = {
  new:         { label: 'Mới',          color: 'bg-slate-500',   colBg: 'bg-slate-50/80',   textCol: 'text-slate-700',   prob: 10  },
  contacted:   { label: 'Đã liên hệ',   color: 'bg-blue-500',    colBg: 'bg-blue-50/80',    textCol: 'text-blue-700',    prob: 25  },
  in_progress: { label: 'Đang xử lý',   color: 'bg-amber-500',   colBg: 'bg-amber-50/80',   textCol: 'text-amber-700',   prob: 50  },
  proposal:    { label: 'Báo giá',       color: 'bg-violet-500',  colBg: 'bg-violet-50/80',  textCol: 'text-violet-700',  prob: 75  },
  won:         { label: 'Đã thắng',      color: 'bg-emerald-500', colBg: 'bg-emerald-50/80', textCol: 'text-emerald-700', prob: 100 },
  lost:        { label: 'Thua',          color: 'bg-red-500',     colBg: 'bg-red-50/80',     textCol: 'text-red-700',     prob: 0   },
};

const ACTIVE_STAGES: StageKey[] = ['new', 'contacted', 'in_progress', 'proposal'];

type ActivityType = 'note' | 'call' | 'email' | 'meeting';

interface CRMDealProps {
  deal: CRMDealType;
  leads: Client[];
  products: CRMProduct[];
  activities: CRMActivity[];
  onDealUpdate: (d: CRMDealType) => void;
  onActivityCreate: (a: CRMActivity) => void;
  onBack: () => void;
  toast: (m: string) => void;
}

export default function CRMDeal({ deal, leads, products, activities, onDealUpdate, onActivityCreate, onBack, toast }: CRMDealProps) {
  const { user } = useAuth();
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState(deal.title);
  const [activeActivityTab, setActiveActivityTab] = useState<ActivityType>('note');
  const [activityContent, setActivityContent] = useState('');
  const [activityCreatedBy, setActivityCreatedBy] = useState('');
  const [isSubmittingActivity, setIsSubmittingActivity] = useState(false);

  const lead = leads.find(l => l.id === deal.lead_id);
  const product = products.find(p => p.id === deal.product_id);
  const dealStage = deal.stage as StageKey;
  const stageConfig = STAGES[dealStage];
  const probability = stageConfig.prob;

  // Filter activities for this deal, sorted by newest first
  const dealActivities = activities
    .filter(a => a.deal_id === deal.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleTitleUpdate = async () => {
    if (newTitle === deal.title) {
      setEditingTitle(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('crm_deals')
        .update({ title: newTitle })
        .eq('id', deal.id)
        .select('*, crm_leads(name, company), crm_products(name)')
        .single();

      if (error) throw error;
      onDealUpdate(data as CRMDealType);
      setEditingTitle(false);
      toast('Cập nhật tiêu đề thành công');
      await logActivity({
        user, action: 'update', table: 'crm_deals', recordId: deal.id,
        description: `Đổi tên thương vụ "${deal.title}" thành "${newTitle}"`,
        oldData: deal, newData: data,
      });
    } catch (err) {
      toast('Lỗi cập nhật tiêu đề');
      setNewTitle(deal.title);
      console.error(err);
    }
  };

  const handleStageChange = async (newStage: StageKey) => {
    try {
      const { data, error } = await supabase
        .from('crm_deals')
        .update({ stage: newStage })
        .eq('id', deal.id)
        .select('*, crm_leads(name, company), crm_products(name)')
        .single();

      if (error) throw error;
      onDealUpdate(data as CRMDealType);
      toast(`Cập nhật thương vụ thành "${STAGES[newStage].label}"`);
      await logActivity({
        user, action: 'update', table: 'crm_deals', recordId: deal.id,
        description: `Chuyển thương vụ "${deal.title}" sang giai đoạn "${STAGES[newStage].label}"`,
        oldData: deal, newData: data,
      });
    } catch (err) {
      toast('Lỗi cập nhật thương vụ');
      console.error(err);
    }
  };

  const handleActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityContent.trim()) {
      toast('Vui lòng nhập nội dung');
      return;
    }

    setIsSubmittingActivity(true);
    try {
      const { data, error } = await supabase
        .from('crm_activities')
        .insert({
          deal_id: deal.id,
          type: activeActivityTab,
          content: activityContent.trim(),
          created_by: activityCreatedBy.trim() || 'System',
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      onActivityCreate(data as CRMActivity);
      setActivityContent('');
      setActivityCreatedBy('');
      toast('Thêm hoạt động thành công');
      await logActivity({
        user, action: 'insert', table: 'crm_activities', recordId: data.id,
        description: `Thêm hoạt động (${activeActivityTab}) cho thương vụ "${deal.title}"`,
        newData: data,
      });
    } catch (err) {
      toast('Lỗi thêm hoạt động');
      console.error(err);
    } finally {
      setIsSubmittingActivity(false);
    }
  };

  const timeAgo = (date: string) => {
    const now = new Date();
    const past = new Date(date);
    const diff = Math.floor((now.getTime() - past.getTime()) / 1000);

    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)}p trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
    return `${Math.floor(diff / 86400)}d trước`;
  };

  const formatDate = (date: string | null) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const getActivityIcon = (type: ActivityType) => {
    const iconClass = 'w-4 h-4';
    switch (type) {
      case 'call':
        return <Phone className={`${iconClass} text-emerald-600`} />;
      case 'email':
        return <Mail className={`${iconClass} text-blue-600`} />;
      case 'note':
        return <MessageCircle className={`${iconClass} text-amber-600`} />;
      case 'meeting':
        return <Calendar className={`${iconClass} text-violet-600`} />;
      default:
        return null;
    }
  };

  const getActivityBadge = (type: ActivityType) => {
    const badges: Record<ActivityType, { label: string; bg: string; text: string }> = {
      call: { label: 'Gọi điện', bg: 'bg-emerald-100', text: 'text-emerald-700' },
      email: { label: 'Email', bg: 'bg-blue-100', text: 'text-blue-700' },
      note: { label: 'Ghi chú', bg: 'bg-amber-100', text: 'text-amber-700' },
      meeting: { label: 'Cuộc họp', bg: 'bg-violet-100', text: 'text-violet-700' },
    };
    const badge = badges[type];
    return { ...badge };
  };

  // Determine step progress for stage bar
  const getStepState = (step: StageKey) => {
    if (dealStage === 'won') return 'done';
    if (dealStage === 'lost') return 'lost';
    const currentIndex = ACTIVE_STAGES.indexOf(dealStage);
    const stepIndex = ACTIVE_STAGES.indexOf(step);
    if (stepIndex < currentIndex) return 'done';
    if (stepIndex === currentIndex) return 'current';
    return 'pending';
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header bar */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <ChevronLeft className="w-4 h-4" />
              Pipeline
            </button>
            <div className="h-6 w-px bg-gray-300"></div>
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onBlur={handleTitleUpdate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleUpdate();
                    if (e.key === 'Escape') {
                      setNewTitle(deal.title);
                      setEditingTitle(false);
                    }
                  }}
                  autoFocus
                  className="text-lg font-semibold text-gray-900 border border-blue-500 rounded px-2 py-1"
                />
              </div>
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="flex items-center gap-2 group"
              >
                <h2 className="text-lg font-semibold text-gray-900">{deal.title}</h2>
                <Pencil className="w-4 h-4 text-gray-400 group-hover:text-gray-600 opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleStageChange('won')}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              Won
            </button>
            <button
              onClick={() => handleStageChange('lost')}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Lost
            </button>
          </div>
        </div>
      </div>

      {/* Stage progress bar */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 shrink-0">
        <div className="flex items-center gap-2">
          {ACTIVE_STAGES.map((step, idx) => {
            const state = getStepState(step);
            const stepConfig = STAGES[step];
            const isLast = idx === ACTIVE_STAGES.length - 1;

            return (
              <React.Fragment key={step}>
                {/* Step circle */}
                <button
                  onClick={() => {
                    if (dealStage !== 'won' && dealStage !== 'lost') {
                      handleStageChange(step);
                    }
                  }}
                  disabled={dealStage === 'won' || dealStage === 'lost'}
                  className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                    state === 'done'
                      ? 'bg-emerald-100'
                      : state === 'current'
                        ? `${stepConfig.color} text-white`
                        : dealStage === 'lost'
                          ? 'bg-gray-200'
                          : 'bg-gray-100 border border-gray-300'
                  } ${dealStage !== 'won' && dealStage !== 'lost' ? 'hover:shadow-md cursor-pointer' : 'cursor-not-allowed'}`}
                >
                  {state === 'done' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <span className={`text-xs font-semibold ${state === 'current' ? 'text-white' : dealStage === 'lost' ? 'text-gray-500' : 'text-gray-700'}`}>
                      {idx + 1}
                    </span>
                  )}
                </button>

                {/* Label */}
                <div className={`text-xs font-medium ${
                  state === 'done'
                    ? 'text-emerald-700'
                    : state === 'current'
                      ? 'text-gray-900'
                      : dealStage === 'lost'
                        ? 'text-gray-400'
                        : 'text-gray-600'
                }`}>
                  {stepConfig.label}
                </div>

                {/* Connector line */}
                {!isLast && (
                  <div className={`flex-1 h-0.5 max-w-[60px] ${
                    state === 'done'
                      ? 'bg-emerald-300'
                      : dealStage === 'lost'
                        ? 'bg-gray-200'
                        : 'bg-gray-200'
                  }`}></div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-5 flex gap-5">
        {/* Left panel - Deal overview */}
        <div className="w-[280px] shrink-0">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-xs font-semibold uppercase text-gray-600 mb-4">Tổng quan thương vụ</h3>

            {/* Value */}
            <div className="mb-4">
              <p className="text-2xl font-bold text-blue-600">
                {formatCurrency(deal.value || 0)}
              </p>
            </div>

            {/* Probability */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">Xác suất</span>
                <span className="text-xs font-semibold text-gray-900">{probability}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${stageConfig.color}`}
                  style={{ width: `${probability}%` }}
                ></div>
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-3 border-t border-gray-200 pt-4">
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Người phụ trách</p>
                <p className="text-sm text-gray-900 font-medium">{deal.owner || 'N/A'}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Ngày dự kiến đóng</p>
                <p className={`text-sm font-medium ${
                  deal.expected_closing_date && new Date(deal.expected_closing_date) < new Date()
                    ? 'text-red-600'
                    : 'text-gray-900'
                }`}>
                  {formatDate(deal.expected_closing_date) || 'N/A'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Khách hàng</p>
                <p className="text-sm text-blue-600 font-medium cursor-pointer hover:underline">
                  {lead?.name || 'N/A'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Sản phẩm</p>
                <p className="text-sm text-gray-900 font-medium">{product?.name || 'N/A'}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Giai đoạn</p>
                <p className={`text-sm font-medium ${stageConfig.textCol}`}>{stageConfig.label}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Ngày tạo</p>
                <p className="text-sm text-gray-900 font-medium">{formatDate(deal.created_at)}</p>
              </div>
            </div>

            {/* Notes */}
            {deal.notes && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs font-semibold uppercase text-gray-600 mb-2">Ghi chú</p>
                <p className="text-xs text-gray-700 leading-relaxed">{deal.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel - Activities */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-lg border border-gray-200 p-4 h-full flex flex-col">
            {/* Activity tabs */}
            <div className="flex gap-2 mb-4 border-b border-gray-200 pb-3">
              {(['note', 'call', 'email', 'meeting'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setActiveActivityTab(type)}
                  className={`text-xs font-medium px-3 py-2 rounded transition-colors ${
                    activeActivityTab === type
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {type === 'note' && 'Ghi chú'}
                  {type === 'call' && 'Gọi điện'}
                  {type === 'email' && 'Email'}
                  {type === 'meeting' && 'Cuộc họp'}
                </button>
              ))}
            </div>

            {/* Activity input */}
            <form onSubmit={handleActivitySubmit} className="mb-4 pb-4 border-b border-gray-200">
              <textarea
                value={activityContent}
                onChange={(e) => setActivityContent(e.target.value)}
                placeholder="Nội dung..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none h-20 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
              />
              <input
                type="text"
                value={activityCreatedBy}
                onChange={(e) => setActivityCreatedBy(e.target.value)}
                placeholder="Tạo bởi (tùy chọn)"
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
              />
              <button
                type="submit"
                disabled={isSubmittingActivity}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                {isSubmittingActivity ? 'Đang lưu...' : 'Thêm'}
              </button>
            </form>

            {/* Activities list */}
            <div className="flex-1 overflow-y-auto space-y-3">
              {dealActivities.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">
                  Không có hoạt động
                </div>
              ) : (
                dealActivities.map(activity => {
                  const badge = getActivityBadge(activity.type as ActivityType);
                  return (
                    <div key={activity.id} className="pb-3 border-b border-gray-100 last:border-b-0">
                      <div className="flex gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {getActivityIcon(activity.type as ActivityType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            <span className="text-xs text-gray-500">{activity.created_by}</span>
                            <span className="text-xs text-gray-400">{timeAgo(activity.created_at)}</span>
                          </div>
                          <p className="text-xs text-gray-700 leading-relaxed break-words">
                            {activity.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
