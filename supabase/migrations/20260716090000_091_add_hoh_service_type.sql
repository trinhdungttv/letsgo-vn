-- Migration 091: Thêm loại hình dịch vụ 'hoh' vào bảng clients.
-- HOH vận hành theo chu kỳ tháng giống 'leasing', chỉ khác nhãn hiển thị (badge HOH).
--
-- An toàn dữ liệu: lệnh này KHÔNG làm mất dữ liệu hiện có — chỉ nới rộng
-- CHECK constraint để chấp nhận thêm giá trị 'hoh'. Rollback: chạy lại
-- ADD CONSTRAINT với danh sách cũ ('leasing', 'recruitment') sau khi chắc chắn
-- không còn bản ghi nào mang giá trị 'hoh'.

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_service_type_check;

ALTER TABLE clients
  ADD CONSTRAINT clients_service_type_check
  CHECK (service_type IN ('leasing', 'recruitment', 'hoh'));
