-- 124: Tính bảng lương (Payroll Reverse-Calculation Engine) — nhập 1 đơn giá lương + 1 phí
-- dịch vụ, suy ngược ra Đơn giá giờ chuẩn (SHR) rồi tính xuôi ra lương NLĐ/chi phí NSDLĐ/
-- doanh thu Agency/invoice khách hàng. Đây là công cụ tính TẠM (sales tự nhập nhanh khi có
-- thông tin từ 1 bên nào đó), không ràng buộc với hồ sơ lao động thật (chưa có bảng
-- labor_contracts trong hệ thống) nên không tạo bảng đó — company_name/kcn_name để tự do
-- gõ tay, client_id chỉ là liên kết TUỲ CHỌN khi trùng với khách hàng đã có sẵn.

-- Hệ số quy đổi pháp lý (Điều 57 NĐ 145/2020, Điều 98 BLLĐ 2019) + tỷ lệ bảo hiểm (Luật
-- BHXH 2024, hiệu lực 01/07/2025). Lưu ở DB (thay vì hardcode trong code) để sửa được khi
-- luật đổi mà không cần deploy lại, và để hiển thị "công thức đã dùng" tra ngược lại nguồn.
CREATE TABLE IF NOT EXISTS legal_coefficients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  coefficient numeric(14,4) NOT NULL,
  legal_basis text,
  effective_from date NOT NULL,
  effective_to date,
  UNIQUE (code, effective_from)
);

ALTER TABLE legal_coefficients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_coefficients_all_anon" ON legal_coefficients FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "legal_coefficients_all_auth" ON legal_coefficients FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO legal_coefficients (code, coefficient, legal_basis, effective_from) VALUES
  ('NORM_DAY',                1.00, 'Giờ thường, ban ngày', '2021-01-01'),
  ('NORM_NIGHT',              1.30, 'Điều 98.2 BLLĐ 2019 — giờ thường ban đêm (không OT)', '2021-01-01'),
  ('OT_DAY_WEEKDAY',          1.50, 'Điều 98.1.a NĐ 145/2020 — OT ngày thường, ban ngày', '2021-01-01'),
  ('OT_DAY_SUNDAY',           2.00, 'Điều 98.1.b NĐ 145/2020 — OT ngày nghỉ hằng tuần, ban ngày', '2021-01-01'),
  ('OT_DAY_HOLIDAY',          3.00, 'Điều 98.1.c NĐ 145/2020 — OT ngày lễ/Tết, ban ngày', '2021-01-01'),
  ('EMPLOYEE_INSURANCE_RATE', 0.105, 'Luật BHXH 2024 — NLĐ đóng: BHXH 8% + BHTN 1% + BHYT 1.5%', '2025-07-01'),
  ('EMPLOYER_INSURANCE_RATE', 0.215, 'Luật BHXH 2024 — NSDLĐ đóng: BHXH 17.5% + BHTN 1% + BHYT 3%', '2025-07-01'),
  ('UNION_FEE_RATE',          0.02,  'Kinh phí công đoàn (nếu áp dụng)', '2021-01-01'),
  ('INSURANCE_CAP_MULTIPLE', 20.00,  'Trần đóng BHXH = 20 lần lương cơ sở', '2021-01-01'),
  ('BASE_SALARY_FOR_CAP', 2340000.00, 'Lương cơ sở hiện hành theo NĐ 73/2024/NĐ-CP, hiệu lực từ 01/7/2024', '2024-07-01')
ON CONFLICT (code, effective_from) DO NOTHING;

SELECT dh_attach_triggers();

-- Kết quả "Tính bảng lương" — lưu tạm để xem lại sau, KHÔNG phải hồ sơ hợp đồng lao động
-- thật nên company_name/kcn_name luôn nhập tay tự do; client_id chỉ gắn khi người dùng
-- chọn đúng 1 khách hàng đã có sẵn trong hệ thống (tuỳ chọn, không bắt buộc).
CREATE TABLE IF NOT EXISTS quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  kcn_name text,
  kcn_zone_id uuid REFERENCES market_zones(id) ON DELETE SET NULL, -- gắn khi chọn đúng 1 KCN có sẵn trong market_zones, để so sánh/đối chiếu về sau
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  input_type text NOT NULL,
  input_value numeric(14,0) NOT NULL,
  prior_day_ot boolean NOT NULL DEFAULT false,
  region text NOT NULL CHECK (region IN ('I', 'II', 'III', 'IV')),
  working_days_per_month int NOT NULL DEFAULT 26,
  service_fee_type text NOT NULL,
  service_fee_value numeric(14,4) NOT NULL,
  referral_duration_mode text, -- 'one_time' | 'recurring_months', chỉ áp dụng cho phí giới thiệu theo giờ
  referral_months int,         -- số tháng hưởng phí giới thiệu (giờ khi recurring_months, hoặc luôn có với "theo ngày có thời hạn")
  vat_rate numeric(5,4) NOT NULL DEFAULT 0.08,
  computed_shr numeric(14,4),
  result_json jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_requests_client ON quote_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_created ON quote_requests(created_at DESC);

ALTER TABLE quote_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_requests_all_anon" ON quote_requests FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "quote_requests_all_auth" ON quote_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

SELECT dh_attach_triggers();

-- Lương tối thiểu vùng 2026 theo NĐ 293/2025/NĐ-CP — thêm 1 batch mới (region_wage_batches,
-- migration 113); trigger có sẵn sẽ tự tính lại region_wages vì 01/01/2026 đã qua hôm nay.
INSERT INTO region_wage_batches (effective_date, wage_i, wage_ii, wage_iii, wage_iv, note)
VALUES ('2026-01-01', 5310000, 4730000, 4140000, 3700000, 'Nghị định 293/2025/NĐ-CP')
ON CONFLICT (effective_date) DO NOTHING;
