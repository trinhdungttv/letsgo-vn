-- ============================================================================
-- 182 — Tuyển dụng (GĐ3): phân tích phễu & dự báo, nguồn lao động theo xã (bản đồ), chi phí theo kênh,
--        báo cáo tuần gửi khách
-- ----------------------------------------------------------------------------
--   recruit_channel_costs   chi phí tuyển theo tháng × kênh (Facebook, tờ rơi, CTV…) → chi phí / 1 người đi làm
--   recruit__rpc_p3         các báo cáo (chỉ ĐỌC, tên report.* — tài khoản "chỉ xem" cũng dùng được):
--     report.funnel   số hồ sơ qua từng bước theo nhà máy × nhóm vị trí × kênh, thời gian nộp → đi làm,
--                     nghỉ sớm (≤ 30 ngày), số hồ sơ vào / người đi làm theo tuần → dự báo kịp chỉ tiêu không
--     report.geo      ứng viên theo xã/phường đang ở (toạ độ xã) → bản đồ "vùng nào nhiều lao động, đi làm bền"
--     report.weekly   người nhận việc / nghỉ việc trong 1 khoảng ngày → báo cáo tuần cho khách
--   cost.list / cost.save / cost.delete   nhập chi phí theo kênh
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ thêm 1 bảng + hàm. Cần chạy SAU 180, 181. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

CREATE TABLE IF NOT EXISTS recruit_channel_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES recruit_projects(id) ON DELETE CASCADE,
  month       text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  channel     text NOT NULL,
  amount      bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  note        text NOT NULL DEFAULT '',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruit_channel_costs ON recruit_channel_costs(project_id, month, channel);
ALTER TABLE recruit_channel_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recruit_channel_costs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION recruit__rpc_p3(p_action text, a jsonb, u jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_project uuid := nullif(a->>'project_id', '')::uuid;
  v_id uuid;
BEGIN
  CASE p_action
  WHEN 'report.funnel' THEN
    RETURN jsonb_build_object(
      -- mỗi dòng: 1 nhà máy × 1 nhóm vị trí × 1 kênh; các cột = số hồ sơ ĐÃ TỚI bước đó HOẶC XA HƠN
      -- (người được nhận thẳng không qua phỏng vấn vẫn tính đã qua bước phỏng vấn → phễu luôn giảm dần)
      'rows', coalesce((SELECT jsonb_agg(r) FROM (
        SELECT x.site_id, coalesce(p.group_code, '') AS group_code, x.source_channel,
               count(*) AS total,
               count(*) FILTER (WHERE coalesce(x.contacted_at::date, x.interview_at::date, x.passed_at::date, x.start_date, x.fee_date) IS NOT NULL) AS contacted,
               count(*) FILTER (WHERE coalesce(x.interview_at::date, x.passed_at::date, x.start_date, x.fee_date) IS NOT NULL) AS interview,
               count(*) FILTER (WHERE coalesce(x.passed_at::date, x.start_date, x.fee_date) IS NOT NULL) AS passed,
               count(*) FILTER (WHERE coalesce(x.start_date, x.fee_date) IS NOT NULL) AS started,
               count(x.fee_date) AS fee_ok,
               -- hồ sơ đã nộp ≥ 14 ngày (đủ thời gian có kết quả) → đo tỷ lệ hồ sơ ra người đi làm không bị lạc quan
               count(*) FILTER (WHERE x.created_at < now() - interval '14 days') AS mature,
               count(*) FILTER (WHERE x.created_at < now() - interval '14 days' AND coalesce(x.start_date, x.fee_date) IS NOT NULL) AS mature_started,
               count(*) FILTER (WHERE x.stage IN ('rejected', 'dropped', 'no_show')) AS lost,
               count(*) FILTER (WHERE x.stage = 'left') AS left_count,
               count(*) FILTER (WHERE x.stage = 'left' AND x.left_date - x.start_date <= 30) AS early_left
        FROM recruit_applications x
        JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
        LEFT JOIN recruit_positions p ON p.id = x.position_id
        WHERE x.project_id = v_project AND x.deleted_at IS NULL
        GROUP BY 1, 2, 3) r), '[]'::jsonb),
      -- số ngày từ lúc nộp hồ sơ tới ngày đi làm (trung vị) — để biết phải gom hồ sơ trước bao lâu
      'median_days_to_start', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.start_date - (x.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        FROM recruit_applications x WHERE x.project_id = v_project AND x.deleted_at IS NULL AND x.start_date IS NOT NULL
          AND x.start_date >= (x.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date),
      -- 12 tuần gần nhất: hồ sơ mới vào / người bắt đầu đi làm
      'weeks', coalesce((SELECT jsonb_agg(w ORDER BY w.week) FROM (
        SELECT to_char(wk, 'YYYY-MM-DD') AS week,
               (SELECT count(*) FROM recruit_applications x WHERE x.project_id = v_project AND x.deleted_at IS NULL
                  AND (x.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= wk::date AND (x.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < wk::date + 7) AS created,
               (SELECT count(*) FROM recruit_applications x WHERE x.project_id = v_project AND x.deleted_at IS NULL
                  AND x.start_date >= wk::date AND x.start_date < wk::date + 7) AS started
        FROM generate_series(date_trunc('week', recruit__today()::timestamp) - interval '11 weeks',
                             date_trunc('week', recruit__today()::timestamp), interval '1 week') AS wk) w), '[]'::jsonb));

  WHEN 'report.geo' THEN
    RETURN coalesce((SELECT jsonb_agg(g ORDER BY g.total DESC) FROM (
      SELECT c.province, c.commune, avg(c.lat) AS lat, avg(c.lng) AS lng,
             count(*) AS total, count(x.start_date) AS started,
             count(*) FILTER (WHERE x.stage = 'left' AND x.left_date - x.start_date <= 30) AS early_left
      FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
      WHERE x.project_id = v_project AND x.deleted_at IS NULL
      GROUP BY 1, 2) g), '[]'::jsonb);

  WHEN 'report.weekly' THEN
    RETURN jsonb_build_object(
      'started', coalesce((SELECT jsonb_agg(recruit__app_full(x, c) ORDER BY x.start_date, c.full_name)
        FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
        WHERE x.project_id = v_project AND x.deleted_at IS NULL
          AND x.start_date BETWEEN (a->>'from')::date AND (a->>'to')::date), '[]'::jsonb),
      'left', coalesce((SELECT jsonb_agg(recruit__app_full(x, c) ORDER BY x.left_date, c.full_name)
        FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
        WHERE x.project_id = v_project AND x.deleted_at IS NULL AND x.stage = 'left'
          AND x.left_date BETWEEN (a->>'from')::date AND (a->>'to')::date), '[]'::jsonb));

  -- ── Chi phí theo kênh ──
  WHEN 'cost.list' THEN
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.month DESC, k.channel)
      FROM recruit_channel_costs k WHERE k.project_id = v_project), '[]'::jsonb);
  WHEN 'cost.save' THEN
    IF btrim(coalesce(a->>'channel', '')) = '' OR coalesce(a->>'month', '') !~ '^\d{4}-\d{2}$' THEN
      RAISE EXCEPTION 'Chọn tháng và kênh';
    END IF;
    INSERT INTO recruit_channel_costs (project_id, month, channel, amount, note, created_by)
    VALUES (v_project, a->>'month', btrim(a->>'channel'), greatest(coalesce((a->>'amount')::bigint, 0), 0), coalesce(a->>'note', ''), u->>'name')
    ON CONFLICT (project_id, month, channel) DO UPDATE
      SET amount = EXCLUDED.amount, note = EXCLUDED.note, updated_at = now()
    RETURNING id INTO v_id;
    RETURN (SELECT to_jsonb(k) FROM recruit_channel_costs k WHERE k.id = v_id);
  WHEN 'cost.delete' THEN
    DELETE FROM recruit_channel_costs WHERE id = (a->>'id')::uuid;
    RETURN jsonb_build_object('ok', true);
  ELSE
    RETURN NULL;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION recruit__rpc_p3(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
