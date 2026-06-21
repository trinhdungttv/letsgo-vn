-- Module: Quan ly Khoan Vay — 8 bang chinh
-- Chay thu cong trong Supabase SQL Editor

-- 1. loans: Ho so khoan vay
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,                           -- ten ngan gon: "Lo B1", "Nha 40"...
  bank_name TEXT NOT NULL,                       -- ten ngan hang / nguon vay
  borrower_name TEXT NOT NULL,                   -- nguoi dung ten vay
  borrower_type TEXT NOT NULL DEFAULT 'bank'     -- 'bank' | 'proxy' | 'personal'
    CHECK (borrower_type IN ('bank','proxy','personal')),
  collateral TEXT,                               -- tai san dam bao (ten so do)
  principal NUMERIC(15,0) NOT NULL DEFAULT 0,    -- du no goc (VND)
  interest_rate NUMERIC(6,4) NOT NULL DEFAULT 0, -- lai suat %/nam (vd 9.50)
  rate_type TEXT NOT NULL DEFAULT 'floating'      -- 'fixed' | 'floating'
    CHECK (rate_type IN ('fixed','floating')),
  base_rate NUMERIC(6,4),                         -- lai suat co so (floating)
  margin NUMERIC(6,4),                            -- bien do (floating)
  repayment_type TEXT NOT NULL DEFAULT 'interest_only'
    CHECK (repayment_type IN ('interest_only','reducing','emi')),
  term_months INT,                                -- ky han (thang)
  payment_day INT CHECK (payment_day BETWEEN 1 AND 31), -- ngay dong lai hang thang
  disbursement_date DATE,                         -- ngay giai ngan
  maturity_date DATE,                             -- ngay dao han
  proxy_account TEXT,                             -- TK nop tien (cho Bac Kiem)
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','closed','restructured')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_name);
CREATE INDEX IF NOT EXISTS idx_loans_maturity ON loans(maturity_date);

-- RLS: tat ca user truy cap (phan quyen o tang app)
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loans_all_anon" ON loans;
CREATE POLICY "loans_all_anon" ON loans FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "loans_all_auth" ON loans;
CREATE POLICY "loans_all_auth" ON loans FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 2. loan_rate_history: Lich su lai suat tha noi
CREATE TABLE IF NOT EXISTS loan_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  interest_rate NUMERIC(6,4) NOT NULL,
  base_rate NUMERIC(6,4),
  margin NUMERIC(6,4),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_rate_history_loan ON loan_rate_history(loan_id);

ALTER TABLE loan_rate_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loan_rate_history_all_anon" ON loan_rate_history;
CREATE POLICY "loan_rate_history_all_anon" ON loan_rate_history FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "loan_rate_history_all_auth" ON loan_rate_history;
CREATE POLICY "loan_rate_history_all_auth" ON loan_rate_history FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 3. loan_schedules: Lich tra no ly thuyet
CREATE TABLE IF NOT EXISTS loan_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  period INT NOT NULL,
  due_date DATE NOT NULL,
  principal_due NUMERIC(15,0) NOT NULL DEFAULT 0,
  interest_due NUMERIC(15,0) NOT NULL DEFAULT 0,
  is_estimated BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','overdue','skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_schedules_loan ON loan_schedules(loan_id);

ALTER TABLE loan_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loan_schedules_all_anon" ON loan_schedules;
CREATE POLICY "loan_schedules_all_anon" ON loan_schedules FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "loan_schedules_all_auth" ON loan_schedules;
CREATE POLICY "loan_schedules_all_auth" ON loan_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 4. monthly_confirmations: Xac nhan lai thuc hang thang (QUAN TRONG NHAT)
CREATE TABLE IF NOT EXISTS monthly_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  month TEXT NOT NULL,                              -- 'YYYY-MM'
  estimated_interest NUMERIC(15,0),                 -- lai uoc tinh (he thong tinh)
  confirmed_interest NUMERIC(15,0),                 -- lai thuc (NH xac nhan)
  buffer_amount NUMERIC(15,0) DEFAULT 0,            -- so tien du phong them
  amount_to_pay NUMERIC(15,0),                      -- tong can nop = confirmed + buffer
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','paid','overdue')),
  paid_date DATE,
  paid_amount NUMERIC(15,0),
  cic_risk BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(loan_id, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_conf_loan ON monthly_confirmations(loan_id);
CREATE INDEX IF NOT EXISTS idx_monthly_conf_month ON monthly_confirmations(month);

ALTER TABLE monthly_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "monthly_confirmations_all_anon" ON monthly_confirmations;
CREATE POLICY "monthly_confirmations_all_anon" ON monthly_confirmations FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "monthly_confirmations_all_auth" ON monthly_confirmations;
CREATE POLICY "monthly_confirmations_all_auth" ON monthly_confirmations FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 5. payment_history: Lich su dong tien thuc
CREATE TABLE IF NOT EXISTS payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  paid_date DATE NOT NULL,
  amount NUMERIC(15,0) NOT NULL DEFAULT 0,
  principal_paid NUMERIC(15,0) NOT NULL DEFAULT 0,
  interest_paid NUMERIC(15,0) NOT NULL DEFAULT 0,
  fee_paid NUMERIC(15,0) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_history_loan ON payment_history(loan_id);

ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_history_all_anon" ON payment_history;
CREATE POLICY "payment_history_all_anon" ON payment_history FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "payment_history_all_auth" ON payment_history;
CREATE POLICY "payment_history_all_auth" ON payment_history FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 6. loan_renewals: Dao han tai vay
CREATE TABLE IF NOT EXISTS loan_renewals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  new_loan_id UUID REFERENCES loans(id),
  contacted_date DATE,
  approval_date DATE,
  renewal_date DATE,
  new_principal NUMERIC(15,0),
  new_rate NUMERIC(6,4),
  new_term_months INT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','contacted','approved','completed','rejected')),
  checklist JSONB DEFAULT '[]'::jsonb,
  worst_case_note TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_renewals_loan ON loan_renewals(loan_id);

ALTER TABLE loan_renewals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loan_renewals_all_anon" ON loan_renewals;
CREATE POLICY "loan_renewals_all_anon" ON loan_renewals FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "loan_renewals_all_auth" ON loan_renewals;
CREATE POLICY "loan_renewals_all_auth" ON loan_renewals FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 7. proxy_ledger: So doi soat Bac Kiem (vay ho)
CREATE TABLE IF NOT EXISTS proxy_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID REFERENCES loans(id) ON DELETE SET NULL,
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('deposit','interest','adjustment','carry_forward')),
  amount NUMERIC(15,0) NOT NULL DEFAULT 0,
  running_balance NUMERIC(15,0) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proxy_ledger_date ON proxy_ledger(entry_date);

ALTER TABLE proxy_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "proxy_ledger_all_anon" ON proxy_ledger;
CREATE POLICY "proxy_ledger_all_anon" ON proxy_ledger FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proxy_ledger_all_auth" ON proxy_ledger;
CREATE POLICY "proxy_ledger_all_auth" ON proxy_ledger FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 8. loan_audit_log: Nhat ky thao tac (rieng module vay, bat buoc cho du lieu tai chinh)
CREATE TABLE IF NOT EXISTS loan_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  before_data JSONB,
  after_data JSONB,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_audit_log_table ON loan_audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_loan_audit_log_created ON loan_audit_log(created_at);

ALTER TABLE loan_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loan_audit_log_all_anon" ON loan_audit_log;
CREATE POLICY "loan_audit_log_all_anon" ON loan_audit_log FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "loan_audit_log_all_auth" ON loan_audit_log;
CREATE POLICY "loan_audit_log_all_auth" ON loan_audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 9. Phan quyen: chi admin duoc xem module Khoan vay
INSERT INTO role_permissions (role, module, level, updated_at)
VALUES ('admin', 'Khoan vay', 'full', now())
ON CONFLICT (role, module) DO NOTHING;
