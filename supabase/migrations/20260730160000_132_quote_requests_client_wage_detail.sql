-- 132: "Tính bảng lương" — lưu thêm bảng lương KHÁCH TRẢ CHO TA, đối xứng với wage_detail
-- (ta/NCC trả NLĐ) vốn đã có từ migration 126. Có đủ 2 mặt mới so được lãi/lỗ từng khoản:
-- wage_detail = chi phí, wage_detail_client = doanh thu, chênh lệch = phần công ty giữ lại.
-- Cùng tên cột với clients.wage_detail_client / market_leads.wage_detail_client để thống nhất.
alter table quote_requests add column if not exists wage_detail_client jsonb;

comment on column quote_requests.wage_detail_client is
  'Đơn giá KHÁCH TRẢ CHO TA theo từng khoản (cùng bộ key với wage_detail). Người dùng gõ tay — luật chỉ chi phối phần trả NLĐ, không suy ra được số này.';
