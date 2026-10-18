-- Kiểm tra bảo mật module Văn phòng Orient (bảng bds_*).
-- Cách chạy: Supabase → SQL Editor → dán toàn bộ file này → Run.
-- KHÔNG thay đổi dữ liệu: lệnh ghi thử luôn được huỷ ngay sau khi kiểm tra.
-- Nên chạy SAU khi đã Import dữ liệu để cột "Số dòng thấy được" có ý nghĩa.
--
-- Kết quả mong đợi (cột "Đạt" = ✓ ở mọi dòng):
--   1. Không có token        → bds_is_admin = false, mọi bảng thấy 0 dòng, ghi bị chặn
--   2. Token của nhân viên   → bds_is_admin = false, mọi bảng thấy 0 dòng, ghi bị chặn
--   3. Token của admin       → bds_is_admin = true, đọc được, ghi được
-- Trường hợp 2/3 cần có ít nhất 1 phiên đăng nhập còn hạn của loại tài khoản đó; nếu không có
-- sẽ hiện "(bỏ qua)".

DROP TABLE IF EXISTS _bds_rls_check;
CREATE TEMP TABLE _bds_rls_check (
  stt        serial,
  truong_hop text,
  kiem_tra   text,
  ket_qua    text,
  mong_doi   text,
  dat        text
);

DO $$
DECLARE
  v_case     text;
  v_label    text;
  v_token    text;
  v_admin    boolean;
  v_tbl      text;
  v_n        bigint;
  v_reads    text[];
  v_counts   bigint[];
  v_write    text;
  i          int;
BEGIN
  FOREACH v_case IN ARRAY ARRAY['none', 'staff', 'admin'] LOOP
    v_token := NULL;
    v_label := CASE v_case WHEN 'none' THEN '1. Không có token'
                           WHEN 'staff' THEN '2. Token nhân viên'
                           ELSE '3. Token admin' END;

    IF v_case = 'staff' THEN
      SELECT s.token INTO v_token
        FROM app_sessions s JOIN app_users u ON u.id = s.user_id
       WHERE u.role <> 'admin' AND s.expires_at > now()
       ORDER BY s.created_at DESC LIMIT 1;
    ELSIF v_case = 'admin' THEN
      SELECT s.token INTO v_token
        FROM app_sessions s JOIN app_users u ON u.id = s.user_id
       WHERE u.role = 'admin' AND s.expires_at > now() AND COALESCE(u.is_active, true)
       ORDER BY s.created_at DESC LIMIT 1;
    END IF;

    IF v_case <> 'none' AND v_token IS NULL THEN
      INSERT INTO _bds_rls_check (truong_hop, kiem_tra, ket_qua, mong_doi, dat)
      VALUES (v_label, '(bỏ qua)', 'Không có phiên đăng nhập còn hạn', '—', '—');
      CONTINUE;
    END IF;

    PERFORM set_config(
      'request.headers',
      CASE WHEN v_token IS NULL THEN '{}' ELSE json_build_object('x-letsgo-token', v_token)::text END,
      true
    );

    -- Đóng vai trình duyệt (role anon) giống hệt request thật từ app
    SET LOCAL ROLE anon;

    v_admin := bds_is_admin();
    v_reads := ARRAY[]::text[];
    v_counts := ARRAY[]::bigint[];
    FOR v_tbl IN
      SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename LIKE 'bds\_%' ORDER BY tablename
    LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM %I', v_tbl) INTO v_n;
      EXCEPTION WHEN others THEN
        v_n := -1;  -- bị từ chối hẳn (cũng là an toàn)
      END;
      v_reads := v_reads || v_tbl;
      v_counts := v_counts || v_n;
    END LOOP;

    BEGIN
      INSERT INTO bds_forecast_expenses (name, month, amount, note)
      VALUES ('__rls_check__', '2026-01-01', 1, 'tự huỷ');
      RAISE EXCEPTION '__GHI_DUOC__';
    EXCEPTION WHEN others THEN
      v_write := CASE WHEN SQLERRM = '__GHI_DUOC__' THEN 'ghi được' ELSE 'bị chặn' END;
    END;

    RESET ROLE;

    INSERT INTO _bds_rls_check (truong_hop, kiem_tra, ket_qua, mong_doi, dat)
    VALUES (v_label, 'bds_is_admin()', v_admin::text,
            CASE WHEN v_case = 'admin' THEN 'true' ELSE 'false' END,
            CASE WHEN v_admin = (v_case = 'admin') THEN '✓' ELSE '✗' END);

    FOR i IN 1 .. coalesce(array_length(v_reads, 1), 0) LOOP
      INSERT INTO _bds_rls_check (truong_hop, kiem_tra, ket_qua, mong_doi, dat)
      VALUES (v_label, 'Số dòng thấy được: ' || v_reads[i],
              CASE WHEN v_counts[i] < 0 THEN 'bị từ chối' ELSE v_counts[i]::text END,
              CASE WHEN v_case = 'admin' THEN 'đọc được' ELSE '0' END,
              CASE WHEN v_case = 'admin' THEN CASE WHEN v_counts[i] >= 0 THEN '✓' ELSE '✗' END
                   ELSE CASE WHEN v_counts[i] <= 0 THEN '✓' ELSE '✗' END END);
    END LOOP;

    INSERT INTO _bds_rls_check (truong_hop, kiem_tra, ket_qua, mong_doi, dat)
    VALUES (v_label, 'Ghi thử vào bds_forecast_expenses', v_write,
            CASE WHEN v_case = 'admin' THEN 'ghi được' ELSE 'bị chặn' END,
            CASE WHEN (v_write = 'ghi được') = (v_case = 'admin') THEN '✓' ELSE '✗' END);
  END LOOP;
END $$;

SELECT truong_hop AS "Trường hợp", kiem_tra AS "Kiểm tra", ket_qua AS "Kết quả",
       mong_doi AS "Mong đợi", dat AS "Đạt"
  FROM _bds_rls_check ORDER BY stt;
