-- Stage 3 — Khoa GHI truc tiep vao cac bang khoan vay (A4)
-- Chay thu cong trong Supabase SQL Editor (sau 060 + 061).
--
-- Muc tieu: anon khong the INSERT/UPDATE/DELETE truc tiep vao 8 bang loan.
-- Doc (SELECT) van duoc phep (canAccess da an page khoi non-admin; day la lop them).
-- Ghi phai qua RPC admin (dung session token tu Stage 2).

SET search_path = public, extensions;

-- ── Doi policy tu ALL thanh chi SELECT cho 8 bang loan ──

-- loans
DROP POLICY IF EXISTS "loans_all_anon" ON loans;
DROP POLICY IF EXISTS "loans_all_auth" ON loans;
CREATE POLICY "loans_select_anon" ON loans FOR SELECT TO anon USING (true);
CREATE POLICY "loans_select_auth" ON loans FOR SELECT TO authenticated USING (true);

-- loan_rate_history
DROP POLICY IF EXISTS "loan_rate_history_all_anon" ON loan_rate_history;
DROP POLICY IF EXISTS "loan_rate_history_all_auth" ON loan_rate_history;
CREATE POLICY "loan_rate_history_select_anon" ON loan_rate_history FOR SELECT TO anon USING (true);
CREATE POLICY "loan_rate_history_select_auth" ON loan_rate_history FOR SELECT TO authenticated USING (true);

-- loan_schedules
DROP POLICY IF EXISTS "loan_schedules_all_anon" ON loan_schedules;
DROP POLICY IF EXISTS "loan_schedules_all_auth" ON loan_schedules;
CREATE POLICY "loan_schedules_select_anon" ON loan_schedules FOR SELECT TO anon USING (true);
CREATE POLICY "loan_schedules_select_auth" ON loan_schedules FOR SELECT TO authenticated USING (true);

-- monthly_confirmations
DROP POLICY IF EXISTS "monthly_confirmations_all_anon" ON monthly_confirmations;
DROP POLICY IF EXISTS "monthly_confirmations_all_auth" ON monthly_confirmations;
CREATE POLICY "monthly_confirmations_select_anon" ON monthly_confirmations FOR SELECT TO anon USING (true);
CREATE POLICY "monthly_confirmations_select_auth" ON monthly_confirmations FOR SELECT TO authenticated USING (true);

-- payment_history
DROP POLICY IF EXISTS "payment_history_all_anon" ON payment_history;
DROP POLICY IF EXISTS "payment_history_all_auth" ON payment_history;
CREATE POLICY "payment_history_select_anon" ON payment_history FOR SELECT TO anon USING (true);
CREATE POLICY "payment_history_select_auth" ON payment_history FOR SELECT TO authenticated USING (true);

-- loan_renewals
DROP POLICY IF EXISTS "loan_renewals_all_anon" ON loan_renewals;
DROP POLICY IF EXISTS "loan_renewals_all_auth" ON loan_renewals;
CREATE POLICY "loan_renewals_select_anon" ON loan_renewals FOR SELECT TO anon USING (true);
CREATE POLICY "loan_renewals_select_auth" ON loan_renewals FOR SELECT TO authenticated USING (true);

-- proxy_ledger
DROP POLICY IF EXISTS "proxy_ledger_all_anon" ON proxy_ledger;
DROP POLICY IF EXISTS "proxy_ledger_all_auth" ON proxy_ledger;
CREATE POLICY "proxy_ledger_select_anon" ON proxy_ledger FOR SELECT TO anon USING (true);
CREATE POLICY "proxy_ledger_select_auth" ON proxy_ledger FOR SELECT TO authenticated USING (true);

-- loan_audit_log
DROP POLICY IF EXISTS "loan_audit_log_all_anon" ON loan_audit_log;
DROP POLICY IF EXISTS "loan_audit_log_all_auth" ON loan_audit_log;
CREATE POLICY "loan_audit_log_select_anon" ON loan_audit_log FOR SELECT TO anon USING (true);
CREATE POLICY "loan_audit_log_select_auth" ON loan_audit_log FOR SELECT TO authenticated USING (true);

-- ── RPC admin cho CRUD loans (thao tac pho bien nhat) ──

CREATE OR REPLACE FUNCTION admin_upsert_loan(
  p_token text, p_id uuid, p_data jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM require_admin(p_token);
  IF p_id IS NOT NULL THEN
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
      updated_at = now()
    WHERE id = p_id;
    RETURN p_id;
  ELSE
    INSERT INTO loans (
      label, bank_name, borrower_name, borrower_type, collateral,
      principal, interest_rate, rate_type, base_rate, margin,
      repayment_type, term_months, payment_day, disbursement_date, maturity_date,
      proxy_account, status, notes
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
      COALESCE(p_data->>'status', 'active'), p_data->>'notes'
    ) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_loan(text, uuid, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_delete_loan(p_token text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  IF EXISTS (SELECT 1 FROM monthly_confirmations WHERE loan_id = p_id AND status = 'paid') THEN
    RAISE EXCEPTION 'Khong the xoa: khoan vay da co lich su dong tien. Hay tat toan thay vi xoa.';
  END IF;
  DELETE FROM loans WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_loan(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_settle_loan(p_token text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM require_admin(p_token);
  UPDATE loans SET status = 'closed', updated_at = now() WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_settle_loan(text, uuid) TO anon, authenticated;
