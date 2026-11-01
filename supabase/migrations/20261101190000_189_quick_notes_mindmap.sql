-- ============================================================================
-- 189 — Ghi chú nhanh: Sơ đồ tư duy (mindmap kiểu XMind) trong từng ghi chú
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   quick_notes.mindmap    jsonb  — cả sơ đồ (chủ đề, nhánh, liên kết, vùng bao, tóm tắt, cấu trúc, chủ đề màu)
--   quick_notes.view_mode  text   — ghi chú đang mở ở dạng 'text' (văn bản) hay 'mindmap' (sơ đồ)
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ THÊM 2 cột (mặc định rỗng / 'text') và thay hàm quick_notes_rpc
-- bằng bản biết lưu 2 cột mới. Nội dung chữ, ghi âm của các ghi chú cũ giữ nguyên.
-- Cần chạy SAU migration 188.
-- ============================================================================

SET search_path = public, extensions;

-- ── 1. Cột mới ─────────────────────────────────────────────────────────────
ALTER TABLE quick_notes ADD COLUMN IF NOT EXISTS mindmap jsonb;
ALTER TABLE quick_notes ADD COLUMN IF NOT EXISTS view_mode text NOT NULL DEFAULT 'text';
ALTER TABLE quick_notes DROP CONSTRAINT IF EXISTS quick_notes_view_mode_check;
ALTER TABLE quick_notes ADD CONSTRAINT quick_notes_view_mode_check CHECK (view_mode IN ('text', 'mindmap'));

-- ── 2. Cổng quick_notes_rpc: như 188 + lưu mindmap / view_mode ──────────────
CREATE OR REPLACE FUNCTION quick_notes_rpc(p_token text, p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid;
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_id uuid;
  v_note uuid;
  n quick_notes;
BEGIN
  SELECT s.user_id INTO v_uid FROM cp_session(p_token) s LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại';
  END IF;

  CASE p_action
  WHEN 'whoami' THEN
    RETURN jsonb_build_object('user_id', v_uid);

  WHEN 'list' THEN
    RETURN coalesce((SELECT jsonb_agg(quick_notes__json(q) ORDER BY q.created_at)
                     FROM quick_notes q WHERE q.user_id = v_uid AND q.deleted_at IS NULL), '[]'::jsonb);

  WHEN 'trash' THEN
    RETURN coalesce((SELECT jsonb_agg(quick_notes__json(q) ORDER BY q.deleted_at DESC)
                     FROM quick_notes q
                     WHERE q.user_id = v_uid AND q.deleted_at IS NOT NULL AND q.deleted_at > now() - interval '30 days'),
                    '[]'::jsonb);

  WHEN 'save' THEN
    v_id := nullif(a->>'id', '')::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Thiếu mã ghi chú'; END IF;
    IF length(coalesce(a->>'body', '')) > 200000 THEN
      RAISE EXCEPTION 'Ghi chú quá dài (tối đa 200.000 ký tự) — tách bớt sang ghi chú khác';
    END IF;
    IF a ? 'mindmap' AND length(coalesce(a->>'mindmap', '')) > 1500000 THEN
      RAISE EXCEPTION 'Sơ đồ tư duy quá lớn — tách bớt nhánh sang ghi chú khác';
    END IF;
    INSERT INTO quick_notes (id, user_id) VALUES (v_id, v_uid) ON CONFLICT (id) DO NOTHING;
    UPDATE quick_notes SET
      title       = CASE WHEN a ? 'title' THEN left(coalesce(a->>'title', ''), 200) ELSE title END,
      body        = CASE WHEN a ? 'body' THEN coalesce(a->>'body', '') ELSE body END,
      color       = CASE WHEN a ? 'color' THEN a->>'color' ELSE color END,
      font_size   = CASE WHEN a ? 'font_size' THEN (a->>'font_size')::smallint ELSE font_size END,
      font        = CASE WHEN a ? 'font' THEN a->>'font' ELSE font END,
      pinned      = CASE WHEN a ? 'pinned' THEN coalesce((a->>'pinned')::boolean, false) ELSE pinned END,
      archived_at = CASE WHEN a ? 'archived'
                         THEN CASE WHEN coalesce((a->>'archived')::boolean, false) THEN coalesce(archived_at, now()) END
                         ELSE archived_at END,
      mindmap     = CASE WHEN a ? 'mindmap' THEN CASE WHEN jsonb_typeof(a->'mindmap') = 'object' THEN a->'mindmap' END
                         ELSE mindmap END,
      view_mode   = CASE WHEN a ? 'view_mode' THEN coalesce(nullif(a->>'view_mode', ''), 'text') ELSE view_mode END,
      updated_at  = now()
    WHERE id = v_id AND user_id = v_uid AND deleted_at IS NULL
    RETURNING * INTO n;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy ghi chú'; END IF;
    RETURN quick_notes__json(n);

  WHEN 'delete' THEN
    UPDATE quick_notes SET deleted_at = now()
    WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NULL;
    RETURN jsonb_build_object('ok', true);

  WHEN 'restore' THEN
    UPDATE quick_notes SET deleted_at = NULL, updated_at = now()
    WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NOT NULL
    RETURNING * INTO n;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy ghi chú'; END IF;
    RETURN quick_notes__json(n);

  WHEN 'recording.add' THEN
    v_note := (a->>'note_id')::uuid;
    IF NOT starts_with(coalesce(a->>'storage_path', ''), v_uid::text || '/') THEN
      RAISE EXCEPTION 'Đường dẫn file ghi âm không hợp lệ';
    END IF;
    INSERT INTO quick_notes (id, user_id, title) VALUES (v_note, v_uid, 'Ghi âm') ON CONFLICT (id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM quick_notes WHERE id = v_note AND user_id = v_uid) THEN
      RAISE EXCEPTION 'Không tìm thấy ghi chú';
    END IF;
    INSERT INTO quick_note_recordings (note_id, user_id, storage_path, mime_type, duration_sec, size_bytes, title)
    VALUES (v_note, v_uid, a->>'storage_path',
            coalesce(nullif(a->>'mime_type', ''), 'audio/webm'),
            greatest(coalesce((a->>'duration_sec')::numeric, 0), 0),
            greatest(coalesce((a->>'size_bytes')::bigint, 0), 0),
            left(coalesce(a->>'title', ''), 200))
    ON CONFLICT (storage_path) DO NOTHING;
    UPDATE quick_notes SET updated_at = now() WHERE id = v_note RETURNING * INTO n;
    RETURN quick_notes__json(n);

  WHEN 'recording.rename' THEN
    UPDATE quick_note_recordings SET title = left(coalesce(a->>'title', ''), 200)
    WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NULL
    RETURNING note_id INTO v_note;
    IF v_note IS NULL THEN RAISE EXCEPTION 'Không tìm thấy bản ghi âm'; END IF;
    SELECT * INTO n FROM quick_notes WHERE id = v_note;
    RETURN quick_notes__json(n);

  WHEN 'recording.delete' THEN
    UPDATE quick_note_recordings SET deleted_at = now()
    WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NULL
    RETURNING note_id INTO v_note;
    IF v_note IS NULL THEN RAISE EXCEPTION 'Không tìm thấy bản ghi âm'; END IF;
    SELECT * INTO n FROM quick_notes WHERE id = v_note;
    RETURN quick_notes__json(n);

  ELSE
    RAISE EXCEPTION 'Thao tác không hợp lệ: %', p_action;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION quick_notes_rpc(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quick_notes_rpc(text, text, jsonb) TO anon, authenticated;
