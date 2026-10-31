-- ============================================================================
-- 183 — Tuyển dụng (GĐ4): lao động THỜI VỤ quản lý tới từng người, cảnh báo mốc 12 tháng, chuyển chính thức
-- ----------------------------------------------------------------------------
-- Lao động thời vụ của các khách cho thuê hiện có (55 khách) dùng chung kho ứng viên + bảng recruit_applications:
-- 1 người đang làm cho 1 khách = 1 dòng employment_type 'leasing', bước 'started' (không cần dự án tuyển dụng).
--
--   recruit_applications.contract_end   HĐ thời vụ đến ngày (tuỳ chọn)
--   uq_recruit_apps_one_leasing          1 người chỉ đang làm thời vụ ở 1 nơi tại 1 thời điểm
--   recruit__rpc_p4:
--     workforce.list     danh sách người đang làm thời vụ (lọc theo khách), kèm số ngày đã làm
--     report.workforce   tổng theo khách: đang làm, ≥ 10 tháng, ≥ 12 tháng (BLLĐ 2019 Điều 53: cho thuê lại lao động
--                        tối đa 12 tháng) + số lao động tuần gần nhất đang nhập ở Khách hàng để đối chiếu
--     workforce.convert  chuyển chính thức cho khách: đóng hồ sơ thời vụ (bước 'converted') + mở hồ sơ CHÍNH THỨC
--                        (direct, đã đi làm từ ngày chuyển; có phí chuyển đổi thì ghi luôn để đối soát)
--
-- Không đụng bảng client_labor_history (chỉ ĐỌC số tuần gần nhất để so). Có mất dữ liệu hiện có không? KHÔNG.
-- Cần chạy SAU 180, 181. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

ALTER TABLE recruit_applications ADD COLUMN IF NOT EXISTS contract_end date;
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruit_apps_one_leasing ON recruit_applications(candidate_id)
  WHERE deleted_at IS NULL AND employment_type = 'leasing' AND stage IN ('started', 'fee_ok');
CREATE INDEX IF NOT EXISTS idx_recruit_apps_client_emp ON recruit_applications(client_id, employment_type, stage);

CREATE OR REPLACE FUNCTION recruit__rpc_p4(p_action text, a jsonb, u jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_today date := recruit__today();
  v_client uuid := nullif(a->>'client_id', '')::uuid;
  v_ids uuid[];
  v_date date;
  v_old recruit_applications;
  v_new uuid;
  v_n int := 0;
  v_fee bigint := nullif(a->>'fee_amount', '')::bigint;
  v_project uuid := nullif(a->>'project_id', '')::uuid;
BEGIN
  CASE p_action
  WHEN 'workforce.list' THEN
    RETURN coalesce((SELECT jsonb_agg(recruit__app_full(x, c) || jsonb_build_object('days', v_today - x.start_date) ORDER BY x.start_date, c.full_name)
      FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
      WHERE x.deleted_at IS NULL AND x.employment_type = 'leasing' AND x.stage IN ('started', 'fee_ok')
        AND (v_client IS NULL OR x.client_id = v_client)
        AND (coalesce((a->>'over10')::boolean, false) = false OR x.start_date <= v_today - interval '10 months')), '[]'::jsonb);

  WHEN 'report.workforce' THEN
    RETURN coalesce((SELECT jsonb_agg(r ORDER BY r.active DESC) FROM (
      SELECT x.client_id,
             count(*) AS active,
             count(*) FILTER (WHERE x.start_date <= v_today - interval '10 months' AND x.start_date > v_today - interval '12 months') AS warn10,
             count(*) FILTER (WHERE x.start_date <= v_today - interval '12 months') AS over12,
             count(*) FILTER (WHERE x.contract_end IS NOT NULL AND x.contract_end <= v_today + 30) AS contract_ending,
             (SELECT h.count FROM client_labor_history h WHERE h.client_id = x.client_id ORDER BY h.created_at DESC LIMIT 1) AS weekly_count,
             (SELECT h.week_label FROM client_labor_history h WHERE h.client_id = x.client_id ORDER BY h.created_at DESC LIMIT 1) AS weekly_label
      FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
      WHERE x.deleted_at IS NULL AND x.employment_type = 'leasing' AND x.stage IN ('started', 'fee_ok') AND x.client_id IS NOT NULL
      GROUP BY x.client_id) r), '[]'::jsonb);

  WHEN 'workforce.convert' THEN
    v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'ids', '[]'::jsonb))::uuid);
    v_date := coalesce(nullif(a->>'date', '')::date, v_today);
    FOR v_old IN SELECT * FROM recruit_applications WHERE id = ANY (v_ids) AND deleted_at IS NULL
                   AND employment_type = 'leasing' AND stage IN ('started', 'fee_ok') LOOP
      PERFORM recruit__move(ARRAY[v_old.id], 'converted',
        jsonb_build_object('left_date', v_date, 'reason', 'Chuyển chính thức cho khách', 'note', coalesce(a->>'note', '')), u->>'name');
      INSERT INTO recruit_applications (candidate_id, project_id, site_id, client_id, employment_type, stage, source_channel,
                                        contacted_at, passed_at, ready_at, start_date, fee_date, fee_amount, employee_code, note, created_by)
      VALUES (v_old.candidate_id, coalesce(v_project, v_old.project_id), v_old.site_id, v_old.client_id, 'direct',
              CASE WHEN v_fee IS NOT NULL THEN 'fee_ok' ELSE 'started' END, v_old.source_channel,
              now(), now(), now(), v_date, CASE WHEN v_fee IS NOT NULL THEN v_date END, v_fee, v_old.employee_code,
              'Chuyển từ thời vụ (làm từ ' || to_char(v_old.start_date, 'DD/MM/YYYY') || ')', u->>'name')
      RETURNING id INTO v_new;
      INSERT INTO recruit_events (application_id, candidate_id, kind, from_stage, to_stage, note, by_name)
      VALUES (v_new, v_old.candidate_id, 'create', 'converted', CASE WHEN v_fee IS NOT NULL THEN 'fee_ok' ELSE 'started' END,
              'Chuyển chính thức' || CASE WHEN v_fee IS NOT NULL THEN ' — phí ' || v_fee || 'đ' ELSE '' END, u->>'name');
      v_n := v_n + 1;
    END LOOP;
    RETURN jsonb_build_object('converted', v_n);
  ELSE
    RETURN NULL;
  END CASE;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Người này đang có hồ sơ khác còn mở ở dự án đó — đóng hồ sơ kia trước khi chuyển';
END $$;
REVOKE ALL ON FUNCTION recruit__rpc_p4(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
