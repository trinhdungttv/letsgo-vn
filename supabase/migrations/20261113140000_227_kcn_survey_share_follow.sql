-- ============================================================================
-- 227 — Chia sẻ Khảo sát KCN: tuỳ chọn "Tự cập nhật khảo sát mới" hoặc "Chốt dữ liệu đến hôm nay"
-- ----------------------------------------------------------------------------
-- Trước đây link chỉ gồm đúng danh sách KCN lúc tạo → KCN khảo sát sau (vd KCN Phú Mỹ, KCN Nhơn Trạch) không hiện
-- trên link đã gửi. Nay mỗi link có 1 trong 2 chế độ:
--   • Tự cập nhật (data_until = NULL)  — người xem luôn thấy khảo sát mới của KCN đã chọn; tỉnh nào chọn CẢ TỈNH thì
--                                       KCN mới của tỉnh đó cũng tự vào (follow_provinces); chọn tất cả = '*' = mọi KCN.
--   • Chốt đến hôm nay (data_until = lúc tạo link) — chỉ thấy chuyến / ảnh / nhà trọ ghi nhận đến mốc đó.
-- Người tạo / admin đổi được chế độ + KCN + nhà trọ của link đã gửi (hàm mới survey_share_update_scope) — link và mã
-- 4 số giữ nguyên, người nhận chỉ cần tải lại trang.
--
--   follow_provinces  khoá tỉnh y hệt provinceKey() trong src/lib/kcnSurvey/province.ts ('' = KCN chưa ghi tỉnh, '*' = mọi KCN)
--   data_until        mốc chốt dữ liệu; NULL = tự cập nhật
--
-- Link cũ: follow_provinces = '{}', data_until = NULL → chạy y như trước (khảo sát mới của KCN đã chọn vẫn hiện,
-- KCN mới không tự vào) cho tới khi người tạo bấm "Sửa phạm vi".
--
-- Đổi survey_share_create (thêm 2 tham số) → XOÁ bản 6 và 8 tham số cũ rồi tạo bản mới (tránh PostgREST báo 2 bản trùng).
-- Thay survey_share_list, survey_share_open, survey_share_tracks (cùng phạm vi + mốc chốt).
--
-- ĐIỀU KIỆN: đã chạy 209, 210, 211, 221, 222 — đều ĐÃ CHẠY (222 kiểm qua REST 13/11).
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 2 cột (mặc định giữ cách chạy cũ) + thay hàm. Chạy lại nhiều lần vẫn an toàn.
-- Rollback: xem cuối file.
-- ============================================================================
SET search_path = public, extensions;

ALTER TABLE kcn_survey_shares ADD COLUMN IF NOT EXISTS follow_provinces text[] NOT NULL DEFAULT '{}';
ALTER TABLE kcn_survey_shares ADD COLUMN IF NOT EXISTS data_until       timestamptz;

-- ═════════════════════════ Khoá tỉnh (giống hệt province.ts) ═════════════════════════
-- fold(): bỏ dấu, đ → d, chữ thường, ký tự lạ → khoảng trắng, gộp khoảng trắng
CREATE OR REPLACE FUNCTION ks_fold(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $$
  SELECT btrim(regexp_replace(regexp_replace(
           lower(translate(regexp_replace(normalize(coalesce(p, ''), NFD), '[̀-ͯ]', '', 'g'), 'đĐ', 'dd')),
           '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- "Nhơn Trạch, TP. Đồng Nai" → 'dong nai'; các cách viết TP.HCM → 'ho chi minh'; chưa ghi → ''
CREATE OR REPLACE FUNCTION ks_province_key(p_location text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, extensions
AS $$
DECLARE
  v_raw text;
  v_f text;
  v_bare text;
  v_pre text;
  v_words text[];
  v_label text;
  v_hcm text[] := ARRAY['ho chi minh', 'hcm', 'tphcm', 'tp hcm', 'sai gon', 'saigon'];
BEGIN
  -- đoạn cuối sau dấu phẩy, bỏ đoạn rỗng
  SELECT x INTO v_raw FROM (
    SELECT regexp_replace(t.x, '^\s+|\s+$', '', 'g') AS x, t.ord
    FROM unnest(string_to_array(normalize(coalesce(p_location, ''), NFC), ',')) WITH ORDINALITY AS t(x, ord)
  ) s WHERE s.x <> '' ORDER BY s.ord DESC LIMIT 1;
  v_f := ks_fold(v_raw);
  IF v_f = '' THEN RETURN ''; END IF;
  v_bare := regexp_replace(v_f, '^(thanh pho|tinh|tp|t) ', '');
  IF v_f = ANY (v_hcm) OR v_bare = ANY (v_hcm) THEN RETURN 'ho chi minh'; END IF;
  v_pre := substring(v_f FROM '^(?:thanh pho|tinh|tp|t) ');
  IF v_pre IS NULL THEN RETURN v_f; END IF;
  -- bỏ đúng số từ tiền tố trên chuỗi gốc ("TP. Đồng Nai" → "Đồng Nai")
  v_words := regexp_split_to_array(regexp_replace(replace(v_raw, '.', ' '), '^\s+|\s+$', '', 'g'), '\s+');
  v_label := array_to_string(v_words[array_length(string_to_array(btrim(v_pre), ' '), 1) + 1 :], ' ');
  IF coalesce(v_label, '') = '' THEN v_label := v_raw; END IF;
  RETURN ks_fold(v_label);
END $$;

-- KCN mà link được xem: KCN đã chọn + (khi tự cập nhật) mọi KCN thuộc tỉnh đang theo dõi / mọi KCN nếu có '*'
CREATE OR REPLACE FUNCTION ks_share_scope(p_zone_ids uuid[], p_follow text[], p_until timestamptz) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_until IS NOT NULL OR coalesce(cardinality(p_follow), 0) = 0 THEN coalesce(p_zone_ids, '{}'::uuid[])
    ELSE ARRAY(
      SELECT DISTINCT u.id FROM (
        SELECT unnest(coalesce(p_zone_ids, '{}'::uuid[])) AS id
        UNION
        SELECT z.id FROM market_zones z WHERE '*' = ANY (p_follow) OR ks_province_key(z.location) = ANY (p_follow)
      ) u WHERE u.id IS NOT NULL)
  END
$$;

-- Làm sạch danh sách tỉnh theo dõi do app gửi lên
CREATE OR REPLACE FUNCTION ks_clean_follow(p text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $$
  SELECT coalesce(ARRAY(SELECT DISTINCT left(x, 80) FROM unnest(coalesce(p, '{}'::text[])) x WHERE x IS NOT NULL LIMIT 100), '{}'::text[])
$$;

REVOKE ALL ON FUNCTION ks_fold(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ks_province_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ks_share_scope(uuid[], text[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ks_clean_follow(text[]) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════ Tạo link (thêm chế độ) ═════════════════════════
DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int);
DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean);
CREATE OR REPLACE FUNCTION survey_share_create(
  p_token text, p_label text, p_zone_ids uuid[], p_provinces text[], p_pin text, p_days int DEFAULT NULL,
  p_include_lodgings boolean DEFAULT false, p_show_landlord boolean DEFAULT false,
  p_follow_provinces text[] DEFAULT NULL, p_freeze boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  v_code text;
  v_exp timestamptz;
  v_until timestamptz;
  v_id uuid;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Mã bảo mật phải gồm đúng 4 chữ số'; END IF;
  IF p_zone_ids IS NULL OR coalesce(array_length(p_zone_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Chọn ít nhất 1 KCN để chia sẻ'; END IF;
  IF array_length(p_zone_ids, 1) > 300 THEN RAISE EXCEPTION 'Chọn tối đa 300 KCN cho 1 link'; END IF;
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > 365) THEN RAISE EXCEPTION 'Thời hạn từ 1 đến 365 ngày'; END IF;
  v_exp := CASE WHEN p_days IS NOT NULL THEN now() + make_interval(days => p_days) END;
  v_until := CASE WHEN coalesce(p_freeze, false) THEN now() END;
  v_code := ks_gen_code();
  INSERT INTO kcn_survey_shares (code, label, pin_hash, zone_ids, provinces, expires_at, created_by, created_by_name,
                                 include_lodgings, show_landlord, follow_provinces, data_until)
  VALUES (v_code, left(coalesce(p_label, ''), 120), crypt(p_pin, gen_salt('bf')), p_zone_ids,
          coalesce(p_provinces, '{}'), v_exp, u.user_id, u.full_name,
          coalesce(p_include_lodgings, false), coalesce(p_include_lodgings, false) AND coalesce(p_show_landlord, false),
          CASE WHEN v_until IS NULL THEN ks_clean_follow(p_follow_provinces) ELSE '{}'::text[] END, v_until)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'expires_at', v_exp, 'data_until', v_until);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean, text[], boolean) TO anon, authenticated;

-- ═════════════════════════ Sửa phạm vi link đã gửi (link + mã giữ nguyên) ═════════════════════════
CREATE OR REPLACE FUNCTION survey_share_update_scope(
  p_token text, p_id uuid, p_label text, p_zone_ids uuid[], p_provinces text[],
  p_follow_provinces text[] DEFAULT NULL, p_freeze boolean DEFAULT false,
  p_include_lodgings boolean DEFAULT false, p_show_landlord boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  s kcn_survey_shares%ROWTYPE;
  v_until timestamptz;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  SELECT * INTO s FROM kcn_survey_shares WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link không còn tồn tại'; END IF;
  IF u.role <> 'admin' AND s.created_by IS DISTINCT FROM u.user_id THEN RAISE EXCEPTION 'Chỉ người tạo link hoặc admin được sửa'; END IF;
  IF p_zone_ids IS NULL OR coalesce(array_length(p_zone_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Chọn ít nhất 1 KCN để chia sẻ'; END IF;
  IF array_length(p_zone_ids, 1) > 300 THEN RAISE EXCEPTION 'Chọn tối đa 300 KCN cho 1 link'; END IF;
  -- đang chốt thì giữ mốc cũ; mới chuyển sang chốt thì chốt tại lúc này
  v_until := CASE WHEN coalesce(p_freeze, false) THEN coalesce(s.data_until, now()) END;
  UPDATE kcn_survey_shares SET
    label = left(coalesce(p_label, ''), 120),
    zone_ids = p_zone_ids,
    provinces = coalesce(p_provinces, '{}'),
    follow_provinces = CASE WHEN v_until IS NULL THEN ks_clean_follow(p_follow_provinces) ELSE '{}'::text[] END,
    data_until = v_until,
    include_lodgings = coalesce(p_include_lodgings, false),
    show_landlord = coalesce(p_include_lodgings, false) AND coalesce(p_show_landlord, false)
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'code', s.code, 'data_until', v_until);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_update_scope(text, uuid, text, uuid[], text[], text[], boolean, boolean, boolean) TO anon, authenticated;

-- ═════════════════════════ Danh sách link (trả thêm chế độ) ═════════════════════════
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
      'follow_provinces', s.follow_provinces, 'data_until', s.data_until) ORDER BY s.created_at DESC)
    FROM kcn_survey_shares s
    WHERE u.role = 'admin' OR s.created_by IS NOT DISTINCT FROM u.user_id
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_list(text) TO anon, authenticated;

-- ═════════════════════════ Trang người xem ═════════════════════════
-- Giữ nguyên phần làm sạch của 222; chỉ đổi phạm vi KCN (ks_share_scope) + mốc chốt + danh sách KCN trả về
-- (KCN đã chọn + KCN có dữ liệu trong phạm vi — không đổ cả danh mục KCN khi theo dõi cả tỉnh).
CREATE OR REPLACE FUNCTION survey_share_open(p_code text, p_pin text, p_count boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  s kcn_survey_shares%ROWTYPE;
  v_scope uuid[];
  v_until timestamptz;
  v_zones jsonb;
  v_trips jsonb;
  v_photos jsonb;
  v_lodgings jsonb;
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

  SELECT coalesce(jsonb_agg(t ORDER BY t.started_at DESC), '[]'::jsonb) INTO v_trips FROM (
    SELECT id, zone_id, zone_name, title, started_at, ended_at, distance_m, road_coverage,
           jsonb_array_length(coalesce(passed, '[]'::jsonb)) AS passed_count
    FROM kcn_survey_trips
    WHERE deleted_at IS NULL AND zone_id = ANY (v_scope) AND (v_until IS NULL OR started_at <= v_until)
    ORDER BY started_at DESC LIMIT 300
  ) t;

  SELECT coalesce(jsonb_agg(p ORDER BY p.taken_at DESC), '[]'::jsonb) INTO v_photos FROM (
    SELECT id, trip_id, zone_id, zone_name, lat, lng, taken_at, url, thumb_url, width, height,
           company_name, positions, headcount, wage_text, note, annotations, survey_kind, verified_at
    FROM kcn_survey_photos
    WHERE deleted_at IS NULL AND zone_id = ANY (v_scope) AND (v_until IS NULL OR taken_at <= v_until)
    ORDER BY taken_at DESC LIMIT 800
  ) p;

  IF s.include_lodgings THEN
    SELECT coalesce(jsonb_agg(l ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_lodgings FROM (
      SELECT x.id, x.zone_id, x.zone_name, x.trip_id, x.name, x.address,
             CASE WHEN s.show_landlord THEN x.landlord_name ELSE '' END AS landlord_name,
             CASE WHEN s.show_landlord THEN x.landlord_phone ELSE '' END AS landlord_phone,
             x.total_rooms, x.vacant_rooms, x.rent_min, x.rent_max, x.facilities, x.note, x.lat, x.lng, x.created_at,
             -- ảnh: bỏ đường dẫn file trong kho
             (SELECT coalesce(jsonb_agg(ph.v - 'storage_path' ORDER BY ph.ord), '[]'::jsonb)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x.photos) = 'array' THEN x.photos ELSE '[]'::jsonb END)
                     WITH ORDINALITY AS ph(v, ord)) AS photos,
             -- khoảng cách: bỏ mã nội bộ + nhãn quan hệ của công ty, chỉ giữ nhãn "KCN"
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

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'location', z.location) ORDER BY z.name), '[]'::jsonb)
    INTO v_zones FROM market_zones z
   WHERE z.id = ANY (s.zone_ids)
      OR z.id IN (SELECT (e->>'zone_id')::uuid
                    FROM jsonb_array_elements(v_trips || v_photos || coalesce(v_lodgings, '[]'::jsonb)) e
                   WHERE coalesce(e->>'zone_id', '') <> '');

  RETURN jsonb_build_object('ok', true, 'label', s.label, 'provinces', s.provinces, 'expires_at', s.expires_at,
    'zones', v_zones, 'trips', v_trips, 'photos', v_photos,
    'lodgings', v_lodgings, 'show_landlord', s.show_landlord,
    'data_until', v_until, 'follows', cardinality(s.follow_provinces) > 0 AND v_until IS NULL);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_open(text, text, boolean) TO anon, authenticated;

-- ═════════════════════════ Vết GPS (cùng phạm vi + mốc chốt) ═════════════════════════
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
-- 1) 2 cột mới (mong đợi: 2 dòng)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'kcn_survey_shares' AND column_name IN ('follow_provinces', 'data_until');
-- 2) Khoá tỉnh của các KCN (mong đợi: 'binh duong', 'dong nai', 'ho chi minh'… ; KCN chưa ghi tỉnh = '')
-- SELECT ks_province_key(location) AS tinh, count(*) FROM market_zones GROUP BY 1 ORDER BY 2 DESC;

-- ============================================================================
-- Rollback (chỉ khi cần; link đã tạo vẫn còn, mất phần tự cập nhật / chốt ngày):
--   DROP FUNCTION IF EXISTS survey_share_update_scope(text, uuid, text, uuid[], text[], text[], boolean, boolean, boolean);
--   DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean, text[], boolean);
--   (rồi chạy lại toàn bộ file 222 để có lại survey_share_create / list / open, và file 211 cho survey_share_tracks)
--   DROP FUNCTION IF EXISTS ks_share_scope(uuid[], text[], timestamptz);
--   DROP FUNCTION IF EXISTS ks_clean_follow(text[]);
--   DROP FUNCTION IF EXISTS ks_province_key(text);
--   DROP FUNCTION IF EXISTS ks_fold(text);
--   ALTER TABLE kcn_survey_shares DROP COLUMN IF EXISTS data_until;
--   ALTER TABLE kcn_survey_shares DROP COLUMN IF EXISTS follow_provinces;
-- ============================================================================
