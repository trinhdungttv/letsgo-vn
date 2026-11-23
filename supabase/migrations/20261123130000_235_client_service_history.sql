-- 235 — Lịch sử chuyển loại hình dịch vụ của khách hàng (Cho thuê LĐ ⇄ Giới thiệu LĐ ⇄ HOH) có NGÀY CHUYỂN.
-- Chỉ THÊM 1 bảng mới, không đổi / xoá dữ liệu hiện có. Chạy lại nhiều lần vẫn an toàn.
CREATE TABLE IF NOT EXISTS client_service_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL,                 -- clients.id (không FK)
  from_type      text,                          -- leasing | recruitment | hoh
  to_type        text NOT NULL,
  effective_from date NOT NULL,                 -- ngày chuyển
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_service_history_client ON client_service_history(client_id, effective_from);

ALTER TABLE client_service_history ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_service_history' AND policyname = 'client_service_history_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON client_service_history FOR ALL TO %I USING (true) WITH CHECK (true)', 'client_service_history_all_' || r, r);
    END IF;
  END LOOP;
END $$;
