-- ============================================================================
-- 184 — Tách 2 dịch vụ ở Thị trường & Báo giá: CHO THUÊ lao động (thời vụ) / GIỚI THIỆU lao động (chính thức)
-- ----------------------------------------------------------------------------
-- Hướng "chung dữ liệu gốc, tách quy trình": không tạo bảng / màn hình riêng cho từng dịch vụ — chỉ thêm cột
-- HÌNH THỨC ở những chỗ cách tính khác nhau. Dữ liệu cũ đều là cho thuê → mặc định 'leasing'.
--
--   competitors.service_mode            đối thủ làm hình thức nào: leasing | recruitment | both
--   competitors.referral_fee            phí giới thiệu đối thủ thu / 1 người (đ)
--   competitors.referral_guarantee_days bảo hành (ngày) đối thủ cam kết
--   competitor_clients.service_type     đối thủ cung cấp cho khách đó theo hình thức nào: leasing | recruitment
--   market_leads.need_type              khách cần: leasing (thời vụ) | direct (chính thức) | both
--   industry_metrics.referral_fee_min/max  phí giới thiệu trung bình ngành (đ / người)
--   quotes.service_type / referral_terms   báo giá tự động: cho thuê hay giới thiệu (+ số ngày tính phí, bảo hành)
--
-- Bảng báo giá trong CRM (crm_pipeline.quote_info) là jsonb → thêm trường trong app, không cần cột mới.
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN có DEFAULT. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'leasing' CHECK (service_mode IN ('leasing', 'recruitment', 'both')),
  ADD COLUMN IF NOT EXISTS referral_fee bigint CHECK (referral_fee IS NULL OR referral_fee >= 0),
  ADD COLUMN IF NOT EXISTS referral_guarantee_days int CHECK (referral_guarantee_days IS NULL OR referral_guarantee_days >= 0);

ALTER TABLE competitor_clients
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'leasing' CHECK (service_type IN ('leasing', 'recruitment'));

ALTER TABLE market_leads
  ADD COLUMN IF NOT EXISTS need_type text NOT NULL DEFAULT 'leasing' CHECK (need_type IN ('leasing', 'direct', 'both'));

ALTER TABLE industry_metrics
  ADD COLUMN IF NOT EXISTS referral_fee_min bigint,
  ADD COLUMN IF NOT EXISTS referral_fee_max bigint;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'leasing' CHECK (service_type IN ('leasing', 'recruitment')),
  ADD COLUMN IF NOT EXISTS referral_terms jsonb;
