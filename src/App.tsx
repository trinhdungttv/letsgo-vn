import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import MobileBackBar from './components/MobileBackBar';
import { useAppData } from './hooks/useAppData';
import { useCRMData } from './hooks/useCRMData';
import { useAuth, AuthProvider, canAccess } from './lib/auth';
import type { Page, Client, LaborHistoryEntry, ClientManagerHistory, MarketZone, FinanceRecord, CRMProduct, CRMDeal as CRMDealType, CRMActivity } from './lib/types';
import { usePersistedState } from './hooks/usePersistedState';
import { useKeepPopoversOnScreen } from './hooks/useKeepPopoversOnScreen';
import { sortLaborHistory } from './lib/format';
import { shortId, expandId } from './hooks/useHashSubRoute';

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
import CRMSales from './pages/CRMSales';
import CRMProds from './pages/CRMProds';
import CRMDeal from './pages/CRMDeal';
import CRMPipeline from './pages/CRMPipeline';
import AdminPage from './pages/AdminPage';
import Workspace from './pages/Workspace';
import Loans from './pages/Loans';
import SharedCostPlan from './pages/SharedCostPlan';
import { parseShareHash } from './lib/costPlan/api';
import UpcomingDatesReminder from './components/contacts/UpcomingDatesReminder';
import CareAutomationRunner from './modules/cskh/CareAutomationRunner';
import ReleaseUpdatePrompt from './components/ReleaseUpdatePrompt';
import { OFFICE_PAGES, isOfficePage } from './modules/office-rental/pages';
import { CARD, BTN_PRIMARY, BTN_SECONDARY } from './components/workspace/wsTheme';

// Văn phòng Orient: tải bundle riêng khi mở (nhân viên không phải admin không bao giờ tải)
const OfficeRental = lazy(() => import('./modules/office-rental'));

const PAGES: Page[] = ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'market', 'reports', 'users', 'history', 'crm-dash', 'crm-board', 'crm-leads', 'crm-sales', 'crm-prods', 'crm-deal', 'crm-pipeline', 'admin-settings', 'workspace', 'loans', ...OFFICE_PAGES];

function Toast({ message }: { message: string }) {
  if (!message) return null;
  // Mobile: nằm giữa, phía trên thanh điều hướng dưới (không bị che/đè lên nút).
  return <div className="fixed left-4 right-4 bottom-[calc(68px+env(safe-area-inset-bottom))] text-center md:text-left md:left-auto md:right-6 md:bottom-6 bg-[#1D1D1F]/90 backdrop-blur-xl text-white px-4 py-2.5 rounded-[12px] text-[13px] z-[90] shadow-[0_12px_32px_-6px_rgba(0,0,0,0.3)]">{message}</div>;
}

function AppInner() {
  const { user, loading: authLoading, logout, rolePermissions } = useAuth();
  // Menu thả xuống bị lòi ra ngoài mép màn hình (điện thoại) → tự dịch vào trong
  useKeepPopoversOnScreen();

  // Link chia sẻ "Phương án giá" (#/p/<mã>) — mở được KHÔNG cần đăng nhập, chỉ cần mã 4 số.
  // Khi đang ở link này thì không nạp dữ liệu toàn app (người ngoài không có quyền).
  const [shareCode, setShareCode] = useState<string | null>(() => parseShareHash(window.location.hash));
  useEffect(() => {
    const sync = () => setShareCode(parseShareHash(window.location.hash));
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);

  const {
    clients, setClients,
    laborHistory, setLaborHistory,
    managerHistory, setManagerHistory,
    finance, setFinance,
    marketSurveys, competitors, marketZones, setMarketZones, marketLeads,
    loading, error,
    loadClients, loadFinance, loadMarket,
  } = useAppData(!!user && !shareCode);

  const {
    leads,
    products, setProducts,
    deals, setDeals,
    activities, setActivities,
    pipeline,
    reloadPipeline,
  } = useCRMData(!!user && !shareCode);

  function parseHash(): Page {
    const h = window.location.hash.replace('#/', '').split('/')[0];
    return h && PAGES.includes(h as Page) ? (h as Page) : 'dashboard';
  }

  const [page, setPageRaw] = useState<Page>(() => {
    const fromHash = window.location.hash.length > 2 ? parseHash() : null;
    if (fromHash) return fromHash;
    const saved = localStorage.getItem('lgvn_page');
    return saved && PAGES.includes(saved as Page) ? (saved as Page) : 'dashboard';
  });

  const skipHashSync = useRef(false);

  const setPage = useCallback((p: Page, replace = false) => {
    setPageRaw(p);
    const newHash = `#/${p}`;
    if (window.location.hash !== newHash) {
      skipHashSync.current = true;
      if (replace) {
        window.history.replaceState(null, '', newHash);
      } else {
        window.history.pushState(null, '', newHash);
      }
    }
  }, []);

  const resolveHashIds = useCallback(() => {
    const parts = window.location.hash.replace('#/', '').split('/');
    const page = parts[0];
    const sub = parts[1];
    if (page === 'client-detail' && sub) {
      const id = expandId(sub, clients) || clients.find(c => c.id === sub)?.id || null;
      if (id) setSelectedClientId(id);
    }
    if (page === 'crm-deal' && sub) {
      const id = expandId(sub, deals) || deals.find(d => d.id === sub)?.id || null;
      if (id) setSelectedDealId(id);
    }
  }, [clients, deals]);

  useEffect(() => {
    const onNav = () => {
      if (skipHashSync.current) { skipHashSync.current = false; return; }
      const p = parseHash();
      setPageRaw(p);
      resolveHashIds();
      if (p === 'finance' || p === 'workspace') loadFinance('2026-06');
      if (p === 'market') loadMarket();
    };
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    return () => { window.removeEventListener('popstate', onNav); window.removeEventListener('hashchange', onNav); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFinance, loadMarket, resolveHashIds]);

  // CRM (hồ sơ công ty) sửa NCC/ảnh tuyển dụng của Thị trường → nạp lại để trang Thị trường không
  // giữ dữ liệu cũ rồi ghi đè lên khi bấm lưu.
  useEffect(() => {
    const onMarketChanged = () => { loadMarket(); loadClients(); };
    window.addEventListener('lgvn:market-changed', onMarketChanged);
    return () => window.removeEventListener('lgvn:market-changed', onMarketChanged);
  }, [loadMarket, loadClients]);

  useEffect(() => {
    if (!window.location.hash || window.location.hash === '#/') {
      window.history.replaceState(null, '', `#/${page}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { resolveHashIds(); }, [resolveHashIds]);

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
    if (user && rolePermissions.length && !canAccess(user.role, page, rolePermissions)) setPage('dashboard', true);
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

  // Chặn mở thẳng URL #/office… / #/crm-sales khi không có quyền (chỉ admin) → về trang chính + báo
  useEffect(() => {
    if (user && (isOfficePage(page) || page === 'crm-sales') && !canAccess(user.role, page, rolePermissions)) {
      setPage('dashboard', true);
      toast(page === 'crm-sales' ? 'Chỉ tài khoản admin được vào Mạng lưới Sale' : 'Chỉ tài khoản admin được vào Văn phòng Orient');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, user, rolePermissions]);

  // Điện thoại không có nút back của trình duyệt: trang mở bằng liên kết trong trang khác (không phải bấm
  // thanh điều hướng) nhớ trang vừa rời để hiện thanh "‹ Trang trước". Bấm thanh điều hướng thì xoá.
  const [backCtx, setBackCtx] = useState<{ from: Page; to: Page } | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const rememberBack = useCallback((to: Page) => {
    const from = pageRef.current;
    setBackCtx(from === to ? null : { from, to });
  }, []);

  const goTo = useCallback((p: Page) => {
    setPage(p);
    if (p === 'finance' || p === 'workspace') loadFinance('2026-06');
    if (p === 'market') loadMarket();
  }, [setPage, loadFinance, loadMarket]);

  // Liên kết trong trang (Workspace, CRM…) → nhớ trang trước
  const navigate = useCallback((p: Page) => {
    rememberBack(p);
    goTo(p);
  }, [rememberBack, goTo]);

  // Thanh bên / thanh điều hướng dưới → chuyển mục chính, không có "trang trước"
  const navigateTop = useCallback((p: Page) => {
    setBackCtx(null);
    goTo(p);
  }, [goTo]);

  const [branchFocusRegion, setBranchFocusRegion] = useState<string | null>(null);
  const openBranch = useCallback((region: string) => {
    setBranchFocusRegion(region);
    rememberBack('branches');
    setPage('branches');
  }, [setPage, rememberBack]);

  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
    setPageRaw('client-detail');
    const sid = shortId(id);
    window.history.pushState(null, '', `#/client-detail/${sid}`);
  }, []);

  const [pipelineFocusId, setPipelineFocusId] = useState<string | null>(null);
  const openPipelineEntry = useCallback((crmId: string) => {
    setPipelineFocusId(crmId);
    rememberBack('crm-pipeline');
    setPage('crm-pipeline');
  }, [setPage, rememberBack]);

  const handleSelectDeal = useCallback((id: string) => {
    setSelectedDealId(id);
    setPageRaw('crm-deal');
    const sid = shortId(id);
    window.history.pushState(null, '', `#/crm-deal/${sid}`);
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

  if (shareCode) return <SharedCostPlan code={shareCode} />;

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F5F7]">
        <div className="w-5 h-5 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Login />;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F5F7]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin" />
          <div className="text-[13px] text-[#86868B]">Đang tải dữ liệu...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F5F7] p-4">
        <div className={`${CARD} p-6 max-w-md text-center`}>
          <div className="text-[#D70015] text-[17px] font-semibold mb-1.5">Lỗi kết nối</div>
          <div className="text-[#6E6E73] text-[13px] mb-5">{error}</div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => window.location.reload()} className={`${BTN_PRIMARY} px-4 py-2 text-[13px]`}>Thử lại</button>
            <button onClick={logout} className={`${BTN_SECONDARY} px-4 py-2 text-[13px]`}>Đăng xuất</button>
          </div>
        </div>
      </div>
    );
  }

  const selectedClient = selectedClientId ? clients.find(c => c.id === selectedClientId) || null : null;
  const selectedDeal = selectedDealId ? deals.find(d => d.id === selectedDealId) || null : null;

  return (
    // 100dvh: chiều cao viewport động — tự khớp khi thanh địa chỉ Safari ẩn/hiện; h-screen là fallback cho trình duyệt cũ
    <div className="flex h-screen overflow-hidden bg-[#F5F5F7]" style={{ height: '100dvh' }}>
      <div className="hidden md:flex shrink-0">
        <Sidebar currentPage={page} onNavigate={navigateTop} />
      </div>
      <MobileNav currentPage={page} onNavigate={navigateTop} />
      <div className="flex-1 flex flex-col overflow-hidden bg-[#F5F5F7] pt-[env(safe-area-inset-top)] pb-[calc(52px+max(6px,env(safe-area-inset-bottom)))] md:pt-0 md:pb-0">
        {backCtx && backCtx.to === page && <MobileBackBar from={backCtx.from} onBack={() => window.history.back()} />}
        {page === 'dashboard' && <Dashboard clients={clients} laborHistory={laborHistory} managerHistory={managerHistory} onOpenBranch={openBranch} onOpenClient={handleSelectClient} onOpenPipelineEntry={openPipelineEntry} onOpenWorkspace={() => navigate('workspace')} onClientUpdate={handleClientUpdate} />}
        {page === 'clients' && (
          <Clients
            clients={clients}
            laborHistory={laborHistory}
            activeRegion={activeRegion}
            onRegionChange={setActiveRegion}
            onSelectClient={handleSelectClient}
            onClientUpdate={handleClientUpdate}
            onLaborUpdate={handleLaborUpdate}
            onManagerHistoryAdd={handleManagerHistoryAdd}
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
            onBack={() => window.history.back()}
            onClientUpdate={handleClientUpdate}
            onLaborUpdate={handleLaborUpdate}
            onManagerHistoryAdd={handleManagerHistoryAdd}
            onMarketZoneAdd={handleMarketZoneAdd}
            marketZones={marketZones}
            toast={toast}
            onOpenDeal={handleSelectDeal}
            clients={clients}
          />
        )}
        {page === 'branches' && (
          <div className="flex-1 overflow-y-auto p-3 md:p-5">
            <Branches clients={clients} toast={toast} focusRegion={branchFocusRegion} onFocusConsumed={() => setBranchFocusRegion(null)} />
          </div>
        )}
        {page === 'finance' && (
          <Finance finance={finance} clients={clients} onLoadFinance={loadFinance} onFinanceUpdate={handleFinanceUpdate} onClientUpdate={handleClientUpdate} toast={toast} />
        )}
        {page === 'market' && (
          <Market marketSurveys={marketSurveys} competitors={competitors} marketZones={marketZones} marketLeads={marketLeads} clients={clients} laborHistory={laborHistory} onRefresh={async () => { await Promise.all([loadMarket(), loadClients()]); }} toast={toast} />
        )}
        {page === 'reports' && <Reports clients={clients} laborHistory={laborHistory} />}
        {page === 'users' && <UserManagement toast={toast} />}
        {page === 'history' && <History toast={toast} onReload={loadClients} />}
        {page === 'admin-settings' && <AdminPage toast={toast} />}
        {page === 'loans' && <Loans toast={toast} />}
        {isOfficePage(page) && user && canAccess(user.role, page, rolePermissions) && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin" /></div>}>
            <OfficeRental page={page} toast={toast} />
          </Suspense>
        )}
        {page === 'workspace' && (
          <Workspace clients={clients} finance={finance} pipeline={pipeline} products={products} onNavigate={navigate} onClientUpdate={handleClientUpdate} toast={toast} />
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
          <CRMLeads clients={clients} products={products} onSelectClient={handleSelectClient} onNavigate={navigate} toast={toast} />
        )}
        {page === 'crm-sales' && user && canAccess(user.role, page, rolePermissions) && (
          <CRMSales clients={clients} onNavigate={navigate} toast={toast} />
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
            onBack={() => window.history.back()} toast={toast}
          />
        )}
        {page === 'crm-pipeline' && (
          <CRMPipeline
            pipeline={pipeline}
            clients={clients}
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
      {user && <UpcomingDatesReminder userId={user.id} />}
      {/* Việc nhắc tự động CSKH: mỗi ngày 1 lần khi mở app, không cần mở trang CSKH */}
      {user && <CareAutomationRunner clients={clients} toast={toast} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
      {/* Ngoài AppInner để hiện ở mọi màn hình (kể cả đăng nhập / đang tải), không phụ thuộc đăng nhập */}
      <ReleaseUpdatePrompt />
    </AuthProvider>
  );
}
