-- ============================================================================
-- 144 — Ngày đặc biệt của người liên hệ (ngoài sinh nhật) + hạ tầng nhắc nhở
-- ----------------------------------------------------------------------------
-- Sinh nhật đã có sẵn ở contacts.birthday. Bảng này cho phép thêm CÁC ngày
-- khác (kỷ niệm hợp tác, ngày thành lập công ty, lễ riêng...), mỗi người
-- nhiều ngày. Tất cả đều lặp lại HÀNG NĂM theo tháng/ngày khi tính nhắc nhở
-- (client tự tính từ date, không cần cột riêng).
-- Idempotent — chạy lại nhiều lần vẫn an toàn. KHÔNG xoá dữ liệu.
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_special_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label text NOT NULL,
  date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_special_dates_contact_idx ON contact_special_dates (contact_id);

ALTER TABLE contact_special_dates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_special_dates' AND policyname='csd_all_anon') THEN
    CREATE POLICY "csd_all_anon" ON contact_special_dates FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_special_dates' AND policyname='csd_all_auth') THEN
    CREATE POLICY "csd_all_auth" ON contact_special_dates FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

SELECT dh_attach_triggers();
