-- ============================================================================
-- 176 — Báo cáo khảo sát KCN: ẢNH CHỤP đối thủ + Lương TT tại thời điểm khảo sát
-- ----------------------------------------------------------------------------
-- Form báo cáo (Workspace > KCN Grid, Thị trường > Hồ sơ KCN) nay tự điền sẵn:
--   • danh sách đối thủ đang hoạt động tại KCN (lấy từ Thị trường), có thể bỏ chọn / thêm đối thủ khác
--   • bảng Lương TT của KCN (lấy từ market_surveys), sửa số ngay trong báo cáo
-- Mỗi báo cáo giữ BẢN SAO của riêng nó nên khi dữ liệu Thị trường đổi, báo cáo cũ không đổi theo.
--
--   competitors_snapshot  jsonb  mảng [{ id, name, note, signals[], workers }]
--   wage_snapshot         jsonb  mảng [{ industry, unskilled_min/max, seasonal_min/max,
--                                        skilled_min/max (ĐỒNG), labor_availability,
--                                        survey_date, source: 'market'|'manual', edited? }]
-- NULL = báo cáo cũ lưu dạng văn bản tự do (vẫn xem bình thường); [] = đi khảo sát nhưng không có dòng nào.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN, cột cũ (competitor_note, wage_note…) giữ nguyên.
-- Chạy lại nhiều lần vẫn an toàn. App chạy được khi chưa chạy migration này: lúc lưu báo cáo, nếu
-- chưa có cột thì app tự gộp danh sách đối thủ + lương thành chữ vào 2 ô ghi chú cũ (không mất gì).
-- ============================================================================

ALTER TABLE kcn_visits
  ADD COLUMN IF NOT EXISTS competitors_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS wage_snapshot jsonb;

-- Bảng kcn_visits đã có trigger nhật ký (data_history); quét lại cho chắc để cột mới được theo dõi.
SELECT dh_attach_triggers();

-- ── ROLLBACK (mất ảnh chụp đối thủ + lương của các báo cáo đã lưu bằng form mới; ghi chú văn bản vẫn còn) ──
-- ALTER TABLE kcn_visits DROP COLUMN IF EXISTS competitors_snapshot, DROP COLUMN IF EXISTS wage_snapshot;
