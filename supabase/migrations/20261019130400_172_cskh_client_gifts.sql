-- ============================================================================
-- 172 — CSKH: lịch sử quà tặng theo người — mở rộng client_gifts
-- ----------------------------------------------------------------------------
-- client_gifts là NGUỒN quà của khách ĐÃ KÝ (CSKH + hồ sơ công ty). crm_gifts chỉ
-- còn cho khách tiềm năng ở BD Pipeline. Map sang PRM (prm_gifts):
--   recipient_contact_id ↔ contact_id  (người liên hệ của món quà: người NHẬN khi
--                                       mình tặng, người TẶNG khi họ tặng mình)
--   item_name ↔ item,  value ↔ estimated_value (VND),  gift_date ↔ given_at,  notes ↔ note
-- Thêm mới: direction (given = mình tặng | received = họ tặng), occasion_id (gắn sự
-- kiện), is_archived (xoá mềm), updated_at. `created_by` (tên người ghi) giữ như cũ.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN. 2 dòng hiện có nhận
-- direction = 'given' (đúng nghĩa: trước nay chỉ ghi quà mình tặng).
-- Chạy lại nhiều lần vẫn an toàn. Phải chạy SAU 171 (occasion_id tham chiếu sự kiện).
-- ============================================================================

ALTER TABLE client_gifts
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'given'
    CHECK (direction IN ('given', 'received')),
  ADD COLUMN IF NOT EXISTS occasion_id uuid REFERENCES contact_special_dates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS client_gifts_contact_idx ON client_gifts (recipient_contact_id, gift_date);

CREATE OR REPLACE FUNCTION cskh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_gifts_touch ON client_gifts;
CREATE TRIGGER trg_client_gifts_touch
  BEFORE UPDATE ON client_gifts
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

-- ── ROLLBACK (chỉ chạy khi cần gỡ; mất chiều quà "họ tặng" và liên kết sự kiện) ──
-- DROP TRIGGER IF EXISTS trg_client_gifts_touch ON client_gifts;
-- ALTER TABLE client_gifts
--   DROP COLUMN IF EXISTS direction, DROP COLUMN IF EXISTS occasion_id,
--   DROP COLUMN IF EXISTS is_archived, DROP COLUMN IF EXISTS updated_at;
