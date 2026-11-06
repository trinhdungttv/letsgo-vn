-- ============================================================================
-- 211 — Trang chia sẻ Khảo sát: xem BẢN ĐỒ lộ trình giống trong app (vết GPS các chuyến + ảnh / công ty trên bản đồ)
-- ----------------------------------------------------------------------------
-- Hàm mới survey_share_tracks(mã link, PIN, danh sách chuyến) trả vết GPS của các chuyến được chọn — CHỈ chuyến thuộc
-- KCN mà link cho phép (kcn_survey_trips.zone_id nằm trong zone_ids), chưa xoá, tối đa 60 chuyến / lần gọi.
-- Kiểm tra mã + PIN bằng ks_share_check (sai 5 lần khoá tạm) như survey_share_open. Vết tách riêng khỏi survey_share_open
-- vì nặng (nhiều điểm) — trang chỉ tải vết của các chuyến đang hiện trên bản đồ.
--
-- ĐIỀU KIỆN: đã chạy 209. Không đụng dữ liệu hiện có (chỉ thêm hàm). Chạy lại an toàn.
-- Rollback: DROP FUNCTION IF EXISTS survey_share_tracks(text, text, uuid[]);
-- ============================================================================
SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION survey_share_tracks(p_code text, p_pin text, p_trip_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  s kcn_survey_shares%ROWTYPE;
  v_ids uuid[];
BEGIN
  chk := ks_share_check(p_code, p_pin);
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  SELECT * INTO s FROM kcn_survey_shares WHERE id = (chk->>'share_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  SELECT coalesce(array_agg(t.id), '{}') INTO v_ids FROM (
    SELECT id FROM kcn_survey_trips
    WHERE id = ANY (coalesce(p_trip_ids, '{}')) AND deleted_at IS NULL AND zone_id = ANY (s.zone_ids)
    LIMIT 60
  ) t;

  RETURN jsonb_build_object('ok', true, 'chunks', coalesce((
    SELECT jsonb_agg(jsonb_build_object('trip_id', c.trip_id, 'seq', c.seq, 'segment', c.segment, 'points', c.points)
                     ORDER BY c.trip_id, c.seq)
    FROM kcn_survey_track_chunks c WHERE c.trip_id = ANY (v_ids)
  ), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION survey_share_tracks(text, text, uuid[]) TO anon, authenticated;
