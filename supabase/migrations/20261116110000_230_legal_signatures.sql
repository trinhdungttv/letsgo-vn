-- ============================================================================
-- 230 — KHO CHỮ KÝ (Workspace → Pháp lý → tab "Chữ ký")
-- ----------------------------------------------------------------------------
-- Tải ảnh chữ ký GỐC (chưa tách nền) lên 1 lần; chọn chữ ký đó đi với pháp nhân nào. App tự tách nền / làm đậm / lên màu mực
-- rồi đẩy bộ ký đã xử lý sang quote_entities (nơi giấy tờ đang đọc) — nên báo giá / danh sách vào cổng không phải đổi gì.
--
--   legal_signatures: owner_name (chủ chữ ký), original (data URL ảnh gốc, tối đa ~650 KB), settings jsonb {cutout, ink},
--                     entity_ids uuid[] (legal_entities.id đang dùng chữ ký này — không FK, bài học PGRST201)
-- BẢO MẬT như stamp_alerts: RLS bật, KHÔNG policy, REVOKE ALL — chỉ đọc / ghi qua 3 hàm dưới, chỉ ADMIN.
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM bảng + hàm mới. Chạy lại nhiều lần vẫn an toàn.
-- Cần chạy SAU 157 (cp_session), 201 (legal_entities).
-- ============================================================================

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS legal_signatures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name  text NOT NULL DEFAULT '',
  original    text NOT NULL,
  settings    jsonb NOT NULL DEFAULT '{"cutout": true, "ink": 0.5}'::jsonb,
  entity_ids  uuid[] NOT NULL DEFAULT '{}',
  created_by  text,
  updated_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE legal_signatures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON legal_signatures FROM anon, authenticated;

CREATE OR REPLACE FUNCTION legal_signature_list(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin quản lý kho chữ ký'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at) FROM legal_signatures s), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION legal_signature_list(text) TO anon, authenticated;

-- Thêm (p_id NULL) hoặc sửa. p_original NULL = giữ ảnh cũ.
-- Mỗi pháp nhân chỉ đi với 1 chữ ký: pháp nhân vừa gán sẽ bị gỡ khỏi các chữ ký khác.
CREATE OR REPLACE FUNCTION legal_signature_save(
  p_token text, p_id uuid, p_owner text, p_original text, p_settings jsonb, p_entity_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_id uuid := p_id; v_ids uuid[] := coalesce(p_entity_ids, '{}');
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin quản lý kho chữ ký'; END IF;
  IF jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'Cài đặt chữ ký không hợp lệ'; END IF;
  IF p_original IS NOT NULL AND (length(p_original) > 900000 OR p_original !~ '^data:image/(png|jpeg|webp);base64,') THEN
    RAISE EXCEPTION 'Chỉ nhận ảnh PNG, JPEG hoặc WebP, tối đa khoảng 650 KB';
  END IF;
  IF v_id IS NULL THEN
    IF p_original IS NULL THEN RAISE EXCEPTION 'Chưa có ảnh chữ ký'; END IF;
    IF (SELECT count(*) FROM legal_signatures) >= 60 THEN RAISE EXCEPTION 'Kho chữ ký tối đa 60 chữ ký'; END IF;
    INSERT INTO legal_signatures (owner_name, original, settings, entity_ids, created_by, updated_by)
    VALUES (trim(coalesce(p_owner, '')), p_original, coalesce(p_settings, '{}'::jsonb), v_ids, u.full_name, u.full_name)
    RETURNING id INTO v_id;
  ELSE
    UPDATE legal_signatures SET
      owner_name = trim(coalesce(p_owner, owner_name)),
      original = coalesce(p_original, original),
      settings = coalesce(p_settings, settings),
      entity_ids = v_ids, updated_by = u.full_name, updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Chữ ký không còn trong kho'; END IF;
  END IF;
  UPDATE legal_signatures SET entity_ids = array(SELECT e FROM unnest(entity_ids) e WHERE e <> ALL (v_ids)), updated_at = now()
  WHERE id <> v_id AND entity_ids && v_ids;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
GRANT EXECUTE ON FUNCTION legal_signature_save(text, uuid, text, text, jsonb, uuid[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION legal_signature_delete(p_token text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin quản lý kho chữ ký'; END IF;
  DELETE FROM legal_signatures WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION legal_signature_delete(text, uuid) TO anon, authenticated;
