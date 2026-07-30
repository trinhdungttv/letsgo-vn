// Màn "Tính bảng lương" — vỏ UI. MỌI công thức tài chính nằm ở src/features/salary/*, file này
// chỉ nối state ↔ engine ↔ hiển thị. Không thêm phép tính tiền nào ở đây: thêm một chỗ tính là
// thêm một nguồn sự thật, đúng thứ bản cũ mắc phải (BUG-1).
import { useEffect, useMemo, useState } from 'react';
import { X, Calculator, AlertTriangle, Download, Upload, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import SearchSelect from '../../pages/market/SearchSelect';
import { fetchRegionWages, fetchMinWageBatches, type RegionZone } from '../../pages/market/regionWage';
import type { MinWageBatch } from '../../lib/minWage';
import { fetchWageFieldRows, type WageField } from '../../pages/market/wageFields';
import MinWageStaleBanner from '../MinWageStaleBanner';
import RegionPriceCompare, { type CompareImport } from './payroll/RegionPriceCompare';

import {
  buildWageTable, equivalentHours, actualHours, computeRevenue, computePnL,
  checkSalaryCompliance, priceBookFromServiceFee, deriveShr, amountForShr,
} from '../../features/salary/salaryEngine';
import { computeCompetitive } from '../../features/salary/competitiveEngine';
import { toLegacyEntryAmount, fromLegacyEntryAmount } from '../../features/salary/wageRows';
import {
  wageDetailFromTable, clientWageDetailFromRevenue, pickEntryFromWageDetail, allowanceLinesFromWageDetail,
} from '../../features/salary/marketBridge';
import {
  loadDraftV2, saveDraftV2, clearDraftV2, DEFAULT_UI, MIGRATION_NOTICE,
  type DraftUiState,
} from '../../features/salary/draftV2';
import { migrate } from '../../features/salary/migrate';
import ScenarioForm from '../../features/salary/ui/ScenarioForm';
import WageTableView from '../../features/salary/ui/WageTableView';
import PnLView from '../../features/salary/ui/PnLView';
import CompetitiveView from '../../features/salary/ui/CompetitiveView';
import { fmtVnd } from '../../features/salary/ui/primitives';
import type {
  Scenario, WageBasis, VolumeProfile, PriceBook, OverheadConfig, ServiceFeeConfig,
  AllowanceLine, WageCode, SupplierQuote,
} from '../../features/salary/types';

import type { Client, Competitor, MarketZone, MarketLead, MarketLeadSupplier } from '../../lib/types';

function parseCompanySelect(v: string): { type: 'client' | 'lead'; id: string } | null {
  if (v.startsWith('client:')) return { type: 'client', id: v.slice(7) };
  if (v.startsWith('lead:')) return { type: 'lead', id: v.slice(5) };
  return null;
}

interface Props {
  clients: Client[];
  toast: (msg: string) => void;
  onClose: () => void;
}

const US_NAME = "Let's Go VN";

const RESULT_TABS = [
  { key: 'table', label: 'Bảng đơn giá' },
  { key: 'pnl', label: 'Lời / lỗ' },
  { key: 'competitive', label: 'Cạnh tranh' },
] as const;
type ResultTab = typeof RESULT_TABS[number]['key'];

export function PayrollCalculatorModal({ clients, toast, onClose }: Props) {
  const { user } = useAuth();
  const [draft0] = useState(loadDraftV2);
  const [scenario, setScenario] = useState<Scenario>(draft0.scenario);
  const [ui, setUi] = useState<DraftUiState>(draft0.ui);
  const [migrationNotice, setMigrationNotice] = useState(!!draft0.migratedFromV1);

  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [resultTab, setResultTab] = useState<ResultTab>('table');
  const [fullscreen, setFullscreen] = useState(() => localStorage.getItem('payroll_calc_fullscreen') === '1');
  useEffect(() => { localStorage.setItem('payroll_calc_fullscreen', fullscreen ? '1' : '0'); }, [fullscreen]);

  const [regionWages, setRegionWages] = useState<Record<RegionZone, number> | null>(null);
  const [minWageBatches, setMinWageBatches] = useState<MinWageBatch[]>([]);
  const [marketZones, setMarketZones] = useState<MarketZone[]>([]);
  const [wageFields, setWageFields] = useState<WageField[]>([]);
  const [competitorsDb, setCompetitorsDb] = useState<Competitor[]>([]);
  const [marketLeads, setMarketLeads] = useState<MarketLead[]>([]);
  const [companySuppliers, setCompanySuppliers] = useState<MarketLeadSupplier[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchRegionWages().then(setRegionWages);
    fetchMinWageBatches().then(setMinWageBatches);
    fetchWageFieldRows().then(setWageFields);
    supabase.from('market_zones').select('id, name').order('name').then(({ data }) => { if (data) setMarketZones(data as MarketZone[]); });
    supabase.from('competitors').select('id, company_name, wage_paid').then(({ data }) => { if (data) setCompetitorsDb(data as Competitor[]); });
    supabase.from('market_leads').select('id, company_name, suppliers').then(({ data }) => { if (data) setMarketLeads(data as MarketLead[]); });
  }, []);

  useEffect(() => { saveDraftV2(scenario, ui); }, [scenario, ui]);

  // ── Setter tiện dụng ─────────────────────────────────────────────────────────────────────
  const setBasis = (patch: Partial<WageBasis>) =>
    setScenario(s => ({ ...s, us: { ...s.us, basis: { ...s.us.basis, ...patch } } }));
  const setVolume = (v: VolumeProfile) => setScenario(s => ({ ...s, volume: v }));
  const setPriceBook = (patch: Partial<PriceBook>) => setScenario(s => ({ ...s, priceBook: { ...s.priceBook, ...patch } }));
  const setOverhead = (patch: Partial<OverheadConfig>) => setScenario(s => ({ ...s, overhead: { ...s.overhead, ...patch } }));
  const setServiceFee = (patch: Partial<ServiceFeeConfig>) => setScenario(s => ({ ...s, serviceFee: { ...s.serviceFee, ...patch } }));
  const setAllowances = (next: AllowanceLine[]) => setScenario(s => ({ ...s, us: { ...s.us, allowances: next } }));

  const { us, volume, priceBook, overhead, serviceFee } = scenario;
  const basis = us.basis;
  const isUs = us.supplierName.trim() === US_NAME;

  // ── Engine ───────────────────────────────────────────────────────────────────────────────
  const table = useMemo(() => buildWageTable(basis), [basis]);
  const eh = useMemo(() => equivalentHours(table, volume), [table, volume]);
  const ah = useMemo(() => actualHours(table, volume), [table, volume]);
  const revenue = useMemo(() => computeRevenue(table, volume, priceBook, us.allowances), [table, volume, priceBook, us.allowances]);
  const pnl = useMemo(
    () => computePnL(basis, volume, priceBook, us.allowances, overhead, serviceFee),
    [basis, volume, priceBook, us.allowances, overhead, serviceFee],
  );
  const competitive = useMemo(
    () => computeCompetitive(basis, volume, priceBook, us.allowances, overhead, scenario.competitors, ui.deltaPercent, new Date(), minWageBatches),
    [basis, volume, priceBook, us.allowances, overhead, scenario.competitors, ui.deltaPercent, minWageBatches],
  );
  const banners = useMemo(
    () => basis.shrPay > 0 ? checkSalaryCompliance(basis, pnl, new Date(), minWageBatches) : [],
    [basis, pnl, minWageBatches],
  );
  const blocked = banners.some(b => b.blocksSave);
  const hasInput = basis.shrPay > 0;

  // ── Ô "số tiền tương ứng" ────────────────────────────────────────────────────────────────
  // Neo của cả bảng: gõ ở đây là ĐỊNH NGHĨA LẠI SHR. Khoá tay từng dòng (ô trên bảng bên phải)
  // là chuyện khác — nó chỉ đè đúng dòng đó. Để hai thứ không đánh nhau, gõ vào ô này sẽ gỡ khoá
  // tay của chính dòng đang chọn.
  const entryAmount = amountForShr(ui.entryCode, basis.shrPay, basis.workdaysPerMonth, {
    priorDayOt: basis.priorDayOt, includeHolidayBasePay: basis.includeHolidayBasePay,
  });
  const onEntryAmountChange = (amount: number) => {
    const shrPay = deriveShr(ui.entryCode, amount, basis.workdaysPerMonth, {
      priorDayOt: basis.priorDayOt, includeHolidayBasePay: basis.includeHolidayBasePay,
    });
    const overrides = { ...basis.overrides };
    delete overrides[ui.entryCode];
    setBasis({ shrPay, overrides });
  };
  const onEntryCodeChange = (code: WageCode) => setUi(u => ({ ...u, entryCode: code, entrySourceField: null }));

  const onOverride = (code: WageCode, value: number | null) => {
    const overrides = { ...basis.overrides };
    if (value == null || value <= 0) delete overrides[code]; else overrides[code] = value;
    setBasis({ overrides });
  };
  const onQty = (code: WageCode, value: number) =>
    setVolume({ ...volume, id: 'custom', name: 'Tuỳ chỉnh', quantities: { ...volume.quantities, [code]: value } });
  const onCustomerPrice = (code: WageCode, value: number | null) => {
    const manual = { ...priceBook.manual };
    if (value == null || value <= 0) delete manual[code]; else manual[code] = value;
    setPriceBook({ manual });
  };

  const onGeneratePriceBook = () => {
    const generated = priceBookFromServiceFee(basis, volume, us.allowances, overhead, serviceFee);
    setPriceBook({ mode: 'manual', manual: generated });
    toast('Đã sinh bảng giá khách từ phí dịch vụ');
  };

  // ── Đối thủ (L5) ─────────────────────────────────────────────────────────────────────────
  const addCompetitor = () => {
    const id = `c_${Date.now()}`;
    const q: SupplierQuote = {
      id, supplierName: '', isUs: false,
      basis: { ...basis, shrPay: basis.shrPay, overrides: {} },
      allowances: [],
    };
    setScenario(s => ({ ...s, competitors: [...s.competitors, q] }));
    setUi(u => ({ ...u, competitorEntryCodes: { ...u.competitorEntryCodes, [id]: ui.entryCode } }));
  };
  const patchCompetitor = (id: string, patch: Partial<SupplierQuote>) =>
    setScenario(s => ({ ...s, competitors: s.competitors.map(c => c.id === id ? { ...c, ...patch } : c) }));
  const removeCompetitor = (id: string) =>
    setScenario(s => ({ ...s, competitors: s.competitors.filter(c => c.id !== id) }));
  const onCompetitorAmount = (id: string, amount: number) => {
    const c = scenario.competitors.find(x => x.id === id);
    if (!c) return;
    const code = ui.competitorEntryCodes[id] ?? 'day_wage_8h';
    patchCompetitor(id, {
      basis: { ...c.basis, workdaysPerMonth: basis.workdaysPerMonth, shrPay: deriveShr(code, amount, basis.workdaysPerMonth, { priorDayOt: c.basis.priorDayOt }) },
    });
  };
  const applyProposed = () => {
    setBasis({ shrPay: competitive.shrProposed, overrides: {} });
    toast(`Đã áp mức đề xuất ${fmtVnd(competitive.shrProposed)}đ/giờ vào bảng lương`);
    setResultTab('table');
  };

  // ── Thị trường ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sel = parseCompanySelect(ui.companySelect);
    if (!sel) { setCompanySuppliers([]); return; }
    const table_ = sel.type === 'client' ? 'clients' : 'market_leads';
    const column = sel.type === 'client' ? 'market_suppliers' : 'suppliers';
    supabase.from(table_).select(column).eq('id', sel.id).maybeSingle()
      .then(({ data }) => setCompanySuppliers(((data as Record<string, MarketLeadSupplier[] | null> | null)?.[column] ?? [])));
  }, [ui.companySelect]);

  const companyOptions = useMemo(() => [
    ...clients.map(c => ({ value: `client:${c.id}`, label: c.name })),
    ...marketLeads.map(l => ({ value: `lead:${l.id}`, label: `${l.company_name} (đang tìm hiểu)` })),
  ], [clients, marketLeads]);
  const zoneOptions = useMemo(() => marketZones.map(z => ({ value: z.id, label: z.name })), [marketZones]);
  const supplierOptions = useMemo(() => {
    const names = new Set<string>([US_NAME]);
    competitorsDb.forEach(c => { if (c.company_name) names.add(c.company_name); });
    companySuppliers.forEach(s => { if (s.name) names.add(s.name); });
    const named = [...names].sort((a, b) => (a === US_NAME ? -1 : b === US_NAME ? 1 : a.localeCompare(b, 'vi'))).map(n => ({ value: n, label: n }));
    return [...named, { value: '', label: 'Chưa rõ NCC (điền sau)' }];
  }, [competitorsDb, companySuppliers]);

  function handleCompanySelect(v: string) {
    setUi(u => ({ ...u, companySelect: v }));
    const sel = parseCompanySelect(v);
    const name = sel?.type === 'client' ? clients.find(c => c.id === sel.id)?.name
      : sel?.type === 'lead' ? marketLeads.find(l => l.id === sel.id)?.company_name : v;
    setScenario(s => ({ ...s, customerName: name ?? v }));
  }
  function handleKcnSelect(v: string) {
    setUi(u => ({ ...u, kcnSelect: v }));
    const match = marketZones.find(z => z.id === v);
    setScenario(s => ({ ...s, industrialZone: match ? match.name : v }));
  }

  function pullFromMarket() {
    const supplier = companySuppliers.find(s => (isUs ? s.is_us : s.name === us.supplierName.trim()));
    if (!supplier) { toast(`Công ty này chưa có bảng lương của "${us.supplierName}" ở Thị trường`); return; }
    const picked = pickEntryFromWageDetail(supplier.wage_detail, wageFields, basis.workdaysPerMonth, basis.priorDayOt);
    if (!picked) { toast('Bảng lương NCC này chưa có khoản nào gán được loại đơn giá theo luật'); return; }
    setBasis({ shrPay: picked.shrPay, overrides: {} });
    setAllowances(allowanceLinesFromWageDetail(supplier.wage_detail, wageFields));
    setUi(u => ({ ...u, entryCode: picked.code, entrySourceField: picked.fieldName }));
    setResultTab('table');
    toast(`Đã lấy lương "${supplier.name}" (${picked.fieldName}) từ Thị trường`);
  }

  async function syncToMarket() {
    const sel = parseCompanySelect(ui.companySelect);
    if (!sel) { toast('Chọn "Khách hàng / Công ty đang tìm hiểu" trước khi đồng bộ sang Thị trường'); return; }
    const table_ = sel.type === 'client' ? 'clients' : 'market_leads';
    const column = sel.type === 'client' ? 'market_suppliers' : 'suppliers';
    const targetLabel = sel.type === 'client'
      ? clients.find(c => c.id === sel.id)?.name
      : marketLeads.find(l => l.id === sel.id)?.company_name;
    if (!targetLabel) { toast('Không tìm thấy hồ sơ đã chọn'); return; }
    const targetName = isUs ? US_NAME : us.supplierName.trim();
    if (!targetName) { toast('Chọn NCC trước khi đồng bộ'); return; }

    const { data, error: readErr } = await supabase.from(table_).select(column).eq('id', sel.id).maybeSingle();
    if (readErr) { toast('Không đọc được bảng NCC hiện tại: ' + readErr.message); return; }
    const list = ((data as Record<string, MarketLeadSupplier[] | null> | null)?.[column] ?? []);
    const idx = list.findIndex(s => (isUs ? s.is_us : s.name === targetName));
    const previous = idx >= 0 ? (list[idx].wage_detail ?? {}) : {};
    const allowanceWorker = Object.fromEntries(us.allowances.filter(a => a.name.trim() && a.weOweWorker > 0).map(a => [a.name.trim(), a.weOweWorker]));
    const wageDetail = wageDetailFromTable(table, wageFields, basis.workdaysPerMonth, allowanceWorker, previous);

    const changed = Object.keys(wageDetail).filter(k => previous[k] !== wageDetail[k]);
    if (changed.length === 0) { toast('Không có khoản nào thay đổi — bỏ qua đồng bộ'); return; }
    const willOverwrite = changed.filter(k => previous[k] != null);
    const summary = changed.slice(0, 8)
      .map(k => `• ${k}: ${previous[k] != null ? `${previous[k].toLocaleString('vi-VN')} → ` : ''}${wageDetail[k].toLocaleString('vi-VN')}đ`)
      .join('\n');
    const ok = confirm(
      `Ghi bảng lương của "${targetName}" tại ${targetLabel} (Thị trường):\n\n${summary}` +
      (changed.length > 8 ? `\n… và ${changed.length - 8} khoản nữa` : '') +
      (willOverwrite.length > 0 ? `\n\n⚠ ${willOverwrite.length} khoản đang có số cũ sẽ bị GHI ĐÈ.` : '') +
      `\n\nTiếp tục?`,
    );
    if (!ok) return;

    setSyncing(true);
    const next: MarketLeadSupplier[] = idx >= 0
      ? list.map((s, i) => i === idx ? { ...s, wage_detail: wageDetail } : s)
      : [...list, { name: targetName, qty: 0, is_us: isUs, wage_min: null, wage_max: null, wage_detail: wageDetail }];
    const { error } = await supabase.from(table_).update({ [column]: next }).eq('id', sel.id);
    setSyncing(false);
    if (error) { toast('Đồng bộ lỗi: ' + error.message); return; }
    setCompanySuppliers(next);
    toast(`Đã đồng bộ bảng lương "${targetName}" sang Thị trường (${changed.length} khoản)`);
  }

  // ── Lưu ──────────────────────────────────────────────────────────────────────────────────
  async function save() {
    if (!hasInput || blocked || !scenario.customerName.trim()) return;
    setSaving(true);
    const sel = parseCompanySelect(ui.companySelect);
    const zoneMatch = marketZones.find(z => z.id === ui.kcnSelect);
    const allowanceWorker = Object.fromEntries(us.allowances.filter(a => a.name.trim() && a.weOweWorker > 0).map(a => [a.name.trim(), a.weOweWorker]));
    const allowanceClient = Object.fromEntries(us.allowances.filter(a => a.name.trim() && a.customerPays > 0).map(a => [a.name.trim(), a.customerPays]));

    const { error } = await supabase.from('quote_requests').insert({
      company_name: scenario.customerName.trim(),
      kcn_name: scenario.industrialZone.trim() || null,
      kcn_zone_id: zoneMatch?.id ?? null,
      client_id: sel?.type === 'client' ? sel.id : null,
      market_lead_id: sel?.type === 'lead' ? sel.id : null,
      supplier_name: isUs ? null : us.supplierName.trim() || null,
      is_us: isUs,
      contact_note: us.contactNote?.trim() || null,
      input_type: ui.entryCode,
      // Ghi theo ĐƠN VỊ CŨ để các bản ghi trước/sau nâng cấp đọc chung được một thang đo.
      input_value: Math.round(toLegacyEntryAmount(entryAmount, ui.entryCode, basis.workdaysPerMonth)),
      prior_day_ot: basis.priorDayOt,
      region: basis.region,
      working_days_per_month: basis.workdaysPerMonth,
      service_fee_type: priceBook.mode === 'singleDayRate' ? 'customer_price_direct' : serviceFee.type,
      service_fee_value: priceBook.mode === 'singleDayRate' ? (priceBook.singleDayRate ?? 0) : serviceFee.value,
      referral_duration_mode: serviceFee.type === 'referral_hourly' ? serviceFee.durationMode : null,
      referral_months: serviceFee.type === 'referral_daily_limited'
        || (serviceFee.type === 'referral_hourly' && serviceFee.durationMode === 'recurring_months') ? serviceFee.months : null,
      vat_rate: priceBook.vatPercent / 100,
      computed_shr: Math.round(basis.shrPay),
      rate_overrides: basis.overrides,
      wage_detail: wageDetailFromTable(table, wageFields, basis.workdaysPerMonth, allowanceWorker),
      wage_detail_client: clientWageDetailFromRevenue(revenue, wageFields, basis.workdaysPerMonth, allowanceClient),
      result_json: {
        version: 2, scenario,
        summary: {
          revenueMonth: pnl.revenueMonth, costPerHeadMonth: pnl.costPerHeadMonth,
          netProfitMonth: pnl.netProfitMonth, netMarginMonthPercent: pnl.netMarginMonthPercent,
          netProfit: pnl.netProfit, netMarginPercent: pnl.netMarginPercent,
          equivalentHours: pnl.equivalentHours, breakEvenPerWorkday: pnl.breakEvenPerWorkday,
          shrPayMax: competitive.us.shrPayMax,
          shrProposed: competitive.shrProposed, flagCannotWin: competitive.flagCannotWin,
        },
      },
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) { toast('Có lỗi khi lưu: ' + error.message); return; }
    toast(`Đã lưu bảng lương ${isUs ? '' : `của ${us.supplierName} `}cho ${scenario.customerName.trim()}`);
    clearDraftV2();
    onClose();
  }

  function resetForm() {
    if (!confirm('Làm mới toàn bộ dữ liệu đang nhập ở tab "Tính 1 bảng lương"? Nội dung chưa lưu sẽ mất.')) return;
    clearDraftV2();
    setScenario(migrate({}));
    setUi(DEFAULT_UI);
    setResultTab('table');
    setMigrationNotice(false);
    toast('Đã làm mới bảng tính');
  }

  // ── Cầu nối tab "So sánh giá dịch vụ" (component cũ, vẫn theo đơn vị CŨ) ─────────────────
  function getSingleTabSnapshot(): CompareImport | null {
    if (!hasInput) return null;
    const customerDay = revenue.rows.find(r => r.code === 'day_wage_8h')?.customerUnitPrice ?? 0;
    return {
      source: [!isUs && us.supplierName.trim() ? us.supplierName.trim() : '', scenario.customerName.trim()].filter(Boolean).join(' @ ') || 'Giá chúng tôi báo',
      type: ui.entryCode,
      value: Math.round(toLegacyEntryAmount(entryAmount, ui.entryCode, basis.workdaysPerMonth)),
      priorDayOt: basis.priorDayOt,
      workerSupport: us.allowances.reduce((s, a) => s + a.weOweWorker, 0),
      clientSupportPaid: us.allowances.reduce((s, a) => s + a.customerPays, 0),
      customerPriceValue: customerDay,
      workingDays: basis.workdaysPerMonth,
      region: basis.region,
      note: 'Từ tab Tính 1 bảng lương',
    };
  }

  function handleUseForQuote(input: CompareImport & { kcnZoneId: string; kcnName: string }) {
    const amount = fromLegacyEntryAmount(input.value, input.type, input.workingDays);
    setScenario(s => ({
      ...s,
      industrialZone: input.kcnName,
      priceBook: input.customerPriceValue > 0
        ? { ...s.priceBook, mode: 'singleDayRate', singleDayRate: Math.round(input.customerPriceValue) }
        : s.priceBook,
      us: {
        ...s.us,
        basis: {
          ...s.us.basis,
          shrPay: deriveShr(input.type, amount, input.workingDays, { priorDayOt: input.priorDayOt }),
          priorDayOt: input.priorDayOt, region: input.region, workdaysPerMonth: input.workingDays,
          overrides: {},
        },
        allowances: input.clientSupportPaid > 0 || input.workerSupport > 0
          ? [{ id: `al_${Date.now()}`, name: 'Phụ cấp / phụ phí', customerPays: Math.round(input.clientSupportPaid), weOweWorker: Math.round(input.workerSupport), taxable: false }]
          : s.us.allowances,
      },
    }));
    setUi(u => ({ ...u, entryCode: input.type, entrySourceField: null, kcnSelect: input.kcnZoneId || u.kcnSelect }));
    setResultTab('table');
    setMode('single');
    toast('Đã đưa giá từ bảng so sánh sang Tính bảng lương');
  }

  return (
    <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${fullscreen ? 'p-0' : 'p-4'}`}>
      <div className={`bg-white shadow-xl flex flex-col ${fullscreen ? 'w-screen h-screen max-w-none max-h-none rounded-none' : 'rounded-xl w-full max-w-6xl max-h-[92vh]'}`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2] shrink-0">
          <h2 className="text-[14px] font-semibold text-[#111] flex items-center gap-1.5">
            <Calculator size={16} className="text-blue-600" /> Tính bảng lương
            <span className="text-[10.5px] font-normal text-[#aaa]">· tự lưu nháp, đóng lại vẫn còn</span>
          </h2>
          <div className="flex items-center gap-1">
            {mode === 'single' && (
              <button onClick={resetForm} title="Xoá hết dữ liệu đang nhập, bắt đầu bảng mới"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-medium text-[#666] hover:bg-gray-100 transition">
                <RotateCcw size={12} /> Làm mới
              </button>
            )}
            <button onClick={() => setFullscreen(v => !v)} title={fullscreen ? 'Thu nhỏ lại' : 'Mở rộng toàn màn hình'}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-medium text-[#666] hover:bg-gray-100 transition">
              {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {fullscreen ? 'Thu nhỏ' : 'Mở rộng'}
            </button>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md"><X size={16} className="text-gray-500" /></button>
          </div>
        </div>

        <div className="px-5 pt-3 shrink-0">
          <div className="flex gap-1 bg-[#F4F3EF] rounded-lg p-1">
            <button onClick={() => setMode('single')}
              className={`flex-1 text-[11.5px] font-medium py-1.5 rounded-md transition ${mode === 'single' ? 'bg-white text-[#0c2340] shadow-sm' : 'text-[#888]'}`}>
              Tính 1 bảng lương
            </button>
            <button onClick={() => setMode('compare')}
              className={`flex-1 text-[11.5px] font-medium py-1.5 rounded-md transition ${mode === 'compare' ? 'bg-white text-[#0c2340] shadow-sm' : 'text-[#888]'}`}>
              So sánh giá dịch vụ
            </button>
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto px-5 py-4 ${mode === 'compare' ? '' : 'hidden'}`}>
          <RegionPriceCompare marketZones={marketZones} regionWages={regionWages} toast={toast} clients={clients} marketLeads={marketLeads}
            wageFields={wageFields} getSingleTabSnapshot={getSingleTabSnapshot} onUseForQuote={handleUseForQuote} />
        </div>

        <div className={`flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 ${fullscreen ? 'lg:grid-cols-[400px_1fr]' : 'lg:grid-cols-[360px_1fr]'} gap-5 ${mode === 'single' ? '' : 'hidden'}`}>
          {/* ==== CỘT NHẬP ==== */}
          <div className="space-y-2.5">
            {migrationNotice && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2 border bg-blue-50 border-blue-200">
                <AlertTriangle size={13} className="shrink-0 mt-0.5 text-blue-600" />
                <div className="text-[11px] text-blue-800 flex-1">{MIGRATION_NOTICE}</div>
                <button onClick={() => setMigrationNotice(false)} className="shrink-0 p-0.5 rounded hover:bg-blue-100">
                  <X size={12} className="text-blue-500" />
                </button>
              </div>
            )}
            <MinWageStaleBanner dbBatches={minWageBatches} />

            <div className="border border-[#E8E7E2] rounded-lg p-3 space-y-2.5">
              <div>
                <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Khách hàng / Công ty đang tìm hiểu</label>
                <SearchSelect value={ui.companySelect} onChange={handleCompanySelect} options={companyOptions} placeholder="Tìm khách hàng hoặc công ty/dự án…" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Tên công ty *</label>
                <input value={scenario.customerName} onChange={e => setScenario(s => ({ ...s, customerName: e.target.value }))} placeholder="Gõ tên công ty…"
                  className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Bảng lương này của NCC nào?</label>
                <SearchSelect value={us.supplierName} onChange={v => setScenario(s => ({ ...s, us: { ...s.us, supplierName: v, isUs: v.trim() === US_NAME } }))}
                  options={supplierOptions} placeholder="Chọn NCC / đối thủ…" allowAdd />
                {ui.companySelect && (
                  <button type="button" onClick={pullFromMarket}
                    className="mt-1.5 w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11.5px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition">
                    <Download size={12} /> Lấy lương NCC này từ Thị trường
                  </button>
                )}
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Ghi chú người liên hệ</label>
                <input value={us.contactNote ?? ''} onChange={e => setScenario(s => ({ ...s, us: { ...s.us, contactNote: e.target.value } }))} placeholder="VD: Chị Hoa - 0909xxxxxx"
                  className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-gray-700 block mb-1">KCN / Vị trí</label>
                <SearchSelect value={ui.kcnSelect} onChange={handleKcnSelect} options={zoneOptions} placeholder="Chọn hoặc gõ tên KCN…" allowAdd />
              </div>
            </div>

            <ScenarioForm
              scenario={scenario} entryCode={ui.entryCode} entryAmount={entryAmount}
              equivalentHours={eh} actualHours={ah}
              onEntryCodeChange={onEntryCodeChange} onEntryAmountChange={onEntryAmountChange}
              setBasis={setBasis} setVolume={setVolume} setPriceBook={setPriceBook}
              setOverhead={setOverhead} setServiceFee={setServiceFee} setAllowances={setAllowances}
              onGeneratePriceBook={onGeneratePriceBook}
            />
          </div>

          {/* ==== CỘT KẾT QUẢ ==== */}
          <div className="min-w-0">
            {!hasInput ? (
              <div className="h-full flex items-center justify-center text-[12.5px] text-gray-400 border border-dashed border-gray-300 rounded-lg py-12">
                Nhập số tiền ở khối "Đơn giá lương gốc" để xem kết quả
              </div>
            ) : (
              <div className="space-y-3">
                {banners.map((b, i) => (
                  <div key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2.5 border ${b.level === 'red' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                    <AlertTriangle size={15} className={`shrink-0 mt-0.5 ${b.level === 'red' ? 'text-red-600' : 'text-amber-600'}`} />
                    <span className={`text-[12px] ${b.level === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{b.message}</span>
                  </div>
                ))}

                <div className="flex gap-1 bg-[#F4F3EF] rounded-lg p-1">
                  {RESULT_TABS.map(t => (
                    <button key={t.key} onClick={() => setResultTab(t.key)}
                      className={`flex-1 text-[11.5px] font-medium py-1.5 rounded-md transition ${resultTab === t.key ? 'bg-white text-[#0c2340] shadow-sm' : 'text-[#888]'}`}>
                      {t.label}
                      {t.key === 'competitive' && competitive.flagCannotWin && <span className="ml-1 text-amber-600">•</span>}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="text-[10.5px] text-[#999]">
                    SHR suy ngược: <span className="font-semibold text-[#333]">{fmtVnd(basis.shrPay)}đ/giờ</span>
                    {ui.entrySourceField && <span className="ml-1">· từ khoản "{ui.entrySourceField}"</span>}
                  </div>
                  {ui.companySelect && (
                    <button onClick={syncToMarket} disabled={syncing}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 rounded-md transition shrink-0">
                      <Upload size={11} /> {syncing ? 'Đang đồng bộ…' : 'Đồng bộ sang Thị trường'}
                    </button>
                  )}
                </div>

                {resultTab === 'table' && (
                  <WageTableView table={table} volume={volume} priceBook={priceBook} revenue={revenue}
                    shrPay={basis.shrPay} onOverride={onOverride} onQty={onQty} onCustomerPrice={onCustomerPrice} />
                )}
                {resultTab === 'pnl' && (
                  <PnLView pnl={pnl} vatPercent={priceBook.vatPercent} headcount={overhead.headcount} />
                )}
                {resultTab === 'competitive' && (
                  <CompetitiveView
                    result={competitive} competitors={scenario.competitors}
                    entryCodes={ui.competitorEntryCodes} workdaysPerMonth={basis.workdaysPerMonth}
                    deltaPercent={ui.deltaPercent} targetMarginPercent={overhead.targetNetMarginPercent}
                    onDeltaChange={v => setUi(u => ({ ...u, deltaPercent: v }))}
                    onAdd={addCompetitor} onRemove={removeCompetitor}
                    onRename={(id, name) => patchCompetitor(id, { supplierName: name })}
                    onEntryCodeChange={(id, code) => setUi(u => ({ ...u, competitorEntryCodes: { ...u.competitorEntryCodes, [id]: code } }))}
                    onAmountChange={onCompetitorAmount}
                    onApplyProposed={applyProposed}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#E8E7E2] flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-[13px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Đóng</button>
          {mode === 'single' && (
            <button onClick={save} disabled={!hasInput || blocked || !scenario.customerName.trim() || saving}
              className="flex-1 px-3 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition">
              {saving ? 'Đang lưu...' : 'Lưu báo giá'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
