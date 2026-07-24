-- 114: Đối thủ — vị trí hiển thị ảnh cover (kéo chỉnh khi ảnh không vừa khung), link Google
-- Maps văn phòng chính, và danh sách "nút link nhanh" (Map/Website/Facebook/TikTok...) hiển
-- thị trên mọi thẻ đối thủ — sắp xếp/thêm/xoá loại nút áp dụng CHUNG toàn hệ thống.

-- Object-position (%) của ảnh cover trong khung — cho phép kéo chỉnh góc hiển thị bất kể
-- ảnh ngang hay dọc, không chỉ crop object-fit: cover mặc định ở giữa.
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS image_pos_x numeric NOT NULL DEFAULT 50;
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS image_pos_y numeric NOT NULL DEFAULT 50;

-- Link Google Maps tới văn phòng chính đối thủ.
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS map_link text;

-- Giá trị cho các loại "nút link nhanh" tự thêm ngoài 4 loại có sẵn (map/website/
-- facebook/tiktok, vốn đã có cột riêng) — key khớp với competitor_link_types.key.
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS custom_links jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Cấu hình DÙNG CHUNG toàn hệ thống: loại nút nào hiển thị, thứ tự, và cột dữ liệu tương
-- ứng (field = tên cột thật trên competitors; NULL = lấy từ custom_links[key]).
CREATE TABLE IF NOT EXISTS competitor_link_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  field text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE competitor_link_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitor_link_types_all_anon" ON competitor_link_types FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "competitor_link_types_all_auth" ON competitor_link_types FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO competitor_link_types (key, label, field, sort_order) VALUES
  ('map', 'Bản đồ', 'map_link', 1),
  ('website', 'Website', 'website_url', 2),
  ('facebook', 'Facebook', 'facebook_url', 3),
  ('tiktok', 'TikTok', 'tiktok_url', 4)
ON CONFLICT (key) DO NOTHING;

SELECT dh_attach_triggers();
