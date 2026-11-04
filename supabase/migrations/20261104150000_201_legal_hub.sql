-- ============================================================================
-- 201 — PHÁP LÝ (Workspace → nút "Pháp lý", trang #/legal)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   legal_entities     hồ sơ từng PHÁP NHÂN của công ty (tên, MST, vốn, người đại diện, thành viên góp vốn,
--                      ngành nghề, tài khoản ngân hàng, giấy phép con…). info = jsonb các danh sách.
--   legal_milestones   DÒNG THỜI GIAN của từng pháp nhân: thành lập, đăng ký thay đổi lần thứ N, giấy phép…
--                      changes = [{ aspect, from, to }] — nội dung thay đổi (trước → sau).
--   legal_topics       THƯ VIỆN NGÀNH: Topic lớn (parent_id NULL) → chủ đề con (parent_id = Topic).
--   legal_docs         MỌI tài liệu của module — 1 bảng duy nhất, gắn vào pháp nhân (entity_id),
--                      vào mốc thời gian (milestone_id) hoặc vào chủ đề thư viện (topic_id):
--                        kind = drive (link Google Drive: PDF, Word, Excel, PowerPoint, thư mục)
--                             | link (trang web / video) | mindmap (sơ đồ tư duy — cùng JSON với Ghi chú nhanh)
--                             | lesson (bài học trực quan: khối màu, các bước, bảng so sánh…) | cards (thẻ ghi nhớ)
--                      content = nội dung tự soạn (sơ đồ / bài học / thẻ), meta = số hiệu, cơ quan ban hành, hiệu lực…
--
-- Chưa chạy migration này: trang Pháp lý báo "cần chạy migration 201" và KHÔNG lưu được gì. Các trang khác không ảnh hưởng.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 4 bảng mới + thêm 4 dòng quyền module 'Pháp lý'
-- (ON CONFLICT DO NOTHING — quyền đã chỉnh tay thì giữ nguyên). Không sửa bảng cũ.
-- Xoá trong app = xoá MỀM (deleted_at) → khôi phục được ở "Thùng rác" của trang Pháp lý.
-- Không có khoá ngoại (bài học PGRST201; xoá pháp nhân không kéo theo mất mốc / tài liệu).
-- Lịch sử dữ liệu: gắn dh_track RIÊNG 4 bảng này (KHÔNG gọi dh_attach_triggers()).
-- ============================================================================

-- ── 1. Pháp nhân ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,                       -- tên đầy đủ trên Giấy chứng nhận ĐKDN
  short_name       text NOT NULL DEFAULT '',
  english_name     text NOT NULL DEFAULT '',
  tax_code         text NOT NULL DEFAULT '',            -- mã số doanh nghiệp / MST
  business_type    text NOT NULL DEFAULT '',            -- TNHH 1TV, TNHH 2TV, Cổ phần, Chi nhánh…
  founded_date     date,                                -- ngày cấp lần đầu
  registry_office  text NOT NULL DEFAULT '',            -- nơi cấp (Phòng ĐKKD – Sở KH&ĐT…)
  address          text NOT NULL DEFAULT '',
  phone            text NOT NULL DEFAULT '',
  email            text NOT NULL DEFAULT '',
  website          text NOT NULL DEFAULT '',
  charter_capital  numeric,                             -- vốn điều lệ (đồng)
  legal_rep        text NOT NULL DEFAULT '',            -- người đại diện theo pháp luật
  legal_rep_title  text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'active',      -- active | paused | dissolved
  color            text NOT NULL DEFAULT '#0071E3',     -- màu nhận diện trong app
  logo_url         text,
  drive_url        text NOT NULL DEFAULT '',            -- thư mục Google Drive của pháp nhân
  quote_entity_id  uuid,                                -- pháp nhân gửi báo giá tương ứng (quote_entities.id, không FK)
  info             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { owners:[], industries:[], banks:[], licenses:[] }
  note             text NOT NULL DEFAULT '',
  sort_order       integer NOT NULL DEFAULT 0,
  created_by       text NOT NULL DEFAULT '',
  updated_by       text NOT NULL DEFAULT '',
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Dòng thời gian ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,                           -- legal_entities.id (không FK)
  event_date   date NOT NULL,
  kind         text NOT NULL DEFAULT 'thay_doi',        -- thanh_lap | thay_doi | giay_phep | thue | lao_dong | con_dau | thanh_tra | khac
  change_no    integer,                                 -- "đăng ký thay đổi lần thứ N"
  title        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'done',            -- done | doing | planned
  changes      jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{ id, aspect, from, to }]
  created_by   text NOT NULL DEFAULT '',
  updated_by   text NOT NULL DEFAULT '',
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_milestones_entity_idx ON legal_milestones (entity_id, event_date) WHERE deleted_at IS NULL;

-- ── 3. Thư viện ngành: Topic → chủ đề con ──────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_topics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    uuid,                                    -- NULL = Topic lớn
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  color        text NOT NULL DEFAULT '#0071E3',
  icon         text NOT NULL DEFAULT 'book',
  sort_order   integer NOT NULL DEFAULT 0,
  created_by   text NOT NULL DEFAULT '',
  updated_by   text NOT NULL DEFAULT '',
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Tài liệu (dùng chung cho pháp nhân, mốc thời gian, thư viện) ────────
CREATE TABLE IF NOT EXISTS legal_docs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL DEFAULT 'drive',          -- drive | link | mindmap | lesson | cards
  title         text NOT NULL DEFAULT '',
  entity_id     uuid,                                   -- legal_entities.id (không FK)
  milestone_id  uuid,                                   -- legal_milestones.id (không FK)
  topic_id      uuid,                                   -- legal_topics.id (không FK)
  category      text NOT NULL DEFAULT '',               -- nhóm hồ sơ của pháp nhân: dkkd | dieu_le | giay_phep | thue | lao_dong | hop_dong | khac
  url           text NOT NULL DEFAULT '',
  file_type     text NOT NULL DEFAULT '',               -- pdf | doc | sheet | slide | folder | image | video | web
  content       jsonb,                                  -- sơ đồ / bài học / thẻ ghi nhớ
  summary       text NOT NULL DEFAULT '',               -- tóm tắt + ghi chú khi đọc
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { number, issuer, issued, effective, status, tags[] }
  color         text NOT NULL DEFAULT '',
  pinned        boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_by    text NOT NULL DEFAULT '',
  updated_by    text NOT NULL DEFAULT '',
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_docs_entity_idx ON legal_docs (entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS legal_docs_topic_idx ON legal_docs (topic_id) WHERE deleted_at IS NULL;

-- updated_at tự cập nhật
CREATE OR REPLACE FUNCTION legal_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legal_entities', 'legal_milestones', 'legal_topics', 'legal_docs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION legal_touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ── 5. Quyền bảng: giống các bảng khác của app (app chạy anon) ─────────────
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legal_entities', 'legal_milestones', 'legal_topics', 'legal_docs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_all_' || r) THEN
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t || '_all_' || r, t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 6. Quyền module 'Pháp lý' (Admin → Ma trận phân quyền chỉnh lại được) ──
INSERT INTO role_permissions (role, module, level, updated_at) VALUES
  ('admin', 'Pháp lý', 'full', now()),
  ('bdh', 'Pháp lý', 'full', now()),
  ('ketoan', 'Pháp lý', 'view', now()),
  ('kinhdoanh', 'Pháp lý', 'view', now())
ON CONFLICT (role, module) DO NOTHING;

-- ── 7. Lịch sử dữ liệu (cỗ máy thời gian) — gắn riêng từng bảng ────────────
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    FOREACH t IN ARRAY ARRAY['legal_entities', 'legal_milestones', 'legal_topics', 'legal_docs'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS dh_track ON %I', t);
      EXECUTE format('CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dh_log_change()', t);
    END LOOP;
  END IF;
END $$;

COMMENT ON TABLE legal_entities IS 'Pháp lý — hồ sơ pháp nhân của công ty. info = { owners, industries, banks, licenses }. Xoá mềm bằng deleted_at.';
COMMENT ON TABLE legal_milestones IS 'Pháp lý — dòng thời gian từng pháp nhân (thành lập, thay đổi ĐKKD lần N, giấy phép…).';
COMMENT ON TABLE legal_topics IS 'Pháp lý — Thư viện ngành: Topic lớn (parent_id NULL) và chủ đề con.';
COMMENT ON TABLE legal_docs IS 'Pháp lý — mọi tài liệu (link Drive, web, sơ đồ tư duy, bài học, thẻ ghi nhớ), gắn pháp nhân / mốc / chủ đề.';

-- PostgREST nạp lại danh sách bảng ngay (khỏi đợi)
NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 4 bảng + 4 dòng quyền) ────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'legal\_%';
-- SELECT role, level FROM role_permissions WHERE module = 'Pháp lý';

-- ── Rollback (chạy tay nếu cần bỏ — MẤT toàn bộ dữ liệu Pháp lý đã nhập) ──
-- DROP TABLE IF EXISTS legal_docs, legal_topics, legal_milestones, legal_entities;
-- DROP FUNCTION IF EXISTS legal_touch_updated_at();
-- DELETE FROM role_permissions WHERE module = 'Pháp lý';
