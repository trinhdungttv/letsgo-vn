-- ============================================================================
-- 195 — Khảo sát KCN: gắn SAO công ty cần chú trọng + LƯU TRỮ 30 ngày rồi mới xoá hẳn
-- ----------------------------------------------------------------------------
--   kcn_survey_stars        1 dòng / 1 công ty được gắn sao (bấm ☆ lúc lưu ảnh chỉ tiêu, hoặc khi xem ảnh).
--                           company_key: 'c:<client_id>' | 'p:<crm_id>' | 'l:<lead_id>' | 'n:<tên bỏ dấu>@<zone_id>'.
--                           Bỏ sao = đặt deleted_at (gắn lại thì xoá deleted_at) — không xoá dòng.
--   kcn_survey_purge_archive(p_days, p_kind, p_id)
--                           Xoá HẲN mục đã nằm trong Lưu trữ (deleted_at) quá p_days ngày (tối thiểu 30) — app gọi
--                           khi mở tab Khảo sát KCN. Truyền p_kind + p_id = bấm "Xoá hẳn" 1 mục trong Lưu trữ
--                           (chỉ xoá được mục ĐÃ ở trong Lưu trữ). Dùng giờ máy chủ, không phụ thuộc giờ điện thoại.
--                           Trả về đường dẫn file Supabase Storage của ảnh / ghi âm vừa xoá để app xoá file.
--   kcn_survey_purged_files Đường dẫn file đã xoá dòng nhưng chưa xoá file. Policy XOÁ file của bucket kcn-survey
--                           CHỈ cho phép xoá file có tên nằm trong bảng này → không ai xoá được ảnh đang dùng.
--
-- Có mất dữ liệu hiện có không?
--   - Chạy file này: KHÔNG xoá gì — chỉ tạo bảng / hàm / policy mới.
--   - SAU khi chạy: mục đã xoá (nút Xoá trong app, kể cả mục xoá TRƯỚC hôm nay) quá 30 ngày sẽ bị XOÁ HẲN khi có
--     người mở tab Khảo sát KCN. Chuyến xoá hẳn → vết GPS của chuyến đó xoá theo (khoá ngoại CASCADE); ảnh / ghi âm
--     của chuyến KHÔNG bị xoá theo (trip_id tự thành NULL). Dòng chuyến / ảnh / ghi âm vẫn còn bản sao trong
--     Lịch sử dữ liệu (data_history, trigger dh_track). File trên Cloudflare R2 ("r2:…") không xoá.
-- Lịch sử dữ liệu: gắn dh_track RIÊNG bảng sao. KHÔNG gọi dh_attach_triggers().
-- Chạy lại nhiều lần vẫn an toàn (idempotent). Rollback: xem cuối file.
-- ============================================================================

-- ── 1. Sao công ty ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kcn_survey_stars (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_key   text NOT NULL UNIQUE,
  company_name  text NOT NULL DEFAULT '',
  client_id     uuid,                                   -- clients.id (không FK)
  crm_id        uuid,                                   -- crm_pipeline.id (không FK)
  lead_id       uuid,                                   -- market_leads.id (không FK)
  zone_id       uuid,                                   -- market_zones.id (không FK)
  zone_name     text NOT NULL DEFAULT '',
  note          text NOT NULL DEFAULT '',
  user_id       uuid,
  user_name     text NOT NULL DEFAULT '',
  deleted_at    timestamptz,                            -- bỏ sao
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_kcn_survey_stars_touch ON kcn_survey_stars;
CREATE TRIGGER trg_kcn_survey_stars_touch
  BEFORE UPDATE ON kcn_survey_stars
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

-- ── 2. File chờ xoá (chỉ file của mục đã xoá hẳn) ───────────────────────────
CREATE TABLE IF NOT EXISTS kcn_survey_purged_files (
  path        text PRIMARY KEY,                         -- tên file trong bucket kcn-survey
  purged_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kcn_survey_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcn_survey_purged_files ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_stars' AND policyname = 'kcn_survey_stars_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_stars FOR ALL TO %I USING (true) WITH CHECK (true)', 'kcn_survey_stars_all_' || r, r);
    END IF;
    -- Bảng file chờ xoá: app chỉ ĐỌC (để policy xoá file kiểm) và XOÁ dòng sau khi đã xoá file; thêm dòng chỉ qua hàm dọn
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_purged_files' AND policyname = 'kcn_survey_purged_select_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_purged_files FOR SELECT TO %I USING (true)', 'kcn_survey_purged_select_' || r, r);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_purged_files' AND policyname = 'kcn_survey_purged_delete_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_purged_files FOR DELETE TO %I USING (true)', 'kcn_survey_purged_delete_' || r, r);
    END IF;
    -- Xoá file trong bucket: CHỈ file nằm trong danh sách chờ xoá
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'kcn_survey_delete_purged_' || r) THEN
      EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR DELETE TO %I USING (bucket_id = %L AND EXISTS (SELECT 1 FROM public.kcn_survey_purged_files f WHERE f.path = storage.objects.name))',
        'kcn_survey_delete_purged_' || r, r, 'kcn-survey');
    END IF;
  END LOOP;
END $$;

-- ── 3. Dọn Lưu trữ ──────────────────────────────────────────────────────────
-- p_kind: 'trip' | 'photo' | 'voice' (NULL = mọi loại) · p_id: 1 mục cụ thể (bỏ qua hạn 30 ngày, vẫn phải đang ở Lưu trữ)
CREATE OR REPLACE FUNCTION kcn_survey_purge_archive(p_days integer DEFAULT 30, p_kind text DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS TABLE (item_kind text, item_id uuid, file_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cutoff timestamptz := now() - make_interval(days => GREATEST(COALESCE(p_days, 30), 30));
  rec record;
  thumb text;
BEGIN
  IF p_kind IS NULL OR p_kind = 'photo' THEN
    FOR rec IN
      DELETE FROM kcn_survey_photos ph
      WHERE ph.deleted_at IS NOT NULL AND (CASE WHEN p_id IS NULL THEN ph.deleted_at < cutoff ELSE ph.id = p_id END)
      RETURNING ph.id, ph.storage_path, ph.thumb_url
    LOOP
      item_kind := 'photo'; item_id := rec.id; file_path := NULL;
      IF rec.storage_path NOT LIKE 'r2:%' THEN
        file_path := rec.storage_path;
        INSERT INTO kcn_survey_purged_files (path) VALUES (rec.storage_path) ON CONFLICT DO NOTHING;
        thumb := substring(rec.thumb_url FROM '/object/public/kcn-survey/(.+)$');
        IF thumb IS NOT NULL THEN
          INSERT INTO kcn_survey_purged_files (path) VALUES (thumb) ON CONFLICT DO NOTHING;
          RETURN NEXT;
          file_path := thumb;
        END IF;
      END IF;
      RETURN NEXT;
    END LOOP;
  END IF;

  IF (p_kind IS NULL OR p_kind = 'voice') AND to_regclass('public.kcn_survey_voice_notes') IS NOT NULL THEN
    FOR rec IN
      DELETE FROM kcn_survey_voice_notes vn
      WHERE vn.deleted_at IS NOT NULL AND (CASE WHEN p_id IS NULL THEN vn.deleted_at < cutoff ELSE vn.id = p_id END)
      RETURNING vn.id, vn.storage_path
    LOOP
      item_kind := 'voice'; item_id := rec.id; file_path := NULL;
      IF rec.storage_path NOT LIKE 'r2:%' THEN
        file_path := rec.storage_path;
        INSERT INTO kcn_survey_purged_files (path) VALUES (rec.storage_path) ON CONFLICT DO NOTHING;
      END IF;
      RETURN NEXT;
    END LOOP;
  END IF;

  IF p_kind IS NULL OR p_kind = 'trip' THEN
    FOR rec IN
      DELETE FROM kcn_survey_trips tr
      WHERE tr.deleted_at IS NOT NULL AND (CASE WHEN p_id IS NULL THEN tr.deleted_at < cutoff ELSE tr.id = p_id END)
      RETURNING tr.id
    LOOP
      item_kind := 'trip'; item_id := rec.id; file_path := NULL;
      RETURN NEXT;
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION kcn_survey_purge_archive(integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kcn_survey_purge_archive(integer, text, uuid) TO anon, authenticated;

-- ── 4. Lịch sử dữ liệu: riêng bảng sao ──────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_stars';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_stars FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (chạy tay nếu cần bỏ) ──────────────────────────────────────────
-- DROP FUNCTION IF EXISTS kcn_survey_purge_archive(integer, text, uuid);
-- DROP POLICY IF EXISTS kcn_survey_delete_purged_anon ON storage.objects;
-- DROP POLICY IF EXISTS kcn_survey_delete_purged_authenticated ON storage.objects;
-- DROP TABLE IF EXISTS kcn_survey_purged_files;
-- DROP TABLE IF EXISTS kcn_survey_stars;
