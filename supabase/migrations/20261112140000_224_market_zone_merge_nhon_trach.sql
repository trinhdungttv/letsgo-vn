-- ============================================================================
-- 224 — GỘP KCN: "KCN Nhơn Trạch 1 / 3 / 6" → "KCN Nhơn Trạch" (1 KCN duy nhất, tránh nhầm / tìm không ra)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (lần sau không còn gì để gộp).
-- ----------------------------------------------------------------------------
-- Làm gì:
--   1. Hàm dùng lại được  market_zone_merge(KCN gộp đi, KCN giữ lại):
--        • chuyển MỌI chỗ đang trỏ tới KCN cũ sang KCN giữ lại — theo mã (khảo sát, ảnh, ghi âm, nhà trọ, ảnh 360, kế hoạch ghé,
--          link chia sẻ, CRM Pipeline zone_ids + ghim nhà máy, Sale theo KCN, ghé KCN, phương án giá, bảng lương, so sánh giá vùng,
--          đợt gửi Nguồn LĐ) và theo TÊN (KCN của Khách hàng, KCN đối thủ hoạt động / trụ sở, nhà máy đối thủ đang phục vụ,
--          khảo sát lương, KCN chính trên Pipeline / Thị trường, điểm tuyển dụng) — đúng danh sách nút "Đổi tên KCN" ở tab Khu vực;
--        • ghi giá trị CŨ của từng ô vào nhật ký market_zone_merge_log + cả dòng KCN cũ vào market_zone_merges → HOÀN TÁC được;
--        • xoá dòng KCN cũ khỏi danh mục (đã lưu nguyên dòng trong market_zone_merges);
--        • thêm "tên cũ" vào market_zone_aliases để app tự hiểu "Nhơn Trạch 3" = "KCN Nhơn Trạch".
--   2. Chặn tạo lại / đổi tên thành tên đã gộp (VD thêm KCN "Khu công nghiệp Nhơn Trạch 2" từ bản đồ) — báo dùng KCN đã gộp.
--   3. Gộp Nhơn Trạch 1, 3, 6 vào KCN Nhơn Trạch; ghi sẵn tên Nhơn Trạch 2, 4, 5 (chưa có trong danh mục) là tên của KCN Nhơn Trạch.
--
-- Có mất dữ liệu không? KHÔNG MẤT — dữ liệu được CHUYỂN sang KCN Nhơn Trạch. Thứ duy nhất bị xoá là 3 dòng KCN con trong danh mục
-- (ảnh bìa, toạ độ, link bản đồ riêng của NT1/NT3/NT6) và bộ nhớ đường xe khách Nguồn LĐ tới 3 KCN đó (app tự tính lại) —
-- tất cả đã lưu nguyên vào market_zone_merges / market_zone_merge_log, hoàn tác bằng market_zone_merge_undo (cuối file).
-- Dữ liệu thật lúc viết (12/11): 3 khách hàng (CHIN WELL → NT3, SUMMIT POLYMERS ×2 → NT6) + bộ nhớ đường Nguồn LĐ; chưa có
-- chuyến / ảnh / Pipeline nào gắn NT1/3/6.
-- ============================================================================
SET search_path = public;

-- ═════════════════════════ BẢNG ═════════════════════════
CREATE TABLE IF NOT EXISTS market_zone_merges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigserial,                      -- thứ tự gộp (hoàn tác phải đi từ mới nhất về cũ nhất)
  from_zone   uuid NOT NULL,
  from_name   text NOT NULL,
  into_zone   uuid NOT NULL,
  into_name   text NOT NULL,
  from_row    jsonb NOT NULL,                 -- nguyên dòng market_zones đã xoá
  counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_at   timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz
);
CREATE TABLE IF NOT EXISTS market_zone_merge_log (
  id        bigserial PRIMARY KEY,
  merge_id  uuid NOT NULL,
  tbl       text NOT NULL,
  action    text NOT NULL CHECK (action IN ('update', 'delete')),
  pk        jsonb NOT NULL,                    -- khoá dòng: {"id": "..."} (bảng khoá ghép thì nhiều cột)
  old       jsonb NOT NULL,                    -- update: giá trị cũ các cột đã đổi · delete: nguyên dòng
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_zone_merge_log_merge_idx ON market_zone_merge_log (merge_id);
-- Nhật ký có dữ liệu khách hàng → khoá với app (chỉ chạy trong SQL Editor)
ALTER TABLE market_zone_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_zone_merge_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON market_zone_merges, market_zone_merge_log FROM anon, authenticated;

-- Tên cũ / tên khác → KCN trong danh mục. key = tên đã chuẩn hoá (market_zone_key); khớp cả "key …" (VD "nhon trach 2 loc khang").
CREATE TABLE IF NOT EXISTS market_zone_aliases (
  key        text PRIMARY KEY,
  zone_id    uuid NOT NULL,
  label      text NOT NULL DEFAULT '',          -- tên hiển thị gốc, VD "KCN Nhơn Trạch 3"
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE market_zone_aliases ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'market_zone_aliases' AND policyname = 'market_zone_aliases_read') THEN
    CREATE POLICY market_zone_aliases_read ON market_zone_aliases FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;
GRANT SELECT ON market_zone_aliases TO anon, authenticated;

-- ═════════════════════════ CHUẨN HOÁ TÊN (giống foldZoneName trong app) ═════════════════════════
-- "KCN Nhơn Trạch 3" / "Khu công nghiệp Nhơn Trạch III" → "nhon trach 3"
CREATE OR REPLACE FUNCTION market_zone_key(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s text;
  w text;
  out text[] := '{}';
  roman constant jsonb := '{"i":"1","ii":"2","iii":"3","iv":"4","v":"5","vi":"6","vii":"7","viii":"8","ix":"9","x":"10","xi":"11","xii":"12"}';
BEGIN
  s := translate(lower(normalize(coalesce(p, ''), NFC)),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd');
  s := regexp_replace(s, 'khu\s*cong\s*nghiep|cum\s*cong\s*nghiep|khu\s*che\s*xuat|industrial\s*(park|zone|estate)|\mkcn\M|\mccn\M|\mkcx\M', ' ', 'g');
  s := btrim(regexp_replace(s, '[^a-z0-9]+', ' ', 'g'));
  IF s = '' THEN RETURN ''; END IF;
  FOREACH w IN ARRAY string_to_array(s, ' ') LOOP
    out := out || coalesce(roman ->> w, w);
  END LOOP;
  RETURN array_to_string(out, ' ');
END $$;

-- KCN mà 1 tên đã được gộp vào (null = không phải tên đã gộp)
CREATE OR REPLACE FUNCTION market_zone_alias_of(p_name text) RETURNS market_zone_aliases
LANGUAGE sql STABLE AS $$
  SELECT a.* FROM market_zone_aliases a, market_zone_key(p_name) k
  WHERE k <> '' AND (k = a.key OR k LIKE a.key || ' %')
  ORDER BY length(a.key) DESC LIMIT 1
$$;

-- Chặn tạo mới / đổi tên KCN thành tên đã gộp
CREATE OR REPLACE FUNCTION market_zone_alias_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a market_zone_aliases;
BEGIN
  a := market_zone_alias_of(NEW.name);
  IF a.key IS NOT NULL AND a.zone_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Khu vực "%" đã được gộp vào % — chọn KCN đó thay vì tạo mới',
      NEW.name, coalesce((SELECT name FROM market_zones WHERE id = a.zone_id), 'KCN khác');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_market_zone_alias_guard ON market_zones;
CREATE TRIGGER trg_market_zone_alias_guard BEFORE INSERT OR UPDATE OF name ON market_zones
  FOR EACH ROW EXECUTE FUNCTION market_zone_alias_guard();

-- ═════════════════════════ HÀM PHỤ ═════════════════════════
CREATE OR REPLACE FUNCTION _mzm_has(p_tbl text, p_col text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_tbl AND column_name = p_col)
$$;

/** Ghi giá trị cũ của p_cols (các dòng khớp p_where) vào nhật ký rồi UPDATE p_tbl SET p_set WHERE p_where. Thiếu bảng / cột → 0. */
CREATE OR REPLACE FUNCTION _mzm_apply(p_merge uuid, p_tbl text, p_pk text[], p_cols text[], p_where text, p_set text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  pk_pairs text;
  col_pairs text;
  c text;
BEGIN
  IF to_regclass('public.' || quote_ident(p_tbl)) IS NULL THEN RETURN 0; END IF;
  FOREACH c IN ARRAY p_pk || p_cols LOOP
    IF NOT _mzm_has(p_tbl, c) THEN RETURN 0; END IF;
  END LOOP;
  SELECT string_agg(format('%L, %I', x, x), ', ') INTO pk_pairs FROM unnest(p_pk) x;
  SELECT string_agg(format('%L, %I', x, x), ', ') INTO col_pairs FROM unnest(p_cols) x;
  EXECUTE format('INSERT INTO market_zone_merge_log (merge_id, tbl, action, pk, old) SELECT %L, %L, ''update'', jsonb_build_object(%s), jsonb_build_object(%s) FROM %I WHERE %s',
    p_merge, p_tbl, pk_pairs, col_pairs, p_tbl, p_where);
  EXECUTE format('UPDATE %I SET %s WHERE %s', p_tbl, p_set, p_where);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

/** Biểu thức: thay phần tử a bằng b trong mảng cột col, bỏ trùng, giữ thứ tự */
CREATE OR REPLACE FUNCTION _mzm_arr_replace(p_col text, p_a text, p_b text, p_type text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('(SELECT coalesce(array_agg(x ORDER BY o), ''{}''::%4$s) FROM (SELECT x, min(o) AS o FROM unnest(array_replace(%1$I, %2$L::%5$s, %3$L::%5$s)) WITH ORDINALITY u(x, o) GROUP BY x) s)',
    p_col, p_a, p_b, p_type, replace(p_type, '[]', ''))
$$;

-- ═════════════════════════ GỘP ═════════════════════════
CREATE OR REPLACE FUNCTION market_zone_merge(p_from uuid, p_into uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  f market_zones%ROWTYPE;
  t market_zones%ROWTYPE;
  mid uuid := gen_random_uuid();
  cnt jsonb := '{}'::jsonb;
  n int;
  r record;
  fid text := p_from::text;
  iid text := p_into::text;
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION 'Không gộp 1 KCN vào chính nó'; END IF;
  SELECT * INTO f FROM market_zones WHERE id = p_from;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped', 'Không còn KCN gộp đi (đã gộp trước đó?)'); END IF;
  SELECT * INTO t FROM market_zones WHERE id = p_into;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không có KCN giữ lại %', p_into; END IF;
  INSERT INTO market_zone_merges (id, from_zone, from_name, into_zone, into_name, from_row) VALUES (mid, f.id, f.name, t.id, t.name, to_jsonb(f));

  -- (a) Cột mã KCN (uuid) — kèm cột tên KCN đi cùng nếu có
  FOR r IN SELECT * FROM (VALUES
      ('kcn_survey_trips', 'zone_id', 'zone_name'), ('kcn_survey_photos', 'zone_id', 'zone_name'),
      ('kcn_survey_voice_notes', 'zone_id', 'zone_name'), ('kcn_survey_areas', 'zone_id', NULL),
      ('kcn_survey_stars', 'zone_id', 'zone_name'), ('kcn_survey_lodgings', 'zone_id', 'zone_name'),
      ('kcn_survey_plan_stops', 'zone_id', 'zone_name'), ('map_panoramas', 'zone_id', 'zone_name'),
      ('kcn_visits', 'zone_id', NULL), ('cost_plans', 'zone_id', 'zone_name'),
      ('quote_requests', 'kcn_zone_id', 'kcn_name'), ('region_price_comparisons', 'kcn_zone_id', 'kcn_name'),
      ('labor_source_batches', 'zone_id', NULL)
    ) v(tbl, idc, namec)
  LOOP
    BEGIN
      IF r.namec IS NOT NULL AND _mzm_has(r.tbl, r.namec) THEN
        n := _mzm_apply(mid, r.tbl, ARRAY['id'], ARRAY[r.idc, r.namec], format('%I = %L::uuid', r.idc, fid),
               format('%I = %L::uuid, %I = %L', r.idc, iid, r.namec, t.name));
      ELSE
        n := _mzm_apply(mid, r.tbl, ARRAY['id'], ARRAY[r.idc], format('%I = %L::uuid', r.idc, fid), format('%I = %L::uuid', r.idc, iid));
      END IF;
      IF n > 0 THEN cnt := cnt || jsonb_build_object(r.tbl || '.' || r.idc, n); END IF;
    EXCEPTION WHEN unique_violation THEN
      -- KCN giữ lại đã có bản riêng (VD 1 vùng khoanh / 1 bảng so sánh giá mỗi KCN) → giữ nguyên bản của KCN cũ, chỉ báo lại
      cnt := cnt || jsonb_build_object(r.tbl || '.' || r.idc, 'trùng — giữ nguyên');
    END;
  END LOOP;

  -- Khoá sao công ty dạng "…@<mã KCN>"
  BEGIN
    n := _mzm_apply(mid, 'kcn_survey_stars', ARRAY['id'], ARRAY['company_key'], format('company_key LIKE %L', '%@' || fid), format('company_key = replace(company_key, %L, %L)', fid, iid));
    IF n > 0 THEN cnt := cnt || jsonb_build_object('kcn_survey_stars.company_key', n); END IF;
  EXCEPTION WHEN unique_violation THEN cnt := cnt || jsonb_build_object('kcn_survey_stars.company_key', 'trùng — giữ nguyên');
  END;

  -- (b) Mảng mã KCN (uuid[])
  FOR r IN SELECT * FROM (VALUES ('kcn_survey_shares', 'zone_ids'), ('crm_pipeline', 'zone_ids'), ('contacts', 'sale_zone_ids')) v(tbl, col) LOOP
    n := _mzm_apply(mid, r.tbl, ARRAY['id'], ARRAY[r.col], format('%I @> ARRAY[%L]::uuid[]', r.col, fid), format('%I = %s', r.col, _mzm_arr_replace(r.col, fid, iid, 'uuid[]')));
    IF n > 0 THEN cnt := cnt || jsonb_build_object(r.tbl || '.' || r.col, n); END IF;
  END LOOP;

  -- (c) Ghim nhà máy theo KCN trên Pipeline: zone_sites { "<mã KCN>": {...} } — KCN giữ lại đã có ghim thì giữ ghim đó
  n := _mzm_apply(mid, 'crm_pipeline', ARRAY['id'], ARRAY['zone_sites'], format('zone_sites ? %L', fid),
         format('zone_sites = (zone_sites - %1$L) || CASE WHEN zone_sites ? %2$L THEN ''{}''::jsonb ELSE jsonb_build_object(%2$L, zone_sites -> %1$L) END', fid, iid));
  IF n > 0 THEN cnt := cnt || jsonb_build_object('crm_pipeline.zone_sites', n); END IF;

  -- (d) Mảng TÊN KCN (text[])
  FOR r IN SELECT * FROM (VALUES ('clients', 'industrial_zones'), ('competitors', 'active_zones')) v(tbl, col) LOOP
    n := _mzm_apply(mid, r.tbl, ARRAY['id'], ARRAY[r.col], format('%I @> ARRAY[%L]::text[]', r.col, f.name), format('%I = %s', r.col, _mzm_arr_replace(r.col, f.name, t.name, 'text[]')));
    IF n > 0 THEN cnt := cnt || jsonb_build_object(r.tbl || '.' || r.col, n); END IF;
  END LOOP;

  -- (e) Cột TÊN KCN (text)
  FOR r IN SELECT * FROM (VALUES ('crm_pipeline', 'region'), ('competitors', 'zone_name'), ('recruit_sites', 'zone_name'),
      ('market_surveys', 'zone_name'), ('market_leads', 'region'), ('clients', 'region'), ('competitor_clients', 'kcn')) v(tbl, col) LOOP
    n := _mzm_apply(mid, r.tbl, ARRAY['id'], ARRAY[r.col], format('%I = %L', r.col, f.name), format('%I = %L', r.col, t.name));
    IF n > 0 THEN cnt := cnt || jsonb_build_object(r.tbl || '.' || r.col, n); END IF;
  END LOOP;

  -- (f) Bộ nhớ đường xe khách Nguồn LĐ tới KCN cũ (tính lại được) → lưu nguyên dòng vào nhật ký rồi xoá
  IF to_regclass('public.labor_source_routes') IS NOT NULL THEN
    INSERT INTO market_zone_merge_log (merge_id, tbl, action, pk, old)
      SELECT mid, 'labor_source_routes', 'delete', jsonb_build_object('source_id', source_id, 'target_type', target_type, 'target_id', target_id), to_jsonb(x)
      FROM labor_source_routes x WHERE target_type = 'zone' AND target_id = p_from;
    DELETE FROM labor_source_routes WHERE target_type = 'zone' AND target_id = p_from;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN cnt := cnt || jsonb_build_object('labor_source_routes (xoá bộ nhớ)', n); END IF;
  END IF;

  -- (g) Tên cũ → KCN giữ lại; rồi xoá dòng KCN cũ (đã lưu nguyên trong market_zone_merges.from_row)
  INSERT INTO market_zone_aliases (key, zone_id, label) VALUES (market_zone_key(f.name), t.id, f.name)
    ON CONFLICT (key) DO UPDATE SET zone_id = EXCLUDED.zone_id, label = EXCLUDED.label;
  DELETE FROM market_zones WHERE id = p_from;

  UPDATE market_zone_merges SET counts = cnt WHERE id = mid;
  RETURN jsonb_build_object('merge_id', mid, 'from', f.name, 'into', t.name, 'counts', cnt);
END $$;

-- ═════════════════════════ HOÀN TÁC ═════════════════════════
-- Trả KCN cũ về danh mục + đặt lại đúng giá trị cũ của từng ô đã đổi. Ô nào bị sửa tiếp SAU khi gộp sẽ bị ghi đè về giá trị lúc gộp.
CREATE OR REPLACE FUNCTION market_zone_merge_undo(p_merge uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  m market_zone_merges%ROWTYPE;
  l market_zone_merge_log%ROWTYPE;
  cols text;
  cond text;
  n int := 0;
BEGIN
  SELECT * INTO m FROM market_zone_merges WHERE id = p_merge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không có lần gộp %', p_merge; END IF;
  IF m.undone_at IS NOT NULL THEN RAISE EXCEPTION 'Lần gộp này đã hoàn tác lúc %', m.undone_at; END IF;
  -- Lần gộp SAU đã sửa cùng dòng → hoàn tác lần đó trước, kẻo đè mất kết quả của nó
  IF EXISTS (
    SELECT 1 FROM market_zone_merge_log a
    JOIN market_zone_merge_log b ON b.tbl = a.tbl AND b.pk = a.pk AND b.merge_id <> a.merge_id
    JOIN market_zone_merges m2 ON m2.id = b.merge_id
    WHERE a.merge_id = p_merge AND m2.seq > m.seq AND m2.undone_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Có lần gộp mới hơn cũng sửa cùng dữ liệu — hoàn tác các lần gộp mới hơn trước (xem cuối file 224)';
  END IF;
  DELETE FROM market_zone_aliases WHERE key = market_zone_key(m.from_name) AND zone_id = m.into_zone;
  INSERT INTO market_zones SELECT * FROM jsonb_populate_record(NULL::market_zones, m.from_row) ON CONFLICT (id) DO NOTHING;
  FOR l IN SELECT * FROM market_zone_merge_log WHERE merge_id = p_merge ORDER BY id DESC LOOP
    IF to_regclass('public.' || quote_ident(l.tbl)) IS NULL THEN CONTINUE; END IF;
    IF l.action = 'delete' THEN
      EXECUTE format('INSERT INTO %1$I SELECT * FROM jsonb_populate_record(NULL::%1$I, $1) ON CONFLICT DO NOTHING', l.tbl) USING l.old;
    ELSE
      SELECT string_agg(format('%I', k), ', ') INTO cols FROM jsonb_object_keys(l.old) k;
      SELECT string_agg(format('%1$I = (SELECT %1$I FROM jsonb_populate_record(NULL::%2$I, $2))', k, l.tbl), ' AND ') INTO cond FROM jsonb_object_keys(l.pk) k;
      EXECUTE format('UPDATE %1$I SET (%2$s) = (SELECT %2$s FROM jsonb_populate_record(NULL::%1$I, $1)) WHERE %3$s', l.tbl, cols, cond) USING l.old, l.pk;
    END IF;
    n := n + 1;
  END LOOP;
  UPDATE market_zone_merges SET undone_at = now() WHERE id = p_merge;
  RETURN jsonb_build_object('restored_zone', m.from_name, 'cells', n);
END $$;

REVOKE ALL ON FUNCTION market_zone_merge(uuid, uuid), market_zone_merge_undo(uuid), _mzm_apply(uuid, text, text[], text[], text, text) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════ GỘP NHƠN TRẠCH ═════════════════════════
DO $$
DECLARE
  main_id uuid;
  sub record;
  res jsonb;
BEGIN
  -- KCN giữ lại: đúng tên "KCN Nhơn Trạch" (không số)
  SELECT id INTO main_id FROM market_zones WHERE market_zone_key(name) = 'nhon trach' ORDER BY created_at LIMIT 1;
  IF main_id IS NULL THEN RAISE NOTICE 'Không thấy "KCN Nhơn Trạch" — bỏ qua phần gộp'; RETURN; END IF;
  FOR sub IN SELECT id, name FROM market_zones WHERE market_zone_key(name) ~ '^nhon trach [0-9]' AND id <> main_id LOOP
    res := market_zone_merge(sub.id, main_id);
    RAISE NOTICE 'Đã gộp: %', res;
  END LOOP;
  -- Tên Nhơn Trạch 1–6 (cả "Nhơn Trạch 2 – Lộc Khang", "Nhơn Trạch 2 – Nhơn Phú"…) đều là KCN Nhơn Trạch
  INSERT INTO market_zone_aliases (key, zone_id, label)
    SELECT 'nhon trach ' || g, main_id, 'KCN Nhơn Trạch ' || g FROM generate_series(1, 6) g
    ON CONFLICT (key) DO NOTHING;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy ──
-- SELECT name FROM market_zones WHERE name ILIKE '%nhơn trạch%';            -- mong đợi: chỉ còn "KCN Nhơn Trạch"
-- SELECT from_name, into_name, counts, merged_at FROM market_zone_merges ORDER BY merged_at;
-- SELECT * FROM market_zone_aliases ORDER BY key;                           -- nhon trach 1 … 6

-- ── Hoàn tác (tách lại) — đi từ lần gộp mới nhất về cũ nhất ──
-- 1 lần (được khi không có lần gộp mới hơn sửa cùng dữ liệu):
--   SELECT market_zone_merge_undo(id) FROM market_zone_merges WHERE from_name = 'KCN Nhơn Trạch 3' AND undone_at IS NULL;
-- Cả 3 KCN Nhơn Trạch:
--   DO $$ DECLARE x record; BEGIN
--     FOR x IN SELECT id FROM market_zone_merges WHERE into_name = 'KCN Nhơn Trạch' AND undone_at IS NULL ORDER BY seq DESC LOOP
--       PERFORM market_zone_merge_undo(x.id);
--     END LOOP;
--     DELETE FROM market_zone_aliases WHERE key ~ '^nhon trach [0-9]';
--   END $$;

-- ── Gộp KCN khác về sau (VD trùng tên) ──
-- SELECT market_zone_merge('<mã KCN gộp đi>', '<mã KCN giữ lại>');
