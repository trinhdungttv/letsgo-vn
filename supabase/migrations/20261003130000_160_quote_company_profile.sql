-- 160: Hồ sơ CÔNG TY GỬI BÁO GIÁ (tên, địa chỉ, MST, liên hệ, người ký) + ảnh logo / CHỮ KÝ / CON DẤU dùng khi xuất PDF báo giá.
-- Chữ ký và con dấu là dữ liệu NHẠY CẢM (ai có ảnh là đóng dấu giả được) nên:
--   • bảng khoá với anon, chỉ truy cập qua hàm kiểm tra đăng nhập (như cost_plans)
--   • ảnh chữ ký + con dấu CHỈ trả về cho tài khoản admin; người khác chỉ biết "đã có / chưa có"
--   • chỉ admin được sửa
-- Cần migration 157 đã chạy (dùng lại cp_session).

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS quote_company_profile (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),      -- đúng 1 dòng cho cả công ty
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,            -- tên, địa chỉ, MST, điện thoại, email, website, người ký, chức danh, nơi ký
  logo_b64        text,                                          -- data URL ảnh
  signature_b64   text,
  seal_b64        text,
  updated_by_name text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quote_company_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quote_company_profile FROM anon, authenticated;

CREATE OR REPLACE FUNCTION quote_profile_get(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; t quote_company_profile%ROWTYPE; v_admin boolean;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  v_admin := (u.role = 'admin');
  SELECT * INTO t FROM quote_company_profile WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('data', '{}'::jsonb, 'logo', NULL, 'signature', NULL, 'seal', NULL,
      'has_signature', false, 'has_seal', false, 'can_sign', v_admin, 'updated_by_name', NULL, 'updated_at', NULL);
  END IF;
  RETURN jsonb_build_object(
    'data', t.data, 'logo', t.logo_b64,
    'signature', CASE WHEN v_admin THEN t.signature_b64 END,
    'seal',      CASE WHEN v_admin THEN t.seal_b64 END,
    'has_signature', t.signature_b64 IS NOT NULL, 'has_seal', t.seal_b64 IS NOT NULL,
    'can_sign', v_admin, 'updated_by_name', t.updated_by_name, 'updated_at', t.updated_at);
END $$;
GRANT EXECUTE ON FUNCTION quote_profile_get(text) TO anon, authenticated;

-- Với mỗi ảnh: NULL = giữ nguyên, '' = xoá, còn lại = ảnh mới (data URL).
CREATE OR REPLACE FUNCTION quote_profile_save(p_token text, p_data jsonb, p_logo text, p_signature text, p_seal text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; t quote_company_profile%ROWTYPE;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin được sửa hồ sơ công ty, chữ ký và con dấu'; END IF;
  IF jsonb_typeof(p_data) <> 'object' THEN RAISE EXCEPTION 'Dữ liệu không hợp lệ'; END IF;
  IF length(coalesce(p_logo, '')) > 900000 OR length(coalesce(p_signature, '')) > 900000 OR length(coalesce(p_seal, '')) > 900000 THEN
    RAISE EXCEPTION 'Ảnh quá lớn (mỗi ảnh tối đa khoảng 650 KB)';
  END IF;
  IF (p_logo IS NOT NULL AND p_logo <> '' AND p_logo !~ '^data:image/(png|jpeg|webp);base64,')
     OR (p_signature IS NOT NULL AND p_signature <> '' AND p_signature !~ '^data:image/(png|jpeg|webp);base64,')
     OR (p_seal IS NOT NULL AND p_seal <> '' AND p_seal !~ '^data:image/(png|jpeg|webp);base64,') THEN
    RAISE EXCEPTION 'Chỉ nhận ảnh PNG, JPEG hoặc WebP';
  END IF;

  INSERT INTO quote_company_profile (id, data, logo_b64, signature_b64, seal_b64, updated_by_name, updated_at)
  VALUES (1, p_data, nullif(p_logo, ''), nullif(p_signature, ''), nullif(p_seal, ''), u.full_name, now())
  ON CONFLICT (id) DO UPDATE SET
    data = EXCLUDED.data,
    logo_b64      = CASE WHEN p_logo      IS NULL THEN quote_company_profile.logo_b64      ELSE nullif(p_logo, '')      END,
    signature_b64 = CASE WHEN p_signature IS NULL THEN quote_company_profile.signature_b64 ELSE nullif(p_signature, '') END,
    seal_b64      = CASE WHEN p_seal      IS NULL THEN quote_company_profile.seal_b64      ELSE nullif(p_seal, '')      END,
    updated_by_name = u.full_name, updated_at = now()
  RETURNING * INTO t;
  RETURN jsonb_build_object('ok', true, 'updated_at', t.updated_at);
END $$;
GRANT EXECUTE ON FUNCTION quote_profile_save(text, jsonb, text, text, text) TO anon, authenticated;
