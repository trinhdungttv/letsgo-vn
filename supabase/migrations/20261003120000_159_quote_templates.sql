-- 159: Thư viện FILE EXCEL MẪU BÁO GIÁ (Phương án giá → Bảng giá dịch vụ → "Xuất theo mẫu").
-- 1 file có thể chứa nhiều phiên bản (mỗi sheet 1 phiên bản: tiếng Việt, song ngữ Việt–Trung, Anh–Việt…); người dùng chọn
-- phiên bản khi xuất. File lưu dạng base64 trong bảng KHOÁ với anon (như cost_plans), chỉ truy cập qua hàm kiểm tra đăng nhập.
-- Cần migration 157 đã chạy (dùng lại cp_session).

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS quote_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  file_name       text NOT NULL,
  size_bytes      int  NOT NULL DEFAULT 0,
  file_b64        text NOT NULL,
  versions        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ sheet, lang, label, hasTable, rows, tokens }]
  created_by      uuid,
  created_by_name text,
  updated_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quote_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quote_templates FROM anon, authenticated;

-- Danh sách: KHÔNG kèm nội dung file (nặng) — chỉ lấy file khi cần dùng.
CREATE OR REPLACE FUNCTION quote_template_list(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(t) - 'file_b64' ORDER BY t.updated_at DESC) FROM quote_templates t), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION quote_template_list(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION quote_template_get(p_token text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE t quote_templates%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  SELECT * INTO t FROM quote_templates WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'File mẫu không còn tồn tại'; END IF;
  RETURN jsonb_build_object('file_name', t.file_name, 'file_b64', t.file_b64);
END $$;
GRANT EXECUTE ON FUNCTION quote_template_get(text, uuid) TO anon, authenticated;

-- Thêm mới (p_id NULL, bắt buộc có file) hoặc sửa (p_id có; p_file_b64 NULL = giữ nguyên file, chỉ đổi tên / nhãn phiên bản).
CREATE OR REPLACE FUNCTION quote_template_save(
  p_token text, p_id uuid, p_name text, p_file_name text, p_file_b64 text, p_size int, p_versions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_row quote_templates%ROWTYPE;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF coalesce(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Chưa đặt tên bộ mẫu'; END IF;
  IF jsonb_typeof(p_versions) <> 'array' OR jsonb_array_length(p_versions) = 0 THEN RAISE EXCEPTION 'File chưa có phiên bản nào'; END IF;
  IF p_file_b64 IS NOT NULL AND length(p_file_b64) > 3500000 THEN RAISE EXCEPTION 'File quá lớn (tối đa khoảng 2,5 MB)'; END IF;

  IF p_id IS NULL THEN
    IF p_file_b64 IS NULL OR p_file_b64 = '' THEN RAISE EXCEPTION 'Chưa có file'; END IF;
    INSERT INTO quote_templates (name, file_name, size_bytes, file_b64, versions, created_by, created_by_name, updated_by_name)
    VALUES (trim(p_name), coalesce(nullif(p_file_name, ''), 'mau-bao-gia.xlsx'), coalesce(p_size, 0), p_file_b64, p_versions, u.user_id, u.full_name, u.full_name)
    RETURNING * INTO v_row;
  ELSE
    UPDATE quote_templates SET
      name = trim(p_name), versions = p_versions,
      file_name  = CASE WHEN p_file_b64 IS NOT NULL THEN coalesce(nullif(p_file_name, ''), file_name) ELSE file_name END,
      size_bytes = CASE WHEN p_file_b64 IS NOT NULL THEN coalesce(p_size, 0) ELSE size_bytes END,
      file_b64   = coalesce(p_file_b64, file_b64),
      updated_by_name = u.full_name, updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'File mẫu không còn tồn tại'; END IF;
  END IF;
  RETURN to_jsonb(v_row) - 'file_b64';
END $$;
GRANT EXECUTE ON FUNCTION quote_template_save(text, uuid, text, text, text, int, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION quote_template_delete(p_token text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_owner uuid;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  SELECT created_by INTO v_owner FROM quote_templates WHERE id = p_id;
  IF u.role <> 'admin' AND v_owner IS DISTINCT FROM u.user_id THEN
    RAISE EXCEPTION 'Chỉ người tải lên hoặc admin được xoá file mẫu';
  END IF;
  DELETE FROM quote_templates WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION quote_template_delete(text, uuid) TO anon, authenticated;
