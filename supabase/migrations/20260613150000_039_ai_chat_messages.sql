-- Lưu lịch sử chat với Trợ lý AI (Workspace) theo từng user
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user ON ai_chat_messages(user_id, created_at);

ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_chat_messages_all_anon" ON ai_chat_messages FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "ai_chat_messages_all_auth" ON ai_chat_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
