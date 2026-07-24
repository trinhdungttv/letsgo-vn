// Danh sách "nút link nhanh" (Bản đồ/Website/Facebook/TikTok…) hiển thị trên mọi thẻ đối
// thủ — DÙNG CHUNG toàn hệ thống (migration 114). Thêm/xoá/sắp xếp ở đây áp dụng ngay cho
// cách hiển thị của TẤT CẢ đối thủ, không phải cấu hình riêng từng đối thủ.
import { MapPin, Globe, Facebook, Link as LinkIcon, type LucideIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Competitor } from '../../lib/types';

export interface CompetitorLinkType {
  id: string;
  key: string;
  label: string;
  field: string | null; // tên cột thật trên competitors; null = lấy từ custom_links[key]
  sortOrder: number;
}

const rowToType = (r: any): CompetitorLinkType => ({
  id: r.id, key: r.key, label: r.label, field: r.field, sortOrder: r.sort_order,
});

export async function fetchLinkTypes(): Promise<CompetitorLinkType[]> {
  const { data, error } = await supabase.from('competitor_link_types').select('*').order('sort_order');
  if (error || !data) return [];
  return data.map(rowToType);
}

const slugify = (s: string) => s.trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'link';

export async function addLinkType(label: string, existing: CompetitorLinkType[]): Promise<string | null> {
  const trimmed = label.trim();
  if (!trimmed) return 'Nhập tên loại liên kết';
  let key = slugify(trimmed);
  if (existing.some(t => t.key === key)) key = `${key}_${Date.now().toString(36)}`;
  const sortOrder = Math.max(0, ...existing.map(t => t.sortOrder)) + 1;
  const { error } = await supabase.from('competitor_link_types').insert({ key, label: trimmed, field: null, sort_order: sortOrder });
  return error ? error.message : null;
}

export async function deleteLinkType(id: string): Promise<string | null> {
  const { error } = await supabase.from('competitor_link_types').delete().eq('id', id);
  return error ? error.message : null;
}

export async function reorderLinkTypes(ordered: CompetitorLinkType[]): Promise<string | null> {
  for (let i = 0; i < ordered.length; i++) {
    const { error } = await supabase.from('competitor_link_types').update({ sort_order: i + 1 }).eq('id', ordered[i].id);
    if (error) return error.message;
  }
  return null;
}

// Lấy URL thực tế của 1 loại link cho 1 đối thủ — field cố định (map_link, website_url…)
// hoặc custom_links[key] với loại tự thêm.
export const getLinkUrl = (competitor: Competitor, type: CompetitorLinkType): string | null => {
  if (type.field) return (competitor as any)[type.field] ?? null;
  return competitor.custom_links?.[type.key] ?? null;
};

// Ghi URL của 1 loại link cho 1 đối thủ — dùng khi sửa hồ sơ đối thủ (CompetitorDetail).
export async function setLinkUrl(competitorId: string, type: CompetitorLinkType, url: string): Promise<string | null> {
  const trimmed = url.trim() || null;
  const patch = type.field
    ? { [type.field]: trimmed }
    : null; // custom field cần merge jsonb — xử lý riêng ở nơi gọi vì cần giá trị custom_links hiện tại
  if (!patch) return 'setLinkUrl chỉ dùng cho loại link có field cố định';
  const { error } = await supabase.from('competitors').update(patch).eq('id', competitorId);
  return error ? error.message : null;
}

export async function setCustomLinkUrl(competitorId: string, currentCustomLinks: Record<string, string>, key: string, url: string): Promise<string | null> {
  const next = { ...currentCustomLinks };
  if (url.trim()) next[key] = url.trim(); else delete next[key];
  const { error } = await supabase.from('competitors').update({ custom_links: next }).eq('id', competitorId);
  return error ? error.message : null;
}

// Icon cho 4 loại có sẵn; loại tự thêm dùng icon Link chung.
const BUILTIN_ICONS: Record<string, LucideIcon> = { map: MapPin, website: Globe, facebook: Facebook, tiktok: LinkIcon };
export const iconForLinkKey = (key: string): LucideIcon => BUILTIN_ICONS[key] ?? LinkIcon;
