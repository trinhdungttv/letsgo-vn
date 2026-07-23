-- Đối thủ: Giám đốc + các link mạng xã hội (mở nhanh bằng nút, không hiển thị link dài)
alter table competitors add column if not exists director text;
alter table competitors add column if not exists website_url text;
alter table competitors add column if not exists facebook_url text;
alter table competitors add column if not exists tiktok_url text;
alter table competitors add column if not exists social_other_url text;
