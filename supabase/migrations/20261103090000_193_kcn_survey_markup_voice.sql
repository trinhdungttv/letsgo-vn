-- ============================================================================
-- 193 — Khảo sát KCN: ghi chú vẽ lên ảnh chỉ tiêu + ghi âm khi đi khảo sát
-- ----------------------------------------------------------------------------
--   kcn_survey_photos.annotations   nét vẽ / chữ ghi lên ảnh (JSON, toạ độ theo khung ảnh) — file ảnh gốc KHÔNG bị sửa.
--   kcn_survey_voice_notes          bản ghi âm nhanh lúc đi khảo sát: chỗ ghi (GPS), công ty gần đó, thời lượng, ghi chú.
--                                   File âm thanh nằm trong bucket 'kcn-survey' (thư mục voice/), đã có từ migration 190.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN + tạo bảng mới. Xoá trong app là xoá mềm (deleted_at).
-- Lịch sử dữ liệu: gắn dh_track RIÊNG cho bảng ghi âm, KHÔNG gọi dh_attach_triggers().
-- Không thêm khoá ngoại sang clients / market_leads / crm_pipeline (bài học PGRST201).
-- Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

ALTER TABLE kcn_survey_photos ADD COLUMN IF NOT EXISTS annotations jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS kcn_survey_voice_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid REFERENCES kcn_survey_trips(id) ON DELETE SET NULL,
  zone_id       uuid,
  zone_name     text NOT NULL DEFAULT '',
  lat           double precision,                       -- NULL = lúc ghi chưa có GPS
  lng           double precision,
  accuracy_m    real,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  duration_s    real NOT NULL DEFAULT 0 CHECK (duration_s >= 0),
  storage_path  text NOT NULL,
  url           text NOT NULL,
  mime_type     text NOT NULL DEFAULT '',
  size_bytes    integer,
  company_name  text NOT NULL DEFAULT '',
  client_id     uuid,
  lead_id       uuid,
  crm_id        uuid,
  note          text NOT NULL DEFAULT '',
  user_id       uuid,
  user_name     text NOT NULL DEFAULT '',
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kcn_survey_voice_zone_idx ON kcn_survey_voice_notes (zone_id, recorded_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS kcn_survey_voice_trip_idx ON kcn_survey_voice_notes (trip_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS kcn_survey_voice_recorded_idx ON kcn_survey_voice_notes (recorded_at DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_kcn_survey_voice_touch ON kcn_survey_voice_notes;
CREATE TRIGGER trg_kcn_survey_voice_touch
  BEFORE UPDATE ON kcn_survey_voice_notes
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

ALTER TABLE kcn_survey_voice_notes ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_voice_notes' AND policyname = 'kcn_survey_voice_notes_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_voice_notes FOR ALL TO %I USING (true) WITH CHECK (true)', 'kcn_survey_voice_notes_all_' || r, r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_voice_notes';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_voice_notes FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra (mong đợi: true · true) ────────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kcn_survey_photos' AND column_name = 'annotations') AS co_cot_ghi_chu_anh,
--   EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kcn_survey_voice_notes') AS co_bang_ghi_am;

-- ── ROLLBACK (mất nét vẽ trên ảnh + danh sách ghi âm; file âm thanh vẫn còn trong bucket) ──
-- DROP TABLE IF EXISTS kcn_survey_voice_notes;
-- ALTER TABLE kcn_survey_photos DROP COLUMN IF EXISTS annotations;
