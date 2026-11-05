-- ============================================================================
-- 204 — Hồ sơ công ty: DÒNG THỜI GIAN mốc quan trọng + GHI CHÚ CHUYÊN NGHIỆP (văn bản / sơ đồ tư duy)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   client_profile_briefs   1 dòng / công ty (khoá = clients.id, hoặc id thẻ CRM Pipeline nếu chưa là khách):
--                           milestones    mảng JSON các mốc [{ id, date, title, note, kind, planned }]
--                           notes_text    ghi chú dạng văn bản (Markdown đơn giản: #, -, [ ], **đậm**)
--                           notes_mindmap sơ đồ tư duy (cùng định dạng Sơ đồ tư duy của Ghi chú nhanh)
--                           notes_mode    'text' | 'mindmap' — kiểu đang hiển thị
--
-- Chưa chạy migration này: hồ sơ công ty vẫn mở bình thường; khối mới báo "cần chạy migration 204" và KHÔNG lưu được.
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới. "Ghi chú nội bộ" (bình luận) cũ giữ nguyên ở bảng cũ,
-- hiện ở tab "Trao đổi nội bộ".
-- Không có khoá ngoại (bài học PGRST201). Lịch sử dữ liệu: gắn dh_track riêng bảng này (KHÔNG gọi dh_attach_triggers()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_profile_briefs (
  client_id      uuid PRIMARY KEY,                    -- clients.id hoặc crm_pipeline.id (không FK)
  milestones     jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes_text     text  NOT NULL DEFAULT '',
  notes_mindmap  jsonb,
  notes_mode     text  NOT NULL DEFAULT 'text',
  updated_by     text  NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION client_briefs_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_profile_briefs_touch ON client_profile_briefs;
CREATE TRIGGER trg_client_profile_briefs_touch BEFORE UPDATE ON client_profile_briefs
  FOR EACH ROW EXECUTE FUNCTION client_briefs_touch_updated_at();

ALTER TABLE client_profile_briefs ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_profile_briefs' AND policyname = 'client_profile_briefs_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON client_profile_briefs FOR ALL TO %I USING (true) WITH CHECK (true)', 'client_profile_briefs_all_' || r, r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON client_profile_briefs';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON client_profile_briefs FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE client_profile_briefs IS 'Dòng thời gian mốc quan trọng + ghi chú tổng hợp (văn bản / sơ đồ tư duy) của 1 công ty, hiện đầu hồ sơ chăm sóc.';

NOTIFY pgrst, 'reload schema';

-- Kiểm tra sau khi chạy (mong đợi: 1 dòng):
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'client_profile_briefs';
-- Rollback (MẤT mốc + ghi chú đã nhập): DROP TABLE IF EXISTS client_profile_briefs; DROP FUNCTION IF EXISTS client_briefs_touch_updated_at();
