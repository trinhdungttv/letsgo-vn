-- 163 — Ảnh bìa (cover 16:9) cho Công ty/Dự án ở Thị trường (market_leads).
-- Hồ sơ công ty mở từ CRM Pipeline lấy ảnh bìa + vị trí bản đồ theo đúng nguồn dữ liệu của
-- khối "Thị trường": công ty đã là Khách hàng → clients (cover_image_* từ migration 141,
-- map_link/lat/lng từ 094); chưa là Khách hàng → market_leads gắn crm_id (map_link/lat/lng
-- đã có từ 095, migration này chỉ thêm 4 cột ảnh bìa — cùng cơ chế lấp đầy/tự khớp + kéo vị trí).
-- Chỉ thêm cột, không xoá/sửa dữ liệu cũ.
alter table market_leads add column if not exists cover_image_url text;
alter table market_leads add column if not exists cover_image_fit text default 'cover';
alter table market_leads add column if not exists cover_image_pos_x numeric not null default 50;
alter table market_leads add column if not exists cover_image_pos_y numeric not null default 50;
