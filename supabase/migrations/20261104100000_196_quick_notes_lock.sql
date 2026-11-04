-- ============================================================================
-- 196 — Ghi chú nhanh: KHOÁ CHỐNG XOÁ bằng mã 4 số (từng ghi chú / sơ đồ tư duy)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   quick_notes.locked_at   timestamptz — có giá trị = mục đang khoá: KHÔNG xoá được (kể cả "Đã xoá → xoá hẳn"
--                           sau này) trừ khi nhập đúng mã. Ràng buộc CHECK: mục đang khoá không thể nằm trong Đã xoá.
--   quick_note_lock_pins    mã 4 số RIÊNG của từng người (ghi chú là riêng từng người) — chỉ lưu bản băm bcrypt,
--                           không lưu mã gốc; sai 5 lần thì tạm khoá 15 phút (lần sau gấp đôi, tối đa 24 giờ).
--
-- Quên mã: trong app bấm "Quên mã?" → nhập mật khẩu đăng nhập → đặt mã mới (mục đang khoá vẫn khoá, dùng mã mới).
-- Không nhớ cả mật khẩu: quản trị chạy  DELETE FROM quick_note_lock_pins WHERE user_id = '<id người đó>';
-- → lần tới bấm mở khoá, app cho đặt mã mới.
--
-- Bảng mã KHOÁ HẲN với anon key (REVOKE ALL, không policy) — chỉ đi qua quick_notes_rpc. KHÔNG gắn data_history.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ THÊM 1 cột (mặc định trống = không khoá), 1 bảng mới, 1 ràng buộc
-- (mọi dòng cũ đều thoả vì chưa mục nào khoá) và thay hàm quick_notes_rpc bằng bản biết khoá / mở khoá.
-- Cần chạy SAU migration 188, 189.
-- ============================================================================

SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Cột khoá + ràng buộc "đang khoá thì không nằm trong Đã xoá" ─────────
ALTER TABLE quick_notes ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE quick_notes DROP CONSTRAINT IF EXISTS quick_notes_locked_not_deleted;
ALTER TABLE quick_notes ADD CONSTRAINT quick_notes_locked_not_deleted CHECK (locked_at IS NULL OR deleted_at IS NULL);

-- ── 2. Mã 4 số của từng người ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quick_note_lock_pins (
  user_id         uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  pin_hash        text NOT NULL,                 -- bcrypt của mã 4 số
  failed_attempts int NOT NULL DEFAULT 0,
  lock_count      int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quick_note_lock_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quick_note_lock_pins FROM anon, authenticated;

-- ── 3. Hàm nội bộ: kiểm mã / mật khẩu, đếm số lần sai ──────────────────────
-- KHÔNG dùng RAISE khi sai (raise sẽ huỷ luôn việc đếm số lần sai) — trả jsonb { ok, reason, remaining, seconds }.
CREATE OR REPLACE FUNCTION qn_lock_fail(p_uid uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  s quick_note_lock_pins%ROWTYPE;
  v_lock_min int;
BEGIN
  SELECT * INTO s FROM quick_note_lock_pins WHERE user_id = p_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_pin'); END IF;
  s.failed_attempts := s.failed_attempts + 1;
  IF s.failed_attempts >= 5 THEN
    v_lock_min := least(15 * power(2, least(s.lock_count, 10))::int, 1440);
    UPDATE quick_note_lock_pins
      SET failed_attempts = 0, lock_count = lock_count + 1, locked_until = now() + make_interval(mins => v_lock_min)
      WHERE user_id = p_uid;
    RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'seconds', v_lock_min * 60);
  END IF;
  UPDATE quick_note_lock_pins SET failed_attempts = s.failed_attempts WHERE user_id = p_uid;
  RETURN jsonb_build_object('ok', false, 'reason', p_reason, 'remaining', 5 - s.failed_attempts);
END $$;
REVOKE ALL ON FUNCTION qn_lock_fail(uuid, text) FROM PUBLIC, anon, authenticated;

-- p_kind = 'pin' (mã 4 số) hoặc 'password' (mật khẩu đăng nhập — dùng khi quên mã)
CREATE OR REPLACE FUNCTION qn_lock_check(p_uid uuid, p_secret text, p_kind text DEFAULT 'pin') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  s quick_note_lock_pins%ROWTYPE;
  v_ok boolean;
BEGIN
  SELECT * INTO s FROM quick_note_lock_pins WHERE user_id = p_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_pin'); END IF;
  IF s.locked_until IS NOT NULL AND s.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked',
                              'seconds', ceil(extract(epoch FROM (s.locked_until - now())))::int);
  END IF;

  IF p_kind = 'password' THEN
    SELECT EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.id = p_uid AND u.password IS NOT NULL AND coalesce(p_secret, '') <> ''
        AND u.password = crypt(p_secret, u.password)
    ) INTO v_ok;
  ELSE
    v_ok := p_secret IS NOT NULL AND p_secret ~ '^[0-9]{4}$' AND s.pin_hash = crypt(p_secret, s.pin_hash);
  END IF;
  IF NOT v_ok THEN
    RETURN qn_lock_fail(p_uid, CASE WHEN p_kind = 'password' THEN 'wrong_password' ELSE 'wrong_pin' END);
  END IF;

  IF s.failed_attempts <> 0 OR s.lock_count <> 0 THEN
    UPDATE quick_note_lock_pins SET failed_attempts = 0, lock_count = 0, locked_until = NULL WHERE user_id = p_uid;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION qn_lock_check(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ── 4. Cổng quick_notes_rpc: như 189 + khoá chống xoá ───────────────────────
-- Thao tác mới / đổi:
--   lock.status                       → { has_pin, wait_seconds }
--   pin.set { pin }                   → đặt mã lần đầu (chỉ khi chưa có mã)
--   pin.change { pin, new_pin }       → đổi mã (cần mã cũ)
--   pin.reset { password, new_pin }   → quên mã: đặt mã mới bằng mật khẩu đăng nhập
--   lock { id }                       → khoá 1 mục (phải có mã rồi)
--   unlock { id, pin }                → mở khoá (cần mã)
--   delete { id, pin? }               → mục đang khoá: cần mã đúng (xoá xong thì bỏ khoá, vào Đã xoá như thường)
--   recording.delete                  → bản ghi âm trong mục đang khoá: từ chối (mở khoá trước)
-- Sai mã / bị tạm khoá → trả { ok: false, reason, remaining | seconds } (không RAISE để còn đếm số lần sai).
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
