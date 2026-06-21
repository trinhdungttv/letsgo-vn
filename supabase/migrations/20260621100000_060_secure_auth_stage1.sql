-- Stage 1 — Bao mat tai khoan (A1 doc / A2 / A6 / B3)
-- Muc tieu: cham dut luu mat khau plaintext + cham dut kha nang dump mat khau qua anon key.
-- Chay thu cong trong Supabase SQL Editor (dan nguyen noi dung).
--
-- Pham vi Stage 1: hash mat khau + chan DOC cot password tu client + dang nhap/xac thuc qua RPC.
-- CHUA xu ly trong Stage 1 (de Stage 2 lam bang co che session/token):
--   - Chan GHI gia mao vao app_users (vd tu tao 1 admin) — anon van INSERT/UPDATE duoc.
--   - Chan GHI vao role_permissions tu anon (A7).
--   - Khoa doc/ghi truc tiep cac bang tai chinh/khoan vay (A3/A4 day du).

-- pgcrypto thuong nam o schema "extensions" tren Supabase; them ca vao search_path cho chac.
SET search_path = public, extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Bao dam cac cot ung dung dang dung thuc su ton tai (duoc them tay truoc day, khong qua migration).
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 1) Hash toan bo mat khau dang plaintext sang bcrypt.
--    Idempotent: bo qua cac gia tri da la bcrypt (bat dau bang "$2").
UPDATE app_users
SET password = crypt(password, gen_salt('bf'))
WHERE password IS NOT NULL AND password <> '' AND password NOT LIKE '$2%';

-- 2) Trigger tu dong hash khi them/sua mat khau (defense-in-depth: du ghi truc tiep van duoc hash).
CREATE OR REPLACE FUNCTION hash_app_user_password()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.password IS NOT NULL
     AND NEW.password <> ''
     AND NEW.password NOT LIKE '$2%'
     AND (TG_OP = 'INSERT' OR NEW.password IS DISTINCT FROM OLD.password) THEN
    NEW.password := crypt(NEW.password, gen_salt('bf'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_app_user_password ON app_users;
CREATE TRIGGER trg_hash_app_user_password
  BEFORE INSERT OR UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION hash_app_user_password();

-- 3) RPC dang nhap: so khop mat khau da hash, kiem tra is_active, KHONG tra ve cot password.
CREATE OR REPLACE FUNCTION verify_login(p_username text, p_password text)
RETURNS TABLE (id uuid, username text, full_name text, role text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.id, u.username, u.full_name, u.role, u.email
  FROM app_users u
  WHERE u.username = p_username
    AND u.password = crypt(p_password, u.password)
    AND COALESCE(u.is_active, true) = true;
$$;

-- 4) RPC xac thuc lai mat khau (cho cac thao tac nhay cam: xoa khu vuc / khach hang / chi nhanh).
CREATE OR REPLACE FUNCTION verify_password(p_user_id uuid, p_password text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users u
    WHERE u.id = p_user_id
      AND u.password = crypt(p_password, u.password)
  );
$$;

-- 5) Cho phep client (anon + authenticated) goi 2 RPC tren.
GRANT EXECUTE ON FUNCTION verify_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_password(uuid, text) TO anon, authenticated;

-- 6) Chan DOC cot password tu client.
--    Cach lam: thu hoi SELECT toan bang roi cap lai SELECT theo tung cot (tru password).
--    Sau buoc nay: select('*') tren app_users se loi "permission denied for column password";
--    code da duoc sua de chi select cac cot can thiet. Cac RPC o tren chay SECURITY DEFINER
--    nen van so khop duoc mat khau.
REVOKE SELECT ON app_users FROM anon, authenticated;
GRANT SELECT (id, username, full_name, role, email, is_active, created_at)
  ON app_users TO anon, authenticated;
