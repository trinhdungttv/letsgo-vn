// Bảng 14 dòng — TRUNG TÂM của màn hình này.
//
// Vì sao gộp chi phí + sản lượng + giá khách vào MỘT bảng thay vì 3 bảng rời: bản cũ tách chúng
// ra nên không nhìn thấy dòng nào đang bán dưới giá vốn. Đặt cạnh nhau thì "giá khách 62.000 <
// ta trả 62.250" hiện ra ngay trên cùng một hàng — đó chính là BUG-1/BUG-2 ở dạng nhìn được.
import { Lock, RotateCcw, AlertTriangle } from 'lucide-react';
import { NumInput, fmtVnd, fmtHours } from './primitives';
import { volumeUnitLabelOf } from '../wageRows';
import type { WageTableRow, RevenueResult } from '../salaryEngine';
import type { WageCode, WageGroup, VolumeProfile, PriceBook } from '../types';

const GROUP_LABEL: Record<WageGroup, string> = {
  BASE: 'Lương tháng', FULL_SHIFT: 'Nguyên ca 8h', OVERTIME: 'Giờ làm thêm', SHIFT_12H: 'Ca 12h',
};
const GROUP_ORDER: WageGroup[] = ['BASE', 'FULL_SHIFT', 'OVERTIME', 'SHIFT_12H'];

interface Props {
  table: WageTableRow[];
  volume: VolumeProfile;
  priceBook: PriceBook;
  revenue: RevenueResult;
  shrPay: number;
  onOverride: (code: WageCode, value: number | null) => void;
  onQty: (code: WageCode, value: number) => void;
  onCustomerPrice: (code: WageCode, value: number | null) => void;
}

export default function WageTableView({
  table, volume, priceBook, revenue, shrPay, onOverride, onQty, onCustomerPrice,
}: Props) {
  const revByCode = new Map(revenue.rows.map(r => [r.code, r]));
  // Chỉ chế độ 'manual' mới gõ tay từng dòng được. Các chế độ khác giá khách là số SUY RA, cho
  // gõ đè sẽ tạo nguồn sự thật thứ hai — đúng thứ bản cũ mắc phải.
  const priceEditable = priceBook.mode === 'manual';

  return (
    <div className="border border-[#E8E7E2] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[11.5px]">
          <thead>
            <tr className="bg-[#F9F9F7] text-[#666]">
              <th className="text-left font-medium px-2.5 py-2">Loại giờ</th>
              <th className="text-right font-medium px-2 py-2 w-[52px]">Hệ số</th>
              <th className="text-right font-medium px-2 py-2 w-[124px]">Ta trả NLĐ</th>
              <th className="text-right font-medium px-2 py-2 w-[92px]">Sản lượng</th>
              <th className="text-right font-medium px-2 py-2 w-[124px]">Khách trả ta</th>
              <th className="text-right font-medium px-2.5 py-2 w-[104px]">Lãi/lỗ dòng</th>
            </tr>
          </thead>
          {GROUP_ORDER.map(group => {
            const rows = table.filter(r => r.group === group);
            if (rows.length === 0) return null;
            return (
              <tbody key={group}>
                <tr>
                  <td colSpan={6} className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold text-[#aaa] uppercase tracking-wide">
                    {GROUP_LABEL[group]}
                  </td>
                </tr>
                {rows.map(r => {
                  const rev = revByCode.get(r.code);
                  const qty = volume.quantities[r.code] ?? 0;
                  const lineProfit = rev ? rev.lineRevenue - rev.lineDirectCost : 0;
                  const unpriced = qty > 0 && rev?.customerUnitPrice == null;
                  return (
                    <tr key={r.code} className="border-t border-[#F0EFEA] hover:bg-[#FAFAF8]">
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-1 text-[#222]">
                          <span className="truncate">{r.label}</span>
                          {r.overridden && <Lock size={10} className="shrink-0 text-amber-500" />}
                          {r.holidayBasePayApplied && (
                            <span className="shrink-0 text-[9px] px-1 rounded bg-violet-100 text-violet-700">+lễ</span>
                          )}
                        </div>
                        <div className="text-[9.5px] text-[#aaa]">
                          {r.unitLabel} · {fmtHours(r.resolvedHours)}h/đv
                          {r.effectiveHourly > 0 && ` · ${fmtVnd(r.effectiveHourly)}đ/giờ`}
                        </div>
                      </td>

                      <td className="px-2 py-1.5 text-right tabular-nums text-[#888]">
                        {/* Hệ số THỰC TẾ (đã gồm override + phụ trội lễ), không phải hệ số luật —
                            nếu in hệ số luật thì dòng bị khoá tay sẽ hiện một con số không khớp
                            với số tiền ngay bên cạnh. */}
                        {(r.effectiveCoefficient).toFixed(2).replace(/\.00$/, '')}
                      </td>

                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <NumInput value={Math.round(r.fullPrice)} onChange={v => onOverride(r.code, v > 0 ? v : null)} />
                          {r.overridden && (
                            <button type="button" title="Bỏ khoá tay, tính lại theo luật"
                              onClick={() => onOverride(r.code, null)}
                              className="shrink-0 p-1 rounded hover:bg-amber-100 text-amber-600">
                              <RotateCcw size={11} />
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-2 py-1.5">
                        {r.countsInVolume ? (
                          <div className="flex items-center gap-1">
                            <NumInput value={qty} step={1} onChange={v => onQty(r.code, Math.max(0, v))} />
                            <span className="shrink-0 text-[9.5px] text-[#aaa] w-[18px]">{volumeUnitLabelOf(r.code)}</span>
                          </div>
                        ) : (
                          <div className="text-right text-[10px] text-[#ccc]">—</div>
                        )}
                      </td>

                      <td className="px-2 py-1.5">
                        {r.countsInVolume ? (
                          <div className={unpriced ? 'ring-1 ring-amber-300 rounded-lg' : ''}>
                            <NumInput
                              value={Math.round(rev?.customerUnitPrice ?? 0)}
                              disabled={!priceEditable}
                              onChange={v => onCustomerPrice(r.code, v > 0 ? v : null)}
                            />
                          </div>
                        ) : (
                          <div className="text-right text-[10px] text-[#ccc]">—</div>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {!r.countsInVolume || qty === 0 ? (
                          <span className="text-[#ccc]">—</span>
                        ) : unpriced ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 text-[10.5px]">
                            <AlertTriangle size={10} /> chưa khai giá
                          </span>
                        ) : (
                          <span className={lineProfit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700'}>
                            {lineProfit >= 0 ? '+' : '−'}{fmtVnd(Math.abs(lineProfit))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      <div className="px-2.5 py-2 bg-[#F9F9F7] border-t border-[#E8E7E2] flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-[#888]">
        <span>SHR trả thực <b className="text-[#333]">{fmtVnd(shrPay)}đ/giờ</b></span>
        {!priceEditable && <span className="text-[#aaa]">Giá khách đang suy ra từ Price Book — đổi sang "Gõ tay từng dòng" để sửa</span>}
        <span className="ml-auto flex items-center gap-1"><Lock size={9} className="text-amber-500" /> = đang khoá tay</span>
      </div>
    </div>
  );
}
