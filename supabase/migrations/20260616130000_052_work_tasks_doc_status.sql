-- doc_status tracks renewal/document workflow progress for Tái ký HĐ tasks
-- Values: chua_soan | dang_soan | cho_duyet | cho_kh_ky | hoan_tat | ngung_hd
ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS doc_status TEXT DEFAULT NULL;
