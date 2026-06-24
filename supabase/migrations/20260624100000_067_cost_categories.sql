CREATE TABLE IF NOT EXISTS cost_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO cost_categories (label, sort_order) VALUES
  ('Luong co ban NLD', 0),
  ('Chi phi quan ly', 1)
ON CONFLICT (label) DO NOTHING;
