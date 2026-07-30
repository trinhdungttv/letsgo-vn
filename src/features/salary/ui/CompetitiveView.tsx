// Khối L5 — Định giá cạnh tranh. Phần hoàn toàn mới, trả lời câu hỏi mà bản cũ không trả lời
// được: "với giá khách này, ta trả NLĐ tối đa bao nhiêu mà vẫn đạt biên mục tiêu, và có đủ để
// vượt đối thủ không?"
//
// Chú ý về hướng suy luận: shrPayMax đi ngược từ GIÁ KHÁCH TRẢ, KHÔNG đi từ lương ta đang trả.
// Nên đổi ô "SHR trả thực" bên trái sẽ không làm con số này nhúc nhích — đó là đúng, không phải lỗi.
import { Plus, Trash2, AlertTriangle, TrendingUp, ShieldAlert } from 'lucide-react';
import { NumInput, TextInput, Select, Stat, fmtVnd, fmtPct, fmtSigned } from './primitives';
import { WAGE_ROWS, unitLabelOf } from '../wageRows';
import { deriveShr, amountForShr } from '../salaryEngine';
import type { CompetitiveResult } from '../competitiveEngine';
import type { SupplierQuote, WageCode, WageBasis } from '../types';

const CODE_OPTIONS = WAGE_ROWS.map(r => ({ value: r.code, label: r.label }));

interface Props {
  result: CompetitiveResult;
  competitors: SupplierQuote[];
  /** Mã đơn giá đang dùng để NHẬP cho từng đối thủ (chỉ là cách gõ, không đổi bản chất SHR). */
  entryCodes: Record<string, WageCode>;
  workdaysPerMonth: number;
  deltaPercent: number;
  targetMarginPercent: number;
  onDeltaChange: (v: number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onEntryCodeChange: (id: string, code: WageCode) => void;
  onAmountChange: (id: string, amount: number) => void;
  onApplyProposed: () => void;
}

export default function CompetitiveView({
  result, competitors, entryCodes, workdaysPerMonth, deltaPercent, targetMarginPercent,
  onDeltaChange, onAdd, onRemove, onRename, onEntryCodeChange, onAmountChange, onApplyProposed,
}: Props) {
  const { us, remedy } = result;
  const statById = new Map(result.competitors.map(c => [c.id, c]));

  return (
    <div className="space-y-3">
      {/* ── Banner kết luận ─────────────────────────────────────────────────────────────── */}
      {result.flagBelowLegal && (
        <Banner tone="red" icon={<ShieldAlert size={15} />}>
          <b>Không nhận được job này.</b> Giá khách chỉ đủ trả {fmtVnd(us.shrPayMax)}đ/giờ, thấp hơn
          lương tối thiểu giờ Vùng {result.legalRule?.region} ({fmtVnd(result.shrFloorLegal)}đ/giờ
          theo {result.legalRule?.decree}). Đây là vi phạm pháp luật, không phải biên mỏng.
        </Banner>
      )}

      {result.flagCannotWin && remedy && !result.flagBelowLegal && (
        <Banner tone="amber" icon={<AlertTriangle size={15} />}>
          <b>Không đủ tiền để vượt đối thủ.</b> Cần chào {fmtVnd(result.shrProposed)}đ/giờ nhưng chỉ
          trả nổi {fmtVnd(us.shrPayMax)}đ/giờ.
          <ul className="mt-1.5 space-y-0.5 list-none">
            <li>· Thiếu <b>{fmtVnd(remedy.gapPerHour)}đ/giờ</b> — tức <b>{fmtVnd(remedy.gapPerMonth)}đ/tháng/người</b> tiền lương.</li>
            <li>· Hoặc cắt <b>{fmtVnd(remedy.indirectCutNeeded)}đ/tháng/người</b> chi phí gián tiếp
              <span className="text-[10px] text-amber-700/70"> (nhiều hơn số trên vì lương tăng còn kéo theo BHXH)</span>.</li>
            <li>· Hoặc hạ biên mục tiêu từ {fmtPct(targetMarginPercent)} xuống <b>{fmtPct(remedy.targetMarginNeededPercent)}</b>
              {remedy.targetMarginNeededPercent < 0 && <span className="text-[10px]"> — âm, tức có làm không công cũng không đủ</span>}.</li>
            <li>· Hoặc đàm phán giá khách lên <b>{fmtVnd(remedy.customerPricePerWorkdayNeeded)}đ/ngày công</b>.</li>
          </ul>
        </Banner>
      )}

      {result.flagBigRoom && (
        <Banner tone="emerald" icon={<TrendingUp size={15} />}>
          <b>Còn nhiều dư địa.</b> Trả nổi cao hơn đối thủ mạnh nhất {fmtPct(result.roomAbovePercent)} mà
          vẫn đạt biên mục tiêu — có thể chào cao để chắc thắng, hoặc giữ giá để lấy biên dày.
        </Banner>
      )}

      {/* ── Ba con số chốt ──────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Big label="Ta trả nổi tối đa" value={fmtVnd(us.shrPayMax)} unit="đ/giờ" tone="neutral"
          sub={`để đạt biên ${fmtPct(targetMarginPercent)}`} />
        <Big label="Đối thủ mạnh nhất" value={fmtVnd(result.shrCompetitorMax)} unit="đ/giờ" tone="muted"
          sub={result.strongest?.supplierName ?? 'chưa nhập đối thủ nào'} />
        <Big label="Nên chào" value={fmtVnd(result.shrProposed)} unit="đ/giờ"
          tone={result.flagCannotWin ? 'bad' : 'good'}
          sub={result.shrCompetitorMax > 0 ? `vượt ${fmtPct(deltaPercent, 0)}` : 'bằng sàn pháp lý'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-[#666]">Vượt đối thủ</label>
        <div className="w-[80px]"><NumInput value={deltaPercent} step={0.5} onChange={onDeltaChange} /></div>
        <span className="text-[11px] text-[#666]">%</span>
        <button type="button" onClick={onApplyProposed} disabled={result.flagCannotWin}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 transition">
          Áp mức đề xuất vào bảng lương
        </button>
      </div>

      {/* ── Ngân sách nhân ngược ────────────────────────────────────────────────────────── */}
      <div className="border border-[#E8E7E2] rounded-lg p-3">
        <div className="text-[11px] font-semibold text-[#333] mb-1.5">Ngân sách lương suy từ giá khách</div>
        <Stat label="Doanh thu / tháng / người" value={fmtVnd(us.revenueMonth)} />
        <Stat label="Trừ biên mục tiêu" value={`− ${fmtVnd(us.targetProfit)}`} />
        <Stat label="Trừ chi phí gián tiếp" value={`− ${fmtVnd(us.indirectCostMonth)}`} />
        <div className="border-t border-[#F0EFEA] mt-1 pt-1">
          <Stat label="Còn lại cho lương + BHXH" value={fmtVnd(us.budget)} strong />
        </div>
        <div className="text-[10px] text-[#aaa] mt-1">
          Chia cho {us.equivalentHours.toFixed(1)} giờ quy đổi (cộng gánh bảo hiểm) ra {fmtVnd(us.shrPayMax)}đ/giờ.
        </div>
      </div>

      {/* ── Đối thủ ────────────────────────────────────────────────────────────────────── */}
      <div className="border border-[#E8E7E2] rounded-lg">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#E8E7E2]">
          <div className="text-[11px] font-semibold text-[#333]">
            Nhà cung ứng đối thủ {competitors.length > 0 && <span className="text-[#aaa] font-normal">· {competitors.length}</span>}
          </div>
          <button type="button" onClick={onAdd}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-blue-700 hover:bg-blue-50 transition">
            <Plus size={12} /> Thêm NCC
          </button>
        </div>

        {competitors.length === 0 ? (
          <div className="px-3 py-4 text-[11.5px] text-[#aaa] text-center">
            Chưa có đối thủ nào. Thêm để biết cần chào bao nhiêu mới thắng.
          </div>
        ) : (
          <div className="divide-y divide-[#F0EFEA]">
            {competitors.map(c => {
              const stat = statById.get(c.id);
              const code = entryCodes[c.id] ?? 'day_wage_8h';
              const cBasis: WageBasis = { ...c.basis, workdaysPerMonth };
              const amount = amountForShr(code, cBasis.shrPay, workdaysPerMonth, { priorDayOt: cBasis.priorDayOt });
              const isTop = result.strongest?.id === c.id;
              return (
                <div key={c.id} className="px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><TextInput value={c.supplierName} onChange={v => onRename(c.id, v)} placeholder="Tên NCC…" /></div>
                    {isTop && <span className="shrink-0 text-[9.5px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">mạnh nhất</span>}
                    <button type="button" onClick={() => onRemove(c.id)} title="Xoá NCC này"
                      className="shrink-0 p-1.5 rounded-md text-[#bbb] hover:text-red-600 hover:bg-red-50 transition">
                      <Trash2 size={12} />
                    </button>
                  </div>

                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <Select value={code} onChange={v => onEntryCodeChange(c.id, v)} options={CODE_OPTIONS} />
                    <NumInput value={Math.round(amount)} onChange={v => onAmountChange(c.id, v)} />
                  </div>

                  {stat && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-[#888]">
                      <span>{unitLabelOf(code)} → SHR <b className="text-[#333]">{fmtVnd(stat.shrPay)}đ/giờ</b></span>
                      <span>NLĐ nhận <b className="text-[#333]">{fmtVnd(stat.packageForWorker)}đ/tháng</b></span>
                      <span>
                        Biên ngầm{' '}
                        <b className={stat.impliedMargin >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                          {fmtSigned(stat.impliedMargin)}đ
                        </b>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {competitors.length > 0 && (
          <div className="px-3 py-2 bg-[#F9F9F7] border-t border-[#E8E7E2] text-[10px] text-[#999]">
            Mọi NCC chạy trên CÙNG cấu trúc giờ và cùng số ngày công — mỗi bên một cấu trúc riêng thì
            câu hỏi "ai trả NLĐ cao hơn" không có nghĩa. "Biên ngầm" = doanh thu của ta trừ chi phí
            nếu ta trả như họ, cho biết họ còn bao nhiêu room hạ giá tiếp.
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: 'red' | 'amber' | 'emerald'; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  } as const;
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 border ${tones[tone]}`}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="text-[11.5px] leading-relaxed">{children}</div>
    </div>
  );
}

function Big({ label, value, unit, sub, tone }: {
  label: string; value: string; unit: string; sub?: string; tone: 'neutral' | 'good' | 'bad' | 'muted';
}) {
  const tones = {
    neutral: 'border-[#E8E7E2] bg-white text-[#111]',
    good: 'border-emerald-200 bg-emerald-50/50 text-emerald-700',
    bad: 'border-red-200 bg-red-50/50 text-red-600',
    muted: 'border-[#E8E7E2] bg-[#FAFAF8] text-[#666]',
  } as const;
  return (
    <div className={`border rounded-lg px-3 py-2 ${tones[tone]}`}>
      <div className="text-[10.5px] text-[#888]">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums mt-0.5">
        {value}<span className="text-[10.5px] font-normal ml-0.5">{unit}</span>
      </div>
      {sub && <div className="text-[9.5px] text-[#aaa] mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

/** Suy SHR từ số tiền người dùng gõ cho 1 đối thủ — export để modal dùng chung một công thức. */
export const shrFromEntry = (
  amount: number, code: WageCode, workdaysPerMonth: number, priorDayOt: boolean,
): number => deriveShr(code, amount, workdaysPerMonth, { priorDayOt });
