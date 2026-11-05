-- ============================================================================
-- 205 — Hồ sơ Khách hàng: tab "Quy trình công việc" (xưởng → công đoạn, kèm link video YouTube / Google Drive + ảnh)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   client_workflows   1 dòng / khách hàng. workshops = JSON:
--     [{ id, name, note, media:[{id,url,title}],
--        steps:[{ id, name, desc, workers, media:[{id,url,title}] }] }]
--   Video / ảnh KHÔNG lưu file — chỉ lưu link (YouTube, Google Drive, link ảnh), xem ngay trong app.
--
-- Chưa chạy: hồ sơ khách vẫn mở bình thường; tab mới báo "cần chạy migration 205" và KHÔNG lưu được.
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới. Không FK (bài học PGRST201).
-- Lịch sử dữ liệu: gắn dh_track riêng bảng này (KHÔNG gọi dh_attach_triggers()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_workflows (
  client_id   uuid PRIMARY KEY,                       -- clients.id (không FK)
  workshops   jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION client_workflows_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_workflows_touch ON client_workflows;
CREATE TRIGGER trg_client_workflows_touch BEFORE UPDATE ON client_workflows
  FOR EACH ROW EXECUTE FUNCTION client_workflows_touch_updated_at();

ALTER TABLE client_workflows ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_workflows' AND policyname = 'client_workflows_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON client_workflows FOR ALL TO %I USING (true) WITH CHECK (true)', 'client_workflows_all_' || r, r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON client_workflows';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON client_workflows FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE client_workflows IS 'Quy trình công việc của khách: xưởng → công đoạn, kèm link video / ảnh thực tế (chỉ lưu link).';

NOTIFY pgrst, 'reload schema';

-- Kiểm tra sau khi chạy (mong đợi: 1 dòng):
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'client_workflows';
-- Rollback (MẤT dữ liệu đã nhập): DROP TABLE IF EXISTS client_workflows; DROP FUNCTION IF EXISTS client_workflows_touch_updated_at();
