-- Migration 056: Thêm loại hình dịch vụ (leasing / recruitment) vào bảng clients.
-- Dịch vụ cho thuê lao động (leasing): giữ nguyên chu kỳ tháng cố định.
-- Dịch vụ giới thiệu lao động (recruitment): không cố định ngày chu kỳ,
--   xuất hóa đơn khi lao động làm đủ 7 ngày, thanh toán theo số ngày công nợ.

-- 1. Thêm cột service_type với giá trị mặc định 'leasing'
--    để toàn bộ khách hàng hiện tại không bị ảnh hưởng.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'leasing'
  CHECK (service_type IN ('leasing', 'recruitment'));

-- 2. Thêm cột payment_term_days: số ngày được nợ sau khi xuất hóa đơn.
--    Chỉ có ý nghĩa với service_type = 'recruitment'.
--    Mặc định 30 ngày.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS payment_term_days INTEGER NOT NULL DEFAULT 30;

-- 3. Cho phép NULL ở các cột chu kỳ tháng không áp dụng cho recruitment.
--    Dùng ALTER COLUMN ... DROP NOT NULL để tránh phá vỡ dữ liệu leasing hiện tại.
ALTER TABLE clients ALTER COLUMN cutoff_day DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN calc_day   DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN salary_day DROP NOT NULL;

-- 4. Đặt lại DEFAULT = NULL cho các cột trên (recruitment sẽ không điền).
ALTER TABLE clients ALTER COLUMN cutoff_day DROP DEFAULT;
ALTER TABLE clients ALTER COLUMN calc_day   DROP DEFAULT;
ALTER TABLE clients ALTER COLUMN salary_day DROP DEFAULT;

-- 5. Đảm bảo payment_start và payment_end cũng cho phép NULL
--    (recruitment không dùng kỳ thanh toán cố định).
ALTER TABLE clients ALTER COLUMN payment_start DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN payment_end   DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN payment_start DROP DEFAULT;
ALTER TABLE clients ALTER COLUMN payment_end   DROP DEFAULT;

-- 6. Cập nhật mọi bản ghi hiện có sang 'leasing' để đảm bảo nhất quán
--    (phòng trường hợp DEFAULT không áp dụng cho dữ liệu cũ).
UPDATE clients SET service_type = 'leasing' WHERE service_type IS NULL;
