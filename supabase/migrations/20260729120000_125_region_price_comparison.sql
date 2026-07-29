-- 125: So sánh giá vùng (nhiều nguồn lương cho 1 KCN/vùng) — phần "So sánh giá vùng" trong
-- Tính bảng lương. Dùng chung công thức suy ngược SHR với "Tính bảng lương" (mỗi dòng chỉ nhập
-- 1 chỉ số lương từ 1 nguồn: giá mình báo, nhà cung ứng khác, hoặc dự án đã có ở vùng đó), quy
-- đổi ra "Lương tháng chuẩn" để so sánh ngang hàng dù mỗi nguồn nhập loại giá khác nhau. Giúp
-- sales nghiên cứu giá thị trường khi mở rộng vùng mới, biết giá mình báo có phù hợp chưa.
CREATE TABLE IF NOT EXISTS region_price_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Gắn theo KCN đã có sẵn trong market_zones để lần sau mở lại đúng bảng cũ, thêm nguồn mới
  -- vào chứ không mất dữ liệu. kcn_name giữ lại cho trường hợp gõ tay KCN chưa có trong hệ thống.
  kcn_zone_id uuid REFERENCES market_zones(id) ON DELETE SET NULL,
  kcn_name text,
  region text NOT NULL CHECK (region IN ('I', 'II', 'III', 'IV')),
  working_days_per_month int NOT NULL DEFAULT 26,
  -- Mảng các nguồn giá: [{ id, source, type, value, priorDayOt, ours }] — mỗi phần tử là 1
  -- dòng trong bảng so sánh (giống cấu trúc UI), không tách bảng riêng vì số nguồn thường ít
  -- (dưới 10) và không cần query/lọc theo từng dòng.
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Mỗi KCN chỉ có 1 bảng so sánh đang mở (upsert khi lưu) — KHÔNG áp dụng cho kcn_zone_id NULL
-- (KCN gõ tay chưa liên kết), lúc đó luôn tạo bản ghi mới.
CREATE UNIQUE INDEX IF NOT EXISTS idx_region_price_comparisons_zone ON region_price_comparisons(kcn_zone_id) WHERE kcn_zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_region_price_comparisons_created ON region_price_comparisons(created_at DESC);

ALTER TABLE region_price_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "region_price_comparisons_all_anon" ON region_price_comparisons FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "region_price_comparisons_all_auth" ON region_price_comparisons FOR ALL TO authenticated USING (true) WITH CHECK (true);

SELECT dh_attach_triggers();
