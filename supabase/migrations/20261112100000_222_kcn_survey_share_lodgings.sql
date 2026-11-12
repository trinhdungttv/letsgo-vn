-- ============================================================================
-- 222 — Chia sẻ Khảo sát KCN: cho chia sẻ cả NHÀ TRỌ (Thị trường → Khảo sát KCN → nút "Chia sẻ")
-- ----------------------------------------------------------------------------
-- Khi tạo link, người gửi chọn thêm:
--   • include_lodgings  kèm nhà trọ đã khảo sát trong các KCN được chọn (ảnh, số phòng, giá, tiện ích, ghi chú,
--                       khoảng cách xe máy / đi bộ tới công ty gần đó)
--   • show_landlord     có hiện tên + SĐT chủ nhà không (mặc định KHÔNG — người xem chỉ thấy "liên hệ Let's Go VN")
-- Link cũ giữ nguyên như trước (2 cột mới mặc định false → không lộ thêm gì).
--
-- Trang người xem KHÔNG nhận: người ghi nhà trọ, đường dẫn file ảnh trong kho (storage_path), mã nội bộ của công ty,
-- và nhãn quan hệ của công ty trong khoảng cách ("Đang hợp tác", "Trong Pipeline"… → để trống; chỉ giữ "KCN").
--
-- Đổi hàm survey_share_create (thêm 2 tham số) → XOÁ bản 6 tham số cũ rồi tạo bản mới (để PostgREST không bị 2 bản trùng tên).
-- Thay survey_share_list (trả thêm 2 cờ) và survey_share_open (giữ nguyên phần của 210, thêm 'lodgings').
--
-- ĐIỀU KIỆN: đã chạy 209, 210 (ảnh online) và 221 (bảng nhà trọ) — đều ĐÃ CHẠY.
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 2 cột (mặc định false) + thay hàm. Chạy lại nhiều lần vẫn an toàn.
-- Rollback: xem cuối file.
-- ============================================================================
SET search_path = public, extensions;

ALTER TABLE kcn_survey_shares ADD COLUMN IF NOT EXISTS include_lodgings boolean NOT NULL DEFAULT false;
ALTER TABLE kcn_survey_shares ADD COLUMN IF NOT EXISTS show_landlord    boolean NOT NULL DEFAULT false;

-- ═════════════════════════ Tạo link (thêm 2 tham số) ═════════════════════════
DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int);
CREATE OR REPLACE FUNCTION survey_share_create(
  p_token text, p_label text, p_zone_ids uuid[], p_provinces text[], p_pin text, p_days int DEFAULT NULL,
  p_include_lodgings boolean DEFAULT false, p_show_landlord boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  v_code text;
  v_exp timestamptz;
  v_id uuid;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Mã bảo mật phải gồm đúng 4 chữ số'; END IF;
  IF p_zone_ids IS NULL OR coalesce(array_length(p_zone_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Chọn ít nhất 1 KCN để chia sẻ'; END IF;
  IF array_length(p_zone_ids, 1) > 300 THEN RAISE EXCEPTION 'Chọn tối đa 300 KCN cho 1 link'; END IF;
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > 365) THEN RAISE EXCEPTION 'Thời hạn từ 1 đến 365 ngày'; END IF;
  v_exp := CASE WHEN p_days IS NOT NULL THEN now() + make_interval(days => p_days) END;
  v_code := ks_gen_code();
  INSERT INTO kcn_survey_shares (code, label, pin_hash, zone_ids, provinces, expires_at, created_by, created_by_name,
                                 include_lodgings, show_landlord)
  VALUES (v_code, left(coalesce(p_label, ''), 120), crypt(p_pin, gen_salt('bf')), p_zone_ids,
          coalesce(p_provinces, '{}'), v_exp, u.user_id, u.full_name,
          coalesce(p_include_lodgings, false), coalesce(p_include_lodgings, false) AND coalesce(p_show_landlord, false))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'expires_at', v_exp);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean) TO anon, authenticated;

-- ═════════════════════════ Danh sách link (trả thêm 2 cờ) ═════════════════════════
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
      'include_lodgings', s.include_lodgings, 'show_landlord', s.show_landlord) ORDER BY s.created_at DESC)
    FROM kcn_survey_shares s
    WHERE u.role = 'admin' OR s.created_by IS NOT DISTINCT FROM u.user_id
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_list(text) TO anon, authenticated;

-- ═════════════════════════ Trang người xem (thêm nhà trọ) ═════════════════════════
-- Phần zones / trips / photos giữ y hệt bản của migration 210. 'lodgings' = NULL khi link không kèm nhà trọ.
CREATE OR REPLACE FUNCTION survey_share_open(p_code text, p_pin text, p_count boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  s kcn_survey_shares%ROWTYPE;
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
      WHERE x.deleted_at IS NULL AND x.zone_id = ANY (s.zone_ids)
      ORDER BY x.created_at DESC LIMIT 500
    ) l;
  END IF;

  RETURN jsonb_build_object('ok', true, 'label', s.label, 'provinces', s.provinces, 'expires_at', s.expires_at,
    'zones', v_zones, 'trips', v_trips, 'photos', v_photos,
    'lodgings', v_lodgings, 'show_landlord', s.show_landlord);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_open(text, text, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 2 dòng include_lodgings, show_landlord) ──
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'kcn_survey_shares' AND column_name IN ('include_lodgings', 'show_landlord');

-- ============================================================================
-- Rollback (chỉ khi cần; các link đã tạo vẫn còn, chỉ mất phần nhà trọ):
--   DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int, boolean, boolean);
--   (rồi chạy lại phần survey_share_create + survey_share_list của file 209 và survey_share_open của file 210)
--   ALTER TABLE kcn_survey_shares DROP COLUMN IF EXISTS show_landlord;
--   ALTER TABLE kcn_survey_shares DROP COLUMN IF EXISTS include_lodgings;
-- ============================================================================
