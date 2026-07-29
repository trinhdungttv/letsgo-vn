import { formatCurrencyFull } from '../format';

// Các phép tính trong engine (chia SHR, nhân hệ số...) luôn ra số lẻ — làm tròn về đồng trước
// khi hiển thị để tránh phần thập phân sau dấu phẩy (dễ đọc nhầm thành đơn vị nghìn/decimal).
export function fmtVnd(value: number): string {
  return formatCurrencyFull(Math.round(value));
}
