-- ============================================================================
-- 219 — PHÁP NHÂN LẤY TỪ PHÁP LÝ + NHÂN VIÊN DÙNG ĐƯỢC CHỮ KÝ / CON DẤU (BÁO NGAY CHO ADMIN)
-- ----------------------------------------------------------------------------
-- 1. quote_entities (bảng pháp nhân của Phương án giá / Đi họp, migration 161) nay chỉ còn là "BỘ KÝ / DẤU":
--    chữ ký, con dấu, cách căn, nơi ký, logo riêng. THÔNG TIN pháp nhân (tên, viết tắt, MST, địa chỉ, ĐT,
--    người đại diện, logo) lấy từ Pháp lý (legal_entities, migration 201) — app tự gộp.
--    + cột legal_entity_id: bộ ký/dấu này của pháp nhân nào bên Pháp lý (mỗi pháp nhân tối đa 1 bộ).
--    + gắn sẵn 1 lần các bộ mà Pháp lý đã ghi quote_entity_id (nút "Lấy từ pháp nhân báo giá").
--    + quote_entity_save nhận thêm p_legal_entity_id, bỏ giới hạn 5 (nay tối đa 30).
-- 2. CHỮ KÝ / CON DẤU: trước đây chỉ admin lấy được ảnh. Nay MỌI tài khoản đang đăng nhập lấy được để làm giấy tờ
--    (báo giá PDF / Excel, danh sách vào cổng) qua quote_entity_stamp — mỗi lần lấy ghi 1 dòng stamp_alerts
--    (ai, pháp nhân nào, chữ ký hay con dấu, làm giấy tờ gì, đã xuất PDF / Excel / In chưa) và app của ADMIN
--    hiện popup ngay. Danh sách quote_entity_list vẫn CHỈ trả ảnh cho admin (như cũ).
--    stamp_alerts KHOÁ HẲN (REVOKE ALL, RLS không policy) — chỉ đọc qua RPC với token admin.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 1 cột + 1 bảng + hàm mới; gắn legal_entity_id cho các
-- bộ đã biết. Hàm quote_entity_save cũ (8 tham số) được DROP rồi tạo lại có thêm tham số (chỉ là hàm, không phải dữ liệu).
-- Cần chạy SAU 157 (cp_session), 161 (quote_entities), 201 (legal_entities). Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

SET search_path = public, extensions;

-- ── 1. Bộ ký/dấu gắn với pháp nhân Pháp lý ──────────────────────────────────
ALTER TABLE quote_entities ADD COLUMN IF NOT EXISTS legal_entity_id uuid;      -- legal_entities.id (không FK — bài học PGRST201)
CREATE UNIQUE INDEX IF NOT EXISTS quote_entities_legal_uq ON quote_entities(legal_entity_id) WHERE legal_entity_id IS NOT NULL;

UPDATE quote_entities q SET legal_entity_id = l.id
FROM legal_entities l
WHERE l.quote_entity_id = q.id AND l.deleted_at IS NULL AND q.legal_entity_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM quote_entities q2 WHERE q2.legal_entity_id = l.id);

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
    'can_stamp', true,
    'entities', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'label', e.label, 'data', e.data, 'layout', e.layout, 'logo', e.logo_b64,
        'signature', CASE WHEN v_admin THEN e.signature_b64 END,
        'seal',      CASE WHEN v_admin THEN e.seal_b64 END,
        'has_signature', e.signature_b64 IS NOT NULL, 'has_seal', e.seal_b64 IS NOT NULL,
        'legal_entity_id', e.legal_entity_id,
        'sort_order', e.sort_order, 'updated_by_name', e.updated_by_name, 'updated_at', e.updated_at
      ) ORDER BY e.sort_order, e.created_at) FROM quote_entities e), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION quote_entity_list(text) TO anon, authenticated;

-- Thêm (p_id NULL) hoặc sửa. Với mỗi ảnh: NULL = giữ nguyên, '' = xoá, còn lại = ảnh mới (data URL).
-- p_legal_entity_id: gắn bộ này vào pháp nhân Pháp lý; pháp nhân đó đã có bộ → sửa bộ đó (không tạo trùng).
DROP FUNCTION IF EXISTS quote_entity_save(text, uuid, text, jsonb, jsonb, text, text, text);
CREATE OR REPLACE FUNCTION quote_entity_save(
  p_token text, p_id uuid, p_label text, p_data jsonb, p_layout jsonb, p_logo text, p_signature text, p_seal text,
  p_legal_entity_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_id uuid; v_target uuid := p_id; v_label text;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin được sửa pháp nhân, chữ ký và con dấu'; END IF;
  v_label := nullif(trim(coalesce(p_label, '')), '');
  IF v_label IS NULL AND p_legal_entity_id IS NULL THEN RAISE EXCEPTION 'Chưa đặt tên gọi cho pháp nhân'; END IF;
  IF jsonb_typeof(p_data) <> 'object' OR jsonb_typeof(p_layout) <> 'object' THEN RAISE EXCEPTION 'Dữ liệu không hợp lệ'; END IF;
  IF length(coalesce(p_logo, '')) > 900000 OR length(coalesce(p_signature, '')) > 900000 OR length(coalesce(p_seal, '')) > 900000 THEN
    RAISE EXCEPTION 'Ảnh quá lớn (mỗi ảnh tối đa khoảng 650 KB)';
  END IF;
  IF (p_logo IS NOT NULL AND p_logo <> '' AND p_logo !~ '^data:image/(png|jpeg|webp);base64,')
     OR (p_signature IS NOT NULL AND p_signature <> '' AND p_signature !~ '^data:image/(png|jpeg|webp);base64,')
     OR (p_seal IS NOT NULL AND p_seal <> '' AND p_seal !~ '^data:image/(png|jpeg|webp);base64,') THEN
    RAISE EXCEPTION 'Chỉ nhận ảnh PNG, JPEG hoặc WebP';
  END IF;

  IF p_legal_entity_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM legal_entities WHERE id = p_legal_entity_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Pháp nhân này không còn trong Pháp lý';
    END IF;
    IF v_label IS NULL THEN
      SELECT coalesce(nullif(trim(short_name), ''), nullif(trim(name), ''), 'Pháp nhân') INTO v_label FROM legal_entities WHERE id = p_legal_entity_id;
    END IF;
    IF v_target IS NULL THEN
      SELECT id INTO v_target FROM quote_entities WHERE legal_entity_id = p_legal_entity_id;
    ELSIF EXISTS (SELECT 1 FROM quote_entities WHERE legal_entity_id = p_legal_entity_id AND id <> v_target) THEN
      RAISE EXCEPTION 'Pháp nhân này đã có bộ chữ ký / con dấu khác — xoá bộ kia trước khi gắn';
    END IF;
  END IF;

  IF v_target IS NULL THEN
    IF (SELECT count(*) FROM quote_entities) >= 30 THEN RAISE EXCEPTION 'Tối đa 30 pháp nhân'; END IF;
    INSERT INTO quote_entities (label, data, layout, logo_b64, signature_b64, seal_b64, sort_order, updated_by_name, legal_entity_id)
    VALUES (v_label, p_data, p_layout, nullif(p_logo, ''), nullif(p_signature, ''), nullif(p_seal, ''),
            coalesce((SELECT max(sort_order) + 1 FROM quote_entities), 0), u.full_name, p_legal_entity_id)
    RETURNING id INTO v_id;
  ELSE
    UPDATE quote_entities SET
      label = v_label, data = p_data, layout = p_layout,
      logo_b64      = CASE WHEN p_logo      IS NULL THEN logo_b64      ELSE nullif(p_logo, '')      END,
      signature_b64 = CASE WHEN p_signature IS NULL THEN signature_b64 ELSE nullif(p_signature, '') END,
      seal_b64      = CASE WHEN p_seal      IS NULL THEN seal_b64      ELSE nullif(p_seal, '')      END,
      legal_entity_id = coalesce(p_legal_entity_id, legal_entity_id),
      updated_by_name = u.full_name, updated_at = now()
    WHERE id = v_target RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Pháp nhân không còn tồn tại'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
GRANT EXECUTE ON FUNCTION quote_entity_save(text, uuid, text, jsonb, jsonb, text, text, text, uuid) TO anon, authenticated;

-- ── 2. Nhật ký dùng chữ ký / con dấu (báo admin) ────────────────────────────
CREATE TABLE IF NOT EXISTS stamp_alerts (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid,
  actor_name      text NOT NULL DEFAULT '',
  actor_role      text NOT NULL DEFAULT '',
  stamp_id        uuid,                              -- quote_entities.id
  entity_label    text NOT NULL DEFAULT '',          -- tên viết tắt pháp nhân lúc dùng
  company_name    text NOT NULL DEFAULT '',
  parts           text[] NOT NULL DEFAULT '{}',      -- signature | seal
  purpose         text NOT NULL DEFAULT '',          -- gate_list | quote_pdf | quote_excel
  context         text NOT NULL DEFAULT '',          -- "Danh sách vào cổng TTI · 11/11/2026"
  actions         text[] NOT NULL DEFAULT '{}',      -- preview | pdf | xlsx | print
  last_action_at  timestamptz,
  seen_at         timestamptz,                       -- admin bấm "Đã biết"
  seen_by         text
);
CREATE INDEX IF NOT EXISTS stamp_alerts_recent ON stamp_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS stamp_alerts_unseen ON stamp_alerts(created_at DESC) WHERE seen_at IS NULL;
ALTER TABLE stamp_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stamp_alerts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE stamp_alerts_id_seq FROM anon, authenticated;

-- Lấy ảnh chữ ký / con dấu để làm giấy tờ. Mọi tài khoản đang đăng nhập đều được — mỗi lần ghi stamp_alerts
-- (cùng người + cùng pháp nhân + cùng giấy tờ trong 30 phút → gộp 1 dòng). Admin tự dùng thì ghi luôn "đã xem".
CREATE OR REPLACE FUNCTION quote_entity_stamp(p_token text, p_id uuid, p_parts text[], p_purpose text, p_context text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; e quote_entities%ROWTYPE; v_parts text[]; v_alert bigint; v_label text; v_company text;
  v_purpose text := left(coalesce(p_purpose, ''), 40); v_context text := left(coalesce(p_context, ''), 300); v_admin boolean;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  v_admin := (u.role = 'admin');
  SELECT * INTO e FROM quote_entities WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pháp nhân này chưa có chữ ký / con dấu'; END IF;
  v_parts := ARRAY(
    SELECT x FROM unnest(ARRAY['signature', 'seal']) x
    WHERE x = ANY(coalesce(p_parts, '{}'))
      AND ((x = 'signature' AND e.signature_b64 IS NOT NULL) OR (x = 'seal' AND e.seal_b64 IS NOT NULL)));
  IF cardinality(v_parts) = 0 THEN RAISE EXCEPTION 'Pháp nhân này chưa có ảnh chữ ký / con dấu'; END IF;

  IF e.legal_entity_id IS NOT NULL THEN
    SELECT coalesce(nullif(trim(l.short_name), ''), nullif(trim(l.name), '')), nullif(trim(l.name), '')
      INTO v_label, v_company FROM legal_entities l WHERE l.id = e.legal_entity_id;
  END IF;
  v_label := coalesce(v_label, e.label);
  v_company := coalesce(v_company, nullif(trim(e.data->>'name'), ''), '');

  SELECT id INTO v_alert FROM stamp_alerts
  WHERE actor_id = u.user_id AND stamp_id = e.id AND purpose = v_purpose AND context = v_context
    AND created_at > now() - interval '30 minutes'
  ORDER BY created_at DESC LIMIT 1;

  IF v_alert IS NOT NULL THEN
    UPDATE stamp_alerts SET
      seen_at = CASE WHEN v_admin OR parts @> v_parts THEN seen_at ELSE NULL END,
      seen_by = CASE WHEN v_admin OR parts @> v_parts THEN seen_by ELSE NULL END,
      parts = ARRAY(SELECT x FROM unnest(ARRAY['signature', 'seal']) x WHERE x = ANY(parts) OR x = ANY(v_parts)),
      last_action_at = now()
    WHERE id = v_alert;
  ELSE
    INSERT INTO stamp_alerts (actor_id, actor_name, actor_role, stamp_id, entity_label, company_name, parts, purpose, context,
                              actions, last_action_at, seen_at, seen_by)
    VALUES (u.user_id, coalesce(u.full_name, ''), coalesce(u.role, ''), e.id, v_label, v_company, v_parts, v_purpose, v_context,
            ARRAY['preview'], now(), CASE WHEN v_admin THEN now() END, CASE WHEN v_admin THEN u.full_name END)
    RETURNING id INTO v_alert;
  END IF;

  RETURN jsonb_build_object(
    'alert_id', v_alert,
    'signature', CASE WHEN 'signature' = ANY(v_parts) THEN e.signature_b64 END,
    'seal',      CASE WHEN 'seal' = ANY(v_parts) THEN e.seal_b64 END);
END $$;
GRANT EXECUTE ON FUNCTION quote_entity_stamp(text, uuid, text[], text, text) TO anon, authenticated;

-- Ghi "đã xuất PDF / Excel / In" vào dòng nhật ký của chính mình. Thao tác mới (chưa có) → admin được báo lại.
CREATE OR REPLACE FUNCTION quote_stamp_mark(p_token text, p_alert_id bigint, p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF p_action NOT IN ('pdf', 'xlsx', 'print') THEN RAISE EXCEPTION 'Thao tác không hợp lệ'; END IF;
  UPDATE stamp_alerts SET
    seen_at = CASE WHEN p_action = ANY(actions) OR actor_role = 'admin' THEN seen_at ELSE NULL END,
    seen_by = CASE WHEN p_action = ANY(actions) OR actor_role = 'admin' THEN seen_by ELSE NULL END,
    actions = CASE WHEN p_action = ANY(actions) THEN actions ELSE actions || p_action END,
    last_action_at = now()
  WHERE id = p_alert_id AND actor_id = u.user_id;
END $$;
GRANT EXECUTE ON FUNCTION quote_stamp_mark(text, bigint, text) TO anon, authenticated;

-- Admin: danh sách gần đây (chưa xem lên đầu) + số chưa xem.
CREATE OR REPLACE FUNCTION stamp_alert_list(p_token text, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin xem được nhật ký dùng chữ ký / con dấu'; END IF;
  RETURN jsonb_build_object(
    'unseen', (SELECT count(*) FROM stamp_alerts WHERE seen_at IS NULL),
    'items', coalesce((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY (a.seen_at IS NULL) DESC, coalesce(a.last_action_at, a.created_at) DESC)
      FROM (
        SELECT * FROM stamp_alerts
        ORDER BY (seen_at IS NULL) DESC, coalesce(last_action_at, created_at) DESC
        LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
      ) a), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION stamp_alert_list(text, int) TO anon, authenticated;

-- Admin bấm "Đã biết". p_ids NULL = tất cả đang chưa xem.
CREATE OR REPLACE FUNCTION stamp_alert_seen(p_token text, p_ids bigint[] DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; n int;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION 'Chỉ admin'; END IF;
  UPDATE stamp_alerts SET seen_at = now(), seen_by = u.full_name
  WHERE seen_at IS NULL AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION stamp_alert_seen(text, bigint[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Kiểm tra nhanh sau khi chạy (tuỳ chọn):
--   SELECT count(*) FILTER (WHERE legal_entity_id IS NOT NULL) AS da_gan_phap_ly, count(*) AS tong FROM quote_entities;
--   SELECT to_regclass('public.stamp_alerts') IS NOT NULL AS co_bang_nhat_ky;
