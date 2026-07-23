-- Thuật ngữ ngành — từ điển thuật ngữ dùng khi trao đổi với khách hàng.
-- industry_id NULL = thuật ngữ dùng chung cho mọi ngành (hiện ở mọi hồ sơ ngành).
create table if not exists industry_terms (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid references industries(id) on delete cascade,
  term text not null,
  aliases text[] default '{}',        -- viết tắt / tên tiếng Anh, Nhật, Trung
  category text,                      -- Sản xuất, Chất lượng, Nhân sự & LĐ, ...
  short_def text,                     -- định nghĩa 1 dòng
  detail text,                        -- giải thích kỹ + cách nói với khách
  example text,                       -- câu ví dụ dùng thực tế khi gặp khách
  pinned boolean default false,       -- ghim thuật ngữ hay dùng lên đầu
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists industry_terms_industry_idx on industry_terms(industry_id);

alter table industry_terms enable row level security;
create policy "industry_terms_all_anon" on industry_terms for all to anon using (true) with check (true);
create policy "industry_terms_all_auth" on industry_terms for all to authenticated using (true) with check (true);
