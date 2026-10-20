-- ============================================================================
-- 173 — CSKH: cài đặt chung toàn công ty (cskh_settings, đúng 1 dòng id = 1)
-- ----------------------------------------------------------------------------
-- Nhịp liên hệ mặc định theo hạng (số ngày) + digest Telegram mỗi sáng (giai đoạn 7).
-- Người liên hệ cần nhịp khác thì đặt contacts.cadence_days (nhịp riêng).
--   vvip  Người quyết định 14 · vip Người ảnh hưởng 30 · partner Tác nghiệp 45
--   friend Quan hệ rộng 90  · family Thân thiết 30    · other Khác 180
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO MỚI bảng + 1 dòng mặc định.
-- Chạy lại nhiều lần vẫn an toàn (không ghi đè cài đặt đã sửa).
-- ============================================================================

CREATE TABLE IF NOT EXISTS cskh_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cadence_vvip        integer NOT NULL DEFAULT 14  CHECK (cadence_vvip    BETWEEN 1 AND 3650),
  cadence_vip         integer NOT NULL DEFAULT 30  CHECK (cadence_vip     BETWEEN 1 AND 3650),
  cadence_partner     integer NOT NULL DEFAULT 45  CHECK (cadence_partner BETWEEN 1 AND 3650),
  cadence_friend      integer NOT NULL DEFAULT 90  CHECK (cadence_friend  BETWEEN 1 AND 3650),
  cadence_family      integer NOT NULL DEFAULT 30  CHECK (cadence_family  BETWEEN 1 AND 3650),
  cadence_other       integer NOT NULL DEFAULT 180 CHECK (cadence_other   BETWEEN 1 AND 3650),
  digest_enabled      boolean NOT NULL DEFAULT false,
  digest_time         time    NOT NULL DEFAULT '07:30',
  digest_max_items    integer NOT NULL DEFAULT 7 CHECK (digest_max_items BETWEEN 1 AND 20),
  digest_last_sent_on date,
  updated_by          uuid,       -- app_users.id người sửa gần nhất
  updated_by_name     text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cskh_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION cskh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cskh_settings_touch ON cskh_settings;
CREATE TRIGGER trg_cskh_settings_touch
  BEFORE UPDATE ON cskh_settings
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

ALTER TABLE cskh_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cskh_settings' AND policyname = 'cskh_settings_all_anon') THEN
    CREATE POLICY "cskh_settings_all_anon" ON cskh_settings FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cskh_settings' AND policyname = 'cskh_settings_all_auth') THEN
    CREATE POLICY "cskh_settings_all_auth" ON cskh_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

SELECT dh_attach_triggers();

-- ── ROLLBACK (chỉ chạy khi cần gỡ; mất cài đặt nhịp đã sửa) ──────────────────
-- DROP TABLE IF EXISTS cskh_settings;
