-- Default payer (LGV/CN/Chung) per cost category, applied when a category is added to a project.
alter table cost_categories
  add column if not exists default_payer text not null default 'lg' check (default_payer in ('lg', 'cn', 'ch'));
