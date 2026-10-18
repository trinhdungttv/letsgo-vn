-- 167 — Đăng nhập bằng tài khoản Google (cấp session token của app như verify_login)
-- Chạy thủ công trong Supabase SQL Editor (dán nguyên nội dung). Chạy lại nhiều lần không sao.
--
-- Luồng: nút "Đăng nhập bằng Google" → Supabase Auth (Google OAuth, PKCE) → app gọi RPC này bằng
-- JWT của phiên Supabase Auth vừa tạo → RPC đọc email TỪ PHÍA MÁY CHỦ (bảng auth.identities, do
-- Google xác minh) — KHÔNG nhận email do trình duyệt gửi lên — rồi khớp app_users.email.
-- Khớp đúng 1 tài khoản đang hoạt động → cấp token app_sessions (hạn 7 ngày) như verify_login.
-- App đăng xuất phiên Supabase Auth ngay sau đó; mọi phần khác vẫn chạy bằng anon key + token như cũ.
--
-- Chốt an toàn:
--   - Chỉ role `authenticated` gọi được (JWT hợp lệ do Supabase ký); anon bị thu hồi quyền.
--   - Tài khoản Supabase Auth phải CHỈ có danh tính Google (đúng 1 cái), email_verified = true.
--     → Người ngoài tự đăng ký email/mật khẩu trùng email của mình (khi Supabase không bắt xác nhận
--       email) cũng không lấy được token.
--   - Không tự tạo user mới: email lạ / tài khoản bị khoá / email trùng nhiều tài khoản → báo lỗi.
--   - Không đọc user_metadata (người dùng tự sửa được).
--
-- Mã lỗi (app đổi sang câu tiếng Việt): GOOGLE_NO_SESSION, GOOGLE_IDENTITY_INVALID,
-- GOOGLE_NOT_ALLOWED, GOOGLE_ACCOUNT_LOCKED, GOOGLE_EMAIL_DUPLICATE.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION verify_google_login()
RETURNS TABLE (id uuid, username text, full_name text, role text, email text, token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_google    int;
  v_other     int;
  v_email     text;
  v_matches   int;
  v_user      app_users%ROWTYPE;
  v_token     text;
BEGIN
  IF v_uid IS NULL OR COALESCE(auth.jwt() ->> 'role', '') <> 'authenticated'
     OR COALESCE(auth.jwt() ->> 'is_anonymous', 'false') = 'true' THEN
    RAISE EXCEPTION 'GOOGLE_NO_SESSION';
  END IF;

  -- Danh tính của tài khoản Supabase Auth đang gọi: phải toàn Google, đúng 1 danh tính.
  SELECT count(*) FILTER (WHERE i.provider = 'google'),
         count(*) FILTER (WHERE i.provider <> 'google')
    INTO v_google, v_other
  FROM auth.identities i
  WHERE i.user_id = v_uid;

  IF v_google <> 1 OR v_other <> 0 THEN
    RAISE EXCEPTION 'GOOGLE_IDENTITY_INVALID';
  END IF;

  -- Email do Google trả về (identity_data), chỉ nhận khi Google báo đã xác minh.
  SELECT lower(btrim(i.identity_data ->> 'email'))
    INTO v_email
  FROM auth.identities i
  WHERE i.user_id = v_uid
    AND i.provider = 'google'
    AND lower(COALESCE(i.identity_data ->> 'email_verified', '')) = 'true';

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'GOOGLE_IDENTITY_INVALID';
  END IF;

  -- Khớp tài khoản app (không phân biệt hoa thường, bỏ khoảng trắng thừa).
  SELECT count(*) INTO v_matches
  FROM app_users u
  WHERE lower(btrim(u.email)) = v_email
    AND COALESCE(u.is_active, true) = true;

  IF v_matches > 1 THEN
    RAISE EXCEPTION 'GOOGLE_EMAIL_DUPLICATE';
  END IF;

  IF v_matches = 0 THEN
    IF EXISTS (SELECT 1 FROM app_users u WHERE lower(btrim(u.email)) = v_email) THEN
      RAISE EXCEPTION 'GOOGLE_ACCOUNT_LOCKED';
    END IF;
    RAISE EXCEPTION 'GOOGLE_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_user
  FROM app_users u
  WHERE lower(btrim(u.email)) = v_email
    AND COALESCE(u.is_active, true) = true;

  -- Cấp token y như verify_login (061).
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO app_sessions (token, user_id) VALUES (v_token, v_user.id);
  DELETE FROM app_sessions WHERE expires_at < now();  -- dọn phiên hết hạn
  RETURN QUERY SELECT v_user.id, v_user.username, v_user.full_name, v_user.role, v_user.email, v_token;
END;
$$;

-- Hàm mới mặc định cho PUBLIC/anon gọi → thu hồi, chỉ cấp cho authenticated (có JWT Supabase Auth).
REVOKE ALL ON FUNCTION verify_google_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION verify_google_login() TO authenticated;

NOTIFY pgrst, 'reload schema';
