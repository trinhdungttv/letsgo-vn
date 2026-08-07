-- ─────────────────────────────────────────────────────────────────────────────
-- 134 — Ngày ngưng hợp tác (mốc nghiệp vụ, tách khỏi thời điểm bấm nút)
--
-- Bối cảnh:
--   clients.suspended_at (TIMESTAMPTZ) đang ghi THỜI ĐIỂM BẤM NÚT ngưng — đó là
--   dấu vết thao tác, không phải mốc nghiệp vụ. Thực tế khách hàng có thể ngưng
--   từ 30/06 nhưng đến 15/07 mới có người vào hệ thống bấm ngưng.
--
--   Vì vậy thêm cột suspended_from (DATE) = NGÀY NGƯNG HỢP TÁC THẬT, do người
--   dùng nhập. Toàn bộ logic theo tháng (P&L Dự án, nhập số lao động, timeline
--   tài chính, báo cáo) dựa trên cột này:
--     • Tháng CHỨA ngày ngưng vẫn nhập liệu bình thường
--       (vd ngưng 30/06/2026 → tháng 06/2026 vẫn nhập P&L + số LĐ được).
--     • Từ tháng kế tiếp trở đi mới coi là đã ngưng.
--
-- An toàn: chỉ THÊM cột, backfill từ dữ liệu sẵn có. Không xoá/ghi đè cột nào.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clients ADD COLUMN IF NOT EXISTS suspended_from DATE;

COMMENT ON COLUMN clients.suspended_from IS
  'Ngày ngưng hợp tác thật (mốc nghiệp vụ). Tháng chứa ngày này vẫn được nhập P&L và số lao động; từ tháng sau mới coi là đã ngưng. Khác suspended_at — đó là thời điểm thao tác trên hệ thống.';

-- Backfill: khách đã ngưng trước đây lấy tạm ngày bấm nút làm ngày ngưng.
UPDATE clients
   SET suspended_from = (suspended_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 WHERE cooperation_status = 'suspended'
   AND suspended_from IS NULL
   AND suspended_at IS NOT NULL;

-- Lọc theo trạng thái + mốc ngưng (danh sách khách hàng, báo cáo theo tháng).
CREATE INDEX IF NOT EXISTS idx_clients_suspended_from
  ON clients (cooperation_status, suspended_from);

-- Yêu cầu ngưng do nhân viên gửi cũng phải mang theo ngày ngưng, để khi Quản trị
-- viên duyệt thì áp đúng mốc người gửi chọn (không lấy ngày bấm duyệt).
ALTER TABLE cooperation_suspension_requests
  ADD COLUMN IF NOT EXISTS suspended_from DATE;

COMMENT ON COLUMN cooperation_suspension_requests.suspended_from IS
  'Ngày ngưng hợp tác do người gửi yêu cầu chọn; khi duyệt sẽ ghi vào clients.suspended_from.';
