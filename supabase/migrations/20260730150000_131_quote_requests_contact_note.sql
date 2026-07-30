-- 131: "Tính bảng lương" (quote_requests) — thêm ghi chú người liên hệ (tên + SĐT đã liên
-- hệ để lấy báo giá NCC), không bắt buộc nhập, chỉ để tra lại sau. NCC cũng cho phép để
-- trống ("Chưa rõ NCC (điền sau)") khi chưa xác định được ai báo giá — supplier_name vốn
-- đã nullable từ migration 126 nên không cần đổi cột đó.
alter table quote_requests add column if not exists contact_note text;
