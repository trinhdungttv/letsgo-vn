-- ============================================================================
-- 188 — Ghi chú nhanh (dải thẻ dính mép phải màn hình) + ghi âm cuộc họp
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   quick_notes            ghi chú của RIÊNG từng người (màu, cỡ chữ, ghim, lưu trữ, xoá mềm)
--   quick_note_recordings  bản ghi âm gắn với ghi chú; file nằm ở bucket Storage 'quick-notes'
--                          (cột transcript / summary để dành cho chuyển giọng nói thành chữ — chưa dùng)
--
-- BẢO MẬT: ghi chú là chuyện riêng của mỗi người, mà anon key nằm sẵn trong file JS của app → 2 bảng KHOÁ HẲN
-- (REVOKE ALL, không có policy). Mọi đọc/ghi đi qua 1 hàm quick_notes_rpc(p_token, p_action, p_args): kiểm phiên
-- đăng nhập (cp_session — migration 157) và chỉ chạm dòng của chính người đó, kể cả admin cũng không đọc được
-- ghi chú của người khác. KHÔNG gắn trigger data_history (bảng đó đọc được bằng anon key → sẽ lộ ghi chú).
--
-- File ghi âm: bucket 'quick-notes' RIÊNG TƯ và KHÔNG có policy cho anon → không ai đọc / liệt kê được bằng
-- anon key. Chỉ server (api/quick-notes-audio.ts, dùng khoá service_role đặt ở Vercel) cấp link tải lên / nghe
-- lại có hạn, sau khi kiểm phiên đăng nhập và đúng thư mục <user_id>/ của người đó.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO bảng / hàm / bucket mới. Nút "Xoá" trong app là xoá mềm
-- (đặt deleted_at), ghi chú vào mục "Đã xoá" và khôi phục được; file ghi âm không bị xoá khỏi Storage.
-- Cần chạy SAU migration 157 (hàm cp_session).
-- ============================================================================

SET search_path = public, extensions;

-- ── 1. Bảng ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quick_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  color       text NOT NULL DEFAULT 'yellow'
              CHECK (color IN ('yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'slate', 'gray')),
  font_size   smallint NOT NULL DEFAULT 15 CHECK (font_size BETWEEN 11 AND 28),
  font        text NOT NULL DEFAULT 'sans' CHECK (font IN ('sans', 'serif', 'mono')),
  pinned      boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quick_notes_user ON quick_notes(user_id, created_at);

CREATE TABLE IF NOT EXISTS quick_note_recordings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  mime_type    text NOT NULL DEFAULT 'audio/webm',
  duration_sec numeric(10,1) NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  size_bytes   bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  title        text NOT NULL DEFAULT '',
  transcript   text,
  summary      text,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quick_note_recordings_note ON quick_note_recordings(note_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quick_note_recordings_user ON quick_note_recordings(user_id);

-- ── 2. Khoá bảng: chỉ đi qua quick_notes_rpc ───────────────────────────────
ALTER TABLE quick_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_note_recordings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quick_notes FROM anon, authenticated;
REVOKE ALL ON quick_note_recordings FROM anon, authenticated;

-- ── 3. Bucket ghi âm (riêng tư, không policy cho anon) ─────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('quick-notes', 'quick-notes', false)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets SET public = false WHERE id = 'quick-notes' AND public;

-- ── 4. Hàm nội bộ ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION quick_notes__json(n quick_notes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT (to_jsonb(n) - 'user_id') || jsonb_build_object('recordings', coalesce((
    SELECT jsonb_agg(to_jsonb(r) - 'user_id' - 'deleted_at' ORDER BY r.created_at)
    FROM quick_note_recordings r
    WHERE r.note_id = n.id AND r.deleted_at IS NULL
  ), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION quick_notes__json(quick_notes) FROM PUBLIC, anon, authenticated;

-- ── 5. Cổng duy nhất cho app ───────────────────────────────────────────────
-- Thao tác:
--   whoami                      → { user_id }  (server api/quick-notes-audio.ts dùng để khoá thư mục file)
--   list                        → ghi chú chưa xoá (kể cả đã lưu trữ), kèm bản ghi âm
--   trash                       → ghi chú đã xoá trong 30 ngày gần nhất
--   save { id, ...trường }      → tạo mới (id do app sinh) hoặc sửa; chỉ đổi trường có gửi lên
--   delete { id } / restore { id }
--   recording.add { note_id, storage_path, mime_type, duration_sec, size_bytes, title }
--   recording.rename { id, title } / recording.delete { id }
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
    -- Ghi âm xong mà ghi chú chưa kịp lưu lần nào → tạo luôn ghi chú để không mất bản ghi.
    INSERT INTO quick_notes (id, user_id, title) VALUES (v_note, v_uid, 'Ghi âm') ON CONFLICT (id) DO NOTHING;
    -- Ghi chú đã bị xoá trong lúc đang tải lên vẫn nhận bản ghi (nằm trong mục Đã xoá, khôi phục được).
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
