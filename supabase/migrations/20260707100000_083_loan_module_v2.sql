-- 083 — Loan module v2 (07/07/2026): chay thu cong trong Supabase SQL Editor
-- 1) loans: an han goc (nam dau chi tra lai) + co giai ngan theo hoa don (khoan cong ty)
-- 2) loan_renewals: flow dao han thuc te — nop tien dao -> NH giai ngan lai (co the sang nguoi dung ten khac)
-- 3) loan_disbursements: theo doi giai ngan theo hoa don cho NCC
-- 4) RPC ghi cho cac bang (bang da khoa SELECT-only tu stage 3)

SET search_path = public, extensions;

-- ── 1. loans: cot moi ──
ALTER TABLE loans ADD COLUMN IF NOT EXISTS grace_months INT NOT NULL DEFAULT 0;       -- so thang an han goc (chi tra lai)
ALTER TABLE loans ADD COLUMN IF NOT EXISTS requires_invoice BOOLEAN NOT NULL DEFAULT false; -- giai ngan phai co hoa don (khoan cong ty)

-- ── 2. loan_renewals: flow dao han thuc te ──
ALTER TABLE loan_renewals ADD COLUMN IF NOT EXISTS deposit_date DATE;          -- ngay nop tien vao TK de dao
ALTER TABLE loan_renewals ADD COLUMN IF NOT EXISTS redisbursed_date DATE;      -- ngay NH giai ngan lai
ALTER TABLE loan_renewals ADD COLUMN IF NOT EXISTS new_borrower_name TEXT;     -- giai ngan sang nguoi dung ten moi (neu doi)

ALTER TABLE loan_renewals DROP CONSTRAINT IF EXISTS loan_renewals_status_check;
ALTER TABLE loan_renewals ADD CONSTRAINT loan_renewals_status_check
  CHECK (status IN ('pending','contacted','deposited','redisbursed','completed','rejected'));

-- ── 3. loan_disbursements: giai ngan theo hoa don (khoan cong ty) ──
CREATE TABLE IF NOT EXISTS loan_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  invoice_no TEXT,                                -- so hoa don cung cap cho NH
  supplier_name TEXT,                             -- ten nha cung cap nhan tien
  amount NUMERIC(15,0) NOT NULL DEFAULT 0,
  request_date DATE,                              -- ngay gui ho so/hoa don cho NH
  disbursed_date DATE,                            -- ngay NH giai ngan cho NCC
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','disbursed')),  -- cho hoa don / da gui NH / da giai ngan
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_disbursements_loan ON loan_disbursements(loan_id);

ALTER TABLE loan_disbursements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loan_disbursements_select_anon" ON loan_disbursements;
CREATE POLICY "loan_disbursements_select_anon" ON loan_disbursements FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "loan_disbursements_select_auth" ON loan_disbursements;
CREATE POLICY "loan_disbursements_select_auth" ON loan_disbursements FOR SELECT TO authenticated USING (true);

-- ── 4. admin_upsert_loan: them cot moi + tu ghi lich su lai suat khi doi rate ──
CREATE OR REPLACE FUNCTION admin_upsert_loan(
  p_token text, p_id uuid, p_data jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid; v_old_rate numeric;
BEGIN
  PERFORM require_admin(p_token);
  IF p_id IS NOT NULL THEN
    SELECT interest_rate INTO v_old_rate FROM loans WHERE id = p_id;
    UPDATE loans SET
      label = COALESCE(p_data->>'label', label),
      bank_name = COALESCE(p_data->>'bank_name', bank_name),
      borrower_name = COALESCE(p_data->>'borrower_name', borrower_name),
      borrower_type = COALESCE(p_data->>'borrower_type', borrower_type),
      collateral = p_data->>'collateral',
      principal = COALESCE((p_data->>'principal')::numeric, principal),
      interest_rate = COALESCE((p_data->>'interest_rate')::numeric, interest_rate),
      rate_type = COALESCE(p_data->>'rate_type', rate_type),
      base_rate = (p_data->>'base_rate')::numeric,
      margin = (p_data->>'margin')::numeric,
      repayment_type = COALESCE(p_data->>'repayment_type', repayment_type),
      term_months = (p_data->>'term_months')::int,
      payment_day = (p_data->>'payment_day')::int,
      disbursement_date = (p_data->>'disbursement_date')::date,
      maturity_date = (p_data->>'maturity_date')::date,
      proxy_account = p_data->>'proxy_account',
      status = COALESCE(p_data->>'status', status),
      notes = p_data->>'notes',
      grace_months = COALESCE((p_data->>'grace_months')::int, grace_months),
      requires_invoice = COALESCE((p_data->>'requires_invoice')::boolean, requires_invoice),
      updated_at = now()
    WHERE id = p_id;
    -- Doi lai suat -> KHONG de so cu, ghi dong lich su moi
    IF (p_data->>'interest_rate') IS NOT NULL
       AND (p_data->>'interest_rate')::numeric IS DISTINCT FROM v_old_rate THEN
      INSERT INTO loan_rate_history (loan_id, effective_date, interest_rate, base_rate, margin, note)
      VALUES (p_id, CURRENT_DATE, (p_data->>'interest_rate')::numeric,
              (p_data->>'base_rate')::numeric, (p_data->>'margin')::numeric,
              'Doi lai suat ' || COALESCE(v_old_rate::text,'?') || '% -> ' || (p_data->>'interest_rate') || '%');
    END IF;
    RETURN p_id;
  ELSE
    INSERT INTO loans (
      label, bank_name, borrower_name, borrower_type, collateral,
      principal, interest_rate, rate_type, base_rate, margin,
      repayment_type, term_months, payment_day, disbursement_date, maturity_date,
      proxy_account, status, notes, grace_months, requires_invoice
    ) VALUES (
      p_data->>'label', p_data->>'bank_name', p_data->>'borrower_name',
      COALESCE(p_data->>'borrower_type', 'bank'), p_data->>'collateral',
      COALESCE((p_data->>'principal')::numeric, 0),
      COALESCE((p_data->>'interest_rate')::numeric, 0),
      COALESCE(p_data->>'rate_type', 'floating'),
      (p_data->>'base_rate')::numeric, (p_data->>'margin')::numeric,
      COALESCE(p_data->>'repayment_type', 'interest_only'),
      (p_data->>'term_months')::int, (p_data->>'payment_day')::int,
      (p_data->>'disbursement_date')::date, (p_data->>'maturity_date')::date,
      p_data->>'proxy_account',
      COALESCE(p_data->>'status', 'active'), p_data->>'notes',
      COALESCE((p_data->>'grace_months')::int, 0),
      COALESCE((p_data->>'requires_invoice')::boolean, false)
    ) RETURNING id INTO v_id;
    INSERT INTO loan_rate_history (loan_id, effective_date, interest_rate, base_rate, margin, note)
    VALUES (v_id, COALESCE((p_data->>'disbursement_date')::date, CURRENT_DATE),
            COALESCE((p_data->>'interest_rate')::numeric, 0),
            (p_data->>'base_rate')::numeric, (p_data->>'margin')::numeric, 'Lai suat ban dau');
    RETURN v_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_loan(text, uuid, jsonb) TO anon, authenticated;

-- ── 5. RPC: xac nhan lai hang thang (upsert theo loan_id + month) ──
CREATE OR REPLACE FUNCTION admin_upsert_confirmation(
  p_token text, p_loan_id uuid, p_month text, p_data jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  INSERT INTO monthly_confirmations (loan_id, month, estimated_interest, confirmed_interest,
    buffer_amount, amount_to_pay, status, paid_date, paid_amount, cic_risk, note)
  VALUES (p_loan_id, p_month,
    (p_data->>'estimated_interest')::numeric, (p_data->>'confirmed_interest')::numeric,
    COALESCE((p_data->>'buffer_amount')::numeric, 0), (p_data->>'amount_to_pay')::numeric,
    COALESCE(p_data->>'status', 'pending'),
    (p_data->>'paid_date')::date, (p_data->>'paid_amount')::numeric,
    COALESCE((p_data->>'cic_risk')::boolean, false), p_data->>'note')
  ON CONFLICT (loan_id, month) DO UPDATE SET
    estimated_interest = COALESCE(EXCLUDED.estimated_interest, monthly_confirmations.estimated_interest),
    confirmed_interest = COALESCE(EXCLUDED.confirmed_interest, monthly_confirmations.confirmed_interest),
    buffer_amount = COALESCE((p_data->>'buffer_amount')::numeric, monthly_confirmations.buffer_amount),
    amount_to_pay = COALESCE(EXCLUDED.amount_to_pay, monthly_confirmations.amount_to_pay),
    status = COALESCE(p_data->>'status', monthly_confirmations.status),
    paid_date = COALESCE(EXCLUDED.paid_date, monthly_confirmations.paid_date),
    paid_amount = COALESCE(EXCLUDED.paid_amount, monthly_confirmations.paid_amount),
    cic_risk = COALESCE((p_data->>'cic_risk')::boolean, monthly_confirmations.cic_risk),
    note = COALESCE(EXCLUDED.note, monthly_confirmations.note),
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_confirmation(text, uuid, text, jsonb) TO anon, authenticated;

-- ── 6. RPC: ghi nhan dong tien (payment_history) + cap nhat confirmation ──
CREATE OR REPLACE FUNCTION admin_record_payment(
  p_token text, p_loan_id uuid, p_data jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid; v_month text;
BEGIN
  PERFORM require_admin(p_token);
  INSERT INTO payment_history (loan_id, paid_date, amount, principal_paid, interest_paid, fee_paid, note)
  VALUES (p_loan_id,
    COALESCE((p_data->>'paid_date')::date, CURRENT_DATE),
    COALESCE((p_data->>'amount')::numeric, 0),
    COALESCE((p_data->>'principal_paid')::numeric, 0),
    COALESCE((p_data->>'interest_paid')::numeric, 0),
    COALESCE((p_data->>'fee_paid')::numeric, 0),
    p_data->>'note')
  RETURNING id INTO v_id;
  -- Neu kem thang xac nhan -> danh dau da nop
  v_month := p_data->>'month';
  IF v_month IS NOT NULL THEN
    INSERT INTO monthly_confirmations (loan_id, month, status, paid_date, paid_amount)
    VALUES (p_loan_id, v_month, 'paid',
      COALESCE((p_data->>'paid_date')::date, CURRENT_DATE), COALESCE((p_data->>'amount')::numeric, 0))
    ON CONFLICT (loan_id, month) DO UPDATE SET
      status = 'paid',
      paid_date = COALESCE((p_data->>'paid_date')::date, CURRENT_DATE),
      paid_amount = COALESCE((p_data->>'amount')::numeric, 0),
      updated_at = now();
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_record_payment(text, uuid, jsonb) TO anon, authenticated;

-- ── 7. RPC: upsert ho so dao han ──
CREATE OR REPLACE FUNCTION admin_upsert_renewal(
  p_token text, p_id uuid, p_data jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  IF p_id IS NOT NULL THEN
    UPDATE loan_renewals SET
      contacted_date = COALESCE((p_data->>'contacted_date')::date, contacted_date),
      approval_date = COALESCE((p_data->>'approval_date')::date, approval_date),
      renewal_date = COALESCE((p_data->>'renewal_date')::date, renewal_date),
      deposit_date = COALESCE((p_data->>'deposit_date')::date, deposit_date),
      redisbursed_date = COALESCE((p_data->>'redisbursed_date')::date, redisbursed_date),
      new_borrower_name = COALESCE(p_data->>'new_borrower_name', new_borrower_name),
      new_principal = COALESCE((p_data->>'new_principal')::numeric, new_principal),
      new_rate = COALESCE((p_data->>'new_rate')::numeric, new_rate),
      new_term_months = COALESCE((p_data->>'new_term_months')::int, new_term_months),
      status = COALESCE(p_data->>'status', status),
      checklist = COALESCE((p_data->'checklist')::jsonb, checklist),
      worst_case_note = COALESCE(p_data->>'worst_case_note', worst_case_note),
      note = COALESCE(p_data->>'note', note),
      updated_at = now()
    WHERE id = p_id;
    RETURN p_id;
  ELSE
    INSERT INTO loan_renewals (loan_id, status, contacted_date, deposit_date, redisbursed_date,
      new_borrower_name, new_principal, new_rate, new_term_months, checklist, worst_case_note, note)
    VALUES ((p_data->>'loan_id')::uuid, COALESCE(p_data->>'status', 'pending'),
      (p_data->>'contacted_date')::date, (p_data->>'deposit_date')::date, (p_data->>'redisbursed_date')::date,
      p_data->>'new_borrower_name', (p_data->>'new_principal')::numeric, (p_data->>'new_rate')::numeric,
      (p_data->>'new_term_months')::int, COALESCE((p_data->'checklist')::jsonb, '[]'::jsonb),
      p_data->>'worst_case_note', p_data->>'note')
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_renewal(text, uuid, jsonb) TO anon, authenticated;

-- ── 8. RPC: hoan tat dao han — tao khoan moi ke thua, tat toan khoan cu, link lai ──
CREATE OR REPLACE FUNCTION admin_complete_renewal(
  p_token text, p_renewal_id uuid, p_new_loan jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_old loans%ROWTYPE; v_renewal loan_renewals%ROWTYPE; v_new_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  SELECT * INTO v_renewal FROM loan_renewals WHERE id = p_renewal_id;
  IF v_renewal.id IS NULL THEN RAISE EXCEPTION 'Khong tim thay ho so dao han'; END IF;
  SELECT * INTO v_old FROM loans WHERE id = v_renewal.loan_id;

  INSERT INTO loans (
    label, bank_name, borrower_name, borrower_type, collateral,
    principal, interest_rate, rate_type, base_rate, margin,
    repayment_type, term_months, payment_day, disbursement_date, maturity_date,
    proxy_account, status, notes, grace_months, requires_invoice
  ) VALUES (
    COALESCE(p_new_loan->>'label', v_old.label),
    COALESCE(p_new_loan->>'bank_name', v_old.bank_name),
    COALESCE(p_new_loan->>'borrower_name', v_renewal.new_borrower_name, v_old.borrower_name),
    v_old.borrower_type, v_old.collateral,
    COALESCE((p_new_loan->>'principal')::numeric, v_renewal.new_principal, v_old.principal),
    COALESCE((p_new_loan->>'interest_rate')::numeric, v_renewal.new_rate, v_old.interest_rate),
    v_old.rate_type, v_old.base_rate, v_old.margin,
    v_old.repayment_type,
    COALESCE((p_new_loan->>'term_months')::int, v_renewal.new_term_months, v_old.term_months),
    COALESCE((p_new_loan->>'payment_day')::int, v_old.payment_day),
    COALESCE((p_new_loan->>'disbursement_date')::date, CURRENT_DATE),
    (p_new_loan->>'maturity_date')::date,
    v_old.proxy_account, 'active',
    'Tai vay tu khoan: ' || v_old.label, v_old.grace_months, v_old.requires_invoice
  ) RETURNING id INTO v_new_id;

  INSERT INTO loan_rate_history (loan_id, effective_date, interest_rate, note)
  VALUES (v_new_id, CURRENT_DATE, COALESCE((p_new_loan->>'interest_rate')::numeric, v_renewal.new_rate, v_old.interest_rate), 'Lai suat ky tai vay');

  UPDATE loans SET status = 'closed', updated_at = now() WHERE id = v_renewal.loan_id;
  UPDATE loan_renewals SET new_loan_id = v_new_id, status = 'completed',
    renewal_date = CURRENT_DATE, updated_at = now() WHERE id = p_renewal_id;
  RETURN v_new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_complete_renewal(text, uuid, jsonb) TO anon, authenticated;

-- ── 9. RPC: giai ngan theo hoa don ──
CREATE OR REPLACE FUNCTION admin_upsert_disbursement(
  p_token text, p_id uuid, p_data jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  IF p_id IS NOT NULL THEN
    UPDATE loan_disbursements SET
      invoice_no = COALESCE(p_data->>'invoice_no', invoice_no),
      supplier_name = COALESCE(p_data->>'supplier_name', supplier_name),
      amount = COALESCE((p_data->>'amount')::numeric, amount),
      request_date = COALESCE((p_data->>'request_date')::date, request_date),
      disbursed_date = COALESCE((p_data->>'disbursed_date')::date, disbursed_date),
      status = COALESCE(p_data->>'status', status),
      note = COALESCE(p_data->>'note', note),
      updated_at = now()
    WHERE id = p_id;
    RETURN p_id;
  ELSE
    INSERT INTO loan_disbursements (loan_id, invoice_no, supplier_name, amount, request_date, disbursed_date, status, note)
    VALUES ((p_data->>'loan_id')::uuid, p_data->>'invoice_no', p_data->>'supplier_name',
      COALESCE((p_data->>'amount')::numeric, 0), (p_data->>'request_date')::date,
      (p_data->>'disbursed_date')::date, COALESCE(p_data->>'status', 'pending'), p_data->>'note')
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_disbursement(text, uuid, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_delete_disbursement(p_token text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  DELETE FROM loan_disbursements WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_disbursement(text, uuid) TO anon, authenticated;

-- ── 10. RPC: xoa ho so dao han (khi tao nham) ──
CREATE OR REPLACE FUNCTION admin_delete_renewal(p_token text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  DELETE FROM loan_renewals WHERE id = p_id AND status <> 'completed';
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_renewal(text, uuid) TO anon, authenticated;
