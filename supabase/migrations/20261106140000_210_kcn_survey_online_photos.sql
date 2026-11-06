-- ============================================================================
-- 210 — Khảo sát ONLINE (Thị trường → Khảo sát KCN → nút "Thêm ảnh online")
-- ----------------------------------------------------------------------------
-- Ngoài ảnh chụp ngoài thực địa (đi GPS), cho phép nhập ảnh tuyển dụng lấy trên mạng + vị trí Google Maps của công ty
-- (không đi trực tiếp). Hai loại phân biệt bằng 2 cột mới trên kcn_survey_photos:
--   survey_kind  'field' (mặc định = đi thực địa) | 'online' (tự thêm trên web, không có chuyến / vết GPS đi qua)
--   verified_at  thời điểm xác thực (đã tới tận nơi / kiểm tra lại); NULL = "Chưa xác thực".
--                Ảnh online mới thêm luôn NULL → hiện tag "Chưa xác thực". Ảnh thực địa không dùng cột này.
-- Cập nhật luôn hàm survey_share_open (migration 209) để trang chia sẻ cho người ngoài thấy được tag.
--
-- ĐIỀU KIỆN: đã chạy 190 và 209.
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ THÊM cột (ảnh cũ tự thành 'field') + thay hàm. Chạy lại an toàn.
-- Rollback: xem cuối file.
-- ============================================================================
SET search_path = public, extensions;

ALTER TABLE kcn_survey_photos ADD COLUMN IF NOT EXISTS survey_kind text NOT NULL DEFAULT 'field';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kcn_survey_photos_kind_chk') THEN
    ALTER TABLE kcn_survey_photos ADD CONSTRAINT kcn_survey_photos_kind_chk CHECK (survey_kind IN ('field', 'online'));
  END IF;
END $$;
ALTER TABLE kcn_survey_photos ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE INDEX IF NOT EXISTS kcn_survey_photos_kind_idx ON kcn_survey_photos (survey_kind) WHERE deleted_at IS NULL AND survey_kind <> 'field';

-- Trang chia sẻ: trả thêm survey_kind + verified_at
CREATE OR REPLACE FUNCTION survey_share_open(p_code text, p_pin text, p_count boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  s kcn_survey_shares%ROWTYPE;
  v_zones jsonb;
  v_trips jsonb;
  v_photos jsonb;
BEGIN
  chk := ks_share_check(p_code, p_pin);
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  SELECT * INTO s FROM kcn_survey_shares WHERE id = (chk->>'share_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF p_count THEN
    UPDATE kcn_survey_shares SET open_count = open_count + 1, last_opened_at = now() WHERE id = s.id;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'location', z.location) ORDER BY z.name), '[]'::jsonb)
    INTO v_zones FROM market_zones z WHERE z.id = ANY (s.zone_ids);

  SELECT coalesce(jsonb_agg(t ORDER BY t.started_at DESC), '[]'::jsonb) INTO v_trips FROM (
    SELECT id, zone_id, zone_name, title, started_at, ended_at, distance_m, road_coverage,
           jsonb_array_length(coalesce(passed, '[]'::jsonb)) AS passed_count
    FROM kcn_survey_trips
    WHERE deleted_at IS NULL AND zone_id = ANY (s.zone_ids)
    ORDER BY started_at DESC LIMIT 300
  ) t;

  SELECT coalesce(jsonb_agg(p ORDER BY p.taken_at DESC), '[]'::jsonb) INTO v_photos FROM (
    SELECT id, trip_id, zone_id, zone_name, lat, lng, taken_at, url, thumb_url, width, height,
           company_name, positions, headcount, wage_text, note, annotations, survey_kind, verified_at
    FROM kcn_survey_photos
    WHERE deleted_at IS NULL AND zone_id = ANY (s.zone_ids)
    ORDER BY taken_at DESC LIMIT 800
  ) p;

  RETURN jsonb_build_object('ok', true, 'label', s.label, 'provinces', s.provinces, 'expires_at', s.expires_at,
    'zones', v_zones, 'trips', v_trips, 'photos', v_photos);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_open(text, text, boolean) TO anon, authenticated;

-- ============================================================================
-- Rollback (chỉ khi cần; ảnh online sẽ thành ảnh thường nếu chỉ xoá cột):
--   DROP INDEX IF EXISTS kcn_survey_photos_kind_idx;
--   ALTER TABLE kcn_survey_photos DROP CONSTRAINT IF EXISTS kcn_survey_photos_kind_chk;
--   ALTER TABLE kcn_survey_photos DROP COLUMN IF EXISTS verified_at;
--   ALTER TABLE kcn_survey_photos DROP COLUMN IF EXISTS survey_kind;
--   (rồi chạy lại phần CREATE OR REPLACE survey_share_open của file 209)
-- ============================================================================
