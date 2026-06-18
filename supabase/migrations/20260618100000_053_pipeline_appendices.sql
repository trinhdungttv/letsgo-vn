CREATE TABLE IF NOT EXISTS pipeline_appendices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_id UUID NOT NULL REFERENCES crm_pipeline(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_appendices_crm_id_idx ON pipeline_appendices(crm_id);
