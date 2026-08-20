-- ============================================================================
-- 143 — Người liên hệ: chức vụ tự quản lý, link Google Maps nhà riêng, avatar
-- ----------------------------------------------------------------------------
-- Idempotent — chạy lại nhiều lần vẫn an toàn. KHÔNG xoá dữ liệu.
-- ============================================================================

-- 1) Danh mục chức vụ dùng chung, người dùng tự thêm/sửa/xoá trong app.
--    Cùng mô hình với bảng `industries` (migration 099).
CREATE TABLE IF NOT EXISTS contact_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  -- Số nhỏ nổi lên trước trong ô chọn; cùng số thì xếp theo tên.
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contact_roles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_roles' AND policyname='contact_roles_all_anon') THEN
    CREATE POLICY "contact_roles_all_anon" ON contact_roles FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_roles' AND policyname='contact_roles_all_auth') THEN
    CREATE POLICY "contact_roles_all_auth" ON contact_roles FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed danh sách mặc định đang hard-code trong app.
INSERT INTO contact_roles (name, sort_order) VALUES
  ('Giám đốc', 10), ('HR Manager', 20), ('Kế toán', 30),
  ('Trưởng phòng', 40), ('Nhân viên', 50), ('Khác', 900)
ON CONFLICT (name) DO NOTHING;

-- Seed thêm những chức vụ đã được gõ tay trong dữ liệu hiện có, để không mất
-- lựa chọn nào sau khi ô chọn chuyển sang đọc từ bảng này.
INSERT INTO contact_roles (name)
SELECT DISTINCT trim(role) FROM contacts
WHERE role IS NOT NULL AND trim(role) <> ''
ON CONFLICT (name) DO NOTHING;

-- 2) Link Google Maps cho địa chỉ nhà riêng của người liên hệ.
--    Lưu nguyên link, toạ độ được parse ở client (lib/geo.ts) khi cần.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS map_link text;

-- 3) Ảnh đại diện — lưu URL công khai trong bucket `avatars` (đã tạo ở
--    migration 036). Ảnh được thu nhỏ ở client trước khi tải lên nên nhẹ.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avatar_url text;

-- 4) Gắn trigger lịch sử dữ liệu cho bảng mới.
SELECT dh_attach_triggers();
