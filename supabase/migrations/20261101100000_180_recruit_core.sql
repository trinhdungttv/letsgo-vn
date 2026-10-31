-- ============================================================================
-- 180 — Module TUYỂN DỤNG (GĐ1): dự án tuyển, nhà máy, vị trí (JD), chỉ tiêu, kho ứng viên, ứng tuyển
-- ----------------------------------------------------------------------------
-- Bối cảnh: dự án Co-Herent (5.511 lượt tuyển 11/2026–04/2027, 3 nhà máy). Trước giờ hệ thống chỉ quản lý
-- theo CÔNG TY + SỐ LƯỢNG (client_labor_history). Giới thiệu lao động / tuyển chính thức cần quản lý TỪNG
-- NGƯỜI: ai nộp hồ sơ, ai phỏng vấn đạt, ai đi làm ngày nào, ai đủ ngày tính phí.
--
--   recruit_projects      dự án tuyển dụng (1 khách, nhiều nhà máy) + điều khoản phí giới thiệu (jsonb `fee`,
--                         cùng dạng ReferralConfig của Phương án giá — src/lib/costPlan/referral.ts)
--   recruit_sites         nhà máy / địa điểm làm việc — mỗi nơi gắn 1 chi nhánh phụ trách + thẻ khách hàng
--                         (Co-Herent trải 3 chi nhánh: không phải đổi bảng clients)
--   recruit_positions     vị trí tuyển (JD): nhóm A/B/C, chính thức của KH (direct) hay thời vụ LGV (leasing),
--                         lương, ca, mô tả, yêu cầu, phúc lợi. confirmed = false → chỉ là vị trí khảo sát (nhóm C)
--   recruit_targets       chỉ tiêu: nhà máy × tháng (× vị trí; trống = chưa chia vị trí, như bảng KH gửi)
--   recruit_candidates    kho ứng viên DÙNG CHUNG mọi dự án / chi nhánh — chống trùng theo SĐT và CCCD
--   recruit_applications  ứng tuyển: 1 người × 1 dự án, đi qua các bước
--                           new → contacted → interview → passed → ready → started → fee_ok → done
--                         đóng: rejected (không đạt) · dropped (ứng viên bỏ) · no_show (không đến nhận việc)
--                               left (nghỉ việc) · converted (thời vụ chuyển chính thức — GĐ4)
--   recruit_events        nhật ký chuyển bước (ai, lúc nào) — đo thời gian tuyển, truy vết khi KH hỏi
--
-- BẢO MẬT (quan trọng): các bảng có SĐT / CCCD của hàng nghìn người lao động. Bảng khác của app đang đọc
-- được bằng anon key (nằm sẵn trong file JS gửi xuống trình duyệt) → bảng recruit_* KHOÁ HẲN (REVOKE ALL,
-- không có policy nào). Mọi đọc/ghi đi qua 1 hàm recruit_rpc(p_token, p_action, p_args): kiểm phiên đăng
-- nhập (cp_session — migration 157) + quyền module 'Tuyển dụng' trong role_permissions (admin luôn được).
-- KHÔNG gắn trigger data_history (bảng đó đọc được bằng anon key → sẽ lộ dữ liệu cá nhân); lịch sử thao tác
-- nằm ở recruit_events (cũng khoá).
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO bảng / hàm mới + thêm dòng quyền 'Tuyển dụng'.
-- Cần chạy SAU migration 157 (hàm cp_session). Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

-- ── 1. Bảng ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruit_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,
  contact_name  text NOT NULL DEFAULT '',
  contact_title text NOT NULL DEFAULT '',
  period_from   text CHECK (period_from IS NULL OR period_from ~ '^\d{4}-\d{2}$'),
  period_to     text CHECK (period_to IS NULL OR period_to ~ '^\d{4}-\d{2}$'),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  fee           jsonb NOT NULL DEFAULT '{}'::jsonb,
  no_worker_fee boolean NOT NULL DEFAULT true,
  notes         text NOT NULL DEFAULT '',
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE IF NOT EXISTS recruit_sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES recruit_projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  zone_name   text NOT NULL DEFAULT '',
  branch_id   uuid REFERENCES branches(id) ON DELETE SET NULL,
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  address     text NOT NULL DEFAULT '',
  lat         double precision,
  lng         double precision,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recruit_sites_project ON recruit_sites(project_id);

CREATE TABLE IF NOT EXISTS recruit_positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES recruit_projects(id) ON DELETE CASCADE,
  title           text NOT NULL,
  group_code      text NOT NULL DEFAULT 'B' CHECK (group_code IN ('A', 'B', 'C', 'other')),
  employment_type text NOT NULL DEFAULT 'direct' CHECK (employment_type IN ('direct', 'leasing')),
  confirmed       boolean NOT NULL DEFAULT true,
  is_open         boolean NOT NULL DEFAULT true,
  site_ids        uuid[] NOT NULL DEFAULT '{}',
  salary_min      bigint,
  salary_max      bigint,
  salary_note     text NOT NULL DEFAULT '',
  hours_per_week  numeric,
  shift_note      text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  requirements    text NOT NULL DEFAULT '',
  benefits        text NOT NULL DEFAULT '',
  education_min   text NOT NULL DEFAULT '',
  age_min         int,
  age_max         int,
  gender_pref     text NOT NULL DEFAULT 'any' CHECK (gender_pref IN ('any', 'male', 'female')),
  cleanroom       boolean NOT NULL DEFAULT false,
  fee_override    jsonb,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_recruit_positions_project ON recruit_positions(project_id);

CREATE TABLE IF NOT EXISTS recruit_targets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES recruit_projects(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL REFERENCES recruit_sites(id) ON DELETE CASCADE,
  position_id uuid REFERENCES recruit_positions(id) ON DELETE CASCADE,
  month       text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  qty         int NOT NULL DEFAULT 0 CHECK (qty >= 0),
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'confirmed', 'cancelled')),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruit_targets_cell
  ON recruit_targets(site_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), month);
CREATE INDEX IF NOT EXISTS idx_recruit_targets_project ON recruit_targets(project_id);

CREATE TABLE IF NOT EXISTS recruit_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           text NOT NULL,
  phone               text NOT NULL DEFAULT '',
  phone_alt           text NOT NULL DEFAULT '',
  id_number           text NOT NULL DEFAULT '',
  birth_year          int CHECK (birth_year IS NULL OR birth_year BETWEEN 1940 AND 2015),
  gender              text CHECK (gender IS NULL OR gender IN ('male', 'female')),
  province            text NOT NULL DEFAULT '',
  commune             text NOT NULL DEFAULT '',
  address             text NOT NULL DEFAULT '',
  hometown            text NOT NULL DEFAULT '',
  lat                 double precision,
  lng                 double precision,
  education           text NOT NULL DEFAULT '',
  major               text NOT NULL DEFAULT '',
  diploma_pending     boolean NOT NULL DEFAULT false,
  diploma_due         date,
  experience          text NOT NULL DEFAULT '',
  shift_ok            boolean,
  cleanroom_ok        boolean,
  source_channel      text NOT NULL DEFAULT '',
  referrer_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  referrer_name       text NOT NULL DEFAULT '',
  referrer_phone      text NOT NULL DEFAULT '',
  consent_at          timestamptz,
  consent_source      text NOT NULL DEFAULT '',
  blacklisted         boolean NOT NULL DEFAULT false,
  blacklist_reason    text NOT NULL DEFAULT '',
  notes               text NOT NULL DEFAULT '',
  tags                text[] NOT NULL DEFAULT '{}',
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
-- Chống trùng: 1 SĐT / 1 CCCD chỉ thuộc 1 hồ sơ còn dùng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruit_candidates_phone ON recruit_candidates(phone)
  WHERE deleted_at IS NULL AND phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruit_candidates_id_number ON recruit_candidates(id_number)
  WHERE deleted_at IS NULL AND id_number <> '';
CREATE INDEX IF NOT EXISTS idx_recruit_candidates_created ON recruit_candidates(created_at DESC);

CREATE TABLE IF NOT EXISTS recruit_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES recruit_candidates(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES recruit_projects(id) ON DELETE SET NULL,
  site_id         uuid REFERENCES recruit_sites(id) ON DELETE SET NULL,
  position_id     uuid REFERENCES recruit_positions(id) ON DELETE SET NULL,
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
  employment_type text NOT NULL DEFAULT 'direct' CHECK (employment_type IN ('direct', 'leasing')),
  stage           text NOT NULL DEFAULT 'new' CHECK (stage IN (
                    'new', 'contacted', 'interview', 'passed', 'ready', 'started', 'fee_ok', 'done',
                    'rejected', 'dropped', 'no_show', 'left', 'converted')),
  source_channel  text NOT NULL DEFAULT '',
  contacted_at    timestamptz,
  interview_at    timestamptz,
  passed_at       timestamptz,
  ready_at        timestamptz,
  planned_start   date,
  start_date      date,
  fee_date        date,
  done_at         timestamptz,
  closed_at       timestamptz,
  left_date       date,
  close_reason    text NOT NULL DEFAULT '',
  employee_code   text NOT NULL DEFAULT '',
  replaces_id     uuid REFERENCES recruit_applications(id) ON DELETE SET NULL,
  note            text NOT NULL DEFAULT '',
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_recruit_apps_candidate ON recruit_applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_recruit_apps_project_stage ON recruit_applications(project_id, stage);
CREATE INDEX IF NOT EXISTS idx_recruit_apps_site_start ON recruit_applications(site_id, start_date);
-- 1 người chỉ có 1 hồ sơ ĐANG MỞ trong 1 dự án (nộp lại sau khi đã đóng thì được).
CREATE UNIQUE INDEX IF NOT EXISTS uq_recruit_apps_open_per_project ON recruit_applications(candidate_id, project_id)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL
    AND stage IN ('new', 'contacted', 'interview', 'passed', 'ready', 'started', 'fee_ok');

CREATE TABLE IF NOT EXISTS recruit_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES recruit_applications(id) ON DELETE CASCADE,
  candidate_id   uuid REFERENCES recruit_candidates(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'stage',
  from_stage     text,
  to_stage       text,
  note           text NOT NULL DEFAULT '',
  by_name        text,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recruit_events_app ON recruit_events(application_id, at);
CREATE INDEX IF NOT EXISTS idx_recruit_events_candidate ON recruit_events(candidate_id, at);

-- ── 2. Khoá bảng: chỉ đi qua recruit_rpc ───────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recruit_projects', 'recruit_sites', 'recruit_positions', 'recruit_targets',
                           'recruit_candidates', 'recruit_applications', 'recruit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ── 3. Quyền module ────────────────────────────────────────────────────────
INSERT INTO role_permissions (role, module, level, updated_at) VALUES
  ('admin', 'Tuyển dụng', 'full', now()),
  ('bdh', 'Tuyển dụng', 'full', now()),
  ('kinhdoanh', 'Tuyển dụng', 'full', now()),
  ('ketoan', 'Tuyển dụng', 'view', now())
ON CONFLICT (role, module) DO NOTHING;

-- ── 4. Hàm nội bộ (không cấp cho anon) ─────────────────────────────────────
-- Phiên + quyền: admin luôn 'full'; vai trò khác theo ma trận phân quyền ('none' = chặn).
CREATE OR REPLACE FUNCTION recruit_session(p_token text)
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
    SELECT rp.level INTO v_level FROM role_permissions rp WHERE rp.role = s.role AND rp.module = 'Tuyển dụng';
    v_level := coalesce(v_level, 'none');
  END IF;
  IF v_level = 'none' THEN
    RAISE EXCEPTION 'Tài khoản chưa được cấp quyền module Tuyển dụng';
  END IF;
  RETURN QUERY SELECT s.user_id, s.full_name, s.role, v_level;
END $$;
REVOKE ALL ON FUNCTION recruit_session(text) FROM PUBLIC, anon, authenticated;

-- Ngày hôm nay theo giờ Việt Nam (DB chạy UTC).
CREATE OR REPLACE FUNCTION recruit__today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $$;

-- SĐT về dạng 0xxxxxxxxx: bỏ ký tự không phải số, +84/84 → 0.
CREATE OR REPLACE FUNCTION recruit__norm_phone(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d ~ '^84\d{9}$' THEN '0' || substr(d, 3)
    WHEN d ~ '^[1-9]\d{8}$' THEN '0' || d
    ELSE d END
  FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x
$$;

-- Bỏ dấu tiếng Việt + chữ thường — tìm "nguyen van a" ra "Nguyễn Văn A".
CREATE OR REPLACE FUNCTION recruit__fold(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(translate(normalize(coalesce(p, ''), NFC),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydaaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'))
$$;

-- Ghi các cột có trong p_args vào 1 dòng (tự lấy danh sách cột của bảng → thêm cột ở migration sau không phải
-- sửa hàm). Không bao giờ ghi id / created_* / updated_at / deleted_at và các cột trong p_deny.
-- "" gửi vào cột được để trống → NULL (ngày, số, tháng…); null gửi vào cột text NOT NULL → "".
CREATE OR REPLACE FUNCTION recruit__patch(p_table regclass, p_id uuid, p_args jsonb, p_deny text[] DEFAULT '{}')
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
      WHEN a.attnotnull AND format_type(a.atttypid, a.atttypmod) = 'text[]' AND jsonb_typeof(p_args->a.attname) = 'null' THEN '[]'::jsonb
      ELSE p_args->a.attname END),
    string_agg(format('%I = (jsonb_populate_record(NULL::%s, $1)).%I', a.attname, p_table, a.attname), ', ')
  INTO v_args, v_set
  FROM pg_attribute a
  WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
    AND p_args ? a.attname
    AND NOT (a.attname = ANY (ARRAY['id', 'created_at', 'created_by', 'updated_at', 'deleted_at'] || p_deny));
  IF v_set IS NULL THEN RETURN; END IF;
  EXECUTE format('UPDATE %s SET %s, updated_at = now() WHERE id = $2', p_table, v_set) USING v_args, p_id;
END $$;
REVOKE ALL ON FUNCTION recruit__patch(regclass, uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- Kiểm tra dữ liệu ứng viên trước khi ghi. Trả câu lỗi tiếng Việt hoặc NULL.
CREATE OR REPLACE FUNCTION recruit__check_candidate(p_args jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_args ? 'full_name' AND btrim(coalesce(p_args->>'full_name', '')) = '' THEN
    RETURN 'Nhập họ tên ứng viên';
  END IF;
  IF p_args ? 'phone' AND coalesce(p_args->>'phone', '') <> '' AND (p_args->>'phone') !~ '^0\d{9}$' THEN
    RETURN 'Số điện thoại phải có 10 số, bắt đầu bằng 0';
  END IF;
  IF p_args ? 'id_number' AND coalesce(p_args->>'id_number', '') <> '' AND (p_args->>'id_number') !~ '^(\d{9}|\d{12})$' THEN
    RETURN 'CCCD phải có 12 số (CMND cũ 9 số)';
  END IF;
  RETURN NULL;
END $$;

-- Ứng tuyển kèm tên + vài thông tin ứng viên (dùng cho danh sách, hôm nay…).
CREATE OR REPLACE FUNCTION recruit__app_json(a recruit_applications, c recruit_candidates) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(a) || jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'birth_year', c.birth_year, 'gender', c.gender,
      'education', c.education, 'province', c.province, 'commune', c.commune, 'blacklisted', c.blacklisted,
      'diploma_pending', c.diploma_pending, 'diploma_due', c.diploma_due,
      'referrer_name', c.referrer_name, 'source_channel', c.source_channel))
$$;

-- ── 5. Chuyển bước ─────────────────────────────────────────────────────────
-- Đi tới bước S thì xoá ngày của các bước SAU S trên đường chính (sửa nhầm "Đã nhận việc" → về "Chờ nhận
-- việc" sẽ không còn tính là 1 lượt tuyển). Mở lại hồ sơ đã đóng thì xoá thông tin đóng.
CREATE OR REPLACE FUNCTION recruit__move(p_ids uuid[], p_stage text, p_args jsonb, p_by text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  chain constant text[] := ARRAY['new', 'contacted', 'interview', 'passed', 'ready', 'started', 'fee_ok', 'done'];
  closed constant text[] := ARRAY['rejected', 'dropped', 'no_show', 'left', 'converted'];
  v_pos int := array_position(chain, p_stage);
  v_today date := recruit__today();
  a recruit_applications;
  n int := 0;
BEGIN
  IF v_pos IS NULL AND NOT (p_stage = ANY (closed)) THEN
    RAISE EXCEPTION 'Bước không hợp lệ: %', p_stage;
  END IF;
  FOR a IN SELECT * FROM recruit_applications WHERE id = ANY (p_ids) AND deleted_at IS NULL FOR UPDATE LOOP
    IF v_pos IS NOT NULL THEN
      UPDATE recruit_applications SET
        stage         = p_stage,
        contacted_at  = CASE WHEN v_pos >= 2 THEN coalesce(contacted_at, now()) ELSE NULL END,
        interview_at  = CASE WHEN v_pos >= 3 THEN coalesce(nullif(p_args->>'interview_at', '')::timestamptz, interview_at) ELSE NULL END,
        passed_at     = CASE WHEN v_pos >= 4 THEN coalesce(passed_at, now()) ELSE NULL END,
        ready_at      = CASE WHEN v_pos >= 5 THEN coalesce(ready_at, now()) ELSE NULL END,
        -- lùi từ "Đã nhận việc" về "Chờ nhận việc": ngày đi làm cũ thành ngày dự kiến
        planned_start = CASE WHEN v_pos >= 5 THEN coalesce(nullif(p_args->>'planned_start', '')::date, planned_start, start_date) ELSE planned_start END,
        start_date    = CASE WHEN v_pos >= 6 THEN coalesce(nullif(p_args->>'start_date', '')::date, start_date, planned_start, v_today) ELSE NULL END,
        fee_date      = CASE WHEN v_pos >= 7 THEN coalesce(nullif(p_args->>'fee_date', '')::date, fee_date, v_today) ELSE NULL END,
        done_at       = CASE WHEN v_pos >= 8 THEN coalesce(done_at, now()) ELSE NULL END,
        employee_code = coalesce(nullif(p_args->>'employee_code', ''), employee_code),
        closed_at     = NULL,
        left_date     = NULL,
        close_reason  = '',
        updated_at    = now()
      WHERE id = a.id;
    ELSE
      UPDATE recruit_applications SET
        stage        = p_stage,
        closed_at    = now(),
        close_reason = coalesce(p_args->>'reason', ''),
        left_date    = CASE WHEN p_stage IN ('left', 'converted') THEN coalesce(nullif(p_args->>'left_date', '')::date, v_today) ELSE NULL END,
        -- không đến nhận việc / không đạt thì chưa từng đi làm → không tính lượt tuyển
        start_date   = CASE WHEN p_stage IN ('no_show', 'rejected', 'dropped') THEN NULL ELSE start_date END,
        fee_date     = CASE WHEN p_stage IN ('no_show', 'rejected', 'dropped') THEN NULL ELSE fee_date END,
        updated_at   = now()
      WHERE id = a.id;
    END IF;
    INSERT INTO recruit_events (application_id, candidate_id, kind, from_stage, to_stage, note, by_name)
    VALUES (a.id, a.candidate_id, 'stage', a.stage, p_stage, coalesce(p_args->>'note', p_args->>'reason', ''), p_by);
    n := n + 1;
  END LOOP;
  RETURN n;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ứng viên đang có 1 hồ sơ khác còn mở trong dự án này — đóng hồ sơ kia trước';
END $$;
REVOKE ALL ON FUNCTION recruit__move(uuid[], text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── 6. Đọc tổng quan ───────────────────────────────────────────────────────
-- Dữ liệu nhỏ, không có thông tin cá nhân: dự án, nhà máy, vị trí, chỉ tiêu + số đã nhận việc theo tháng.
CREATE OR REPLACE FUNCTION recruit__bootstrap() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT jsonb_build_object(
    'projects', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM recruit_projects p WHERE p.deleted_at IS NULL), '[]'::jsonb),
    'sites', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.name) FROM recruit_sites s
                       JOIN recruit_projects p ON p.id = s.project_id AND p.deleted_at IS NULL), '[]'::jsonb),
    'positions', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order, x.created_at) FROM recruit_positions x
                           JOIN recruit_projects p ON p.id = x.project_id AND p.deleted_at IS NULL
                           WHERE x.deleted_at IS NULL), '[]'::jsonb),
    'targets', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM recruit_targets t
                         JOIN recruit_projects p ON p.id = t.project_id AND p.deleted_at IS NULL), '[]'::jsonb),
    -- lượt tuyển = người đã đi làm (có start_date), kể cả đã nghỉ sau đó
    'hires', coalesce((SELECT jsonb_agg(h) FROM (
        SELECT a.project_id, a.site_id, a.position_id, to_char(a.start_date, 'YYYY-MM') AS month,
               count(*) AS started,
               count(*) FILTER (WHERE a.stage IN ('fee_ok', 'done')) AS fee_ok,
               count(*) FILTER (WHERE a.stage = 'left') AS left_count
        FROM recruit_applications a JOIN recruit_candidates c ON c.id = a.candidate_id AND c.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.project_id IS NOT NULL AND a.start_date IS NOT NULL
        GROUP BY 1, 2, 3, 4) h), '[]'::jsonb),
    -- hồ sơ đang xử lý (chưa đi làm) theo dự án × nhà máy × bước
    'pipeline', coalesce((SELECT jsonb_agg(q) FROM (
        SELECT a.project_id, a.site_id, a.stage, count(*) AS n,
               count(*) FILTER (WHERE a.planned_start IS NOT NULL) AS with_date
        FROM recruit_applications a JOIN recruit_candidates c ON c.id = a.candidate_id AND c.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.project_id IS NOT NULL
          AND a.stage IN ('new', 'contacted', 'interview', 'passed', 'ready')
        GROUP BY 1, 2, 3) q), '[]'::jsonb),
    'scheduled', coalesce((SELECT jsonb_agg(q) FROM (
        SELECT a.project_id, a.site_id, a.position_id, to_char(a.planned_start, 'YYYY-MM') AS month, count(*) AS n
        FROM recruit_applications a JOIN recruit_candidates c ON c.id = a.candidate_id AND c.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.project_id IS NOT NULL AND a.stage = 'ready' AND a.planned_start IS NOT NULL
        GROUP BY 1, 2, 3, 4) q), '[]'::jsonb),
    'candidate_count', (SELECT count(*) FROM recruit_candidates WHERE deleted_at IS NULL)
  )
$$;
REVOKE ALL ON FUNCTION recruit__bootstrap() FROM PUBLIC, anon, authenticated;

-- ── 7. Danh sách ứng tuyển (lọc phía server, có phân trang) ──────────────────
CREATE OR REPLACE FUNCTION recruit__app_list(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_project uuid := nullif(p->>'project_id', '')::uuid;
  v_site uuid := nullif(p->>'site_id', '')::uuid;
  v_position uuid := nullif(p->>'position_id', '')::uuid;
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_emp text := nullif(p->>'employment_type', '');
  v_month text := nullif(p->>'month', '');
  v_q text := recruit__fold(btrim(coalesce(p->>'q', '')));
  v_digits text := regexp_replace(coalesce(p->>'q', ''), '\D', '', 'g');
  v_stages text[] := CASE WHEN jsonb_typeof(p->'stages') = 'array'
                          THEN ARRAY(SELECT jsonb_array_elements_text(p->'stages')) END;
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 200), 1), 1000);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_result jsonb;
BEGIN
  WITH f AS (
    SELECT a, c FROM recruit_applications a
    JOIN recruit_candidates c ON c.id = a.candidate_id AND c.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
      AND (v_project IS NULL OR a.project_id = v_project)
      AND (v_site IS NULL OR a.site_id = v_site)
      AND (v_position IS NULL OR a.position_id = v_position)
      AND (v_client IS NULL OR a.client_id = v_client)
      AND (v_emp IS NULL OR a.employment_type = v_emp)
      AND (v_month IS NULL OR to_char(coalesce(a.start_date, a.planned_start), 'YYYY-MM') = v_month)
      AND (v_q = '' OR recruit__fold(c.full_name) LIKE '%' || v_q || '%'
           OR (length(v_digits) >= 3 AND (c.phone LIKE '%' || v_digits || '%' OR c.id_number LIKE '%' || v_digits || '%')))
  )
  SELECT jsonb_build_object(
    'counts', coalesce((SELECT jsonb_object_agg(stage, n) FROM (SELECT (a).stage AS stage, count(*) AS n FROM f GROUP BY 1) s), '{}'::jsonb),
    'total', (SELECT count(*) FROM f WHERE v_stages IS NULL OR (a).stage = ANY (v_stages)),
    'rows', coalesce((SELECT jsonb_agg(recruit__app_json(x.a, x.c) ORDER BY (x.a).updated_at DESC) FROM (
               SELECT a, c FROM f WHERE v_stages IS NULL OR (a).stage = ANY (v_stages)
               ORDER BY (a).updated_at DESC LIMIT v_limit OFFSET v_offset) x), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION recruit__app_list(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 8. Kho ứng viên ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recruit__cand_list(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_q text := recruit__fold(btrim(coalesce(p->>'q', '')));
  v_digits text := regexp_replace(coalesce(p->>'q', ''), '\D', '', 'g');
  v_education text := nullif(p->>'education', '');
  v_province text := nullif(p->>'province', '');
  v_source text := nullif(p->>'source_channel', '');
  v_black boolean := (p->>'blacklisted')::boolean;
  v_free boolean := coalesce((p->>'free_only')::boolean, false);
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 100), 1), 500);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_result jsonb;
BEGIN
  WITH f AS (
    SELECT c.*,
      (SELECT jsonb_build_object('id', a.id, 'stage', a.stage, 'project_id', a.project_id, 'site_id', a.site_id,
                                 'client_id', a.client_id, 'employment_type', a.employment_type, 'updated_at', a.updated_at)
         FROM recruit_applications a WHERE a.candidate_id = c.id AND a.deleted_at IS NULL
         ORDER BY a.updated_at DESC LIMIT 1) AS last_app,
      (SELECT count(*) FROM recruit_applications a WHERE a.candidate_id = c.id AND a.deleted_at IS NULL) AS app_count
    FROM recruit_candidates c
    WHERE c.deleted_at IS NULL
      AND (v_q = '' OR recruit__fold(c.full_name) LIKE '%' || v_q || '%'
           OR (length(v_digits) >= 3 AND (c.phone LIKE '%' || v_digits || '%' OR c.id_number LIKE '%' || v_digits || '%')))
      AND (v_education IS NULL OR c.education = v_education)
      AND (v_province IS NULL OR c.province = v_province)
      AND (v_source IS NULL OR c.source_channel = v_source)
      AND (v_black IS NULL OR c.blacklisted = v_black)
      -- "đang rảnh": không có hồ sơ nào còn mở / đang đi làm
      AND (NOT v_free OR NOT EXISTS (SELECT 1 FROM recruit_applications a WHERE a.candidate_id = c.id AND a.deleted_at IS NULL
                                     AND a.stage IN ('new', 'contacted', 'interview', 'passed', 'ready', 'started', 'fee_ok')))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
               SELECT * FROM f ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) x), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION recruit__cand_list(jsonb) FROM PUBLIC, anon, authenticated;

-- Nhập nhiều ứng viên (Excel): SĐT/CCCD đã có → dùng hồ sơ cũ (không ghi đè); có dự án → tạo ứng tuyển nếu
-- người đó chưa có hồ sơ đang mở trong dự án.
CREATE OR REPLACE FUNCTION recruit__import(p_rows jsonb, p_defaults jsonb, p_by text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  r jsonb;
  v_idx int := 0;
  v_cand uuid;
  v_err text;
  v_phone text;
  v_idn text;
  v_project uuid := nullif(p_defaults->>'project_id', '')::uuid;
  v_client uuid := nullif(p_defaults->>'client_id', '')::uuid;
  v_stage text := coalesce(nullif(p_defaults->>'stage', ''), 'new');
  v_created int := 0;
  v_linked int := 0;
  v_apps int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_app uuid;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'Mỗi lần nhập tối đa 2000 dòng';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    v_phone := recruit__norm_phone(r->>'phone');
    v_idn := regexp_replace(coalesce(r->>'id_number', ''), '\D', '', 'g');
    r := r || jsonb_build_object('phone', v_phone, 'id_number', v_idn);
    v_err := recruit__check_candidate(r || jsonb_build_object('full_name', coalesce(r->>'full_name', '')));
    IF v_err IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('row', v_idx, 'reason', v_err);
      CONTINUE;
    END IF;
    IF v_phone = '' AND v_idn = '' THEN
      v_skipped := v_skipped || jsonb_build_object('row', v_idx, 'reason', 'Thiếu cả SĐT lẫn CCCD');
      CONTINUE;
    END IF;
    SELECT id INTO v_cand FROM recruit_candidates
      WHERE deleted_at IS NULL AND ((v_phone <> '' AND phone = v_phone) OR (v_idn <> '' AND id_number = v_idn))
      LIMIT 1;
    IF v_cand IS NULL THEN
      -- dòng lỗi (vd năm sinh gõ chữ) → bỏ qua dòng đó, không huỷ cả lần nhập
      BEGIN
        INSERT INTO recruit_candidates (full_name, created_by) VALUES (btrim(r->>'full_name'), p_by) RETURNING id INTO v_cand;
        PERFORM recruit__patch('recruit_candidates', v_cand, r - 'full_name' ||
          jsonb_build_object('full_name', btrim(r->>'full_name'),
                             'source_channel', coalesce(nullif(r->>'source_channel', ''), p_defaults->>'source_channel', '')));
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_object('row', v_idx, 'reason', SQLERRM);
        CONTINUE;
      END;
      v_created := v_created + 1;
    ELSE
      v_linked := v_linked + 1;
    END IF;
    IF v_project IS NOT NULL OR v_client IS NOT NULL THEN
      BEGIN
        INSERT INTO recruit_applications (candidate_id, project_id, site_id, position_id, client_id, employment_type,
                                          stage, source_channel, planned_start, start_date, note, created_by)
        VALUES (v_cand, v_project, nullif(p_defaults->>'site_id', '')::uuid, nullif(p_defaults->>'position_id', '')::uuid,
                coalesce(v_client, (SELECT coalesce(s.client_id, pr.client_id) FROM recruit_projects pr
                                    LEFT JOIN recruit_sites s ON s.id = nullif(p_defaults->>'site_id', '')::uuid
                                    WHERE pr.id = v_project)),
                coalesce(nullif(p_defaults->>'employment_type', ''), 'direct'),
                v_stage, coalesce(nullif(r->>'source_channel', ''), p_defaults->>'source_channel', ''),
                nullif(r->>'planned_start', '')::date,
                CASE WHEN v_stage IN ('started', 'fee_ok', 'done') THEN coalesce(nullif(r->>'start_date', '')::date, recruit__today()) END,
                coalesce(r->>'note', ''), p_by)
        RETURNING id INTO v_app;
        INSERT INTO recruit_events (application_id, candidate_id, kind, to_stage, note, by_name)
        VALUES (v_app, v_cand, 'import', v_stage, 'Nhập từ Excel', p_by);
        v_apps := v_apps + 1;
      EXCEPTION WHEN unique_violation THEN
        v_skipped := v_skipped || jsonb_build_object('row', v_idx, 'reason', 'Đã có hồ sơ đang mở trong dự án (giữ nguyên)');
      END;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'linked', v_linked, 'apps', v_apps, 'skipped', v_skipped);
END $$;
REVOKE ALL ON FUNCTION recruit__import(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── 9. Việc hôm nay ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recruit__today_list(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_project uuid := nullif(p->>'project_id', '')::uuid;
  v_today date := coalesce(nullif(p->>'today', '')::date, recruit__today());
  v_result jsonb;
BEGIN
  WITH base AS (
    SELECT a, c FROM recruit_applications a
    JOIN recruit_candidates c ON c.id = a.candidate_id AND c.deleted_at IS NULL
    WHERE a.deleted_at IS NULL AND (v_project IS NULL OR a.project_id = v_project)
  )
  SELECT jsonb_build_object(
    -- hẹn phỏng vấn hôm nay + đã quá hẹn mà chưa cập nhật kết quả
    'interviews', coalesce((SELECT jsonb_agg(recruit__app_json(a, c) ORDER BY (a).interview_at) FROM base
                   WHERE (a).stage = 'interview' AND (a).interview_at IS NOT NULL
                     AND ((a).interview_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= v_today), '[]'::jsonb),
    -- hồ sơ mới quá 2 ngày chưa ai gọi
    'stale_new', coalesce((SELECT jsonb_agg(recruit__app_json(a, c) ORDER BY (a).created_at) FROM (
                   SELECT a, c FROM base WHERE (a).stage = 'new' AND (a).created_at < now() - interval '2 days'
                   ORDER BY (a).created_at LIMIT 50) x), '[]'::jsonb),
    'stale_new_count', (SELECT count(*) FROM base WHERE (a).stage = 'new' AND (a).created_at < now() - interval '2 days'),
    -- chờ nhận việc mà ngày dự kiến đã tới (hôm nay / đã qua)
    'starting', coalesce((SELECT jsonb_agg(recruit__app_json(a, c) ORDER BY (a).planned_start) FROM base
                   WHERE (a).stage = 'ready' AND (a).planned_start IS NOT NULL AND (a).planned_start <= v_today + 1), '[]'::jsonb),
    -- KTV nhận khi đang chờ bằng: tới hạn nộp bằng trong 7 ngày
    'diploma_due', coalesce((SELECT jsonb_agg(recruit__app_json(a, c) ORDER BY (c).diploma_due) FROM base
                   WHERE (c).diploma_pending AND (c).diploma_due IS NOT NULL AND (c).diploma_due <= v_today + 7
                     AND (a).stage IN ('ready', 'started', 'fee_ok')), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION recruit__today_list(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 10. Cổng duy nhất cho app ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recruit_rpc(p_token text, p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  u record;
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_id uuid;
  v_err text;
  v_row jsonb;
  v_cell jsonb;
  v_ids uuid[];
  v_n int;
  v_fn name;
BEGIN
  SELECT * INTO u FROM recruit_session(p_token);
  -- quyền "chỉ xem": chỉ các thao tác đọc (quy ước tên: *.list / *.get / *.find / *.preview / report.*)
  IF u.level <> 'full' AND NOT (p_action IN ('bootstrap', 'today') OR p_action ~ '\.(list|get|find|preview)$' OR p_action LIKE 'report.%') THEN
    RAISE EXCEPTION 'Tài khoản chỉ có quyền xem module Tuyển dụng';
  END IF;

  CASE p_action
  WHEN 'bootstrap' THEN
    RETURN recruit__bootstrap() || jsonb_build_object('me', jsonb_build_object('name', u.full_name, 'role', u.role, 'level', u.level));

  -- ── Dự án ──
  WHEN 'project.save' THEN
    IF btrim(coalesce(a->>'name', 'x')) = '' THEN RAISE EXCEPTION 'Nhập tên dự án'; END IF;
    v_id := nullif(a->>'id', '')::uuid;
    IF v_id IS NULL AND btrim(coalesce(a->>'name', '')) = '' THEN RAISE EXCEPTION 'Nhập tên dự án'; END IF;
    IF v_id IS NULL THEN
      INSERT INTO recruit_projects (name, created_by) VALUES (btrim(a->>'name'), u.full_name) RETURNING id INTO v_id;
    ELSIF NOT EXISTS (SELECT 1 FROM recruit_projects WHERE id = v_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Không tìm thấy dự án';
    END IF;
    PERFORM recruit__patch('recruit_projects', v_id, a);
    RETURN (SELECT to_jsonb(p) FROM recruit_projects p WHERE p.id = v_id);
  WHEN 'project.delete' THEN
    UPDATE recruit_projects SET deleted_at = now(), updated_at = now() WHERE id = (a->>'id')::uuid AND deleted_at IS NULL;
    RETURN jsonb_build_object('ok', true);

  -- ── Nhà máy ──
  WHEN 'site.save' THEN
    IF btrim(coalesce(a->>'name', 'x')) = '' THEN RAISE EXCEPTION 'Nhập tên nhà máy / địa điểm'; END IF;
    v_id := nullif(a->>'id', '')::uuid;
    IF v_id IS NULL AND btrim(coalesce(a->>'name', '')) = '' THEN RAISE EXCEPTION 'Nhập tên nhà máy / địa điểm'; END IF;
    IF v_id IS NULL THEN
      INSERT INTO recruit_sites (project_id, name) VALUES ((a->>'project_id')::uuid, btrim(a->>'name')) RETURNING id INTO v_id;
    END IF;
    PERFORM recruit__patch('recruit_sites', v_id, a, ARRAY['project_id']);
    RETURN (SELECT to_jsonb(s) FROM recruit_sites s WHERE s.id = v_id);
  WHEN 'site.delete' THEN
    v_id := (a->>'id')::uuid;
    IF EXISTS (SELECT 1 FROM recruit_applications WHERE site_id = v_id AND deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM recruit_targets WHERE site_id = v_id AND qty > 0) THEN
      RAISE EXCEPTION 'Nhà máy đã có chỉ tiêu hoặc ứng tuyển — không xoá được (đổi tên nếu nhập nhầm)';
    END IF;
    DELETE FROM recruit_targets WHERE site_id = v_id;
    DELETE FROM recruit_sites WHERE id = v_id;
    RETURN jsonb_build_object('ok', true);

  -- ── Vị trí (JD) ──
  WHEN 'position.save' THEN
    IF btrim(coalesce(a->>'title', 'x')) = '' THEN RAISE EXCEPTION 'Nhập tên vị trí'; END IF;
    v_id := nullif(a->>'id', '')::uuid;
    IF v_id IS NULL AND btrim(coalesce(a->>'title', '')) = '' THEN RAISE EXCEPTION 'Nhập tên vị trí'; END IF;
    IF v_id IS NULL THEN
      INSERT INTO recruit_positions (project_id, title) VALUES ((a->>'project_id')::uuid, btrim(a->>'title')) RETURNING id INTO v_id;
    END IF;
    PERFORM recruit__patch('recruit_positions', v_id, a, ARRAY['project_id']);
    RETURN (SELECT to_jsonb(x) FROM recruit_positions x WHERE x.id = v_id);
  WHEN 'position.delete' THEN
    UPDATE recruit_positions SET deleted_at = now(), is_open = false, updated_at = now() WHERE id = (a->>'id')::uuid;
    RETURN jsonb_build_object('ok', true);

  -- ── Chỉ tiêu: ghi nhiều ô 1 lần (qty 0 = bỏ ô) ──
  WHEN 'targets.save' THEN
    FOR v_cell IN SELECT * FROM jsonb_array_elements(coalesce(a->'cells', '[]'::jsonb)) LOOP
      SELECT id INTO v_id FROM recruit_targets
        WHERE site_id = (v_cell->>'site_id')::uuid
          AND position_id IS NOT DISTINCT FROM nullif(v_cell->>'position_id', '')::uuid
          AND month = v_cell->>'month';
      IF coalesce((v_cell->>'qty')::int, 0) <= 0 AND coalesce(v_cell->>'note', '') = '' THEN
        IF v_id IS NOT NULL THEN DELETE FROM recruit_targets WHERE id = v_id; END IF;
      ELSIF v_id IS NULL THEN
        INSERT INTO recruit_targets (project_id, site_id, position_id, month, qty, status, note)
        VALUES ((a->>'project_id')::uuid, (v_cell->>'site_id')::uuid, nullif(v_cell->>'position_id', '')::uuid,
                v_cell->>'month', greatest(coalesce((v_cell->>'qty')::int, 0), 0),
                coalesce(nullif(v_cell->>'status', ''), 'planned'), coalesce(v_cell->>'note', ''));
      ELSE
        UPDATE recruit_targets SET qty = greatest(coalesce((v_cell->>'qty')::int, 0), 0),
          status = coalesce(nullif(v_cell->>'status', ''), status), note = coalesce(v_cell->>'note', note), updated_at = now()
        WHERE id = v_id;
      END IF;
    END LOOP;
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM recruit_targets t WHERE t.project_id = (a->>'project_id')::uuid), '[]'::jsonb);

  -- ── Ứng viên ──
  WHEN 'cand.find' THEN
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone,
                                                          'id_number', c.id_number, 'birth_year', c.birth_year,
                                                          'blacklisted', c.blacklisted, 'blacklist_reason', c.blacklist_reason))
      FROM recruit_candidates c
      WHERE c.deleted_at IS NULL AND c.id IS DISTINCT FROM nullif(a->>'exclude_id', '')::uuid
        AND ((coalesce(a->>'phone', '') <> '' AND c.phone = recruit__norm_phone(a->>'phone'))
          OR (coalesce(a->>'id_number', '') <> '' AND c.id_number = a->>'id_number'))), '[]'::jsonb);
  WHEN 'cand.list' THEN
    RETURN recruit__cand_list(a);
  WHEN 'cand.get' THEN
    v_id := (a->>'id')::uuid;
    RETURN jsonb_build_object(
      'candidate', (SELECT to_jsonb(c) FROM recruit_candidates c WHERE c.id = v_id AND c.deleted_at IS NULL),
      'applications', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM recruit_applications x
                                WHERE x.candidate_id = v_id AND x.deleted_at IS NULL), '[]'::jsonb),
      'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.at DESC) FROM (
                            SELECT * FROM recruit_events WHERE candidate_id = v_id ORDER BY at DESC LIMIT 100) e), '[]'::jsonb));
  WHEN 'cand.save' THEN
    v_id := nullif(a->>'id', '')::uuid;
    IF a ? 'phone' THEN a := a || jsonb_build_object('phone', recruit__norm_phone(a->>'phone')); END IF;
    IF a ? 'id_number' THEN a := a || jsonb_build_object('id_number', regexp_replace(coalesce(a->>'id_number', ''), '\D', '', 'g')); END IF;
    v_err := recruit__check_candidate(CASE WHEN v_id IS NULL THEN a || jsonb_build_object('full_name', coalesce(a->>'full_name', '')) ELSE a END);
    IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
    IF v_id IS NULL AND coalesce(a->>'phone', '') = '' AND coalesce(a->>'id_number', '') = '' THEN
      RAISE EXCEPTION 'Nhập số điện thoại (hoặc CCCD) để chống trùng hồ sơ';
    END IF;
    -- trùng SĐT / CCCD với hồ sơ khác → trả về hồ sơ đó, KHÔNG ghi
    SELECT jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'id_number', c.id_number,
                              'birth_year', c.birth_year, 'blacklisted', c.blacklisted)
      INTO v_row FROM recruit_candidates c
      WHERE c.deleted_at IS NULL AND c.id IS DISTINCT FROM v_id
        AND ((coalesce(a->>'phone', '') <> '' AND c.phone = a->>'phone')
          OR (coalesce(a->>'id_number', '') <> '' AND c.id_number = a->>'id_number'))
      LIMIT 1;
    IF v_row IS NOT NULL THEN RETURN jsonb_build_object('duplicate', v_row); END IF;
    IF v_id IS NULL THEN
      INSERT INTO recruit_candidates (full_name, created_by) VALUES (btrim(a->>'full_name'), u.full_name) RETURNING id INTO v_id;
    ELSIF NOT EXISTS (SELECT 1 FROM recruit_candidates WHERE id = v_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Không tìm thấy ứng viên';
    END IF;
    PERFORM recruit__patch('recruit_candidates', v_id, a);
    RETURN jsonb_build_object('candidate', (SELECT to_jsonb(c) FROM recruit_candidates c WHERE c.id = v_id));
  WHEN 'cand.delete' THEN
    v_id := (a->>'id')::uuid;
    UPDATE recruit_candidates SET deleted_at = now(), updated_at = now() WHERE id = v_id AND deleted_at IS NULL;
    UPDATE recruit_applications SET deleted_at = now(), updated_at = now() WHERE candidate_id = v_id AND deleted_at IS NULL;
    RETURN jsonb_build_object('ok', true);

  -- ── Ứng tuyển ──
  WHEN 'app.list' THEN
    RETURN recruit__app_list(a);
  WHEN 'app.create' THEN
    IF NOT EXISTS (SELECT 1 FROM recruit_candidates WHERE id = (a->>'candidate_id')::uuid AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Không tìm thấy ứng viên';
    END IF;
    IF nullif(a->>'project_id', '') IS NULL AND nullif(a->>'client_id', '') IS NULL THEN
      RAISE EXCEPTION 'Chọn dự án tuyển dụng (hoặc khách hàng)';
    END IF;
    BEGIN
      INSERT INTO recruit_applications (candidate_id, project_id, client_id, stage, created_by)
      VALUES ((a->>'candidate_id')::uuid, nullif(a->>'project_id', '')::uuid,
              coalesce(nullif(a->>'client_id', '')::uuid,
                       (SELECT coalesce(s.client_id, p.client_id) FROM recruit_projects p
                        LEFT JOIN recruit_sites s ON s.id = nullif(a->>'site_id', '')::uuid
                        WHERE p.id = nullif(a->>'project_id', '')::uuid)),
              'new', u.full_name)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Ứng viên đã có hồ sơ đang mở trong dự án này';
    END;
    PERFORM recruit__patch('recruit_applications', v_id, a - 'stage',
      ARRAY['candidate_id', 'project_id', 'client_id', 'contacted_at', 'passed_at', 'ready_at', 'done_at', 'closed_at']);
    -- không ghi nguồn / loại HĐ → lấy theo hồ sơ ứng viên / vị trí
    UPDATE recruit_applications x SET
      source_channel = CASE WHEN x.source_channel = ''
        THEN (SELECT c.source_channel FROM recruit_candidates c WHERE c.id = x.candidate_id) ELSE x.source_channel END,
      employment_type = CASE WHEN a ? 'employment_type' THEN x.employment_type
        ELSE coalesce((SELECT p.employment_type FROM recruit_positions p WHERE p.id = x.position_id), x.employment_type) END
    WHERE x.id = v_id;
    INSERT INTO recruit_events (application_id, candidate_id, kind, to_stage, note, by_name)
    VALUES (v_id, (a->>'candidate_id')::uuid, 'create', 'new', coalesce(a->>'note', ''), u.full_name);
    IF coalesce(a->>'stage', 'new') <> 'new' THEN
      PERFORM recruit__move(ARRAY[v_id], a->>'stage', a, u.full_name);
    END IF;
    RETURN (SELECT recruit__app_json(x, c) FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id WHERE x.id = v_id);
  WHEN 'app.update' THEN
    v_id := (a->>'id')::uuid;
    PERFORM recruit__patch('recruit_applications', v_id, a,
      ARRAY['candidate_id', 'project_id', 'stage', 'contacted_at', 'passed_at', 'ready_at', 'done_at', 'closed_at']);
    IF coalesce(a->>'note_event', '') <> '' THEN
      INSERT INTO recruit_events (application_id, candidate_id, kind, note, by_name)
      SELECT x.id, x.candidate_id, 'note', a->>'note_event', u.full_name FROM recruit_applications x WHERE x.id = v_id;
    END IF;
    RETURN (SELECT recruit__app_json(x, c) FROM recruit_applications x JOIN recruit_candidates c ON c.id = x.candidate_id WHERE x.id = v_id);
  WHEN 'app.move' THEN
    v_ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(a->'ids', '[]'::jsonb))::uuid);
    v_n := recruit__move(v_ids, a->>'stage', a, u.full_name);
    RETURN jsonb_build_object('moved', v_n);
  WHEN 'app.delete' THEN
    UPDATE recruit_applications SET deleted_at = now(), updated_at = now() WHERE id = (a->>'id')::uuid AND deleted_at IS NULL;
    RETURN jsonb_build_object('ok', true);

  WHEN 'import' THEN
    RETURN recruit__import(coalesce(a->'rows', '[]'::jsonb), coalesce(a->'defaults', '{}'::jsonb), u.full_name);
  WHEN 'today' THEN
    RETURN recruit__today_list(a);
  ELSE
    -- Thao tác của các giai đoạn sau (migration 181+): mỗi giai đoạn có 1 hàm recruit__rpc_pN(action, args, user)
    -- trả NULL nếu không phải việc của nó. Thêm giai đoạn mới không phải sửa hàm này.
    FOR v_fn IN SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname ~ '^recruit__rpc_p[0-9]+$' ORDER BY p.proname LOOP
      EXECUTE format('SELECT %I($1, $2, $3)', v_fn) INTO v_row
        USING p_action, a, jsonb_build_object('user_id', u.user_id, 'name', u.full_name, 'role', u.role, 'level', u.level);
      IF v_row IS NOT NULL THEN RETURN v_row; END IF;
    END LOOP;
    RAISE EXCEPTION 'Thao tác không hỗ trợ: %', p_action;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION recruit_rpc(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recruit_rpc(text, text, jsonb) TO anon, authenticated;
