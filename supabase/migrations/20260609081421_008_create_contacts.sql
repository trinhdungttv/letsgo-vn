CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  role text DEFAULT 'Khác',
  start_date date,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_client_id_idx ON contacts(client_id);
CREATE INDEX contacts_is_active_idx ON contacts(is_active);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_contacts" ON contacts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_contacts" ON contacts FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_contacts" ON contacts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_contacts" ON contacts FOR DELETE
  TO authenticated USING (true);
