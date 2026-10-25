// ============================================================================
// CSKH — Tuổi âm lịch: can chi, mệnh nạp âm, hợp / kỵ tuổi (port PRM canChi.ts)
// Theo tử vi dân gian (chỉ để tham khảo, gợi chuyện xã giao / chọn quà): tam hợp,
// lục hợp là hợp; lục xung, lục hại, tứ hành xung là kỵ; ngũ hành sinh là hợp, khắc là kỵ.
// ============================================================================
import { convertSolar2Lunar } from './lunar';

export const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'] as const;
export const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'] as const;
export type Chi = (typeof CHI)[number];
export type Element = 'Kim' | 'Mộc' | 'Thủy' | 'Hỏa' | 'Thổ';

/** 30 mệnh nạp âm theo cặp năm trong vòng Giáp Tý (Giáp Tý + Ất Sửu = Hải Trung Kim…). */
const NAP_AM = [
  'Hải Trung Kim', 'Lư Trung Hỏa', 'Đại Lâm Mộc', 'Lộ Bàng Thổ', 'Kiếm Phong Kim',
  'Sơn Đầu Hỏa', 'Giản Hạ Thủy', 'Thành Đầu Thổ', 'Bạch Lạp Kim', 'Dương Liễu Mộc',
  'Tuyền Trung Thủy', 'Ốc Thượng Thổ', 'Tích Lịch Hỏa', 'Tùng Bách Mộc', 'Trường Lưu Thủy',
  'Sa Trung Kim', 'Sơn Hạ Hỏa', 'Bình Địa Mộc', 'Bích Thượng Thổ', 'Kim Bạch Kim',
  'Phú Đăng Hỏa', 'Thiên Hà Thủy', 'Đại Trạch Thổ', 'Thoa Xuyến Kim', 'Tang Đố Mộc',
  'Đại Khê Thủy', 'Sa Trung Thổ', 'Thiên Thượng Hỏa', 'Thạch Lựu Mộc', 'Đại Hải Thủy',
] as const;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface YearSign {
  /** Năm âm lịch (sinh trước Tết thì thuộc năm trước). */
  lunarYear: number;
  can: string;
  chi: Chi;
  /** "Quý Dậu" */
  name: string;
  /** "Kiếm Phong Kim" */
  napAm: string;
  element: Element;
}

export function yearSign(lunarYear: number): YearSign {
  const can = CAN[mod(lunarYear - 4, 10)];
  const chi = CHI[mod(lunarYear - 4, 12)];
  const napAm = NAP_AM[Math.floor(mod(lunarYear - 4, 60) / 2)];
  return { lunarYear, can, chi, name: `${can} ${chi}`, napAm, element: napAm.split(' ').pop() as Element };
}

/** Năm âm lịch của ngày sinh: dương lịch thì đổi qua lịch âm (Tết); âm lịch thì năm đã là năm âm. */
export function lunarYearOf(day: number, month: number, year: number, isLunar: boolean): number {
  return isLunar ? year : convertSolar2Lunar(day, month, year).year;
}

const TAM_HOP: readonly (readonly Chi[])[] = [
  ['Thân', 'Tý', 'Thìn'], ['Dần', 'Ngọ', 'Tuất'], ['Tỵ', 'Dậu', 'Sửu'], ['Hợi', 'Mão', 'Mùi'],
];
const LUC_HOP: readonly (readonly [Chi, Chi])[] = [
  ['Tý', 'Sửu'], ['Dần', 'Hợi'], ['Mão', 'Tuất'], ['Thìn', 'Dậu'], ['Tỵ', 'Thân'], ['Ngọ', 'Mùi'],
];
const LUC_HAI: readonly (readonly [Chi, Chi])[] = [
  ['Tý', 'Mùi'], ['Sửu', 'Ngọ'], ['Dần', 'Tỵ'], ['Mão', 'Thìn'], ['Thân', 'Hợi'], ['Dậu', 'Tuất'],
];
const TU_HANH_XUNG: readonly (readonly Chi[])[] = [
  ['Tý', 'Ngọ', 'Mão', 'Dậu'], ['Dần', 'Thân', 'Tỵ', 'Hợi'], ['Thìn', 'Tuất', 'Sửu', 'Mùi'],
];

/** Lục xung: 2 chi đối diện nhau trên vòng 12. */
const lucXung = (c: Chi): Chi => CHI[mod(CHI.indexOf(c) + 6, 12)];
const partner = (pairs: readonly (readonly [Chi, Chi])[], c: Chi): Chi =>
  (pairs.find(p => p.includes(c)) as readonly [Chi, Chi]).find(x => x !== c) as Chi;

const SINH: Readonly<Record<Element, Element>> = { Kim: 'Thủy', Thủy: 'Mộc', Mộc: 'Hỏa', Hỏa: 'Thổ', Thổ: 'Kim' };
const KHAC: Readonly<Record<Element, Element>> = { Kim: 'Mộc', Mộc: 'Thổ', Thổ: 'Thủy', Thủy: 'Hỏa', Hỏa: 'Kim' };

/** Hành sinh ra mình + hành mình sinh ra (tương sinh), và 2 hành khắc với mình. */
export function elementRelations(e: Element): { good: Element[]; bad: Element[] } {
  const motherOf = (Object.keys(SINH) as Element[]).find(k => SINH[k] === e) as Element;
  const conquerorOf = (Object.keys(KHAC) as Element[]).find(k => KHAC[k] === e) as Element;
  return { good: [motherOf, SINH[e]], bad: [conquerorOf, KHAC[e]] };
}

export interface Compatibility {
  /** Tam hợp + lục hợp (không trùng chính mình). */
  goodChi: Chi[];
  /** Lục xung, lục hại + các tuổi còn lại trong tứ hành xung. */
  badChi: Chi[];
  goodElements: Element[];
  badElements: Element[];
  /** Năm sinh gần tuổi (±8) hợp cả chi lẫn mệnh — gợi ý kết hôn / đồng hành lâu dài. */
  goodYears: YearSign[];
}

export function compatibility(sign: YearSign, span = 8, limit = 5): Compatibility {
  const c = sign.chi;
  const tamHop = (TAM_HOP.find(g => g.includes(c)) ?? []).filter(x => x !== c);
  const goodChi = [...new Set([...tamHop, partner(LUC_HOP, c)])];
  const tuHanh = (TU_HANH_XUNG.find(g => g.includes(c)) ?? []).filter(x => x !== c);
  const badChi = [...new Set([lucXung(c), partner(LUC_HAI, c), ...tuHanh])].filter(x => !goodChi.includes(x));
  const { good: goodElements, bad: badElements } = elementRelations(sign.element);
  const goodYears: YearSign[] = [];
  for (let d = 1; d <= span; d += 1) {
    for (const y of [sign.lunarYear - d, sign.lunarYear + d]) {
      const s = yearSign(y);
      if (goodChi.includes(s.chi) && (s.element === sign.element || goodElements.includes(s.element))) goodYears.push(s);
    }
  }
  return { goodChi, badChi, goodElements, badElements, goodYears: goodYears.slice(0, limit).sort((a, b) => a.lunarYear - b.lunarYear) };
}
