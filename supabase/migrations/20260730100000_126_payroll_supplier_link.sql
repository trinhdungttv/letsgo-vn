-- 126: Nối "Tính bảng lương" với bảng lương NCC ở Thị trường (clients.market_suppliers /
-- market_leads.suppliers) để nghiên cứu giá đối thủ: cùng 1 công ty (vd AMPACS) nhưng mỗi NCC
-- (Trí Việt, Let's Go VN…) trả 1 mức lương khác nhau — nhập 1 mức bất kỳ của NCC nào đó, hệ
-- thống suy ra cả bảng đơn giá + phí dịch vụ họ đang thu, rồi đồng bộ 2 chiều với Thị trường.

-- Trường lương chi tiết (migration 101) vốn là danh sách tên tự do do người dùng tự thêm
-- ("Ca ngày 8h (Ca 1+2)", "Ca đêm 8h (130%)"…). Gắn thêm mã loại đơn giá theo luật để hệ thống
-- biết 1 trường tương ứng với loại giờ nào → mới suy ngược ra SHR được. NULL = trường phụ cấp
-- thuần (ăn ca, xăng xe…), không quy đổi được ra đơn giá giờ, chỉ cộng vào tổng thu nhập.
ALTER TABLE wage_detail_fields ADD COLUMN IF NOT EXISTS payroll_input_type text;

COMMENT ON COLUMN wage_detail_fields.payroll_input_type IS
  'Mã loại đơn giá theo luật (base_salary, day_wage_8h, night_wage_8h, holiday_wage_8h, ot_day_weekday, ot_night_weekday, ot_day_sunday, ot_night_sunday, ot_day_holiday, ot_night_holiday, shift12_day, shift12_night). NULL = khoản phụ cấp thuần.';

-- Gán sẵn cho các trường đã có tên đủ rõ — chỉ điền vào ô còn trống, không ghi đè nếu người
-- dùng đã tự chọn. Dùng ILIKE vì tên trường người dùng gõ tay kèm chú thích ("(Ca 1+2)", "(130%)").
UPDATE wage_detail_fields SET payroll_input_type = 'base_salary'
  WHERE payroll_input_type IS NULL AND (name ILIKE 'Lương cơ bản%' OR name = 'LCB');
UPDATE wage_detail_fields SET payroll_input_type = 'day_wage_8h'
  WHERE payroll_input_type IS NULL AND name ILIKE 'Ca ngày 8h%';
UPDATE wage_detail_fields SET payroll_input_type = 'night_wage_8h'
  WHERE payroll_input_type IS NULL AND name ILIKE 'Ca đêm 8h%';
UPDATE wage_detail_fields SET payroll_input_type = 'shift12_day'
  WHERE payroll_input_type IS NULL AND name ILIKE 'Ca ngày 12h%';
UPDATE wage_detail_fields SET payroll_input_type = 'shift12_night'
  WHERE payroll_input_type IS NULL AND name ILIKE 'Ca đêm 12h%';

-- Báo giá đã lưu (migration 124) giờ gắn được với 1 NCC cụ thể tại 1 công ty, và giữ lại các
-- con số người dùng CHỈNH TAY đè lên kết quả tính theo luật (thực tế công ty hay trả số tròn,
-- hoặc cộng thêm khoản ngoài luật) — nếu không lưu thì mở lại báo giá sẽ mất phần chỉnh tay.
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS supplier_name text;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS is_us boolean NOT NULL DEFAULT true;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS rate_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS wage_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN quote_requests.supplier_name IS 'Tên NCC/đối thủ mà bảng lương này mô tả (NULL = chính công ty mình). Khớp với market_suppliers[].name để đồng bộ 2 chiều.';
COMMENT ON COLUMN quote_requests.rate_overrides IS 'Đơn giá từng loại giờ người dùng chỉnh tay đè lên kết quả tính theo luật: { "day_wage_8h": 250000, ... }';
COMMENT ON COLUMN quote_requests.wage_detail IS 'Bảng lương chi tiết (cùng bộ trường với wage_detail_fields) đã chốt — dùng để đồng bộ sang market_suppliers.';

CREATE INDEX IF NOT EXISTS idx_quote_requests_supplier ON quote_requests(supplier_name) WHERE supplier_name IS NOT NULL;

SELECT dh_attach_triggers();
