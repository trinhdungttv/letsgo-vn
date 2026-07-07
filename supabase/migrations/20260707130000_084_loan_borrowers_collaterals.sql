-- 084 — Danh muc chuan hoa cho Khoan vay (07/07/2026): chay thu cong trong Supabase SQL Editor
-- Muc tieu: "Nguoi dung ten vay" va "Tai san dam bao" chon tu danh sach (khong go tay tu do)
-- de dong bo & lien ket duoc lich su the chap/vay theo tung nguoi/tung tai san.

SET search_path = public, extensions;

-- ── 1. Danh muc nguoi dung ten vay ──
CREATE TABLE IF NOT EXISTS loan_borrowers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  borrower_type TEXT NOT NULL DEFAULT 'personal' CHECK (borrower_type IN ('personal','company')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Danh muc tai san dam bao ──
CREATE TABLE IF NOT EXISTS loan_collaterals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE loan_borrowers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loan_borrowers_select_anon" ON loan_borrowers;
CREATE POLICY "loan_borrowers_select_anon" ON loan_borrowers FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "loan_borrowers_select_auth" ON loan_borrowers;
CREATE POLICY "loan_borrowers_select_auth" ON loan_borrowers FOR SELECT TO authenticated USING (true);

ALTER TABLE loan_collaterals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loan_collaterals_select_anon" ON loan_collaterals;
CREATE POLICY "loan_collaterals_select_anon" ON loan_collaterals FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "loan_collaterals_select_auth" ON loan_collaterals;
CREATE POLICY "loan_collaterals_select_auth" ON loan_collaterals FOR SELECT TO authenticated USING (true);

-- ── 3. loans: lien ket toi danh muc (giu lai cot text de man hinh cu khong doi) ──
ALTER TABLE loans ADD COLUMN IF NOT EXISTS borrower_id UUID REFERENCES loan_borrowers(id) ON DELETE SET NULL;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS collateral_id UUID REFERENCES loan_collaterals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_loans_borrower_id ON loans(borrower_id);
CREATE INDEX IF NOT EXISTS idx_loans_collateral_id ON loans(collateral_id);

-- ── 4. RPC: them/sua nguoi dung ten vay ──
CREATE OR REPLACE FUNCTION admin_upsert_borrower(
  p_token text, p_id uuid, p_name text, p_type text DEFAULT 'personal', p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  IF p_id IS NOT NULL THEN
    UPDATE loan_borrowers SET name = p_name, borrower_type = COALESCE(p_type, borrower_type), note = p_note
    WHERE id = p_id;
    -- dong bo lai ten da luu tren cac khoan vay dang tro toi nguoi nay
    UPDATE loans SET borrower_name = p_name WHERE borrower_id = p_id;
    RETURN p_id;
  ELSE
    INSERT INTO loan_borrowers (name, borrower_type, note) VALUES (p_name, COALESCE(p_type, 'personal'), p_note)
    ON CONFLICT (name) DO UPDATE SET note = COALESCE(EXCLUDED.note, loan_borrowers.note)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_borrower(text, uuid, text, text, text) TO anon, authenticated;

-- ── 5. RPC: them/sua tai san dam bao ──
CREATE OR REPLACE FUNCTION admin_upsert_collateral(
  p_token text, p_id uuid, p_name text, p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  IF p_id IS NOT NULL THEN
    UPDATE loan_collaterals SET name = p_name, note = p_note WHERE id = p_id;
    UPDATE loans SET collateral = p_name WHERE collateral_id = p_id;
    RETURN p_id;
  ELSE
    INSERT INTO loan_collaterals (name, note) VALUES (p_name, p_note)
    ON CONFLICT (name) DO UPDATE SET note = COALESCE(EXCLUDED.note, loan_collaterals.note)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_collateral(text, uuid, text, text) TO anon, authenticated;

-- ── 6. admin_upsert_loan: nhan borrower_id/collateral_id, tu dong bo cot text ──
CREATE OR REPLACE FUNCTION admin_upsert_loan(
  p_token text, p_id uuid, p_data jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid; v_old_rate numeric; v_borrower_id uuid; v_collateral_id uuid; v_borrower_name text; v_collateral_name text;
BEGIN
  PERFORM require_admin(p_token);
  v_borrower_id := (p_data->>'borrower_id')::uuid;
  v_collateral_id := (p_data->>'collateral_id')::uuid;
  IF v_borrower_id IS NOT NULL THEN
    SELECT name INTO v_borrower_name FROM loan_borrowers WHERE id = v_borrower_id;
    IF v_borrower_name IS NULL THEN RAISE EXCEPTION 'Nguoi dung ten vay khong hop le'; END IF;
  END IF;
  IF v_collateral_id IS NOT NULL THEN
    SELECT name INTO v_collateral_name FROM loan_collaterals WHERE id = v_collateral_id;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT interest_rate INTO v_old_rate FROM loans WHERE id = p_id;
    UPDATE loans SET
      label = COALESCE(p_data->>'label', label),
      bank_name = COALESCE(p_data->>'bank_name', bank_name),
      borrower_id = COALESCE(v_borrower_id, borrower_id),
      borrower_name = COALESCE(v_borrower_name, borrower_name),
      borrower_type = COALESCE(p_data->>'borrower_type', borrower_type),
      collateral_id = v_collateral_id,
      collateral = v_collateral_name,
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
    IF (p_data->>'interest_rate') IS NOT NULL
       AND (p_data->>'interest_rate')::numeric IS DISTINCT FROM v_old_rate THEN
      INSERT INTO loan_rate_history (loan_id, effective_date, interest_rate, base_rate, margin, note)
      VALUES (p_id, CURRENT_DATE, (p_data->>'interest_rate')::numeric,
              (p_data->>'base_rate')::numeric, (p_data->>'margin')::numeric,
              'Doi lai suat ' || COALESCE(v_old_rate::text,'?') || '% -> ' || (p_data->>'interest_rate') || '%');
    END IF;
    RETURN p_id;
  ELSE
    IF v_borrower_name IS NULL THEN RAISE EXCEPTION 'Vui long chon nguoi dung ten vay'; END IF;
    INSERT INTO loans (
      label, bank_name, borrower_id, borrower_name, borrower_type, collateral_id, collateral,
      principal, interest_rate, rate_type, base_rate, margin,
      repayment_type, term_months, payment_day, disbursement_date, maturity_date,
      proxy_account, status, notes, grace_months, requires_invoice
    ) VALUES (
      p_data->>'label', p_data->>'bank_name', v_borrower_id, v_borrower_name,
      COALESCE(p_data->>'borrower_type', 'bank'), v_collateral_id, v_collateral_name,
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
