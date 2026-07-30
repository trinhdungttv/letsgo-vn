// §4.7 — lương tối thiểu vùng cho module "Tính bảng lương".
//
// KHÔNG giữ bảng số riêng: mọi mức lương tối thiểu nằm ở src/lib/minWage.ts, dùng chung với
// Khu vực / Lương TT / Công ty-Dự án. Hai bảng song song chắc chắn sẽ lệch nhau — đúng loại lỗi
// "nhiều nguồn sự thật" mà bản rebuild này sinh ra để dẹp.
//
// ⚠ Ở lượt trước file này từng chứa bộ số của một nghị định hiệu lực 01/01/2026 mà tôi tự điền
// khi chưa được xác nhận. Đã RÚT RA. Batch xác thực cuối cùng hiện là NĐ 74/2024/NĐ-CP; nếu hôm
// nay đã cách mốc đó quá 12 tháng thì isMinWageStale() trả true và UI phải hiện cảnh báo lỗi thời
// thay vì âm thầm dùng số cũ như thể nó còn hiệu lực.
export {
  resolveMinWage, resolveMinWageBatch, minWageMonthly, minWageHourly,
  isMinWageStale, minWageStaleNotice, mergeBatches,
  MIN_WAGE_BATCHES, MIN_WAGE_STALE_WARNING, MIN_WAGE_STALE_MONTHS, REGION_ZONES,
  type MinWageRule, type MinWageBatch, type MinWageAmounts, type RegionZone,
} from '../../lib/minWage';
