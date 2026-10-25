-- ============================================================================
-- 174 — CSKH: nâng cấp hồ sơ người liên hệ theo PRM Tony Study (24/10/2026)
-- ----------------------------------------------------------------------------
-- Thêm vào contacts (khoá giữ GIỐNG PRM để sau này đồng bộ 2 hệ thống):
--   gender               '' (chưa rõ) | 'male' | 'female'      — lọc để chúc 20/10, 8/3
--   education            jsonb mảng [{level, school}] ≤ 10 dòng — "cùng trường với N người"
--   origin_province      quê quán, chỉ tên tỉnh ('' = chưa rõ)  — province giữ nghĩa nơi ở hiện tại
--   birthday_remind_days nhắc sinh nhật trong hồ sơ trước N ngày (NULL = mặc định 3)
-- Nới CHECK của contacts.geo_source: thêm 'manual' (chấm tay trên bản đồ) và
-- 'address_url' (khoá PRM) bên cạnh '', 'map_url', 'address' đang có.
--
-- Có mất dữ liệu hiện có không? KHÔNG.
--   • Chỉ ADD COLUMN có DEFAULT hoặc NULL — mọi người liên hệ nhận gender = '',
--     education = '[]', origin_province = '', birthday_remind_days = NULL.
--   • Nới CHECK geo_source: bỏ ràng buộc cũ, tạo ràng buộc RỘNG hơn — không dòng nào bị
--     sửa (giá trị cũ đều nằm trong danh sách mới).
-- Rollback được: xem cuối file. Chạy lại nhiều lần vẫn an toàn. Phải chạy SAU 169.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT ''
    CHECK (gender IN ('', 'male', 'female')),
  ADD COLUMN IF NOT EXISTS education jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(education) = 'array'
      AND jsonb_array_length(education) <= 10
      AND pg_column_size(education) <= 8192),
  ADD COLUMN IF NOT EXISTS origin_province text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS birthday_remind_days smallint
    CHECK (birthday_remind_days IS NULL OR birthday_remind_days BETWEEN 0 AND 60);

-- Nới CHECK geo_source: gỡ mọi ràng buộc CHECK đang nhắc tới cột geo_source (tên tự sinh
-- của Postgres là contacts_geo_source_check) rồi tạo lại với danh sách rộng hơn.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.contacts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%geo_source%'
  LOOP
    EXECUTE format('ALTER TABLE contacts DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE contacts ADD CONSTRAINT contacts_geo_source_check
    CHECK (geo_source IN ('', 'map_url', 'address', 'address_url', 'manual'));
END $$;

CREATE INDEX IF NOT EXISTS contacts_gender_idx ON contacts (gender) WHERE gender <> '';

SELECT dh_attach_triggers();

-- ── ROLLBACK (chỉ chạy khi cần gỡ) ──────────────────────────────────────────
-- Mất: giới tính, học vấn, quê quán, số ngày nhắc sinh nhật đã nhập sau migration này.
-- Toạ độ chấm tay được giữ, chỉ đổi nguồn về 'address' trước khi đặt lại CHECK cũ:
--   UPDATE contacts SET geo_source = 'address' WHERE geo_source IN ('manual', 'address_url');
--   ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_geo_source_check;
--   ALTER TABLE contacts ADD CONSTRAINT contacts_geo_source_check
--     CHECK (geo_source IN ('', 'map_url', 'address'));
-- DROP INDEX IF EXISTS contacts_gender_idx;
-- ALTER TABLE contacts
--   DROP COLUMN IF EXISTS gender, DROP COLUMN IF EXISTS education,
--   DROP COLUMN IF EXISTS origin_province, DROP COLUMN IF EXISTS birthday_remind_days;
