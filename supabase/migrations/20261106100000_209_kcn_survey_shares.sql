-- ============================================================================
-- 209 — Chia sẻ Khảo sát KCN cho người ngoài (Thị trường → Khảo sát KCN → nút "Chia sẻ")
-- ----------------------------------------------------------------------------
-- Người ngoài (đối tác, khách…) mở LINK NGẮN + nhập MÃ 4 SỐ kiểu iPhone là xem được ảnh chỉ tiêu tuyển dụng
-- và các chuyến khảo sát — KHÔNG cần tài khoản, CHỈ XEM. Mỗi link do người gửi giới hạn:
--   • KCN nào (zone_ids)   • tỉnh nào (chỉ để hiển thị — app đã quy ra danh sách KCN lúc tạo link)
--   • thời hạn xem (expires_at; NULL = không hết hạn)
-- Link dạng  <tên miền>/#/ks/<6 ký tự>.  Nhiều link cùng lúc được (mỗi người nhận 1 link / 1 mã riêng, thu hồi riêng).
--
-- BẢO MẬT (giống Phương án giá — migration 157):
--   • bảng kcn_survey_shares KHÓA với anon / authenticated; mọi truy cập qua hàm SECURITY DEFINER.
--   • trong app: cần token đăng nhập (hàm cp_session của 157). Qua link: cần mã link + PIN.
--   • PIN lưu dạng băm bcrypt (không xem lại được — quên thì "Đặt mã mới"); sai 5 lần khoá 15 phút, nhân đôi mỗi lần
--     khoá lại, tối đa 24 giờ; đếm ở server, trả jsonb thay vì RAISE (RAISE làm mất bộ đếm).
--   • người xem KHÔNG nhận: tên người đi, ghi âm, vết GPS, ảnh/ chuyến ngoài KCN đã cho phép, mục trong Lưu trữ.
--   • bảng bị khóa anon nên dh_attach_triggers() (chỉ gắn bảng anon đọc được) tự bỏ qua — không lộ pin_hash qua data_history.
--
-- ĐIỀU KIỆN: đã chạy migration 157 (cần hàm cp_session) và 190–195 (bảng khảo sát).
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO bảng + hàm mới. Chạy lại nhiều lần vẫn an toàn.
-- Rollback: xem cuối file.
-- ============================================================================
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS kcn_survey_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,                 -- mã link ngắn, 6 ký tự
  label           text NOT NULL DEFAULT '',             -- ghi chú của người gửi: "Gửi anh Nam – Công ty ABC"
  pin_hash        text NOT NULL,                        -- bcrypt của PIN 4 số
  zone_ids        uuid[] NOT NULL DEFAULT '{}',         -- KCN được xem (market_zones.id, không FK)
  provinces       text[] NOT NULL DEFAULT '{}',         -- tên tỉnh, chỉ để hiển thị / soạn tin nhắn
  expires_at      timestamptz,                          -- NULL = không hết hạn
  revoked         boolean NOT NULL DEFAULT false,
  failed_attempts int NOT NULL DEFAULT 0,
  lock_count      int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  open_count      int NOT NULL DEFAULT 0,
  last_opened_at  timestamptz,
  created_by      uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kcn_survey_shares_created_idx ON kcn_survey_shares (created_at DESC);

ALTER TABLE kcn_survey_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kcn_survey_shares FROM anon, authenticated;

-- ═════════════════════════ HÀM NỘI BỘ ═════════════════════════
CREATE OR REPLACE FUNCTION ks_gen_code() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  i int;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM kcn_survey_shares WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION ks_gen_code() FROM PUBLIC, anon, authenticated;

-- Kiểm tra mã link + PIN (trả jsonb, không RAISE).
CREATE OR REPLACE FUNCTION ks_share_check(p_code text, p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  s kcn_survey_shares%ROWTYPE;
  v_secs int;
  v_lock_min int;
BEGIN
  SELECT * INTO s FROM kcn_survey_shares WHERE code = upper(trim(coalesce(p_code, ''))) FOR UPDATE;
  IF NOT FOUND OR s.revoked THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF s.expires_at IS NOT NULL AND s.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF s.locked_until IS NOT NULL AND s.locked_until > now() THEN
    v_secs := ceil(extract(epoch FROM (s.locked_until - now())))::int;
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'seconds', v_secs);
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' OR s.pin_hash <> crypt(p_pin, s.pin_hash) THEN
    s.failed_attempts := s.failed_attempts + 1;
    IF s.failed_attempts >= 5 THEN
      v_lock_min := least(15 * power(2, s.lock_count)::int, 1440);
      UPDATE kcn_survey_shares
        SET failed_attempts = 0, lock_count = lock_count + 1, locked_until = now() + make_interval(mins => v_lock_min)
        WHERE id = s.id;
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'seconds', v_lock_min * 60);
    END IF;
    UPDATE kcn_survey_shares SET failed_attempts = s.failed_attempts WHERE id = s.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_pin', 'remaining', 5 - s.failed_attempts);
  END IF;

  IF s.failed_attempts <> 0 OR s.lock_count <> 0 THEN
    UPDATE kcn_survey_shares SET failed_attempts = 0, lock_count = 0, locked_until = NULL WHERE id = s.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'share_id', s.id);
END $$;
REVOKE ALL ON FUNCTION ks_share_check(text, text) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════ HÀM TRONG APP (cần token) ═════════════════════════
-- Tạo link mới. PIN do app sinh ngẫu nhiên và gửi lên (lưu băm).
CREATE OR REPLACE FUNCTION survey_share_create(
  p_token text, p_label text, p_zone_ids uuid[], p_provinces text[], p_pin text, p_days int DEFAULT NULL
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
  INSERT INTO kcn_survey_shares (code, label, pin_hash, zone_ids, provinces, expires_at, created_by, created_by_name)
  VALUES (v_code, left(coalesce(p_label, ''), 120), crypt(p_pin, gen_salt('bf')), p_zone_ids,
          coalesce(p_provinces, '{}'), v_exp, u.user_id, u.full_name)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'expires_at', v_exp);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_create(text, text, uuid[], text[], text, int) TO anon, authenticated;

-- Danh sách link: admin thấy tất cả, người khác chỉ thấy link do mình tạo.
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
      'created_by_name', s.created_by_name, 'created_at', s.created_at) ORDER BY s.created_at DESC)
    FROM kcn_survey_shares s
    WHERE u.role = 'admin' OR s.created_by IS NOT DISTINCT FROM u.user_id
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_list(text) TO anon, authenticated;

-- Đặt mã mới và/hoặc gia hạn (mở lại link đã hết hạn / thu hồi). p_set_expiry = false → giữ nguyên hạn cũ.
CREATE OR REPLACE FUNCTION survey_share_update(
  p_token text, p_id uuid, p_pin text, p_set_expiry boolean DEFAULT false, p_days int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  s kcn_survey_shares%ROWTYPE;
  v_exp timestamptz;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  SELECT * INTO s FROM kcn_survey_shares WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link không còn tồn tại'; END IF;
  IF u.role <> 'admin' AND s.created_by IS DISTINCT FROM u.user_id THEN RAISE EXCEPTION 'Chỉ người tạo link hoặc admin được sửa'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Mã bảo mật phải gồm đúng 4 chữ số'; END IF;
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > 365) THEN RAISE EXCEPTION 'Thời hạn từ 1 đến 365 ngày'; END IF;
  v_exp := CASE WHEN p_set_expiry THEN (CASE WHEN p_days IS NOT NULL THEN now() + make_interval(days => p_days) END) ELSE s.expires_at END;
  UPDATE kcn_survey_shares SET
    pin_hash = crypt(p_pin, gen_salt('bf')), expires_at = v_exp, revoked = false,
    failed_attempts = 0, lock_count = 0, locked_until = NULL
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'code', s.code, 'expires_at', v_exp);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_update(text, uuid, text, boolean, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION survey_share_revoke(p_token text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_owner uuid;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  SELECT created_by INTO v_owner FROM kcn_survey_shares WHERE id = p_id;
  IF u.role <> 'admin' AND v_owner IS DISTINCT FROM u.user_id THEN RAISE EXCEPTION 'Chỉ người tạo link hoặc admin được thu hồi'; END IF;
  UPDATE kcn_survey_shares SET revoked = true WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION survey_share_revoke(text, uuid) TO anon, authenticated;

-- ═════════════════════════ HÀM QUA LINK (mã link + PIN, không cần đăng nhập) ═════════════════════════
-- Trả đúng phần dữ liệu thuộc các KCN được cho phép. Không trả tên người đi, ghi âm, vết GPS, mục đã xoá / lưu trữ.
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
           company_name, positions, headcount, wage_text, note, annotations
    FROM kcn_survey_photos
    WHERE deleted_at IS NULL AND zone_id = ANY (s.zone_ids)
    ORDER BY taken_at DESC LIMIT 800
  ) p;

  RETURN jsonb_build_object('ok', true, 'label', s.label, 'provinces', s.provinces, 'expires_at', s.expires_at,
    'zones', v_zones, 'trips', v_trips, 'photos', v_photos);
END $$;
GRANT EXECUTE ON FUNCTION survey_share_open(text, text, boolean) TO anon, authenticated;

-- ============================================================================
-- Rollback (chỉ khi cần):
--   DROP FUNCTION IF EXISTS survey_share_open(text, text, boolean);
--   DROP FUNCTION IF EXISTS survey_share_revoke(text, uuid);
--   DROP FUNCTION IF EXISTS survey_share_update(text, uuid, text, boolean, int);
--   DROP FUNCTION IF EXISTS survey_share_list(text);
--   DROP FUNCTION IF EXISTS survey_share_create(text, text, uuid[], text[], text, int);
--   DROP FUNCTION IF EXISTS ks_share_check(text, text);
--   DROP FUNCTION IF EXISTS ks_gen_code();
--   DROP TABLE IF EXISTS kcn_survey_shares;
-- ============================================================================
