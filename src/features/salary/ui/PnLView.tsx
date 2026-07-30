// Khối P&L (L4) — doanh thu, chi phí, lời/lỗ, giá sàn, dòng thời gian và invoice.
//
// Điểm khác lớn nhất so với bản cũ: có DÒNG THỜI GIAN. Bản cũ chỉ hiện một tháng đại diện rồi
// suy ra "biên 16,6%", trong khi phí giới thiệu tắt ở tháng thứ 6 còn chi phí thì chạy tiếp —
// nên con số đó chỉ đúng nửa đầu hợp đồng (BUG-4). Vẽ 12 cột ra thì vách lỗ tự lộ.
import { Stat, fmtVnd, fmtSigned, fmtPct, fmtHours } from './primitives';
import type { PnLResult } from '../salaryEngine';

export default function PnLView({ pnl, vatPercent, headcount }: {
  pnl: PnLResult; vatPercent: number; headcount: number;
}) {
  const { insurance: ins, revenue } = pnl;
  const vat = pnl.revenueMonth * vatPercent / 100;
  const maxAbs = Math.max(1, ...pnl.timeline.map(m => Math.max(m.revenue, m.cost)));
  const lossMonths = pnl.timeline.filter(m => m.profit < 0).length;
  const firstLoss = pnl.timeline.find(m => m.profit < 0)?.month;
  const profitable = pnl.netProfitMonth >= 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Card label="Doanh thu / tháng / người" value={fmtVnd(pnl.revenueMonth)} tone="neutral" />
        <Card label="Chi phí / tháng / người" value={fmtVnd(pnl.costPerHeadMonth)} tone="neutral" />
        <Card
          label={`Lời/lỗ tháng · biên ${fmtPct(pnl.netMarginMonthPercent)}`}
          value={fmtSigned(pnl.netProfitMonth)}
          tone={profitable ? 'good' : 'bad'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-[#E8E7E2] rounded-lg p-3">
          <div className="text-[11px] font-semibold text-[#333] mb-1.5">Doanh thu (1 người/tháng)</div>
          <Stat label="Tiền công theo sản lượng" value={fmtVnd(revenue.revenueLabor)} />
          <Stat label="Phụ cấp khách trả" value={fmtVnd(revenue.revenueAllowance)} />
          <div className="border-t border-[#F0EFEA] mt-1 pt-1">
            <Stat label="Tổng doanh thu" value={fmtVnd(pnl.revenueMonth)} strong />
          </div>
          {revenue.unpricedCodes.length > 0 && (
            <div className="mt-1.5 text-[10.5px] text-amber-700 bg-amber-50 rounded-md px-2 py-1.5">
              {revenue.unpricedCodes.length} loại giờ có sản lượng nhưng chưa khai giá khách — doanh thu đang tính thiếu.
            </div>
          )}
        </div>

        <div className="border border-[#E8E7E2] rounded-lg p-3">
          <div className="text-[11px] font-semibold text-[#333] mb-1.5">Chi phí (1 người/tháng)</div>
          <Stat label="Lương trả NLĐ" value={fmtVnd(pnl.directWage)} sub={`${fmtHours(pnl.equivalentHours)} giờ quy đổi · ${fmtHours(pnl.actualHours)} giờ thực`} />
          <Stat label="Phụ cấp ta nợ NLĐ" value={fmtVnd(pnl.allowanceCostWorker)} />
          <Stat label="BHXH phần NSDLĐ" value={fmtVnd(ins.employerInsurance)}
            sub={`nền ${fmtVnd(ins.bhxhBase)}đ${ins.bhxhBaseCapped ? ' · đã chạm trần 20× lương cơ sở' : ''}`} />
          <Stat label="Kinh phí công đoàn" value={fmtVnd(ins.unionFee)} />
          <Stat label="Chi phí gián tiếp" value={fmtVnd(pnl.indirectCostMonth)} sub="vận hành + khác + tuyển dụng phân bổ" />
          <div className="border-t border-[#F0EFEA] mt-1 pt-1">
            <Stat label="Tổng chi phí" value={fmtVnd(pnl.costPerHeadMonth)} strong />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-[#E8E7E2] rounded-lg p-3">
          <div className="text-[11px] font-semibold text-[#333] mb-1.5">Giá sàn (hoà vốn)</div>
          <Stat label="Mỗi ngày công" value={`${fmtVnd(pnl.breakEvenPerWorkday)}đ`} strong />
          <Stat label="Mỗi giờ quy đổi" value={`${fmtVnd(pnl.breakEvenPerHour)}đ`} />
          <div className="text-[10px] text-[#aaa] mt-1">
            Tính trên 1 đầu người — không nhân số lượng người, nhân vào là sai đơn vị.
          </div>
        </div>

        <div className="border border-[#E8E7E2] rounded-lg p-3">
          <div className="text-[11px] font-semibold text-[#333] mb-1.5">Invoice khách hàng (1 người/tháng)</div>
          <Stat label="Cộng trước VAT" value={fmtVnd(pnl.revenueMonth)} />
          <Stat label={`VAT ${vatPercent}%`} value={fmtVnd(vat)} />
          <div className="border-t border-[#F0EFEA] mt-1 pt-1">
            <Stat label="Tổng invoice" value={fmtVnd(pnl.revenueMonth + vat)} strong />
          </div>
          {headcount > 1 && (
            <div className="text-[10px] text-[#aaa] mt-1">× {headcount} người = {fmtVnd((pnl.revenueMonth + vat) * headcount)}đ/tháng</div>
          )}
        </div>
      </div>

      <div className="border border-[#E8E7E2] rounded-lg p-3">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="text-[11px] font-semibold text-[#333]">
            Dòng thời gian {pnl.timeline.length} tháng · {headcount > 1 ? `${headcount} người` : '1 người'}
          </div>
          <div className={`text-[11px] font-semibold tabular-nums ${pnl.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            Cả kỳ {fmtSigned(pnl.netProfit)}đ · {fmtPct(pnl.netMarginPercent)}
          </div>
        </div>

        <div className="flex items-end gap-[3px] h-[64px]">
          {pnl.timeline.map(m => {
            const revH = Math.round(m.revenue / maxAbs * 100);
            const costH = Math.round(m.cost / maxAbs * 100);
            return (
              <div key={m.month} className="flex-1 min-w-0 flex flex-col justify-end items-center gap-[2px] group relative">
                <div className="w-full flex items-end justify-center gap-[2px] h-full">
                  <div className="w-1/2 bg-emerald-400/70 rounded-t-[2px]" style={{ height: `${revH}%` }} />
                  <div className="w-1/2 bg-red-300/70 rounded-t-[2px]" style={{ height: `${costH}%` }} />
                </div>
                <div className={`text-[8.5px] tabular-nums ${m.profit < 0 ? 'text-red-500 font-semibold' : 'text-[#bbb]'}`}>
                  {m.month}
                </div>
                <div className="hidden group-hover:block absolute bottom-full mb-1 z-10 whitespace-nowrap bg-[#111] text-white text-[10px] rounded px-1.5 py-1">
                  Tháng {m.month} · DT {fmtVnd(m.revenue)} · CP {fmtVnd(m.cost)} · {fmtSigned(m.profit)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 mt-2 text-[10px] text-[#999]">
          <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-emerald-400/70" /> Doanh thu</span>
          <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-red-300/70" /> Chi phí</span>
        </div>

        {lossMonths > 0 && (
          <div className="mt-2 text-[10.5px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
            {firstLoss != null && firstLoss > 1
              ? <>Từ <b>tháng {firstLoss}</b> trở đi bắt đầu lỗ — doanh thu đã tắt nhưng chi phí vẫn chạy ({lossMonths}/{pnl.timeline.length} tháng lỗ).</>
              : <>Lỗ {lossMonths}/{pnl.timeline.length} tháng.</>}
          </div>
        )}
      </div>

      <div className="border border-[#E8E7E2] rounded-lg p-3">
        <div className="text-[11px] font-semibold text-[#333] mb-1.5">Người lao động thực nhận</div>
        <Stat label="Lương + phụ cấp" value={fmtVnd(pnl.directWage + pnl.allowanceCostWorker)} />
        <Stat label="Trừ BHXH phần NLĐ" value={`− ${fmtVnd(ins.workerInsurance)}`} />
        <div className="border-t border-[#F0EFEA] mt-1 pt-1">
          <Stat label="Còn lại trước thuế TNCN" value={fmtVnd(pnl.netToWorker)} strong />
        </div>
        <div className="text-[10px] text-[#aaa] mt-1">
          Chưa trừ thuế TNCN luỹ tiến và giảm trừ gia cảnh — số thực lĩnh sẽ thấp hơn nếu tới ngưỡng chịu thuế.
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'good' | 'bad' }) {
  const tones = {
    neutral: 'border-[#E8E7E2] bg-white text-[#111]',
    good: 'border-emerald-200 bg-emerald-50/50 text-emerald-700',
    bad: 'border-red-200 bg-red-50/50 text-red-600',
  } as const;
  return (
    <div className={`border rounded-lg px-3 py-2 ${tones[tone]}`}>
      <div className="text-[10.5px] text-[#888]">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums mt-0.5">{value}đ</div>
    </div>
  );
}
