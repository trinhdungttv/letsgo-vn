-- ============================================================================
-- 090: NHẬT KÝ DATABASE (data_history) — lưới an toàn cấp database
--
-- Khác với audit_logs (chỉ ghi khi thao tác qua giao diện app), bảng này dùng
-- TRIGGER ngay trong Postgres: MỌI thay đổi INSERT/UPDATE/DELETE trên mọi bảng
-- dữ liệu đều được tự động chụp lại toàn bộ nội dung dòng (trước & sau),
-- kể cả thay đổi do script, code sync, migration hay SQL Editor gây ra.
--
-- Bảng data_history là APPEND-ONLY với client: anon/authenticated chỉ được
-- SELECT, không thể sửa/xóa lịch sử (chống cả trường hợp code lỗi xóa nhầm log).
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_history (
  id BIGSERIAL PRIMARY KEY,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data JSONB,          -- toàn bộ dòng TRƯỚC thay đổi (UPDATE/DELETE)
  new_data JSONB,          -- toàn bộ dòng SAU thay đổi (INSERT/UPDATE)
  changed_fields TEXT[]    -- các cột đã đổi (chỉ với UPDATE)
);

CREATE INDEX IF NOT EXISTS idx_dh_happened ON data_history(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_dh_table_time ON data_history(table_name, happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_dh_record ON data_history(table_name, record_id);

ALTER TABLE data_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dh_select_anon ON data_history;
DROP POLICY IF EXISTS dh_select_auth ON data_history;
CREATE POLICY dh_select_anon ON data_history FOR SELECT TO anon USING (true);
CREATE POLICY dh_select_auth ON data_history FOR SELECT TO authenticated USING (true);

-- Client chỉ được đọc. Ghi log do trigger (SECURITY DEFINER) thực hiện.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON data_history FROM anon, authenticated;
GRANT SELECT ON data_history TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- Trigger function: chụp lại thay đổi
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dh_log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_changed TEXT[];
BEGIN
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

  INSERT INTO data_history (table_name, record_id, action, old_data, new_data, changed_fields)
  VALUES (TG_TABLE_NAME, COALESCE(COALESCE(v_new, v_old) ->> 'id', ''), TG_OP, v_old, v_new, v_changed);

  RETURN COALESCE(NEW, OLD);
END $$;

-- ----------------------------------------------------------------------------
-- Gắn trigger vào tất cả bảng dữ liệu trong schema public.
-- Idempotent: có thể gọi lại sau khi tạo bảng mới để bảng mới cũng được theo dõi.
-- ----------------------------------------------------------------------------
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
        'data_history',      -- chính nó
        'audit_logs',        -- đã là log
        'loan_audit_log',    -- đã là log
        'app_sessions',      -- phiên đăng nhập, thay đổi liên tục, không có giá trị khôi phục
        'ai_chat_messages',  -- chat AI, dung lượng lớn, giá trị khôi phục thấp
        'google_connections' -- chứa token nhạy cảm, mất thì kết nối lại được
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

SELECT dh_attach_triggers();

-- ----------------------------------------------------------------------------
-- CỖ MÁY THỜI GIAN: đưa cả một bảng về đúng trạng thái tại thời điểm p_time.
--   p_apply = false : chỉ XEM TRƯỚC những gì sẽ thay đổi (không đụng dữ liệu)
--   p_apply = true  : thực hiện khôi phục
-- Cách hoạt động: với mỗi bản ghi có thay đổi SAU p_time, lấy old_data của sự
-- kiện đầu tiên sau p_time = trạng thái đúng tại p_time. Nếu old_data rỗng
-- (bản ghi được tạo sau p_time) thì bản ghi đó sẽ bị xóa.
-- Bản thân việc khôi phục cũng được trigger ghi log → có thể hoàn tác tiếp.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dh_time_machine(p_table TEXT, p_time TIMESTAMPTZ, p_apply BOOLEAN DEFAULT false)
RETURNS TABLE(record_id TEXT, action TEXT, snapshot JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
BEGIN
  -- Chỉ cho phép bảng đang được theo dõi (chặn tên bảng tùy ý)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE tg.tgname = 'dh_track' AND c.relname = p_table AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Bảng "%" không nằm trong hệ thống theo dõi lịch sử', p_table;
  END IF;

  FOR r IN
    SELECT DISTINCT ON (h.record_id) h.record_id AS rid, h.old_data
    FROM data_history h
    WHERE h.table_name = p_table AND h.happened_at > p_time AND h.record_id <> ''
    ORDER BY h.record_id, h.happened_at ASC, h.id ASC
  LOOP
    IF r.old_data IS NULL THEN
      -- Bản ghi chưa tồn tại tại p_time → sẽ xóa
      record_id := r.rid; action := 'DELETE'; snapshot := NULL;
      IF p_apply THEN
        EXECUTE format('DELETE FROM %I WHERE id::text = $1', p_table) USING r.rid;
      END IF;
    ELSE
      -- Khôi phục về trạng thái tại p_time
      record_id := r.rid; action := 'RESTORE'; snapshot := r.old_data;
      IF p_apply THEN
        EXECUTE format('DELETE FROM %I WHERE id::text = $1', p_table) USING r.rid;
        EXECUTE format(
          'INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, $1)',
          p_table, p_table
        ) USING r.old_data;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION dh_time_machine(TEXT, TIMESTAMPTZ, BOOLEAN) TO anon, authenticated;
-- dh_attach_triggers chỉ chạy từ migration/SQL Editor, không mở cho client
REVOKE EXECUTE ON FUNCTION dh_attach_triggers() FROM anon, authenticated, PUBLIC;
