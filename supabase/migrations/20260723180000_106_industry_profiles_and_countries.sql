-- Ngành nghề: hồ sơ chi tiết (tổng quan, chính sách/thay đổi, thuế, xu hướng) — dùng cho
-- mục "Ngành Nghề" mới trong Thị trường, cạnh menu "Khu vực".
alter table industries add column if not exists overview text;
alter table industries add column if not exists policy_notes text;
alter table industries add column if not exists tax_notes text;
alter table industries add column if not exists trend_notes text;
alter table industries add column if not exists updated_at timestamptz default now();

-- Quốc gia FDI — nguồn dữ liệu chung dùng cho "FDI từ quốc gia" ở tab Khu vực, theo đúng
-- mô hình bảng industries (migration 099) để mọi nơi chọn cùng 1 danh sách.
create table if not exists countries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);
alter table countries enable row level security;
create policy "countries_all_anon" on countries for all to anon using (true) with check (true);
create policy "countries_all_auth" on countries for all to authenticated using (true) with check (true);

insert into countries (name)
select distinct unnest(market_zones.countries) from market_zones where market_zones.countries is not null
on conflict (name) do nothing;
