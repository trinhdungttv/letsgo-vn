-- ============================================================================
-- 228 — Chia sẻ Khảo sát KCN: chọn HẠNG MỤC cho người xem (Ảnh chỉ tiêu / Chuyến khảo sát / Nhà trọ / Ảnh 360°)
-- ----------------------------------------------------------------------------
-- Thêm cột kcn_survey_shares.sections (text[]): các hạng mục link được xem.
--   NULL = link cũ (trước 228): xem Ảnh chỉ tiêu + Chuyến, và Nhà trọ nếu include_lodgings — giữ nguyên hành vi cũ.
--   Giá trị hợp lệ: 'photos', 'trips', 'lodgings', 'panos'.
-- Hạng mục không chọn thì SERVER không trả dữ liệu đó (không chỉ ẩn ở giao diện).
-- 'lodgings' đồng bộ với include_lodgings (migration 222) nên "Sửa phạm vi" và danh sách cũ vẫn chạy.
-- Ảnh 360 (map_panoramas): chỉ trả ảnh thuộc KCN trong phạm vi link + trong mốc chốt số liệu; không trả người tạo / đường dẫn kho.
--
-- ĐIỀU KIỆN: đã chạy 209, 220, 222, 227.
-- Có mất dữ liệu hiện có không? KHÔNG — thêm 1 cột + thay 4 hàm. Link đã gửi giữ nguyên link, mã, phạm vi. Chạy lại an toàn.
-- Rollback: xem cuối file.
-- ============================================================================
SET search_path = public, extensions;

ALTER TABLE kcn_survey_shares ADD COLUMN IF NOT EXISTS sections text[];

-- Làm sạch danh sách hạng mục do app gửi lên (NULL giữ NULL)
CREATE OR REPLACE FUNCTION ks_clean_sections(p text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $$
  SELECT CASE WHEN p IS NULL THEN NULL
    ELSE ARRAY(SELECT DISTINCT x FROM unnest(p) x WHERE x IN ('photos', 'trips', 'lodgings', 'panos') ORDER BY x) END
$$;
REVOKE ALL ON FUNCTION ks_clean_sections(text[]) FROM PUBLIC, anon, authenticated;

-- Hạng mục thực sự của 1 link (link cũ → suy từ include_lodgings)
CREATE OR REPLACE FUNCTION ks_share_sections(p_sections text[], p_lodgings boolean) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $$
  SELECT coalesce(p_sections, CASE WHEN coalesce(p_lodgings, false) THEN ARRAY['photos', 'trips', 'lodgings'] ELSE ARRAY['photos', 'trips'] END)
$$;
REVOKE ALL ON FUNCTION ks_share_sections(text[], boolean) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════ Tạo link ═════════════════════════
DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean, text[], boolean);
CREATE OR REPLACE FUNCTION survey_share_create(
  p_token text, p_label text, p_zone_ids uuid[], p_provinces text[], p_pin text, p_days int DEFAULT NULL,
  p_include_lodgings boolean DEFAULT false, p_show_landlord boolean DEFAULT false,
  p_follow_provinces text[] DEFAULT NULL, p_freeze boolean DEFAULT false,
  p_sections text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  v_code text;
  v_exp timestamptz;
  v_until timestamptz;
  v_id uuid;
  v_sec text[];
  v_lod boolean;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Mã bảo mật phải gồm đúng 4 chữ số'; END IF;
  IF p_zone_ids IS NULL OR coalesce(array_length(p_zone_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Chọn ít nhất 1 KCN để chia sẻ'; END IF;
  IF array_length(p_zone_ids, 1) > 300 THEN RAISE EXCEPTION 'Chọn tối đa 300 KCN cho 1 link'; END IF;
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > 365) THEN RAISE EXCEPTION 'Thời hạn từ 1 đến 365 ngày'; END IF;
  v_sec := ks_clean_sections(p_sections);
  IF v_sec IS NOT NULL AND coalesce(cardinality(v_sec), 0) = 0 THEN RAISE EXCEPTION 'Chọn ít nhất 1 hạng mục cho người xem'; END IF;
  v_lod := CASE WHEN v_sec IS NULL THEN coalesce(p_include_lodgings, false) ELSE 'lodgings' = ANY (v_sec) END;
  v_exp := CASE WHEN p_days IS NOT NULL THEN now() + make_interval(days => p_days) END;
  v_until := CASE WHEN coalesce(p_freeze, false) THEN now() END;
  v_code := ks_gen_code();
  INSERT INTO kcn_survey_shares (code, label, pin_hash, zone_ids, provinces, expires_at, created_by, created_by_name,
                                 include_lodgings, show_landlord, follow_provinces, data_until, sections)
  VALUES (v_code, left(coalesce(p_label, ''), 120), crypt(p_pin, gen_salt('bf')), p_zone_ids,
          coalesce(p_provinces, '{}'), v_exp, u.user_id, u.full_name,
          v_lod, v_lod AND coalesce(p_show_landlord, false),
          CASE WHEN v_until IS NULL THEN ks_clean_follow(p_follow_provinces) ELSE '{}'::text[] END, v_until, v_sec)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'expires_at', v_exp, 'data_until', v_until);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean, text[], boolean, text[]) TO anon, authenticated;

-- ═════════════════════════ Sửa phạm vi (link + mã giữ nguyên) ═════════════════════════
DROP FUNCTION IF EXISTS survey_share_update_scope(text, uuid, text, uuid[], text[], text[], boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION survey_share_update_scope(
  p_token text, p_id uuid, p_label text, p_zone_ids uuid[], p_provinces text[],
  p_follow_provinces text[] DEFAULT NULL, p_freeze boolean DEFAULT false,
  p_include_lodgings boolean DEFAULT false, p_show_landlord boolean DEFAULT false,
  p_sections text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  s kcn_survey_shares%ROWTYPE;
  v_until timestamptz;
  v_sec text[];
  v_lod boolean;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  SELECT * INTO s FROM kcn_survey_shares WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link không còn tồn tại'; END IF;
  IF u.role <> 'admin' AND s.created_by IS DISTINCT FROM u.user_id THEN RAISE EXCEPTION 'Chỉ người tạo link hoặc admin được sửa'; END IF;
  IF p_zone_ids IS NULL OR coalesce(array_length(p_zone_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Chọn ít nhất 1 KCN để chia sẻ'; END IF;
  IF array_length(p_zone_ids, 1) > 300 THEN RAISE EXCEPTION 'Chọn tối đa 300 KCN cho 1 link'; END IF;
  v_sec := ks_clean_sections(p_sections);
  IF v_sec IS NOT NULL AND coalesce(cardinality(v_sec), 0) = 0 THEN RAISE EXCEPTION 'Chọn ít nhất 1 hạng mục cho người xem'; END IF;
  v_lod := CASE WHEN v_sec IS NULL THEN coalesce(p_include_lodgings, false) ELSE 'lodgings' = ANY (v_sec) END;
  v_until := CASE WHEN coalesce(p_freeze, false) THEN coalesce(s.data_until, now()) END;
  UPDATE kcn_survey_shares SET
    label = left(coalesce(p_label, ''), 120),
    zone_ids = p_zone_ids,
    provinces = coalesce(p_provinces, '{}'),
    follow_provinces = CASE WHEN v_until IS NULL THEN ks_clean_follow(p_follow_provinces) ELSE '{}'::text[] END,
    data_until = v_until,
    include_lodgings = v_lod,
    show_landlord = v_lod AND coalesce(p_show_landlord, false),
    sections = coalesce(v_sec, sections)
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'code', s.code, 'data_until', v_until);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_update_scope(text, uuid, text, uuid[], text[], text[], boolean, boolean, boolean, text[]) TO anon, authenticated;

-- ═════════════════════════ Danh sách link (trả thêm hạng mục) ═════════════════════════
CREATE OR REPLACE FUNCTION survey_share_list(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'label', s.label, 'zone_ids', s.zone_ids, 'provinces', s.provinces,
      'expires_at', s.expires_at, 'revoked', s.revoked, 'open_count', s.open_count,
      'last_opened_at', s.last_opened_at, 'locked_until', s.locked_until,
      'created_by_name', s.created_by_name, 'created_at', s.created_at,
      'include_lodgings', s.include_lodgings, 'show_landlord', s.show_landlord,
      'follow_provinces', s.follow_provinces, 'data_until', s.data_until,
      'sections', ks_share_sections(s.sections, s.include_lodgings)) ORDER BY s.created_at DESC)
    FROM kcn_survey_shares s
    WHERE u.role = 'admin' OR s.created_by IS NOT DISTINCT FROM u.user_id
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_list(text) TO anon, authenticated;

-- ═════════════════════════ Trang người xem (chỉ trả hạng mục được chọn) ═════════════════════════
CREATE OR REPLACE FUNCTION survey_share_open(p_code text, p_pin text, p_count boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  s kcn_survey_shares%ROWTYPE;
  v_scope uuid[];
  v_until timestamptz;
  v_sec text[];
  v_zones jsonb;
  v_trips jsonb := '[]'::jsonb;
  v_photos jsonb := '[]'::jsonb;
  v_lodgings jsonb;
  v_panos jsonb;
BEGIN
  chk := ks_share_check(p_code, p_pin);
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  SELECT * INTO s FROM kcn_survey_shares WHERE id = (chk->>'share_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF p_count THEN
    UPDATE kcn_survey_shares SET open_count = open_count + 1, last_opened_at = now() WHERE id = s.id;
  END IF;
  v_scope := ks_share_scope(s.zone_ids, s.follow_provinces, s.data_until);
  v_until := s.data_until;
  v_sec := ks_share_sections(s.sections, s.include_lodgings);

  IF 'trips' = ANY (v_sec) THEN
    SELECT coalesce(jsonb_agg(t ORDER BY t.started_at DESC), '[]'::jsonb) INTO v_trips FROM (
      SELECT id, zone_id, zone_name, title, started_at, ended_at, distance_m, road_coverage,
             jsonb_array_length(coalesce(passed, '[]'::jsonb)) AS passed_count
      FROM kcn_survey_trips
      WHERE deleted_at IS NULL AND zone_id = ANY (v_scope) AND (v_until IS NULL OR started_at <= v_until)
      ORDER BY started_at DESC LIMIT 300
    ) t;
  END IF;

  IF 'photos' = ANY (v_sec) THEN
    SELECT coalesce(jsonb_agg(p ORDER BY p.taken_at DESC), '[]'::jsonb) INTO v_photos FROM (
      SELECT id, trip_id, zone_id, zone_name, lat, lng, taken_at, url, thumb_url, width, height,
             company_name, positions, headcount, wage_text, note, annotations, survey_kind, verified_at
      FROM kcn_survey_photos
      WHERE deleted_at IS NULL AND zone_id = ANY (v_scope) AND (v_until IS NULL OR taken_at <= v_until)
      ORDER BY taken_at DESC LIMIT 800
    ) p;
  END IF;

  IF 'lodgings' = ANY (v_sec) THEN
    SELECT coalesce(jsonb_agg(l ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_lodgings FROM (
      SELECT x.id, x.zone_id, x.zone_name, x.trip_id, x.name, x.address,
             CASE WHEN s.show_landlord THEN x.landlord_name ELSE '' END AS landlord_name,
             CASE WHEN s.show_landlord THEN x.landlord_phone ELSE '' END AS landlord_phone,
             x.total_rooms, x.vacant_rooms, x.rent_min, x.rent_max, x.facilities, x.note, x.lat, x.lng, x.created_at,
             (SELECT coalesce(jsonb_agg(ph.v - 'storage_path' ORDER BY ph.ord), '[]'::jsonb)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x.photos) = 'array' THEN x.photos ELSE '[]'::jsonb END)
                     WITH ORDINALITY AS ph(v, ord)) AS photos,
             (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'key', 'r' || r.ord, 'name', r.v->'name',
                        'kind', CASE WHEN r.v->>'kind' = 'KCN' THEN 'KCN' ELSE '' END,
                        'color', CASE WHEN r.v->>'kind' = 'KCN' THEN r.v->'color' ELSE to_jsonb('#64748B'::text) END,
                        'lat', r.v->'lat', 'lng', r.v->'lng', 'straight_m', r.v->'straight_m',
                        'moto_km', r.v->'moto_km', 'moto_min', r.v->'moto_min',
                        'walk_km', r.v->'walk_km', 'walk_min', r.v->'walk_min', 'engine', r.v->'engine'
                      ) ORDER BY r.ord), '[]'::jsonb)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x.routes) = 'array' THEN x.routes ELSE '[]'::jsonb END)
                     WITH ORDINALITY AS r(v, ord)) AS routes
      FROM kcn_survey_lodgings x
      WHERE x.deleted_at IS NULL AND x.zone_id = ANY (v_scope) AND (v_until IS NULL OR x.created_at <= v_until)
      ORDER BY x.created_at DESC LIMIT 500
    ) l;
  END IF;

  -- Ảnh 360° (bảng có từ migration 220): bỏ người tạo, đường dẫn kho, link nguồn
  IF 'panos' = ANY (v_sec) AND to_regclass('public.map_panoramas') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(p ORDER BY p.created_at DESC), '[]'::jsonb) FROM (
        SELECT id, title, note, pano_url, google_url, width, height, haov, vaov, voffset, lat, lng, heading,
               camera_height, view, annotations, taken_at, trip_id, zone_id, zone_name, created_at
        FROM map_panoramas
        WHERE deleted_at IS NULL AND zone_id = ANY ($1) AND ($2 IS NULL OR created_at <= $2)
        ORDER BY created_at DESC LIMIT 200
      ) p
    $q$ INTO v_panos USING v_scope, v_until;
  ELSIF 'panos' = ANY (v_sec) THEN
    v_panos := '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'location', z.location) ORDER BY z.name), '[]'::jsonb)
    INTO v_zones FROM market_zones z
   WHERE z.id = ANY (s.zone_ids)
      OR z.id IN (SELECT (e->>'zone_id')::uuid
                    FROM jsonb_array_elements(v_trips || v_photos || coalesce(v_lodgings, '[]'::jsonb) || coalesce(v_panos, '[]'::jsonb)) e
                   WHERE coalesce(e->>'zone_id', '') <> '');

  RETURN jsonb_build_object('ok', true, 'label', s.label, 'provinces', s.provinces, 'expires_at', s.expires_at,
    'zones', v_zones, 'trips', v_trips, 'photos', v_photos,
    'lodgings', v_lodgings, 'show_landlord', s.show_landlord,
    'panos', v_panos, 'sections', to_jsonb(v_sec),
    'data_until', v_until, 'follows', cardinality(s.follow_provinces) > 0 AND v_until IS NULL);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_open(text, text, boolean) TO anon, authenticated;

-- Vết GPS đi theo hạng mục "Chuyến khảo sát": link không chọn Chuyến thì không trả vết
CREATE OR REPLACE FUNCTION survey_share_tracks(p_code text, p_pin text, p_trip_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  s kcn_survey_shares%ROWTYPE;
  v_scope uuid[];
  v_ids uuid[];
BEGIN
  chk := ks_share_check(p_code, p_pin);
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  SELECT * INTO s FROM kcn_survey_shares WHERE id = (chk->>'share_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT ('trips' = ANY (ks_share_sections(s.sections, s.include_lodgings))) THEN
    RETURN jsonb_build_object('ok', true, 'chunks', '[]'::jsonb);
  END IF;
  v_scope := ks_share_scope(s.zone_ids, s.follow_provinces, s.data_until);

  SELECT coalesce(array_agg(t.id), '{}') INTO v_ids FROM (
    SELECT id FROM kcn_survey_trips
    WHERE id = ANY (coalesce(p_trip_ids, '{}')) AND deleted_at IS NULL AND zone_id = ANY (v_scope)
      AND (s.data_until IS NULL OR started_at <= s.data_until)
    LIMIT 60
  ) t;

  RETURN jsonb_build_object('ok', true, 'chunks', coalesce((
    SELECT jsonb_agg(jsonb_build_object('trip_id', c.trip_id, 'seq', c.seq, 'segment', c.segment, 'points', c.points)
                     ORDER BY c.trip_id, c.seq)
    FROM kcn_survey_track_chunks c WHERE c.trip_id = ANY (v_ids)
  ), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION survey_share_tracks(text, text, uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy ──
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'kcn_survey_shares' AND column_name = 'sections';  -- 1 dòng
--
-- ── Rollback (cần chạy lại 227 để có lại các hàm cũ) ──
--   ALTER TABLE kcn_survey_shares DROP COLUMN IF EXISTS sections;
--   DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean, text[], boolean, text[]);
--   DROP FUNCTION IF EXISTS survey_share_update_scope(text, uuid, text, uuid[], text[], text[], boolean, boolean, boolean, text[]);
--   DROP FUNCTION IF EXISTS ks_share_sections(text[], boolean);
--   DROP FUNCTION IF EXISTS ks_clean_sections(text[]);
