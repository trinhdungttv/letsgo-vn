-- 139 — Sửa được "KH đang phục vụ" của đối thủ + ghi lại mốc cập nhật số LĐ
--
-- Gộp luôn cột sale_phone của migration 104: migration đó CHƯA từng chạy trên database
-- thật (kiểm tra 17/08/2026 → lỗi 42703 khi hỏi cột này), nên form "KH đang phục vụ"
-- trong hồ sơ đối thủ đang không thêm được dòng nào.
alter table competitor_clients add column if not exists sale_phone text;

-- Mốc cập nhật:
--  - updated_at         : lần sửa gần nhất của cả dòng
--  - workers_updated_at : RIÊNG cho số LĐ, để rê chuột vào con số là biết số liệu đó
--                         chốt từ bao giờ (số LĐ đối thủ thay đổi liên tục, biết số này
--                         cũ hay mới quan trọng hơn biết dòng bị sửa lúc nào).
alter table competitor_clients add column if not exists updated_at timestamptz default now();
alter table competitor_clients add column if not exists workers_updated_at timestamptz;

-- Dòng đã có từ trước: coi như số LĐ được chốt tại thời điểm tạo dòng.
update competitor_clients
set workers_updated_at = created_at
where workers_updated_at is null;
