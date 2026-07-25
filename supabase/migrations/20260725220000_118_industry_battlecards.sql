-- BD Battlecard & kịch bản tư vấn Sales theo ngành — điểm đau, vũ khí, lời thoại mẫu cho BD.
create table if not exists industry_battlecards (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid not null references industries(id) on delete cascade,
  pain_point text not null,       -- điểm đau / tình huống khách hàng
  our_weapon text not null,       -- vũ khí / solution của bên mình
  pitching_script text,           -- lời thoại mẫu cho BD
  category text,                  -- phân loại: Vụ mùa / Giữ chân LĐ / An toàn LĐ...
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists industry_battlecards_industry_idx on industry_battlecards(industry_id);
alter table industry_battlecards enable row level security;
create policy "industry_battlecards_all_anon" on industry_battlecards for all to anon using (true) with check (true);
create policy "industry_battlecards_all_auth" on industry_battlecards for all to authenticated using (true) with check (true);
