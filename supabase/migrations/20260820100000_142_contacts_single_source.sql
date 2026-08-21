-- ============================================================================
-- 142 — Contacts: một nguồn dữ liệu duy nhất cho CSKH và Khách hàng
-- ----------------------------------------------------------------------------
-- Bảng `contacts` được dùng từ 2 nơi:
--   • CRM → CSKH → Danh sách liên hệ  (nhập tự do, có thể chưa gắn công ty)
--   • Khách hàng → Hồ sơ chăm sóc → Người liên hệ (luôn gắn sẵn công ty)
-- Migration này chuẩn hoá ràng buộc để 2 nơi ghi vào cùng 1 gốc mà không đá nhau.
-- Idempotent — chạy lại nhiều lần vẫn an toàn. KHÔNG xoá dữ liệu.
-- ============================================================================

-- 1) client_id được phép NULL = liên hệ tự do, chưa gắn công ty.
--    (Migration 008 tạo cột là NOT NULL; UI hiện đã cho phép "chưa gắn".)
ALTER TABLE contacts ALTER COLUMN client_id DROP NOT NULL;

-- 2) Mỗi công ty chỉ có tối đa 1 người liên hệ chính.
--    Dọn dữ liệu cũ trước: nếu 1 công ty đang có nhiều cờ is_primary,
--    giữ lại người được cập nhật gần nhất, các người còn lại bỏ cờ.
UPDATE contacts c
SET is_primary = false, updated_at = now()
WHERE c.is_primary
  AND c.client_id IS NOT NULL
  AND c.id <> (
    SELECT x.id FROM contacts x
    WHERE x.client_id = c.client_id AND x.is_primary
    ORDER BY x.updated_at DESC, x.created_at DESC
    LIMIT 1
  );

-- Liên hệ chưa gắn công ty thì không thể là "liên hệ chính" của ai.
UPDATE contacts SET is_primary = false, updated_at = now()
WHERE is_primary AND client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_primary_per_client_idx
  ON contacts (client_id) WHERE is_primary AND client_id IS NOT NULL;

-- 3) Tra cứu trùng số điện thoại khi thêm liên hệ mới (cảnh báo, không chặn).
CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts (phone) WHERE phone IS NOT NULL;

-- 4) Người đã nghỉ (is_active = false) thì phải có ngày kết thúc để dựng lại
--    được mốc thời gian ai phụ trách từ khi nào.
UPDATE contacts
SET end_date = COALESCE(end_date, (updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
WHERE NOT is_active AND end_date IS NULL;

-- 5) Lịch sử chuyển công ty của người liên hệ — cùng mô hình với
--    client_branch_history: bản ghi bất biến, không sửa/xoá theo trạng thái hiện tại.
CREATE TABLE IF NOT EXISTS contact_client_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  from_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  to_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  -- Tên công ty chốt tại thời điểm chuyển: công ty có thể bị xoá/đổi tên sau này,
  -- lịch sử vẫn phải đọc được.
  from_client_name text,
  to_client_name text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text,
  note text
);

CREATE INDEX IF NOT EXISTS contact_client_history_contact_idx
  ON contact_client_history (contact_id, changed_at DESC);

ALTER TABLE contact_client_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_client_history' AND policyname='cch_all_anon') THEN
    CREATE POLICY "cch_all_anon" ON contact_client_history FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_client_history' AND policyname='cch_all_auth') THEN
    CREATE POLICY "cch_all_auth" ON contact_client_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6) Gắn trigger lịch sử dữ liệu (data_history) cho bảng mới.
SELECT dh_attach_triggers();
