-- Đối thủ: ảnh cover + "Khu vực hoạt động" (chọn nhiều KCN/tỉnh thành)
alter table competitors add column if not exists image_url text;
alter table competitors add column if not exists active_zones text[];

-- Phí sale (cộng tác viên) đối thủ trả hàng tháng, gắn theo từng KH đang phục vụ
alter table competitor_clients add column if not exists sale_name text;
alter table competitor_clients add column if not exists sale_fee numeric;
