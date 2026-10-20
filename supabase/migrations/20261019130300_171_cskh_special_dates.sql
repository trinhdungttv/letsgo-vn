-- ============================================================================
-- 171 — CSKH: sự kiện (âm / dương lịch) cho người liên hệ — mở rộng contact_special_dates
-- ----------------------------------------------------------------------------
-- Map sang PRM (prm_occasions): label ↔ title. Thêm:
--   occasion_type   birthday | anniversary | memorial | other
--   day, month      ngày/tháng của sự kiện (theo is_lunar: âm hoặc dương)
--   year            năm thật nếu biết (năm sinh, năm thành lập…) — NULL = không rõ
--   is_lunar        sự kiện âm lịch (giỗ, sinh nhật âm…)
--   related_person  "của người thân" (con gái, mẹ…)
--   remind_days_before (mặc định 7), last_reminded_year (chống tạo trùng việc chuẩn bị quà)
--   note, is_archived (xoá mềm), updated_at
--
-- Cột `date` cũ: nới NOT NULL để lưu được sự kiện ÂM LỊCH (không có ngày dương cố định).
-- Quy ước sau migration:
--   • Sự kiện dương lịch: LUÔN có `date`; trigger tự điền day/month theo `date`
--     → form cũ (chỉ ghi label + date) vẫn đúng. Năm trong `date` KHÔNG mang nghĩa
--     (như trước nay); năm thật nằm ở `year`.
--   • Sự kiện âm lịch: `date` = NULL, bắt buộc có day + month.
--
-- Có mất dữ liệu hiện có không? KHÔNG.
--   • 4 dòng hiện có giữ nguyên `label`, `date`; được điền thêm day/month từ `date`,
--     loại sự kiện đoán từ tên (bắt đầu bằng "SN"/"Sinh nhật" → birthday;
--     "thành lập"/"khai trương"/"kỷ niệm" → anniversary). `year` để trống vì
--     trước nay năm trong `date` không mang nghĩa.
--   • Nới NOT NULL không đổi giá trị nào.
-- Rollback: xem cuối file. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

ALTER TABLE contact_special_dates
  ADD COLUMN IF NOT EXISTS occasion_type text NOT NULL DEFAULT 'other'
    CHECK (occasion_type IN ('birthday', 'anniversary', 'memorial', 'other')),
  ADD COLUMN IF NOT EXISTS day smallint CHECK (day IS NULL OR day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS month smallint CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS year integer CHECK (year IS NULL OR year BETWEEN 1900 AND 2200),
  ADD COLUMN IF NOT EXISTS is_lunar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS related_person text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS remind_days_before integer NOT NULL DEFAULT 7
    CHECK (remind_days_before BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS last_reminded_year integer,
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE contact_special_dates ALTER COLUMN date DROP NOT NULL;

-- Sự kiện dương lịch: day/month luôn khớp `date` (kể cả khi form cũ chỉ ghi label + date)
CREATE OR REPLACE FUNCTION cskh_special_dates_fill() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.is_lunar AND NEW.date IS NOT NULL THEN
    NEW.day := EXTRACT(DAY FROM NEW.date)::smallint;
    NEW.month := EXTRACT(MONTH FROM NEW.date)::smallint;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contact_special_dates_fill ON contact_special_dates;
CREATE TRIGGER trg_contact_special_dates_fill
  BEFORE INSERT OR UPDATE ON contact_special_dates
  FOR EACH ROW EXECUTE FUNCTION cskh_special_dates_fill();

-- Điền dữ liệu cũ (chỉ những dòng chưa có day — chạy lại không đụng dòng đã điền)
UPDATE contact_special_dates
SET occasion_type = CASE
      WHEN label ~* '^\s*(sn\M|sinh nh)' THEN 'birthday'
      WHEN label ~* '(thành lập|khai trương|kỷ niệm|ky niem|thanh lap|khai truong)' THEN 'anniversary'
      ELSE occasion_type
    END
WHERE day IS NULL AND date IS NOT NULL;   -- trigger tự điền day/month khi UPDATE

-- Mỗi sự kiện phải xác định được ngày: dương lịch cần `date`, âm lịch cần day + month
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_special_dates_when_check') THEN
    ALTER TABLE contact_special_dates ADD CONSTRAINT contact_special_dates_when_check
      CHECK ((is_lunar AND day IS NOT NULL AND month IS NOT NULL) OR (NOT is_lunar AND date IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contact_special_dates_md_idx ON contact_special_dates (month, day);

-- ── ROLLBACK (chỉ chạy khi cần gỡ) ──────────────────────────────────────────
-- Trước khi đặt lại NOT NULL phải xử lý các sự kiện âm lịch (date đang NULL):
--   SELECT id, label, day, month FROM contact_special_dates WHERE date IS NULL;   -- xem trước
--   DELETE FROM contact_special_dates WHERE date IS NULL;                          -- MẤT các sự kiện âm lịch đó
-- ALTER TABLE contact_special_dates DROP CONSTRAINT IF EXISTS contact_special_dates_when_check;
-- ALTER TABLE contact_special_dates ALTER COLUMN date SET NOT NULL;
-- DROP TRIGGER IF EXISTS trg_contact_special_dates_fill ON contact_special_dates;
-- DROP FUNCTION IF EXISTS cskh_special_dates_fill();
-- ALTER TABLE contact_special_dates
--   DROP COLUMN IF EXISTS occasion_type, DROP COLUMN IF EXISTS day, DROP COLUMN IF EXISTS month,
--   DROP COLUMN IF EXISTS year, DROP COLUMN IF EXISTS is_lunar, DROP COLUMN IF EXISTS related_person,
--   DROP COLUMN IF EXISTS remind_days_before, DROP COLUMN IF EXISTS last_reminded_year,
--   DROP COLUMN IF EXISTS note, DROP COLUMN IF EXISTS is_archived, DROP COLUMN IF EXISTS updated_at;
