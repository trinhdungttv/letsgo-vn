-- ============================================================================
-- 218 — Ban Điều Hành CHỈ XEM · Phòng Kinh Doanh có NHẬT KÝ NGƯỜI SỬA · CẢNH BÁO bất thường · KHÔI PHỤC theo đợt
-- ----------------------------------------------------------------------------
-- Vì sao: app chạy bằng anon key (không có phiên Supabase Auth) nên data_history (090) chụp được MỌI thay đổi
-- nhưng KHÔNG biết ai sửa. Từ bản này app gửi token phiên đăng nhập (header x-letsgo-token, giống module
-- Văn phòng Orient — migration 164) trong mọi request /rest/v1 → trigger dh_track đọc header, tra app_sessions,
-- ghi thêm người sửa vào từng dòng lịch sử.
--
-- Làm gì:
--   1. data_history thêm cột actor_id / actor_name / actor_role / tx_id (mã giao dịch = 1 lần bấm Lưu).
--   2. dh_log_change() ghi người sửa + CHẶN GHI với vai trò chỉ xem (Ban Điều Hành — 'bdh'): mọi thêm / sửa / xoá
--      vào bảng có dh_track của tài khoản bdh bị từ chối ngay trong database (app cũng chặn trước ở trình duyệt).
--   3. Bảng data_alerts + data_guard_settings (chỉ đọc / ghi qua RPC có token admin):
--        - "Xoá nhiều": 1 người (không phải admin) xoá ≥ N dòng trong 1 đợt (các lần xoá cách nhau ≤ X phút),
--          hoặc xoá BẤT KỲ dòng nào ở bảng quan trọng (khách hàng, hợp đồng, P&L, tài chính, lao động).
--        - "Sửa hàng loạt": 1 lần lưu (1 giao dịch) sửa ≥ M dòng.
--      dh_scan_alerts(token) quét lại 30 ngày gần nhất mỗi khi admin mở app → popup cảnh báo.
--   4. dh_revert_events(token, ids, apply, force): khôi phục đúng các thay đổi đã chọn (của 1 người / 1 đợt) về
--      trạng thái TRƯỚC đợt đó. Xem trước được (apply = false). Bản ghi đã có người khác sửa tiếp sau đó thì bỏ qua
--      (trừ khi force) để không ghi đè việc mới. Khôi phục bằng UPDATE (không xoá-rồi-chèn như Cỗ máy thời gian
--      → không kéo theo xoá dây chuyền ON DELETE CASCADE). Chính lần khôi phục cũng được ghi lịch sử → hoàn tác được.
--   5. dh_activity_summary(token, from, to): số thêm / sửa / xoá theo người · ngày · bảng (admin + Ban Điều Hành).
--   6. Ma trận phân quyền: thêm module "Tổng quan" (trang tổng quan điều hành); Ban Điều Hành chỉ còn xem
--      Dashboard · Báo cáo · Tổng quan (các trang chi tiết → không có quyền). Admin chỉnh lại được ở Ma trận.
--
-- Có mất dữ liệu không? KHÔNG. Chỉ thêm cột / bảng / hàm và đổi quyền của vai trò bdh. Lịch sử cũ giữ nguyên
-- (không có người sửa → hiện "Không rõ"). Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

SET search_path = public, extensions;

-- ── 1) Người sửa trên data_history ─────────────────────────────────────────
ALTER TABLE data_history ADD COLUMN IF NOT EXISTS actor_id   uuid;
ALTER TABLE data_history ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE data_history ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE data_history ADD COLUMN IF NOT EXISTS tx_id      bigint;
CREATE INDEX IF NOT EXISTS idx_dh_actor_time ON data_history(actor_id, happened_at DESC) WHERE actor_id IS NOT NULL;

-- ── 2) Vai trò chỉ xem (khớp READONLY_ROLES trong src/lib/writeGuard.ts) ──
CREATE OR REPLACE FUNCTION lgvn_readonly_role(p_role text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(p_role IN ('bdh'), false) $$;

-- Ai đang gửi request này (đọc header x-letsgo-token). Trả {} khi không có / hết hạn (SQL Editor, script, /api).
-- Nhớ trong giao dịch (set_config local) để lệnh sửa hàng loạt không tra lại từng dòng.
CREATE OR REPLACE FUNCTION lgvn_request_actor() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_cached text;
  v_token  text;
  v_actor  jsonb;
BEGIN
  v_cached := current_setting('lgvn.actor', true);
  IF v_cached IS NOT NULL AND v_cached <> '' THEN
    RETURN v_cached::jsonb;
  END IF;
  BEGIN
    v_token := NULLIF(current_setting('request.headers', true), '')::json ->> 'x-letsgo-token';
  EXCEPTION WHEN others THEN
    v_token := NULL;
  END;
  IF v_token IS NOT NULL AND v_token <> '' THEN
    SELECT jsonb_build_object('id', u.id, 'name', COALESCE(NULLIF(u.full_name, ''), u.username), 'role', u.role)
      INTO v_actor
      FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.token = v_token AND s.expires_at > now();
  END IF;
  v_actor := COALESCE(v_actor, '{}'::jsonb);
  PERFORM set_config('lgvn.actor', v_actor::text, true);
  RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION lgvn_request_actor() FROM PUBLIC, anon, authenticated;

-- ── 3) Trigger lịch sử: ghi người sửa + chặn vai trò chỉ xem ───────────────
CREATE OR REPLACE FUNCTION dh_log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_changed TEXT[];
  v_actor JSONB;
BEGIN
  v_actor := lgvn_request_actor();
  IF lgvn_readonly_role(v_actor ->> 'role') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Tài khoản Ban Điều Hành chỉ được xem — không thêm / sửa / xoá được dữ liệu.',
      HINT = 'LGVN_READONLY';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT array_agg(k) INTO v_changed
    FROM jsonb_object_keys(v_new) AS t(k)
    WHERE v_old -> k IS DISTINCT FROM v_new -> k;
    IF v_changed IS NULL THEN
      RETURN NEW; -- update không đổi gì thì không ghi log
    END IF;
  ELSE
    v_old := to_jsonb(OLD);
  END IF;

  INSERT INTO data_history (table_name, record_id, action, old_data, new_data, changed_fields,
                            actor_id, actor_name, actor_role, tx_id)
  VALUES (TG_TABLE_NAME, COALESCE(COALESCE(v_new, v_old) ->> 'id', ''), TG_OP, v_old, v_new, v_changed,
          NULLIF(v_actor ->> 'id', '')::uuid, v_actor ->> 'name', v_actor ->> 'role', txid_current());

  RETURN COALESCE(NEW, OLD);
END $$;

-- ── 4) Cài đặt + bảng cảnh báo (chỉ qua RPC admin) ─────────────────────────
CREATE TABLE IF NOT EXISTS data_guard_settings (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  delete_threshold int NOT NULL DEFAULT 10,   -- xoá ≥ N dòng trong 1 đợt
  update_threshold int NOT NULL DEFAULT 20,   -- 1 lần lưu sửa ≥ M dòng
  window_minutes   int NOT NULL DEFAULT 30,   -- các lần xoá cách nhau ≤ X phút = cùng 1 đợt
  core_tables      text[] NOT NULL DEFAULT ARRAY['clients','client_contracts','projects_pnl','finance_records','client_labor_history'],
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO data_guard_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE data_guard_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON data_guard_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS data_alerts (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('mass_delete', 'mass_update')),
  severity       text NOT NULL DEFAULT 'warn' CHECK (severity IN ('warn', 'high')),
  actor_id       uuid NOT NULL,
  actor_name     text,
  actor_role     text,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL,
  tx_id          bigint,
  total          int NOT NULL DEFAULT 0,
  tables         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { ten_bang: so_dong }
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'restored')),
  restored_until timestamptz,                          -- đã khôi phục các thay đổi tới mốc này
  resolved_at    timestamptz,
  resolved_by    text,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, kind, started_at)
);
CREATE INDEX IF NOT EXISTS idx_data_alerts_status ON data_alerts(status, started_at DESC);
ALTER TABLE data_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON data_alerts FROM anon, authenticated;

-- Tên người đang cầm token (để ghi "ai xử lý cảnh báo")
CREATE OR REPLACE FUNCTION lgvn_token_user_name(p_token text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(u.full_name, ''), u.username)
  FROM app_sessions s JOIN app_users u ON u.id = s.user_id
  WHERE s.token = p_token AND s.expires_at > now();
$$;
REVOKE ALL ON FUNCTION lgvn_token_user_name(text) FROM PUBLIC, anon, authenticated;

-- ── 5) Quét bất thường (admin) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dh_scan_alerts(p_token text)
RETURNS SETOF data_alerts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s data_guard_settings%ROWTYPE;
BEGIN
  PERFORM require_admin(p_token);
  SELECT * INTO s FROM data_guard_settings WHERE id = 1;
  IF NOT FOUND THEN
    INSERT INTO data_guard_settings (id) VALUES (1) RETURNING * INTO s;
  END IF;

  -- A) Xoá nhiều / xoá bảng quan trọng — gom các lần xoá cách nhau ≤ window_minutes thành 1 đợt
  WITH d AS (
    SELECT h.id, h.happened_at, h.table_name, h.actor_id, h.actor_name, h.actor_role,
           CASE WHEN h.happened_at - lag(h.happened_at) OVER w <= make_interval(mins => s.window_minutes)
                THEN 0 ELSE 1 END AS brk
    FROM data_history h
    WHERE h.action = 'DELETE' AND h.actor_id IS NOT NULL AND COALESCE(h.actor_role, '') <> 'admin'
      AND h.happened_at > now() - interval '30 days'
    WINDOW w AS (PARTITION BY h.actor_id ORDER BY h.happened_at, h.id)
  ), g AS (
    SELECT d.*, sum(d.brk) OVER (PARTITION BY d.actor_id ORDER BY d.happened_at, d.id) AS grp FROM d
  ), t AS (
    SELECT g.actor_id, g.grp, g.table_name, count(*) AS n FROM g GROUP BY g.actor_id, g.grp, g.table_name
  ), b AS (
    SELECT g.actor_id, g.grp, max(g.actor_name) AS actor_name, max(g.actor_role) AS actor_role,
           min(g.happened_at) AS started_at, max(g.happened_at) AS ended_at, count(*)::int AS total,
           bool_or(g.table_name = ANY (s.core_tables)) AS core
    FROM g GROUP BY g.actor_id, g.grp
  )
  INSERT INTO data_alerts AS a (kind, severity, actor_id, actor_name, actor_role, started_at, ended_at, total, tables)
  SELECT 'mass_delete',
         CASE WHEN b.core OR b.total >= 3 * s.delete_threshold THEN 'high' ELSE 'warn' END,
         b.actor_id, b.actor_name, b.actor_role, b.started_at, b.ended_at, b.total,
         COALESCE((SELECT jsonb_object_agg(t.table_name, t.n) FROM t WHERE t.actor_id = b.actor_id AND t.grp = b.grp), '{}'::jsonb)
  FROM b
  WHERE (b.total >= s.delete_threshold OR b.core)
    AND b.started_at > now() - interval '29 days'   -- bỏ đợt bị mốc 30 ngày cắt ngang
  ON CONFLICT (actor_id, kind, started_at) DO UPDATE
    SET ended_at = EXCLUDED.ended_at, total = EXCLUDED.total, tables = EXCLUDED.tables, severity = EXCLUDED.severity,
        status = CASE WHEN EXCLUDED.total > a.total AND a.status <> 'open' THEN 'open' ELSE a.status END;

  -- B) Sửa hàng loạt — 1 giao dịch (1 lần lưu) sửa ≥ update_threshold dòng
  WITH u AS (
    SELECT h.actor_id, h.tx_id, h.table_name, max(h.actor_name) AS actor_name, max(h.actor_role) AS actor_role,
           min(h.happened_at) AS t0, max(h.happened_at) AS t1, count(*) AS n
    FROM data_history h
    WHERE h.action = 'UPDATE' AND h.actor_id IS NOT NULL AND h.tx_id IS NOT NULL
      AND COALESCE(h.actor_role, '') <> 'admin'
      AND h.happened_at > now() - interval '29 days'
    GROUP BY h.actor_id, h.tx_id, h.table_name
  ), x AS (
    SELECT u.actor_id, u.tx_id, max(u.actor_name) AS actor_name, max(u.actor_role) AS actor_role,
           min(u.t0) AS started_at, max(u.t1) AS ended_at, sum(u.n)::int AS total,
           jsonb_object_agg(u.table_name, u.n) AS tables
    FROM u GROUP BY u.actor_id, u.tx_id
    HAVING sum(u.n) >= s.update_threshold
  )
  INSERT INTO data_alerts AS a (kind, severity, actor_id, actor_name, actor_role, started_at, ended_at, tx_id, total, tables)
  SELECT 'mass_update', CASE WHEN x.total >= 3 * s.update_threshold THEN 'high' ELSE 'warn' END,
         x.actor_id, x.actor_name, x.actor_role, x.started_at, x.ended_at, x.tx_id, x.total, x.tables
  FROM x
  ON CONFLICT (actor_id, kind, started_at) DO NOTHING;

  RETURN QUERY
    SELECT * FROM data_alerts
    WHERE data_alerts.started_at > now() - interval '60 days' OR data_alerts.status = 'open'
    ORDER BY (data_alerts.status = 'open') DESC, data_alerts.started_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION dh_scan_alerts(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION dh_set_alert_status(p_token text, p_id bigint, p_status text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_admin(p_token);
  IF p_status NOT IN ('open', 'dismissed', 'restored') THEN
    RAISE EXCEPTION 'Trạng thái không hợp lệ: %', p_status;
  END IF;
  UPDATE data_alerts
     SET status = p_status,
         resolved_at = CASE WHEN p_status = 'open' THEN NULL ELSE now() END,
         resolved_by = CASE WHEN p_status = 'open' THEN NULL ELSE lgvn_token_user_name(p_token) END,
         restored_until = CASE WHEN p_status = 'restored' THEN ended_at ELSE restored_until END,
         note = COALESCE(p_note, note)
   WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION dh_set_alert_status(text, bigint, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION dh_guard_settings(p_token text)
RETURNS data_guard_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s data_guard_settings%ROWTYPE;
BEGIN
  PERFORM require_admin(p_token);
  SELECT * INTO s FROM data_guard_settings WHERE id = 1;
  IF NOT FOUND THEN INSERT INTO data_guard_settings (id) VALUES (1) RETURNING * INTO s; END IF;
  RETURN s;
END $$;
GRANT EXECUTE ON FUNCTION dh_guard_settings(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION dh_save_guard_settings(p_token text, p_delete int, p_update int, p_window int, p_core text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_admin(p_token);
  INSERT INTO data_guard_settings (id, delete_threshold, update_threshold, window_minutes, core_tables, updated_at)
  VALUES (1, GREATEST(p_delete, 1), GREATEST(p_update, 2), LEAST(GREATEST(p_window, 1), 1440), COALESCE(p_core, '{}'), now())
  ON CONFLICT (id) DO UPDATE SET
    delete_threshold = EXCLUDED.delete_threshold, update_threshold = EXCLUDED.update_threshold,
    window_minutes = EXCLUDED.window_minutes, core_tables = EXCLUDED.core_tables, updated_at = now();
END $$;
GRANT EXECUTE ON FUNCTION dh_save_guard_settings(text, int, int, int, text[]) TO anon, authenticated;

-- ── 6) Khôi phục theo danh sách thay đổi (admin) ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dh_revert_item') THEN
    CREATE TYPE dh_revert_item AS (tname text, rid text, target jsonb, first_id bigint, plan text, status text, detail text);
  END IF;
END $$;

-- Trả 1 dòng đang có về nội dung cũ — CHỈ những cột có trong bản chụp (cột thêm sau giữ nguyên), không đụng cột id.
CREATE OR REPLACE FUNCTION dh__apply_restore(p_table text, p_rid text, p_target jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_set text;
BEGIN
  SELECT string_agg(format('%I = s.%I', a.attname, a.attname), ', ')
    INTO v_set
  FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', p_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attgenerated = '' AND a.attidentity = '' AND a.attname <> 'id' AND p_target ? a.attname;
  IF v_set IS NULL THEN RETURN; END IF;
  EXECUTE format('UPDATE %I AS t SET %s FROM jsonb_populate_record(NULL::%I, $1) AS s WHERE t.id::text = $2',
                 p_table, v_set, p_table)
  USING p_target, p_rid;
END $$;
REVOKE ALL ON FUNCTION dh__apply_restore(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Chèn lại 1 dòng đã bị xoá (chỉ các cột có trong bản chụp; cột thêm sau lấy giá trị mặc định).
CREATE OR REPLACE FUNCTION dh__apply_insert(p_table text, p_target jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cols text;
  v_identity boolean;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum), COALESCE(bool_or(a.attidentity = 'a'), false)
    INTO v_cols, v_identity
  FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', p_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attgenerated = '' AND p_target ? a.attname;
  IF v_cols IS NULL THEN RAISE EXCEPTION 'Bản chụp không có cột nào để khôi phục'; END IF;
  EXECUTE format('INSERT INTO %I (%s) %s SELECT %s FROM jsonb_populate_record(NULL::%I, $1)',
                 p_table, v_cols, CASE WHEN v_identity THEN 'OVERRIDING SYSTEM VALUE' ELSE '' END, v_cols, p_table)
  USING p_target;
END $$;
REVOKE ALL ON FUNCTION dh__apply_insert(text, jsonb) FROM PUBLIC, anon, authenticated;

-- plan: restore (về bản cũ) · reinsert (chèn lại dòng đã xoá) · remove (xoá dòng đã thêm) · noop · conflict · skip
-- status: preview · done · error
CREATE OR REPLACE FUNCTION dh_revert_events(p_token text, p_ids bigint[], p_apply boolean DEFAULT false, p_force boolean DEFAULT false)
RETURNS TABLE(table_name text, record_id text, plan text, status text, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_items dh_revert_item[] := '{}';
  v_it dh_revert_item;
  r record;
  v_exists boolean;
  v_conflict boolean;
  v_pending int[];
  v_next int[];
  v_pass int;
  i int;
  n int;
BEGIN
  PERFORM require_admin(p_token);
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN; END IF;
  IF cardinality(p_ids) > 5000 THEN
    RAISE EXCEPTION 'Mỗi lần khôi phục tối đa 5000 thay đổi (đang chọn %)', cardinality(p_ids);
  END IF;

  -- Lập kế hoạch: mỗi bản ghi lấy bản chụp TRƯỚC thay đổi đầu tiên được chọn
  FOR r IN
    SELECT s.tname, s.rid, (array_agg(s.old_data ORDER BY s.id))[1] AS target, min(s.id) AS first_id, max(s.id) AS last_id
    FROM (
      SELECT h.id, h.table_name AS tname, h.record_id AS rid, h.old_data
      FROM data_history h WHERE h.id = ANY (p_ids) AND h.record_id <> ''
    ) s
    GROUP BY s.tname, s.rid
    ORDER BY min(s.id)
  LOOP
    v_it := ROW(r.tname, r.rid, r.target, r.first_id, NULL, 'preview', NULL)::dh_revert_item;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE tg.tgname = 'dh_track' AND c.relname = r.tname AND ns.nspname = 'public' AND NOT tg.tgisinternal
    ) THEN
      v_it.plan := 'skip'; v_it.detail := 'Bảng này không còn được theo dõi lịch sử';
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM data_history h2
        WHERE h2.table_name = r.tname AND h2.record_id = r.rid AND h2.id > r.last_id AND NOT (h2.id = ANY (p_ids))
      ) INTO v_conflict;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id::text = $1)', r.tname) USING r.rid INTO v_exists;
      IF v_conflict AND NOT p_force THEN
        v_it.plan := 'conflict'; v_it.detail := 'Sau đó đã có thay đổi khác trên bản ghi này — bỏ qua để không ghi đè';
      ELSIF r.target IS NULL THEN
        v_it.plan := CASE WHEN v_exists THEN 'remove' ELSE 'noop' END;
      ELSE
        v_it.plan := CASE WHEN v_exists THEN 'restore' ELSE 'reinsert' END;
      END IF;
    END IF;
    v_items := v_items || v_it;
  END LOOP;

  n := COALESCE(array_length(v_items, 1), 0);

  IF p_apply AND n > 0 THEN
    -- a) Xoá các dòng do đợt này thêm vào (mới → cũ)
    FOR i IN REVERSE n .. 1 LOOP
      v_it := v_items[i];
      CONTINUE WHEN v_it.plan IS DISTINCT FROM 'remove';
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE id::text = $1', v_it.tname) USING v_it.rid;
        v_it.status := 'done';
      EXCEPTION WHEN others THEN
        v_it.status := 'error'; v_it.detail := SQLERRM;
      END;
      v_items[i] := v_it;
    END LOOP;

    -- b) Trả về bản cũ / chèn lại (cũ → mới). Vướng khoá ngoại (dòng cha chưa có) → thử lại ở lượt sau.
    v_pending := '{}';
    FOR i IN 1 .. n LOOP
      v_it := v_items[i];
      IF v_it.plan IN ('restore', 'reinsert') THEN v_pending := v_pending || i; END IF;
    END LOOP;
    FOR v_pass IN 1 .. 6 LOOP
      EXIT WHEN cardinality(v_pending) = 0;
      v_next := '{}';
      FOREACH i IN ARRAY v_pending LOOP
        v_it := v_items[i];
        BEGIN
          IF v_it.plan = 'restore' THEN
            PERFORM dh__apply_restore(v_it.tname, v_it.rid, v_it.target);
          ELSE
            PERFORM dh__apply_insert(v_it.tname, v_it.target);
          END IF;
          v_it.status := 'done'; v_it.detail := NULL;
        EXCEPTION
          WHEN foreign_key_violation THEN
            v_it.status := 'error'; v_it.detail := SQLERRM; v_next := v_next || i;
          WHEN others THEN
            v_it.status := 'error'; v_it.detail := SQLERRM;
        END;
        v_items[i] := v_it;
      END LOOP;
      EXIT WHEN cardinality(v_next) = cardinality(v_pending);  -- không tiến thêm được
      v_pending := v_next;
    END LOOP;
  END IF;

  FOREACH v_it IN ARRAY v_items LOOP
    table_name := v_it.tname; record_id := v_it.rid; plan := v_it.plan; status := v_it.status; detail := v_it.detail;
    RETURN NEXT;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION dh_revert_events(text, bigint[], boolean, boolean) TO anon, authenticated;

-- ── 7) Tổng hợp hoạt động nhập liệu (admin + Ban Điều Hành) ────────────────
CREATE OR REPLACE FUNCTION dh_activity_summary(p_token text, p_from timestamptz, p_to timestamptz)
RETURNS TABLE(actor_id uuid, actor_name text, actor_role text, day date, table_name text, action text, n bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_role text;
BEGIN
  v_role := session_role(p_token);
  IF v_role IS NULL OR NOT (v_role = 'admin' OR lgvn_readonly_role(v_role)) THEN
    RAISE EXCEPTION 'Không có quyền xem tổng hợp hoạt động';
  END IF;
  RETURN QUERY
    SELECT h.actor_id, max(h.actor_name), max(h.actor_role),
           (h.happened_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d, h.table_name, h.action, count(*)
    FROM data_history h
    WHERE h.happened_at >= p_from AND h.happened_at < p_to AND h.actor_id IS NOT NULL
    GROUP BY h.actor_id, d, h.table_name, h.action;
END $$;
GRANT EXECUTE ON FUNCTION dh_activity_summary(text, timestamptz, timestamptz) TO anon, authenticated;

-- ── 8) Ma trận phân quyền ─────────────────────────────────────────────────
INSERT INTO role_permissions (role, module, level, updated_at) VALUES
  ('admin',     'Tổng quan', 'full', now()),
  ('bdh',       'Tổng quan', 'view', now()),
  ('kinhdoanh', 'Tổng quan', 'none', now()),
  ('ketoan',    'Tổng quan', 'none', now())
ON CONFLICT (role, module) DO NOTHING;

-- Ban Điều Hành: chỉ xem bức tranh tổng thể — Dashboard · Báo cáo · Tổng quan; trang chi tiết đóng lại.
UPDATE role_permissions SET level = 'view', updated_at = now()
 WHERE role = 'bdh' AND module IN ('Dashboard', 'Báo cáo', 'Tổng quan');
UPDATE role_permissions SET level = 'none', updated_at = now()
 WHERE role = 'bdh' AND module NOT IN ('Dashboard', 'Báo cáo', 'Tổng quan');

-- ── Kiểm tra sau khi chạy ──────────────────────────────────────────────────
-- 1) Có đủ cột người sửa + bảng cảnh báo (mong đợi: 4 · true · true):
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'data_history'
--          AND column_name IN ('actor_id','actor_name','actor_role','tx_id')) AS cot_nguoi_sua,
--        to_regclass('public.data_alerts') IS NOT NULL AS co_bang_canh_bao,
--        to_regprocedure('dh_revert_events(text,bigint[],boolean,boolean)') IS NOT NULL AS co_ham_khoi_phuc;
-- 2) Quyền Ban Điều Hành (mong đợi: chỉ Báo cáo / Dashboard / Tổng quan = view):
-- SELECT module, level FROM role_permissions WHERE role = 'bdh' AND level <> 'none' ORDER BY module;
-- 3) Sau khi mở app và sửa thử 1 dòng, lịch sử phải có tên người sửa:
-- SELECT happened_at, table_name, action, actor_name, actor_role FROM data_history ORDER BY id DESC LIMIT 5;

-- ── ROLLBACK (nếu cần) ─────────────────────────────────────────────────────
-- Bỏ chặn ghi Ban Điều Hành ngay: CREATE OR REPLACE FUNCTION lgvn_readonly_role(p_role text) RETURNS boolean
--   LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
-- (các cột / bảng mới để nguyên không ảnh hưởng gì)
