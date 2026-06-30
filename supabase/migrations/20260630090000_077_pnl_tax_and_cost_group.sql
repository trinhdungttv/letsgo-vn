-- Add cost category grouping (Lương/BHXH vs Chi phí chung) and per-client TNDN tax settings.
alter table cost_categories
  add column if not exists group_type text not null default 'general' check (group_type in ('salary', 'general'));

alter table pnl_split_settings
  add column if not exists tax_pct numeric not null default 20,
  add column if not exists tax_exempt boolean not null default false;
