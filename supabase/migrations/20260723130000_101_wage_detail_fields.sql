-- 101: Bảng trường lương chi tiết dùng CHUNG toàn hệ thống (Lương cơ bản, Phụ cấp...).
-- Thêm/sửa/xoá 1 trường ở đây thì mọi nơi nhập lương (Let's Go VN lẫn từng NCC, ở mọi
-- công ty/dự án) đều thấy đúng bộ trường đó — không phải trường riêng theo từng công ty.

CREATE TABLE IF NOT EXISTS wage_detail_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wage_detail_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wage_detail_fields_all_anon" ON wage_detail_fields FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "wage_detail_fields_all_auth" ON wage_detail_fields FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO wage_detail_fields (name, sort_order) VALUES
  ('Lương cơ bản', 1),
  ('Phụ cấp chuyên cần', 2),
  ('Phụ cấp xăng xe', 3),
  ('Phụ cấp nhà trọ', 4),
  ('Phụ cấp thâm niên', 5),
  ('Thưởng năng suất', 6),
  ('Ăn ca', 7)
ON CONFLICT (name) DO NOTHING;

-- Giá trị chi tiết lương của Let's Go VN cho từng công ty/dự án (đối chiếu với từng NCC
-- trong suppliers/market_suppliers, vốn đã có cột wage_detail nằm trong chính jsonb đó).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS wage_detail jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS wage_detail jsonb NOT NULL DEFAULT '{}'::jsonb;
