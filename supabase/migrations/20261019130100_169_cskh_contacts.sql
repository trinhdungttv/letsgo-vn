-- ============================================================================
-- 169 — CSKH: thêm cột chăm sóc vào bảng người liên hệ (contacts)
-- ----------------------------------------------------------------------------
-- contacts vẫn là NGUỒN DUY NHẤT của người liên hệ (CSKH, hồ sơ Khách hàng, CRM).
-- Thêm các cột của PRM (Tony Study) — giữ NGUYÊN khoá enum để sau này đồng bộ:
--   tier            hạng chăm sóc: vvip | vip | partner | friend | family | other | unclassified
--                   (nhãn LetsGo: Người quyết định / Người ảnh hưởng / Tác nghiệp /
--                    Quan hệ rộng / Thân thiết / Khác / Chưa chăm sóc)
--   group_id        nhóm tự tạo (cskh_groups, migration 168)
--   cadence_days    nhịp riêng (NULL = theo hạng trong cskh_settings)
--   last_interaction_at  ngày tương tác cuối — DO TRIGGER của cskh_logs tự ghi (migration 170)
--   last_cold_alert_at   lần cuối đã tạo việc "Kết nối lại" (chống tạo trùng)
--   owner_id        người phụ trách = tài khoản app (app_users)
--   nickname, zalo_phone, habits, personality, mbti, remember_notes ("Điều cần nhớ"),
--   introduced_by, context, province, lat, lng, geo_source, external_ref (id bên Tony Study)
-- Sở thích dùng lại cột có sẵn `hobbies` (TEXT chứa JSON array) — KHÔNG đổi kiểu.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN (có DEFAULT hoặc NULL).
-- 48 người liên hệ hiện có nhận tier = 'unclassified' (Chưa chăm sóc), context = 'work'.
-- Chạy lại nhiều lần vẫn an toàn. Phải chạy SAU 168.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'unclassified'
    CHECK (tier IN ('vvip', 'vip', 'partner', 'friend', 'family', 'other', 'unclassified')),
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES cskh_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cadence_days integer
    CHECK (cadence_days IS NULL OR cadence_days BETWEEN 1 AND 3650),
  ADD COLUMN IF NOT EXISTS last_interaction_at date,
  ADD COLUMN IF NOT EXISTS last_cold_alert_at date,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nickname text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS zalo_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS habits text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS personality text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mbti text NOT NULL DEFAULT ''
    CHECK (mbti = '' OR mbti IN (
      'INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
      'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP')),
  -- 5 khoá cố định: family | likes | avoid | work | other (mỗi mục ≤ 500 ký tự — kiểm ở code)
  ADD COLUMN IF NOT EXISTS remember_notes jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(remember_notes) = 'object' AND pg_column_size(remember_notes) <= 8192),
  ADD COLUMN IF NOT EXISTS introduced_by uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'work'
    CHECK (context IN ('personal', 'work', 'both')),
  ADD COLUMN IF NOT EXISTS province text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS geo_source text NOT NULL DEFAULT ''
    CHECK (geo_source IN ('', 'map_url', 'address')),
  ADD COLUMN IF NOT EXISTS external_ref text;

-- Không tự giới thiệu chính mình
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_introduced_by_not_self') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_introduced_by_not_self
      CHECK (introduced_by IS NULL OR introduced_by <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contacts_tier_idx ON contacts (tier);
CREATE INDEX IF NOT EXISTS contacts_owner_idx ON contacts (owner_id);
CREATE INDEX IF NOT EXISTS contacts_group_idx ON contacts (group_id);
CREATE INDEX IF NOT EXISTS contacts_last_interaction_idx ON contacts (last_interaction_at);

-- updated_at tự cập nhật (code cũ vẫn tự ghi updated_at — trigger chỉ đảm bảo không sót,
-- cần cho đồng bộ tăng dần với Tony Study sau này)
CREATE OR REPLACE FUNCTION cskh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contacts_touch ON contacts;
CREATE TRIGGER trg_contacts_touch
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

-- ── ROLLBACK (chỉ chạy khi cần gỡ; mất các thông tin CSKH đã nhập vào những cột này) ──
-- DROP TRIGGER IF EXISTS trg_contacts_touch ON contacts;
-- ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_introduced_by_not_self;
-- ALTER TABLE contacts
--   DROP COLUMN IF EXISTS tier, DROP COLUMN IF EXISTS group_id, DROP COLUMN IF EXISTS cadence_days,
--   DROP COLUMN IF EXISTS last_interaction_at, DROP COLUMN IF EXISTS last_cold_alert_at,
--   DROP COLUMN IF EXISTS owner_id, DROP COLUMN IF EXISTS nickname, DROP COLUMN IF EXISTS zalo_phone,
--   DROP COLUMN IF EXISTS habits, DROP COLUMN IF EXISTS personality, DROP COLUMN IF EXISTS mbti,
--   DROP COLUMN IF EXISTS remember_notes, DROP COLUMN IF EXISTS introduced_by, DROP COLUMN IF EXISTS context,
--   DROP COLUMN IF EXISTS province, DROP COLUMN IF EXISTS lat, DROP COLUMN IF EXISTS lng,
--   DROP COLUMN IF EXISTS geo_source, DROP COLUMN IF EXISTS external_ref;
