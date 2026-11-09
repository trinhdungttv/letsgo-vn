// ============================================================================
// Thị trường → Nguồn LĐ (thay tab Báo giá cũ, 09/11/2026).
// Đơn vị nguồn = trường ĐH / CĐ / Trung cấp, trung tâm, địa phương — nguồn SV thực tập đưa vào công ty điện tử.
// Kiểu Apple như CSKH. Nối với: Bản đồ (ghim + đo đường), Khảo sát KCN (trường gần KCN), Khách hàng / Công ty
// (đợt gửi SV, gợi ý ghép), Ngành Nghề (ngành đào tạo ↔ ngành công ty), CSKH (người liên hệ tệp Sale / CTV),
// Workspace (nhắc trước mùa thực tập).
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, ClipboardList, Database, LayoutGrid, List, Loader2, Plus, Sparkles } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { foldVn } from '../../../lib/companyMatch';
import { useAuth } from '../../../lib/auth';
import { useBranchLookup } from '../../../hooks/useBranchLookup';
import { todayVN } from '../../../lib/cskh/dates';
import { EMPTY_LABOR_DATA, LABOR_CHANGED_EVENT, loadLaborData, type LaborData } from '../../../lib/laborSources/api';
import { buildCompanies, buildTargets, mergeRoutes, routeIndex, routeLookupKey } from '../../../lib/laborSources/targets';
import { upcomingMonths } from '../../../lib/laborSources/windows';
import { batchStats } from '../../../lib/laborSources/match';
import { MIGRATION_213_HINT, type LaborSource, type RouteRow } from '../../../lib/laborSources/types';
import { PageTitle, Segmented } from '../../../modules/cskh/components/apple';
import { PILL_GRAY, PILL_PRIMARY } from '../../../modules/cskh/ui';
import type { MarketTabProps } from '../shared';
import { LaborContext, OPEN_SOURCE_KEY, type GroupLite, type IndustryLite, type LaborCtx, type UserLite } from './context';
import OverviewView from './OverviewView';
import ListView from './ListView';
import CalendarView from './CalendarView';
import MatchView from './MatchView';
import SourceProfile from './SourceProfile';
import SourceForm from './SourceForm';
import BulkAddSheet from './BulkAddSheet';

type View = 'overview' | 'list' | 'calendar' | 'match';
const VIEW_KEY = 'lgvn_labor_view_v1';
const readView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' || v === 'calendar' || v === 'match' ? v : 'overview';
  } catch { return 'overview'; }
};

const groupBy = <T, K extends string>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> => {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
};

export default function LaborSourcesTab({ marketZones, marketLeads, clients, competitors, zoneFilter, setZoneFilter, goTab, toast }: MarketTabProps) {
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const [data, setData] = useState<LaborData>(EMPTY_LABOR_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [industries, setIndustries] = useState<IndustryLite[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [view, setViewState] = useState<View>(readView);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LaborSource | 'new' | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [routing, setRouting] = useState<string | null>(null);
  // KCN nhận từ nút "Nguồn LĐ gần KCN" (Khu vực / Khảo sát) — chỉ đọc 1 lần khi mở tab
  const [nearZone] = useState(() => (zoneFilter && zoneFilter !== 'all' ? marketZones.find(z => z.name === zoneFilter)?.id ?? '' : ''));
  const today = todayVN();

  const setView = (v: View) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* bỏ qua */ }
  };

  const reload = useCallback(async () => {
    try {
      const d = await loadLaborData();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Không tải được dữ liệu Nguồn LĐ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void supabase.from('industries').select('id, name, season_levels').order('name')
      .then(({ data: rows, error: e }) => {
        if (!e) { setIndustries((rows ?? []) as IndustryLite[]); return; }
        // DB chưa có cột season_levels → đọc tên thôi
        void supabase.from('industries').select('id, name').order('name')
          .then(({ data: r2 }) => setIndustries(((r2 ?? []) as { id: string; name: string }[]).map(x => ({ ...x, season_levels: null }))));
      });
    void supabase.from('app_users').select('id, full_name').order('full_name')
      .then(({ data: rows }) => setUsers((rows ?? []) as UserLite[]));
    // Nhóm của tệp Sale / CTV (người liên hệ của trường nằm ở tệp này)
    void supabase.from('cskh_groups').select('*').order('name')
      .then(({ data: rows }) => setGroups(((rows ?? []) as (GroupLite & { kind?: string | null; is_archived?: boolean | null })[])
        .filter(g => g.kind === 'sale' && !g.is_archived)
        .map(g => ({ id: g.id, name: g.name, base_tier: g.base_tier ?? null }))));
    const onChanged = () => { void reload(); };
    window.addEventListener(LABOR_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LABOR_CHANGED_EVENT, onChanged);
  }, [reload]);

  // KCN từ tab khác chỉ dùng 1 lần — trả bộ lọc chung về "Tất cả" để các tab khác không bị lọc theo
  useEffect(() => { if (zoneFilter !== 'all') setZoneFilter('all'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mở hồ sơ theo yêu cầu từ nơi khác (Bản đồ, Khảo sát KCN, hồ sơ KH…)
  useEffect(() => {
    const take = () => {
      try {
        const id = sessionStorage.getItem(OPEN_SOURCE_KEY);
        if (id) { sessionStorage.removeItem(OPEN_SOURCE_KEY); setOpenId(id); }
      } catch { /* bỏ qua */ }
    };
    take();
    window.addEventListener('lgvn:open-labor-source', take);
    return () => window.removeEventListener('lgvn:open-labor-source', take);
  }, []);

  const addRoutes = useCallback((rows: RouteRow[]) => {
    if (rows.length) setData(d => ({ ...d, routes: mergeRoutes(d.routes, rows) }));
  }, []);

  // Đối thủ: cùng 1 công ty có thể có nhiều dòng (mỗi KCN 1 dòng) → gộp theo tên
  const competitorInfo = useMemo(() => {
    const nameOf = new Map<string, string>();
    const options = new Map<string, { id: string; name: string }>();
    for (const c of competitors) {
      const name = (c.company_name ?? '').trim();
      if (!name) continue;
      nameOf.set(c.id, name);
      const k = foldVn(name);
      if (!options.has(k)) options.set(k, { id: c.id, name });
    }
    return { nameOf, options: [...options.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')) };
  }, [competitors]);

  const ctx = useMemo<LaborCtx>(() => {
    const routeIdx = routeIndex(data.routes);
    const windowsBy = groupBy(data.windows, w => w.source_id);
    const monthsBy = new Map<string, number[]>();
    for (const [id, ws] of windowsBy) monthsBy.set(id, upcomingMonths(ws, today));
    return {
      data, loading, today, user,
      zones: marketZones, clients, leads: marketLeads, branches, industries, users, groups,
      competitorOptions: competitorInfo.options,
      competitorNames: ids => [...new Set(ids.map(id => competitorInfo.nameOf.get(id)).filter((n): n is string => !!n))],
      targets: buildTargets({ zones: marketZones, clients, leads: marketLeads, branches }),
      companies: buildCompanies({ zones: marketZones, clients, leads: marketLeads, industries }),
      programsBy: groupBy(data.programs, p => p.source_id),
      windowsBy,
      batchesBy: groupBy(data.batches, b => b.source_id),
      contactsBy: groupBy(data.contacts, c => c.labor_source_id),
      monthsBy,
      routeIdx,
      route: (sourceId, type, id) => routeIdx.get(routeLookupKey(sourceId, type, id)),
      reload, addRoutes, routing, setRouting, toast,
      openSource: id => setOpenId(id),
      editSource: s => setEditing(s ?? 'new'),
      goTab: (t, zone) => goTab(t, zone),
    };
  }, [data, loading, today, user, marketZones, clients, marketLeads, branches, industries, users, groups, competitorInfo, reload, addRoutes, routing, toast, goTab]);

  const stats = useMemo(() => batchStats(data.batches), [data.batches]);
  const partners = data.sources.filter(s => s.status === 'partner').length;
  const openSource = openId ? data.sources.find(s => s.id === openId) ?? null : null;

  return (
    <LaborContext.Provider value={ctx}>
      {/* Nền xám nhạt kiểu Apple tràn mép vùng cuộn của Thị trường */}
      <div className="-mx-3 md:-mx-5 -mb-3 md:-mb-5 px-3 md:px-5 pt-1 pb-8 bg-[#F5F5F7] min-h-[70vh] space-y-4 md:space-y-5">
        <PageTitle
          eyebrow="Thị trường · Nguồn lao động"
          title="Nguồn Lao Động"
          subtitle={data.ready
            ? <>{data.sources.length} đơn vị · {partners} đang hợp tác{stats.sent > 0 && <> · đã gửi {stats.sent.toLocaleString('vi-VN')} SV, đạt {stats.passed.toLocaleString('vi-VN')} ({Math.round((stats.rate ?? 0) * 100)}%)</>}</>
            : 'Trường ĐH / CĐ / Trung cấp, trung tâm, địa phương — nguồn sinh viên thực tập'}
          actions={data.ready ? (
            <>
              <button type="button" onClick={() => setBulkOpen(true)} className={PILL_GRAY} title="Dán nhiều trường 1 lượt (từ Excel / Zalo)"><ClipboardList size={16} /> Nhập nhanh danh sách</button>
              <button type="button" onClick={() => setEditing('new')} className={PILL_PRIMARY}><Plus size={16} strokeWidth={2.4} /> Thêm đơn vị nguồn</button>
            </>
          ) : undefined}
        />

        {loading ? (
          <div className="py-16 flex items-center justify-center gap-2 text-[13px] text-[#86868B]"><Loader2 size={16} className="animate-spin" /> Đang tải…</div>
        ) : error ? (
          <div className="rounded-[14px] bg-[#FF3B30]/10 text-[#D70015] text-[13px] px-4 py-3">{error}</div>
        ) : !data.ready ? (
          <div className="rounded-[18px] bg-white px-5 py-6 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)] flex items-start gap-3">
            <span className="w-10 h-10 rounded-full bg-[#FF9500]/[0.14] text-[#B25000] flex items-center justify-center shrink-0"><Database size={18} /></span>
            <div className="text-[13.5px] text-[#1D1D1F]">
              <p className="font-semibold">Chưa có bảng dữ liệu Nguồn LĐ</p>
              <p className="text-[#6E6E73] mt-1">{MIGRATION_213_HINT} File: <code className="text-[12px]">supabase/migrations/20261109100000_213_labor_sources.sql</code></p>
            </div>
          </div>
        ) : (
          <>
            <Segmented<View>
              label="Màn Nguồn LĐ"
              value={view}
              onChange={setView}
              keepLabels
              options={[
                { key: 'overview', label: 'Tổng quan', icon: <LayoutGrid size={14} /> },
                { key: 'list', label: 'Danh sách', icon: <List size={14} />, badge: data.sources.length || undefined },
                { key: 'calendar', label: 'Lịch thực tập', icon: <CalendarRange size={14} /> },
                { key: 'match', label: 'Ghép công ty', icon: <Sparkles size={14} /> },
              ]}
            />
            {view === 'overview' && <OverviewView onGo={setView} />}
            {view === 'list' && <ListView initialZoneId={nearZone} />}
            {view === 'calendar' && <CalendarView />}
            {view === 'match' && <MatchView />}
          </>
        )}
      </div>

      {routing && (
        <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 z-[85] h-9 px-4 rounded-full bg-[#1D1D1F]/90 text-white text-[12.5px] font-medium inline-flex items-center gap-2 shadow-lg backdrop-blur">
          <Loader2 size={14} className="animate-spin" /> {routing}
        </div>
      )}

      {bulkOpen && <BulkAddSheet onClose={() => setBulkOpen(false)} />}
      {openSource && <SourceProfile source={openSource} onClose={() => setOpenId(null)} />}
      {editing && (
        <SourceForm
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={s => { setEditing(null); void reload(); if (editing === 'new') setOpenId(s.id); }}
        />
      )}
    </LaborContext.Provider>
  );
}
