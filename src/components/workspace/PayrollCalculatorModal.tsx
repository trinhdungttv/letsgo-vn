import { useEffect, useMemo, useState } from 'react';
import { X, Calculator, AlertTriangle, Download, Upload } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import SearchSelect from '../../pages/market/SearchSelect';
import { fetchRegionWages, type RegionZone } from '../../pages/market/regionWage';
import { fetchWageFieldRows, type WageField } from '../../pages/market/wageFields';
import { PAYROLL_INPUT_LABELS, type PayrollInputType } from '../../lib/payroll/coefficients';
import { computePayrollMatrix, SERVICE_FEE_LABELS, type ServiceFeeType, type ReferralDurationMode, type PayrollMatrixResult } from '../../lib/payroll/reverseCalcEngine';
import {
  applyRateOverrides, monthlyGrossFromOverrides, inputValueForMonthlyGross, toWageDetail,
  pickPayrollInputFromWageDetail, allowancesFromWageDetail, sumAllowances, allowanceRecord,
  type RateOverrides, type AllowanceItem,
} from '../../lib/payroll/rateCard';
import { checkCompliance } from '../../lib/payroll/complianceGuard';
import Block1EmployeeReceived from './payroll/Block1EmployeeReceived';
import Block2EmployerCost from './payroll/Block2EmployerCost';
import Block3AgencyRevenue from './payroll/Block3AgencyRevenue';
import Block4ClientInvoice from './payroll/Block4ClientInvoice';
import RegionPriceCompare, { type CompareImport } from './payroll/RegionPriceCompare';
import { PREF_KEYS, readPref, writePref } from '../../lib/payroll/prefs';
import type { Client, Competitor, MarketZone, MarketLead, MarketLeadSupplier } from '../../lib/types';

// companySelect lưu 1 trong 2 nguồn — "client:<id>" (Khách hàng đang hợp tác) hoặc
// "lead:<id>" (Công ty/Dự án đang tìm hiểu, market_leads) — để phân biệt bảng/cột cần
// đọc-ghi khi lấy/đồng bộ bảng lương NCC (clients.market_suppliers vs market_leads.suppliers).
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

const REGION_OPTIONS: { value: RegionZone; label: string }[] = [
  { value: 'I', label: 'Vùng I' }, { value: 'II', label: 'Vùng II' }, { value: 'III', label: 'Vùng III' }, { value: 'IV', label: 'Vùng IV' },
];

const BLOCK_TABS = [
  { key: 1, label: 'NLĐ nhận' },
  { key: 2, label: 'Chi phí NSDLĐ' },
  { key: 3, label: 'Doanh thu Agency' },
  { key: 4, label: 'Invoice khách hàng' },
] as const;

const US_NAME = "Let's Go VN";

let allowanceSeq = 0;
function newAllowance(label = '', amount = ''): AllowanceItem {
  return { id: `al_${Date.now()}_${allowanceSeq++}`, label, amount, passThrough: true };
}

export function PayrollCalculatorModal({ clients, toast, onClose }: Props) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [regionWages, setRegionWages] = useState<Record<RegionZone, number> | null>(null);
  const [marketZones, setMarketZones] = useState<MarketZone[]>([]);
  const [wageFields, setWageFields] = useState<WageField[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [marketLeads, setMarketLeads] = useState<MarketLead[]>([]);

  useEffect(() => {
    fetchRegionWages().then(setRegionWages);
    fetchWageFieldRows().then(setWageFields);
    supabase.from('market_zones').select('id, name').order('name').then(({ data }) => { if (data) setMarketZones(data as MarketZone[]); });
    supabase.from('competitors').select('id, company_name, wage_paid').then(({ data }) => { if (data) setCompetitors(data as Competitor[]); });
    supabase.from('market_leads').select('id, company_name, suppliers').then(({ data }) => { if (data) setMarketLeads(data as MarketLead[]); });
  }, []);

  const [companySelect, setCompanySelect] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [kcnSelect, setKcnSelect] = useState('');
  const [kcnName, setKcnName] = useState('');
  // NCC nào đang được mô tả: chính mình hay 1 đối thủ. Cùng 1 công ty khách nhưng mỗi NCC trả
  // 1 mức lương khác nhau, nên bảng lương LUÔN phải gắn với 1 NCC cụ thể mới so sánh được.
  const [supplierName, setSupplierName] = useState(US_NAME);
  const [companySuppliers, setCompanySuppliers] = useState<MarketLeadSupplier[]>([]);
  // Tên + SĐT người đã liên hệ để lấy báo giá này — không bắt buộc, chỉ để tra lại sau.
  const [contactNote, setContactNote] = useState('');

  const [inputType, setInputTypeState] = useState<PayrollInputType>(() => readPref(PREF_KEYS.inputType, 'base_salary') as PayrollInputType);
  const [inputSourceField, setInputSourceField] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [priorDayOt, setPriorDayOt] = useState(false);
  const [region, setRegionState] = useState<RegionZone>(() => readPref(PREF_KEYS.region, 'II') as RegionZone);
  const [workingDaysPerMonth, setWorkingDaysState] = useState(() => parseInt(readPref(PREF_KEYS.workingDays, '26')) || 26);
  const [serviceFeeType, setServiceFeeTypeState] = useState<ServiceFeeType>(() => readPref(PREF_KEYS.serviceFeeType, 'per_day_worked') as ServiceFeeType);
  const [serviceFeeValue, setServiceFeeValueState] = useState(() => readPref(PREF_KEYS.serviceFeeValue, '50000'));
  const [referralDurationMode, setReferralDurationMode] = useState<ReferralDurationMode>('one_time');
  const [referralMonths, setReferralMonths] = useState(3);
  const [feeHoursPerDay, setFeeHoursPerDayState] = useState(() => readPref(PREF_KEYS.feeHoursPerDay, '8'));
  const [vatPercent, setVatPercentState] = useState(() => readPref(PREF_KEYS.vatPercent, '8'));
  const [customerPriceMode, setCustomerPriceMode] = useState(false);
  const [customerPriceValue, setCustomerPriceValue] = useState('');
  const [allowances, setAllowances] = useState<AllowanceItem[]>([]);
  // Đơn giá người dùng gõ đè lên kết quả tính theo luật (giữ dạng chuỗi cho dễ nhập/xoá trắng).
  const [rawOverrides, setRawOverrides] = useState<Partial<Record<PayrollInputType, string>>>({});

  const setInputType = (v: PayrollInputType) => { setInputTypeState(v); writePref(PREF_KEYS.inputType, v); };
  const setRegion = (v: RegionZone) => { setRegionState(v); writePref(PREF_KEYS.region, v); };
  const setWorkingDaysPerMonth = (v: number) => { setWorkingDaysState(v); writePref(PREF_KEYS.workingDays, String(v)); };
  const setServiceFeeType = (v: ServiceFeeType) => { setServiceFeeTypeState(v); writePref(PREF_KEYS.serviceFeeType, v); };
  const setServiceFeeValue = (v: string) => { setServiceFeeValueState(v); writePref(PREF_KEYS.serviceFeeValue, v); };
  const setFeeHoursPerDay = (v: string) => { setFeeHoursPerDayState(v); writePref(PREF_KEYS.feeHoursPerDay, v); };
  const setVatPercent = (v: string) => { setVatPercentState(v); writePref(PREF_KEYS.vatPercent, v); };

  const addAllowance = () => setAllowances(prev => [...prev, newAllowance()]);
  const removeAllowance = (id: string) => setAllowances(prev => prev.filter(it => it.id !== id));
  const updateAllowance = (id: string, patch: Partial<AllowanceItem>) =>
    setAllowances(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));

  const [activeBlock, setActiveBlock] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const companyOptions = useMemo(() => [
    ...clients.map(c => ({ value: `client:${c.id}`, label: c.name })),
    ...marketLeads.map(l => ({ value: `lead:${l.id}`, label: `${l.company_name} (đang tìm hiểu)` })),
  ], [clients, marketLeads]);
  const zoneOptions = useMemo(() => marketZones.map(z => ({ value: z.id, label: z.name })), [marketZones]);
  const rateFields = useMemo(() => wageFields.filter(f => f.payrollInputType), [wageFields]);
  const allowanceSuggestions = useMemo(() => wageFields.filter(f => !f.payrollInputType).map(f => f.name), [wageFields]);
  const supplierOptions = useMemo(() => {
    const names = new Set<string>([US_NAME]);
    competitors.forEach(c => { if (c.company_name) names.add(c.company_name); });
    companySuppliers.forEach(s => { if (s.name) names.add(s.name); });
    const named = [...names].sort((a, b) => (a === US_NAME ? -1 : b === US_NAME ? 1 : a.localeCompare(b, 'vi'))).map(n => ({ value: n, label: n }));
    // Có lúc mới lấy được đơn giá nhưng chưa rõ NCC nào báo — cho phép để trống, điền lại sau.
    return [...named, { value: '', label: 'Chưa rõ NCC (điền sau)' }];
  }, [competitors, companySuppliers]);

  const isUs = supplierName.trim() === US_NAME;

  function handleCompanySelect(v: string) {
    setCompanySelect(v);
    const sel = parseCompanySelect(v);
    if (sel?.type === 'client') {
      const match = clients.find(c => c.id === sel.id);
      setCompanyName(match ? match.name : v);
    } else if (sel?.type === 'lead') {
      const match = marketLeads.find(l => l.id === sel.id);
      setCompanyName(match ? match.company_name : v);
    } else {
      setCompanyName(v);
    }
  }

  function handleKcnSelect(v: string) {
    setKcnSelect(v);
    const match = marketZones.find(z => z.id === v);
    setKcnName(match ? match.name : v);
  }

  // Bảng NCC của công ty đang chọn (Thị trường) — nguồn cho nút "Lấy lương NCC này".
  // clients dùng cột market_suppliers, market_leads dùng cột suppliers (cùng shape MarketLeadSupplier[]).
  useEffect(() => {
    const sel = parseCompanySelect(companySelect);
    if (!sel) { setCompanySuppliers([]); return; }
    if (sel.type === 'client') {
      supabase.from('clients').select('market_suppliers').eq('id', sel.id).maybeSingle()
        .then(({ data }) => setCompanySuppliers(((data?.market_suppliers ?? []) as MarketLeadSupplier[])));
    } else {
      supabase.from('market_leads').select('suppliers').eq('id', sel.id).maybeSingle()
        .then(({ data }) => setCompanySuppliers(((data?.suppliers ?? []) as MarketLeadSupplier[])));
    }
  }, [companySelect, clients, marketLeads]);

  const inputValueNum = parseFloat(inputValue) || 0;
  const serviceFeeValueNum = parseFloat(serviceFeeValue) || 0;
  const customerPriceValueNum = parseFloat(customerPriceValue) || 0;
  const feeHoursPerDayNum = parseFloat(feeHoursPerDay) || 8;
  const vatRate = (parseFloat(vatPercent) || 0) / 100;
  const regionMinWage = regionWages?.[region] ?? 0;
  const standardHoursPerMonth = workingDaysPerMonth * feeHoursPerDayNum;
  const customerExtraFeesTotal = sumAllowances(allowances);
  const customerExtraFeesPassThrough = sumAllowances(allowances, true);

  const rateOverrides: RateOverrides = useMemo(() => {
    const out: RateOverrides = {};
    for (const [type, raw] of Object.entries(rawOverrides)) {
      const n = parseFloat(raw ?? '');
      if (Number.isFinite(n) && n > 0) out[type as PayrollInputType] = n;
    }
    return out;
  }, [rawOverrides]);

  // Sửa tay đơn giá giờ THƯỜNG thì lương tháng chuẩn đổi theo → phải chạy lại nguyên engine.
  // Cách làm: quy ngược ra số tiền đầu vào tương đương rồi gọi lại computePayrollMatrix, để
  // công thức BHXH/chi phí chỉ nằm ở 1 nơi duy nhất (xem rateCard.inputValueForMonthlyGross).
  const overrideMonthly = monthlyGrossFromOverrides(rateOverrides, workingDaysPerMonth);
  const effectiveInputValue = overrideMonthly != null
    ? inputValueForMonthlyGross(overrideMonthly, inputType, priorDayOt, workingDaysPerMonth)
    : inputValueNum;

  const result: PayrollMatrixResult | null = useMemo(() => {
    if (effectiveInputValue <= 0 || !regionWages) return null;
    return computePayrollMatrix({
      inputType, inputValue: effectiveInputValue, priorDayOt, region, regionMinWage,
      workingDaysPerMonth, serviceFeeType, serviceFeeValue: serviceFeeValueNum,
      referralDurationMode, referralMonths, vatRate, feeHoursPerDay: feeHoursPerDayNum,
      customerPriceMode, customerPriceValue: customerPriceValueNum,
      customerExtraFeesTotal, customerExtraFeesPassThrough,
    });
  }, [inputType, effectiveInputValue, priorDayOt, region, regionMinWage, workingDaysPerMonth, serviceFeeType, serviceFeeValueNum, referralDurationMode, referralMonths, vatRate, regionWages, feeHoursPerDayNum, customerPriceMode, customerPriceValueNum, customerExtraFeesTotal, customerExtraFeesPassThrough]);

  const rateRows = useMemo(
    () => result ? applyRateOverrides(result.rateCard, rateOverrides, workingDaysPerMonth) : [],
    [result, rateOverrides, workingDaysPerMonth],
  );

  const banners = result ? checkCompliance(result, region, regionMinWage) : [];
  const blocked = banners.some(b => b.blocksSave);

  function onRateInput(type: PayrollInputType, raw: string) {
    setRawOverrides(prev => {
      const next = { ...prev };
      if (raw.trim() === '') delete next[type]; else next[type] = raw;
      return next;
    });
  }

  // ── Lấy bảng lương NCC đã lưu bên Thị trường về đây để tính ────────────────────────────────
  function pullFromMarket() {
    const supplier = companySuppliers.find(s => (isUs ? s.is_us : s.name === supplierName.trim()));
    if (!supplier) { toast(`Công ty này chưa có bảng lương của "${supplierName}" ở Thị trường`); return; }
    const picked = pickPayrollInputFromWageDetail(supplier.wage_detail, wageFields);
    if (!picked) { toast('Bảng lương NCC này chưa có khoản nào gán được loại đơn giá theo luật'); return; }
    setInputTypeState(picked.type);
    setInputSourceField(picked.fieldName);
    setInputValue(String(picked.value));
    setRawOverrides({});
    // Mọi khoản còn lại trong bảng lương đó là phụ cấp — kéo sang luôn để không phải gõ lại.
    const rest = allowancesFromWageDetail(supplier.wage_detail, wageFields);
    setAllowances(Object.entries(rest).map(([label, amount]) => newAllowance(label, String(amount))));
    setActiveBlock(1);
    toast(`Đã lấy lương "${supplier.name}" (${picked.fieldName}) từ Thị trường`);
  }

  // ── Ghi kết quả (đã gồm phần chỉnh tay) ngược lại bảng lương NCC bên Thị trường ────────────
  // Đích ghi phụ thuộc nguồn đã chọn: Khách hàng đang hợp tác → clients.market_suppliers,
  // Công ty/Dự án đang tìm hiểu → market_leads.suppliers (cùng shape MarketLeadSupplier[]).
  async function syncToMarket() {
    const sel = parseCompanySelect(companySelect);
    if (!sel) { toast('Chọn "Khách hàng có sẵn / Công ty đang tìm hiểu" trước khi đồng bộ sang Thị trường'); return; }
    const table = sel.type === 'client' ? 'clients' : 'market_leads';
    const column = sel.type === 'client' ? 'market_suppliers' : 'suppliers';
    const targetLabel = sel.type === 'client'
      ? clients.find(c => c.id === sel.id)?.name
      : marketLeads.find(l => l.id === sel.id)?.company_name;
    if (!targetLabel) { toast('Không tìm thấy hồ sơ đã chọn'); return; }
    if (!result) return;
    const targetName = isUs ? US_NAME : supplierName.trim();
    if (!targetName) { toast('Chọn NCC trước khi đồng bộ'); return; }

    const { data, error: readErr } = await supabase.from(table).select(column).eq('id', sel.id).maybeSingle();
    if (readErr) { toast('Không đọc được bảng NCC hiện tại: ' + readErr.message); return; }
    const list = (((data as any)?.[column] ?? []) as MarketLeadSupplier[]);
    const idx = list.findIndex(s => (isUs ? s.is_us : s.name === targetName));
    const previous = idx >= 0 ? (list[idx].wage_detail ?? {}) : {};
    const wageDetail = toWageDetail(rateRows, wageFields, allowanceRecord(allowances), previous);

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
    const { error } = await supabase.from(table).update({ [column]: next }).eq('id', sel.id);
    setSyncing(false);
    if (error) { toast('Đồng bộ lỗi: ' + error.message); return; }
    setCompanySuppliers(next);
    toast(`Đã đồng bộ bảng lương "${targetName}" sang Thị trường (${changed.length} khoản)`);
  }

  async function save() {
    if (!result || blocked || !companyName.trim()) return;
    setSaving(true);
    const sel = parseCompanySelect(companySelect);
    const zoneMatch = marketZones.find(z => z.id === kcnSelect);
    const { error } = await supabase.from('quote_requests').insert({
      company_name: companyName.trim(),
      kcn_name: kcnName.trim() || null,
      kcn_zone_id: zoneMatch?.id ?? null,
      client_id: sel?.type === 'client' ? sel.id : null,
      market_lead_id: sel?.type === 'lead' ? sel.id : null,
      supplier_name: isUs ? null : supplierName.trim() || null,
      is_us: isUs,
      contact_note: contactNote.trim() || null,
      input_type: inputType,
      input_value: Math.round(effectiveInputValue),
      prior_day_ot: priorDayOt,
      region,
      working_days_per_month: workingDaysPerMonth,
      service_fee_type: customerPriceMode ? 'customer_price_direct' : serviceFeeType,
      service_fee_value: customerPriceMode ? customerPriceValueNum : serviceFeeValueNum,
      referral_duration_mode: !customerPriceMode && serviceFeeType === 'referral_hourly' ? referralDurationMode : null,
      referral_months: !customerPriceMode && (serviceFeeType === 'referral_daily_limited' || (serviceFeeType === 'referral_hourly' && referralDurationMode === 'recurring_months')) ? referralMonths : null,
      vat_rate: vatRate,
      computed_shr: result.shr,
      rate_overrides: rateOverrides,
      wage_detail: toWageDetail(rateRows, wageFields, allowanceRecord(allowances)),
      result_json: { ...result, allowances },
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) { toast('Có lỗi khi lưu: ' + error.message); return; }
    toast(`Đã lưu bảng lương ${isUs ? '' : `của ${supplierName} `}cho ${companyName.trim()}`);
    onClose();
  }

  function handleUseForQuote(input: CompareImport & { kcnZoneId: string; kcnName: string }) {
    setInputTypeState(input.type);
    setInputSourceField(null);
    setInputValue(String(input.value));
    setPriorDayOt(input.priorDayOt);
    setRegion(input.region);
    setWorkingDaysPerMonth(input.workingDays);
    setRawOverrides({});
    if (input.kcnZoneId) setKcnSelect(input.kcnZoneId);
    setKcnName(input.kcnName);
    if (input.customerPriceValue > 0 || input.workerSupport > 0 || input.clientSupportPaid > 0) {
      setCustomerPriceMode(true);
      setCustomerPriceValue(input.customerPriceValue > 0 ? String(Math.round(input.customerPriceValue)) : '');
      const items: AllowanceItem[] = [];
      if (input.workerSupport > 0) items.push({ ...newAllowance('Phụ cấp — NLĐ nhận', String(Math.round(input.workerSupport))), passThrough: true });
      const kept = input.clientSupportPaid - input.workerSupport;
      if (kept > 0) items.push({ ...newAllowance('Phụ cấp — công ty giữ lại', String(Math.round(kept))), passThrough: false });
      setAllowances(items);
    }
    setActiveBlock(1);
    setMode('single');
    toast('Đã đưa giá từ bảng so sánh sang Tính bảng lương');
  }

  function getSingleTabSnapshot(): CompareImport | null {
    if (!result || effectiveInputValue <= 0) return null;
    return {
      source: [!isUs && supplierName.trim() ? supplierName.trim() : '', companyName.trim()].filter(Boolean).join(' @ ') || 'Giá chúng tôi báo',
      type: inputType, value: Math.round(effectiveInputValue), priorDayOt,
      workerSupport: customerPriceMode ? customerExtraFeesPassThrough : 0,
      clientSupportPaid: customerPriceMode ? customerExtraFeesTotal : 0,
      customerPriceValue: customerPriceMode
        ? customerPriceValueNum
        : (workingDaysPerMonth > 0 ? result.invoice.subtotal / workingDaysPerMonth : 0),
      workingDays: workingDaysPerMonth, region, note: 'Từ tab Tính 1 bảng lương',
    };
  }

  // Chọn loại đơn giá: nhóm "theo luật" + nhóm lấy đúng tên khoản đang dùng bên Thị trường
  // (vd "Ca ngày 8h (Ca 1+2)") — cùng 1 loại giờ nhưng gọi theo tên công ty hay dùng.
  const inputTypeSelectValue = inputSourceField ? `field:${inputSourceField}` : inputType;
  function onInputTypeSelect(v: string) {
    if (v.startsWith('field:')) {
      const name = v.slice(6);
      const f = wageFields.find(x => x.name === name);
      if (f?.payrollInputType) { setInputType(f.payrollInputType); setInputSourceField(name); }
      return;
    }
    setInputType(v as PayrollInputType);
    setInputSourceField(null);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2] shrink-0">
          <h2 className="text-[14px] font-semibold text-[#111] flex items-center gap-1.5"><Calculator size={16} className="text-blue-600" /> Tính bảng lương</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X size={16} className="text-gray-500" />
          </button>
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

        {/* Cả 2 tab luôn được mount (chỉ ẩn/hiện bằng CSS) — nếu unmount RegionPriceCompare khi
            đổi tab, state nội bộ của nó (rows đã nhập, KCN đang chọn...) sẽ mất ngay cả khi chưa
            bấm Lưu, vì component bị huỷ và tạo lại từ đầu. */}
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${mode === 'compare' ? '' : 'hidden'}`}>
          <RegionPriceCompare marketZones={marketZones} regionWages={regionWages} toast={toast} clients={clients}
            wageFields={wageFields} getSingleTabSnapshot={getSingleTabSnapshot} onUseForQuote={handleUseForQuote} />
        </div>
        <div className={`flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 ${mode === 'single' ? '' : 'hidden'}`}>
          {/* ==== FORM NHẬP LIỆU ==== */}
          <div className="space-y-3">
            <div>
              <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Khách hàng / Công ty đang tìm hiểu có sẵn (để lấy/đồng bộ bảng lương NCC)</label>
              <SearchSelect value={companySelect} onChange={handleCompanySelect} options={companyOptions} placeholder="Tìm khách hàng hoặc công ty/dự án…" />
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Tên công ty *</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Gõ tên công ty…"
                className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Bảng lương này của NCC nào?</label>
              <SearchSelect value={supplierName} onChange={setSupplierName} options={supplierOptions} placeholder="Chọn NCC / đối thủ…" allowAdd />
              <div className="text-[10.5px] text-[#999] mt-0.5">
                {isUs
                  ? 'Đang tính bảng lương của chính mình.'
                  : supplierName.trim()
                    ? `Đang mô tả mức "${supplierName}" trả tại công ty này — để nghiên cứu giá đối thủ.`
                    : 'Chưa rõ NCC nào báo giá này — có thể điền lại sau khi biết rõ.'}
              </div>
              {companySelect && (
                <button type="button" onClick={pullFromMarket}
                  className="mt-1.5 w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11.5px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition">
                  <Download size={12} /> Lấy lương NCC này từ Thị trường
                </button>
              )}
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Ghi chú người liên hệ (tuỳ chọn)</label>
              <input value={contactNote} onChange={e => setContactNote(e.target.value)} placeholder="VD: Chị Hoa - 0909xxxxxx"
                className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
              <div className="text-[10.5px] text-[#999] mt-0.5">Tên + SĐT người bạn đã liên hệ để lấy báo giá này, để tra lại sau nếu cần hỏi thêm.</div>
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-gray-700 block mb-1">KCN / Vị trí</label>
              <SearchSelect value={kcnSelect} onChange={handleKcnSelect} options={zoneOptions} placeholder="Chọn hoặc gõ tên KCN…" allowAdd />
            </div>

            <div className="pt-2 border-t border-[#F0EFEA]">
              <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Loại đơn giá nhập vào</label>
              <select value={inputTypeSelectValue} onChange={e => onInputTypeSelect(e.target.value)}
                className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white">
                <optgroup label="Theo luật lao động">
                  {(Object.keys(PAYROLL_INPUT_LABELS) as PayrollInputType[]).map(t => <option key={t} value={t}>{PAYROLL_INPUT_LABELS[t]}</option>)}
                </optgroup>
                {rateFields.length > 0 && (
                  <optgroup label="Theo tên khoản đang dùng ở Thị trường">
                    {rateFields.map(f => <option key={f.name} value={`field:${f.name}`}>{f.name}</option>)}
                  </optgroup>
                )}
              </select>
              {inputSourceField && (
                <div className="text-[10.5px] text-[#999] mt-0.5">Khoản "{inputSourceField}" = {PAYROLL_INPUT_LABELS[inputType]}</div>
              )}
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Số tiền tương ứng (đ)</label>
              <input type="number" min={0} step={1000} value={inputValue} onChange={e => setInputValue(e.target.value)} placeholder="0"
                className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
              {overrideMonthly != null && (
                <div className="text-[10.5px] text-amber-700 mt-0.5">Đang dùng đơn giá bạn sửa tay ở bảng kết quả thay cho số này.</div>
              )}
            </div>
            {inputType === 'ot_night_weekday' && (
              <label className="flex items-center gap-1.5 text-[11.5px] text-gray-700">
                <input type="checkbox" checked={priorDayOt} onChange={e => setPriorDayOt(e.target.checked)} className="accent-blue-600" />
                Có làm OT ban ngày ngay trước ca đêm
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Vùng lương</label>
                <select value={region} onChange={e => setRegion(e.target.value as RegionZone)}
                  className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white">
                  {REGION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Ngày công/tháng</label>
                <input type="number" min={1} max={31} value={workingDaysPerMonth} onChange={e => setWorkingDaysPerMonth(Math.max(1, parseInt(e.target.value) || 26))}
                  className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
              </div>
            </div>

            <div className="pt-2 border-t border-[#F0EFEA]">
              <label className="flex items-center gap-1.5 text-[11.5px] text-gray-700">
                <input type="checkbox" checked={customerPriceMode} onChange={e => setCustomerPriceMode(e.target.checked)} className="accent-blue-600" />
                Nhập thẳng giá khách trả (thay vì tính phí dịch vụ theo công thức)
              </label>
              <div className="text-[10.5px] text-[#999] mt-0.5">Dùng khi đã biết giá thị trường khách trả — để xem sau khi trả NLĐ + bảo hiểm thì còn dư bao nhiêu.</div>
            </div>

            {customerPriceMode ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Giá khách trả (đ/ngày công)</label>
                  <input type="number" min={0} step={1000} value={customerPriceValue} onChange={e => setCustomerPriceValue(e.target.value)}
                    className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                </div>
                <div>
                  <label className="text-[11.5px] font-medium text-gray-700 block mb-1">VAT (%)</label>
                  <input type="number" min={0} value={vatPercent} onChange={e => setVatPercent(e.target.value)}
                    className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Loại phí dịch vụ</label>
                  <select value={serviceFeeType} onChange={e => setServiceFeeType(e.target.value as ServiceFeeType)}
                    className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white">
                    {(Object.keys(SERVICE_FEE_LABELS) as ServiceFeeType[]).map(t => <option key={t} value={t}>{SERVICE_FEE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11.5px] font-medium text-gray-700 block mb-1">
                      Đơn giá {serviceFeeType === 'referral_hourly' ? '(đ/giờ)' : '(đ/ngày)'}
                    </label>
                    <input type="number" min={0} step={1000} value={serviceFeeValue} onChange={e => setServiceFeeValue(e.target.value)}
                      className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                  </div>
                  <div>
                    <label className="text-[11.5px] font-medium text-gray-700 block mb-1">VAT (%)</label>
                    <input type="number" min={0} value={vatPercent} onChange={e => setVatPercent(e.target.value)}
                      className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                  </div>
                </div>

                {serviceFeeType === 'referral_hourly' && (
                  <div>
                    <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Số giờ tối đa được hưởng phí/ngày</label>
                    <input type="number" min={1} max={24} value={feeHoursPerDay} onChange={e => setFeeHoursPerDay(e.target.value)}
                      className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                    <div className="text-[10px] text-[#999] mt-0.5">Mặc định 8 — giá trị này được nhớ lại cho lần tính sau, tới khi bạn đổi.</div>
                  </div>
                )}
                {serviceFeeType === 'referral_hourly' && (
                  <div>
                    <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Thời hạn thu phí giới thiệu</label>
                    <select value={referralDurationMode} onChange={e => setReferralDurationMode(e.target.value as ReferralDurationMode)}
                      className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white">
                      <option value="one_time">Thu 1 lần duy nhất</option>
                      <option value="recurring_months">Thu hàng tháng, trong N tháng</option>
                    </select>
                    {referralDurationMode === 'recurring_months' && (
                      <input type="number" min={1} max={24} value={referralMonths} onChange={e => setReferralMonths(Math.max(1, parseInt(e.target.value) || 3))}
                        placeholder="Số tháng (3-6)"
                        className="mt-1.5 w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                    )}
                  </div>
                )}
                {serviceFeeType === 'referral_daily_limited' && (
                  <div>
                    <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Số tháng được hưởng phí (thường 3-6)</label>
                    <input type="number" min={1} max={24} value={referralMonths} onChange={e => setReferralMonths(Math.max(1, parseInt(e.target.value) || 3))}
                      className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                  </div>
                )}
              </>
            )}
          </div>

          {/* ==== KẾT QUẢ ==== */}
          <div className="min-w-0">
            {!result ? (
              <div className="h-full flex items-center justify-center text-[12.5px] text-gray-400 border border-dashed border-gray-300 rounded-lg py-12">
                Nhập số tiền để xem kết quả tính toán
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
                  {BLOCK_TABS.map(t => (
                    <button key={t.key} onClick={() => setActiveBlock(t.key)}
                      className={`flex-1 text-[11.5px] font-medium py-1.5 rounded-md transition ${activeBlock === t.key ? 'bg-white text-[#0c2340] shadow-sm' : 'text-[#888]'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="text-[10.5px] text-[#999]">
                    SHR (Đơn giá giờ chuẩn) suy ngược: <span className="font-semibold text-[#333]">{result.shr.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ/giờ</span>
                  </div>
                  {companySelect && (
                    <button onClick={syncToMarket} disabled={syncing}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 rounded-md transition shrink-0">
                      <Upload size={11} /> {syncing ? 'Đang đồng bộ…' : 'Đồng bộ sang Thị trường'}
                    </button>
                  )}
                </div>

                {activeBlock === 1 && (
                  <Block1EmployeeReceived
                    result={result} workingDaysPerMonth={workingDaysPerMonth} inputType={inputType}
                    rateRows={rateRows} rawOverrides={rawOverrides} onRateInput={onRateInput}
                    allowances={allowances} allowanceSuggestions={allowanceSuggestions}
                    onAddAllowance={addAllowance} onUpdateAllowance={updateAllowance} onRemoveAllowance={removeAllowance}
                  />
                )}
                {activeBlock === 2 && <Block2EmployerCost result={result} unionFeeEnabled={false} />}
                {activeBlock === 3 && (
                  <Block3AgencyRevenue
                    result={result} serviceFeeType={serviceFeeType} serviceFeeValue={serviceFeeValueNum}
                    workingDaysPerMonth={workingDaysPerMonth} standardHoursPerMonth={standardHoursPerMonth}
                    customerPriceValue={customerPriceValueNum} customerExtraFeesTotal={customerExtraFeesTotal}
                    customerExtraFeesPassThrough={customerExtraFeesPassThrough}
                    rawCustomerPrice={customerPriceValue} onCustomerPriceChange={setCustomerPriceValue}
                    rawServiceFeeValue={serviceFeeValue} onServiceFeeValueChange={setServiceFeeValue}
                  />
                )}
                {activeBlock === 4 && <Block4ClientInvoice result={result} vatRate={vatRate} />}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#E8E7E2] flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-[13px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Đóng</button>
          {mode === 'single' && (
            <button onClick={save} disabled={!result || blocked || !companyName.trim() || saving}
              className="flex-1 px-3 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition">
              {saving ? 'Đang lưu...' : 'Lưu báo giá'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
