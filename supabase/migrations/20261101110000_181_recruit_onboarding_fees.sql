-- ============================================================================
-- 181 — Tuyển dụng (GĐ2): đợt nhận việc, mốc tính phí / bảo hành tự động, đối soát phí, hoa hồng CTV,
--        form ứng tuyển công khai (link + QR)
-- ----------------------------------------------------------------------------
--   recruit_batches                đợt nhận việc tại nhà máy (ngày, giờ, sức chứa, điểm hẹn, tuyến xe)
--   recruit_applications.batch_id  người thuộc đợt nào → điểm danh cả đợt: Đã đến (Đã nhận việc) / Không đến
--   recruit_applications.fee_amount  phí giới thiệu CHỐT khi hồ sơ tới bước "Đủ ngày tính phí"
--                                  (trọn gói = lumpFee của dự án/vị trí; theo giờ/ngày = nhập ở đối soát;
--                                  người thay bảo hành = 0đ). Lùi bước khi chưa đối soát → bỏ phí đã chốt.
--   recruit_applications.ctv_amount  hoa hồng CTV (cấu hình recruit_projects.ctv) — tính khi tới mốc
--   recruit_settlements            bảng đối soát phí với khách theo tháng → ghi thành dòng doanh thu
--                                  "Giới thiệu lao động" trong P&L Dự án (app làm, lưu lại pnl_line_id)
--   recruit_projects.public_code / public_open   link ứng tuyển công khai (#/apply/<mã>) + mã QR
--   recruit_public_get / recruit_public_apply     2 hàm DUY NHẤT người ngoài gọi được: xem JD đang mở
--                                  và nộp hồ sơ (chỉ ghi, không đọc được gì của hồ sơ khác)
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ thêm bảng / cột (có DEFAULT) / hàm / trigger.
-- Cần chạy SAU 180. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

-- ── 1. Bảng & cột ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruit_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES recruit_projects(id) ON DELETE CASCADE,
  site_id       uuid REFERENCES recruit_sites(id) ON DELETE SET NULL,
  batch_date    date NOT NULL,
  start_time    text NOT NULL DEFAULT '',
  capacity      int CHECK (capacity IS NULL OR capacity >= 0),
  meeting_point text NOT NULL DEFAULT '',
  bus_route     text NOT NULL DEFAULT '',
  note          text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recruit_batches_project_date ON recruit_batches(project_id, batch_date);

CREATE TABLE IF NOT EXISTS recruit_settlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES recruit_projects(id) ON DELETE CASCADE,
  client_id    uuid REFERENCES clients(id) ON DELETE SET NULL,
  period       text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed')),
  total_amount bigint NOT NULL DEFAULT 0,
  line_count   int NOT NULL DEFAULT 0,
  pnl_id       uuid,
  pnl_line_id  uuid,
  note         text NOT NULL DEFAULT '',
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_recruit_settlements_project ON recruit_settlements(project_id, period);

ALTER TABLE recruit_applications
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES recruit_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fee_amount bigint,
  ADD COLUMN IF NOT EXISTS settlement_id uuid REFERENCES recruit_settlements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ctv_amount bigint,
  ADD COLUMN IF NOT EXISTS ctv_paid_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_recruit_apps_batch ON recruit_applications(batch_id);
CREATE INDEX IF NOT EXISTS idx_recruit_apps_settlement ON recruit_applications(settlement_id);

ALTER TABLE recruit_projects
  ADD COLUMN IF NOT EXISTS ctv jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS public_code text,
  ADD COLUMN IF NOT EXISTS public_open boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruit_projects_public_code ON recruit_projects(public_code) WHERE public_code IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recruit_batches', 'recruit_settlements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ── 2. Điều khoản phí của 1 hồ sơ: phí riêng của vị trí (nếu có) đè lên phí dự án ──
CREATE OR REPLACE FUNCTION recruit__fee_terms(p_project uuid, p_position uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT coalesce(p.fee, '{}'::jsonb) || coalesce(x.fee_override, '{}'::jsonb)
  FROM recruit_projects p LEFT JOIN recruit_positions x ON x.id = p_position
  WHERE p.id = p_project
$$;
REVOKE ALL ON FUNCTION recruit__fee_terms(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Tự chốt phí giới thiệu + hoa hồng CTV khi hồ sơ đổi bước ─────────────
CREATE OR REPLACE FUNCTION recruit__app_money() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  f jsonb;
  c jsonb;
  v_has_ref boolean;
  v_reached boolean;
BEGIN
  -- Phí giới thiệu: chỉ vị trí CHÍNH THỨC của khách (thời vụ Let's Go thu qua bảng lương, không phải phí GT)
  IF NEW.project_id IS NOT NULL AND NEW.employment_type = 'direct' THEN
    IF NEW.fee_date IS NOT NULL THEN
      IF NEW.replaces_id IS NOT NULL AND NEW.settlement_id IS NULL THEN
        NEW.fee_amount := 0; -- người thay trong thời gian bảo hành: miễn phí
      ELSIF NEW.fee_amount IS NULL THEN
        f := recruit__fee_terms(NEW.project_id, NEW.position_id);
        IF f->>'mode' = 'lump' THEN NEW.fee_amount := coalesce((f->>'lumpFee')::bigint, 0); END IF;
      END IF;
    ELSIF NEW.settlement_id IS NULL THEN
      NEW.fee_amount := NULL; -- lùi bước trước khi đối soát → bỏ phí đã chốt
    END IF;
  END IF;

  -- Hoa hồng CTV: người được giới thiệu (có CTV / người giới thiệu) tới mốc cấu hình của dự án
  IF NEW.project_id IS NOT NULL AND NEW.ctv_paid_at IS NULL THEN
    SELECT p.ctv INTO c FROM recruit_projects p WHERE p.id = NEW.project_id;
    SELECT (cd.referrer_contact_id IS NOT NULL OR cd.referrer_name <> '') INTO v_has_ref
      FROM recruit_candidates cd WHERE cd.id = NEW.candidate_id;
    v_reached := CASE WHEN coalesce(c->>'milestone', 'fee_ok') = 'started' THEN NEW.start_date IS NOT NULL
                      ELSE NEW.fee_date IS NOT NULL OR (NEW.employment_type = 'leasing' AND NEW.start_date IS NOT NULL) END;
    IF coalesce(v_has_ref, false) AND v_reached AND coalesce((c->>'value')::numeric, 0) > 0 THEN
      NEW.ctv_amount := CASE
        WHEN c->>'mode' = 'pct_fee' THEN CASE WHEN NEW.fee_amount IS NULL THEN NULL ELSE round(NEW.fee_amount * (c->>'value')::numeric / 100) END
        ELSE round((c->>'value')::numeric) END;
    ELSE
      NEW.ctv_amount := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION recruit__app_money() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recruit_app_money ON recruit_applications;
CREATE TRIGGER trg_recruit_app_money BEFORE INSERT OR UPDATE ON recruit_applications
  FOR EACH ROW EXECUTE FUNCTION recruit__app_money();

-- ── 4. Ứng tuyển + đủ thông tin để xuất danh sách (CCCD cho phòng nhân sự khách) ──
CREATE OR REPLACE FUNCTION recruit__app_full(a recruit_applications, c recruit_candidates) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT recruit__app_json(a, c) || jsonb_build_object('candidate',
    recruit__app_json(a, c)->'candidate' || jsonb_build_object('id_number', c.id_number, 'address', c.address,
      'hometown', c.hometown, 'major', c.major, 'referrer_phone', c.referrer_phone, 'referrer_contact_id', c.referrer_contact_id))
$$;

-- ── 5. Thao tác GĐ2 (gọi từ recruit_rpc; trả NULL khi không phải việc của GĐ2) ──
CREATE OR REPLACE FUNCTION recruit__rpc_p2(p_action text, a jsonb, u jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
  v_ids uuid[];
  v_today date := coalesce(nullif(a->>'today', '')::date, recruit__today());
  v_project uuid := nullif(a->>'project_id', '')::uuid;
  v_by text := u->>'name';
  v_n int;
  v_code text;
  v_total bigint;
BEGIN
  CASE p_action
  -- ── Việc hôm nay (phần phí / bảo hành / đợt nhận việc) ──
  WHEN 'today.get' THEN
    RETURN (WITH base AS (
      SELECT a2 AS x, c, recruit__fee_terms(a2.project_id, a2.position_id) AS f
      FROM recruit_applications a2 JOIN recruit_candidates c ON c.id = a2.candidate_id AND c.deleted_at IS NULL
      WHERE a2.deleted_at IS NULL AND (v_project IS NULL OR a2.project_id = v_project)
    )
    SELECT jsonb_build_object(
      -- tới mốc tính phí (làm đủ N ngày) → gọi xác nhận còn đi làm rồi chuyển "Đủ ngày tính phí"
      'fee_due', coalesce((SELECT jsonb_agg(recruit__app_json(x, c) || jsonb_build_object('due', (x).start_date + coalesce((f->>'minDays')::int, 0)) ORDER BY (x).start_date)
        FROM base WHERE (x).stage = 'started' AND (x).employment_type = 'direct' AND f ? 'minDays'
          AND (x).start_date + coalesce((f->>'minDays')::int, 0) <= v_today), '[]'::jsonb),
      -- nghỉ trong thời gian bảo hành mà chưa có người thay
      'need_replacement', coalesce((SELECT jsonb_agg(recruit__app_json(x, c) || jsonb_build_object('guarantee_end', (x).fee_date + coalesce((f->>'guaranteeDays')::int, 0)) ORDER BY (x).left_date)
        FROM base WHERE (x).stage = 'left' AND (x).fee_date IS NOT NULL AND coalesce((f->>'guaranteeDays')::int, 0) > 0
          AND (x).left_date <= (x).fee_date + (f->>'guaranteeDays')::int
          AND NOT EXISTS (SELECT 1 FROM recruit_applications r WHERE r.replaces_id = (x).id AND r.deleted_at IS NULL
                          AND r.stage NOT IN ('rejected', 'dropped', 'no_show'))), '[]'::jsonb),
      -- hết bảo hành → chuyển "Hết bảo hành"
      'guarantee_over', coalesce((SELECT jsonb_agg(recruit__app_json(x, c) ORDER BY (x).fee_date)
        FROM base WHERE (x).stage = 'fee_ok' AND (x).fee_date + coalesce((f->>'guaranteeDays')::int, 0) < v_today), '[]'::jsonb),
      'batches', coalesce((SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('assigned',
          (SELECT count(*) FROM recruit_applications x WHERE x.batch_id = b.id AND x.deleted_at IS NULL)) ORDER BY b.batch_date, b.start_time)
        FROM recruit_batches b WHERE (v_project IS NULL OR b.project_id = v_project) AND b.status = 'planned'
          AND b.batch_date BETWEEN v_today - 1 AND v_today + 1), '[]'::jsonb)
    ));

  -- ── Đợt nhận việc ──
  WHEN 'batch.list' THEN
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object(
        'assigned', (SELECT count(*) FROM recruit_applications x WHERE x.batch_id = b.id AND x.deleted_at IS NULL),
        'started', (SELECT count(*) FROM recruit_applications x WHERE x.batch_id = b.id AND x.deleted_at IS NULL AND x.start_date IS NOT NULL),
        'no_show', (SELECT count(*) FROM recruit_applications x WHERE x.batch_id = b.id AND x.deleted_at IS NULL AND x.stage = 'no_show'))
      ORDER BY b.batch_date DESC, b.start_time)
      FROM recruit_batches b WHERE b.project_id = v_project
        AND (nullif(a->>'from', '') IS NULL OR b.batch_date >= (a->>'from')::date)), '[]'::jsonb);
  WHEN 'batch.get' THEN
    v_id := (a->>'id')::uuid;
    RETURN jsonb_build_object(
      'batch', (SELECT to_jsonb(b) FROM recruit_batches b WHERE b.id = v_id),
      'rows', coalesce((SELECT jsonb_agg(recruit__app_full(x, c) ORDER BY c.full_name)
        FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
        WHERE x.batch_id = v_id AND x.deleted_at IS NULL), '[]'::jsonb));
  WHEN 'batch.save' THEN
    IF nullif(a->>'batch_date', '') IS NULL THEN RAISE EXCEPTION 'Chọn ngày nhận việc'; END IF;
    v_id := nullif(a->>'id', '')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO recruit_batches (project_id, batch_date, created_by) VALUES (v_project, (a->>'batch_date')::date, v_by) RETURNING id INTO v_id;
    END IF;
    PERFORM recruit__patch('recruit_batches', v_id, a, ARRAY['project_id']);
    -- đổi ngày đợt → ngày nhận việc dự kiến của người chưa đi làm cũng đổi theo
    UPDATE recruit_applications x SET planned_start = b.batch_date, updated_at = now()
      FROM recruit_batches b WHERE b.id = v_id AND x.batch_id = v_id AND x.stage = 'ready' AND x.planned_start IS DISTINCT FROM b.batch_date;
    RETURN (SELECT to_jsonb(b) FROM recruit_batches b WHERE b.id = v_id);
  WHEN 'batch.delete' THEN
    v_id := (a->>'id')::uuid;
    UPDATE recruit_applications SET batch_id = NULL, updated_at = now() WHERE batch_id = v_id;
    DELETE FROM recruit_batches WHERE id = v_id;
    RETURN jsonb_build_object('ok', true);
  WHEN 'batch.assign' THEN
    -- xếp người vào đợt: người chưa tới "Chờ nhận việc" thì chuyển luôn sang bước đó với ngày của đợt
    v_id := (a->>'batch_id')::uuid;
    v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'ids', '[]'::jsonb))::uuid);
    UPDATE recruit_applications SET batch_id = v_id, updated_at = now() WHERE id = ANY (v_ids) AND deleted_at IS NULL;
    PERFORM recruit__move(ARRAY(SELECT id FROM recruit_applications WHERE id = ANY (v_ids) AND stage IN ('new', 'contacted', 'interview', 'passed', 'ready')),
                          'ready', jsonb_build_object('planned_start', (SELECT batch_date FROM recruit_batches WHERE id = v_id), 'note', 'Xếp vào đợt nhận việc'), v_by);
    UPDATE recruit_applications x SET planned_start = b.batch_date
      FROM recruit_batches b WHERE b.id = v_id AND x.id = ANY (v_ids) AND x.stage = 'ready';
    RETURN jsonb_build_object('assigned', cardinality(v_ids));
  WHEN 'batch.unassign' THEN
    v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'ids', '[]'::jsonb))::uuid);
    UPDATE recruit_applications SET batch_id = NULL, updated_at = now() WHERE id = ANY (v_ids);
    RETURN jsonb_build_object('ok', true);

  -- ── Đối soát phí ──
  WHEN 'settle.preview' THEN
    -- hồ sơ đủ ngày tính phí trong tháng (hoặc trước đó mà còn sót), chưa đối soát
    RETURN coalesce((SELECT jsonb_agg(recruit__app_full(x, c) || jsonb_build_object('bill_client_id',
        coalesce(s.client_id, p.client_id)) ORDER BY x.fee_date, c.full_name)
      FROM recruit_applications x
      JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
      JOIN recruit_projects p ON p.id = x.project_id
      LEFT JOIN recruit_sites s ON s.id = x.site_id
      WHERE x.project_id = v_project AND x.deleted_at IS NULL AND x.settlement_id IS NULL
        AND x.employment_type = 'direct' AND x.fee_date IS NOT NULL
        AND to_char(x.fee_date, 'YYYY-MM') <= a->>'period'), '[]'::jsonb);
  WHEN 'settle.set_amount' THEN
    UPDATE recruit_applications SET fee_amount = nullif(a->>'amount', '')::bigint, updated_at = now()
      WHERE id = (a->>'id')::uuid AND settlement_id IS NULL;
    RETURN jsonb_build_object('ok', true);
  WHEN 'settle.create' THEN
    v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'ids', '[]'::jsonb))::uuid);
    IF cardinality(v_ids) = 0 THEN RAISE EXCEPTION 'Chưa chọn hồ sơ nào để đối soát'; END IF;
    IF EXISTS (SELECT 1 FROM recruit_applications WHERE id = ANY (v_ids) AND (settlement_id IS NOT NULL OR fee_amount IS NULL)) THEN
      RAISE EXCEPTION 'Có hồ sơ đã đối soát hoặc chưa có số tiền phí — tải lại rồi chọn lại';
    END IF;
    INSERT INTO recruit_settlements (project_id, client_id, period, note, created_by)
    VALUES (v_project, nullif(a->>'client_id', '')::uuid, a->>'period', coalesce(a->>'note', ''), v_by) RETURNING id INTO v_id;
    UPDATE recruit_applications SET settlement_id = v_id, updated_at = now() WHERE id = ANY (v_ids);
    UPDATE recruit_settlements st SET
      total_amount = (SELECT coalesce(sum(fee_amount), 0) FROM recruit_applications WHERE settlement_id = v_id),
      line_count = (SELECT count(*) FROM recruit_applications WHERE settlement_id = v_id)
    WHERE st.id = v_id;
    RETURN (SELECT to_jsonb(st) FROM recruit_settlements st WHERE st.id = v_id);
  WHEN 'settle.list' THEN
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(st) ORDER BY st.period DESC, st.created_at DESC)
      FROM recruit_settlements st WHERE st.project_id = v_project AND st.deleted_at IS NULL), '[]'::jsonb);
  WHEN 'settle.get' THEN
    v_id := (a->>'id')::uuid;
    RETURN jsonb_build_object(
      'settlement', (SELECT to_jsonb(st) FROM recruit_settlements st WHERE st.id = v_id),
      'rows', coalesce((SELECT jsonb_agg(recruit__app_full(x, c) ORDER BY x.fee_date, c.full_name)
        FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id
        WHERE x.settlement_id = v_id), '[]'::jsonb));
  WHEN 'settle.update' THEN
    v_id := (a->>'id')::uuid;
    IF a ? 'status' AND a->>'status' NOT IN ('draft', 'sent', 'confirmed') THEN RAISE EXCEPTION 'Trạng thái không hợp lệ'; END IF;
    PERFORM recruit__patch('recruit_settlements', v_id, a, ARRAY['project_id', 'client_id', 'period', 'total_amount', 'line_count']);
    RETURN (SELECT to_jsonb(st) FROM recruit_settlements st WHERE st.id = v_id);
  WHEN 'settle.delete' THEN
    v_id := (a->>'id')::uuid;
    IF EXISTS (SELECT 1 FROM recruit_settlements WHERE id = v_id AND pnl_line_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Bảng đối soát đã ghi vào P&L — xoá dòng doanh thu ở Tài chính trước, rồi bỏ đánh dấu';
    END IF;
    UPDATE recruit_applications SET settlement_id = NULL, updated_at = now() WHERE settlement_id = v_id;
    UPDATE recruit_settlements SET deleted_at = now(), updated_at = now() WHERE id = v_id;
    RETURN jsonb_build_object('ok', true);

  -- ── Hoa hồng CTV ──
  WHEN 'ctv.list' THEN
    RETURN coalesce((SELECT jsonb_agg(recruit__app_full(x, c) ORDER BY coalesce(c.referrer_name, ''), x.start_date)
      FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id AND c.deleted_at IS NULL
      WHERE x.deleted_at IS NULL AND x.ctv_amount IS NOT NULL AND (v_project IS NULL OR x.project_id = v_project)
        AND (coalesce((a->>'unpaid_only')::boolean, false) = false OR x.ctv_paid_at IS NULL)), '[]'::jsonb);
  WHEN 'ctv.pay' THEN
    v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'ids', '[]'::jsonb))::uuid);
    UPDATE recruit_applications SET ctv_paid_at = CASE WHEN coalesce((a->>'paid')::boolean, true) THEN now() ELSE NULL END, updated_at = now()
      WHERE id = ANY (v_ids) AND ctv_amount IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('updated', v_n);

  -- ── Link ứng tuyển công khai ──
  WHEN 'project.share' THEN
    v_id := (a->>'id')::uuid;
    SELECT public_code INTO v_code FROM recruit_projects WHERE id = v_id;
    IF v_code IS NULL THEN
      -- mã 6 ký tự, bỏ ký tự dễ nhầm (0/O, 1/I/L) — giống link Phương án giá
      LOOP
        v_code := '';
        FOR v_n IN 1..6 LOOP
          v_code := v_code || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM recruit_projects WHERE public_code = v_code);
      END LOOP;
    END IF;
    UPDATE recruit_projects SET public_code = v_code, public_open = coalesce((a->>'open')::boolean, true), updated_at = now() WHERE id = v_id;
    RETURN (SELECT to_jsonb(p) FROM recruit_projects p WHERE p.id = v_id);
  ELSE
    RETURN NULL;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION recruit__rpc_p2(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 6. Form ứng tuyển công khai (người ngoài, không đăng nhập) ──────────────
-- Chỉ trả thông tin tuyển dụng đang mở — không có dữ liệu ứng viên nào.
CREATE OR REPLACE FUNCTION recruit_public_get(p_code text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT jsonb_build_object(
    'project', jsonb_build_object('name', p.name, 'no_worker_fee', p.no_worker_fee),
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'zone_name', s.zone_name, 'address', s.address) ORDER BY s.sort_order, s.name)
                       FROM recruit_sites s WHERE s.project_id = p.id), '[]'::jsonb),
    'positions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                   'id', x.id, 'title', x.title, 'group_code', x.group_code, 'site_ids', x.site_ids, 'salary_min', x.salary_min,
                   'salary_max', x.salary_max, 'salary_note', x.salary_note, 'hours_per_week', x.hours_per_week, 'shift_note', x.shift_note,
                   'description', x.description, 'requirements', x.requirements, 'benefits', x.benefits, 'education_min', x.education_min,
                   'age_min', x.age_min, 'age_max', x.age_max, 'gender_pref', x.gender_pref, 'cleanroom', x.cleanroom) ORDER BY x.sort_order, x.created_at)
                   FROM recruit_positions x WHERE x.project_id = p.id AND x.deleted_at IS NULL AND x.is_open AND x.confirmed), '[]'::jsonb))
  FROM recruit_projects p
  WHERE p.public_code = upper(btrim(p_code)) AND p.public_open AND p.status = 'active' AND p.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION recruit_public_get(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recruit_public_get(text) TO anon, authenticated;

-- Nộp hồ sơ: SĐT đã có → dùng hồ sơ cũ (KHÔNG sửa, KHÔNG cho biết là đã có); đã có hồ sơ mở trong dự án → bỏ qua.
-- Luôn trả { ok: true } khi dữ liệu hợp lệ để người ngoài không dò được ai đã có trong kho.
CREATE OR REPLACE FUNCTION recruit_public_apply(p_code text, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  p recruit_projects;
  v_name text := left(btrim(regexp_replace(coalesce(p_data->>'full_name', ''), '\s+', ' ', 'g')), 120);
  v_phone text := recruit__norm_phone(left(coalesce(p_data->>'phone', ''), 30));
  v_year int;
  v_cand uuid;
  v_site uuid;
  v_pos uuid;
  v_ref uuid;
BEGIN
  SELECT * INTO p FROM recruit_projects WHERE public_code = upper(btrim(p_code)) AND public_open AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed'); END IF;
  IF v_name = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name'); END IF;
  IF v_phone !~ '^0\d{9}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'phone'); END IF;
  IF coalesce((p_data->>'consent')::boolean, false) = false THEN RETURN jsonb_build_object('ok', false, 'reason', 'consent'); END IF;
  -- chống spam: tối đa 300 hồ sơ / 10 phút cho 1 dự án
  IF (SELECT count(*) FROM recruit_events e JOIN recruit_applications x ON x.id = e.application_id
      WHERE x.project_id = p.id AND e.kind = 'form' AND e.at > now() - interval '10 minutes') >= 300 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'busy');
  END IF;
  v_year := CASE WHEN coalesce(p_data->>'birth_year', '') ~ '^(19[4-9]\d|20[01]\d)$' THEN (p_data->>'birth_year')::int END;
  v_site := (SELECT s.id FROM recruit_sites s WHERE s.project_id = p.id AND s.id::text = p_data->>'site_id');
  v_pos := (SELECT x.id FROM recruit_positions x WHERE x.project_id = p.id AND x.deleted_at IS NULL AND x.id::text = p_data->>'position_id');
  v_ref := (SELECT ct.id FROM contacts ct WHERE ct.id::text = p_data->>'ref' AND ct.kind = 'sale');

  SELECT id INTO v_cand FROM recruit_candidates WHERE phone = v_phone AND deleted_at IS NULL;
  IF v_cand IS NULL THEN
    INSERT INTO recruit_candidates (full_name, phone, birth_year, gender, province, commune, address, education, major,
                                    experience, source_channel, referrer_contact_id, referrer_name, referrer_phone,
                                    consent_at, consent_source, created_by)
    VALUES (v_name, v_phone, v_year,
            CASE WHEN p_data->>'gender' IN ('male', 'female') THEN p_data->>'gender' END,
            left(coalesce(p_data->>'province', ''), 80), left(coalesce(p_data->>'commune', ''), 120), left(coalesce(p_data->>'address', ''), 200),
            CASE WHEN p_data->>'education' IN ('none', 'thcs', 'thpt', 'trung_cap', 'cao_dang', 'dai_hoc') THEN p_data->>'education' ELSE '' END,
            left(coalesce(p_data->>'major', ''), 120), left(coalesce(p_data->>'experience', ''), 500),
            CASE WHEN v_ref IS NOT NULL THEN 'CTV giới thiệu' ELSE 'Form tuyển dụng' END,
            v_ref, CASE WHEN v_ref IS NOT NULL THEN coalesce((SELECT name FROM contacts WHERE id = v_ref), '') ELSE left(coalesce(p_data->>'referrer_name', ''), 120) END,
            recruit__norm_phone(left(coalesce(p_data->>'referrer_phone', ''), 30)),
            now(), 'form', 'Form tuyển dụng')
    RETURNING id INTO v_cand;
  END IF;
  BEGIN
    INSERT INTO recruit_applications (candidate_id, project_id, site_id, position_id, client_id, stage, source_channel, note, created_by)
    VALUES (v_cand, p.id, v_site, v_pos, coalesce((SELECT client_id FROM recruit_sites WHERE id = v_site), p.client_id), 'new',
            CASE WHEN v_ref IS NOT NULL THEN 'CTV giới thiệu' ELSE 'Form tuyển dụng' END, left(coalesce(p_data->>'note', ''), 500), 'Form tuyển dụng');
    INSERT INTO recruit_events (application_id, candidate_id, kind, to_stage, note, by_name)
    SELECT x.id, v_cand, 'form', 'new', 'Tự nộp qua form tuyển dụng', 'Form tuyển dụng'
    FROM recruit_applications x WHERE x.candidate_id = v_cand AND x.project_id = p.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1;
  EXCEPTION WHEN unique_violation THEN
    NULL; -- đã có hồ sơ đang mở trong dự án: không tạo thêm
  END;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION recruit_public_apply(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recruit_public_apply(text, jsonb) TO anon, authenticated;
