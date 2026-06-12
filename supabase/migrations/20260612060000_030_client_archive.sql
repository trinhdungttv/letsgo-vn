-- Allow admins to "delete" (archive) a client. Archived clients are hidden
-- from the Khách hàng list but kept in the database for restore via Lưu trữ.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
