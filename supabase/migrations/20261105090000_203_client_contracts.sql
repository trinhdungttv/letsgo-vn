-- ============================================================================
-- 203 — Khách hàng: NHIỀU HỢP ĐỒNG cho cùng 1 công ty
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
-- Ví dụ Olam Biên Hòa: ký 2 HĐ (công đoạn A, công đoạn B). Cuối tháng 5 thanh lý A, B vẫn giữ;
-- 20/9 ký lại A, hạn 31/12/2026. → mỗi HĐ là 1 dòng client_contracts, công ty vẫn là 1 dòng clients.
--
--   client_contracts   1 dòng / hợp đồng: tên-số HĐ, công đoạn, ngày bắt đầu, ngày hết hạn,
--                      terminated_at (ngày thanh lý; NULL = còn hiệu lực), renewed_from (ký lại từ HĐ nào).
--
-- clients.contract_start / contract_end GIỮ NGUYÊN và được app tự đồng bộ = tóm tắt của các HĐ còn hiệu lực
-- (bắt đầu sớm nhất, hết hạn muộn nhất) → Dashboard, cảnh báo hết hạn, điểm sức khoẻ... không phải sửa gì.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG xoá gì. Bước 2 chỉ TẠO thêm 1 HĐ "Hợp đồng chính" cho mỗi khách
-- đang có ngày HĐ (chỉ khi khách đó chưa có HĐ nào) — ngày lấy đúng từ clients.contract_start/contract_end.
-- Xoá HĐ trong app = xoá MỀM (deleted_at). Không có khoá ngoại (bài học PGRST201).
-- Lịch sử dữ liệu: gắn dh_track riêng cho bảng này (KHÔNG gọi dh_attach_triggers()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_contracts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL,                       -- clients.id (không FK)
  name           text NOT NULL DEFAULT '',            -- tên / số hợp đồng
  scope          text NOT NULL DEFAULT '',            -- công đoạn / phạm vi (A, B, đóng gói...)
  start_date     date,
  end_date       date,
  terminated_at  date,                                -- ngày thanh lý; NULL = còn hiệu lực
  renewed_from   uuid,                                -- ký lại từ hợp đồng nào (không FK)
  notes          text NOT NULL DEFAULT '',
  created_by     text NOT NULL DEFAULT '',
  updated_by     text NOT NULL DEFAULT '',
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_contracts_client_idx ON client_contracts (client_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION client_contracts_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_contracts_touch ON client_contracts;
CREATE TRIGGER trg_client_contracts_touch BEFORE UPDATE ON client_contracts
  FOR EACH ROW EXECUTE FUNCTION client_contracts_touch_updated_at();

ALTER TABLE client_contracts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_contracts' AND policyname = 'client_contracts_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON client_contracts FOR ALL TO %I USING (true) WITH CHECK (true)', 'client_contracts_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- ── 2. Chuyển ngày HĐ đang có sang HĐ đầu tiên (chỉ khách chưa có HĐ nào) ──
INSERT INTO client_contracts (client_id, name, start_date, end_date, created_by)
SELECT c.id, 'Hợp đồng chính', c.contract_start, c.contract_end, 'migration 203'
FROM clients c
WHERE (c.contract_start IS NOT NULL OR c.contract_end IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM client_contracts k WHERE k.client_id = c.id);

-- ── 3. Lịch sử dữ liệu (cỗ máy thời gian) ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON client_contracts';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON client_contracts FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE client_contracts IS 'Nhiều hợp đồng / 1 công ty. terminated_at = ngày thanh lý. clients.contract_start/end = tóm tắt do app đồng bộ.';

NOTIFY pgrst, 'reload schema';

-- Kiểm tra: SELECT count(*) FROM client_contracts;
-- Rollback (mất các HĐ đã nhập thêm; clients.contract_* vẫn còn): DROP TABLE IF EXISTS client_contracts; DROP FUNCTION IF EXISTS client_contracts_touch_updated_at();
