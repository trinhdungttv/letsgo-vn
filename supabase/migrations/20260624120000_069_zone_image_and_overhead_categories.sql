ALTER TABLE branch_zones ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE branch_zones ADD COLUMN IF NOT EXISTS image_fit TEXT DEFAULT 'cover';
ALTER TABLE branch_zones ADD COLUMN IF NOT EXISTS image_position TEXT DEFAULT '50% 50%';

CREATE TABLE IF NOT EXISTS overhead_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO overhead_categories (label, sort_order) VALUES
  ('Thuê văn phòng', 0),
  ('Điện & nước', 1),
  ('Internet', 2),
  ('Văn phòng phẩm', 3)
ON CONFLICT (label) DO NOTHING;
