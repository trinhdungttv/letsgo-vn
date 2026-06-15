-- morning_priorities hiện được dùng cho 2 mục đích:
--   1) "Ưu tiên buổi sáng" — 1 dòng mục tiêu/ngày của user
--   2) Ghi nhận "phiên trao đổi" với chi nhánh (target_name = 'Chi nhánh {region}')
--      — có thể có nhiều dòng/ngày (mỗi chi nhánh 1 dòng)
--
-- Constraint UNIQUE(user_id, priority_date) ban đầu (migration 044) chỉ phù hợp
-- với mục đích (1) và sẽ chặn việc lưu nhiều phiên chi nhánh trong cùng 1 ngày.
-- Đổi sang UNIQUE(user_id, priority_date, target_name) để cho phép nhiều dòng/ngày
-- khi target_name khác nhau, vẫn tránh trùng phiên cho cùng 1 chi nhánh/ngày.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'morning_priorities'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(attnum ORDER BY attnum)
        FROM unnest(con.conkey) AS attnum
      ) = (
        SELECT array_agg(attnum ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = rel.oid AND attname IN ('user_id', 'priority_date')
      )
  LOOP
    EXECUTE format('ALTER TABLE morning_priorities DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE morning_priorities
  ADD CONSTRAINT morning_priorities_user_date_target_key UNIQUE (user_id, priority_date, target_name);
