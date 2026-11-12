// Tên KCN đã GỘP (migration 224, bảng market_zone_aliases): "KCN Nhơn Trạch 1…6" → "KCN Nhơn Trạch".
// Khoá tên chuẩn hoá giống hệt market_zone_key() trong SQL = foldZoneName của app ("Khu công nghiệp Nhơn Trạch III" → "nhon trach 3").
// Khớp đúng khoá hoặc "khoá + chữ phía sau" ("nhon trach 2 loc khang"), không khớp "nhon trach 10".
import { supabase } from './supabase';
import { foldZoneName } from './kcnSurvey/zones';

export interface ZoneAlias { key: string; zone_id: string; label: string }

/** KCN mà tên `name` đã được gộp vào (khoá dài nhất thắng) — null nếu không phải tên đã gộp */
export function aliasZoneId(name: string, aliases: readonly ZoneAlias[]): string | null {
  const k = foldZoneName(name);
  if (!k) return null;
  let best: ZoneAlias | null = null;
  for (const a of aliases) if ((k === a.key || k.startsWith(`${a.key} `)) && (!best || a.key.length > best.key.length)) best = a;
  return best?.zone_id ?? null;
}

let cache: Promise<ZoneAlias[]> | null = null;
/** Nạp 1 lần mỗi phiên; chưa chạy migration 224 → [] (app chạy như cũ) */
export function loadZoneAliases(): Promise<ZoneAlias[]> {
  cache ??= (async () => {
    const { data, error } = await supabase.from('market_zone_aliases').select('key, zone_id, label');
    if (error) return [];
    return (data ?? []) as ZoneAlias[];
  })().catch(() => []);
  return cache;
}
