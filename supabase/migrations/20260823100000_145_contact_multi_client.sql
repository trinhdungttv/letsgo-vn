-- ============================================================================
-- 145 — Một người liên hệ có thể phụ trách NHIỀU CÔNG TY (ngang hàng)
-- ----------------------------------------------------------------------------
-- Thực tế: một chị HR của tập đoàn phụ trách 2-3 nhà máy, mà mỗi nhà máy là một
-- dòng riêng trong bảng `clients`. Cột `contacts.client_id` chỉ chứa được 1 nên
-- phải nhập trùng người, dẫn tới lịch sử và quà tặng bị tách làm đôi.
--
-- Từ đây, bảng nối `contact_clients` là NGUỒN DUY NHẤT của quan hệ
-- người liên hệ ↔ công ty. Các công ty NGANG HÀNG nhau, không có công ty "chính".
-- Cờ "liên hệ chính" chuyển xuống từng dòng nối: một người có thể là liên hệ
-- chính ở công ty A mà không phải ở công ty B.
--
-- AN TOÀN: migration này CHỈ THÊM bảng và CHÉP dữ liệu sang. Không xoá dòng nào,
-- không bỏ cột nào. `contacts.client_id` / `contacts.is_primary` được giữ lại và
-- tự đồng bộ bằng trigger, nên mọi màn hình cũ chưa kịp sửa vẫn chạy như trước.
-- Chạy lại nhiều lần vẫn an toàn (idempotent).
-- ============================================================================

-- 0) Điều kiện cần: liên hệ được phép chưa gắn công ty nào ───────────────────
--    (Migration 142 đã làm; lặp lại ở đây để 145 chạy độc lập được. Gỡ hết công
--    ty của một người sẽ đẩy cột soi về NULL, còn NOT NULL thì lệnh đó sẽ hỏng.)
ALTER TABLE contacts ALTER COLUMN client_id DROP NOT NULL;

-- 1) Bảng nối ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_clients (
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES clients(id)  ON DELETE CASCADE,
  -- Liên hệ chính CỦA CÔNG TY NÀY. Mỗi công ty tối đa 1 người.
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, client_id)
);

CREATE INDEX IF NOT EXISTS contact_clients_client_idx  ON contact_clients (client_id);
CREATE INDEX IF NOT EXISTS contact_clients_contact_idx ON contact_clients (contact_id);

-- Mỗi công ty chỉ có tối đa 1 liên hệ chính — giống ràng buộc cũ ở migration 142.
CREATE UNIQUE INDEX IF NOT EXISTS contact_clients_one_primary_per_client_idx
  ON contact_clients (client_id) WHERE is_primary;

ALTER TABLE contact_clients ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_clients' AND policyname='cc_all_anon') THEN
    CREATE POLICY "cc_all_anon" ON contact_clients FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_clients' AND policyname='cc_all_auth') THEN
    CREATE POLICY "cc_all_auth" ON contact_clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2) Chép dữ liệu đang có sang bảng nối ──────────────────────────────────────
--    Mỗi liên hệ đang gắn công ty → 1 dòng nối, giữ nguyên cờ liên hệ chính.
--    Dữ liệu cũ có thể còn nhiều người cùng mang cờ liên hệ chính của một công
--    ty (nếu migration 142 chưa chạy). Chỉ giữ người được cập nhật gần nhất —
--    đúng quy tắc 142 đã dùng — để không vướng unique index ở trên.
INSERT INTO contact_clients (contact_id, client_id, is_primary, created_at)
SELECT
  c.id,
  c.client_id,
  COALESCE(c.is_primary, false) AND c.id = (
    SELECT x.id FROM contacts x
    WHERE x.client_id = c.client_id AND x.is_primary
    ORDER BY x.updated_at DESC, x.created_at DESC
    LIMIT 1
  ),
  COALESCE(c.created_at, now())
FROM contacts c
WHERE c.client_id IS NOT NULL
ON CONFLICT (contact_id, client_id) DO NOTHING;

-- 3) Giữ `contacts.client_id` / `is_primary` đồng bộ làm CỘT SOI (legacy) ─────
--    Không đọc 2 cột này trong code mới: nguồn thật là contact_clients. Chúng chỉ
--    tồn tại để màn hình/truy vấn cũ không vỡ trong lúc chuyển tiếp.
--    Quy tắc soi: lấy dòng nối cũ nhất (created_at, rồi client_id để chốt thứ tự).
CREATE OR REPLACE FUNCTION contacts_sync_legacy_client(p_contact_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_client_id uuid;
  v_primary boolean;
BEGIN
  SELECT cc.client_id, cc.is_primary INTO v_client_id, v_primary
  FROM contact_clients cc
  WHERE cc.contact_id = p_contact_id
  ORDER BY cc.created_at, cc.client_id
  LIMIT 1;

  UPDATE contacts
  SET client_id  = v_client_id,
      is_primary = COALESCE(v_primary, false)
  WHERE id = p_contact_id
    AND (client_id IS DISTINCT FROM v_client_id
         OR is_primary IS DISTINCT FROM COALESCE(v_primary, false));
END $$;

CREATE OR REPLACE FUNCTION contact_clients_sync_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM contacts_sync_legacy_client(OLD.contact_id);
    RETURN OLD;
  END IF;
  PERFORM contacts_sync_legacy_client(NEW.contact_id);
  IF TG_OP = 'UPDATE' AND OLD.contact_id <> NEW.contact_id THEN
    PERFORM contacts_sync_legacy_client(OLD.contact_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contact_clients_sync ON contact_clients;
CREATE TRIGGER contact_clients_sync
AFTER INSERT OR UPDATE OR DELETE ON contact_clients
FOR EACH ROW EXECUTE FUNCTION contact_clients_sync_trigger();

-- 4) Ràng buộc cũ trên `contacts` phải nới ra ────────────────────────────────
--    Index "1 liên hệ chính / công ty" giờ nằm ở contact_clients. Để nguyên nó
--    trên cột soi sẽ chặn oan khi chuyển cờ liên hệ chính từ người này sang
--    người kia: trigger cập nhật cột soi theo từng dòng, nên có một khoảnh khắc
--    giữa 2 lệnh mà cả hai cùng mang cờ true — unique index thường (không
--    deferrable) sẽ báo lỗi ngay tại đó dù kết quả cuối vẫn hợp lệ.
DROP INDEX IF EXISTS contacts_one_primary_per_client_idx;

-- 5) Trigger lịch sử dữ liệu (data_history) cho bảng mới.
--    Có kiểm tra vì hàm này đến từ migration 090; DB nào chưa chạy 090 thì bỏ qua.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_attach_triggers') THEN
    PERFORM dh_attach_triggers();
  END IF;
END $$;
