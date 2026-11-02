-- ============================================================================
-- 192 — Khảo sát KCN: tiêu đề chuyến
-- ----------------------------------------------------------------------------
-- Bấm "Bắt đầu khảo sát" → app tự đặt tên "KCN Nhơn Trạch 3 – Khảo sát 03/11/2026" (đi lại cùng KCN trong ngày:
-- "… (lần 2)"; không gắn KCN: "Khảo sát 03/11/2026 08:15"). Sửa được ở màn tổng kết và Lịch sử khảo sát.
-- Chưa chạy migration này thì app vẫn chạy, chỉ là tên không được lưu (danh sách hiện tên KCN như cũ).
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN; các chuyến đã có được điền tên theo cùng quy tắc
-- (chỉ điền dòng đang để trống). Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

ALTER TABLE kcn_survey_trips ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';

-- Điền tên cho chuyến cũ (giờ Việt Nam), đánh "lần 2, lần 3…" theo thứ tự trong cùng KCN + ngày
WITH named AS (
  SELECT id,
    CASE WHEN btrim(zone_name) = ''
      THEN 'Khảo sát ' || to_char(started_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      ELSE zone_name || ' – Khảo sát ' || to_char(started_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')
        || CASE WHEN n > 1 THEN ' (lần ' || n || ')' ELSE '' END
    END AS t
  FROM (
    SELECT id, zone_name, started_at,
      row_number() OVER (PARTITION BY zone_id, (started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ORDER BY started_at) AS n
    FROM kcn_survey_trips
    WHERE deleted_at IS NULL
  ) x
)
UPDATE kcn_survey_trips k SET title = named.t
FROM named
WHERE k.id = named.id AND k.title = '';

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra (mong đợi: true · 0) ───────────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kcn_survey_trips' AND column_name = 'title') AS co_cot_tieu_de,
--   (SELECT count(*) FROM kcn_survey_trips WHERE deleted_at IS NULL AND title = '') AS chuyen_chua_co_ten;

-- ── ROLLBACK (mất các tên chuyến đã đặt / đã sửa) ──
-- ALTER TABLE kcn_survey_trips DROP COLUMN IF EXISTS title;
