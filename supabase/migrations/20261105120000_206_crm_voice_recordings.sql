-- ============================================================================
-- 206 — GHI ÂM trong CRM (3 chỗ) + "Khách chưa nghe máy" của CSKH
--
--   crm_voice_recordings   mỗi bản ghi âm 1 dòng. subject_type cho biết ghi ở đâu:
--                            'branch_visit'  Nhật ký ghé thăm chi nhánh   (subject_id = branches.id)
--                            'contact_call'  Gọi chăm sóc 1 người liên hệ (subject_id = contacts.id)
--                            'company_note'  Ghi chú công ty khách hàng   (subject_id = clients.id / id thẻ Pipeline)
--                          related_date = ngày của lần ghé / lần gọi (để hiện cạnh dòng nhật ký cùng ngày).
--                          File âm thanh nằm ở bucket 'crm-voice'. Chưa có chép lời tự động (Gemini đang tắt) —
--                          cột transcript để dành.
--   cskh_missed_calls      "Khách chưa nghe máy": mỗi lần bấm = 1 dòng (contact_id, missed_on). Hàng đợi "Hôm nay cần
--                          liên hệ" đẩy người đó xuống cuối trong NGÀY ĐÓ, sang ngày sau tự xếp lại bình thường.
--                          Không tính là 1 lần liên hệ (không vào nhật ký, không đổi điểm quan hệ).
--
-- Bucket 'crm-voice' CÔNG KHAI (giống 'kcn-survey'): ai có đường link đầy đủ (có mã ngẫu nhiên dài) mới nghe được;
-- chỉ cho XEM + TẢI LÊN, không cho sửa / xoá file bằng anon key. Xoá bản ghi trong app = xoá MỀM (deleted_at),
-- file vẫn còn trong Storage.
--
-- Chưa chạy: 3 nút ghi âm báo "cần chạy migration 206", nút "Khách chưa nghe máy" không lưu được; mọi thứ khác bình thường.
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 2 bảng + 1 bucket mới. Không FK (bài học PGRST201).
-- Lịch sử dữ liệu: gắn dh_track riêng 2 bảng (KHÔNG gọi dh_attach_triggers()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_voice_recordings (
  id            uuid PRIMARY KEY,                          -- do app sinh → bấm "Thử lại" không tạo trùng
  subject_type  text NOT NULL CHECK (subject_type IN ('branch_visit', 'contact_call', 'company_note')),
  subject_id    text NOT NULL,
  related_date  date,
  title         text NOT NULL DEFAULT '',
  duration_s    numeric(10,1) NOT NULL DEFAULT 0 CHECK (duration_s >= 0),
  size_bytes    bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  mime_type     text NOT NULL DEFAULT 'audio/webm',
  storage_path  text NOT NULL,
  url           text NOT NULL,
  transcript    text,
  user_id       text NOT NULL DEFAULT '',
  user_name     text NOT NULL DEFAULT '',
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_voice_subject_idx ON crm_voice_recordings (subject_type, subject_id, recorded_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cskh_missed_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  text NOT NULL,                               -- contacts.id (không FK)
  missed_on   date NOT NULL,                               -- ngày theo giờ Việt Nam
  user_name   text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cskh_missed_calls_day_idx ON cskh_missed_calls (missed_on, contact_id);

ALTER TABLE crm_voice_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cskh_missed_calls ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_voice_recordings', 'cskh_missed_calls'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_all_' || r) THEN
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t || '_all_' || r, t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Bucket âm thanh
INSERT INTO storage.buckets (id, name, public) VALUES ('crm-voice', 'crm-voice', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'crm_voice_select_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR SELECT TO %I USING (bucket_id = %L)', 'crm_voice_select_' || r, r, 'crm-voice');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'crm_voice_insert_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO %I WITH CHECK (bucket_id = %L)', 'crm_voice_insert_' || r, r, 'crm-voice');
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON crm_voice_recordings';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON crm_voice_recordings FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON cskh_missed_calls';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON cskh_missed_calls FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE crm_voice_recordings IS 'Bản ghi âm trong CRM: ghé chi nhánh / gọi chăm sóc / ghi chú công ty. Xoá mềm bằng deleted_at.';
COMMENT ON TABLE cskh_missed_calls IS 'Khách chưa nghe máy — đẩy người đó xuống cuối hàng đợi CSKH trong ngày missed_on.';

NOTIFY pgrst, 'reload schema';

-- Kiểm tra sau khi chạy (mong đợi: 2 bảng + 1 bucket):
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('crm_voice_recordings', 'cskh_missed_calls');
-- SELECT id FROM storage.buckets WHERE id = 'crm-voice';
-- Rollback (MẤT danh sách bản ghi + dấu chưa nghe máy; file âm thanh còn trong bucket):
-- DROP TABLE IF EXISTS crm_voice_recordings; DROP TABLE IF EXISTS cskh_missed_calls;
