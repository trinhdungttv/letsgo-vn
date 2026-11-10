-- ============================================================================
-- 217 — ĐI HỌP (CSKH → tab "Đi họp", cạnh "Sự kiện & Quà tặng")
-- ----------------------------------------------------------------------------
--   meeting_members   thành viên hay đi họp (Ban điều hành…): họ tên, giới tính, năm sinh, CCCD, ngày cấp,
--                     nơi cấp, địa chỉ thường trú, chức vụ, SĐT, biển số xe — đủ để in "Danh sách đăng ký ra vào cổng"
--   meetings          lịch đi họp: ngày giờ, công ty (clients.id + tên chụp lại), địa điểm / cổng, nội dung,
--                     pháp nhân đứng tên danh sách (quote_entities.id — DÙNG CHUNG với Phương án giá: tên công ty,
--                     địa chỉ, logo, chữ ký, con dấu), thành viên tham dự (attendees, có thể ghi chức vụ riêng
--                     cho buổi đó), người bên khách (contacts.id), trạng thái, kết quả, tuỳ chọn bản in (gate)
--
-- BẢO MẬT: meeting_members chứa SỐ CCCD + địa chỉ thường trú. Bảng khác của app đọc được bằng anon key (nằm sẵn
-- trong file JS) → 2 bảng này KHOÁ HẲN (REVOKE ALL, không policy) như recruit_* (180). Mọi đọc/ghi đi qua
-- meeting_rpc(p_token, p_action, p_args): kiểm phiên đăng nhập (cp_session — migration 157) + quyền module
-- 'Đi họp' trong role_permissions (admin luôn được; 'view' = chỉ xem).
-- KHÔNG gắn trigger data_history (bảng đó đọc được bằng anon → lộ CCCD). Hàm dh_attach_triggers() bản 185 tự bỏ
-- qua bảng bật RLS mà không có policy cho anon, nên chạy lại hàm đó cũng không gắn vào đây.
-- Xoá = xoá mềm (deleted_at), dữ liệu vẫn còn trong DB.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO 2 bảng + hàm mới + thêm dòng quyền 'Đi họp'.
-- Cần chạy SAU migration 157 (cp_session) và 161 (quote_entities — pháp nhân). Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

SET search_path = public, extensions;

-- ── 1. Bảng ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      text NOT NULL,
  gender         text NOT NULL DEFAULT '' CHECK (gender IN ('', 'Nam', 'Nữ')),
  -- "1983" hoặc "12/03/1983" — in ra y như nhập (cổng nhà máy thường chỉ cần năm sinh)
  birth          text NOT NULL DEFAULT '',
  id_number      text NOT NULL DEFAULT '',
  id_issued_on   date,
  id_issued_by   text NOT NULL DEFAULT '',
  address        text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  vehicle_plate  text NOT NULL DEFAULT '',
  note           text NOT NULL DEFAULT '',
  active         boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE IF NOT EXISTS meetings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_date     date NOT NULL,
  meet_time     text NOT NULL DEFAULT '' CHECK (meet_time = '' OR meet_time ~ '^\d{2}:\d{2}$'),
  -- Không khoá ngoại: công ty có thể bị lưu trữ/xoá, tên chụp lại ở company_name vẫn in đúng danh sách cũ
  client_id     uuid,
  company_name  text NOT NULL DEFAULT '',
  location      text NOT NULL DEFAULT '',
  purpose       text NOT NULL DEFAULT '',
  entity_id     uuid,
  -- [{ "id": <meeting_members.id>, "title": "<chức vụ riêng buổi này, trống = theo hồ sơ>" }] — đúng thứ tự in
  attendees     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attendees) = 'array'),
  contact_ids   uuid[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  note          text NOT NULL DEFAULT '',
  result        text NOT NULL DEFAULT '',
  -- Tuỳ chọn bản "Danh sách đăng ký ra vào cổng" của buổi này (ngày ký, kính gửi, cột thêm…)
  gate          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(gate) = 'object'),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meet_date DESC) WHERE deleted_at IS NULL;

-- ── 2. Khoá bảng: chỉ đi qua meeting_rpc ───────────────────────────────────
ALTER TABLE meeting_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON meeting_members FROM anon, authenticated;
REVOKE ALL ON meetings FROM anon, authenticated;
-- Lỡ có trigger lịch sử từ trước (chạy dh_attach_triggers bản cũ) → gỡ
DROP TRIGGER IF EXISTS dh_track ON meeting_members;
DROP TRIGGER IF EXISTS dh_track ON meetings;

-- ── 3. Quyền module ────────────────────────────────────────────────────────
INSERT INTO role_permissions (role, module, level, updated_at) VALUES
  ('admin', 'Đi họp', 'full', now()),
  ('bdh', 'Đi họp', 'full', now()),
  ('kinhdoanh', 'Đi họp', 'full', now()),
  ('ketoan', 'Đi họp', 'none', now())
ON CONFLICT (role, module) DO NOTHING;

-- ── 4. Hàm nội bộ (không cấp cho anon) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION meeting_session(p_token text)
RETURNS TABLE (user_id uuid, full_name text, role text, level text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  s record;
  v_level text;
BEGIN
  SELECT * INTO s FROM cp_session(p_token) LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  IF s.role = 'admin' THEN
    v_level := 'full';
  ELSE
    SELECT rp.level INTO v_level FROM role_permissions rp WHERE rp.role = s.role AND rp.module = 'Đi họp';
    v_level := coalesce(v_level, 'none');
  END IF;
  IF v_level = 'none' THEN
    RAISE EXCEPTION 'Tài khoản chưa được cấp quyền module Đi họp';
  END IF;
  RETURN QUERY SELECT s.user_id, s.full_name, s.role, v_level;
END $$;
REVOKE ALL ON FUNCTION meeting_session(text) FROM PUBLIC, anon, authenticated;

-- Ghi các cột có trong p_args vào 1 dòng (lấy danh sách cột từ bảng → thêm cột sau không phải sửa hàm).
-- Không bao giờ ghi id / created_* / updated_at / deleted_at. "" vào cột được để trống → NULL (ngày…);
-- null vào cột text NOT NULL → "", vào uuid[] NOT NULL → {}; chữ được cắt khoảng trắng 2 đầu.
CREATE OR REPLACE FUNCTION meeting__patch(p_table regclass, p_id uuid, p_args jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_set text;
  v_args jsonb;
BEGIN
  SELECT
    jsonb_object_agg(a.attname, CASE
      WHEN NOT a.attnotnull AND p_args->a.attname = '""'::jsonb THEN 'null'::jsonb
      WHEN a.attnotnull AND format_type(a.atttypid, a.atttypmod) = 'text' AND jsonb_typeof(p_args->a.attname) = 'null' THEN '""'::jsonb
      WHEN a.attnotnull AND format_type(a.atttypid, a.atttypmod) = 'uuid[]' AND jsonb_typeof(p_args->a.attname) = 'null' THEN '[]'::jsonb
      -- chữ: bỏ khoảng trắng thừa 2 đầu (họ tên, CCCD dán từ nơi khác hay dính dấu cách)
      WHEN format_type(a.atttypid, a.atttypmod) = 'text' AND jsonb_typeof(p_args->a.attname) = 'string' THEN to_jsonb(btrim(p_args->>a.attname))
      ELSE p_args->a.attname END),
    string_agg(format('%I = (jsonb_populate_record(NULL::%s, $1)).%I', a.attname, p_table, a.attname), ', ')
  INTO v_args, v_set
  FROM pg_attribute a
  WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
    AND p_args ? a.attname
    AND NOT (a.attname = ANY (ARRAY['id', 'created_at', 'created_by', 'updated_at', 'deleted_at']));
  IF v_set IS NULL THEN RETURN; END IF;
  EXECUTE format('UPDATE %s SET %s, updated_at = now() WHERE id = $2', p_table, v_set) USING v_args, p_id;
END $$;
REVOKE ALL ON FUNCTION meeting__patch(regclass, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- CCCD so khớp: chỉ giữ chữ số
CREATE OR REPLACE FUNCTION meeting__digits(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

-- Kiểm 1 thành viên trước khi ghi (p_id = dòng đang sửa, NULL = thêm mới). Trả câu lỗi hoặc NULL.
CREATE OR REPLACE FUNCTION meeting__check_member(p_id uuid, a jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_dup text;
BEGIN
  IF a ? 'full_name' AND btrim(coalesce(a->>'full_name', '')) = '' THEN RETURN 'Nhập họ tên'; END IF;
  IF a ? 'gender' AND coalesce(a->>'gender', '') NOT IN ('', 'Nam', 'Nữ') THEN RETURN 'Giới tính chỉ nhận Nam / Nữ'; END IF;
  IF a ? 'id_issued_on' AND coalesce(a->>'id_issued_on', '') <> '' AND (a->>'id_issued_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN 'Ngày cấp không hợp lệ';
  END IF;
  IF meeting__digits(a->>'id_number') <> '' THEN
    SELECT m.full_name INTO v_dup FROM meeting_members m
    WHERE m.deleted_at IS NULL AND m.id IS DISTINCT FROM p_id AND meeting__digits(m.id_number) = meeting__digits(a->>'id_number')
    LIMIT 1;
    IF v_dup IS NOT NULL THEN RETURN format('Số CCCD %s đã có ở thành viên %s', a->>'id_number', v_dup); END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION meeting__check_member(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 5. Cổng duy nhất: meeting_rpc ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION meeting_rpc(p_token text, p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_id uuid;
  v_err text;
  v_row jsonb;
  v_ins int := 0;
  v_upd int := 0;
  v_i int := 0;
  v_name text;
  v_patch jsonb;
BEGIN
  SELECT * INTO u FROM meeting_session(p_token);
  IF u.level <> 'full' AND p_action <> 'bootstrap' THEN
    RAISE EXCEPTION 'Tài khoản chỉ có quyền xem module Đi họp';
  END IF;

  CASE p_action
  WHEN 'bootstrap' THEN
    -- Trả cả thành viên đã xoá (deleted_at) để buổi họp cũ vẫn hiện đúng tên; giao diện chỉ liệt kê người còn.
    RETURN jsonb_build_object(
      'me', jsonb_build_object('name', u.full_name, 'role', u.role, 'level', u.level),
      'members', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.sort_order, m.created_at) FROM meeting_members m), '[]'::jsonb),
      'meetings', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.meet_date DESC, x.meet_time DESC)
                            FROM (SELECT * FROM meetings WHERE deleted_at IS NULL ORDER BY meet_date DESC LIMIT 1000) x), '[]'::jsonb));

  -- ── Thành viên ──
  WHEN 'member.save' THEN
    v_id := nullif(a->>'id', '')::uuid;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meeting_members WHERE id = v_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Không tìm thấy thành viên (có thể đã bị xoá)';
    END IF;
    IF v_id IS NULL AND btrim(coalesce(a->>'full_name', '')) = '' THEN RAISE EXCEPTION 'Nhập họ tên'; END IF;
    v_err := meeting__check_member(v_id, a);
    IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
    IF v_id IS NULL THEN
      INSERT INTO meeting_members (full_name, sort_order, created_by)
      VALUES (btrim(a->>'full_name'), coalesce((SELECT max(sort_order) + 1 FROM meeting_members), 0), u.full_name)
      RETURNING id INTO v_id;
    END IF;
    PERFORM meeting__patch('meeting_members', v_id, a - 'sort_order');
    RETURN (SELECT to_jsonb(m) FROM meeting_members m WHERE m.id = v_id);

  WHEN 'member.delete' THEN
    UPDATE meeting_members SET deleted_at = now(), updated_at = now() WHERE id = (a->>'id')::uuid AND deleted_at IS NULL;
    RETURN jsonb_build_object('ok', true);

  WHEN 'member.reorder' THEN
    -- a.ids = mảng id theo thứ tự mới
    FOR v_id IN SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(coalesce(a->'ids', '[]'::jsonb)) x LOOP
      UPDATE meeting_members SET sort_order = v_i WHERE id = v_id;
      v_i := v_i + 1;
    END LOOP;
    RETURN jsonb_build_object('ok', true);

  WHEN 'member.import' THEN
    -- a.rows = [{full_name, gender, birth, id_number, id_issued_on, id_issued_by, address, title, …}]
    -- Trùng số CCCD với người đang có → cập nhật các ô có chữ (ô trống giữ nguyên); không có CCCD → trùng họ tên thì cập nhật.
    FOR v_row IN SELECT x FROM jsonb_array_elements(coalesce(a->'rows', '[]'::jsonb)) x LOOP
      v_name := btrim(coalesce(v_row->>'full_name', ''));
      CONTINUE WHEN v_name = '';
      v_patch := (SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(v_row) e(k, v)
                  WHERE k IN ('full_name', 'gender', 'birth', 'id_number', 'id_issued_on', 'id_issued_by', 'address', 'title', 'phone', 'vehicle_plate', 'note')
                    AND jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') <> '');
      IF v_patch ? 'gender' AND (v_patch->>'gender') NOT IN ('Nam', 'Nữ') THEN v_patch := v_patch - 'gender'; END IF;
      IF v_patch ? 'id_issued_on' AND (v_patch->>'id_issued_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN v_patch := v_patch - 'id_issued_on'; END IF;
      v_id := NULL;
      IF meeting__digits(v_patch->>'id_number') <> '' THEN
        SELECT id INTO v_id FROM meeting_members
        WHERE deleted_at IS NULL AND meeting__digits(id_number) = meeting__digits(v_patch->>'id_number') LIMIT 1;
      ELSE
        SELECT id INTO v_id FROM meeting_members
        WHERE deleted_at IS NULL AND lower(btrim(full_name)) = lower(v_name) AND meeting__digits(id_number) = '' LIMIT 1;
      END IF;
      IF v_id IS NULL THEN
        INSERT INTO meeting_members (full_name, sort_order, created_by)
        VALUES (v_name, coalesce((SELECT max(sort_order) + 1 FROM meeting_members), 0), u.full_name)
        RETURNING id INTO v_id;
        v_ins := v_ins + 1;
      ELSE
        v_upd := v_upd + 1;
      END IF;
      PERFORM meeting__patch('meeting_members', v_id, v_patch);
    END LOOP;
    RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd);

  -- ── Lịch họp ──
  WHEN 'meeting.save' THEN
    v_id := nullif(a->>'id', '')::uuid;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meetings WHERE id = v_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Không tìm thấy buổi họp (có thể đã bị xoá)';
    END IF;
    IF a ? 'meet_date' AND coalesce(a->>'meet_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Chọn ngày họp'; END IF;
    IF v_id IS NULL AND NOT (a ? 'meet_date') THEN RAISE EXCEPTION 'Chọn ngày họp'; END IF;
    IF a ? 'meet_time' AND coalesce(a->>'meet_time', '') <> '' AND (a->>'meet_time') !~ '^\d{2}:\d{2}$' THEN RAISE EXCEPTION 'Giờ họp không hợp lệ'; END IF;
    IF a ? 'status' AND coalesce(a->>'status', '') NOT IN ('planned', 'done', 'cancelled') THEN RAISE EXCEPTION 'Trạng thái không hợp lệ'; END IF;
    IF a ? 'attendees' AND jsonb_typeof(a->'attendees') <> 'array' THEN RAISE EXCEPTION 'Danh sách tham dự không hợp lệ'; END IF;
    IF a ? 'gate' AND jsonb_typeof(a->'gate') <> 'object' THEN RAISE EXCEPTION 'Tuỳ chọn danh sách vào cổng không hợp lệ'; END IF;
    IF v_id IS NULL THEN
      INSERT INTO meetings (meet_date, created_by) VALUES ((a->>'meet_date')::date, u.full_name) RETURNING id INTO v_id;
    END IF;
    PERFORM meeting__patch('meetings', v_id, a);
    RETURN (SELECT to_jsonb(m) FROM meetings m WHERE m.id = v_id);

  WHEN 'meeting.delete' THEN
    UPDATE meetings SET deleted_at = now(), updated_at = now() WHERE id = (a->>'id')::uuid AND deleted_at IS NULL;
    RETURN jsonb_build_object('ok', true);

  ELSE
    RAISE EXCEPTION 'Thao tác không hỗ trợ: %', p_action;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION meeting_rpc(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meeting_rpc(text, text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
