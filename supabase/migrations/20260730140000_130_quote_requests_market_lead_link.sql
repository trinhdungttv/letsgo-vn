-- 130: "Tính bảng lương" (quote_requests) — cho phép chọn "Công ty/Dự án đang tìm hiểu"
-- (market_leads), không chỉ khách hàng đã có sẵn (clients), làm nguồn lấy/đồng bộ bảng lương
-- NCC. Trước đây chỉ gắn được client_id — dữ liệu lương thu thập cho công ty CHƯA phải khách
-- hàng chính thức (còn ở dạng "đang tìm hiểu") không có chỗ lưu đúng, rơi mất liên kết.
alter table quote_requests add column if not exists market_lead_id uuid references market_leads(id) on delete set null;

CREATE INDEX IF NOT EXISTS idx_quote_requests_market_lead ON quote_requests(market_lead_id);
