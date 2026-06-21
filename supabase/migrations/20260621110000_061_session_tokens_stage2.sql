-- Stage 2 — Session token + khoa GHI app_users / role_permissions (A1-ghi, A7)
-- Chay thu cong trong Supabase SQL Editor (sau khi da chay 060).
--
-- Muc tieu:
--   - Cap "session token" khi dang nhap; moi thao tac GHI nhay cam phai kem token hop le cua admin.
--   - Chan anon INSERT/UPDATE/DELETE truc tiep vao app_users (khong the tu tao admin gia) — A1-ghi.
--   - Chan anon GHI role_permissions (khong the tu nang quyen) — A7.
-- KHONG nam trong Stage 2 (de Stage 3): khoa doc/ghi truc tiep bang khoan vay (A4) va clients/finance (A3).

SET search_path = public, extensions;

-- 1) Bang phien dang nhap. Chi truy cap qua RPC SECURITY DEFINER (revoke moi quyen truc tiep).
CREATE TABLE IF NOT EXISTS app_sessions (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);

ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_sessions FROM anon, authenticated;

-- 2) Helper noi bo: tra ve role neu token hop le (con han + user active), nguoc lai NULL.
CREATE OR REPLACE FUNCTION session_role(p_token text)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT u.role
  FROM app_sessions s JOIN app_users u ON u.id = s.user_id
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND COALESCE(u.is_active, true) = true;
$$;
REVOKE ALL ON FUNCTION session_role(text) FROM anon, authenticated;

-- Helper noi bo: bao loi neu token khong phai admin hop le.
CREATE OR REPLACE FUNCTION require_admin(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF session_role(p_token) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Khong co quyen (yeu cau dang nhap admin)';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION require_admin(text) FROM anon, authenticated;

-- 3) verify_login: cap token + tra ve thong tin user (khong tra password).
DROP FUNCTION IF EXISTS verify_login(text, text);
CREATE OR REPLACE FUNCTION verify_login(p_username text, p_password text)
RETURNS TABLE (id uuid, username text, full_name text, role text, email text, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_user app_users%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_user FROM app_users u
  WHERE u.username = p_username
    AND u.password = crypt(p_password, u.password)
    AND COALESCE(u.is_active, true) = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO app_sessions (token, user_id) VALUES (v_token, v_user.id);
  DELETE FROM app_sessions WHERE expires_at < now();  -- don phien het han
  RETURN QUERY SELECT v_user.id, v_user.username, v_user.full_name, v_user.role, v_user.email, v_token;
END;
$$;
GRANT EXECUTE ON FUNCTION verify_login(text, text) TO anon, authenticated;

-- 4) logout: huy token.
CREATE OR REPLACE FUNCTION logout_session(p_token text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$ DELETE FROM app_sessions WHERE token = p_token; $$;
GRANT EXECUTE ON FUNCTION logout_session(text) TO anon, authenticated;

-- 5) A1-ghi: quan ly tai khoan qua admin token. (password truyen plaintext -> trigger 060 tu hash)
CREATE OR REPLACE FUNCTION admin_create_user(
  p_token text, p_username text, p_full_name text, p_email text, p_password text, p_role text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  INSERT INTO app_users (username, full_name, email, password, role)
  VALUES (p_username, p_full_name, NULLIF(p_email, ''), p_password, p_role)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_create_user(text, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_update_user(
  p_token text, p_id uuid, p_username text, p_full_name text, p_email text, p_password text, p_role text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  UPDATE app_users SET
    username = p_username,
    full_name = p_full_name,
    -- p_email NULL = giu nguyen (vd trang UserManagement khong quan ly email); '' = xoa; gia tri = dat.
    email = CASE WHEN p_email IS NULL THEN email ELSE NULLIF(p_email, '') END,
    role = p_role,
    password = CASE WHEN p_password IS NOT NULL AND p_password <> '' THEN p_password ELSE password END
  WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_update_user(text, uuid, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_set_user_active(p_token text, p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  UPDATE app_users SET is_active = p_active WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_user_active(text, uuid, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_delete_user(p_token text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  DELETE FROM app_users WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_user(text, uuid) TO anon, authenticated;

-- 6) A7: cap nhat ma tran phan quyen qua admin token.
CREATE OR REPLACE FUNCTION admin_set_role_permission(p_token text, p_role text, p_module text, p_level text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  INSERT INTO role_permissions (role, module, level, updated_at)
  VALUES (p_role, p_module, p_level, now())
  ON CONFLICT (role, module) DO UPDATE SET level = EXCLUDED.level, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_role_permission(text, text, text, text) TO anon, authenticated;

-- 7) Khoa GHI truc tiep tu client (chi con doc; ghi phai qua RPC admin o tren).
--    app_users: bo policy ALL, thay bang chi SELECT (cot password da bi chan doc tu migration 060).
DROP POLICY IF EXISTS "appusers_all_anon" ON app_users;
DROP POLICY IF EXISTS "appusers_all_auth" ON app_users;
CREATE POLICY "appusers_select_anon" ON app_users FOR SELECT TO anon USING (true);
CREATE POLICY "appusers_select_auth" ON app_users FOR SELECT TO authenticated USING (true);

--    role_permissions: bo policy ALL, thay bang chi SELECT (canAccess can doc ma tran).
DROP POLICY IF EXISTS "role_permissions_all_anon" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_all_auth" ON role_permissions;
CREATE POLICY "role_permissions_select_anon" ON role_permissions FOR SELECT TO anon USING (true);
CREATE POLICY "role_permissions_select_auth" ON role_permissions FOR SELECT TO authenticated USING (true);
