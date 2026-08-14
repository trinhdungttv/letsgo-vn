-- ─────────────────────────────────────────────────────────────────────────────
-- 136 — Kỳ TT Trên HĐ / Kỳ TT Thực Tế
--
-- Bối cảnh:
--   Cột "Kỳ TT" hiện có (payment_group/payment_days/payment_fixed_day/payment_cutoff/...)
--   ghi nhận điều khoản thanh toán ĐÃ KÝ TRONG HỢP ĐỒNG — đổi tên khái niệm thành
--   "Kỳ TT Trên HĐ", KHÔNG đổi cột DB, KHÔNG đổi cách tính (calcExpectedDue).
--
--   Thêm "Kỳ TT Thực Tế" — ngày thanh toán THỰC TẾ áp dụng, có thể khác HĐ.
--   Chỉ 2 cách chọn (thu hẹp so với 3 nhóm của Kỳ TT Trên HĐ):
--     'days'  — số ngày kể từ ngày xuất HĐ (giống nhóm 1, dùng chung anchor invoice_date)
--     'fixed' — ngày cố định trong tháng, có mốc chốt (giống nhóm 2 không theo thứ)
--   payment_actual_mode = NULL nghĩa là CHƯA cấu hình riêng → ứng dụng tự dùng lại
--   Kỳ TT Trên HĐ (không có dữ liệu trùng lặp bắt buộc phải nhập cho mọi khách).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_actual_mode text;       -- 'days' | 'fixed' | NULL
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_actual_days integer;    -- dùng khi mode='days'
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_actual_fixed_day integer; -- dùng khi mode='fixed', -1 = cuối tháng
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_actual_cutoff integer;    -- dùng khi mode='fixed': chốt trước ngày này thì vào kỳ tháng này

COMMENT ON COLUMN clients.payment_actual_mode IS
  'Cách tính Kỳ TT Thực Tế: ''days'' (số ngày kể từ ngày xuất HĐ) | ''fixed'' (ngày cố định trong tháng) | NULL (chưa cấu hình, dùng lại Kỳ TT Trên HĐ — payment_group/payment_days/...).';
