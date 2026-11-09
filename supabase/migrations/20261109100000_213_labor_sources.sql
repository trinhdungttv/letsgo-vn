-- ============================================================================
-- 213 — NGUỒN LAO ĐỘNG (Thị trường → tab "Nguồn LĐ", thay tab Báo giá cũ)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   labor_sources           HỒ SƠ ĐƠN VỊ NGUỒN: trường Đại học / Cao đẳng / Trung cấp nghề, Trung tâm GDNN /
--                           Dịch vụ việc làm, Xã-phường / đoàn thể địa phương. Vị trí (lat/lng) dùng cho Bản đồ,
--                           tính đường xe tới KCN / công ty, Khảo sát KCN.
--   labor_source_programs   NGÀNH ĐÀO TẠO của từng đơn vị — industry_ids = ngành công ty phù hợp
--                           (industries.id, chọn từ Thị trường → Ngành Nghề) → gợi ý ghép trường ↔ công ty.
--   labor_source_windows    LỊCH THỰC TẬP: khoá / ngành nào đi thực tập từ ngày nào, bao nhiêu SV dự kiến,
--                           lặp lại hằng năm; trước mùa N ngày app tự tạo việc "Liên hệ trường" trong Workspace
--                           (reminder_task_id / reminder_for chống tạo trùng).
--   labor_source_batches    ĐỢT GỬI SINH VIÊN — CHỈ SỐ LƯỢNG (không lưu thông tin cá nhân SV):
--                           gửi đi bao nhiêu (sent_count), đạt bao nhiêu (passed_count), vào công ty nào
--                           (client_id = Khách hàng | lead_id = Công ty/Dự án | company_name tự gõ), KCN nào.
--   labor_source_routes     BỘ NHỚ ĐƯỜNG XE (xe khách 16–45 chỗ) từ đơn vị nguồn → KCN / công ty / chi nhánh:
--                           km + phút. Tính 1 lần rồi dùng chung mọi máy; toạ độ 2 đầu đổi thì app tự tính lại.
--   contacts.labor_source_id  người liên hệ (tệp Sale / CTV trong CSKH — Ban giám hiệu, phòng QHDN, GV…)
--                           là đại diện của đơn vị nguồn nào.
--
-- Chưa chạy migration này: tab Nguồn LĐ báo "cần chạy migration 213" và không lưu được gì. Trang khác không ảnh hưởng.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 5 bảng mới + THÊM 1 cột rỗng vào contacts.
-- Không sửa / xoá dòng nào của bảng cũ. Xoá trong app = xoá MỀM (deleted_at), khôi phục được.
-- Không có khoá ngoại (bài học PGRST201 — thêm FK thứ 2 giữa 2 bảng đã embed làm trống trang).
-- Lịch sử dữ liệu: gắn dh_track RIÊNG 4 bảng nghiệp vụ (KHÔNG gọi dh_attach_triggers()); bảng đường xe là
-- bộ nhớ tạm tính lại được nên không ghi lịch sử.
-- ============================================================================

-- ── 1. Đơn vị nguồn ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL DEFAULT 'cao_dang',     -- dai_hoc | cao_dang | trung_cap | trung_tam | dia_phuong | khac
  name              text NOT NULL,
  short_name        text NOT NULL DEFAULT '',             -- tên viết tắt (VD: CĐ Công nghệ cao Đồng Nai → HVCT)
  ownership         text NOT NULL DEFAULT '',             -- cong_lap | tu_thuc | '' (chưa rõ)
  status            text NOT NULL DEFAULT 'new',          -- new (chưa tiếp cận) | contacting | partner | paused
  priority          smallint,                             -- 1–3 sao ưu tiên, NULL = chưa xếp
  province          text NOT NULL DEFAULT '',
  address           text NOT NULL DEFAULT '',
  map_link          text NOT NULL DEFAULT '',
  lat               double precision,
  lng               double precision,
  website           text NOT NULL DEFAULT '',
  fanpage           text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  email             text NOT NULL DEFAULT '',
  logo_url          text,
  student_total     integer,                              -- quy mô người học toàn trường
  intern_per_year   integer,                              -- SV đi thực tập / năm (ước tính)
  has_dorm          boolean,                              -- trường có ký túc xá
  requirements      text[] NOT NULL DEFAULT '{}',         -- điều kiện trường yêu cầu DN: cho_o | xe_dua_don | suat_an | phu_cap | bao_hiem | xac_nhan_tt | huong_dan
  requirements_note text NOT NULL DEFAULT '',
  mou_signed_at     date,                                 -- ngày ký thoả thuận hợp tác (MOU)
  mou_expires_at    date,
  mou_note          text NOT NULL DEFAULT '',
  branch_id         uuid,                                 -- chi nhánh phụ trách (branches.id, không FK)
  owner_id          uuid,                                 -- người phụ trách (app_users.id, không FK)
  tags              text[] NOT NULL DEFAULT '{}',
  notes             text NOT NULL DEFAULT '',
  created_by        text NOT NULL DEFAULT '',
  updated_by        text NOT NULL DEFAULT '',
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS labor_sources_alive_idx ON labor_sources (name) WHERE deleted_at IS NULL;

-- ── 2. Ngành đào tạo ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_source_programs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          uuid NOT NULL,                       -- labor_sources.id
  name               text NOT NULL,                       -- VD: Điện tử công nghiệp, Cơ điện tử
  level              text NOT NULL DEFAULT '',            -- dai_hoc | cao_dang | trung_cap | so_cap | '' (chưa rõ)
  industry_ids       uuid[] NOT NULL DEFAULT '{}',        -- ngành công ty phù hợp (industries.id)
  students_per_year  integer,                             -- SV / khoá (ước tính)
  note               text NOT NULL DEFAULT '',
  sort_order         integer NOT NULL DEFAULT 0,
  created_by         text NOT NULL DEFAULT '',
  updated_by         text NOT NULL DEFAULT '',
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS labor_source_programs_source_idx ON labor_source_programs (source_id) WHERE deleted_at IS NULL;

-- ── 3. Lịch thực tập ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_source_windows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         uuid NOT NULL,
  program_ids       uuid[] NOT NULL DEFAULT '{}',         -- ngành áp dụng; rỗng = cả trường
  cohort            text NOT NULL DEFAULT '',             -- khoá, VD "K47" / "Khoá 2023–2026"
  start_date        date NOT NULL,
  end_date          date,
  expected_count    integer,                              -- SV dự kiến đi thực tập
  repeat_yearly     boolean NOT NULL DEFAULT true,        -- năm nào cũng vào mùa này
  remind_days       integer NOT NULL DEFAULT 30,          -- nhắc trước bao nhiêu ngày (0 = không nhắc)
  reminder_task_id  uuid,                                 -- việc Workspace đã tạo cho lần gần nhất
  reminder_for      date,                                 -- ngày bắt đầu của lần đã nhắc (lặp hằng năm → mỗi năm 1 việc)
  note              text NOT NULL DEFAULT '',
  created_by        text NOT NULL DEFAULT '',
  updated_by        text NOT NULL DEFAULT '',
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labor_source_windows_dates_chk CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT labor_source_windows_remind_chk CHECK (remind_days BETWEEN 0 AND 365)
);
CREATE INDEX IF NOT EXISTS labor_source_windows_source_idx ON labor_source_windows (source_id) WHERE deleted_at IS NULL;

-- ── 4. Đợt gửi sinh viên (chỉ số lượng) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_source_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL,
  window_id     uuid,                                     -- thuộc mùa thực tập nào (tuỳ chọn)
  program_ids   uuid[] NOT NULL DEFAULT '{}',
  client_id     uuid,                                     -- công ty nhận: Khách hàng (clients.id)
  lead_id       uuid,                                     -- hoặc Công ty/Dự án (market_leads.id)
  company_name  text NOT NULL DEFAULT '',                 -- tên hiển thị (công ty chưa có trong hệ thống thì gõ tay)
  zone_id       uuid,                                     -- KCN (market_zones.id)
  start_date    date,
  end_date      date,
  sent_count    integer NOT NULL DEFAULT 0,               -- gửi đi
  passed_count  integer NOT NULL DEFAULT 0,               -- đạt (được nhận)
  status        text NOT NULL DEFAULT 'done',             -- planned | ongoing | done | cancelled
  note          text NOT NULL DEFAULT '',
  created_by    text NOT NULL DEFAULT '',
  updated_by    text NOT NULL DEFAULT '',
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labor_source_batches_counts_chk CHECK (sent_count >= 0 AND passed_count >= 0)
);
CREATE INDEX IF NOT EXISTS labor_source_batches_source_idx ON labor_source_batches (source_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS labor_source_batches_client_idx ON labor_source_batches (client_id) WHERE deleted_at IS NULL;

-- ── 5. Bộ nhớ đường xe (tính lại được — không ghi lịch sử) ─────────────────
CREATE TABLE IF NOT EXISTS labor_source_routes (
  source_id     uuid NOT NULL,
  target_type   text NOT NULL,                            -- zone | client | lead | branch
  target_id     uuid NOT NULL,
  from_lat      double precision NOT NULL,                -- toạ độ lúc tính (đổi toạ độ → app tính lại)
  from_lng      double precision NOT NULL,
  to_lat        double precision NOT NULL,
  to_lng        double precision NOT NULL,
  distance_km   numeric(8,2),                             -- NULL = không tìm được đường
  duration_min  numeric(8,1),
  engine        text NOT NULL DEFAULT 'valhalla-bus',     -- valhalla-bus (tuyến xe buýt) | osrm-car (ô tô × hệ số xe khách)
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, target_type, target_id)
);

-- ── 6. Người liên hệ thuộc đơn vị nguồn ─────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS labor_source_id uuid;
CREATE INDEX IF NOT EXISTS contacts_labor_source_idx ON contacts (labor_source_id) WHERE labor_source_id IS NOT NULL;

-- ── 7. updated_at tự cập nhật ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION labor_sources_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['labor_sources', 'labor_source_programs', 'labor_source_windows', 'labor_source_batches'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION labor_sources_touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ── 8. Quyền bảng: giống các bảng khác của app (app chạy anon) ─────────────
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['labor_sources', 'labor_source_programs', 'labor_source_windows', 'labor_source_batches', 'labor_source_routes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_all_' || r) THEN
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t || '_all_' || r, t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 9. Lịch sử dữ liệu (cỗ máy thời gian) — gắn riêng từng bảng ────────────
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    FOREACH t IN ARRAY ARRAY['labor_sources', 'labor_source_programs', 'labor_source_windows', 'labor_source_batches'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS dh_track ON %I', t);
      EXECUTE format('CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dh_log_change()', t);
    END LOOP;
  END IF;
END $$;

COMMENT ON TABLE labor_sources IS 'Nguồn lao động — hồ sơ trường ĐH/CĐ/Trung cấp, trung tâm, địa phương. Xoá mềm bằng deleted_at.';
COMMENT ON TABLE labor_source_programs IS 'Nguồn lao động — ngành đào tạo; industry_ids = ngành công ty phù hợp (industries.id).';
COMMENT ON TABLE labor_source_windows IS 'Nguồn lao động — lịch thực tập (lặp hằng năm), nhắc việc Workspace trước mùa.';
COMMENT ON TABLE labor_source_batches IS 'Nguồn lao động — đợt gửi SV: chỉ số lượng gửi đi / đạt, công ty nhận, KCN.';
COMMENT ON TABLE labor_source_routes IS 'Nguồn lao động — bộ nhớ đường xe khách tới KCN / công ty / chi nhánh (tính lại được).';
COMMENT ON COLUMN contacts.labor_source_id IS 'Người liên hệ (tệp Sale/CTV) là đại diện của đơn vị nguồn nào (labor_sources.id, không FK).';

-- PostgREST nạp lại danh sách bảng ngay (khỏi đợi)
NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 5 bảng + 1 cột) ───────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'labor\_source%' ORDER BY 1;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'labor_source_id';

-- ── Rollback (chạy tay nếu cần bỏ — MẤT toàn bộ dữ liệu Nguồn LĐ đã nhập) ──
-- DROP TABLE IF EXISTS labor_source_routes, labor_source_batches, labor_source_windows, labor_source_programs, labor_sources;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS labor_source_id;
-- DROP FUNCTION IF EXISTS labor_sources_touch_updated_at();
