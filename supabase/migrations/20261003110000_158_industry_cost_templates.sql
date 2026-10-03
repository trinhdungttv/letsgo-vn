-- 158: Mẫu khoản mục chi phí theo NGÀNH (Phương án giá → bước 1). Mỗi ngành có mức hỗ trợ độc hại / khoản đặc thù khác nhau;
-- người dùng tự lưu bảng chuẩn của ngành, lần sau chọn ngành đó là bảng tự điền theo mẫu.
-- Cần migration 157 đã chạy (dùng lại hàm cp_session để kiểm tra đăng nhập). Bảng khoá với anon như cost_plans.

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS industry_cost_templates (
  industry        text PRIMARY KEY,                    -- tên ngành đúng như trong bảng industries
  lines           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- mảng khoản mục (không gồm Phí dịch vụ)
  updated_by_name text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE industry_cost_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON industry_cost_templates FROM anon, authenticated;

CREATE OR REPLACE FUNCTION cost_template_list(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.industry) FROM industry_cost_templates t), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION cost_template_list(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION cost_template_save(p_token text, p_industry text, p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_row industry_cost_templates%ROWTYPE;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF coalesce(trim(p_industry), '') = '' THEN RAISE EXCEPTION 'Chưa chọn ngành'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'Mẫu phải có ít nhất 1 khoản mục'; END IF;
  IF octet_length(p_lines::text) > 200000 THEN RAISE EXCEPTION 'Mẫu quá lớn'; END IF;
  INSERT INTO industry_cost_templates (industry, lines, updated_by_name, updated_at)
  VALUES (trim(p_industry), p_lines, u.full_name, now())
  ON CONFLICT (industry) DO UPDATE SET lines = EXCLUDED.lines, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;
GRANT EXECUTE ON FUNCTION cost_template_save(text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION cost_template_delete(p_token text, p_industry text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  DELETE FROM industry_cost_templates WHERE industry = p_industry;
END $$;
GRANT EXECUTE ON FUNCTION cost_template_delete(text, text) TO anon, authenticated;
