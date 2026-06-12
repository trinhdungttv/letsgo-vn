import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Edit2, Check, X, ChevronDown, ChevronUp, RefreshCw, MessageCircle, Phone, Mail, Calendar, CheckCircle2, Gift, CalendarDays } from 'lucide-react';
import { Line, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler } from 'chart.js';
import type { Client, LaborHistoryEntry, MarketZone, CRMDeal as CRMDealType, CRMActivity, ClientGift, Contact } from '../lib/types';
import { formatDate, getMonthLast, getCurrentWeekLabel, recentWeekLabels, weekLabelsForMonth, statusPill, formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import ContactsTab from '../components/ContactsTab';
import { useContacts } from '../hooks/useContacts';
import { useRegions } from '../hooks/useRegions';
import { useManagers } from '../hooks/useManagers';
import { STAGES, ACTIVE_STAGES, type StageKey } from './CRMDeal';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler);

interface ClientDetailProps {
  client: Client;
  laborHistory: LaborHistoryEntry[];
  onBack: () => void;
  onClientUpdate: (client: Client) => void;
  onLaborUpdate: (entry: LaborHistoryEntry) => void;
  marketZones: MarketZone[];
  toast: (msg: string) => void;
  onOpenDeal?: (dealId: string) => void;
}

export default function ClientDetail({ client, laborHistory, onBack, onClientUpdate, onLaborUpdate, marketZones, toast, onOpenDeal }: ClientDetailProps) {
  const { user } = useAuth();
  const { regions } = useRegions();
  const { managers } = useManagers();
  const [activeTab, setActiveTab] = useState<'overview' | 'crm'>('overview');
  const [editing, setEditing] = useState(false);
  const [chartView, setChartView] = useState<'week' | 'month'>('week');
  const [laborWeek, setLaborWeek] = useState(getCurrentWeekLabel());
  const [laborInput, setLaborInput] = useState(String(client.current_workers || 0));
  const [laborMsg, setLaborMsg] = useState(false);
  const [extraMonth, setExtraMonth] = useState(''); // value of <input type="month"> picker
  const [extraMonths, setExtraMonths] = useState<{ year: number; month: number }[]>([]);
  const monthSortKey = (label: string) => {
    const m = label.match(/Tháng (\d+)\/(\d+)/);
    return m ? Number(m[2]) * 12 + Number(m[1]) : 0;
  };
  const weekGroups = useMemo(() => {
    const base = recentWeekLabels(2);
    const baseMonths = new Set(base.map(g => g.month));
    const extra = extraMonths
      .map(({ year, month }) => ({ month: `Tháng ${month}/${year}`, labels: weekLabelsForMonth(year, month).slice().reverse() }))
      .filter(g => !baseMonths.has(g.month));
    return [...base, ...extra].sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
  }, [extraMonths]);

  const selectWeek = (wk: string) => {
    setLaborWeek(wk);
    const existing = hist.find(h => h.week_label === wk);
    setLaborInput(existing ? String(existing.count) : '0');
  };

  const addExtraMonth = () => {
    if (!extraMonth) { toast('Vui lòng chọn tháng/năm cần thêm'); return; }
    const [y, m] = extraMonth.split('-').map(Number);
    if (!y || !m) return;
    setExtraMonths(prev => prev.some(e => e.year === y && e.month === m) ? prev : [...prev, { year: y, month: m }]);
    setExtraMonth('');
    // Jump the week selector to this month's most recent week so it's immediately visible
    const labels = weekLabelsForMonth(y, m);
    selectWeek(labels[labels.length - 1]);
    toast(`Đã thêm Tháng ${m}/${y} vào danh sách tuần`);
  };
  const [openInfo, setOpenInfo] = useState(false);
  const [openLabor, setOpenLabor] = useState(true);
  const [form, setForm] = useState({
    name: client.name || '',
    region: client.region || '',
    manager: client.manager || '',
    industrial_zones: client.industrial_zones || [],
    contract_start: client.contract_start || '',
    contract_end: client.contract_end || '',
    notes: client.notes || '',
  });
  const [timelineForm, setTimelineForm] = useState({
    cutoff_day: client.cutoff_day, cutoff_day_end: client.cutoff_day_end,
    calc_day: client.calc_day, calc_day_end: client.calc_day_end,
    payment_start: client.payment_start, payment_end: client.payment_end,
    salary_day: client.salary_day, salary_day_end: client.salary_day_end,
  });
  const { contacts: primaryContacts } = useContacts(client.id);
  const primaryContact = primaryContacts.find(c => c.is_primary);

  // CRM deal info for this client
  const [deals, setDeals] = useState<CRMDealType[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [dealActivities, setDealActivities] = useState<CRMActivity[]>([]);
  const [activeActivityTab, setActiveActivityTab] = useState<'note' | 'call' | 'email' | 'meeting'>('note');
  const [activityContent, setActivityContent] = useState('');
  const [savingActivity, setSavingActivity] = useState(false);
  const [gifts, setGifts] = useState<ClientGift[]>([]);
  const [cskhContacts, setCskhContacts] = useState<Contact[]>([]);
  const [showNewRecipient, setShowNewRecipient] = useState(false);
  const [newRecipientForm, setNewRecipientForm] = useState({ name: '', phone: '', role: '' });
  const [savingRecipient, setSavingRecipient] = useState(false);
  const [giftForm, setGiftForm] = useState({ item_name: '', value: '', gift_date: new Date().toISOString().slice(0, 10), notes: '', recipient_contact_id: '' });
  const [savingGift, setSavingGift] = useState(false);
  const [editingDealTitle, setEditingDealTitle] = useState(false);
  const [dealTitleInput, setDealTitleInput] = useState('');

  useEffect(() => {
    if (activeTab !== 'crm') return;
    supabase.from('crm_deals')
      .select('*, crm_products(name)')
      .or(`lead_id.eq.${client.id},client_id.eq.${client.id}`)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data || []) as CRMDealType[];
        setDeals(rows);
        setSelectedDealId(prev => prev && rows.some(d => d.id === prev) ? prev : (rows[0]?.id || null));
      });
    supabase.from('client_gifts')
      .select('*')
      .eq('client_id', client.id)
      .order('gift_date', { ascending: false })
      .then(({ data }) => setGifts((data || []) as ClientGift[]));
    supabase.from('contacts')
      .select('*, clients(name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => setCskhContacts((data || []) as Contact[]));
  }, [activeTab, client.id]);

  useEffect(() => {
    if (!selectedDealId) { setDealActivities([]); return; }
    supabase.from('crm_activities')
      .select('*')
      .eq('deal_id', selectedDealId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setDealActivities((data || []) as CRMActivity[]));
  }, [selectedDealId]);

  const selectedDeal = deals.find(d => d.id === selectedDealId) || null;

  const startEditDealTitle = () => {
    if (!selectedDeal) return;
    setDealTitleInput(selectedDeal.title);
    setEditingDealTitle(true);
  };

  const handleDealTitleUpdate = async () => {
    if (!selectedDeal) return;
    const newTitle = dealTitleInput.trim();
    if (!newTitle || newTitle === selectedDeal.title) { setEditingDealTitle(false); return; }
    try {
      const { data, error } = await supabase.from('crm_deals')
        .update({ title: newTitle }).eq('id', selectedDeal.id)
        .select('*, crm_products(name)').single();
      if (error) throw error;
      setDeals(prev => prev.map(d => d.id === selectedDeal.id ? (data as CRMDealType) : d));
      setEditingDealTitle(false);
      toast('Đã đổi tên thương vụ');
      await logActivity({
        user, action: 'update', table: 'crm_deals', recordId: selectedDeal.id,
        description: `Đổi tên thương vụ "${selectedDeal.title}" thành "${newTitle}"`,
        oldData: selectedDeal, newData: data,
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const handleStageChange = async (newStage: StageKey) => {
    if (!selectedDeal) return;
    try {
      const { data, error } = await supabase.from('crm_deals')
        .update({ stage: newStage }).eq('id', selectedDeal.id)
        .select('*, crm_products(name)').single();
      if (error) throw error;
      setDeals(prev => prev.map(d => d.id === selectedDeal.id ? (data as CRMDealType) : d));
      toast(`Cập nhật thương vụ thành "${STAGES[newStage].label}"`);
      await logActivity({
        user, action: 'update', table: 'crm_deals', recordId: selectedDeal.id,
        description: `Chuyển thương vụ "${selectedDeal.title}" sang giai đoạn "${STAGES[newStage].label}"`,
        oldData: selectedDeal, newData: data,
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const getStepState = (step: StageKey, stage: StageKey) => {
    if (stage === 'won') return 'done';
    if (stage === 'lost') return 'lost';
    const currentIndex = ACTIVE_STAGES.indexOf(stage);
    const stepIndex = ACTIVE_STAGES.indexOf(step);
    if (stepIndex < currentIndex) return 'done';
    if (stepIndex === currentIndex) return 'current';
    return 'pending';
  };

  const handleActivitySubmit = async () => {
    if (!selectedDeal) return;
    if (!activityContent.trim()) { toast('Vui lòng nhập nội dung'); return; }
    setSavingActivity(true);
    try {
      const { data, error } = await supabase.from('crm_activities').insert({
        deal_id: selectedDeal.id,
        type: activeActivityTab,
        content: activityContent.trim(),
        created_by: user?.full_name || 'System',
        created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      setDealActivities(prev => [data as CRMActivity, ...prev]);
      setActivityContent('');
      toast('Đã thêm hoạt động');
      await logActivity({
        user, action: 'insert', table: 'crm_activities', recordId: data.id,
        description: `Thêm hoạt động (${activeActivityTab}) cho thương vụ "${selectedDeal.title}"`,
        newData: data,
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    } finally {
      setSavingActivity(false);
    }
  };

  const handleAddGift = async () => {
    if (!giftForm.item_name.trim()) { toast('Vui lòng nhập tên quà'); return; }
    setSavingGift(true);
    try {
      const recipient = cskhContacts.find(c => c.id === giftForm.recipient_contact_id);
      const { data, error } = await supabase.from('client_gifts').insert({
        client_id: client.id,
        item_name: giftForm.item_name.trim(),
        value: giftForm.value ? Number(giftForm.value) : null,
        gift_date: giftForm.gift_date,
        notes: giftForm.notes.trim() || null,
        recipient_contact_id: giftForm.recipient_contact_id || null,
        recipient_name: recipient?.name || null,
        created_by: user?.full_name || 'System',
      }).select().single();
      if (error) throw error;
      setGifts(prev => [data as ClientGift, ...prev]);
      setGiftForm({ item_name: '', value: '', gift_date: new Date().toISOString().slice(0, 10), notes: '', recipient_contact_id: '' });
      toast('Đã thêm quà tặng');
      await logActivity({
        user, action: 'insert', table: 'client_gifts', recordId: data.id,
        description: `Thêm quà tặng "${data.item_name}" cho khách hàng "${client.name}"`,
        newData: data,
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    } finally {
      setSavingGift(false);
    }
  };

  const handleAddRecipient = async () => {
    if (!newRecipientForm.name.trim()) { toast('Vui lòng nhập họ tên'); return; }
    setSavingRecipient(true);
    try {
      const { data, error } = await supabase.from('contacts').insert({
        client_id: client.id,
        name: newRecipientForm.name.trim(),
        phone: newRecipientForm.phone.trim() || null,
        role: newRecipientForm.role.trim() || 'Khác',
        updated_at: new Date().toISOString(),
      }).select('*, clients(name)').single();
      if (error) throw error;
      const contact = data as Contact;
      setCskhContacts(prev => [contact, ...prev]);
      setGiftForm(prev => ({ ...prev, recipient_contact_id: contact.id }));
      setNewRecipientForm({ name: '', phone: '', role: '' });
      setShowNewRecipient(false);
      toast('Đã thêm người nhận mới vào CSKH');
      await logActivity({
        user, action: 'insert', table: 'contacts', recordId: contact.id,
        description: `Thêm liên hệ CSKH "${contact.name}" cho khách hàng "${client.name}"`,
        newData: contact,
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    } finally {
      setSavingRecipient(false);
    }
  };

  const timeAgo = (date: string) => {
    const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)}p trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
    return `${Math.floor(diff / 86400)}d trước`;
  };

  const activityIcon = (type: string) => {
    switch (type) {
      case 'call': return <Phone size={14} className="text-emerald-600" />;
      case 'email': return <Mail size={14} className="text-blue-600" />;
      case 'meeting': return <Calendar size={14} className="text-violet-600" />;
      default: return <MessageCircle size={14} className="text-amber-600" />;
    }
  };

  const activityBadge = (type: string) => {
    const badges: Record<string, { label: string; bg: string; text: string }> = {
      call: { label: 'Gọi điện', bg: 'bg-emerald-100', text: 'text-emerald-700' },
      email: { label: 'Email', bg: 'bg-blue-100', text: 'text-blue-700' },
      note: { label: 'Ghi chú', bg: 'bg-amber-100', text: 'text-amber-700' },
      meeting: { label: 'Cuộc họp', bg: 'bg-violet-100', text: 'text-violet-700' },
    };
    return badges[type] || badges.note;
  };

  const hist = useMemo(() => [...laborHistory].sort((a, b) => a.created_at.localeCompare(b.created_at)), [laborHistory]);
  const currentWorkers = hist.length ? hist[hist.length - 1].count : 0;

  const chartData = useMemo(() => {
    if (chartView === 'week') {
      return {
        labels: hist.map(h => h.week_label),
        datasets: [{ label: 'LĐ', data: hist.map(h => h.count), borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 4 }],
      };
    }
    const t4 = getMonthLast(hist, 'T4');
    const t5 = getMonthLast(hist, 'T5');
    const t6 = getMonthLast(hist, 'T6');
    return {
      labels: ['T4/2026', 'T5/2026', 'T6/2026'],
      datasets: [{ label: 'LĐ', data: [t4, t5, t6], backgroundColor: ['rgba(59,130,246,.3)', 'rgba(59,130,246,.3)', '#3B82F6'], borderRadius: 6, barPercentage: 0.6 }],
    };
  }, [hist, chartView]);

  const monthRows = useMemo(() => {
    const t4 = getMonthLast(hist, 'T4');
    const t5 = getMonthLast(hist, 'T5');
    const t6 = getMonthLast(hist, 'T6');
    return [
      { m: 'T4/2026', cnt: t4, prev: null },
      { m: 'T5/2026', cnt: t5, prev: t4 },
      { m: 'T6/2026', cnt: t6, prev: t5 },
    ];
  }, [hist]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Tên công ty không được để trống'); return; }
    try {
      const updates = { ...form, ...timelineForm, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
      if (error) throw error;
      onClientUpdate({ ...client, ...updates });
      setEditing(false);
      toast('Đã lưu thông tin khách hàng!');
      await logActivity({
        user, action: 'update', table: 'clients', recordId: client.id,
        description: `Cập nhật thông tin khách hàng "${client.name}"`,
        oldData: client, newData: { ...client, ...updates },
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const handleLaborUpdate = async () => {
    const val = parseInt(laborInput);
    if (isNaN(val) || val < 0) { toast('Số lao động không hợp lệ'); return; }
    const wk = laborWeek;
    try {
      const existing = hist.find(h => h.week_label === wk);
      if (existing) {
        const { error } = await supabase.from('client_labor_history').update({ count: val }).eq('id', existing.id);
        if (error) throw error;
        onLaborUpdate({ ...existing, count: val });
        await logActivity({
          user, action: 'update', table: 'client_labor_history', recordId: existing.id,
          description: `Cập nhật LĐ tuần ${wk} cho "${client.name}": ${existing.count.toLocaleString()} → ${val.toLocaleString()}`,
          oldData: existing, newData: { ...existing, count: val },
        });
      } else {
        const { data, error } = await supabase.from('client_labor_history').insert({ client_id: client.id, week_label: wk, count: val, updated_by: user?.full_name || null }).select().single();
        if (error) throw error;
        onLaborUpdate(data);
        await logActivity({
          user, action: 'insert', table: 'client_labor_history', recordId: data.id,
          description: `Thêm số liệu LĐ tuần ${wk} cho "${client.name}": ${val.toLocaleString()}`,
          newData: data,
        });
      }
      setLaborMsg(true);
      setTimeout(() => setLaborMsg(false), 3000);
      toast(`Đã cập nhật ${val.toLocaleString()} LĐ tuần ${wk}`);
    } catch (e: any) {
      toast('Lỗi lưu: ' + e.message);
    }
  };

  const pill = statusPill(client.status);

  return (
    <>
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
        <div className="flex items-center gap-2.5">
          <button onClick={onBack} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            <ArrowLeft size={13} /> Quay lại
          </button>
          <div>
            <div className="text-[14px] font-semibold text-[#111]">{client.name}</div>
            <div className="text-[11.5px] text-[#888]">{client.region || ''} · <span className={pill.cls.includes('emerald') ? 'text-emerald-600' : pill.cls.includes('amber') ? 'text-amber-600' : 'text-red-600'}>{pill.label}</span></div>
          </div>
        </div>
        <button onClick={() => setEditing(!editing)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-blue-500 text-blue-700 hover:bg-blue-50 transition">
          {editing ? <><X size={13} /> Hủy</> : <><Edit2 size={13} /> Sửa thông tin</>}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#E8E7E2] bg-white shrink-0 px-6">
        {(['overview', 'crm'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-[12.5px] font-medium border-b-2 transition -mb-px ${
              activeTab === tab
                ? 'border-[#1D4ED8] text-[#1D4ED8]'
                : 'border-transparent text-[#888] hover:text-[#555]'
            }`}
          >
            {tab === 'overview' ? '📊 Tổng quan' : '🤝 Chi tiết thương vụ'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {activeTab === 'crm' ? (
          <div className="space-y-4">
            {/* Stage progress bar + Won/Lost */}
            {selectedDeal && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {ACTIVE_STAGES.map((step, idx) => {
                      const stage = selectedDeal.stage as StageKey;
                      const state = getStepState(step, stage);
                      const stepConfig = STAGES[step];
                      const isLast = idx === ACTIVE_STAGES.length - 1;
                      const disabled = stage === 'won' || stage === 'lost';
                      return (
                        <div key={step} className="flex items-center gap-2 flex-1">
                          <button
                            onClick={() => !disabled && handleStageChange(step)}
                            disabled={disabled}
                            className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                              state === 'done' ? 'bg-emerald-100'
                              : state === 'current' ? `${stepConfig.color} text-white`
                              : stage === 'lost' ? 'bg-gray-200'
                              : 'bg-gray-100 border border-gray-300'
                            } ${!disabled ? 'hover:shadow-md cursor-pointer' : 'cursor-not-allowed'}`}
                          >
                            {state === 'done' ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            ) : (
                              <span className={`text-xs font-semibold ${state === 'current' ? 'text-white' : stage === 'lost' ? 'text-gray-500' : 'text-gray-700'}`}>{idx + 1}</span>
                            )}
                          </button>
                          <div className={`text-xs font-medium whitespace-nowrap ${
                            state === 'done' ? 'text-emerald-700'
                            : state === 'current' ? 'text-gray-900'
                            : stage === 'lost' ? 'text-gray-400'
                            : 'text-gray-600'
                          }`}>{stepConfig.label}</div>
                          {!isLast && <div className={`flex-1 h-0.5 ${state === 'done' ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
                        </div>
                      );
                    })}
                  </div>
                  {selectedDeal.stage === 'won' ? (
                    <span className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-100 text-emerald-700 shrink-0">✓ Đã thắng</span>
                  ) : selectedDeal.stage === 'lost' ? (
                    <span className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-red-100 text-red-700 shrink-0">✕ Thua</span>
                  ) : (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => handleStageChange('won')} className="px-3 py-1.5 text-[12px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">Won</button>
                      <button onClick={() => handleStageChange('lost')} className="px-3 py-1.5 text-[12px] font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">Lost</button>
                    </div>
                  )}
                </div>
              </div>
            )}

          <div className="flex gap-5">
            {/* Left panel - deal overview + contacts */}
            <div className="w-[300px] shrink-0 space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-xs font-semibold uppercase text-gray-600 mb-4">Tổng quan thương vụ</h3>
                {deals.length === 0 ? (
                  <p className="text-[12.5px] text-[#aaa]">Chưa có thương vụ CRM cho khách hàng này.</p>
                ) : (
                  <>
                    {deals.length > 1 && (
                      <select value={selectedDealId || ''} onChange={e => setSelectedDealId(e.target.value)} className="w-full text-[12.5px] px-2.5 py-1.5 mb-3 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                        {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                      </select>
                    )}
                    {selectedDeal && (
                      <>
                        <div className="mb-4">
                          {editingDealTitle ? (
                            <input
                              autoFocus
                              value={dealTitleInput}
                              onChange={e => setDealTitleInput(e.target.value)}
                              onBlur={handleDealTitleUpdate}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleDealTitleUpdate();
                                if (e.key === 'Escape') setEditingDealTitle(false);
                              }}
                              className="text-[13px] font-semibold text-[#111] mb-1 w-full px-1.5 py-0.5 border border-blue-500 rounded outline-none"
                            />
                          ) : (
                            <button onClick={startEditDealTitle} className="group flex items-center gap-1.5 mb-1">
                              <p className="text-[13px] font-semibold text-[#111] text-left">{selectedDeal.title}</p>
                              <Edit2 size={11} className="text-gray-400 opacity-0 group-hover:opacity-100 transition shrink-0" />
                            </button>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-2xl font-bold text-blue-600">{formatCurrency(selectedDeal.value || 0)}</p>
                            {onOpenDeal && (
                              <button onClick={() => onOpenDeal(selectedDeal.id)} className="text-[11.5px] text-blue-600 hover:underline shrink-0">Mở trong CRM Pipeline →</button>
                            )}
                          </div>
                        </div>
                        <div className="mb-5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-600">Xác suất</span>
                            <span className="text-xs font-semibold text-gray-900">{STAGES[selectedDeal.stage as StageKey]?.prob ?? 0}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div className={`h-2 rounded-full transition-all ${STAGES[selectedDeal.stage as StageKey]?.color || 'bg-gray-400'}`} style={{ width: `${STAGES[selectedDeal.stage as StageKey]?.prob ?? 0}%` }} />
                          </div>
                        </div>
                        <div className="space-y-3 border-t border-gray-200 pt-4">
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1">Người phụ trách</p>
                            <p className="text-sm text-gray-900 font-medium">{selectedDeal.owner || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1">Ngày dự kiến đóng</p>
                            <p className="text-sm font-medium text-gray-900">{formatDate(selectedDeal.expected_closing_date) || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1">Sản phẩm</p>
                            <p className="text-sm text-gray-900 font-medium">{selectedDeal.crm_products?.name || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1">Giai đoạn</p>
                            <p className={`text-sm font-medium ${STAGES[selectedDeal.stage as StageKey]?.textCol || 'text-gray-700'}`}>{STAGES[selectedDeal.stage as StageKey]?.label || selectedDeal.stage}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1">Ngày tạo</p>
                            <p className="text-sm text-gray-900 font-medium">{formatDate(selectedDeal.created_at)}</p>
                          </div>
                        </div>
                        {selectedDeal.notes && (
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <p className="text-xs font-semibold uppercase text-gray-600 mb-2">Ghi chú</p>
                            <p className="text-xs text-gray-700 leading-relaxed">{selectedDeal.notes}</p>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Người liên hệ chính */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-xs font-semibold uppercase text-gray-600 mb-3">Người liên hệ chính</h3>
                {primaryContact ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[#111]">{primaryContact.name}</p>
                    {primaryContact.role && <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">{primaryContact.role}</span>}
                    <p className="text-[12.5px] text-[#555]">{primaryContact.phone || '—'}</p>
                    <p className="text-[12.5px] text-[#555]">{primaryContact.email || '—'}</p>
                  </div>
                ) : (
                  <p className="text-[12.5px] text-[#aaa]">Chưa đặt — chọn ở danh sách bên dưới (biểu tượng ★)</p>
                )}
              </div>

              {/* Full contacts list */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <ContactsTab clientId={client.id} toast={toast} />
              </div>
            </div>

            {/* Right panel - activities */}
            <div className="flex-1 min-w-0">
              <div className="bg-white rounded-lg border border-gray-200 p-4 h-full flex flex-col">
                {!selectedDeal ? (
                  <div className="flex-1 flex items-center justify-center text-[12.5px] text-[#aaa]">
                    Không có thương vụ để ghi nhận hoạt động
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-4 border-b border-gray-200 pb-3">
                      {(['note', 'call', 'email', 'meeting'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => setActiveActivityTab(type)}
                          className={`text-xs font-medium px-3 py-2 rounded transition-colors ${activeActivityTab === type ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                          {type === 'note' && 'Ghi chú'}
                          {type === 'call' && 'Gọi điện'}
                          {type === 'email' && 'Email'}
                          {type === 'meeting' && 'Cuộc họp'}
                        </button>
                      ))}
                    </div>
                    <div className="mb-4 pb-4 border-b border-gray-200">
                      <textarea
                        value={activityContent}
                        onChange={e => setActivityContent(e.target.value)}
                        placeholder="Nội dung..."
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none h-20 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                      />
                      <p className="text-[11px] text-gray-400 mb-2">Sẽ ghi nhận bởi: <span className="font-medium text-gray-600">{user?.full_name || 'System'}</span></p>
                      <button
                        onClick={handleActivitySubmit}
                        disabled={savingActivity}
                        className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        {savingActivity ? 'Đang lưu...' : 'Thêm'}
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-3">
                      {dealActivities.length === 0 ? (
                        <div className="text-center py-8 text-gray-400 text-xs">Không có hoạt động</div>
                      ) : (
                        dealActivities.map(a => {
                          const badge = activityBadge(a.type);
                          return (
                            <div key={a.id} className="pb-3 border-b border-gray-100 last:border-b-0">
                              <div className="flex gap-3">
                                <div className="flex-shrink-0 mt-0.5">{activityIcon(a.type)}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${badge.bg} ${badge.text}`}>{badge.label}</span>
                                    <span className="text-xs text-gray-500">{a.created_by}</span>
                                    <span className="text-xs text-gray-400">{timeAgo(a.created_at)}</span>
                                  </div>
                                  <p className="text-xs text-gray-700 leading-relaxed break-words">{a.content}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quà tặng */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-xs font-semibold uppercase text-gray-600 mb-4 flex items-center gap-1.5"><Gift size={14} className="text-pink-500" /> Quà tặng</h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
              <input
                type="text"
                value={giftForm.item_name}
                onChange={e => setGiftForm({ ...giftForm, item_name: e.target.value })}
                placeholder="Tên quà"
                className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
              />
              <input
                type="number"
                value={giftForm.value}
                onChange={e => setGiftForm({ ...giftForm, value: e.target.value })}
                placeholder="Trị giá (VNĐ)"
                className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
              />
              <input
                type="date"
                value={giftForm.gift_date}
                onChange={e => setGiftForm({ ...giftForm, gift_date: e.target.value })}
                className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
              />
              <select
                value={showNewRecipient ? '__new__' : giftForm.recipient_contact_id}
                onChange={e => {
                  if (e.target.value === '__new__') { setShowNewRecipient(true); return; }
                  setShowNewRecipient(false);
                  setGiftForm({ ...giftForm, recipient_contact_id: e.target.value });
                }}
                className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
              >
                <option value="">Người nhận (CSKH)...</option>
                {cskhContacts.filter(c => c.client_id === client.id).length > 0 && (
                  <optgroup label="⭐ Người phụ trách công ty này">
                    {cskhContacts.filter(c => c.client_id === client.id).map(c => (
                      <option key={c.id} value={c.id}>⭐ {c.name}{c.role ? ` - ${c.role}` : ''}</option>
                    ))}
                  </optgroup>
                )}
                {cskhContacts.filter(c => c.client_id !== client.id).length > 0 && (
                  <optgroup label="Khác (CSKH)">
                    {cskhContacts.filter(c => c.client_id !== client.id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.role ? ` - ${c.role}` : ''}{c.clients?.name ? ` (${c.clients.name})` : ''}</option>
                    ))}
                  </optgroup>
                )}
                <option value="__new__">+ Tạo người nhận mới...</option>
              </select>
              <input
                type="text"
                value={giftForm.notes}
                onChange={e => setGiftForm({ ...giftForm, notes: e.target.value })}
                placeholder="Ghi chú"
                className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
              />
            </div>

            {showNewRecipient && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <input
                  type="text"
                  value={newRecipientForm.name}
                  onChange={e => setNewRecipientForm({ ...newRecipientForm, name: e.target.value })}
                  placeholder="Họ tên *"
                  className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  value={newRecipientForm.phone}
                  onChange={e => setNewRecipientForm({ ...newRecipientForm, phone: e.target.value })}
                  placeholder="SĐT"
                  className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  value={newRecipientForm.role}
                  onChange={e => setNewRecipientForm({ ...newRecipientForm, role: e.target.value })}
                  placeholder="Chức vụ"
                  className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddRecipient}
                    disabled={savingRecipient}
                    className="flex-1 px-3 py-1.5 text-[12.5px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
                  >
                    {savingRecipient ? 'Đang lưu...' : 'Lưu'}
                  </button>
                  <button
                    onClick={() => { setShowNewRecipient(false); setNewRecipientForm({ name: '', phone: '', role: '' }); }}
                    className="px-3 py-1.5 text-[12.5px] font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={handleAddGift}
              disabled={savingGift}
              className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:opacity-50 rounded-lg transition-colors mb-4"
            >
              {savingGift ? 'Đang lưu...' : '+ Thêm quà tặng'}
            </button>
            {gifts.length === 0 ? (
              <p className="text-[12.5px] text-[#aaa]">Chưa có quà tặng nào được ghi nhận.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-gray-200">
                    {['Tên quà', 'Trị giá', 'Ngày tặng', 'Người nhận', 'Ghi chú', 'Tạo bởi'].map(h => (
                      <th key={h} className="text-left px-2 py-1.5 text-[11.5px] text-[#888] font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {gifts.map(g => (
                      <tr key={g.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-2 py-1.5 font-medium">{g.item_name}</td>
                        <td className="px-2 py-1.5">{g.value != null ? formatCurrency(g.value) : '—'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap"><span className="inline-flex items-center gap-1 text-gray-600"><CalendarDays size={12} />{formatDate(g.gift_date)}</span></td>
                        <td className="px-2 py-1.5">{g.recipient_name || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-600">{g.notes || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-400">{g.created_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </div>
        ) : (
          <>
        {/* Info & Contract */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <button onClick={() => setOpenInfo(!openInfo)} className="flex items-center justify-between w-full px-4 py-2.5 border-b border-[#E8E7E2] hover:bg-[#FAFAF8] transition">
            <span className="text-[12.5px] font-semibold text-[#111] flex items-center gap-2">📋 Thông tin & Hợp đồng</span>
            {openInfo ? <ChevronUp size={13} className="text-[#aaa]" /> : <ChevronDown size={13} className="text-[#aaa]" />}
          </button>
          {openInfo && (
            <div className="p-4">
              {editing ? (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex flex-col gap-1 col-span-2">
                      <label className="text-[12px] text-[#666] font-medium">Tên công ty</label>
                      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Chi Nhánh</label>
                      <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                        {!regions.some(r => r.name === form.region) && form.region && <option key={form.region}>{form.region}</option>}
                        {regions.map(r => <option key={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Người quản lý</label>
                      <select value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                        {!managers.some(m => m.name === form.manager) && form.manager && <option key={form.manager}>{form.manager}</option>}
                        {managers.map(m => <option key={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Ngày bắt đầu HĐ</label>
                      <input type="date" value={form.contract_start} onChange={e => setForm({ ...form, contract_start: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Ngày hết hạn HĐ</label>
                      <input type="date" value={form.contract_end} onChange={e => setForm({ ...form, contract_end: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Khu Công Nghiệp</label>
                    <select
                      value={form.industrial_zones[0] || ''}
                      onChange={e => setForm({ ...form, industrial_zones: e.target.value ? [e.target.value] : [] })}
                      className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                    >
                      <option value="">— Chọn khu công nghiệp —</option>
                      {marketZones.map(z => (
                        <option key={z.id} value={z.name}>{z.name}</option>
                      ))}
                    </select>
                    {marketZones.length === 0 && <span className="text-[12px] text-[#aaa]">Chưa có khu vực nào trong Thị trường &gt; Khu vực</span>}
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Ghi chú</label>
                    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 min-h-[60px] resize-y" />
                  </div>

                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Lịch thanh toán & tính lương</label>
                    <div className="space-y-2.5 p-3 rounded-lg border border-gray-300">
                      {([
                        { label: 'Chốt công', start: 'cutoff_day', end: 'cutoff_day_end', dot: 'bg-orange-400' },
                        { label: 'Tính lương', start: 'calc_day', end: 'calc_day_end', dot: 'bg-blue-400' },
                        { label: 'Kỳ thanh toán', start: 'payment_start', end: 'payment_end', dot: 'bg-emerald-500' },
                        { label: 'Phát lương', start: 'salary_day', end: 'salary_day_end', dot: 'bg-purple-500' },
                      ] as { label: string; start: keyof typeof timelineForm; end: keyof typeof timelineForm; dot: string }[]).map(row => (
                        <div key={row.start} className="flex items-center gap-3">
                          <div className="w-[110px] shrink-0 flex items-center gap-1.5 text-[12.5px] font-medium text-[#444]">
                            <span className={`inline-block w-2 h-2 rounded-full ${row.dot}`} />
                            {row.label}
                          </div>
                          <div className="flex-1">
                            <label className="text-[10.5px] text-[#999] block mb-0.5">Ngày bắt đầu</label>
                            <input type="number" min={1} max={31} value={timelineForm[row.start] ?? 1}
                              onChange={e => setTimelineForm({ ...timelineForm, [row.start]: Math.max(1, Math.min(31, +e.target.value)) })}
                              className="w-full text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10.5px] text-[#999] block mb-0.5">Ngày kết thúc</label>
                            <input type="number" min={1} max={31} placeholder="—" value={timelineForm[row.end] ?? ''}
                              onChange={e => { const v = e.target.value; setTimelineForm({ ...timelineForm, [row.end]: v === '' ? null : Math.max(1, Math.min(31, +v)) }); }}
                              className="w-full text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                          </div>
                        </div>
                      ))}
                      <div className="text-[11px] text-[#aaa]">Để trống "Ngày kết thúc" nếu mốc chỉ diễn ra trong 1 ngày.</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={handleSave} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Lưu thay đổi</button>
                    <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Chi Nhánh', client.region],
                    ['Người quản lý', client.manager],
                    ['Ngày bắt đầu HĐ', formatDate(client.contract_start)],
                    ['Ngày hết hạn HĐ', formatDate(client.contract_end)],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <label className="text-[12px] text-[#666] font-medium">{label}</label>
                      <div className="text-[13px] text-[#111] py-1 border-b border-dashed border-[#E8E7E2] min-h-[28px]">{val || '—'}</div>
                    </div>
                  ))}
                  <div className="col-span-2">
                    <label className="text-[12px] text-[#666] font-medium">Khu Công Nghiệp</label>
                    <div className="py-1 border-b border-dashed border-[#E8E7E2] min-h-[28px] flex flex-wrap gap-1.5 items-center">
                      {client.industrial_zones && client.industrial_zones.length > 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">{client.industrial_zones[0]}</span>
                      ) : (
                        <span className="text-[13px] text-[#111]">—</span>
                      )}
                    </div>
                  </div>
                  {client.notes && (
                    <div className="col-span-2">
                      <label className="text-[12px] text-[#666] font-medium">Ghi chú</label>
                      <div className="text-[13px] text-[#111] py-1 border-b border-dashed border-[#E8E7E2]">{client.notes}</div>
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="text-[12px] text-[#666] font-medium">Lịch thanh toán & tính lương</label>
                    <div className="flex flex-wrap gap-2 py-1">
                      {([
                        { label: 'Chốt công', start: client.cutoff_day, end: client.cutoff_day_end, cls: 'bg-orange-50 border-orange-200 text-orange-700' },
                        { label: 'Tính lương', start: client.calc_day, end: client.calc_day_end, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { label: 'Kỳ thanh toán', start: client.payment_start, end: client.payment_end, cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                        { label: 'Phát lương', start: client.salary_day, end: client.salary_day_end, cls: 'bg-purple-50 border-purple-200 text-purple-700' },
                      ]).map(row => (
                        <span key={row.label} className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium border ${row.cls}`}>
                          {row.label}: ngày {row.start}{row.end ? `–${row.end}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Labor Tracking */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <button onClick={() => setOpenLabor(!openLabor)} className="flex items-center justify-between w-full px-4 py-2.5 border-b border-[#E8E7E2] hover:bg-[#FAFAF8] transition">
            <span className="text-[12.5px] font-semibold text-[#111] flex items-center gap-2">👥 Theo dõi Lao động — <span className="text-blue-700">{currentWorkers.toLocaleString()} LĐ hiện tại</span></span>
            {openLabor ? <ChevronUp size={13} className="text-[#aaa]" /> : <ChevronDown size={13} className="text-[#aaa]" />}
          </button>
          {openLabor && (
            <div className="p-4">
              <div className="flex items-center gap-2.5 flex-wrap bg-[#F9F9F7] border border-[#E8E7E2] rounded-lg px-4 py-3 mb-3">
                <RefreshCw size={16} className="text-[#888]" />
                <span className="text-[13px] text-[#555] font-medium">Cập nhật LĐ tuần:</span>
                <select value={laborWeek} onChange={e => selectWeek(e.target.value)} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {weekGroups.map(g => (
                    <optgroup key={g.month} label={g.month}>
                      {g.labels.map(l => <option key={l} value={l}>{l}{l === getCurrentWeekLabel() ? ' (tuần này)' : ''}</option>)}
                    </optgroup>
                  ))}
                </select>
                <input type="number" value={laborInput} onChange={e => setLaborInput(e.target.value)} className="w-[110px] text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                <button onClick={handleLaborUpdate} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Cập nhật</button>
                {laborMsg && <span className="text-[12px] text-emerald-600 inline-flex items-center gap-1">✓ Đã lưu!</span>}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[12px] text-[#888]">Thêm tháng cũ:</span>
                  <input type="month" value={extraMonth} onChange={e => setExtraMonth(e.target.value)} className="text-[12px] px-2 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                  <button onClick={addExtraMonth} className="px-2.5 py-1 rounded-lg text-[12px] font-medium border border-gray-300 text-[#555] hover:bg-white transition">+ Thêm</button>
                </div>
              </div>

              <div className="flex gap-1.5 mb-3">
                <button onClick={() => setChartView('week')} className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition ${chartView === 'week' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500'}`}>📊 Theo tuần</button>
                <button onClick={() => setChartView('month')} className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition ${chartView === 'month' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500'}`}>📅 Theo tháng</button>
              </div>

              <div className="mb-4" style={{ height: 190 }}>
                {chartView === 'week' ? (
                  <Line data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: false } } }} />
                ) : (
                  <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: false } } }} />
                )}
              </div>

              <div className="text-[13px] font-semibold text-[#111] mb-2">Báo cáo tăng giảm theo tháng</div>
              <table className="w-full text-[12.5px]">
                <thead><tr><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Tháng</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Số LĐ cuối tháng</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">So với tháng trước</th></tr></thead>
                <tbody>
                  {monthRows.map(r => {
                    const d = r.cnt !== null && r.prev !== null ? r.cnt - r.prev : null;
                    return (
                      <tr key={r.m} className="border-b border-[#F0EEE9]">
                        <td className="px-3 py-2">{r.m}</td>
                        <td className="px-3 py-2 font-semibold">{r.cnt !== null ? r.cnt.toLocaleString() : '—'}{d !== null && <span className="ml-1" style={{ color: d > 0 ? '#059669' : d < 0 ? '#DC2626' : '#888' }}>({d > 0 ? '+' : ''}{d})</span>}</td>
                        <td className="px-3 py-2 text-[12px] text-[#888]">{d !== null ? (d > 0 ? 'Tăng' : 'Giảm') + ' so tháng trước' : 'Chưa có so sánh'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {hist.length > 0 && (
                <>
                  <div className="text-[13px] font-semibold text-[#111] mt-4 mb-2">Lịch sử nhập liệu</div>
                  <table className="w-full text-[12.5px]">
                    <thead><tr><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Tuần</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Số LĐ</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Người cập nhật</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Ngày điền</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]"></th></tr></thead>
                    <tbody>
                      {[...hist].reverse().slice(0, 12).map(h => (
                        <tr key={h.id} className="border-b border-[#F0EEE9]">
                          <td className="px-3 py-2">{h.week_label}</td>
                          <td className="px-3 py-2 font-semibold">{h.count.toLocaleString()}</td>
                          <td className="px-3 py-2 text-[#888]">{h.updated_by || '—'}</td>
                          <td className="px-3 py-2 text-[#888]">{formatDate(h.created_at)}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => { setLaborWeek(h.week_label); setLaborInput(String(h.count)); }} className="text-[11.5px] text-blue-600 hover:underline">Sửa</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </>
  );
}
