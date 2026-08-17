import { useState } from 'react';
import { Plus, X, Pencil, Trash2, Scale, ChevronDown, ChevronUp } from 'lucide-react';
import type { MarketLeadSupplier, Competitor } from '../../lib/types';
import type { MergedSupplier } from './supplierLink';
import SearchSelect from './SearchSelect';
import WageDetailTable from './WageDetailTable';
import { wageDetailToStrings, wageDetailToNumbers } from './wageFields';
import { fmtVnd } from '../../lib/payroll/format';

interface SupForm {
  name: string; qty: string; wage_min: string; wage_max: string;
  /** Giá vốn — NCC trả cho người lao động. */
  wage_detail: Record<string, string>;
  /** Giá bán — công ty/nhà máy trả cho NCC. */
  wage_detail_client: Record<string, string>;
}
const emptySupForm: SupForm = { name: '', qty: '0', wage_min: '', wage_max: '', wage_detail: {}, wage_detail_client: {} };

// Khoảng lương vẫn hiển thị gọn bằng "tr" vì nằm trong 1 hàng chật, nhưng Ô NHẬP thì bằng
// ĐỒNG (migration 126) để khớp đơn vị với Tính bảng lương — xem wageFields.ts.
const wageFmt = (min: number | null | undefined, max: number | null | undefined) =>
  min != null && max != null ? `${(min / 1_000_000).toFixed(1)}–${(max / 1_000_000).toFixed(1)}tr` : null;

const tr = (v: number | null | undefined) => v != null ? fmtVnd(v) : '—';
const sumDetail = (d: Record<string, number> | null | undefined) => Object.values(d ?? {}).reduce((a, b) => a + (b || 0), 0);
/** Giá vốn — NCC trả NLĐ. */
const detailTotal = (s: MarketLeadSupplier) => sumDetail(s.wage_detail);
/** Giá bán — công ty trả NCC. */
const clientTotal = (s: MarketLeadSupplier) => sumDetail(s.wage_detail_client);

/**
 * Bảng giá giữa các bên tại cùng 1 công ty/dự án. Mỗi NCC có 2 phía:
 *   - GIÁ BÁN  (`wage_detail_client`): công ty/nhà máy trả cho NCC đó
 *   - GIÁ VỐN  (`wage_detail`)       : NCC đó trả cho người lao động
 * Chênh lệch 2 phía = phí dịch vụ NCC đang ăn — con số cần để định giá, thay vì
 * chỉ nhìn khoảng lương áng chừng. LGVN luôn ghim cột đầu để đối chiếu.
 */
function WageCompareTable({ suppliers, selected }: { suppliers: MarketLeadSupplier[]; selected: MarketLeadSupplier[] }) {
  const lgvn = suppliers.find(s => s.is_us);
  const cols = [...selected].sort((a, b) => (b.is_us ? 1 : 0) - (a.is_us ? 1 : 0));
  if (cols.length === 0) return <div className="text-[11px] text-[#aaa] px-1 py-2">Chọn ít nhất 1 NCC để so sánh.</div>;

  const fieldsOf = (pick: (s: MarketLeadSupplier) => Record<string, number> | null | undefined) =>
    [...new Set(cols.flatMap(s => Object.keys(pick(s) ?? {})))];
  const sellFields = fieldsOf(s => s.wage_detail_client);
  const costFields = fieldsOf(s => s.wage_detail);
  const margin = (s: MarketLeadSupplier) => clientTotal(s) - detailTotal(s);
  const lgvnMargin = lgvn ? margin(lgvn) : 0;

  const headCell = 'text-left px-2 py-1 text-[#888] font-medium sticky left-0 bg-white';
  const rowLabel = 'px-2 py-1 text-[#666] sticky left-0 bg-white truncate max-w-[150px]';
  const sectionRow = (title: string, hint: string) => (
    <tr className="border-t border-[#E8E7E2] bg-[#F9F9F7]">
      <td className="px-2 py-1 sticky left-0 bg-[#F9F9F7]">
        <span className="text-[11px] font-semibold text-[#333]">{title}</span>
        <span className="text-[10px] text-[#999] ml-1">{hint}</span>
      </td>
      <td colSpan={cols.length} className="bg-[#F9F9F7]" />
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="text-[11.5px] border-collapse min-w-full">
        <thead>
          <tr>
            <th className={headCell}>Khoản</th>
            {cols.map((s, i) => (
              <th key={i} className={`text-right px-2 py-1 font-medium whitespace-nowrap ${s.is_us ? 'text-blue-700' : 'text-[#333]'}`}>
                {s.is_us ? '● ' : ''}{s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[#F0EEE9]">
            <td className={rowLabel}>Lương (khoảng)</td>
            {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#333]">{wageFmt(s.wage_min, s.wage_max) ?? '—'}</td>)}
          </tr>

          {sectionRow('GIÁ BÁN', '· công ty trả NCC')}
          {sellFields.map(f => (
            <tr key={'sell-' + f} className="border-t border-[#F0EEE9]">
              <td className={rowLabel}>{f}</td>
              {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#333]">{tr(s.wage_detail_client?.[f])}</td>)}
            </tr>
          ))}
          {!sellFields.length && (
            <tr className="border-t border-[#F0EEE9]"><td className={rowLabel}>—</td>
              <td colSpan={cols.length} className="px-2 py-1 text-[10.5px] text-[#aaa]">Chưa nhập khoản nào công ty trả cho NCC</td>
            </tr>
          )}
          <tr className="border-t border-[#F0EEE9] font-medium">
            <td className="px-2 py-1 text-[#333] sticky left-0 bg-white">Tổng giá bán</td>
            {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#111]">{tr(clientTotal(s))}đ</td>)}
          </tr>

          {sectionRow('GIÁ VỐN', '· NCC trả người lao động')}
          {costFields.map(f => (
            <tr key={'cost-' + f} className="border-t border-[#F0EEE9]">
              <td className={rowLabel}>{f}</td>
              {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#333]">{tr(s.wage_detail?.[f])}</td>)}
            </tr>
          ))}
          {!costFields.length && (
            <tr className="border-t border-[#F0EEE9]"><td className={rowLabel}>—</td>
              <td colSpan={cols.length} className="px-2 py-1 text-[10.5px] text-[#aaa]">Chưa nhập khoản nào NCC trả người lao động</td>
            </tr>
          )}
          <tr className="border-t border-[#F0EEE9] font-medium">
            <td className="px-2 py-1 text-[#333] sticky left-0 bg-white">Tổng giá vốn</td>
            {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#111]">{tr(detailTotal(s))}đ</td>)}
          </tr>

          {sectionRow('CHÊNH LỆCH', '· phí dịch vụ NCC ăn')}
          <tr className="border-t border-[#F0EEE9] font-medium">
            <td className="px-2 py-1 text-[#333] sticky left-0 bg-white">Giá bán − giá vốn</td>
            {cols.map((s, i) => {
              const m = margin(s);
              // Chỉ có nghĩa khi đã nhập cả 2 phía — 1 phía trống thì chênh lệch bằng chính
              // phía kia, dễ bị đọc nhầm là "lãi to".
              const complete = clientTotal(s) > 0 && detailTotal(s) > 0;
              return (
                <td key={i} className={`text-right px-2 py-1 ${complete ? 'text-[#111]' : 'text-[#ccc]'}`}
                  title={complete ? undefined : 'Cần nhập cả giá bán lẫn giá vốn mới tính được'}>
                  {complete ? `${tr(m)}đ` : '—'}
                </td>
              );
            })}
          </tr>
          <tr className="border-t border-[#F0EEE9]">
            <td className={rowLabel}>Tỷ lệ trên giá bán</td>
            {cols.map((s, i) => {
              const sell = clientTotal(s);
              const complete = sell > 0 && detailTotal(s) > 0;
              return <td key={i} className={`text-right px-2 py-1 ${complete ? 'text-[#555]' : 'text-[#ccc]'}`}>
                {complete ? `${Math.round((margin(s) / sell) * 100)}%` : '—'}
              </td>;
            })}
          </tr>
          {lgvn && (
            <tr className="border-t border-[#F0EEE9]">
              <td className={rowLabel}>Chênh lệch so với LGVN</td>
              {cols.map((s, i) => {
                if (s.is_us) return <td key={i} className="text-right px-2 py-1 text-[#ccc]">—</td>;
                const complete = clientTotal(s) > 0 && detailTotal(s) > 0 && clientTotal(lgvn) > 0 && detailTotal(lgvn) > 0;
                if (!complete) return <td key={i} className="text-right px-2 py-1 text-[#ccc]">—</td>;
                const diff = margin(s) - lgvnMargin;
                const cls = diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-[#999]';
                return <td key={i} className={`text-right px-2 py-1 font-medium ${cls}`}>{diff > 0 ? '+' : ''}{tr(diff)}đ</td>;
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Form nhập tên/SL/lương NCC (kèm bảng chi tiết lương dùng chung) — dùng chung cho cả thêm mới và sửa. */
function SupplierInlineForm({ form, setForm, competitorNames, onSubmit, onCancel, saving, allowNameEdit = true, lockedQtyNote, wageFields, onAddWageField, onDeleteWageField, onRenameWageField, onReorderWageFields }: {
  form: SupForm;
  setForm: (f: SupForm) => void;
  competitorNames: string[];
  onSubmit: () => void;
  onCancel: () => void;
  saving?: boolean;
  allowNameEdit?: boolean;
  /** Có giá trị = số LĐ lấy tự động từ nơi khác, chỉ hiện chứ không cho gõ. */
  lockedQtyNote?: string;
  wageFields: string[];
  onAddWageField: (name: string) => Promise<void> | void;
  onDeleteWageField: (name: string) => Promise<void> | void;
  onRenameWageField?: (oldName: string, newName: string) => Promise<void> | void;
  onReorderWageFields?: (names: string[]) => Promise<void> | void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {!allowNameEdit ? (
          <span className="text-[12px] font-medium min-w-[160px] flex-1 px-2 py-1">{form.name}</span>
        ) : competitorNames.length > 0 ? (
          <SearchSelect
            value={form.name}
            onChange={v => setForm({ ...form, name: v })}
            options={competitorNames.map(n => ({ value: n, label: n }))}
            placeholder="Chọn NCC (Đối thủ)…"
            className="flex-1 min-w-[160px]"
          />
        ) : (
          <span className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex-1 min-w-[160px]">
            Chưa có hồ sơ Đối thủ nào — tạo ở tab "Đối thủ" trước khi thêm NCC.
          </span>
        )}
        {lockedQtyNote ? (
          <span title={lockedQtyNote} className="text-[12px] px-2 py-1 rounded border border-[#E8E7E2] bg-[#F5F4EF] text-[#666] w-16 text-center cursor-help shrink-0">{form.qty}</span>
        ) : (
          <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Số LĐ" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-16" />
        )}
        <input type="number" step="100000" value={form.wage_min} onChange={e => setForm({ ...form, wage_min: e.target.value })} placeholder="Lương từ (đ)" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-28 text-right" />
        <input type="number" step="100000" value={form.wage_max} onChange={e => setForm({ ...form, wage_max: e.target.value })} placeholder="đến (đ)" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-28 text-right" />
        <button onClick={onSubmit} disabled={saving} className="px-2.5 py-1 rounded bg-[#1D4ED8] text-white text-[12px]">Lưu</button>
        <button onClick={onCancel} className="px-2 py-1 rounded border border-gray-300 text-[12px]"><X size={12} /></button>
      </div>
      {/* 2 phía của cùng 1 NCC — nhập đủ mới so được phí dịch vụ họ ăn, thay vì áng chừng
          qua khoảng lương. Cùng bộ trường dùng chung nên đối chiếu được từng khoản. */}
      <WageDetailTable
        label="Chi tiết giá BÁN · công ty trả NCC"
        fields={wageFields}
        value={form.wage_detail_client}
        onChange={v => setForm({ ...form, wage_detail_client: v })}
        onAddField={onAddWageField}
        onDeleteField={onDeleteWageField}
        onRenameField={onRenameWageField}
        onReorderFields={onReorderWageFields}
      />
      <WageDetailTable
        label="Chi tiết giá VỐN · NCC trả người lao động"
        fields={wageFields}
        value={form.wage_detail}
        onChange={v => setForm({ ...form, wage_detail: v })}
        onAddField={onAddWageField}
        onDeleteField={onDeleteWageField}
        onRenameField={onRenameWageField}
        onReorderFields={onReorderWageFields}
      />
    </div>
  );
}

/** Thẻ "Nhu cầu / Đã fill / Còn thiếu" + bảng NCC (thêm/sửa/xoá, kèm mức lương + chi tiết
 * lương riêng từng NCC tại dự án này) — bảng chung cho cả Let's Go VN lẫn đối thủ, dùng
 * chung cho Khách hàng đang hợp tác và Công ty/Dự án đang tìm hiểu. */
export default function SupplierFillCard({
  workersNeeded, suppliers, onAddSupplier, onEditSupplier, onDeleteSupplier, saving, competitors,
  wageFields, onAddWageField, onDeleteWageField, onRenameWageField, onReorderWageFields,
}: {
  workersNeeded: number;
  /** Danh sách đã gộp JSON + competitor_clients (xem supplierLink.mergeSuppliers). */
  suppliers: MergedSupplier[];
  onAddSupplier: (name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>, wageDetailClient: Record<string, number>) => Promise<void> | void;
  onEditSupplier?: (row: MergedSupplier, name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>, wageDetailClient: Record<string, number>) => Promise<void> | void;
  onDeleteSupplier?: (row: MergedSupplier) => Promise<void> | void;
  saving?: boolean;
  /** Hồ sơ Đối thủ đã tạo sẵn (menu Đối thủ) — chọn thay vì gõ tay, tự gợi ý mức lương chung của NCC đó. */
  competitors?: Competitor[];
  /** Danh sách trường lương chi tiết dùng chung toàn hệ thống (bảng wage_detail_fields). */
  wageFields: string[];
  onAddWageField: (name: string) => Promise<void> | void;
  onDeleteWageField: (name: string) => Promise<void> | void;
  onRenameWageField?: (oldName: string, newName: string) => Promise<void> | void;
  onReorderWageFields?: (names: string[]) => Promise<void> | void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<SupForm>(emptySupForm);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SupForm>(emptySupForm);
  const [showCompare, setShowCompare] = useState(false);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  // null = chưa đụng vào → mặc định chọn hết nhóm được phép so (LGVN + TOP 5).
  const [comparePick, setComparePick] = useState<Set<number> | null>(null);

  // LGVN luôn ghim đầu danh sách; các NCC còn lại xếp theo số LĐ cung ứng giảm dần.
  // Giữ kèm index gốc vì onEdit/onDeleteSupplier nhận vị trí trong mảng `suppliers`.
  const rows = suppliers.map((s, i) => ({ s, i }));
  const usRows = rows.filter(x => x.s.is_us);
  const otherRows = rows.filter(x => !x.s.is_us).sort((a, b) => b.s.qty - a.s.qty);
  const TOP_N = 5;
  const topRows = otherRows.slice(0, TOP_N);
  const restRows = otherRows.slice(TOP_N);
  // Chỉ so sánh lương với TOP 5 NCC (kèm LGVN).
  const compareRows = [...usRows, ...topRows];
  const isPicked = (i: number) => comparePick ? comparePick.has(i) : true;
  const toggleCompare = (i: number) => setComparePick(prev => {
    const next = new Set(prev ?? compareRows.map(x => x.i));
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const total = suppliers.reduce((s, x) => s + x.qty, 0);
  const remaining = Math.max(workersNeeded - total, 0);
  const pct = workersNeeded > 0 ? Math.round((total / workersNeeded) * 100) : 0;
  // Chưa nhập "Nhu cầu" thì % fill vô nghĩa (mọi thanh đều 0% dù đã biết cả nghìn LĐ) —
  // đổi mẫu số sang tổng LĐ đã biết để vẫn đọc được NCC nào đang giữ phần lớn nhất.
  const hasDemand = workersNeeded > 0;
  const shareBase = hasDemand ? workersNeeded : total;
  const shareOf = (qty: number) => shareBase > 0 ? Math.round((qty / shareBase) * 100) : 0;
  const competitorNames = [...new Set((competitors ?? []).map(c => c.company_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

  // Khi chọn NCC trong form THÊM MỚI, gợi ý sẵn lương chung từ hồ sơ Đối thủ (nếu chưa gõ lương).
  const setAddFormWithSuggest = (f: SupForm) => {
    if (f.name === addForm.name || addForm.wage_min || addForm.wage_max) { setAddForm(f); return; }
    const match = competitors?.find(c => c.company_name === f.name && c.wage_paid != null);
    const suggested = match ? String(match.wage_paid!) : '';
    setAddForm(suggested ? { ...f, wage_min: suggested, wage_max: suggested } : f);
  };

  const toNum = (v: string) => v.trim() ? parseFloat(v) || null : null;

  const submitAdd = async () => {
    if (!addForm.name.trim()) return;
    await onAddSupplier(addForm.name.trim(), parseInt(addForm.qty) || 0, toNum(addForm.wage_min), toNum(addForm.wage_max), wageDetailToNumbers(addForm.wage_detail), wageDetailToNumbers(addForm.wage_detail_client));
    setShowAdd(false);
    setAddForm(emptySupForm);
  };

  const startEdit = (i: number, s: MarketLeadSupplier) => {
    setShowAdd(false);
    setEditIndex(i);
    setEditForm({
      name: s.name, qty: String(s.qty),
      wage_min: s.wage_min != null ? String(s.wage_min) : '',
      wage_max: s.wage_max != null ? String(s.wage_max) : '',
      wage_detail: wageDetailToStrings(s.wage_detail),
      wage_detail_client: wageDetailToStrings(s.wage_detail_client),
    });
  };

  const submitEdit = async () => {
    if (editIndex == null || !editForm.name.trim()) return;
    const row = suppliers[editIndex];
    if (!row) return;
    await onEditSupplier?.(row, editForm.name.trim(), parseInt(editForm.qty) || 0, toNum(editForm.wage_min), toNum(editForm.wage_max), wageDetailToNumbers(editForm.wage_detail), wageDetailToNumbers(editForm.wage_detail_client));
    setEditIndex(null);
  };

  // Số LĐ của 1 NCC là MỘT dữ liệu duy nhất, chỉ hiển thị ở nhiều nơi (thẻ công ty, hồ sơ
  // đối thủ, hồ sơ KCN). Xoá là xoá hẳn, nên nói rõ để không ai tưởng chỉ ẩn ở màn này.
  const handleDelete = async (row: MergedSupplier) => {
    const scope = row.ccIds.length ? '\n\nDữ liệu này dùng chung — xoá ở đây thì hồ sơ đối thủ và hồ sơ KCN cũng mất theo.' : '';
    if (!confirm(`Xoá NCC "${row.name}" khỏi danh sách?${scope}`)) return;
    await onDeleteSupplier?.(row);
  };

  return (
    <div>
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <div className="bg-[#F9F9F7] rounded-lg px-3 py-1.5 text-center"><div className="text-[10px] text-[#aaa]">Nhu cầu</div><div className="text-[14px] font-medium">{workersNeeded}</div></div>
        <div className="bg-[#F9F9F7] rounded-lg px-3 py-1.5 text-center"><div className="text-[10px] text-[#aaa]">Đã fill</div><div className="text-[14px] font-medium text-emerald-600">{total}</div></div>
        <div className={`rounded-lg px-3 py-1.5 text-center ${!hasDemand ? 'bg-[#F9F9F7]' : remaining > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}><div className={`text-[10px] ${!hasDemand ? 'text-[#aaa]' : remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>Còn thiếu</div><div className={`text-[14px] font-medium ${!hasDemand ? 'text-[#ccc]' : remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{hasDemand ? remaining : '—'}</div></div>
        <div className="flex-1 min-w-[120px]">
          <div className="text-[10px] text-[#aaa] mb-1">
            {hasDemand
              ? `${pct}% fill`
              : <>Chưa nhập nhu cầu · % là tỷ trọng trên <b className="font-medium text-[#888]">{total}</b> LĐ đã biết</>}
          </div>
          {/* Không có nhu cầu thì không vẽ thanh fill — thanh xanh đầy sẽ bị đọc nhầm là "đã đủ". */}
          {hasDemand && (
            <div className="h-1.5 bg-[#F0EEE9] rounded-full overflow-hidden"><div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
          )}
        </div>
        {suppliers.length > 1 && (
          <button
            onClick={() => setShowCompare(v => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition shrink-0 ${showCompare ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
          >
            <Scale size={12} /> So sánh lương
          </button>
        )}
      </div>
      {showCompare && suppliers.length > 1 && (
        <div className="mb-3 border border-[#E8E7E2] rounded-lg overflow-hidden">
          <div className="px-2.5 py-1.5 bg-[#F9F9F7] border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
            <span className="text-[10.5px] text-[#888] shrink-0">So sánh LGVN với TOP {Math.min(TOP_N, otherRows.length)} NCC cung ứng nhiều nhất:</span>
            {compareRows.map(({ s, i }) => (
              <label key={i} className="flex items-center gap-1 text-[11px] text-[#555] cursor-pointer">
                <input type="checkbox" checked={isPicked(i)} onChange={() => toggleCompare(i)} />
                {s.is_us ? '● LGVN' : s.name}
              </label>
            ))}
          </div>
          <WageCompareTable suppliers={suppliers} selected={compareRows.filter(({ i }) => isPicked(i)).map(({ s }) => s)} />
        </div>
      )}
      <div className="space-y-1.5">
        {[...usRows, ...topRows, ...(showAllSuppliers ? restRows : [])].map(({ s, i }) => {
          if (editIndex === i) {
            return (
              <div key={i} className="py-1 px-1.5 -mx-1.5 bg-blue-50/40 rounded">
                <SupplierInlineForm
                  form={editForm} setForm={setEditForm} competitorNames={competitorNames}
                  onSubmit={submitEdit} onCancel={() => setEditIndex(null)} saving={saving}
                  allowNameEdit={!s.is_us} lockedQtyNote={s.qtyLocked ? s.qtyNote : undefined}
                  wageFields={wageFields} onAddWageField={onAddWageField} onDeleteWageField={onDeleteWageField}
                  onRenameWageField={onRenameWageField} onReorderWageFields={onReorderWageFields}
                />
              </div>
            );
          }
          const p = shareOf(s.qty);
          const wage = wageFmt(s.wage_min, s.wage_max);
          const costCount = Object.keys(s.wage_detail ?? {}).length;
          const sellCount = Object.keys(s.wage_detail_client ?? {}).length;
          const marginVal = clientTotal(s) - detailTotal(s);
          const hasBothSides = clientTotal(s) > 0 && detailTotal(s) > 0;
          return (
            <div key={i} className="flex items-center gap-2 group">
              <span className={`text-[12px] min-w-[110px] shrink-0 ${s.is_us ? 'text-blue-700 font-medium' : ''}`}>{s.is_us ? '● ' : ''}{s.name}</span>
              <div className="flex-1 h-[11px] bg-[#F0EEE9] rounded overflow-hidden"><div className={`h-[11px] rounded ${s.is_us ? 'bg-blue-600' : 'bg-[#B8D4F0]'}`} style={{ width: `${Math.min(p, 100)}%` }} /></div>
              <span
                title={s.qtyNote}
                className={`text-[12px] font-medium min-w-[52px] text-right ${s.is_us ? 'text-blue-700' : ''} ${s.qtyLocked ? 'border-b border-dotted border-current/40 cursor-help' : ''}`}
              >{s.qty} LĐ</span>
              <span className="text-[11px] text-[#aaa] min-w-[28px] text-right">{p}%</span>
              {wage && <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">{wage}</span>}
              {/* Đã nhập đủ 2 phía thì hiện thẳng phí dịch vụ — thứ thực sự cần so, thay vì
                  chỉ đếm số khoản đã nhập. */}
              {hasBothSides ? (
                <span title={`Giá bán ${tr(clientTotal(s))}đ − giá vốn ${tr(detailTotal(s))}đ`}
                  className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 shrink-0 cursor-help">
                  chênh {tr(marginVal)}đ
                </span>
              ) : (sellCount > 0 || costCount > 0) && (
                <span title={`Giá bán: ${sellCount} khoản · Giá vốn: ${costCount} khoản — nhập đủ 2 phía mới tính được chênh lệch`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded bg-[#F5F4EF] text-[#888] border border-[#E8E7E2] shrink-0 cursor-help">
                  {sellCount + costCount} chi tiết
                </span>
              )}
              {(onEditSupplier || onDeleteSupplier) && (
                <span className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-40 sm:group-hover:opacity-100 transition">
                  {onEditSupplier && (
                    <button onClick={() => startEdit(i, s)} className="text-[#999] hover:text-blue-600" title="Sửa"><Pencil size={11} /></button>
                  )}
                  {onDeleteSupplier && (
                    <button onClick={() => handleDelete(s)} className="text-[#999] hover:text-red-600" title="Xoá"><Trash2 size={11} /></button>
                  )}
                </span>
              )}
            </div>
          );
        })}
        {restRows.length > 0 && (
          <button
            onClick={() => setShowAllSuppliers(v => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-[#888] hover:text-blue-600 pt-0.5"
          >
            {showAllSuppliers
              ? <><ChevronUp size={12} /> Thu gọn</>
              : <><ChevronDown size={12} /> Xem thêm {restRows.length} NCC khác</>}
          </button>
        )}
      </div>
      {showAdd ? (
        <div className="mt-2">
          <SupplierInlineForm
            form={addForm} setForm={setAddFormWithSuggest} competitorNames={competitorNames}
            onSubmit={submitAdd} onCancel={() => setShowAdd(false)} saving={saving}
            wageFields={wageFields} onAddWageField={onAddWageField} onDeleteWageField={onDeleteWageField}
                  onRenameWageField={onRenameWageField} onReorderWageFields={onReorderWageFields}
          />
        </div>
      ) : (
        <button onClick={() => { setEditIndex(null); setShowAdd(true); setAddForm(emptySupForm); }} className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] border border-dashed border-gray-300 text-[#aaa] hover:border-blue-300 hover:text-blue-500"><Plus size={11} /> Thêm NCC</button>
      )}
    </div>
  );
}
