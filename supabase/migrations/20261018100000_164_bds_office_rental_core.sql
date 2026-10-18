-- 164 — Văn phòng Orient (office_rental): bảng lõi Tài chính / Lời-Lỗ
-- Chạy tay trong Supabase → SQL Editor. Chỉ TẠO MỚI, chạy lại nhiều lần vẫn an toàn (idempotent).
-- KHÔNG sửa/xoá bảng, policy hay hàm có sẵn. KHÔNG có khoá ngoại sang bảng của mảng cung ứng lao động.
--
-- Bảo mật: app đăng nhập bằng session token riêng (bảng app_sessions, migration 061), mọi request
-- REST đều là role `anon`. Module gửi token trong header `x-letsgo-token`; bds_is_admin() đọc header
-- đó và chỉ trả true khi token còn hạn của tài khoản role = 'admin'. Không có token admin → 0 dòng,
-- mọi lệnh ghi bị từ chối.

SET search_path = public, extensions;

-- ── 0) Hàm dùng chung ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bds_request_token()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_token text;
BEGIN
  BEGIN
    v_token := NULLIF(current_setting('request.headers', true), '')::json ->> 'x-letsgo-token';
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN NULLIF(v_token, '');
END;
$$;
REVOKE ALL ON FUNCTION bds_request_token() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION bds_is_admin()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_token text := bds_request_token();
BEGIN
  IF v_token IS NULL THEN RETURN false; END IF;
  RETURN COALESCE(session_role(v_token) = 'admin', false);
END;
$$;
GRANT EXECUTE ON FUNCTION bds_is_admin() TO anon, authenticated;

-- Cho giao diện biết vì sao không vào được: ok | no_token | expired | not_admin
CREATE OR REPLACE FUNCTION bds_access_check()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token text := bds_request_token();
  v_role  text;
BEGIN
  IF v_token IS NULL THEN RETURN 'no_token'; END IF;
  v_role := session_role(v_token);
  IF v_role IS NULL THEN RETURN 'expired'; END IF;
  IF v_role <> 'admin' THEN RETURN 'not_admin'; END IF;
  RETURN 'ok';
END;
$$;
GRANT EXECUTE ON FUNCTION bds_access_check() TO anon, authenticated;

CREATE OR REPLACE FUNCTION bds_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── 1) Cài đặt (1 dòng duy nhất) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bds_settings (
  id                       smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  exchange_rate            numeric(12,2) NOT NULL DEFAULT 26000   CHECK (exchange_rate > 0),
  vat_rate_rent            numeric(5,2)  NOT NULL DEFAULT 10      CHECK (vat_rate_rent BETWEEN 0 AND 100),
  vat_rate_util            numeric(5,2)  NOT NULL DEFAULT 8       CHECK (vat_rate_util BETWEEN 0 AND 100),
  parking_price_moto       numeric(18,2) NOT NULL DEFAULT 150000  CHECK (parking_price_moto >= 0),
  parking_price_car        numeric(18,2) NOT NULL DEFAULT 1500000 CHECK (parking_price_car >= 0),
  start_month              date          NOT NULL DEFAULT '2026-01-01' CHECK (extract(day FROM start_month) = 1),
  range_months             int           NOT NULL DEFAULT 24      CHECK (range_months IN (12, 18, 24, 36)),
  include_forecast_in_cost boolean       NOT NULL DEFAULT false,
  hide_empty_months        boolean       NOT NULL DEFAULT true,
  show_fee_panel           boolean       NOT NULL DEFAULT false,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now()
);
INSERT INTO bds_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── 2) Chi phí thuê đầu vào (head lease) + mốc tăng giá ───────────────────

CREATE TABLE IF NOT EXISTS bds_head_leases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord     text NOT NULL CHECK (landlord IN ('mbt', 'ts4')),
  name         text NOT NULL CHECK (btrim(name) <> ''),
  currency     text NOT NULL DEFAULT 'VND'  CHECK (currency IN ('VND', 'USD')),
  base_price   numeric(18,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  base_month   date NOT NULL DEFAULT '2026-01-01' CHECK (extract(day FROM base_month) = 1),
  end_month    date NULL CHECK (end_month IS NULL OR extract(day FROM end_month) = 1),
  vat_mode     text NOT NULL DEFAULT 'none' CHECK (vat_mode IN ('none', 'incl', 'excl')),
  vat_category text NOT NULL DEFAULT 'rent' CHECK (vat_category IN ('rent', 'util')),
  is_parking   boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bds_head_leases_name_uq ON bds_head_leases (landlord, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS bds_head_lease_increases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  head_lease_id   uuid NOT NULL REFERENCES bds_head_leases(id) ON DELETE CASCADE,
  effective_month date NOT NULL CHECK (extract(day FROM effective_month) = 1),
  percent         numeric(6,3) NOT NULL DEFAULT 0 CHECK (percent > -100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bds_head_lease_increases_lease_idx ON bds_head_lease_increases (head_lease_id);

-- ── 3) Khách thuê lại + doanh thu tháng + phụ phí điện/xe ─────────────────

CREATE TABLE IF NOT EXISTS bds_tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  currency      text NOT NULL DEFAULT 'VND'  CHECK (currency IN ('VND', 'USD')),
  vat_mode      text NOT NULL DEFAULT 'none' CHECK (vat_mode IN ('none', 'incl', 'excl')),
  head_lease_id uuid NULL REFERENCES bds_head_leases(id) ON DELETE SET NULL,
  area_m2       numeric(10,2) NULL CHECK (area_m2 IS NULL OR area_m2 >= 0),
  active        boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bds_tenants_name_uq ON bds_tenants (lower(btrim(name)));
CREATE INDEX IF NOT EXISTS bds_tenants_head_lease_idx ON bds_tenants (head_lease_id);

CREATE TABLE IF NOT EXISTS bds_tenant_rent (
  tenant_id  uuid NOT NULL REFERENCES bds_tenants(id) ON DELETE CASCADE,
  month      date NOT NULL CHECK (extract(day FROM month) = 1),
  amount     numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month)
);
CREATE INDEX IF NOT EXISTS bds_tenant_rent_month_idx ON bds_tenant_rent (month);

CREATE TABLE IF NOT EXISTS bds_tenant_fees (
  tenant_id          uuid NOT NULL REFERENCES bds_tenants(id) ON DELETE CASCADE,
  month              date NOT NULL CHECK (extract(day FROM month) = 1),
  electricity_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (electricity_amount >= 0),
  motorbike_count    int NOT NULL DEFAULT 0 CHECK (motorbike_count >= 0),
  car_count          int NOT NULL DEFAULT 0 CHECK (car_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month)
);
CREATE INDEX IF NOT EXISTS bds_tenant_fees_month_idx ON bds_tenant_fees (month);

-- ── 4) Chi phí vận hành ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bds_opex_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (btrim(name) <> ''),
  vat_mode     text NOT NULL DEFAULT 'none' CHECK (vat_mode IN ('none', 'incl', 'excl')),
  vat_category text NOT NULL DEFAULT 'rent' CHECK (vat_category IN ('rent', 'util')),
  sort_order   int NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bds_opex_categories_name_uq ON bds_opex_categories (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS bds_opex_monthly (
  category_id uuid NOT NULL REFERENCES bds_opex_categories(id) ON DELETE CASCADE,
  month       date NOT NULL CHECK (extract(day FROM month) = 1),
  amount      numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, month)
);
CREATE INDEX IF NOT EXISTS bds_opex_monthly_month_idx ON bds_opex_monthly (month);

-- ── 5) Dự đoán chi phí phát sinh ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bds_forecast_expenses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  month      date NOT NULL CHECK (extract(day FROM month) = 1),
  amount     numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bds_forecast_expenses_month_idx ON bds_forecast_expenses (month);

-- ── 6) Hòa vốn khi chia nhỏ mặt bằng (công cụ thử số, không ảnh hưởng P&L) ─

CREATE TABLE IF NOT EXISTS bds_breakeven_scenarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  head_lease_id   uuid NULL REFERENCES bds_head_leases(id) ON DELETE SET NULL,
  reference_month date NULL CHECK (reference_month IS NULL OR extract(day FROM reference_month) = 1),
  target_cost     numeric(18,2) NOT NULL DEFAULT 0 CHECK (target_cost >= 0),
  extra_cost      numeric(18,2) NOT NULL DEFAULT 0 CHECK (extra_cost >= 0),
  parent_area_m2  numeric(10,2) NULL CHECK (parent_area_m2 IS NULL OR parent_area_m2 >= 0),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bds_breakeven_rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES bds_breakeven_scenarios(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT '',
  area_m2     numeric(10,2) NOT NULL DEFAULT 0 CHECK (area_m2 >= 0),
  currency    text NOT NULL DEFAULT 'VND'  CHECK (currency IN ('VND', 'USD')),
  price       numeric(18,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  vat_mode    text NOT NULL DEFAULT 'none' CHECK (vat_mode IN ('none', 'incl', 'excl')),
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bds_breakeven_rooms_scenario_idx ON bds_breakeven_rooms (scenario_id);

-- Kịch bản mặc định "XHOME 778m²" (chỉ tạo khi chưa có kịch bản nào)
DO $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bds_breakeven_scenarios) THEN
    INSERT INTO bds_breakeven_scenarios (name, parent_area_m2, reference_month)
    VALUES ('XHOME 778m²', 778, '2026-01-01')
    RETURNING id INTO v_id;
    INSERT INTO bds_breakeven_rooms (scenario_id, name, area_m2, sort_order) VALUES
      (v_id, 'Phòng 1', 200, 1),
      (v_id, 'Phòng 2', 286, 2),
      (v_id, 'Phòng 3', 229, 3);
  END IF;
END $$;

-- ── 7) RLS admin-only + trigger updated_at cho MỌI bảng bds_* ở trên ──────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bds_settings', 'bds_head_leases', 'bds_head_lease_increases', 'bds_tenants',
    'bds_tenant_rent', 'bds_tenant_fees', 'bds_opex_categories', 'bds_opex_monthly',
    'bds_forecast_expenses', 'bds_breakeven_scenarios', 'bds_breakeven_rooms'
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

-- ── 8) Đăng ký quyền: chỉ admin thấy menu "Văn phòng Orient" ─────────────

INSERT INTO role_permissions (role, module, level, updated_at)
VALUES ('admin', 'Văn phòng Orient', 'full', now())
ON CONFLICT (role, module) DO NOTHING;

NOTIFY pgrst, 'reload schema';
