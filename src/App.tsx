import { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import { useAppData } from './hooks/useAppData';
import { useCRMData } from './hooks/useCRMData';
import { useAuth, AuthProvider, canAccess } from './lib/auth';
import type { Page, Client, LaborHistoryEntry, ClientManagerHistory, MarketZone, FinanceRecord, CRMProduct, CRMDeal as CRMDealType, CRMActivity } from './lib/types';
import { supabase } from './lib/supabase';
import { logActivity } from './lib/audit';
import { usePersistedState } from './hooks/usePersistedState';
import { sortLaborHistory } from './lib/format';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Branches from './pages/Branches';
import Finance from './pages/Finance';
import Market from './pages/Market';
import Reports from './pages/Reports';
import UserManagement from './pages/UserManagement';
import History from './pages/History';
import CRMDash from './pages/CRMDash';
import CRMBoard from './pages/CRMBoard';
import CRMLeads from './pages/CRMLeads';
import CRMProds from './pages/CRMProds';
import CRMDeal from './pages/CRMDeal';
import CRMPipeline from './pages/CRMPipeline';
import AdminPage from './pages/AdminPage';
import Workspace from './pages/Workspace';
import Loans from './pages/Loans';

const PAGES: Page[] = ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'market', 'reports', 'users', 'history', 'crm-dash', 'crm-board', 'crm-leads', 'crm-prods', 'crm-deal', 'crm-pipeline', 'admin-settings', 'workspace', 'loans'];

function Toast({ message }: { message: string }) {
  if (!message) return null;
  return <div className="fixed bottom-6 right-6 bg-[#111] text-white px-4 py-2.5 rounded-lg text-[13px] z-50 shadow-lg">{message}</div>;
}

function AppInner() {
  const { user, loading: authLoading, logout, rolePermissions } = useAuth();

  const {
    clients, setClients,
    laborHistory, setLaborHistory,
    managerHistory, setManagerHistory,
    finance, setFinance,
    marketSurveys, competitors, marketZones, setMarketZones, marketLeads,
    loading, error,
    loadClients, loadFinance, loadMarket,
  } = useAppData(!!user);

  const {
    leads,
    products, setProducts,
    deals, setDeals,
    activities, setActivities,
    pipeline,
    reloadPipeline,
  } = useCRMData(!!user);

  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem('lgvn_page');
    return saved && PAGES.includes(saved as Page) ? (saved as Page) : 'dashboard';
  });
  const [activeRegion, setActiveRegion] = usePersistedState<string[]>('lgvn_activeRegion', ['Tất cả']);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => localStorage.getItem('lgvn_selectedClientId'));
  const [selectedDealId, setSelectedDealId] = useState<string | null>(() => localStorage.getItem('lgvn_selectedDealId'));

  // Persist current page/selection so a page reload (F5) returns to the same place
  useEffect(() => { localStorage.setItem('lgvn_page', page); }, [page]);
  useEffect(() => {
    if (selectedClientId) localStorage.setItem('lgvn_selectedClientId', selectedClientId);
    else localStorage.removeItem('lgvn_selectedClientId');
  }, [selectedClientId]);
  useEffect(() => {
    if (selectedDealId) localStorage.setItem('lgvn_selectedDealId', selectedDealId);
    else localStorage.removeItem('lgvn_selectedDealId');
  }, [selectedDealId]);

  // Load data needed by the restored page on first mount
  useEffect(() => {
    if (page === 'finance' || page === 'workspace') loadFinance('2026-06');
    if (page === 'market') loadMarket();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard against a restored page the current user no longer has access to
  useEffect(() => {
    if (user && rolePermissions.length && !canAccess(user.role, page, rolePermissions)) setPage('dashboard');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, rolePermissions]);
  const [toastMsg, setToastMsg] = useState('');
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer) clearTimeout(toastTimer);
    const t = setTimeout(() => setToastMsg(''), 2500);
    setToastTimer(t);
  }, [toastTimer]);

  const navigate = useCallback((p: Page) => {
    setPage(p);
    if (p === 'finance' || p === 'workspace') loadFinance('2026-06');
    if (p === 'market') loadMarket();
  }, [loadFinance, loadMarket]);

  const [branchFocusRegion, setBranchFocusRegion] = useState<string | null>(null);
  const openBranch = useCallback((region: string) => {
    setBranchFocusRegion(region);
    setPage('branches');
  }, []);

  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
    setPage('client-detail');
  }, []);

  const [pipelineFocusId, setPipelineFocusId] = useState<string | null>(null);
  const openPipelineEntry = useCallback((crmId: string) => {
    setPipelineFocusId(crmId);
    setPage('crm-pipeline');
  }, []);

  const handleSelectDeal = useCallback((id: string) => {
    setSelectedDealId(id);
    setPage('crm-deal');
  }, []);

  const handleClientUpdate = useCallback((updated: Client) => {
    setClients(prev => prev.map(c => c.id === updated.id ? updated : c));
  }, [setClients]);

  const handleLaborUpdate = useCallback((entry: LaborHistoryEntry) => {
    setLaborHistory(prev => {
      const arr = prev[entry.client_id] || [];
      const idx = arr.findIndex(e => e.id === entry.id);
      const newArr = idx >= 0 ? arr.map((e, i) => i === idx ? entry : e) : [...arr, entry];
      return { ...prev, [entry.client_id]: newArr };
    });
    setClients(prev => {
      const client = prev.find(c => c.id === entry.client_id);
      if (!client) return prev;
      const hist = laborHistory[entry.client_id] || [];
      const allHist = sortLaborHistory([...hist.filter(e => e.id !== entry.id), entry]);
      const latest = allHist[allHist.length - 1]?.count ?? client.current_workers;
      return prev.map(c => c.id === entry.client_id ? { ...c, current_workers: latest } : c);
    });
  }, [setLaborHistory, setClients, laborHistory]);

  const handleMarketZoneAdd = useCallback((zone: MarketZone) => {
    setMarketZones(prev => [...prev, zone].sort((a, b) => a.name.localeCompare(b.name)));
  }, [setMarketZones]);

  const handleManagerHistoryAdd = useCallback((entry: ClientManagerHistory) => {
    setManagerHistory(prev => ({ ...prev, [entry.client_id]: [...(prev[entry.client_id] || []), entry] }));
  }, [setManagerHistory]);

  const handleFinanceUpdate = useCallback((rec: FinanceRecord) => {
    setFinance(prev => prev.map(r => r.id === rec.id ? rec : r));
  }, [setFinance]);

  // CRM handlers
  const handleDealActivate = useCallback((newClient: Client) => {
    setClients(prev => [...prev, newClient]);
    setSelectedClientId(newClient.id);
    setPage('client-detail');
  }, [setClients]);
  const handleProductCreate = useCallback((p: CRMProduct) => setProducts(prev => [...prev, p]), [setProducts]);
  const handleProductUpdate = useCallback((p: CRMProduct) => setProducts(prev => prev.map(x => x.id === p.id ? p : x)), [setProducts]);
  const handleProductDelete = useCallback((id: string) => setProducts(prev => prev.filter(x => x.id !== id)), [setProducts]);
  const handleDealCreate = useCallback((d: CRMDealType) => setDeals(prev => [d, ...prev]), [setDeals]);
  const handleDealUpdate = useCallback((d: CRMDealType) => {
    setDeals(prev => prev.map(x => x.id === d.id ? d : x));
    if (selectedDealId === d.id) setSelectedDealId(d.id);
  }, [setDeals, selectedDealId]);
  const handleActivityCreate = useCallback((a: CRMActivity) => setActivities(prev => [a, ...prev]), [setActivities]);

  const handleAddClient = useCallback(async (regionName?: string, managerName?: string) => {
    const name = prompt('Ten cong ty *:');
    if (!name) return;
    const region = prompt('Khu vuc:', regionName || 'Bien Hoa') || regionName || 'Bien Hoa';
    const manager = prompt('Nguoi quan ly:', managerName || '') || '';
    const ctEnd = prompt('Ngay het han HD (YYYY-MM-DD):', '2027-06-01') || '';

    // Chọn loại hình dịch vụ: leasing (cho thuê) hoặc recruitment (giới thiệu).
    const serviceTypeRaw = prompt(
      'Loai hinh dich vu:\n  1 = Cho thue lao dong (leasing)\n  2 = Gioi thieu lao dong (recruitment)\nNhap 1 hoac 2:',
      '1'
    );
    const serviceType = serviceTypeRaw?.trim() === '2' ? 'recruitment' : 'leasing';

    // Các trường chu kỳ chỉ áp dụng cho leasing.
    const leasingFields = serviceType === 'leasing'
      ? { cutoff_day: 25, calc_day: 27, salary_day: 5, payment_start: 5, payment_end: 8 }
      : { cutoff_day: null, calc_day: null, salary_day: null, payment_start: null, payment_end: null };

    // Thời hạn công nợ chỉ có ý nghĩa với recruitment (mặc định 30 ngày).
    const paymentTermDays = serviceType === 'recruitment'
      ? parseInt(prompt('So ngay cong no sau xuat hoa don (mac dinh 30):', '30') || '30', 10) || 30
      : 30;

    try {
      const { data, error } = await supabase.from('clients').insert({
        name,
        region,
        manager,
        contract_end: ctEnd || null,
        status: 'ok',
        client_type: 'active',
        service_type: serviceType,
        payment_term_days: paymentTermDays,
        ...leasingFields,
      }).select().single();
      if (error) throw error;
      await loadClients();
      toast('Da them khach hang moi!');
      await logActivity({
        user, action: 'insert', table: 'clients', recordId: data.id,
        description: `Them khach hang moi "${name}" (${region}) - ${serviceType === 'recruitment' ? 'Gioi thieu lao dong' : 'Cho thue lao dong'}`,
        newData: data,
      });
    } catch (e: unknown) {
      toast('Loi: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [loadClients, toast, user]);

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F4EF]">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Login />;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F4EF]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-[13px] text-[#888]">Đang tải dữ liệu...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F4EF]">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md text-center">
          <div className="text-red-800 font-semibold mb-2">Lỗi kết nối</div>
          <div className="text-red-700 text-[13px] mb-4">{error}</div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg text-[12px] font-medium bg-red-600 text-white hover:bg-red-700 transition">Thử lại</button>
            <button onClick={logout} className="px-4 py-2 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Đăng xuất</button>
          </div>
        </div>
      </div>
    );
  }

  const selectedClient = selectedClientId ? clients.find(c => c.id === selectedClientId) || null : null;
  const selectedDeal = selectedDealId ? deals.find(d => d.id === selectedDealId) || null : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#F1F0EA]">
      <Sidebar currentPage={page} onNavigate={navigate} />
      <div className="flex-1 flex flex-col overflow-hidden bg-[#F5F4EF]">
        {page === 'dashboard' && <Dashboard clients={clients} onOpenBranch={openBranch} onOpenClient={handleSelectClient} onOpenPipelineEntry={openPipelineEntry} onClientUpdate={handleClientUpdate} />}
        {page === 'clients' && (
          <Clients
            clients={clients}
            laborHistory={laborHistory}
            activeRegion={activeRegion}
            onRegionChange={setActiveRegion}
            onSelectClient={handleSelectClient}
            onAddClient={handleAddClient}
            onClientUpdate={handleClientUpdate}
            onLaborUpdate={handleLaborUpdate}
            onReload={loadClients}
            isAdmin={user?.role === 'admin'}
            marketZones={marketZones}
            onMarketZoneAdd={handleMarketZoneAdd}
            toast={toast}
          />
        )}
        {page === 'client-detail' && selectedClient && (
          <ClientDetail
            client={selectedClient}
            laborHistory={laborHistory[selectedClient.id] || []}
            managerHistory={managerHistory[selectedClient.id] || []}
            products={products}
            onBack={() => setPage('clients')}
            onClientUpdate={handleClientUpdate}
            onLaborUpdate={handleLaborUpdate}
            onManagerHistoryAdd={handleManagerHistoryAdd}
            onMarketZoneAdd={handleMarketZoneAdd}
            marketZones={marketZones}
            toast={toast}
            onOpenDeal={handleSelectDeal}
          />
        )}
        {page === 'branches' && (
          <div className="flex-1 overflow-y-auto p-5">
            <Branches clients={clients} toast={toast} focusRegion={branchFocusRegion} onFocusConsumed={() => setBranchFocusRegion(null)} />
          </div>
        )}
        {page === 'finance' && (
          <Finance finance={finance} clients={clients} onLoadFinance={loadFinance} onFinanceUpdate={handleFinanceUpdate} onClientUpdate={handleClientUpdate} toast={toast} />
        )}
        {page === 'market' && (
          <Market marketSurveys={marketSurveys} competitors={competitors} marketZones={marketZones} marketLeads={marketLeads} clients={clients} onRefresh={loadMarket} toast={toast} />
        )}
        {page === 'reports' && <Reports clients={clients} laborHistory={laborHistory} />}
        {page === 'users' && <UserManagement toast={toast} />}
        {page === 'history' && <History toast={toast} onReload={loadClients} />}
        {page === 'admin-settings' && <AdminPage toast={toast} />}
        {page === 'loans' && <Loans toast={toast} />}
        {page === 'workspace' && (
          <Workspace clients={clients} finance={finance} pipeline={pipeline} onNavigate={navigate} onClientUpdate={handleClientUpdate} toast={toast} />
        )}
        {/* CRM Module */}
        {page === 'crm-dash' && (
          <CRMDash leads={leads} activities={activities} clients={clients} pipeline={pipeline} isAdmin={user?.role === 'admin'} onNavigate={navigate} />
        )}
        {page === 'crm-board' && (
          <CRMBoard
            deals={deals} products={products}
            onDealUpdate={handleDealUpdate} onDealCreate={handleDealCreate}
            onSelectDeal={handleSelectDeal} onDealActivate={handleDealActivate}
            toast={toast}
          />
        )}
        {page === 'crm-leads' && (
          <CRMLeads clients={clients} products={products} toast={toast} />
        )}
        {page === 'crm-prods' && (
          <CRMProds
            products={products} deals={deals}
            onProductCreate={handleProductCreate} onProductUpdate={handleProductUpdate} onProductDelete={handleProductDelete}
            toast={toast}
          />
        )}
        {page === 'crm-deal' && selectedDeal && (
          <CRMDeal
            deal={selectedDeal} leads={leads} products={products}
            activities={activities.filter(a => a.deal_id === selectedDeal.id)}
            onDealUpdate={handleDealUpdate} onActivityCreate={handleActivityCreate}
            onBack={() => setPage('crm-board')} toast={toast}
          />
        )}
        {page === 'crm-pipeline' && (
          <CRMPipeline
            pipeline={pipeline}
            products={products}
            onRefresh={reloadPipeline}
            onDealCreate={handleDealCreate}
            toast={toast}
            focusEntryId={pipelineFocusId}
            onFocusHandled={() => setPipelineFocusId(null)}
          />
        )}
      </div>
      <Toast message={toastMsg} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
