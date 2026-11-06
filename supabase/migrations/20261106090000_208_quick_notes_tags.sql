-- ============================================================================
-- 208 — Ghi chú nhanh: THẺ (tag) để phân loại / tìm lại (giống TickTick)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   quick_notes.tags   text[]  — danh sách thẻ của từng ghi chú / sơ đồ (mặc định rỗng). Tối đa 40 thẻ, mỗi thẻ ≤ 30 ký tự.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ THÊM 1 cột (mặc định rỗng) và thay hàm quick_notes_rpc bằng bản y hệt
-- migration 196 (khoá chống xoá, ghi âm, sơ đồ…) + biết nhận trường "tags" khi lưu. Danh sách trả về đã có tags
-- (quick_notes__json lấy cả dòng). Cần chạy SAU migration 188, 189, 196.
-- ============================================================================

SET search_path = public, extensions;

ALTER TABLE quick_notes ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

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
  chk jsonb;
  v_pin text;
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
      tags        = CASE WHEN a ? 'tags'
                         THEN coalesce(ARRAY(SELECT left(btrim(x), 30)
                                             FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a->'tags') = 'array' THEN a->'tags' ELSE '[]'::jsonb END) x
                                             WHERE btrim(x) <> '' LIMIT 40), '{}'::text[])
                         ELSE tags END,
      updated_at  = now()
    WHERE id = v_id AND user_id = v_uid AND deleted_at IS NULL
    RETURNING * INTO n;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy ghi chú'; END IF;
    RETURN quick_notes__json(n);

  WHEN 'delete' THEN
    SELECT * INTO n FROM quick_notes
    WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', true); END IF;
    IF n.locked_at IS NOT NULL THEN
      v_pin := nullif(a->>'pin', '');
      IF v_pin IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'note_locked'); END IF;
      chk := qn_lock_check(v_uid, v_pin, 'pin');
      IF NOT coalesce((chk->>'ok')::boolean, false) THEN RETURN chk; END IF;
    END IF;
    UPDATE quick_notes SET locked_at = NULL, deleted_at = now() WHERE id = n.id;
    RETURN jsonb_build_object('ok', true);

  WHEN 'restore' THEN
    UPDATE quick_notes SET deleted_at = NULL, updated_at = now()
    WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NOT NULL
    RETURNING * INTO n;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy ghi chú'; END IF;
    RETURN quick_notes__json(n);

  WHEN 'lock.status' THEN
    RETURN coalesce((
      SELECT jsonb_build_object('has_pin', true, 'wait_seconds',
               CASE WHEN p.locked_until > now() THEN ceil(extract(epoch FROM (p.locked_until - now())))::int ELSE 0 END)
      FROM quick_note_lock_pins p WHERE p.user_id = v_uid
    ), jsonb_build_object('has_pin', false, 'wait_seconds', 0));

  WHEN 'pin.set' THEN
    v_pin := a->>'pin';
    IF v_pin IS NULL OR v_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Mã khoá phải đúng 4 chữ số'; END IF;
    IF EXISTS (SELECT 1 FROM quick_note_lock_pins WHERE user_id = v_uid) THEN
      RAISE EXCEPTION 'Đã có mã khoá — dùng "Đổi mã" hoặc "Quên mã"';
    END IF;
    INSERT INTO quick_note_lock_pins (user_id, pin_hash) VALUES (v_uid, crypt(v_pin, gen_salt('bf')));
    RETURN jsonb_build_object('ok', true);

  WHEN 'pin.change', 'pin.reset' THEN
    v_pin := a->>'new_pin';
    IF v_pin IS NULL OR v_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Mã khoá mới phải đúng 4 chữ số'; END IF;
    IF p_action = 'pin.change' THEN chk := qn_lock_check(v_uid, a->>'pin', 'pin');
    ELSE chk := qn_lock_check(v_uid, a->>'password', 'password');
    END IF;
    IF NOT coalesce((chk->>'ok')::boolean, false) THEN RETURN chk; END IF;
    UPDATE quick_note_lock_pins
      SET pin_hash = crypt(v_pin, gen_salt('bf')), failed_attempts = 0, lock_count = 0, locked_until = NULL, updated_at = now()
      WHERE user_id = v_uid;
    RETURN jsonb_build_object('ok', true);

  WHEN 'lock' THEN
    IF NOT EXISTS (SELECT 1 FROM quick_note_lock_pins WHERE user_id = v_uid) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_pin');
    END IF;
    UPDATE quick_notes SET locked_at = coalesce(locked_at, now())
    WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NULL
    RETURNING * INTO n;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy ghi chú'; END IF;
    RETURN jsonb_build_object('ok', true, 'note', quick_notes__json(n));

  WHEN 'unlock' THEN
    SELECT * INTO n FROM quick_notes WHERE id = (a->>'id')::uuid AND user_id = v_uid AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy ghi chú'; END IF;
    IF n.locked_at IS NOT NULL THEN
      chk := qn_lock_check(v_uid, a->>'pin', 'pin');
      IF NOT coalesce((chk->>'ok')::boolean, false) THEN RETURN chk; END IF;
      UPDATE quick_notes SET locked_at = NULL WHERE id = n.id RETURNING * INTO n;
    END IF;
    RETURN jsonb_build_object('ok', true, 'note', quick_notes__json(n));

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
    -- Bản ghi âm trong mục đang khoá cũng không xoá được (mở khoá trước)
    IF EXISTS (SELECT 1 FROM quick_note_recordings r JOIN quick_notes q ON q.id = r.note_id
               WHERE r.id = (a->>'id')::uuid AND r.user_id = v_uid AND q.locked_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Mục đang khoá chống xoá — mở khoá (nhập mã 4 số) rồi mới xoá được bản ghi âm';
    END IF;
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
