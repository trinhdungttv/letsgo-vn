-- Hồ sơ ngành chuyên sâu: vị trí & lương, giữ chân LĐ, chỉ số theo quý, chuỗi giá trị.

-- ── Đợt 3: bản đồ vị trí tuyển dụng trong ngành ──
create table if not exists industry_positions (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid not null references industries(id) on delete cascade,
  position text not null,
  ratio_pct numeric,            -- % trên tổng quân số một nhà máy điển hình
  wage_min numeric,
  wage_max numeric,
  requirements text,            -- tuổi, giới tính, thị lực, chứng chỉ…
  difficulty smallint,          -- 1 = dễ tuyển … 5 = rất khó tuyển
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists industry_positions_industry_idx on industry_positions(industry_id);
alter table industry_positions enable row level security;
create policy "industry_positions_all_anon" on industry_positions for all to anon using (true) with check (true);
create policy "industry_positions_all_auth" on industry_positions for all to authenticated using (true) with check (true);

-- ── Đợt 4: hồ sơ giữ chân lao động (gắn thẳng vào industries, mỗi ngành 1 bộ) ──
alter table industries add column if not exists turnover_rate numeric;          -- %/tháng
alter table industries add column if not exists quit_stage text;                -- giai đoạn nghỉ nhiều nhất
alter table industries add column if not exists quit_reasons text[] default '{}';
alter table industries add column if not exists retention_actions text;         -- biện pháp đã dùng + kết quả

-- ── Đợt 6: chỉ số ngành theo quý ──
create table if not exists industry_metrics (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid not null references industries(id) on delete cascade,
  period text not null,                 -- '2026-Q3'
  avg_wage_unskilled numeric,
  avg_wage_skilled numeric,
  service_fee_min numeric,
  service_fee_max numeric,
  turnover_rate numeric,
  ot_hours numeric,
  demand_headcount int,
  note text,
  created_at timestamptz default now(),
  unique (industry_id, period)
);
create index if not exists industry_metrics_industry_idx on industry_metrics(industry_id);
alter table industry_metrics enable row level security;
create policy "industry_metrics_all_anon" on industry_metrics for all to anon using (true) with check (true);
create policy "industry_metrics_all_auth" on industry_metrics for all to authenticated using (true) with check (true);

-- ── Đợt 7: chuỗi giá trị — nhà máy trong ngành mua của ai, bán cho ai, phụ thuộc thị trường nào ──
create table if not exists industry_value_chain (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid not null references industries(id) on delete cascade,
  kind text not null,                   -- 'input' | 'customer' | 'market'
  name text not null,
  note text,
  created_at timestamptz default now()
);
create index if not exists industry_value_chain_industry_idx on industry_value_chain(industry_id);
alter table industry_value_chain enable row level security;
create policy "industry_value_chain_all_anon" on industry_value_chain for all to anon using (true) with check (true);
create policy "industry_value_chain_all_auth" on industry_value_chain for all to authenticated using (true) with check (true);
