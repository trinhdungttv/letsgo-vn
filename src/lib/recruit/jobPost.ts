// Tin tuyển dụng từ JD của vị trí — dán lên Facebook / Zalo / trang tuyển dụng. File thuần.
import { EDUCATION_LABEL } from './types';
import type { RecruitPosition, RecruitProject, RecruitSite } from './types';

/** 12_000_000 → "12 triệu", 12_500_000 → "12,5 triệu", 650_000 → "650.000đ". */
export function moneyShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '';
  if (v >= 1_000_000) {
    const m = Math.round((v / 1_000_000) * 10) / 10;
    return `${m.toLocaleString('vi-VN')} triệu`;
  }
  return `${Math.round(v).toLocaleString('vi-VN')}đ`;
}

export function salaryText(p: Pick<RecruitPosition, 'salary_min' | 'salary_max' | 'salary_note'>): string {
  const lo = moneyShort(p.salary_min);
  const hi = moneyShort(p.salary_max);
  let s = '';
  if (lo && hi && p.salary_min !== p.salary_max) s = `${lo.replace(' triệu', '')} – ${hi}/tháng`;
  else if (lo || hi) s = `${lo || hi}/tháng`;
  if (p.salary_note.trim()) s = s ? `${s} (${p.salary_note.trim()})` : p.salary_note.trim();
  return s || 'Thoả thuận';
}

/** Mỗi dòng 1 ý, thêm gạch đầu dòng nếu chưa có. */
export function bullets(text: string): string[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => (/^[-•*+–]/.test(l) ? `- ${l.replace(/^[-•*+–]\s*/, '')}` : `- ${l}`));
}

export function requirementLines(p: RecruitPosition): string[] {
  const auto: string[] = [];
  if (p.education_min && p.education_min in EDUCATION_LABEL) {
    auto.push(`- Tốt nghiệp ${EDUCATION_LABEL[p.education_min as keyof typeof EDUCATION_LABEL]} trở lên`);
  }
  if (p.age_min || p.age_max) {
    auto.push(`- Tuổi ${p.age_min && p.age_max ? `${p.age_min}–${p.age_max}` : p.age_min ? `từ ${p.age_min}` : `đến ${p.age_max}`}`);
  }
  if (p.gender_pref !== 'any') auto.push(`- Ưu tiên ${p.gender_pref === 'male' ? 'nam' : 'nữ'}`);
  if (p.cleanroom) auto.push('- Làm việc được trong phòng sạch, môi trường máy lạnh');
  const own = bullets(p.requirements);
  // không lặp ý người dùng đã tự ghi
  return [...auto.filter(a => !own.some(o => o.toLowerCase().includes(a.slice(2, 14).toLowerCase()))), ...own];
}

export function jobPostText(input: {
  project: Pick<RecruitProject, 'name' | 'no_worker_fee'>;
  position: RecruitPosition;
  sites: Pick<RecruitSite, 'id' | 'name' | 'zone_name' | 'address'>[];
  /** Tên công ty hiển thị trên tin (mặc định: tên dự án) */
  companyName?: string;
  applyUrl?: string;
  contactPhone?: string;
  emoji?: boolean;
}): string {
  const { project, position: p, applyUrl, contactPhone, emoji = true } = input;
  const e = (icon: string) => (emoji ? `${icon} ` : '');
  const siteList = (p.site_ids.length ? input.sites.filter(s => p.site_ids.includes(s.id)) : input.sites)
    .map(s => [s.name, s.zone_name && s.zone_name !== s.name ? s.zone_name : '', s.address].filter(Boolean).join(' – '));
  const lines: string[] = [];
  lines.push(`${e('📢')}${(input.companyName || project.name).toUpperCase()} TUYỂN DỤNG: ${p.title.toUpperCase()}`);
  lines.push('');
  lines.push(`${e('💰')}Mức lương: ${salaryText(p)}`);
  if (siteList.length) lines.push(`${e('📍')}Địa điểm làm việc: ${siteList.join('; ')}`);
  const time = [p.hours_per_week ? `${p.hours_per_week} giờ/tuần` : '', p.shift_note.trim()].filter(Boolean).join(' · ');
  if (time) lines.push(`${e('⏰')}Thời gian: ${time}`);
  const desc = bullets(p.description);
  if (desc.length) { lines.push('', 'MÔ TẢ CÔNG VIỆC:', ...desc); }
  const req = requirementLines(p);
  if (req.length) { lines.push('', 'YÊU CẦU:', ...req); }
  const ben = bullets(p.benefits);
  if (ben.length) { lines.push('', 'QUYỀN LỢI:', ...ben); }
  if (project.no_worker_fee) lines.push('', `${e('✅')}Không thu bất kỳ khoản phí nào của người lao động.`);
  const contact = [applyUrl ? `${e('📝')}Ứng tuyển nhanh: ${applyUrl}` : '', contactPhone ? `${e('📞')}Liên hệ / Zalo: ${contactPhone}` : ''].filter(Boolean);
  if (contact.length) lines.push('', ...contact);
  return lines.join('\n');
}
