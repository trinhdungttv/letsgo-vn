// ============================================================================
// CSKH — Giới tính: gợi ý theo tên + bộ lọc (port PRM gender.ts)
// ----------------------------------------------------------------------------
// Chỉ GỢI Ý để người dùng xác nhận nhanh (không tự ghi): tên đệm "Thị" / xưng hô
// "Chị, Cô, Ms." → Nữ; "Văn" / "Anh, A, Chú, Ông, Mr." → Nam. "E" (em), "Bác",
// tên trơn → không đoán. Danh bạ LetsGo phần lớn là "Ms Lan – HR", "Mr Tuấn".
// Không dùng chức vụ (contact_roles) để đoán.
// ============================================================================
import type { CskhContact, Gender } from './types';

export interface GenderGuess {
  gender: Exclude<Gender, ''>;
  /** Lý do để người dùng thấy vì sao app đoán vậy. */
  reason: string;
}

const FEMALE_PREFIX: ReadonlyArray<[RegExp, string]> = [
  [/^(chị|c)[\s.]+\S/iu, 'Xưng "Chị"'],
  [/^(cô|bà|dì|mợ|thím|em gái)\s+\S/iu, 'Xưng hô nữ'],
  [/^(ms|mrs|miss|madam)\b\.?/iu, 'Ms. / Mrs.'],
];
const MALE_PREFIX: ReadonlyArray<[RegExp, string]> = [
  [/^(anh|a)[\s.]+\S/iu, 'Xưng "Anh"'],
  [/^(chú|ông|cậu|dượng|em trai)\s+\S/iu, 'Xưng hô nam'],
  [/^(mr)\b\.?/iu, 'Mr.'],
];

/** Bỏ tiền tố đơn vị kiểu "TTV - ", "[KH] " để đọc xưng hô đúng (VD "TTV - Chị Lan"). */
function stripOrgPrefix(name: string): string {
  return name.replace(/^\s*(\[[^\]]*\]|\([^)]*\)|[A-ZĐ0-9]{2,6}\s*[-–:|])\s*/u, '').trim();
}

function byPrefix(name: string): GenderGuess | null {
  const n = stripOrgPrefix(name);
  for (const [re, reason] of FEMALE_PREFIX) if (re.test(n)) return { gender: 'female', reason };
  for (const [re, reason] of MALE_PREFIX) if (re.test(n)) return { gender: 'male', reason };
  return null;
}

/** Tên đệm trong họ tên đầy đủ (ít nhất 3 từ): "Trần Thị Hương" → Nữ, "Lê Văn Nam" → Nam. */
function byMiddleName(name: string): GenderGuess | null {
  const words = name.replace(/[-–(),.]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length - 1; i++) {
    const w = words[i].toLowerCase();
    if (w === 'thị') return { gender: 'female', reason: 'Tên đệm "Thị"' };
    if (w === 'văn' && words[i + 1].toLowerCase() !== 'phòng') return { gender: 'male', reason: 'Tên đệm "Văn"' };
  }
  return null;
}

/** Đoán giới tính từ họ tên + tên thân mật. null = không đoán. */
export function guessGender(c: Pick<CskhContact, 'fullName' | 'nickname'>): GenderGuess | null {
  return byMiddleName(c.nickname) ?? byMiddleName(c.fullName) ?? byPrefix(c.fullName) ?? byPrefix(c.nickname);
}

/** Bộ lọc giới tính ở Ma trận / Ghi cho nhóm: 'guess_*' = chưa rõ nhưng tên gợi ý Nam / Nữ. */
export type GenderFilter = 'all' | 'male' | 'female' | 'unknown' | 'guess_female' | 'guess_male';

export const GENDER_FILTER_LABEL: Readonly<Record<GenderFilter, string>> = {
  all: 'Mọi giới tính',
  female: 'Nữ',
  male: 'Nam',
  unknown: 'Chưa rõ',
  guess_female: 'Gợi ý Nữ theo tên',
  guess_male: 'Gợi ý Nam theo tên',
};

export function matchesGender(c: Pick<CskhContact, 'fullName' | 'nickname' | 'gender'>, filter: GenderFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'male':
    case 'female': return c.gender === filter;
    case 'unknown': return c.gender === '';
    case 'guess_female': return c.gender === '' && guessGender(c)?.gender === 'female';
    case 'guess_male': return c.gender === '' && guessGender(c)?.gender === 'male';
  }
}

/** Giới tính đã lưu, chưa rõ thì giới tính gợi ý theo tên (đánh dấu guessed) — dùng ở Ghi cho nhóm. */
export function effectiveGender(c: Pick<CskhContact, 'fullName' | 'nickname' | 'gender'>): { gender: Gender; guessed: boolean } {
  if (c.gender !== '') return { gender: c.gender, guessed: false };
  const g = guessGender(c);
  return g ? { gender: g.gender, guessed: true } : { gender: '', guessed: false };
}
