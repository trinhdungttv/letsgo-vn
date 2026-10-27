// Link mạng xã hội của người liên hệ. Cột `contacts.social_link` chỉ có 1 ô chữ, nên Facebook + LinkedIn
// được lưu CÁCH NHAU BẰNG DẤU CÁCH và phân loại theo tên miền (không cần migration, dữ liệu cũ vẫn đọc được).

export type SocialKind = 'facebook' | 'linkedin' | 'other';

export interface SocialLinks {
  facebook: string;
  linkedin: string;
  /** Link khác (vd dữ liệu cũ nhập tay) — giữ nguyên khi lưu, không hiện ô riêng. */
  other: string[];
}

/** Thêm https:// nếu người dùng dán thiếu (vd "facebook.com/abc"). */
export function withScheme(url: string): string {
  const u = url.trim();
  return u && !/^https?:\/\//i.test(u) ? `https://${u}` : u;
}

export function socialKind(url: string): SocialKind {
  let host = '';
  try { host = new URL(withScheme(url)).hostname.toLowerCase(); } catch { return 'other'; }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (is('facebook.com') || is('fb.com') || is('fb.me')) return 'facebook';
  if (is('linkedin.com') || is('lnkd.in')) return 'linkedin';
  return 'other';
}

export function parseSocialLinks(raw: string | null | undefined): SocialLinks {
  const out: SocialLinks = { facebook: '', linkedin: '', other: [] };
  for (const token of (raw ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const kind = socialKind(token);
    if (kind === 'facebook' && !out.facebook) out.facebook = token;
    else if (kind === 'linkedin' && !out.linkedin) out.linkedin = token;
    else out.other.push(token);
  }
  return out;
}

/** Ghép lại để lưu; rỗng → ''. */
export function joinSocialLinks(l: SocialLinks): string {
  return [l.facebook, l.linkedin, ...l.other].map(s => s.trim()).filter(Boolean).join(' ');
}

/** Danh sách link (đã có https://) để hiện nút mở: Facebook, LinkedIn rồi link khác. */
export function socialLinkList(raw: string | null | undefined): { kind: SocialKind; url: string }[] {
  const l = parseSocialLinks(raw);
  return [
    ...(l.facebook ? [{ kind: 'facebook' as const, url: withScheme(l.facebook) }] : []),
    ...(l.linkedin ? [{ kind: 'linkedin' as const, url: withScheme(l.linkedin) }] : []),
    ...l.other.map(u => ({ kind: 'other' as const, url: withScheme(u) })),
  ];
}
