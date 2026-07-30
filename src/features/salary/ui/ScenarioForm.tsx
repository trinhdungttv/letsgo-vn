// Cột nhập liệu — toàn bộ tham số L1→L4 của một kịch bản.
//
// Thứ tự các khối cố tình đi theo dòng dữ liệu của engine (lương → cấu trúc giờ → giá khách →
// chi phí), để người dùng nhập tới đâu hiểu tới đó. Các khối phía sau gập sẵn vì phần lớn lần
// dùng chỉ cần sửa 2 khối đầu.
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Field, NumInput, TextInput, Select, Check, Section, fmtVnd, fmtHours } from './primitives';
import { WAGE_ROWS, unitLabelOf, volumeUnitLabelOf } from '../wageRows';
import { VOLUME_PRESETS } from '../volumePresets';
import type {
  Scenario, WageBasis, VolumeProfile, PriceBook, OverheadConfig, ServiceFeeConfig,
  AllowanceLine, WageCode, RegionZone, PriceBookMode, ServiceFeeType, ReferralDurationMode,
} from '../types';

const CODE_OPTIONS = WAGE_ROWS.map(r => ({ value: r.code, label: r.label }));
const REGION_OPTIONS: { value: RegionZone; label: string }[] = [
  { value: 'I', label: 'Vùng I' }, { value: 'II', label: 'Vùng II' },
  { value: 'III', label: 'Vùng III' }, { value: 'IV', label: 'Vùng IV' },
];
const PRICE_MODE_OPTIONS: { value: PriceBookMode; label: string }[] = [
  { value: 'singleDayRate', label: 'Giá 1 ngày công (nhân hệ số ra các dòng)' },
  { value: 'manual', label: 'Gõ tay từng dòng' },
  { value: 'markupPercent', label: 'Cộng % lên giá vốn' },
  { value: 'markupPerHour', label: 'Cộng số tiền cố định mỗi giờ' },
];
const FEE_TYPE_OPTIONS: { value: ServiceFeeType; label: string }[] = [
  { value: 'per_day_worked', label: 'Phí theo ngày công thực tế (lâu dài)' },
  { value: 'referral_hourly', label: 'Phí giới thiệu theo giờ' },
  { value: 'referral_daily_limited', label: 'Phí giới thiệu theo ngày, có thời hạn' },
];

interface Props {
  scenario: Scenario;
  entryCode: WageCode;
  entryAmount: number;
  equivalentHours: number;
  actualHours: number;
  onEntryCodeChange: (code: WageCode) => void;
  onEntryAmountChange: (amount: number) => void;
  setBasis: (patch: Partial<WageBasis>) => void;
  setVolume: (v: VolumeProfile) => void;
  setPriceBook: (patch: Partial<PriceBook>) => void;
  setOverhead: (patch: Partial<OverheadConfig>) => void;
  setServiceFee: (patch: Partial<ServiceFeeConfig>) => void;
  setAllowances: (next: AllowanceLine[]) => void;
  onGeneratePriceBook: () => void;
}

export default function ScenarioForm({
  scenario, entryCode, entryAmount, equivalentHours, actualHours,
  onEntryCodeChange, onEntryAmountChange,
  setBasis, setVolume, setPriceBook, setOverhead, setServiceFee, setAllowances, onGeneratePriceBook,
}: Props) {
  const { us: { basis, allowances }, volume, priceBook, overhead, serviceFee } = scenario;

  const setQty = (code: WageCode, v: number) =>
    setVolume({ ...volume, id: 'custom', name: 'Tuỳ chỉnh', quantities: { ...volume.quantities, [code]: v } });

  const addAllowance = () => setAllowances([
    ...allowances,
    { id: `al_${Date.now()}_${allowances.length}`, name: '', customerPays: 0, weOweWorker: 0, taxable: false },
  ]);
  const patchAllowance = (id: string, patch: Partial<AllowanceLine>) =>
    setAllowances(allowances.map(a => a.id === id ? { ...a, ...patch } : a));

  const activeVolumeRows = WAGE_ROWS.filter(r => r.countsInVolume && (volume.quantities[r.code] ?? 0) > 0);

  return (
    <div className="space-y-2.5">
      {/* ── L1 ─────────────────────────────────────────────────────────────────────────── */}
      <Section title="1 · Đơn giá lương gốc" tone="blue">
        <Field label="Loại đơn giá nhập vào">
          <Select value={entryCode} onChange={onEntryCodeChange} options={CODE_OPTIONS} />
        </Field>
        <Field label={`Số tiền tương ứng (${unitLabelOf(entryCode)})`}
          hint={basis.shrPay > 0 ? <>Suy ra <b>SHR {fmtVnd(basis.shrPay)}đ/giờ</b> — mọi dòng còn lại tính từ số này.</> : 'Nhập để bắt đầu tính.'}>
          <NumInput value={Math.round(entryAmount)} onChange={onEntryAmountChange} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Vùng lương">
            <Select value={basis.region} onChange={v => setBasis({ region: v })} options={REGION_OPTIONS} />
          </Field>
          <Field label="Ngày công/tháng">
            <NumInput value={basis.workdaysPerMonth} step={1} min={1} max={31}
              onChange={v => setBasis({ workdaysPerMonth: Math.min(31, Math.max(1, v || 26)) })} />
          </Field>
        </div>

        {entryCode === 'ot_night_weekday' && (
          <Check checked={basis.priorDayOt} onChange={v => setBasis({ priorDayOt: v })}>
            Có làm OT ban ngày ngay trước ca đêm <span className="text-[#999]">(hệ số 210% thay vì 200%)</span>
          </Check>
        )}

        <Check checked={basis.includeHolidayBasePay} onChange={v => setBasis({ includeHolidayBasePay: v })}>
          Cộng lương ngày lễ hưởng nguyên lương vào dòng lễ
          <span className="block text-[10px] text-[#999]">
            Điều 112 BLLĐ: 300% ngày lễ CHƯA gồm tiền lương ngày nghỉ lễ — thực chi thường là 400%.
          </span>
        </Check>

        <Field label="Nền đóng BHXH"
          hint="NCC thường đóng trên mức thấp hơn lương trả thực. Gộp 2 số làm 1 khiến chi phí BHXH bị tính vống.">
          <Select value={basis.shrBhxhMode} onChange={v => setBasis({ shrBhxhMode: v })}
            options={[
              { value: 'linked', label: 'Bằng đúng đơn giá trả thực' },
              { value: 'custom', label: 'Đóng trên mức riêng, thấp hơn' },
            ]} />
        </Field>
        {basis.shrBhxhMode === 'custom' && (
          <Field label="Đơn giá giờ dùng để đóng BHXH (đ/giờ)">
            <NumInput value={basis.shrBhxhCustom ?? 0} step={100} onChange={v => setBasis({ shrBhxhCustom: v })} />
          </Field>
        )}
      </Section>

      {/* ── L2 ─────────────────────────────────────────────────────────────────────────── */}
      <Section title="2 · Cấu trúc giờ làm / tháng" tone="emerald">
        <div className="grid grid-cols-2 gap-1.5">
          {VOLUME_PRESETS.map(p => {
            const active = volume.id === p.id;
            return (
              <button key={p.id} type="button" title={p.hint}
                onClick={() => setVolume({ id: p.id, name: p.name, quantities: p.build(basis.workdaysPerMonth) })}
                className={`text-left px-2 py-1.5 rounded-lg border text-[11px] transition ${active
                  ? 'border-emerald-300 bg-emerald-100/60 text-emerald-800 font-medium'
                  : 'border-[#E8E7E2] bg-white text-[#666] hover:bg-[#F9F9F7]'}`}>
                {p.name}
                <span className="block text-[9.5px] text-[#999] truncate">{p.hint}</span>
              </button>
            );
          })}
        </div>

        {activeVolumeRows.length > 0 && (
          <div className="space-y-1 pt-1">
            {activeVolumeRows.map(r => (
              <div key={r.code} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-[11px] text-[#666] truncate">{r.label}</span>
                <div className="w-[74px]">
                  <NumInput value={volume.quantities[r.code] ?? 0} step={1} onChange={v => setQty(r.code, Math.max(0, v))} />
                </div>
                <span className="w-[22px] text-[10px] text-[#aaa]">{volumeUnitLabelOf(r.code)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[10.5px] text-emerald-800 bg-emerald-100/50 rounded-md px-2 py-1.5">
          <b>{fmtHours(equivalentHours)}</b> giờ quy đổi · <b>{fmtHours(actualHours)}</b> giờ có mặt thực tế.
          Giờ quy đổi đã nhân hệ số — đây mới là số dùng để chia ngân sách lương.
        </div>
        <div className="text-[10px] text-[#999]">
          Sửa sản lượng từng dòng ngay trên bảng bên phải cũng được — cùng một chỗ dữ liệu.
        </div>
      </Section>

      {/* ── L3 ─────────────────────────────────────────────────────────────────────────── */}
      <Section title="3 · Giá khách trả (Price Book)" tone="violet">
        <Field label="Cách xác định giá khách"
          hint="Đây là NGUỒN DOANH THU DUY NHẤT — không còn đường tính doanh thu nào khác chạy song song.">
          <Select value={priceBook.mode} onChange={v => setPriceBook({ mode: v })} options={PRICE_MODE_OPTIONS} />
        </Field>

        {priceBook.mode === 'singleDayRate' && (
          <Field label="Giá khách trả 1 ngày công (đ/ca 8h)"
            hint="Các loại giờ khác suy ra bằng cách nhân hệ số tương ứng.">
            <NumInput value={priceBook.singleDayRate ?? 0} onChange={v => setPriceBook({ singleDayRate: v })} />
          </Field>
        )}
        {priceBook.mode === 'markupPercent' && (
          <Field label="Cộng thêm (%) lên giá vốn từng dòng">
            <NumInput value={priceBook.markupPercent ?? 0} step={1} onChange={v => setPriceBook({ markupPercent: v })} />
          </Field>
        )}
        {priceBook.mode === 'markupPerHour' && (
          <Field label="Cộng thêm (đ) cho mỗi giờ"
            hint="Phí phẳng theo giờ sẽ mỏng dần ở các loại giờ hệ số cao — xem cột lãi/lỗ từng dòng.">
            <NumInput value={priceBook.markupPerHour ?? 0} step={1000} onChange={v => setPriceBook({ markupPerHour: v })} />
          </Field>
        )}
        {priceBook.mode === 'manual' && (
          <div className="text-[10.5px] text-[#888] bg-[#F9F9F7] rounded-md px-2 py-1.5">
            Gõ giá khách cho từng loại giờ ở cột <b>"Khách trả ta"</b> trên bảng bên phải.
          </div>
        )}

        <Field label="VAT (%)">
          <NumInput value={priceBook.vatPercent} step={1} onChange={v => setPriceBook({ vatPercent: v })} />
        </Field>
      </Section>

      {/* ── Phụ cấp ────────────────────────────────────────────────────────────────────── */}
      <Section title="4 · Phụ cấp" tone="plain" defaultOpen={allowances.length > 0}
        right={
          <button type="button" onClick={addAllowance}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-blue-700 hover:bg-blue-50 transition">
            <Plus size={12} /> Thêm
          </button>
        }>
        {allowances.length === 0 ? (
          <div className="text-[11px] text-[#aaa]">Chưa có khoản nào.</div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_92px_92px_28px] gap-1.5 text-[9.5px] text-[#aaa] px-0.5">
              <span>Tên khoản</span><span className="text-right">Khách trả</span><span className="text-right">Ta trả NLĐ</span><span />
            </div>
            {allowances.map(a => (
              <div key={a.id} className="space-y-1">
                <div className="grid grid-cols-[1fr_92px_92px_28px] gap-1.5 items-center">
                  <TextInput value={a.name} onChange={v => patchAllowance(a.id, { name: v })} placeholder="VD: Ăn ca" />
                  <NumInput value={a.customerPays} onChange={v => patchAllowance(a.id, { customerPays: v })} />
                  <NumInput value={a.weOweWorker} onChange={v => patchAllowance(a.id, { weOweWorker: v })} />
                  <button type="button" onClick={() => setAllowances(allowances.filter(x => x.id !== a.id))}
                    className="p-1.5 rounded-md text-[#bbb] hover:text-red-600 hover:bg-red-50 transition">
                    <Trash2 size={12} />
                  </button>
                </div>
                <Check checked={a.taxable} onChange={v => patchAllowance(a.id, { taxable: v })}>
                  <span className="text-[10.5px]">Tính vào nền đóng BHXH</span>
                </Check>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── L4 ─────────────────────────────────────────────────────────────────────────── */}
      <Section title="5 · Chi phí & mục tiêu" tone="amber" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="BHXH phần NSDLĐ (%)">
            <NumInput value={overhead.employerInsurancePercent} step={0.5} onChange={v => setOverhead({ employerInsurancePercent: v })} />
          </Field>
          <Field label="BHXH phần NLĐ (%)">
            <NumInput value={overhead.workerInsurancePercent} step={0.5} onChange={v => setOverhead({ workerInsurancePercent: v })} />
          </Field>
          <Field label="Kinh phí công đoàn (%)">
            <NumInput value={overhead.unionFeePercent} step={0.5} onChange={v => setOverhead({ unionFeePercent: v })} />
          </Field>
          <Field label="Biên lợi nhuận mục tiêu (%)">
            <NumInput value={overhead.targetNetMarginPercent} step={1} onChange={v => setOverhead({ targetNetMarginPercent: v })} />
          </Field>
          <Field label="Chi phí vận hành (đ/người/tháng)">
            <NumInput value={overhead.opsCostPerHeadMonth} onChange={v => setOverhead({ opsCostPerHeadMonth: v })} />
          </Field>
          <Field label="Chi phí khác (đ/người/tháng)">
            <NumInput value={overhead.otherCostPerHeadMonth} onChange={v => setOverhead({ otherCostPerHeadMonth: v })} />
          </Field>
          <Field label="Chi phí tuyển 1 người (đ)">
            <NumInput value={overhead.recruitCostPerHire} onChange={v => setOverhead({ recruitCostPerHire: v })} />
          </Field>
          <Field label="Tỷ lệ nghỉ việc (%/tháng)" hint="Dùng để phân bổ chi phí tuyển dụng.">
            <NumInput value={overhead.monthlyTurnoverPercent} step={1} onChange={v => setOverhead({ monthlyTurnoverPercent: v })} />
          </Field>
          <Field label="Số người">
            <NumInput value={overhead.headcount} step={1} min={1} onChange={v => setOverhead({ headcount: Math.max(1, v) })} />
          </Field>
          <Field label="Xét trong (tháng)">
            <NumInput value={overhead.horizonMonths} step={1} min={1} onChange={v => setOverhead({ horizonMonths: Math.max(1, v) })} />
          </Field>
        </div>
      </Section>

      {/* ── Phí dịch vụ ────────────────────────────────────────────────────────────────── */}
      <Section title="6 · Phí dịch vụ & thời hạn thu" tone="plain" defaultOpen={false}>
        <div className="text-[10.5px] text-[#888] bg-[#F9F9F7] rounded-md px-2 py-1.5">
          Phí dịch vụ KHÔNG còn tự sinh doanh thu. Nó chỉ dùng để (a) sinh sẵn bảng giá khách, và
          (b) cho biết doanh thu tắt ở tháng thứ mấy.
        </div>
        <Field label="Loại phí">
          <Select value={serviceFee.type} onChange={v => setServiceFee({ type: v })} options={FEE_TYPE_OPTIONS} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Đơn giá (${serviceFee.type === 'referral_hourly' ? 'đ/giờ' : 'đ/ngày'})`}>
            <NumInput value={serviceFee.value} onChange={v => setServiceFee({ value: v })} />
          </Field>
          {serviceFee.type === 'referral_hourly' && (
            <Field label="Số giờ hưởng phí/ngày">
              <NumInput value={serviceFee.feeHoursPerDay} step={1} min={1} max={24}
                onChange={v => setServiceFee({ feeHoursPerDay: Math.min(24, Math.max(1, v || 8)) })} />
            </Field>
          )}
        </div>
        {serviceFee.type === 'referral_hourly' && (
          <Field label="Thời hạn thu">
            <Select value={serviceFee.durationMode}
              onChange={(v: ReferralDurationMode) => setServiceFee({ durationMode: v })}
              options={[
                { value: 'one_time', label: 'Thu 1 lần duy nhất' },
                { value: 'recurring_months', label: 'Thu hàng tháng, trong N tháng' },
              ]} />
          </Field>
        )}
        {(serviceFee.type === 'referral_daily_limited'
          || (serviceFee.type === 'referral_hourly' && serviceFee.durationMode === 'recurring_months')) && (
          <Field label="Số tháng được hưởng phí"
            hint="Hết mốc này doanh thu về 0 nhưng chi phí vẫn chạy — xem dòng thời gian ở tab P&L.">
            <NumInput value={serviceFee.months} step={1} min={1} max={24}
              onChange={v => setServiceFee({ months: Math.min(24, Math.max(1, v || 3)) })} />
          </Field>
        )}

        <button type="button" onClick={onGeneratePriceBook}
          className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-medium border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition">
          <Wand2 size={12} /> Sinh bảng giá khách từ phí dịch vụ
        </button>
        <div className="text-[10px] text-[#999]">
          Ghi đè cột "Khách trả ta" bằng công thức chi phí đầy đủ + phí — đúng cách bản cũ lập invoice.
        </div>
      </Section>
    </div>
  );
}
