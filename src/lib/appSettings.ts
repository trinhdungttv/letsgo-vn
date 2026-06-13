import { supabase } from './supabase';

const LOGO_KEY = 'app_logo_url';

export async function getAppLogoUrl(): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', LOGO_KEY).maybeSingle();
  return data?.value || null;
}

export async function setAppLogoUrl(url: string | null): Promise<void> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: LOGO_KEY, value: url, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
