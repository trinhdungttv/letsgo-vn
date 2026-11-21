-- ============================================================================
-- 230 — KHO CHỮ KÝ (Workspace → Pháp lý → tab "Chữ ký")
-- ----------------------------------------------------------------------------
-- Kho chữ ký CHUNG: tải ảnh GỐC (chưa tách nền) lên 1 lần. Khi làm giấy tờ (báo giá, danh sách vào cổng) chọn chữ ký của ai ký lần đó;
-- app tự tách nền / làm đậm / lên màu mực. Nhân viên dùng được (admin nhận báo qua stamp_alerts như chữ ký ở pháp nhân).
--
--   legal_signatures: owner_name (chủ chữ ký), original (data URL ảnh gốc, tối đa ~650 KB), settings jsonb {cutout, ink, title},
--                     entity_ids (chừa sẵn, hiện không dùng — chữ ký là CHUNG, người làm giấy tờ chọn ai ký)
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

-- Thêm (p_id NULL) hoặc sửa. p_original NULL = giữ ảnh cũ. Chữ ký là CHUNG (không gắn cố định với pháp nhân) —
-- khi làm giấy tờ, người làm chọn chữ ký của ai ký lần đó.
DROP FUNCTION IF EXISTS legal_signature_save(text, uuid, text, text, jsonb, uuid[]);
CREATE OR REPLACE FUNCTION legal_signature_save(
  p_token text, p_id uuid, p_owner text, p_original text, p_settings jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_id uuid := p_id;
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
    INSERT INTO legal_signatures (owner_name, original, settings, created_by, updated_by)
    VALUES (trim(coalesce(p_owner, '')), p_original, coalesce(p_settings, '{}'::jsonb), u.full_name, u.full_name)
    RETURNING id INTO v_id;
  ELSE
    UPDATE legal_signatures SET
      owner_name = trim(coalesce(p_owner, owner_name)),
      original = coalesce(p_original, original),
      settings = coalesce(p_settings, settings),
      updated_by = u.full_name, updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Chữ ký không còn trong kho'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
GRANT EXECUTE ON FUNCTION legal_signature_save(text, uuid, text, text, jsonb) TO anon, authenticated;

-- Danh sách để CHỌN người ký khi làm giấy tờ: mọi tài khoản đăng nhập, KHÔNG kèm ảnh.
CREATE OR REPLACE FUNCTION legal_signature_pick_list(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'owner_name', s.owner_name, 'title', coalesce(s.settings->>'title', ''))
                                    ORDER BY s.owner_name, s.created_at) FROM legal_signatures s), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION legal_signature_pick_list(text) TO anon, authenticated;

-- Lấy ảnh 1 chữ ký trong kho để làm giấy tờ. Như quote_entity_stamp: mọi tài khoản được, mỗi lần ghi stamp_alerts
-- (cùng người + cùng chữ ký + cùng giấy tờ trong 30 phút → gộp 1 dòng) để ADMIN được báo; admin tự dùng ghi luôn "đã xem".
CREATE OR REPLACE FUNCTION legal_signature_stamp(p_token text, p_id uuid, p_purpose text, p_context text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; s legal_signatures%ROWTYPE; v_alert bigint; v_admin boolean; v_label text;
  v_purpose text := left(coalesce(p_purpose, ''), 40); v_context text := left(coalesce(p_context, ''), 300);
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  v_admin := (u.role = 'admin');
  SELECT * INTO s FROM legal_signatures WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chữ ký này không còn trong kho'; END IF;
  v_label := left('Chữ ký ' || coalesce(nullif(s.owner_name, ''), '(chưa đặt tên)'), 120);
  SELECT id INTO v_alert FROM stamp_alerts
  WHERE actor_id = u.user_id AND stamp_id IS NULL AND entity_label = v_label AND purpose = v_purpose AND context = v_context
    AND created_at > now() - interval '30 minutes'
  ORDER BY created_at DESC LIMIT 1;
  IF v_alert IS NOT NULL THEN
    UPDATE stamp_alerts SET last_action_at = now() WHERE id = v_alert;
  ELSE
    INSERT INTO stamp_alerts (actor_id, actor_name, actor_role, stamp_id, entity_label, company_name, parts, purpose, context,
                              actions, last_action_at, seen_at, seen_by)
    VALUES (u.user_id, coalesce(u.full_name, ''), coalesce(u.role, ''), NULL, v_label, '', ARRAY['signature'], v_purpose, v_context,
            ARRAY['preview'], now(), CASE WHEN v_admin THEN now() END, CASE WHEN v_admin THEN u.full_name END)
    RETURNING id INTO v_alert;
  END IF;
  RETURN jsonb_build_object('alert_id', v_alert, 'original', s.original, 'settings', s.settings, 'owner_name', s.owner_name);
END $$;
GRANT EXECUTE ON FUNCTION legal_signature_stamp(text, uuid, text, text) TO anon, authenticated;

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
