-- 234 — Tích "đã chi" Ứng lương / Chi lương theo từng công ty, từng tháng (popup "Cần chú ý hôm nay").
-- Chỉ THÊM 1 bảng mới, không đụng dữ liệu cũ. Chạy lại nhiều lần vẫn an toàn.
-- 1 dòng = công ty X đã chi (advance = ứng lương, payroll = chi lương) trong tháng 'YYYY-MM'. Bỏ tích = xoá dòng.
CREATE TABLE IF NOT EXISTS finance_payout_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL,                       -- clients.id (không FK)
  kind        text NOT NULL CHECK (kind IN ('advance', 'payroll')),
  month       text NOT NULL,                       -- 'YYYY-MM'
  checked_by  text NOT NULL DEFAULT '',
  checked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, kind, month)
);

ALTER TABLE finance_payout_checks ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'finance_payout_checks' AND policyname = 'finance_payout_checks_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON finance_payout_checks FOR ALL TO %I USING (true) WITH CHECK (true)', 'finance_payout_checks_all_' || r, r);
    END IF;
  END LOOP;
END $$;
