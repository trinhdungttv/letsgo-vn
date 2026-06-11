import { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import { useAppData } from './hooks/useAppData';
import { useCRMData } from './hooks/useCRMData';
import { useAuth, AuthProvider } from './lib/auth';
import type { Page, Client, LaborHistoryEntry, FinanceRecord, CRMProduct, CRMDeal as CRMDealType, CRMActivity } from './lib/types';
import { supabase } from './lib/supabase';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Finance from './pages/Finance';
import Market from './pages/Market';
import Quotes from './pages/Quotes';
import Reports from './pages/Reports';
import UserManagement from './pages/UserManagement';
import CRMDash from './pages/CRMDash';
import CRMBoard from './pages/CRMBoard';
import CRMLeads from './pages/CRMLeads';
import CRMProds from './pages/CRMProds';
import CRMDeal from './pages/CRMDeal';
import CRMPipeline from './pages/CRMPipeline';

function Toast({ message }: { message: string }) {
  if (!message) return null;
  return <div className="fixed bottom-6 right-6 bg-[#111] text-white px-4 py-2.5 rounded-lg text-[13px] z-50 shadow-lg">{message}</div>;
}

function AppInner() {
  const { user, loading: authLoading, logout } = useAuth();

  const {
    clients, setClients,
    laborHistory, setLaborHistory,
    finance, setFinance,
    marketSurveys, competitors,
    loading, error,
    loadClients, loadFinance, loadMarket,
  } = useAppData(!!user);

  const {
    leads, setLeads,
    products, setProducts,
    deals, setDeals,
    activities, setActivities,
    pipeline,
    reloadPipeline,
  } = useCRMData(!!user);

  const [page, setPage] = useState<Page>('dashboard');
  const [activeRegion, setActiveRegion] = useState('Tất cả');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
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
    if (p === 'finance') loadFinance('2026-06');
    if (p === 'market') loadMarket();
  }, [loadFinance, loadMarket]);

  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
    setPage('client-detail');
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
      const allHist = [...hist.filter(e => e.id !== entry.id), entry].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const latest = allHist[allHist.length - 1]?.count ?? client.current_workers;
      return prev.map(c => c.id === entry.client_id ? { ...c, current_workers: latest } : c);
    });
  }, [setLaborHistory, setClients, laborHistory]);

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
  const handleDealCreate = useCallback((d: CRMDealType) => setDeals(prev => [d, ...prev]), [setDeals]);
  const handleDealUpdate = useCallback((d: CRMDealType) => {
    setDeals(prev => prev.map(x => x.id === d.id ? d : x));
    if (selectedDealId === d.id) setSelectedDealId(d.id);
  }, [setDeals, selectedDealId]);
  const handleActivityCreate = useCallback((a: CRMActivity) => setActivities(prev => [a, ...prev]), [setActivities]);

  const handleAddClient = useCallback(async (regionName?: string, managerName?: string) => {
    const name = prompt('Tên công ty *:');
    if (!name) return;
    const region = prompt('Khu vực:', regionName || 'Biên Hòa') || regionName || 'Biên Hòa';
    const manager = prompt('Người quản lý:', managerName || '') || '';
    const ctEnd = prompt('Ngày hết hạn HĐ (YYYY-MM-DD):', '2027-06-01') || '';
    try {
      const { error } = await supabase.from('clients').insert({ name, region, manager, contract_end: ctEnd || null, status: 'ok', client_type: 'active', cutoff_day: 25, payment_start: 5, payment_end: 8 });
      if (error) throw error;
      await loadClients();
      toast('Đã thêm khách hàng mới!');
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  }, [loadClients, toast]);

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
        {page === 'dashboard' && <Dashboard clients={clients} />}
        {page === 'clients' && (
          <Clients
            clients={clients}
            laborHistory={laborHistory}
            activeRegion={activeRegion}
            onRegionChange={setActiveRegion}
            onSelectClient={handleSelectClient}
            onAddClient={handleAddClient}
            onClientUpdate={handleClientUpdate}
            isAdmin={user?.role === 'admin'}
            toast={toast}
          />
        )}
        {page === 'client-detail' && selectedClient && (
          <ClientDetail
            client={selectedClient}
            laborHistory={laborHistory[selectedClient.id] || []}
            onBack={() => setPage('clients')}
            onClientUpdate={handleClientUpdate}
            onLaborUpdate={handleLaborUpdate}
            toast={toast}
          />
        )}
        {page === 'finance' && (
          <Finance finance={finance} clients={clients} onLoadFinance={loadFinance} onFinanceUpdate={handleFinanceUpdate} onClientUpdate={handleClientUpdate} toast={toast} />
        )}
        {page === 'market' && (
          <Market marketSurveys={marketSurveys} competitors={competitors} onRefresh={loadMarket} toast={toast} />
        )}
        {page === 'quotes' && (
          <Quotes marketSurveys={marketSurveys} competitors={competitors} toast={toast} />
        )}
        {page === 'reports' && <Reports clients={clients} laborHistory={laborHistory} />}
        {page === 'users' && <UserManagement toast={toast} />}

        {/* CRM Module */}
        {page === 'crm-dash' && (
          <CRMDash deals={deals} leads={leads} activities={activities} onNavigate={navigate} />
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
          <CRMLeads clients={clients} toast={toast} />
        )}
        {page === 'crm-prods' && (
          <CRMProds
            products={products} deals={deals}
            onProductCreate={handleProductCreate} onProductUpdate={handleProductUpdate}
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
          <CRMPipeline pipeline={pipeline} onRefresh={reloadPipeline} toast={toast} />
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
