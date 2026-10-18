-- 165 — Văn phòng Orient: Vận hành (phòng, hợp đồng, chỉ số điện, hoá đơn, tài sản, sự cố/bảo trì)
-- Chạy tay trong Supabase → SQL Editor, SAU migration 164. Chạy lại nhiều lần vẫn an toàn.
-- Chỉ thêm bảng/cột mới cho các bảng bds_* của module; không đụng bảng nào khác.
-- Mọi bảng mới: RLS chỉ admin (bds_is_admin), không khoá ngoại sang module khác.

SET search_path = public, extensions;

-- ── 1) Cài đặt vận hành ───────────────────────────────────────────────────
ALTER TABLE bds_settings ADD COLUMN IF NOT EXISTS electricity_unit_price numeric(18,2) NOT NULL DEFAULT 3500 CHECK (electricity_unit_price >= 0);
ALTER TABLE bds_settings ADD COLUMN IF NOT EXISTS invoice_due_day int NOT NULL DEFAULT 10 CHECK (invoice_due_day BETWEEN 1 AND 28);
ALTER TABLE bds_settings ADD COLUMN IF NOT EXISTS invoice_footer text;
ALTER TABLE bds_settings ADD COLUMN IF NOT EXISTS alert_days int NOT NULL DEFAULT 60 CHECK (alert_days BETWEEN 1 AND 365);

-- ── 2) Phòng (chia nhỏ từ mặt bằng gốc) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS bds_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL CHECK (btrim(code) <> ''),
  name          text,
  area_m2       numeric(10,2) NULL CHECK (area_m2 IS NULL OR area_m2 >= 0),
  head_lease_id uuid NULL REFERENCES bds_head_leases(id) ON DELETE SET NULL,
  location      text,
  status        text NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'reserved', 'occupied')),
  list_price    numeric(18,2) NULL CHECK (list_price IS NULL OR list_price >= 0),
  list_currency text NOT NULL DEFAULT 'VND' CHECK (list_currency IN ('VND', 'USD')),
  sort_order    int NOT NULL DEFAULT 0,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bds_rooms_code_uq ON bds_rooms (lower(btrim(code)));
CREATE INDEX IF NOT EXISTS bds_rooms_head_lease_idx ON bds_rooms (head_lease_id);

-- ── 3) Hợp đồng khách thuê (cột trên bds_tenants) ─────────────────────────
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS room_id uuid NULL REFERENCES bds_rooms(id) ON DELETE SET NULL;
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS contract_code text;
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS contract_start date;
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS contract_end date;
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS deposit_amount numeric(18,2) CHECK (deposit_amount IS NULL OR deposit_amount >= 0);
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS deposit_currency text NOT NULL DEFAULT 'VND' CHECK (deposit_currency IN ('VND', 'USD'));
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE bds_tenants ADD COLUMN IF NOT EXISTS contact_phone text;
CREATE INDEX IF NOT EXISTS bds_tenants_room_idx ON bds_tenants (room_id);
CREATE INDEX IF NOT EXISTS bds_tenants_contract_end_idx ON bds_tenants (contract_end);

-- ── 4) Chỉ số điện (cầu nối duy nhất tới P&L: nút "Áp dụng" ghi bds_tenant_fees.electricity_amount) ─
CREATE TABLE IF NOT EXISTS bds_meter_readings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES bds_tenants(id) ON DELETE CASCADE,
  month        date NOT NULL CHECK (extract(day FROM month) = 1),
  prev_reading numeric(14,2) NOT NULL DEFAULT 0 CHECK (prev_reading >= 0),
  curr_reading numeric(14,2) NOT NULL DEFAULT 0 CHECK (curr_reading >= 0),
  unit_price   numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  applied_at   timestamptz NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, month)
);
CREATE INDEX IF NOT EXISTS bds_meter_readings_month_idx ON bds_meter_readings (month);

-- ── 5) Hoá đơn / đề nghị thanh toán — CHỈ lưu trạng thái; số tiền luôn tính từ rent + fees ─
CREATE TABLE IF NOT EXISTS bds_invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES bds_tenants(id) ON DELETE CASCADE,
  month       date NOT NULL CHECK (extract(day FROM month) = 1),
  invoice_no  text,
  status      text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  due_date    date,
  paid_at     date,
  paid_amount numeric(18,2) CHECK (paid_amount IS NULL OR paid_amount >= 0),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, month)
);
CREATE INDEX IF NOT EXISTS bds_invoices_month_idx ON bds_invoices (month);
CREATE INDEX IF NOT EXISTS bds_invoices_status_idx ON bds_invoices (status, due_date);

-- ── 6) Tài sản / thiết bị ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bds_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  room_id      uuid NULL REFERENCES bds_rooms(id) ON DELETE SET NULL,
  location     text,
  installed_on date,
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'repairing', 'maintenance', 'broken', 'retired')),
  drive_url    text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bds_assets_code_uq ON bds_assets (lower(btrim(code))) WHERE code IS NOT NULL AND btrim(code) <> '';
CREATE INDEX IF NOT EXISTS bds_assets_room_idx ON bds_assets (room_id);

-- ── 7) Sự cố / bảo trì (quy trình 5 bước) + nhật ký ──────────────────────
CREATE TABLE IF NOT EXISTS bds_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no        bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  title            text NOT NULL CHECK (btrim(title) <> ''),
  room_id          uuid NULL REFERENCES bds_rooms(id) ON DELETE SET NULL,
  asset_id         uuid NULL REFERENCES bds_assets(id) ON DELETE SET NULL,
  location         text,
  reported_by      text,
  reported_at      timestamptz NOT NULL DEFAULT now(),
  priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  step_done        int NOT NULL DEFAULT 0 CHECK (step_done BETWEEN 0 AND 5),
  responsibility   text NOT NULL DEFAULT 'undecided' CHECK (responsibility IN ('undecided', 'building', 'tenant')),
  estimated_cost   numeric(18,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  actual_cost      numeric(18,2) CHECK (actual_cost IS NULL OR actual_cost >= 0),
  cost_approved_at timestamptz,
  drive_url        text,
  closed_at        timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bds_tickets_status_idx ON bds_tickets (status);
CREATE INDEX IF NOT EXISTS bds_tickets_room_idx ON bds_tickets (room_id);
CREATE INDEX IF NOT EXISTS bds_tickets_asset_idx ON bds_tickets (asset_id);

CREATE TABLE IF NOT EXISTS bds_maintenance_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES bds_tickets(id) ON DELETE CASCADE,
  step       int NULL CHECK (step IS NULL OR step BETWEEN 1 AND 5),
  action     text NOT NULL,
  note       text,
  cost       numeric(18,2) CHECK (cost IS NULL OR cost >= 0),
  actor      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bds_maintenance_logs_ticket_idx ON bds_maintenance_logs (ticket_id);

-- ── 8) RLS admin-only + trigger updated_at ────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bds_rooms', 'bds_meter_readings', 'bds_invoices', 'bds_assets', 'bds_tickets', 'bds_maintenance_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO anon, authenticated USING ((SELECT bds_is_admin())) WITH CHECK ((SELECT bds_is_admin()))',
      t || '_admin_all', t
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || t || '_updated', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bds_touch_updated_at()',
      'trg_' || t || '_updated', t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
