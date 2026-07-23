-- Ảnh cover cho Khu vực (KCN) trong Thị trường — dán link ảnh cổng KCN
alter table market_zones add column if not exists image_url text;
