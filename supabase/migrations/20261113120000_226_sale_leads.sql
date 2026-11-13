-- ============================================================================
-- 226 — BẢNG NHÁP ĐẦU MỐI SALE / CTV (CRM → CSKH → tệp Sale / CTV → tab "Đầu mối")
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
-- Đầu mối = Sale / CTV / nhà cung ứng khác tìm được trên mạng (bài đăng tuyển, kênh Facebook / Zalo…),
-- CHƯA quen, mới chỉ gọi / nhắn để mời hợp tác. Để riêng khỏi danh bạ chăm sóc (`contacts`):
--   • không nhắc việc, không chấm điểm, không lên Tổng quan / Nhịp độ;
--   • mục đích chính: KHÔNG GỌI TRÙNG — mỗi SĐT chỉ có 1 dòng (khoá phone_keys, chặn cả ở DB);
--   • ai gặp mặt được rồi mới bấm "Chuyển sang Sale / CTV" → tạo người trong contacts (kind = 'sale'),
--     dòng nháp giữ lại với promoted_contact_id để biết đã chuyển.
--
--   sale_leads.phone            SĐT như đã nhập (nhiều số cách nhau dấu phẩy / gạch chéo)
--   sale_leads.phone_keys       các số đã chuẩn hoá 0xxxxxxxxx (app tính) — khoá chống trùng
--   sale_leads.company          đơn vị đang làm (Manpower, Green Speed… / tự do)
--   sale_leads.zone_ids         KCN ghép được với danh mục Thị trường → Khu vực (market_zones.id)
--   sale_leads.area_text        cột "Khu vực" chữ gốc (giữ lại phần chưa có trong danh mục)
--   sale_leads.channel_url      link kênh (trang cá nhân / fanpage / Zalo…)
--   sale_leads.post_url         link bài đăng tuyển
--   sale_leads.status           new | no_answer | talking | meeting | declined | promoted
--   sale_leads.contact_log      các lần gọi / nhắn: [{at, channel, result, note, by}]
--   sale_leads.promoted_contact_id  người trong Sale / CTV đã tạo từ dòng này (contacts.id, KHÔNG FK)
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới. Không đụng bảng cũ.
-- Xoá trong app = xoá MỀM (deleted_at), khôi phục được ở trang Lịch sử.
-- Không có khoá ngoại (bài học PGRST201 — FK thứ 2 giữa 2 bảng đã embed làm trống trang).
-- Lịch sử dữ liệu: gắn dh_track RIÊNG bảng này (KHÔNG gọi dh_attach_triggers()).
-- ============================================================================

-- ── 1. Bảng ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sale_leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            text NOT NULL DEFAULT '',
  phone                text NOT NULL DEFAULT '',
  phone_keys           text[] NOT NULL DEFAULT '{}',
  company              text NOT NULL DEFAULT '',
  zone_ids             uuid[] NOT NULL DEFAULT '{}',
  area_text            text NOT NULL DEFAULT '',
  channel_url          text NOT NULL DEFAULT '',
  post_url             text NOT NULL DEFAULT '',
  note                 text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'new',
  contact_log          jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_contact_at      timestamptz,
  promoted_contact_id  uuid,
  promoted_at          timestamptz,
  source               text NOT NULL DEFAULT '',          -- nguồn nhập: "Dán từ Google Sheets 13/11/2026", tên file…
  created_by           text NOT NULL DEFAULT '',
  updated_by           text NOT NULL DEFAULT '',
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE sale_leads ADD CONSTRAINT sale_leads_status_check
    CHECK (status IN ('new', 'no_answer', 'talking', 'meeting', 'declined', 'promoted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS sale_leads_alive_idx ON sale_leads (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sale_leads_phone_keys_idx ON sale_leads USING gin (phone_keys);
CREATE INDEX IF NOT EXISTS sale_leads_zone_ids_idx ON sale_leads USING gin (zone_ids);

-- ── 2. Chống trùng SĐT (lưới an toàn — app đã kiểm trước khi lưu) ──────────
-- Dòng còn sống (chưa xoá mềm) không được có số trùng dòng còn sống khác. Khôi phục dòng đã xoá
-- mà số đã có người khác dùng → cũng báo lỗi.
CREATE OR REPLACE FUNCTION sale_leads_no_dup_phone() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  other record;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR coalesce(cardinality(NEW.phone_keys), 0) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT id, full_name, phone INTO other FROM sale_leads
   WHERE id <> NEW.id AND deleted_at IS NULL AND phone_keys && NEW.phone_keys
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'SĐT % đã có trong bảng nháp đầu mối (%)', other.phone, nullif(other.full_name, '')
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_leads_no_dup_phone ON sale_leads;
CREATE TRIGGER trg_sale_leads_no_dup_phone
  BEFORE INSERT OR UPDATE OF phone_keys, deleted_at ON sale_leads
  FOR EACH ROW EXECUTE FUNCTION sale_leads_no_dup_phone();

-- ── 3. updated_at tự cập nhật ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sale_leads_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_leads_touch ON sale_leads;
CREATE TRIGGER trg_sale_leads_touch BEFORE UPDATE ON sale_leads
  FOR EACH ROW EXECUTE FUNCTION sale_leads_touch_updated_at();

-- ── 4. Quyền bảng: giống các bảng khác của app (app chạy anon) ─────────────
ALTER TABLE sale_leads ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sale_leads' AND policyname = 'sale_leads_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON sale_leads FOR ALL TO %I USING (true) WITH CHECK (true)', 'sale_leads_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- ── 5. Lịch sử dữ liệu (cỗ máy thời gian + chặn Ban Điều Hành ghi) ─────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON sale_leads';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON sale_leads FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE sale_leads IS 'Bảng nháp đầu mối Sale / CTV chưa gặp — chống gọi trùng theo SĐT (phone_keys). Gặp được thì chuyển sang contacts (kind=sale). Xoá mềm bằng deleted_at.';

-- PostgREST nạp lại danh sách bảng ngay (khỏi đợi)
NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 1 dòng sale_leads + 3 trigger) ────────
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'sale_leads';
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'sale_leads'::regclass AND NOT tgisinternal ORDER BY 1;

-- ── Rollback (chạy tay nếu cần bỏ — MẤT toàn bộ đầu mối đã nhập) ───────────
-- DROP TABLE IF EXISTS sale_leads;
-- DROP FUNCTION IF EXISTS sale_leads_no_dup_phone();
-- DROP FUNCTION IF EXISTS sale_leads_touch_updated_at();
