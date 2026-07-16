-- Migration 093: Chuẩn hoá tuần lao động về TUẦN LỊCH THẬT (Thứ 2 → CN).
--
-- Quy tắc mới (đã chốt với Tony 16/07/2026):
--   - Tuần chạy Thứ 2 → CN, được phép vắt qua 2 tháng (ví dụ 29/6–4/7).
--   - Tuần thuộc THÁNG CHỨA NGÀY THỨ 5 (chuẩn ISO — tháng chiếm đa số ngày làm việc).
--   - Nhãn giữ format TmWn. Quy tắc cũ cắt tháng theo ngày (1-7, 8-14, ...) nên
--     sinh tuần cụt cuối tháng; migration này map mỗi bản ghi cũ sang tuần thật.
--
-- AN TOÀN DỮ LIỆU:
--   - Bước 1 tạo bảng backup client_labor_history_backup_093 (bản sao đầy đủ).
--   - Bước 3 CÓ XOÁ bản ghi: khi 2+ nhãn cũ dồn về cùng 1 tuần mới (ví dụ T6W5 cũ
--     29-30/6 và T7W1 cũ 1-7/7 đều thành T7W1 mới) thì GIỮ BẢN GHI MỚI NHẤT
--     (created_at lớn nhất), xoá bản cũ hơn — đây là các bản ghi trùng tuần.
--   - Rollback: TRUNCATE client_labor_history; INSERT INTO client_labor_history
--     SELECT * FROM client_labor_history_backup_093;

-- 1. Backup toàn bộ trước khi đụng dữ liệu.
CREATE TABLE IF NOT EXISTS client_labor_history_backup_093 AS
SELECT * FROM client_labor_history;

-- 2. Tính nhãn tuần mới cho từng bản ghi.
--    Năm suy từ created_at (nhãn cũ không có năm); riêng nhãn T12 nhập vào tháng 1
--    thì thuộc năm trước.
CREATE TEMP TABLE _labor_remap AS
WITH parsed AS (
  SELECT id, client_id, created_at,
    split_part(substring(week_label from 2), 'W', 1)::int AS m,
    split_part(week_label, 'W', 2)::int AS w,
    CASE WHEN split_part(substring(week_label from 2), 'W', 1)::int = 12
              AND extract(month from created_at)::int = 1
         THEN extract(year from created_at)::int - 1
         ELSE extract(year from created_at)::int
    END AS y
  FROM client_labor_history
  WHERE week_label ~ '^T\d+W\d+$'
),
mid AS (
  -- Ngày đại diện = ngày giữa của khoảng tuần cũ ((w-1)*7+4), kẹp trong tháng.
  SELECT id, client_id, created_at,
    make_date(y, m, LEAST(
      (w - 1) * 7 + 4,
      extract(day from (make_date(y, m, 1) + interval '1 month' - interval '1 day'))::int
    )) AS mid_date
  FROM parsed
),
thu AS (
  -- Thứ 5 của tuần lịch thật chứa ngày đại diện (isodow: Thứ 2=1 ... CN=7).
  SELECT id, client_id, created_at,
    (mid_date - (extract(isodow from mid_date)::int - 1) + 3) AS thu_date
  FROM mid
)
SELECT id, client_id, created_at,
  'T' || extract(month from thu_date)::int || 'W' || (
    (extract(day from thu_date)::int
      - extract(day from (
          date_trunc('month', thu_date)::date
          + ((4 - extract(isodow from date_trunc('month', thu_date)::date)::int + 7) % 7)
        ))::int
    ) / 7 + 1
  ) AS new_label
FROM thu;

-- 3. Xoá bản ghi cũ hơn khi nhiều nhãn cũ dồn về cùng 1 tuần mới (giữ bản mới nhất).
DELETE FROM client_labor_history
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY client_id, new_label ORDER BY created_at DESC
    ) AS rn
    FROM _labor_remap
  ) t
  WHERE rn > 1
);

-- 4. Cập nhật nhãn tuần mới cho các bản ghi còn lại.
UPDATE client_labor_history h
SET week_label = r.new_label
FROM _labor_remap r
WHERE h.id = r.id;

DROP TABLE _labor_remap;
