-- 157: Phương án giá (Workspace → "Phương án giá") — lên phương án tính báo giá theo ngành nghề,
-- lưu lại để gợi ý cho các lần sau (theo KCN + ngành), và chia sẻ qua LINK NGẮN + MÃ PIN 4 SỐ cho
-- đồng nghiệp xem / chỉnh / kéo tỷ lệ trước khi chốt.
--
-- BẢO MẬT: dữ liệu phương án chứa cơ cấu giá & lợi nhuận nội bộ nên 3 bảng dưới đây KHÔNG mở cho
-- anon đọc/ghi trực tiếp (khác các bảng còn lại của app). Mọi truy cập đi qua hàm SECURITY DEFINER:
--   • trong app  : cần session token đăng nhập (cùng cơ chế migration 061/062 của khoản vay)
--   • qua link   : cần mã link + PIN 4 số; PIN lưu dạng băm bcrypt, sai 5 lần thì khoá tạm
--                  (15 phút, nhân đôi sau mỗi lần khoá lại, tối đa 24 giờ) — kiểm tra ở SERVER.

SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═════════════════════════ BẢNG ═════════════════════════
CREATE TABLE IF NOT EXISTS cost_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL DEFAULT 'Phương án mới',
  industry        text,                                              -- tên ngành (industries.name)
  zone_name       text,                                              -- KCN / vùng (text để gõ tay được)
  zone_id         uuid REFERENCES market_zones(id) ON DELETE SET NULL,
  branch_id       uuid REFERENCES branches(id) ON DELETE SET NULL,
  pipeline_id     uuid REFERENCES crm_pipeline(id) ON DELETE SET NULL, -- khách ở CRM Pipeline BD
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
  company_name    text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'archived')),
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { settings, lines[], notes }
  summary         jsonb,                                -- số đã tính (giá/công, phí DV/công, LN tháng...) để gợi ý + liệt kê nhanh
  version         int  NOT NULL DEFAULT 1,
  created_by      uuid,
  created_by_name text,
  updated_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_plans_industry ON cost_plans(industry);
CREATE INDEX IF NOT EXISTS idx_cost_plans_zone ON cost_plans(zone_name);
CREATE INDEX IF NOT EXISTS idx_cost_plans_pipeline ON cost_plans(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_cost_plans_updated ON cost_plans(updated_at DESC);

-- Mỗi lần lưu 1 bản chụp → xem lại ai sửa gì (kể cả người sửa qua link), quay về bản cũ được.
CREATE TABLE IF NOT EXISTS cost_plan_revisions (
  id         bigserial PRIMARY KEY,
  plan_id    uuid NOT NULL REFERENCES cost_plans(id) ON DELETE CASCADE,
  version    int  NOT NULL,
  title      text,
  status     text,
  data       jsonb NOT NULL,
  summary    jsonb,
  editor     text,
  via        text NOT NULL DEFAULT 'app' CHECK (via IN ('app', 'link')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_plan_revisions_plan ON cost_plan_revisions(plan_id, id DESC);

CREATE TABLE IF NOT EXISTS cost_plan_shares (
  plan_id         uuid PRIMARY KEY REFERENCES cost_plans(id) ON DELETE CASCADE,
  code            text NOT NULL UNIQUE,                 -- mã link ngắn, 6 ký tự
  pin_hash        text NOT NULL,                        -- bcrypt của PIN 4 số
  can_edit        boolean NOT NULL DEFAULT true,
  expires_at      timestamptz,                          -- NULL = không hết hạn
  revoked         boolean NOT NULL DEFAULT false,
  failed_attempts int NOT NULL DEFAULT 0,
  lock_count      int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  open_count      int NOT NULL DEFAULT 0,
  last_opened_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cost_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_plan_shares    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cost_plans, cost_plan_revisions, cost_plan_shares FROM anon, authenticated;
REVOKE ALL ON SEQUENCE cost_plan_revisions_id_seq FROM anon, authenticated;

-- ── Loại 3 bảng này khỏi "Lịch sử & An toàn dữ liệu" (data_history đọc được từ client → sẽ làm
--    lộ nội dung phương án và pin_hash). Lịch sử sửa đã có cost_plan_revisions.
--    Viết lại dh_attach_triggers với danh sách loại trừ mở rộng (giữ nguyên các loại trừ cũ) để
--    các migration sau gọi lại hàm này không gắn trigger vào 3 bảng trên.
CREATE OR REPLACE FUNCTION dh_attach_triggers() RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t RECORD;
  n INT := 0;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        'data_history',
        'audit_logs',
        'loan_audit_log',
        'app_sessions',
        'ai_chat_messages',
        'google_connections',
        'cost_plans',
        'cost_plan_revisions',
        'cost_plan_shares'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS dh_track ON %I', t.tablename);
    EXECUTE format(
      'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dh_log_change()',
      t.tablename
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION dh_attach_triggers() FROM anon, authenticated, PUBLIC;
SELECT dh_attach_triggers();

-- ═════════════════════════ HÀM NỘI BỘ ═════════════════════════
CREATE OR REPLACE FUNCTION cp_session(p_token text)
RETURNS TABLE (user_id uuid, full_name text, role text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT u.id, u.full_name, u.role
  FROM app_sessions s JOIN app_users u ON u.id = s.user_id
  WHERE s.token = p_token AND s.expires_at > now() AND COALESCE(u.is_active, true) = true;
$$;
REVOKE ALL ON FUNCTION cp_session(text) FROM PUBLIC, anon, authenticated;

-- Mã link ngắn 6 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/I/L).
CREATE OR REPLACE FUNCTION cp_gen_code() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  i int;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM cost_plan_shares WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION cp_gen_code() FROM PUBLIC, anon, authenticated;

-- Kiểm tra mã link + PIN. KHÔNG dùng RAISE (raise sẽ huỷ luôn việc đếm số lần sai) mà trả jsonb.
CREATE OR REPLACE FUNCTION cp_share_check(p_code text, p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  s cost_plan_shares%ROWTYPE;
  v_secs int;
  v_lock_min int;
BEGIN
  SELECT * INTO s FROM cost_plan_shares WHERE code = upper(trim(coalesce(p_code, ''))) FOR UPDATE;
  IF NOT FOUND OR s.revoked THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF s.expires_at IS NOT NULL AND s.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF s.locked_until IS NOT NULL AND s.locked_until > now() THEN
    v_secs := ceil(extract(epoch FROM (s.locked_until - now())))::int;
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'seconds', v_secs);
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' OR s.pin_hash <> crypt(p_pin, s.pin_hash) THEN
    s.failed_attempts := s.failed_attempts + 1;
    IF s.failed_attempts >= 5 THEN
      v_lock_min := least(15 * power(2, s.lock_count)::int, 1440);
      UPDATE cost_plan_shares
        SET failed_attempts = 0, lock_count = lock_count + 1, locked_until = now() + make_interval(mins => v_lock_min)
        WHERE plan_id = s.plan_id;
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'seconds', v_lock_min * 60);
    END IF;
    UPDATE cost_plan_shares SET failed_attempts = s.failed_attempts WHERE plan_id = s.plan_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_pin', 'remaining', 5 - s.failed_attempts);
  END IF;

  IF s.failed_attempts <> 0 OR s.lock_count <> 0 THEN
    UPDATE cost_plan_shares SET failed_attempts = 0, lock_count = 0, locked_until = NULL WHERE plan_id = s.plan_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'plan_id', s.plan_id, 'can_edit', s.can_edit);
END $$;
REVOKE ALL ON FUNCTION cp_share_check(text, text) FROM PUBLIC, anon, authenticated;

-- Chỉ giữ 40 bản chụp mới nhất mỗi phương án.
CREATE OR REPLACE FUNCTION cp_prune_revisions(p_plan uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$
  DELETE FROM cost_plan_revisions
  WHERE plan_id = p_plan
    AND id NOT IN (SELECT id FROM cost_plan_revisions WHERE plan_id = p_plan ORDER BY id DESC LIMIT 40);
$$;
REVOKE ALL ON FUNCTION cp_prune_revisions(uuid) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════ HÀM TRONG APP (cần token) ═════════════════════════
CREATE OR REPLACE FUNCTION cost_plan_list(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(
      to_jsonb(p) || jsonb_build_object('share',
        CASE WHEN s.plan_id IS NULL THEN NULL ELSE jsonb_build_object(
          'code', s.code, 'can_edit', s.can_edit, 'expires_at', s.expires_at, 'revoked', s.revoked,
          'open_count', s.open_count, 'last_opened_at', s.last_opened_at,
          'locked_until', s.locked_until) END)
      ORDER BY p.updated_at DESC)
    FROM cost_plans p LEFT JOIN cost_plan_shares s ON s.plan_id = p.id
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_list(text) TO anon, authenticated;

-- Lưu (tạo mới khi p_id NULL). Có kiểm tra phiên bản: nếu đồng nghiệp vừa sửa qua link thì trả
-- reason='conflict' kèm bản mới nhất để người dùng chọn tải lại hoặc ghi đè (p_force = true).
CREATE OR REPLACE FUNCTION cost_plan_save(
  p_token text, p_id uuid, p_fields jsonb, p_expected_version int DEFAULT NULL,
  p_force boolean DEFAULT false, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  cur cost_plans%ROWTYPE;
  v_row cost_plans%ROWTYPE;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  IF octet_length(coalesce(p_fields->'data', '{}'::jsonb)::text) > 300000 THEN
    RAISE EXCEPTION 'Phương án quá lớn';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO cost_plans (title, industry, zone_name, zone_id, branch_id, pipeline_id, client_id, company_name,
                            status, data, summary, version, created_by, created_by_name, updated_by_name)
    VALUES (
      coalesce(nullif(p_fields->>'title', ''), 'Phương án mới'),
      nullif(p_fields->>'industry', ''), nullif(p_fields->>'zone_name', ''),
      nullif(p_fields->>'zone_id', '')::uuid, nullif(p_fields->>'branch_id', '')::uuid,
      nullif(p_fields->>'pipeline_id', '')::uuid, nullif(p_fields->>'client_id', '')::uuid,
      nullif(p_fields->>'company_name', ''),
      coalesce(nullif(p_fields->>'status', ''), 'draft'),
      coalesce(p_fields->'data', '{}'::jsonb), p_fields->'summary',
      1, u.user_id, u.full_name, u.full_name)
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO cur FROM cost_plans WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Phương án không còn tồn tại'; END IF;
    IF NOT p_force AND p_expected_version IS NOT NULL AND p_expected_version <> cur.version THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'conflict', 'plan', to_jsonb(cur));
    END IF;
    UPDATE cost_plans SET
      title        = CASE WHEN p_fields ? 'title'        THEN coalesce(nullif(p_fields->>'title', ''), title) ELSE title END,
      industry     = CASE WHEN p_fields ? 'industry'     THEN nullif(p_fields->>'industry', '') ELSE industry END,
      zone_name    = CASE WHEN p_fields ? 'zone_name'    THEN nullif(p_fields->>'zone_name', '') ELSE zone_name END,
      zone_id      = CASE WHEN p_fields ? 'zone_id'      THEN nullif(p_fields->>'zone_id', '')::uuid ELSE zone_id END,
      branch_id    = CASE WHEN p_fields ? 'branch_id'    THEN nullif(p_fields->>'branch_id', '')::uuid ELSE branch_id END,
      pipeline_id  = CASE WHEN p_fields ? 'pipeline_id'  THEN nullif(p_fields->>'pipeline_id', '')::uuid ELSE pipeline_id END,
      client_id    = CASE WHEN p_fields ? 'client_id'    THEN nullif(p_fields->>'client_id', '')::uuid ELSE client_id END,
      company_name = CASE WHEN p_fields ? 'company_name' THEN nullif(p_fields->>'company_name', '') ELSE company_name END,
      status       = CASE WHEN p_fields ? 'status'       THEN coalesce(nullif(p_fields->>'status', ''), status) ELSE status END,
      data         = CASE WHEN p_fields ? 'data'         THEN p_fields->'data' ELSE data END,
      summary      = CASE WHEN p_fields ? 'summary'      THEN p_fields->'summary' ELSE summary END,
      version      = cur.version + 1,
      updated_by_name = u.full_name,
      updated_at   = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO cost_plan_revisions (plan_id, version, title, status, data, summary, editor, via, note)
  VALUES (v_row.id, v_row.version, v_row.title, v_row.status, v_row.data, v_row.summary, u.full_name, 'app', left(p_note, 200));
  PERFORM cp_prune_revisions(v_row.id);

  RETURN jsonb_build_object('ok', true, 'plan', to_jsonb(v_row));
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_save(text, uuid, jsonb, int, boolean, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION cost_plan_delete(p_token text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE u record; v_owner uuid;
BEGIN
  SELECT * INTO u FROM cp_session(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'; END IF;
  SELECT created_by INTO v_owner FROM cost_plans WHERE id = p_id;
  IF u.role <> 'admin' AND v_owner IS DISTINCT FROM u.user_id THEN
    RAISE EXCEPTION 'Chỉ người tạo hoặc admin được xoá phương án';
  END IF;
  DELETE FROM cost_plans WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_delete(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION cost_plan_history(p_token text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id DESC)
    FROM (SELECT * FROM cost_plan_revisions WHERE plan_id = p_id ORDER BY id DESC LIMIT 40) r
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_history(text, uuid) TO anon, authenticated;

-- Tạo / đổi link chia sẻ. Giữ nguyên mã link cũ trừ khi p_new_code = true (hoặc link đã thu hồi).
CREATE OR REPLACE FUNCTION cost_plan_share_set(
  p_token text, p_plan_id uuid, p_pin text, p_can_edit boolean DEFAULT true,
  p_expires_days int DEFAULT NULL, p_new_code boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  cur cost_plan_shares%ROWTYPE;
  v_exists boolean;
  v_code text;
  v_exp timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Mã bảo mật phải gồm đúng 4 chữ số';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cost_plans WHERE id = p_plan_id) THEN
    RAISE EXCEPTION 'Phương án chưa được lưu';
  END IF;
  v_exp := CASE WHEN p_expires_days IS NOT NULL AND p_expires_days > 0 THEN now() + make_interval(days => p_expires_days) END;

  SELECT * INTO cur FROM cost_plan_shares WHERE plan_id = p_plan_id FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND NOT p_new_code AND NOT cur.revoked THEN
    v_code := cur.code;
    UPDATE cost_plan_shares SET
      pin_hash = crypt(p_pin, gen_salt('bf')), can_edit = coalesce(p_can_edit, true), expires_at = v_exp,
      revoked = false, failed_attempts = 0, lock_count = 0, locked_until = NULL
    WHERE plan_id = p_plan_id;
  ELSE
    v_code := cp_gen_code();
    IF v_exists THEN
      UPDATE cost_plan_shares SET
        code = v_code, pin_hash = crypt(p_pin, gen_salt('bf')), can_edit = coalesce(p_can_edit, true), expires_at = v_exp,
        revoked = false, failed_attempts = 0, lock_count = 0, locked_until = NULL, open_count = 0, last_opened_at = NULL
      WHERE plan_id = p_plan_id;
    ELSE
      INSERT INTO cost_plan_shares (plan_id, code, pin_hash, can_edit, expires_at)
      VALUES (p_plan_id, v_code, crypt(p_pin, gen_salt('bf')), coalesce(p_can_edit, true), v_exp);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'code', v_code, 'can_edit', coalesce(p_can_edit, true), 'expires_at', v_exp);
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_share_set(text, uuid, text, boolean, int, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION cost_plan_share_revoke(p_token text, p_plan_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cp_session(p_token)) THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;
  UPDATE cost_plan_shares SET revoked = true WHERE plan_id = p_plan_id;
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_share_revoke(text, uuid) TO anon, authenticated;

-- ═════════════════════════ HÀM QUA LINK (mã link + PIN, không cần đăng nhập) ═════════════════════════
CREATE OR REPLACE FUNCTION cost_plan_share_open(p_code text, p_pin text, p_count boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  p cost_plans%ROWTYPE;
BEGIN
  chk := cp_share_check(p_code, p_pin);
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  SELECT * INTO p FROM cost_plans WHERE id = (chk->>'plan_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  -- p_count = false khi chỉ tải lại bản mới (không tính là 1 lượt mở)
  IF p_count THEN
    UPDATE cost_plan_shares SET open_count = open_count + 1, last_opened_at = now() WHERE plan_id = p.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'can_edit', (chk->>'can_edit')::boolean, 'plan', jsonb_build_object(
    'id', p.id, 'title', p.title, 'industry', p.industry, 'zone_name', p.zone_name, 'company_name', p.company_name,
    'status', p.status, 'data', p.data, 'summary', p.summary, 'version', p.version,
    'updated_at', p.updated_at, 'updated_by_name', p.updated_by_name));
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_share_open(text, text, boolean) TO anon, authenticated;

-- Hỏi nhanh phiên bản hiện tại (để báo "có người vừa sửa") — không trả nội dung phương án.
CREATE OR REPLACE FUNCTION cost_plan_share_peek(p_code text, p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE chk jsonb; p cost_plans%ROWTYPE;
BEGIN
  chk := cp_share_check(p_code, p_pin);
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  SELECT * INTO p FROM cost_plans WHERE id = (chk->>'plan_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'version', p.version, 'updated_at', p.updated_at, 'updated_by_name', p.updated_by_name);
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_share_peek(text, text) TO anon, authenticated;

-- Lưu thay đổi từ link: chỉ sửa được nội dung tính toán (data/summary/title), không đụng tới
-- liên kết khách hàng/chi nhánh/trạng thái chốt — việc chốt phương án do chủ phương án quyết định.
CREATE OR REPLACE FUNCTION cost_plan_share_save(
  p_code text, p_pin text, p_editor text, p_expected_version int, p_data jsonb,
  p_summary jsonb DEFAULT NULL, p_note text DEFAULT NULL, p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chk jsonb;
  cur cost_plans%ROWTYPE;
  v_row cost_plans%ROWTYPE;
  v_name text := coalesce(nullif(left(trim(coalesce(p_editor, '')), 60), ''), 'Người được mời');
BEGIN
  chk := cp_share_check(p_code, p_pin);
  IF NOT (chk->>'ok')::boolean THEN RETURN chk; END IF;
  IF NOT (chk->>'can_edit')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', 'read_only'); END IF;
  IF p_data IS NULL OR octet_length(p_data::text) > 300000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_large');
  END IF;

  SELECT * INTO cur FROM cost_plans WHERE id = (chk->>'plan_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT p_force AND p_expected_version IS NOT NULL AND p_expected_version <> cur.version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'conflict', 'plan', jsonb_build_object(
      'id', cur.id, 'title', cur.title, 'industry', cur.industry, 'zone_name', cur.zone_name,
      'company_name', cur.company_name, 'status', cur.status, 'data', cur.data, 'summary', cur.summary,
      'version', cur.version, 'updated_at', cur.updated_at, 'updated_by_name', cur.updated_by_name));
  END IF;

  UPDATE cost_plans SET data = p_data, summary = p_summary, version = cur.version + 1,
    updated_by_name = v_name || ' (qua link)', updated_at = now()
  WHERE id = cur.id RETURNING * INTO v_row;

  INSERT INTO cost_plan_revisions (plan_id, version, title, status, data, summary, editor, via, note)
  VALUES (v_row.id, v_row.version, v_row.title, v_row.status, v_row.data, v_row.summary, v_name, 'link', left(p_note, 200));
  PERFORM cp_prune_revisions(v_row.id);

  RETURN jsonb_build_object('ok', true, 'version', v_row.version, 'updated_at', v_row.updated_at);
END $$;
GRANT EXECUTE ON FUNCTION cost_plan_share_save(text, text, text, int, jsonb, jsonb, text, boolean) TO anon, authenticated;
