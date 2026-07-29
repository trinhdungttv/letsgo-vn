// "So sánh giá vùng" — nghiên cứu giá thị trường khi mở rộng/kiểm tra 1 vùng mới. Mỗi dòng là 1
// nguồn giá (giá mình báo, nhà cung ứng khác, dự án đã có ở vùng đó).
//
// MÔ HÌNH SỐ (đúng nghiệp vụ cho thuê lao động — đọc kỹ trước khi sửa):
//  1. Nhập 1 đơn giá lương bất kỳ → computePayrollMatrix() suy ngược SHR rồi tính xuôi ra
//     "Lương tháng chuẩn" (monthlyGrossNormal) + BHXH NSDLĐ đóng. Đây là phần THEO LUẬT, dùng
//     chung engine với tab "Tính 1 bảng lương", không viết lại công thức.
//  2. Khoản hỗ trợ thêm (phụ cấp nhà ở/đi lại/chuyên cần…) có 2 MẶT KHÁC NHAU, bắt buộc tách:
//       • workerSupport     = NCC THỰC TRẢ cho NLĐ  → là CHI PHÍ, cộng vào chi phí lao động.
//       • clientSupportPaid = KHÁCH TRẢ cho khoản đó → là DOANH THU, cộng vào tiền khách trả.
//     Bằng nhau ⇒ trả toàn phần, khoản này trung lập với lợi nhuận. clientSupportPaid lớn hơn
//     ⇒ NCC "giữ lại 1 chút", phần chênh tự động hiện ra trong Phí dịch vụ. Nếu gộp làm 1 số
//     thì KHÔNG phát hiện được phần giữ lại này → so sánh phí dịch vụ giữa các bên sẽ sai.
//  3. Tổng gói NLĐ nhận = Lương tháng chuẩn + workerSupport → đây mới là con số so sánh
//     "ai trả NLĐ cao hơn" (NLĐ nhìn tổng thu nhập, không nhìn riêng lương cơ bản).
//  4. Chi phí LĐ = Lương tháng chuẩn + BHXH NSDLĐ + workerSupport.
//     Tiền khách trả = giá/ngày × ngày công + clientSupportPaid.
//     Phí dịch vụ    = Tiền khách trả − Chi phí LĐ.
//
// Lương tối thiểu vùng đối chiếu với LƯƠNG THÁNG CHUẨN (không gồm phụ cấp) — đúng Điều 90 BLLĐ
// 2019: mức lương theo công việc không bao gồm phụ cấp, nên phụ cấp không "kéo" lương lên đủ mức.
//
// Dữ liệu lưu theo KCN (region_price_comparisons) để lần sau mở lại thêm nguồn mới vào bảng cũ.
import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertTriangle, ArrowRight, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import SearchSelect from '../../../pages/market/SearchSelect';
import type { RegionZone } from '../../../pages/market/regionWage';
import { PAYROLL_INPUT_LABELS, type PayrollInputType } from '../../../lib/payroll/coefficients';
import { computeCompareRow, averageOf } from '../../../lib/payroll/compareEngine';
import { pickPayrollInputFromWageDetail, allowancesFromWageDetail } from '../../../lib/payroll/rateCard';
import { fmtVnd } from '../../../lib/payroll/format';
import { PREF_KEYS, readPref, writePref } from '../../../lib/payroll/prefs';
import type { WageField } from '../../../pages/market/wageFields';
import type { Client, MarketZone, MarketLeadSupplier } from '../../../lib/types';

const REGION_OPTIONS: { value: RegionZone; label: string }[] = [
  { value: 'I', label: 'Vùng I' }, { value: 'II', label: 'Vùng II' }, { value: 'III', label: 'Vùng III' }, { value: 'IV', label: 'Vùng IV' },
];

export interface CompareRow {
  id: string; source: string; type: PayrollInputType; value: number; priorDayOt: boolean;
  workerSupport: number;      // hỗ trợ thêm/tháng NLĐ THỰC NHẬN — chi phí
  clientSupportPaid: number;  // hỗ trợ thêm/tháng KHÁCH TRẢ cho khoản đó — doanh thu
  customerPriceValue: number; // giá khách trả (đ/ngày công)
  ours: boolean;
  importedDays?: number;      // ngày công gốc của nguồn khi nhập từ nơi khác — để cảnh báo nếu lệch
  importedNote?: string;      // nguồn gốc dữ liệu (báo giá đã lưu / tab Tính 1 bảng lương)
}

// Dữ liệu 1 nguồn giá lấy từ nơi khác (tab "Tính 1 bảng lương" hoặc báo giá đã lưu).
export interface CompareImport {
  source: string; type: PayrollInputType; value: number; priorDayOt: boolean;
  workerSupport: number; clientSupportPaid: number; customerPriceValue: number;
  workingDays: number; region: RegionZone; note: string;
}

let rowSeq = 0;
const nextRowId = () => `row_${Date.now()}_${rowSeq++}`;
function newRow(ours: boolean): CompareRow {
  return { id: nextRowId(), source: ours ? 'Giá chúng tôi báo' : '', type: 'base_salary', value: 0, priorDayOt: false, workerSupport: 0, clientSupportPaid: 0, customerPriceValue: 0, ours };
}

interface SavedQuote {
  id: string; company_name: string; kcn_name: string | null; created_at: string;
  input_type: PayrollInputType; input_value: number; prior_day_ot: boolean;
  region: RegionZone; working_days_per_month: number;
  service_fee_type: string; service_fee_value: number; result_json: any;
}

// Quy 1 báo giá đã lưu (quote_requests) về đúng mô hình số của bảng so sánh.
// - Chế độ "nhập thẳng giá khách trả": lấy nguyên giá/ngày + tách phụ phí theo cờ "Trả NLĐ".
// - Chế độ phí dịch vụ theo công thức: không có giá/ngày tường minh, nên quy đổi từ tổng invoice
//   trước VAT (= chi phí LĐ + phí dịch vụ) về 1 mức giá/ngày tương đương. Cách này cho ra đúng
//   lại con số phí dịch vụ ban đầu khi ngày công không đổi.
function quoteToImport(q: SavedQuote): CompareImport {
  const days = q.working_days_per_month || 26;
  const rj = q.result_json ?? {};
  const feeItems: { amount?: string | number; passThrough?: boolean }[] = Array.isArray(rj.customerFeeItems) ? rj.customerFeeItems : [];
  const sumFees = (only?: boolean) => feeItems
    .filter(it => only === undefined || !!it.passThrough === only)
    .reduce((s, it) => s + (parseFloat(String(it.amount ?? 0)) || 0), 0);

  let customerPriceValue = 0;
  let workerSupport = 0;
  let clientSupportPaid = 0;
  if (q.service_fee_type === 'customer_price_direct') {
    customerPriceValue = Number(q.service_fee_value) || 0;
    workerSupport = sumFees(true);   // các khoản đánh dấu "Trả NLĐ"
    clientSupportPaid = sumFees();   // toàn bộ phụ phí khách trả
  } else {
    const subtotal = Number(rj?.invoice?.subtotal) || 0;
    customerPriceValue = days > 0 ? subtotal / days : 0;
  }
  return {
    source: q.company_name, type: q.input_type, value: Number(q.input_value) || 0, priorDayOt: !!q.prior_day_ot,
    workerSupport, clientSupportPaid, customerPriceValue,
    workingDays: days, region: q.region,
    note: `Báo giá đã lưu ${new Date(q.created_at).toLocaleDateString('vi-VN')}`,
  };
}

interface Props {
  marketZones: MarketZone[];
  regionWages: Record<RegionZone, number> | null;
  toast: (msg: string) => void;
  /** Danh sách khách hàng — để kéo cả dàn NCC đang phục vụ 1 công ty vào bảng so sánh. */
  clients: Client[];
  /** Trường lương chi tiết + loại đơn giá tương ứng (migration 126) — để đọc bảng lương NCC. */
  wageFields: WageField[];
  getSingleTabSnapshot: () => CompareImport | null;
  onUseForQuote: (input: CompareImport & { kcnZoneId: string; kcnName: string }) => void;
}

export default function RegionPriceCompare({ marketZones, regionWages, toast, clients, wageFields, getSingleTabSnapshot, onUseForQuote }: Props) {
  const { user } = useAuth();
  const [kcnSelect, setKcnSelect] = useState('');
  const [kcnName, setKcnName] = useState('');
  const [region, setRegionState] = useState<RegionZone>(() => readPref(PREF_KEYS.region, 'II') as RegionZone);
  const [workingDaysPerMonth, setWorkingDaysState] = useState(() => parseInt(readPref(PREF_KEYS.workingDays, '26')) || 26);
  const [rows, setRows] = useState<CompareRow[]>([newRow(true)]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[] | null>(null);
  const [showQuotePicker, setShowQuotePicker] = useState(false);
  const [companyForImport, setCompanyForImport] = useState('');
  const [importingSuppliers, setImportingSuppliers] = useState(false);

  // Vùng và ngày công dùng chung 1 bộ ghi nhớ với tab "Tính 1 bảng lương" — đổi ở đâu thì lần
  // sau mở lại cả 2 tab đều theo giá trị mới nhất.
  function setRegion(v: RegionZone) { setRegionState(v); writePref(PREF_KEYS.region, v); }
  function setWorkingDays(v: number) { setWorkingDaysState(v); writePref(PREF_KEYS.workingDays, String(v)); }

  const zoneOptions = marketZones.map(z => ({ value: z.id, label: z.name }));

  function handleKcnSelect(v: string) {
    setKcnSelect(v);
    const match = marketZones.find(z => z.id === v);
    setKcnName(match ? match.name : v);
  }

  useEffect(() => {
    if (!kcnSelect) return;
    const match = marketZones.find(z => z.id === kcnSelect);
    if (!match) return; // KCN gõ tay, chưa có trong hệ thống — không có gì để tải
    setLoading(true);
    supabase.from('region_price_comparisons').select('*').eq('kcn_zone_id', kcnSelect).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLoadedId(data.id);
          setRegion(data.region as RegionZone);
          setWorkingDays(data.working_days_per_month);
          // Bản ghi cũ (trước khi tách hỗ trợ 2 mặt) chỉ có extraSupport — hiểu là phần NLĐ nhận.
          const loadedRows = ((data.rows as (Partial<CompareRow> & { extraSupport?: number })[]) ?? []).map(r => ({
            id: r.id ?? nextRowId(), source: r.source ?? '', type: (r.type ?? 'base_salary') as PayrollInputType,
            value: r.value ?? 0, priorDayOt: !!r.priorDayOt,
            workerSupport: r.workerSupport ?? r.extraSupport ?? 0,
            clientSupportPaid: r.clientSupportPaid ?? 0,
            customerPriceValue: r.customerPriceValue ?? 0,
            ours: !!r.ours, importedDays: r.importedDays, importedNote: r.importedNote,
          }) as CompareRow);
          setRows(loadedRows.length > 0 ? loadedRows : [newRow(true)]);
        } else {
          setLoadedId(null);
          setRows([newRow(true)]);
        }
        setLoading(false);
      });
  }, [kcnSelect, marketZones]);

  function addRow() { setRows(prev => [...prev, newRow(false)]); }
  function removeRow(id: string) { setRows(prev => prev.filter(r => r.id !== id)); }
  function updateRow(id: string, patch: Partial<CompareRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function setOurs(id: string) { setRows(prev => prev.map(r => ({ ...r, ours: r.id === id }))); }

  // Thêm 1 nguồn lấy từ nơi khác vào bảng. KHÔNG tự đổi ngày công của bảng theo nguồn nhập vào
  // (sẽ làm sai lệch mọi dòng khác) — chỉ ghi lại ngày công gốc để cảnh báo nếu lệch.
  function addImported(imp: CompareImport, ours: boolean) {
    const row: CompareRow = {
      id: nextRowId(), source: imp.source || 'Nguồn nhập vào', type: imp.type, value: imp.value, priorDayOt: imp.priorDayOt,
      workerSupport: imp.workerSupport, clientSupportPaid: imp.clientSupportPaid, customerPriceValue: imp.customerPriceValue,
      ours, importedDays: imp.workingDays, importedNote: imp.note,
    };
    setRows(prev => {
      const cleared = ours ? prev.map(r => ({ ...r, ours: false })) : prev;
      // Dòng trống mặc định (chưa nhập gì) thì thay luôn, tránh để lại 1 dòng rác
      const isBlank = (r: CompareRow) => r.value <= 0 && !r.source.trim() && r.customerPriceValue <= 0;
      const kept = cleared.filter(r => !isBlank(r) || (r.ours && !ours));
      return [...kept, row];
    });
  }

  function importFromSingleTab() {
    const snap = getSingleTabSnapshot();
    if (!snap) { toast('Tab "Tính 1 bảng lương" chưa có số tiền hợp lệ để lấy sang'); return; }
    addImported(snap, true);
    toast('Đã lấy dữ liệu từ tab Tính 1 bảng lương');
  }

  async function toggleQuotePicker() {
    const next = !showQuotePicker;
    setShowQuotePicker(next);
    if (next && savedQuotes === null) {
      const { data, error } = await supabase.from('quote_requests')
        .select('id, company_name, kcn_name, created_at, input_type, input_value, prior_day_ot, region, working_days_per_month, service_fee_type, service_fee_value, result_json')
        .order('created_at', { ascending: false }).limit(50);
      if (error) { toast('Không tải được danh sách báo giá: ' + error.message); setSavedQuotes([]); return; }
      setSavedQuotes((data ?? []) as SavedQuote[]);
    }
  }

  // Kéo TẤT CẢ NCC đang phục vụ 1 công ty (bảng lương ở Thị trường) vào đây thành từng dòng —
  // đúng nhu cầu "cùng công ty AMPACS, xem mỗi NCC đang trả bao nhiêu". Giá khách trả để trống
  // vì bảng lương NCC không chứa thông tin đó; nhập thêm thì mới ra được phí dịch vụ.
  async function importCompanySuppliers() {
    const client = clients.find(c => c.id === companyForImport);
    if (!client) { toast('Chọn 1 khách hàng để lấy danh sách NCC'); return; }
    setImportingSuppliers(true);
    const { data, error } = await supabase.from('clients').select('market_suppliers').eq('id', client.id).maybeSingle();
    setImportingSuppliers(false);
    if (error) { toast('Không đọc được danh sách NCC: ' + error.message); return; }
    const list = ((data?.market_suppliers ?? []) as MarketLeadSupplier[]);
    const usable = list
      .map(s => ({ s, picked: pickPayrollInputFromWageDetail(s.wage_detail, wageFields) }))
      .filter((x): x is { s: MarketLeadSupplier; picked: NonNullable<ReturnType<typeof pickPayrollInputFromWageDetail>> } => x.picked !== null);
    if (usable.length === 0) { toast(`${client.name} chưa có NCC nào có bảng lương gán được loại đơn giá`); return; }

    const newRows: CompareRow[] = usable.map(({ s, picked }) => ({
      id: nextRowId(),
      source: s.is_us ? `${s.name} (mình)` : s.name,
      type: picked.type, value: picked.value, priorDayOt: false,
      workerSupport: Object.values(allowancesFromWageDetail(s.wage_detail, wageFields)).reduce((a, b) => a + b, 0),
      clientSupportPaid: 0, customerPriceValue: 0,
      ours: !!s.is_us,
      importedNote: `${client.name} · ${picked.fieldName}`,
    }));
    // Nếu đã có dòng "của mình" trong danh sách kéo về thì bỏ cờ ours ở các dòng cũ để không trùng.
    const hasOurs = newRows.some(r => r.ours);
    setRows(prev => {
      const isBlank = (r: CompareRow) => r.value <= 0 && !r.source.trim() && r.customerPriceValue <= 0;
      const kept = prev.filter(r => !isBlank(r)).map(r => hasOurs ? { ...r, ours: false } : r);
      return [...kept, ...newRows];
    });
    toast(`Đã thêm ${newRows.length} NCC của ${client.name} vào bảng so sánh`);
  }

  // ── Tính toán từng dòng (công thức nằm ở compareEngine.ts, có unit test riêng) ─────────────
  const rowStats = rows.map(r => ({ row: r, ...computeCompareRow(r, region, workingDaysPerMonth) }));
  const oursEntry = rowStats.find(r => r.row.ours && r.monthly > 0);
  const othersEntries = rowStats.filter(r => !r.row.ours && r.monthly > 0);

  const mktAvgWage = averageOf(othersEntries.map(r => r.workerTotal));
  const wageDiff = oursEntry && mktAvgWage !== null ? oursEntry.workerTotal - mktAvgWage : null;
  const wageDiffPct = wageDiff !== null && mktAvgWage ? (wageDiff / mktAvgWage) * 100 : null;

  const othersWithFee = othersEntries.filter(r => r.serviceFee !== null);
  const mktAvgFee = averageOf(othersWithFee.map(r => r.serviceFee));
  const feeDiff = oursEntry && oursEntry.serviceFee !== null && mktAvgFee !== null ? oursEntry.serviceFee - mktAvgFee : null;
  const feeDiffPct = feeDiff !== null && mktAvgFee ? (feeDiff / mktAvgFee) * 100 : null;

  const regionMinWage = regionWages?.[region] ?? 0;
  const rowsBelowMinWage = rowStats.filter(r => r.monthly > 0 && regionMinWage > 0 && r.monthly < regionMinWage);
  const mismatchedDays = rows.filter(r => r.importedDays && r.importedDays !== workingDaysPerMonth);

  async function save() {
    if (!kcnName.trim()) { toast('Chọn hoặc nhập tên KCN trước khi lưu'); return; }
    setSaving(true);
    const payload = {
      kcn_zone_id: kcnSelect && marketZones.some(z => z.id === kcnSelect) ? kcnSelect : null,
      kcn_name: kcnName.trim(), region, working_days_per_month: workingDaysPerMonth, rows,
      created_by: user?.id ?? null, updated_at: new Date().toISOString(),
    };
    const { error } = loadedId
      ? await supabase.from('region_price_comparisons').update(payload).eq('id', loadedId)
      : await supabase.from('region_price_comparisons').insert(payload).select('id').single().then(({ data, error: insertError }) => {
          if (data) setLoadedId(data.id);
          return { error: insertError };
        });
    setSaving(false);
    if (error) { toast('Có lỗi khi lưu: ' + error.message); return; }
    toast(`Đã lưu bảng so sánh giá cho ${kcnName.trim()}`);
  }

  function useOursForQuote() {
    if (!oursEntry) return;
    const r = oursEntry.row;
    onUseForQuote({
      source: r.source, type: r.type, value: r.value, priorDayOt: r.priorDayOt,
      workerSupport: r.workerSupport, clientSupportPaid: r.clientSupportPaid, customerPriceValue: r.customerPriceValue,
      workingDays: workingDaysPerMonth, region, note: 'Từ bảng so sánh giá vùng',
      kcnZoneId: kcnSelect, kcnName,
    });
  }

  const numCls = 'w-24 text-[11.5px] px-1.5 py-1 border border-gray-300 rounded-md outline-none focus:border-blue-500 text-right';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="text-[11.5px] font-medium text-gray-700 block mb-1">KCN / Vị trí</label>
          <SearchSelect value={kcnSelect} onChange={handleKcnSelect} options={zoneOptions} placeholder="Chọn hoặc gõ tên KCN…" allowAdd />
        </div>
        <div>
          <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Vùng lương</label>
          <select value={region} onChange={e => setRegion(e.target.value as RegionZone)}
            className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white">
            {REGION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11.5px] font-medium text-gray-700 block mb-1">Ngày công/tháng (áp dụng chung)</label>
          <input type="number" min={1} max={31} value={workingDaysPerMonth} onChange={e => setWorkingDays(Math.max(1, parseInt(e.target.value) || 26))}
            className="w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
        </div>
      </div>

      {loading && <div className="text-[11px] text-gray-400">Đang tải bảng so sánh đã lưu…</div>}
      {!loading && loadedId && <div className="text-[10.5px] text-emerald-700">Đã tải bảng so sánh đã lưu cho KCN này — thêm nguồn mới rồi Lưu để cập nhật.</div>}

      {rowsBelowMinWage.length > 0 && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5" />
          <span className="text-[12px] text-red-700">
            {rowsBelowMinWage.length} nguồn có lương tháng chuẩn thấp hơn lương tối thiểu vùng ({fmtVnd(regionMinWage)}đ):{' '}
            {rowsBelowMinWage.map(r => r.row.source.trim() || 'nguồn chưa đặt tên').join(', ')}. Phụ cấp không được tính vào lương tối thiểu (Điều 90 BLLĐ 2019).
          </span>
        </div>
      )}

      {mismatchedDays.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <span className="text-[12px] text-amber-700">
            {mismatchedDays.length} nguồn được nhập từ nơi khác có ngày công gốc khác {workingDaysPerMonth} ngày ({mismatchedDays.map(r => `${r.source.trim() || 'nguồn'}: ${r.importedDays} ngày`).join(', ')}). Bảng đang quy tất cả về {workingDaysPerMonth} ngày để so sánh ngang hàng — số của các nguồn đó sẽ lệch so với bản gốc.
          </span>
        </div>
      )}

      <div className="text-[10.5px] text-[#999]">
        Nhập lương từng nguồn → hệ thống chia đúng luật (SHR, BHXH). <b>Hỗ trợ NLĐ nhận</b> là tiền NCC thực trả cho NLĐ (chi phí); <b>Hỗ trợ khách trả</b> là tiền khách trả cho khoản đó (doanh thu) — 2 số lệch nhau chính là phần NCC giữ lại. Thêm <b>Giá khách trả/ngày</b> thì mới suy ra được Phí dịch vụ.
      </div>

      <div className="overflow-x-auto border border-[#E8E7E2] rounded-lg">
        <table className="w-full text-[11.5px] min-w-[1240px]">
          <thead className="bg-[#F9F9F7] text-[#888]">
            <tr>
              <th rowSpan={2} className="text-left px-2 py-1.5 font-medium align-bottom">Nguồn</th>
              <th colSpan={2} className="text-center px-2 py-1 font-medium border-b border-[#E8E7E2]">Đơn giá lương nhập vào</th>
              <th colSpan={3} className="text-center px-2 py-1 font-medium border-b border-l border-[#E8E7E2]">Người lao động nhận</th>
              <th colSpan={4} className="text-center px-2 py-1 font-medium border-b border-l border-[#E8E7E2]">Chi phí và tiền khách trả</th>
              <th rowSpan={2} className="text-center px-2 py-1.5 font-medium align-bottom">Của mình</th>
              <th rowSpan={2}></th>
            </tr>
            <tr>
              <th className="text-left px-2 py-1.5 font-medium">Loại đơn giá</th>
              <th className="text-right px-2 py-1.5 font-medium">Giá trị</th>
              <th className="text-right px-2 py-1.5 font-medium border-l border-[#E8E7E2]">Hỗ trợ NLĐ nhận/tháng</th>
              <th className="text-right px-2 py-1.5 font-medium">Lương tháng chuẩn</th>
              <th className="text-right px-2 py-1.5 font-medium">Tổng gói NLĐ</th>
              <th className="text-right px-2 py-1.5 font-medium border-l border-[#E8E7E2]">Chi phí LĐ (gồm BH)</th>
              <th className="text-right px-2 py-1.5 font-medium">Giá khách trả/ngày</th>
              <th className="text-right px-2 py-1.5 font-medium">Hỗ trợ khách trả/tháng</th>
              <th className="text-right px-2 py-1.5 font-medium">Phí dịch vụ suy ra</th>
            </tr>
          </thead>
          <tbody>
            {rowStats.map(({ row, monthly, workerTotal, laborCost, serviceFee }) => {
              const below = monthly > 0 && regionMinWage > 0 && monthly < regionMinWage;
              return (
                <tr key={row.id} className={`border-t border-[#F0EFEB] ${row.ours ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-1">
                    <input value={row.source} onChange={e => updateRow(row.id, { source: e.target.value })} placeholder="Tên nguồn (VD: NCC A)"
                      className="w-full min-w-[130px] text-[11.5px] px-1.5 py-1 border border-gray-300 rounded-md outline-none focus:border-blue-500" />
                    {row.importedNote && <div className="text-[9.5px] text-[#aaa] mt-0.5 truncate">{row.importedNote}</div>}
                  </td>
                  <td className="px-2 py-1">
                    <select value={row.type} onChange={e => updateRow(row.id, { type: e.target.value as PayrollInputType })}
                      className="w-full min-w-[150px] text-[11.5px] px-1.5 py-1 border border-gray-300 rounded-md outline-none focus:border-blue-500 bg-white">
                      {(Object.keys(PAYROLL_INPUT_LABELS) as PayrollInputType[]).map(t => <option key={t} value={t}>{PAYROLL_INPUT_LABELS[t]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} value={row.value || ''} onChange={e => updateRow(row.id, { value: parseFloat(e.target.value) || 0 })} className={numCls} />
                  </td>
                  <td className="px-2 py-1 border-l border-[#F0EFEB]">
                    <input type="number" min={0} value={row.workerSupport || ''} onChange={e => updateRow(row.id, { workerSupport: parseFloat(e.target.value) || 0 })} placeholder="0" className={numCls} />
                  </td>
                  <td className={`px-2 py-1 text-right ${below ? 'text-red-600 font-semibold' : 'text-[#666]'}`}>{monthly > 0 ? `${fmtVnd(monthly)}đ` : '—'}</td>
                  <td className="px-2 py-1 text-right font-medium text-[#111]">{workerTotal > 0 ? `${fmtVnd(workerTotal)}đ` : '—'}</td>
                  <td className="px-2 py-1 text-right text-[#888] border-l border-[#F0EFEB]">{laborCost > 0 ? `${fmtVnd(laborCost)}đ` : '—'}</td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} value={row.customerPriceValue || ''} onChange={e => updateRow(row.id, { customerPriceValue: parseFloat(e.target.value) || 0 })} placeholder="0" className={numCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" min={0} value={row.clientSupportPaid || ''} onChange={e => updateRow(row.id, { clientSupportPaid: parseFloat(e.target.value) || 0 })} placeholder="0" className={numCls} />
                  </td>
                  <td className={`px-2 py-1 text-right font-medium ${serviceFee === null ? 'text-[#aaa]' : serviceFee < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {serviceFee !== null ? `${fmtVnd(serviceFee)}đ` : '—'}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input type="radio" name="compare_ours" checked={row.ours} onChange={() => setOurs(row.id)} className="accent-blue-600" />
                  </td>
                  <td className="px-2 py-1">
                    <button onClick={() => removeRow(row.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={addRow} className="flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline">
          <Plus size={13} /> Thêm nguồn trống
        </button>
        <button onClick={importFromSingleTab} className="flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline">
          <Download size={13} /> Lấy từ tab "Tính 1 bảng lương"
        </button>
        <button onClick={toggleQuotePicker} className="flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline">
          <Download size={13} /> Lấy từ báo giá đã lưu {showQuotePicker ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 border border-[#E8E7E2] rounded-lg p-2.5 bg-[#FBFAF7]">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[11px] font-medium text-gray-700 block mb-1">Lấy cả dàn NCC đang phục vụ 1 công ty</label>
          <SearchSelect value={companyForImport} onChange={setCompanyForImport}
            options={clients.map(c => ({ value: c.id, label: c.name }))} placeholder="Chọn khách hàng…" />
        </div>
        <button onClick={importCompanySuppliers} disabled={!companyForImport || importingSuppliers}
          className="px-3 py-1.5 text-[11.5px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 rounded-lg transition whitespace-nowrap">
          {importingSuppliers ? 'Đang lấy…' : 'Thêm vào bảng'}
        </button>
        <div className="w-full text-[10.5px] text-[#999]">
          Kéo bảng lương từng NCC tại công ty đó (Thị trường) thành từng dòng. Giá khách trả không có sẵn ở đó — nhập thêm vào cột "Giá khách trả/ngày" thì mới ra được phí dịch vụ để so.
        </div>
      </div>

      {showQuotePicker && (
        <div className="border border-[#E8E7E2] rounded-lg p-2.5 bg-[#FBFAF7] space-y-1.5 max-h-56 overflow-y-auto">
          {savedQuotes === null ? (
            <div className="text-[11px] text-gray-400">Đang tải danh sách báo giá…</div>
          ) : savedQuotes.length === 0 ? (
            <div className="text-[11px] text-gray-400">Chưa có báo giá nào được lưu.</div>
          ) : savedQuotes.map(q => (
            <div key={q.id} className="flex items-center gap-2 bg-white border border-[#E8E7E2] rounded-md px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-[11.5px] font-medium text-[#111] truncate">{q.company_name}{q.kcn_name ? ` — ${q.kcn_name}` : ''}</div>
                <div className="text-[10px] text-[#888] truncate">
                  {PAYROLL_INPUT_LABELS[q.input_type] ?? q.input_type}: {fmtVnd(Number(q.input_value))}đ · Vùng {q.region} · {q.working_days_per_month} ngày công · {new Date(q.created_at).toLocaleDateString('vi-VN')}
                </div>
              </div>
              <button onClick={() => { addImported(quoteToImport(q), false); toast(`Đã thêm "${q.company_name}" vào bảng so sánh`); }}
                className="shrink-0 text-[11px] text-blue-600 hover:underline whitespace-nowrap">+ Thêm vào bảng</button>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="text-[11.5px] font-semibold text-[#333] mb-1.5">So sánh tổng gói NLĐ nhận (lương chuẩn + hỗ trợ)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3">
            <div className="text-[11px] text-[#888]">Trung bình các nguồn khác ({othersEntries.length} nguồn)</div>
            <div className="text-[15px] font-bold text-[#0c2340] mt-1">{mktAvgWage !== null ? `${fmtVnd(mktAvgWage)}đ` : '—'}</div>
          </div>
          <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3">
            <div className="text-[11px] text-[#888]">Của mình</div>
            <div className="text-[15px] font-bold text-[#0c2340] mt-1">{oursEntry ? `${fmtVnd(oursEntry.workerTotal)}đ` : '—'}</div>
          </div>
          <div className={`border rounded-lg p-3 ${wageDiffPct === null ? 'bg-[#FBFAF7] border-[#E8E7E2]' : Math.abs(wageDiffPct) < 3 ? 'bg-emerald-50 border-emerald-200' : wageDiff! > 0 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
            <div className="text-[11px] text-[#888]">{wageDiff === null ? 'Chênh lệch' : wageDiff >= 0 ? 'Mình trả NLĐ CAO hơn' : 'Mình trả NLĐ THẤP hơn'}</div>
            <div className={`text-[15px] font-bold mt-1 ${wageDiffPct === null ? 'text-[#0c2340]' : Math.abs(wageDiffPct) < 3 ? 'text-emerald-700' : wageDiff! > 0 ? 'text-amber-700' : 'text-red-700'}`}>
              {wageDiff !== null && wageDiffPct !== null ? `${wageDiff >= 0 ? '+' : ''}${fmtVnd(wageDiff)}đ (${wageDiff >= 0 ? '+' : ''}${wageDiffPct.toFixed(1)}%)` : '—'}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-[11.5px] font-semibold text-[#333] mb-1.5">So sánh phí dịch vụ (chỉ tính nguồn đã có giá khách trả)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3">
            <div className="text-[11px] text-[#888]">Trung bình các nguồn khác ({othersWithFee.length} nguồn)</div>
            <div className="text-[15px] font-bold text-[#0c2340] mt-1">{mktAvgFee !== null ? `${fmtVnd(mktAvgFee)}đ` : '—'}</div>
          </div>
          <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3">
            <div className="text-[11px] text-[#888]">Của mình</div>
            <div className="text-[15px] font-bold text-[#0c2340] mt-1">{oursEntry && oursEntry.serviceFee !== null ? `${fmtVnd(oursEntry.serviceFee)}đ` : '—'}</div>
          </div>
          <div className={`border rounded-lg p-3 ${feeDiffPct === null ? 'bg-[#FBFAF7] border-[#E8E7E2]' : Math.abs(feeDiffPct) < 3 ? 'bg-emerald-50 border-emerald-200' : feeDiff! > 0 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
            <div className="text-[11px] text-[#888]">{feeDiff === null ? 'Chênh lệch' : feeDiff >= 0 ? 'Mình thu phí CAO hơn' : 'Mình thu phí THẤP hơn'}</div>
            <div className={`text-[15px] font-bold mt-1 ${feeDiffPct === null ? 'text-[#0c2340]' : Math.abs(feeDiffPct) < 3 ? 'text-emerald-700' : feeDiff! > 0 ? 'text-amber-700' : 'text-red-700'}`}>
              {feeDiff !== null && feeDiffPct !== null ? `${feeDiff >= 0 ? '+' : ''}${fmtVnd(feeDiff)}đ (${feeDiff >= 0 ? '+' : ''}${feeDiffPct.toFixed(1)}%)` : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !kcnName.trim()}
          className="flex-1 px-3 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition">
          {saving ? 'Đang lưu...' : 'Lưu bảng so sánh'}
        </button>
        {oursEntry && (
          <button onClick={useOursForQuote}
            className="flex items-center justify-center gap-1 px-3 py-2 text-[13px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition">
            Dùng giá này để tính báo giá <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
