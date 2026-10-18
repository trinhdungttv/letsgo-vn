-- 166 — Văn phòng Orient: trạng thái thông báo (đã xử lý / nhắc lại sau) + nhắc trước 90 ngày
-- Chạy tay trong Supabase → SQL Editor, SAU 164 + 165. Chạy lại nhiều lần vẫn an toàn.
-- Lưu trên DB để điện thoại và máy tính thấy cùng một trạng thái.

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS bds_notification_states (
  event_key    text PRIMARY KEY CHECK (btrim(event_key) <> ''),
  status       text NOT NULL CHECK (status IN ('dismissed', 'snoozed')),
  snooze_until date NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bds_notification_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bds_notification_states FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON bds_notification_states TO anon, authenticated;
DROP POLICY IF EXISTS bds_notification_states_admin_all ON bds_notification_states;
CREATE POLICY bds_notification_states_admin_all ON bds_notification_states FOR ALL TO anon, authenticated
  USING ((SELECT bds_is_admin())) WITH CHECK ((SELECT bds_is_admin()));
DROP TRIGGER IF EXISTS trg_bds_notification_states_updated ON bds_notification_states;
CREATE TRIGGER trg_bds_notification_states_updated BEFORE UPDATE ON bds_notification_states
  FOR EACH ROW EXECUTE FUNCTION bds_touch_updated_at();

-- Nhắc trước tối đa 90 ngày (3 tháng) thay vì 60. Chỉ đổi khi vẫn đang để mặc định cũ.
ALTER TABLE bds_settings ALTER COLUMN alert_days SET DEFAULT 90;
UPDATE bds_settings SET alert_days = 90 WHERE alert_days = 60;

NOTIFY pgrst, 'reload schema';
