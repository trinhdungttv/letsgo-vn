-- ============================================================================
-- 177 — Lương TT (market_surveys): thêm khoảng LƯƠNG CƠ BẢN 8H (đồng / ngày)
-- ----------------------------------------------------------------------------
-- Báo cáo khảo sát KCN nhập "Lương cơ bản 8h" (vd 260.000 – 280.000 đồng/ngày) và nay ghi sang Lương TT
-- của đúng KCN + ngành. Cần 2 cột này để Lương TT giữ được con số đó (mức căn cứ để sau này cảnh báo / gợi ý giá
-- trong Báo giá, Phương án giá).
--   wage_base_8h_min / wage_base_8h_max  NUMERIC  — ĐỒNG / NGÀY (khác các cột wage_* còn lại là đồng / tháng)
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN, dòng cũ để trống ở 2 cột mới.
-- Chạy lại nhiều lần vẫn an toàn. App chạy được khi chưa chạy migration này: lúc ghi báo cáo sang Lương TT nếu chưa có
-- cột thì app bỏ riêng ô lương 8h (các ô còn lại vẫn ghi) và báo rõ; lương 8h vẫn nằm trong báo cáo, bấm
-- "Ghi vào Lương TT" lại sau khi chạy migration là bổ sung được.
-- ============================================================================

ALTER TABLE market_surveys
  ADD COLUMN IF NOT EXISTS wage_base_8h_min NUMERIC,
  ADD COLUMN IF NOT EXISTS wage_base_8h_max NUMERIC;

SELECT dh_attach_triggers();

-- ── ROLLBACK (mất lương 8h đã ghi vào Lương TT; báo cáo khảo sát vẫn giữ số của nó) ──
-- ALTER TABLE market_surveys DROP COLUMN IF EXISTS wage_base_8h_min, DROP COLUMN IF EXISTS wage_base_8h_max;
