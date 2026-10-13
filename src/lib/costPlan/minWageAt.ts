// Lương tối thiểu vùng cho Phương án giá — tra theo NGÀY BAN HÀNH của báo giá (không phải "mức hiện hành").
//
// Các lần tăng lương vùng khai ở Thị trường → tab Lương TT (bảng region_wage_batches, mỗi lần 1 ngày áp dụng). Báo giá
// ban hành ngày nào thì lương cơ bản tối thiểu, mức đóng BHXH (theo tối thiểu vùng)… lấy đúng mức đang hiệu lực ngày đó;
// báo giá còn hiệu lực qua mốc tăng lương thì cảnh báo để tính lại.
import { mergeBatches, minWageStaleNotice, resolveMinWage, type MinWageBatch, type RegionZone } from '../minWage';
import type { PlanWarning } from './types';

export interface PlanMinWage {
  monthly: number;
  /** "Vùng I" */
  label: string;
  /** Mốc áp dụng (yyyy-mm-dd) và căn cứ của mức này */
  effectiveFrom?: string;
  decree?: string;
}

const REGIONS: RegionZone[] = ['I', 'II', 'III', 'IV'];
const dd = (iso: string) => { const [y, m, d] = iso.split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Gộp thêm "mức hiện hành" của bảng region_wages vào danh sách các lần tăng — phòng khi bảng hiện hành có số mà bảng
 * các lần tăng chưa có mốc tương ứng (dữ liệu nhập trước khi có tab lịch sử). Mốc đã có trong danh sách thì giữ nguyên.
 */
export function withCurrentRows(batches: MinWageBatch[], rows: Partial<Record<RegionZone, { amount: number; effectiveDate: string }>> | null | undefined): MinWageBatch[] {
  if (!rows) return batches;
  const dates = REGIONS.map(z => rows[z]?.effectiveDate).filter(Boolean) as string[];
  if (!dates.length) return batches;
  const date = dates.sort().slice(-1)[0];
  if (batches.some(b => b.effectiveFrom === date)) return batches;
  const wages = Object.fromEntries(REGIONS.map(z => [z, rows[z]?.amount ? { monthly: Number(rows[z]!.amount), hourly: null } : null])) as MinWageBatch['wages'];
  return [...batches, { effectiveFrom: date, decree: 'Mức hiện hành (bảng lương vùng)', wages }];
}

/** Mức tối thiểu của 1 vùng tại 1 ngày. null = chưa gán vùng / chưa tra được (không đoán số — đây là ngưỡng pháp lý). */
export function planMinWage(region: string | null | undefined, atDate: string, batches: MinWageBatch[]): PlanMinWage | null {
  if (!region || !REGIONS.includes(region as RegionZone)) return null;
  const rule = resolveMinWage(region as RegionZone, atDate, batches);
  return rule ? { monthly: rule.monthly, label: `Vùng ${region}`, effectiveFrom: rule.effectiveFrom, decree: rule.decree } : null;
}

/**
 * Nhắc về lương tối thiểu theo thời gian của báo giá:
 *  • bảng lương vùng đã cũ (mốc gần nhất quá 12 tháng trước ngày ban hành);
 *  • báo giá còn hiệu lực qua 1 mốc tăng lương → giá sau mốc đó cần tính lại;
 *  • ngày ban hành cũ nên đang dùng mức khác mức áp dụng hôm nay.
 */
export function minWageTimelineNotes(
  region: string | null | undefined, issueDate: string, validUntil: string | null | undefined, batches: MinWageBatch[], today = todayIso(),
): PlanWarning[] {
  const out: PlanWarning[] = [];
  if (!region || !REGIONS.includes(region as RegionZone)) return out;
  const z = region as RegionZone;
  const stale = minWageStaleNotice(issueDate, batches);
  if (stale) out.push({ level: 'warn', text: `${stale} Khai mức mới ở Thị trường → Lương TT.` });
  const cur = resolveMinWage(z, issueDate, batches);
  if (!cur) {
    out.push({ level: 'warn', text: `Không tra được lương tối thiểu Vùng ${z} tại ngày ban hành ${dd(issueDate)} — kiểm tra ngày ban hành hoặc khai mốc lương ở Thị trường → Lương TT.` });
    return out;
  }
  if (validUntil && validUntil > issueDate) {
    const next = mergeBatches(batches).find(b => b.effectiveFrom > issueDate && b.effectiveFrom <= validUntil && b.wages[z]?.monthly && b.wages[z]!.monthly !== cur.monthly);
    if (next) {
      out.push({ level: 'warn', text: `Báo giá còn hiệu lực đến ${dd(validUntil)}, nhưng từ ${dd(next.effectiveFrom)} lương tối thiểu Vùng ${z} đổi thành ${vnd(next.wages[z]!.monthly)} đ (${next.decree}) — giá áp dụng sau mốc này cần tính lại, hoặc rút ngắn hiệu lực.` });
    }
  }
  const now = resolveMinWage(z, today, batches);
  if (now && now.monthly !== cur.monthly) {
    out.push({ level: 'info', text: `Đang tính theo lương tối thiểu tại ngày ban hành ${dd(issueDate)}: ${vnd(cur.monthly)} đ — mức áp dụng hôm nay là ${vnd(now.monthly)} đ (từ ${dd(now.effectiveFrom)}).` });
  }
  return out;
}
