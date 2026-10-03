-- 161: NHIỀU PHÁP NHÂN gửi báo giá (tối đa 5; thường 1–3). Mỗi pháp nhân có tên gọi, thông tin công ty, logo, chữ ký, con dấu
-- và cách căn chữ ký/con dấu riêng. Thay cho hồ sơ công ty duy nhất ở migration 160 — bộ đã nhập ở 160 được CHUYỂN SANG làm pháp nhân đầu tiên.
-- Giữ nguyên nguyên tắc bảo mật của 160: bảng khoá với anon; ảnh chữ ký + con dấu CHỈ trả về cho admin; chỉ admin sửa/xoá.
-- Cần migration 157 đã chạy (cp_session). Bảng/hàm của 160 được giữ lại, không còn dùng.

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS quote_entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  layout          jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_b64        text,
  signature_b64   text,
  seal_b64        text,
  sort_order      int NOT NULL DEFAULT 0,
  updated_by_name text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quote_entities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quote_entities FROM anon, authenticated;

-- Chuyển bộ thông tin cũ (nếu đã nhập ở migration 160) thành pháp nhân đầu tiên — chỉ làm khi chưa có pháp nhân nào
DO $$
BEGIN
  IF to_regclass('public.quote_company_profile') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM quote_entities) THEN
    INSERT INTO quote_entities (label, data, logo_b64, signature_b64, seal_b64, updated_by_name, updated_at)
    SELECT coalesce(nullif(trim(data->>'name'), ''), 'Pháp nhân 1'), data, logo_b64, signature_b64, seal_b64, updated_by_name, updated_at
    FROM quote_company_profile WHERE id = 1;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION quote_entity_list(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_admin boolean;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  v_admin := (u.role = 'admin');
  RETURN jsonb_build_object(
    'can_sign', v_admin,
    'entities', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'label', e.label, 'data', e.data, 'layout', e.layout, 'logo', e.logo_b64,
        'signature', CASE WHEN v_admin THEN e.signature_b64 END,
        'seal',      CASE WHEN v_admin THEN e.seal_b64 END,
        'has_signature', e.signature_b64 IS NOT NULL, 'has_seal', e.seal_b64 IS NOT NULL,
        'sort_order', e.sort_order, 'updated_by_name', e.updated_by_name, 'updated_at', e.updated_at
      ) ORDER BY e.sort_order, e.created_at) FROM quote_entities e), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION quote_entity_list(text) TO anon, authenticated;

-- Thêm (p_id NULL) hoặc sửa. Với mỗi ảnh: NULL = giữ nguyên, '' = xoá, còn lại = ảnh mới (data URL).
CREATE OR REPLACE FUNCTION quote_entity_save(
  p_token text, p_id uuid, p_label text, p_data jsonb, p_layout jsonb, p_logo text, p_signature text, p_seal text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_id uuid;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin được sửa pháp nhân, chữ ký và con dấu'; END IF;
  IF coalesce(trim(p_label), '') = '' THEN RAISE EXCEPTION 'Chưa đặt tên gọi cho pháp nhân'; END IF;
  IF jsonb_typeof(p_data) <> 'object' OR jsonb_typeof(p_layout) <> 'object' THEN RAISE EXCEPTION 'Dữ liệu không hợp lệ'; END IF;
  IF length(coalesce(p_logo, '')) > 900000 OR length(coalesce(p_signature, '')) > 900000 OR length(coalesce(p_seal, '')) > 900000 THEN
    RAISE EXCEPTION 'Ảnh quá lớn (mỗi ảnh tối đa khoảng 650 KB)';
  END IF;
  IF (p_logo IS NOT NULL AND p_logo <> '' AND p_logo !~ '^data:image/(png|jpeg|webp);base64,')
     OR (p_signature IS NOT NULL AND p_signature <> '' AND p_signature !~ '^data:image/(png|jpeg|webp);base64,')
     OR (p_seal IS NOT NULL AND p_seal <> '' AND p_seal !~ '^data:image/(png|jpeg|webp);base64,') THEN
    RAISE EXCEPTION 'Chỉ nhận ảnh PNG, JPEG hoặc WebP';
  END IF;

  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM quote_entities) >= 5 THEN RAISE EXCEPTION 'Tối đa 5 pháp nhân'; END IF;
    INSERT INTO quote_entities (label, data, layout, logo_b64, signature_b64, seal_b64, sort_order, updated_by_name)
    VALUES (trim(p_label), p_data, p_layout, nullif(p_logo, ''), nullif(p_signature, ''), nullif(p_seal, ''),
            coalesce((SELECT max(sort_order) + 1 FROM quote_entities), 0), u.full_name)
    RETURNING id INTO v_id;
  ELSE
    UPDATE quote_entities SET
      label = trim(p_label), data = p_data, layout = p_layout,
      logo_b64      = CASE WHEN p_logo      IS NULL THEN logo_b64      ELSE nullif(p_logo, '')      END,
      signature_b64 = CASE WHEN p_signature IS NULL THEN signature_b64 ELSE nullif(p_signature, '') END,
      seal_b64      = CASE WHEN p_seal      IS NULL THEN seal_b64      ELSE nullif(p_seal, '')      END,
      updated_by_name = u.full_name, updated_at = now()
    WHERE id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Pháp nhân không còn tồn tại'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
GRANT EXECUTE ON FUNCTION quote_entity_save(text, uuid, text, jsonb, jsonb, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION quote_entity_delete(p_token text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin được xoá pháp nhân'; END IF;
  DELETE FROM quote_entities WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION quote_entity_delete(text, uuid) TO anon, authenticated;
