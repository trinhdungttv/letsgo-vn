-- ============================================================================
-- 178 — Mạng lưới Sale (CRM): chăm sóc Sale / CTV như khách hàng nhưng TÁCH KHU VỰC
-- ----------------------------------------------------------------------------
-- Sale dùng chung bảng `contacts` + nhật ký / sự kiện / quà của CSKH (gắn theo người), chỉ khác
-- cột `kind`. Mọi màn hình của khách hàng chỉ lấy kind = 'client'; trang "Mạng lưới Sale" chỉ lấy
-- kind = 'sale'.
--
--   contacts.kind            'client' (mặc định — mọi người liên hệ hiện có) | 'sale'
--   contacts.sale_company    nơi Sale đang làm (gõ tự do; chọn đối thủ thì tự điền tên)
--   contacts.competitor_id   đối thủ trong Thị trường (nếu Sale đang làm cho đối thủ)
--   contacts.sale_stage      tiến độ chiêu mộ: none | exploring | invited | negotiating | joined | declined
--   contacts.sale_area       khu vực / KCN mạnh
--   contacts.sale_industries ngành quen
--   cskh_groups.kind         nhóm tự tạo của khách / của Sale (2 danh sách riêng, trùng tên được)
--   cskh_settings.sale_cadence  nhịp chăm sóc theo hạng của Sale (thưa hơn khách)
--   client_gifts.client_id   bỏ NOT NULL — quà tặng Sale không gắn công ty khách
--   crm_pipeline.source_contact_id  BD Pipeline: Sale nào giới thiệu công ty này
--
-- Chặn lẫn ở DB: Sale KHÔNG gắn được vào công ty khách (contact_clients) — trigger báo lỗi.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN (có DEFAULT), nới NOT NULL, thay 1 chỉ mục
-- chống trùng tên nhóm (cùng quy tắc, thêm phân biệt khách / Sale), thêm trigger kiểm tra.
-- 52 người liên hệ hiện có nhận kind = 'client' → mọi màn hình khách hàng giữ nguyên.
-- Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

-- ── 1. Người liên hệ: loại + thông tin Sale ─────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS sale_company text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS competitor_id uuid REFERENCES competitors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_stage text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS sale_area text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sale_industries text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE contacts ADD CONSTRAINT contacts_kind_check CHECK (kind IN ('client', 'sale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE contacts ADD CONSTRAINT contacts_sale_stage_check
    CHECK (sale_stage IN ('none', 'exploring', 'invited', 'negotiating', 'joined', 'declined'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS contacts_kind_idx ON contacts (kind);
CREATE INDEX IF NOT EXISTS contacts_competitor_idx ON contacts (competitor_id);

-- ── 2. Sale không gắn được vào công ty khách hàng ───────────────────────────
CREATE OR REPLACE FUNCTION contact_clients_no_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM contacts WHERE id = NEW.contact_id AND kind = 'sale') THEN
    RAISE EXCEPTION 'Sale không gắn được vào công ty khách hàng (Mạng lưới Sale tách riêng)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contact_clients_no_sale ON contact_clients;
CREATE TRIGGER trg_contact_clients_no_sale
  BEFORE INSERT OR UPDATE ON contact_clients
  FOR EACH ROW EXECUTE FUNCTION contact_clients_no_sale();

-- Đổi một người đang gắn công ty khách sang Sale cũng bị chặn (gỡ công ty trước)
CREATE OR REPLACE FUNCTION contacts_sale_no_client() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'sale' AND (TG_OP = 'INSERT' OR OLD.kind IS DISTINCT FROM 'sale')
     AND EXISTS (SELECT 1 FROM contact_clients WHERE contact_id = NEW.id) THEN
    RAISE EXCEPTION 'Người này đang gắn công ty khách hàng — gỡ công ty trước khi chuyển sang Sale';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contacts_sale_no_client ON contacts;
CREATE TRIGGER trg_contacts_sale_no_client
  BEFORE INSERT OR UPDATE OF kind ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_sale_no_client();

-- ── 3. Nhóm tự tạo: danh sách riêng cho khách / Sale ────────────────────────
ALTER TABLE cskh_groups ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'client';
DO $$ BEGIN
  ALTER TABLE cskh_groups ADD CONSTRAINT cskh_groups_kind_check CHECK (kind IN ('client', 'sale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Chống trùng tên: nay tính riêng trong từng khu vực (nhóm "VIP" bên khách và bên Sale cùng tồn tại được)
DROP INDEX IF EXISTS cskh_groups_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS cskh_groups_kind_name_uq
  ON cskh_groups (kind, lower(btrim(name))) WHERE NOT is_archived;

-- ── 4. Nhịp chăm sóc Sale (thưa hơn khách) ──────────────────────────────────
ALTER TABLE cskh_settings
  ADD COLUMN IF NOT EXISTS sale_cadence jsonb NOT NULL
    DEFAULT '{"vvip":30,"vip":45,"partner":90,"friend":120,"family":60,"other":180}'::jsonb;

-- ── 5. Quà tặng Sale không gắn công ty khách ───────────────────────────────
ALTER TABLE client_gifts ALTER COLUMN client_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS client_gifts_recipient_idx ON client_gifts (recipient_contact_id);

-- ── 6. BD Pipeline: Sale nào giới thiệu công ty ─────────────────────────────
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS source_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS crm_pipeline_source_contact_idx ON crm_pipeline (source_contact_id);

-- Nguồn "Sale" / "Đối tác giới thiệu" gõ đúng tên 1 người trong Mạng lưới Sale → tự nối source_contact_id
-- (so tên không phân biệt hoa/thường, khoảng trắng thừa). Đổi tên Sale sau này vẫn giữ liên kết;
-- đổi nguồn sang tên khác / loại khác thì nối lại hoặc bỏ nối.
CREATE OR REPLACE FUNCTION crm_pipeline_link_sale_source() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k text := lower(regexp_replace(btrim(coalesce(NEW.source_name, '')), '\s+', ' ', 'g'));
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
     AND NEW.source_name IS NOT DISTINCT FROM OLD.source_name
     AND NEW.source_contact_id IS NOT DISTINCT FROM OLD.source_contact_id THEN
    RETURN NEW;
  END IF;
  IF NEW.source_type IN ('sale', 'partner') AND k <> '' THEN
    SELECT id INTO NEW.source_contact_id FROM contacts
      WHERE kind = 'sale' AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = k
      ORDER BY created_at LIMIT 1;
  ELSE
    NEW.source_contact_id := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_crm_pipeline_link_sale_source ON crm_pipeline;
CREATE TRIGGER trg_crm_pipeline_link_sale_source
  BEFORE INSERT OR UPDATE ON crm_pipeline
  FOR EACH ROW EXECUTE FUNCTION crm_pipeline_link_sale_source();

-- Báo PostgREST nạp lại cấu trúc bảng (cột mới dùng được ngay)
NOTIFY pgrst, 'reload schema';

-- ── ROLLBACK (chỉ chạy khi cần gỡ; MẤT thông tin Sale đã nhập — người Sale trở thành liên hệ thường) ──
-- DROP TRIGGER IF EXISTS trg_contact_clients_no_sale ON contact_clients;
-- DROP TRIGGER IF EXISTS trg_contacts_sale_no_client ON contacts;
-- DROP FUNCTION IF EXISTS contact_clients_no_sale();
-- DROP FUNCTION IF EXISTS contacts_sale_no_client();
-- DROP TRIGGER IF EXISTS trg_crm_pipeline_link_sale_source ON crm_pipeline;
-- DROP FUNCTION IF EXISTS crm_pipeline_link_sale_source();
-- ALTER TABLE crm_pipeline DROP COLUMN IF EXISTS source_contact_id;
-- ALTER TABLE cskh_settings DROP COLUMN IF EXISTS sale_cadence;
-- DROP INDEX IF EXISTS cskh_groups_kind_name_uq;
-- CREATE UNIQUE INDEX IF NOT EXISTS cskh_groups_name_uq ON cskh_groups (lower(btrim(name))) WHERE NOT is_archived;
-- ALTER TABLE cskh_groups DROP CONSTRAINT IF EXISTS cskh_groups_kind_check, DROP COLUMN IF EXISTS kind;
-- ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_kind_check, DROP CONSTRAINT IF EXISTS contacts_sale_stage_check;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS sale_company, DROP COLUMN IF EXISTS competitor_id,
--   DROP COLUMN IF EXISTS sale_stage, DROP COLUMN IF EXISTS sale_area, DROP COLUMN IF EXISTS sale_industries;
-- (client_gifts.client_id giữ NULL được — đặt lại NOT NULL chỉ khi đã xoá các dòng quà của Sale)
