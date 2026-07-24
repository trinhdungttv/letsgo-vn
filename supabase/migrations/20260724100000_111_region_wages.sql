-- 111: Bảng lương tối thiểu 4 vùng (Vùng I–IV) dùng CHUNG toàn hệ thống (Khu vực, Lương
-- TT, Công ty/Dự án) — trước đây lưu localStorage nên không có lịch sử thay đổi và không
-- đồng bộ giữa các máy. Chuyển vào DB để mọi người thấy cùng 1 mức, và tận dụng luôn hệ
-- thống data_history (migration 090) để tự động ghi "tăng từ bao giờ, mức cũ là bao nhiêu".

CREATE TABLE IF NOT EXISTS region_wages (
  zone text PRIMARY KEY CHECK (zone IN ('I', 'II', 'III', 'IV')),
  wage_amount numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE region_wages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "region_wages_all_anon" ON region_wages FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "region_wages_all_auth" ON region_wages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Mức khởi tạo theo Nghị định 74/2024/NĐ-CP, áp dụng từ 01/7/2024.
INSERT INTO region_wages (zone, wage_amount) VALUES
  ('I', 4960000), ('II', 4410000), ('III', 3860000), ('IV', 3450000)
ON CONFLICT (zone) DO NOTHING;

-- Gắn trigger nhật ký (data_history) cho bảng mới này — dh_attach_triggers quét lại toàn
-- bộ pg_tables nên gọi lại là đủ, không cần viết trigger riêng.
SELECT dh_attach_triggers();
