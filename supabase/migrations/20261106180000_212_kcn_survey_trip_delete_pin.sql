-- ============================================================================
-- 212 — Xoá CHUYẾN khảo sát KCN phải nhập MÃ 4 SỐ (mã phụ của hệ thống)
-- ----------------------------------------------------------------------------
-- Dùng CHUNG mã 4 số của từng người với khoá chống xoá Ghi chú / Sơ đồ tư duy (bảng quick_note_lock_pins, migration 196):
-- đã đặt mã ở Ghi chú thì dùng luôn; chưa có mã thì app cho đặt ngay lúc xoá. Sai 5 lần → tạm khoá 15 phút (lần sau gấp đôi,
-- tối đa 24 giờ) — đếm chung với Ghi chú. Quên mã: "Quên mã?" → nhập mật khẩu đăng nhập → đặt mã mới.
--
-- BẮT BUỘC Ở TẦNG DỮ LIỆU (không chỉ ở giao diện): bảng kcn_survey_trips mở cho anon ghi, nên có TRIGGER chặn
--   • đưa chuyến vào Lưu trữ  (UPDATE deleted_at: NULL → có giá trị)
--   • xoá hẳn dòng chuyến      (DELETE) — trừ mục nằm trong Lưu trữ quá 30 ngày (dọn tự động như migration 195)
-- trừ khi đi qua 2 hàm dưới đây (đã kiểm tra token đăng nhập + mã 4 số):
--   kcn_survey_trip_delete(token, id, pin)  → đưa chuyến vào Lưu trữ 30 ngày
--   kcn_survey_trip_purge(token, id, pin)   → xoá hẳn chuyến đang nằm trong Lưu trữ (nút "Xoá hẳn")
-- Khôi phục từ Lưu trữ (deleted_at → NULL) KHÔNG cần mã. Ảnh / ghi âm của chuyến không bị ảnh hưởng.
--
-- Chạy SQL thủ công trong SQL Editor mà cần xoá chuyến: chạy cùng lượt
--   SELECT set_config('lgvn.survey_trip_ok', '1', true);   -- rồi DELETE / UPDATE ngay trong cùng 1 lần Run
--
-- ĐIỀU KIỆN: đã chạy 157 (cp_session), 190, 195, 196 (qn_lock_check + mã).
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ thêm hàm + trigger. Chạy lại an toàn. Rollback: cuối file.
-- ============================================================================
SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION ks_trip_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('lgvn.survey_trip_ok', true), '') = '1' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Xoá chuyến khảo sát cần nhập mã 4 số' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE: chỉ cho dọn tự động mục đã nằm trong Lưu trữ quá 30 ngày
  IF OLD.deleted_at IS NOT NULL AND OLD.deleted_at < now() - interval '30 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Xoá chuyến khảo sát cần nhập mã 4 số' USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS ks_trip_guard_upd ON kcn_survey_trips;
CREATE TRIGGER ks_trip_guard_upd BEFORE UPDATE OF deleted_at ON kcn_survey_trips
  FOR EACH ROW EXECUTE FUNCTION ks_trip_guard();
DROP TRIGGER IF EXISTS ks_trip_guard_del ON kcn_survey_trips;
CREATE TRIGGER ks_trip_guard_del BEFORE DELETE ON kcn_survey_trips
  FOR EACH ROW EXECUTE FUNCTION ks_trip_guard();

-- Đưa chuyến vào Lưu trữ — cần mã 4 số đúng. Sai mã trả jsonb { ok:false, reason, remaining | seconds } (không RAISE để còn đếm lần sai).
CREATE OR REPLACE FUNCTION kcn_survey_trip_delete(p_token text, p_id uuid, p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid;
  chk jsonb;
BEGIN
  SELECT s.user_id INTO v_uid FROM cp_session(p_token) s LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  chk := qn_lock_check(v_uid, p_pin, 'pin');
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  PERFORM set_config('lgvn.survey_trip_ok', '1', true);
  UPDATE kcn_survey_trips SET deleted_at = now() WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION kcn_survey_trip_delete(text, uuid, text) TO anon, authenticated;

-- Xoá HẲN 1 chuyến đang nằm trong Lưu trữ (bỏ qua hạn 30 ngày) — cần mã 4 số đúng.
CREATE OR REPLACE FUNCTION kcn_survey_trip_purge(p_token text, p_id uuid, p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid;
  chk jsonb;
BEGIN
  SELECT s.user_id INTO v_uid FROM cp_session(p_token) s LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  chk := qn_lock_check(v_uid, p_pin, 'pin');
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  PERFORM set_config('lgvn.survey_trip_ok', '1', true);
  IF NOT EXISTS (SELECT 1 FROM kcn_survey_trips WHERE id = p_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  PERFORM kcn_survey_purge_archive(30, 'trip', p_id);
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION kcn_survey_trip_purge(text, uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP TRIGGER IF EXISTS ks_trip_guard_upd ON kcn_survey_trips;
--   DROP TRIGGER IF EXISTS ks_trip_guard_del ON kcn_survey_trips;
--   DROP FUNCTION IF EXISTS kcn_survey_trip_delete(text, uuid, text);
--   DROP FUNCTION IF EXISTS kcn_survey_trip_purge(text, uuid, text);
--   DROP FUNCTION IF EXISTS ks_trip_guard();
