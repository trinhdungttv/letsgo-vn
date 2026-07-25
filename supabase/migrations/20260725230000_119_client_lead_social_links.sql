-- Link kênh online (Website/Facebook/YouTube/TikTok) cho Khách hàng & Công ty/Dự án thị trường —
-- BD tiện bấm xem hoạt động của công ty trước khi gặp khách.
alter table clients add column if not exists website_url text;
alter table clients add column if not exists facebook_url text;
alter table clients add column if not exists youtube_url text;
alter table clients add column if not exists tiktok_url text;

alter table market_leads add column if not exists website_url text;
alter table market_leads add column if not exists facebook_url text;
alter table market_leads add column if not exists youtube_url text;
alter table market_leads add column if not exists tiktok_url text;
