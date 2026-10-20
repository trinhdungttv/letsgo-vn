-- ============================================================================
-- 170 — CSKH: mở rộng nhật ký chăm sóc (cskh_logs) thành nhật ký theo NGƯỜI
-- ----------------------------------------------------------------------------
-- cskh_logs là NGUỒN DUY NHẤT của nhật ký CSKH (khách đã ký). crm_interactions
-- giữ cho giai đoạn BD (khách tiềm năng). Map sang PRM (prm_interactions):
--   contact_type  ↔ type      call | message | email | meet | coffee | gift | other
--                             (dòng cũ 'meeting' / 'zalo' vẫn giữ nguyên — code tự đọc-map)
--   log_date      ↔ occurred_at
--   followup      ↔ follow_up_action,  followup_done ↔ follow_up_done
-- Thêm mới: contact_id, channel, initiated_by, followup_due, followup_task_id
-- (work_tasks sinh ra từ "việc đã hứa"), created_by (+ tên), is_archived (xoá mềm), updated_at.
--
-- Trigger: mỗi lần thêm / sửa ngày / đổi người / lưu trữ / xoá một dòng nhật ký →
-- contacts.last_interaction_at = ngày lớn nhất của các dòng CÒN DÙNG của người đó.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN + trigger mới.
-- 4 dòng cũ giữ nguyên (không có contact_id → hiện theo client_name / contact_person).
-- Chạy lại nhiều lần vẫn an toàn. Phải chạy SAU 169.
-- ============================================================================

ALTER TABLE cskh_logs
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT ''
    CHECK (channel IN ('', 'call', 'zalo', 'sms', 'other')),
  ADD COLUMN IF NOT EXISTS initiated_by text
    CHECK (initiated_by IS NULL OR initiated_by IN ('me', 'them')),
  ADD COLUMN IF NOT EXISTS followup_due date,
  ADD COLUMN IF NOT EXISTS followup_task_id uuid REFERENCES work_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid,        -- app_users.id người ghi (không FK, giống cost_plans)
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS cskh_logs_contact_date_idx ON cskh_logs (contact_id, log_date);
CREATE INDEX IF NOT EXISTS cskh_logs_client_idx ON cskh_logs (client_id);
CREATE INDEX IF NOT EXISTS cskh_logs_open_followup_idx ON cskh_logs (followup_due)
  WHERE followup_done = false AND is_archived = false;

-- updated_at tự cập nhật
CREATE OR REPLACE FUNCTION cskh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cskh_logs_touch ON cskh_logs;
CREATE TRIGGER trg_cskh_logs_touch
  BEFORE UPDATE ON cskh_logs
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

-- Ngày tương tác cuối của người liên hệ — tính ở DB, không tính tay ở client.
-- Chỉ ghi khi giá trị thật sự đổi (tránh ghi thừa vào Lịch sử dữ liệu).
CREATE OR REPLACE FUNCTION cskh_sync_last_interaction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected := ARRAY[NEW.contact_id];
  ELSIF TG_OP = 'DELETE' THEN
    affected := ARRAY[OLD.contact_id];
  ELSE
    affected := ARRAY[NEW.contact_id, OLD.contact_id];
  END IF;

  UPDATE contacts c
  SET last_interaction_at = s.last_at
  FROM (
    SELECT x.id,
           (SELECT max(l.log_date) FROM cskh_logs l
             WHERE l.contact_id = x.id AND l.is_archived = false) AS last_at
    FROM (SELECT DISTINCT unnest(affected) AS id) x
    WHERE x.id IS NOT NULL
  ) s
  WHERE c.id = s.id
    AND c.last_interaction_at IS DISTINCT FROM s.last_at;

  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION cskh_sync_last_interaction() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cskh_logs_last_interaction ON cskh_logs;
CREATE TRIGGER trg_cskh_logs_last_interaction
  AFTER INSERT OR DELETE OR UPDATE OF log_date, contact_id, is_archived ON cskh_logs
  FOR EACH ROW EXECUTE FUNCTION cskh_sync_last_interaction();

-- Tính lại cho dữ liệu đang có (hiện chưa dòng nào có contact_id → không đổi gì; chạy lại vô hại)
UPDATE contacts c
SET last_interaction_at = s.last_at
FROM (
  SELECT contact_id, max(log_date) AS last_at
  FROM cskh_logs
  WHERE contact_id IS NOT NULL AND is_archived = false
  GROUP BY contact_id
) s
WHERE c.id = s.contact_id
  AND c.last_interaction_at IS DISTINCT FROM s.last_at;

-- ── ROLLBACK (chỉ chạy khi cần gỡ; mất các thông tin mới ghi vào những cột này) ──
-- DROP TRIGGER IF EXISTS trg_cskh_logs_last_interaction ON cskh_logs;
-- DROP FUNCTION IF EXISTS cskh_sync_last_interaction();
-- DROP TRIGGER IF EXISTS trg_cskh_logs_touch ON cskh_logs;
-- ALTER TABLE cskh_logs
--   DROP COLUMN IF EXISTS contact_id, DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS initiated_by,
--   DROP COLUMN IF EXISTS followup_due, DROP COLUMN IF EXISTS followup_task_id,
--   DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS created_by_name,
--   DROP COLUMN IF EXISTS is_archived, DROP COLUMN IF EXISTS updated_at;
