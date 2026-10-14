// DỮ LIỆU DANH MỤC ĐẦU MỤC (bộ có sẵn 5 nhóm) — tách riêng, không phụ thuộc bảng giá / bảng chi phí, để cả hai cùng dùng
// làm MÃ QUY CHIẾU chung (QuoteRowCfg.catalogId, CostLine.catalogId) mà không vòng import.
import {
  OT_DAY_HOLIDAY, OT_DAY_SUNDAY, OT_DAY_WEEKDAY, OT_NIGHT_HOLIDAY, OT_NIGHT_SUNDAY, OT_NIGHT_WEEKDAY_NOPRIOR,
} from '../payroll/coefficients';
import type { QuoteRowKind, RowCalc } from './types';

export type CatalogGroup = 'wage' | 'overtime' | 'insurance' | 'allowance' | 'fee';
export const CATALOG_GROUPS: CatalogGroup[] = ['wage', 'overtime', 'insurance', 'allowance', 'fee'];
export const CATALOG_GROUP_LABEL: Record<CatalogGroup, string> = {
  wage: 'I. Lương cơ bản & đơn giá ca làm việc',
  overtime: 'II. Lương tăng ca (ngày thường, Chủ nhật, Lễ Tết)',
  insurance: 'III. Bảo hiểm & chính sách bảo hiểm',
  allowance: 'IV. Phụ cấp & hỗ trợ lao động',
  fee: 'V. Thưởng, phí dịch vụ & khấu trừ',
};

/** Tên ngắn của nhóm (nút lọc) */
export const CATALOG_GROUP_SHORT: Record<CatalogGroup, string> = {
  wage: 'Lương ca', overtime: 'Tăng ca · CN · Lễ', insurance: 'Bảo hiểm', allowance: 'Phụ cấp', fee: 'Thưởng · phí',
};

export interface CatalogItem {
  id: string;
  group: CatalogGroup;
  name: string;
  unit: string;
  i18n?: { zh?: string; en?: string };
  /** Có = dòng tự tính theo lương; không = nhập tay (giá mặc định ở `price`) */
  calc?: RowCalc;
  price?: number;
  /** Mô tả ngắn hiện trong danh sách */
  hint?: string;
  /** Do công ty tự thêm (xoá được). Mục có sẵn thì chỉ ẩn được. */
  custom?: boolean;
  /** Mục có sẵn đã được lưu lại sau khi sửa: trỏ về mục gốc (để "Khôi phục mặc định" và không bị nạp trùng) */
  builtinId?: string;
  /** Ẩn khỏi bộ chọn "Thêm dòng" (vẫn còn trong màn Quản lý, vẫn gắn danh mục được) */
  hidden?: boolean;
  /** Tên cũ / tên hay gặp — để nhận ra dòng của bảng giá cũ thuộc mục này */
  aliases?: string[];
  /** Mục tương ứng 1 dòng chuẩn của bảng giá (thêm từ kho thì hiện lại dòng chuẩn đang ẩn thay vì thêm dòng trùng) */
  std?: QuoteRowKind;
  /**
   * Cách dùng ở BẢNG CHI PHÍ (bước 1 — giá vốn 1 công). Thiếu = không dùng ở bước 1: tăng ca / Chủ nhật / Lễ / ca 12 tiếng
   * (giá suy từ lương cơ bản — đưa vào chi phí 1 công là tính 2 lần), BHXH phần NLĐ đóng (trừ lương, không phải chi phí)…
   */
  cost?: CatalogCost;
}

/** Nhóm ở bảng chi phí (bước 1) */
export type CostSection = 'worker' | 'compliance' | 'other';
export const COST_SECTION_LABEL: Record<CostSection, string> = { worker: 'Trả người lao động', compliance: 'Bảo hiểm & chế độ', other: 'Chi phí khác' };

/** Cách 1 mục danh mục vào bảng chi phí: số tiền theo công / tháng, % (lương đóng BHXH / lương cơ bản) hoặc số ngày phép. */
export interface CatalogCost {
  section: CostSection;
  mode: 'fixed' | 'percent' | 'leave';
  /** fixed: đơn vị nhập */
  unit?: 'day' | 'month';
  /** percent: cơ sở tính */
  base?: 'insurable' | 'base_wage';
  /** fixed: số tiền mặc định · percent: % · leave: số ngày phép/năm */
  value?: number;
  /** fixed, trả NLĐ: tính vào lương đóng BHXH (khi đóng theo lương thực trả) */
  insurable?: boolean;
}

const calc = (base: RowCalc['base'], hours: number, coef: number): RowCalc => ({ base, hours, coef });
const tr = (zh: string, en: string) => ({ zh, en });
type B = Omit<CatalogItem, 'group'>;
const grp = (group: CatalogGroup, list: B[]): CatalogItem[] => list.map(i => ({ ...i, group }));

const RAW_BUILTIN: CatalogItem[] = [
  // ── I. Lương cơ bản & đơn giá ca làm việc ──
  ...grp('wage', [
    { id: 'b-hour-day', name: 'Lương 1 giờ làm việc ca ngày', unit: 'VNĐ/giờ', calc: calc('dayHour', 0, 0), hint: 'giá ca ngày 8h ÷ 8', i18n: tr('白班每小时工资', 'Hourly wage - day shift') },
    { id: 'b-hour-night', name: 'Lương 1 giờ làm việc ca đêm', unit: 'VNĐ/giờ', calc: calc('nightHour', 0, 0), hint: 'giá ca đêm 8h ÷ 8', i18n: tr('夜班每小时工资', 'Hourly wage - night shift') },
    { id: 'b-day8', std: 'day8', name: 'Lương 8h ngày thường (ca ngày)', unit: 'VNĐ/8h/ngày', calc: calc('day', 0, 0), hint: 'giá 1 công 8 giờ', aliases: ['Lương ngày làm việc 8 tiếng'], i18n: tr('平日8小时白班工资', 'Weekday 8-hour wage - day shift') },
    { id: 'b-night8', std: 'night8', name: 'Lương 8h ngày thường (ca đêm)', unit: 'VNĐ/8h/đêm', calc: calc('night', 0, 0), hint: 'giá ngày + 30% làm đêm', aliases: ['Lương ngày làm việc 8 tiếng ca đêm'], i18n: tr('平日8小时夜班工资', 'Weekday 8-hour wage - night shift') },
    { id: 'b-day9', name: 'Lương ca 9 tiếng ngày thường (ca ngày)', unit: 'VNĐ/ca', calc: calc('day', 1, OT_DAY_WEEKDAY), hint: '8 giờ + 1 giờ tăng ca 150%', i18n: tr('平日9小时白班工资', 'Weekday 9-hour shift - day shift') },
    { id: 'b-day10', name: 'Lương ca 10 tiếng ngày thường (ca ngày)', unit: 'VNĐ/ca', calc: calc('day', 2, OT_DAY_WEEKDAY), hint: '8 giờ + 2 giờ tăng ca 150%', i18n: tr('平日10小时白班工资', 'Weekday 10-hour shift - day shift') },
    { id: 'b-day11', name: 'Lương ca 11 tiếng ngày thường (ca ngày)', unit: 'VNĐ/ca', calc: calc('day', 3, OT_DAY_WEEKDAY), hint: '8 giờ + 3 giờ tăng ca 150%', i18n: tr('平日11小时白班工资', 'Weekday 11-hour shift - day shift') },
    { id: 'b-night11', name: 'Lương ca 11 tiếng ngày thường (ca đêm)', unit: 'VNĐ/ca', calc: calc('night', 3, OT_NIGHT_WEEKDAY_NOPRIOR), hint: 'ca đêm 8 giờ + 3 giờ tăng ca đêm 200%', i18n: tr('平日11小时夜班工资', 'Weekday 11-hour shift - night shift') },
    { id: 'b-day12', name: 'Lương 12h ngày thường (ca ngày)', unit: 'VNĐ/12h/ngày', calc: calc('day', 4, OT_DAY_WEEKDAY), hint: '8 giờ + 4 giờ tăng ca 150%', aliases: ['Lương ca ngày 12 tiếng'], i18n: tr('平日12小时白班工资', 'Weekday 12-hour wage - day shift') },
    { id: 'b-night12', name: 'Lương 12h ngày thường (ca đêm)', unit: 'VNĐ/12h/ngày', calc: calc('night', 4, OT_NIGHT_WEEKDAY_NOPRIOR), hint: 'ca đêm 8 giờ + 4 giờ tăng ca đêm 200%', aliases: ['Lương ca đêm 12 tiếng'], i18n: tr('平日12小时夜班工资', 'Weekday 12-hour wage - night shift') },
    { id: 'b-base-wage', name: 'Lương cơ bản', unit: 'VNĐ/tháng', price: 0, hidden: true, hint: 'dòng gốc của bảng chi phí (bước 1)', i18n: tr('基本工资', 'Basic salary') },
    { id: 'b-piece', name: 'Lương theo sản phẩm / Lương khoán', unit: 'VNĐ/sản phẩm', price: 0, hint: 'hoặc VNĐ/cái', i18n: tr('计件工资 / 包干工资', 'Piece-rate / lump-sum wage') },
    { id: 'b-loading', name: 'Đơn giá dịch vụ bốc xếp / gia công theo sản lượng', unit: 'VNĐ/tấn', price: 0, hint: 'hoặc VNĐ/container', i18n: tr('装卸、加工服务单价（按产量）', 'Loading / processing rate by output') },
  ]),
  // ── II. Lương tăng ca: ngày thường / Chủ nhật / Lễ Tết (Điều 98 BLLĐ 2019, Điều 57 NĐ 145/2020) ──
  ...grp('overtime', [
    { id: 'b-ot-day', std: 'ot_day', name: 'Lương tăng ca ngày thường (ca ngày)', unit: 'VNĐ/giờ', calc: calc('none', 1, OT_DAY_WEEKDAY), aliases: ['Lương tăng ca ngày 1 tiếng'], i18n: tr('平日白班加班工资', 'Weekday overtime - day shift') },
    { id: 'b-ot-night', std: 'ot_night', name: 'Lương tăng ca ngày thường (ca đêm)', unit: 'VNĐ/giờ', calc: calc('none', 1, OT_NIGHT_WEEKDAY_NOPRIOR), aliases: ['Lương tăng ca 1 tiếng ca đêm'], i18n: tr('平日夜班加班工资', 'Weekday overtime - night shift') },
    { id: 'b-sun8', name: 'Lương 8h ca ngày Chủ nhật', unit: 'VNĐ/8h/ngày', calc: calc('none', 8, OT_DAY_SUNDAY), aliases: ['Lương Chủ nhật ca ngày 8 tiếng'], i18n: tr('周日8小时白班工资', 'Sunday 8-hour wage - day shift') },
    { id: 'b-sun8n', name: 'Lương 8h ca đêm Chủ nhật', unit: 'VNĐ/8h/đêm', calc: calc('none', 8, OT_NIGHT_SUNDAY), aliases: ['Lương Chủ nhật ca đêm 8 tiếng'], i18n: tr('周日8小时夜班工资', 'Sunday 8-hour wage - night shift') },
    { id: 'b-ot-sun', std: 'ot_sun', name: 'Lương tăng ca ngày Chủ nhật (ca ngày)', unit: 'VNĐ/giờ', calc: calc('none', 1, OT_DAY_SUNDAY), aliases: ['Lương tăng ca ngày chủ nhật 1 tiếng'], i18n: tr('周日白班加班工资', 'Sunday overtime - day shift') },
    { id: 'b-ot-sun-night', std: 'ot_sun_night', name: 'Lương tăng ca ngày Chủ nhật (ca đêm)', unit: 'VNĐ/giờ', calc: calc('none', 1, OT_NIGHT_SUNDAY), aliases: ['Lương tăng ca ngày chủ nhật 1 tiếng ca đêm'], i18n: tr('周日夜班加班工资', 'Sunday overtime - night shift') },
    { id: 'b-sun12', name: 'Lương ca 12h Chủ nhật (ca ngày)', unit: 'VNĐ/12h/ngày', calc: calc('none', 12, OT_DAY_SUNDAY), i18n: tr('周日12小时白班工资', 'Sunday 12-hour wage - day shift') },
    { id: 'b-sun12n', name: 'Lương ca 12h Chủ nhật (ca đêm)', unit: 'VNĐ/12h/đêm', calc: calc('none', 12, OT_NIGHT_SUNDAY), i18n: tr('周日12小时夜班工资', 'Sunday 12-hour wage - night shift') },
    { id: 'b-hol8', name: 'Lương 8h ca ngày Lễ, Tết', unit: 'VNĐ/8h/ngày', calc: calc('none', 8, OT_DAY_HOLIDAY), aliases: ['Lương ngày Lễ, Tết ca ngày 8 tiếng'], i18n: tr('节假日8小时白班工资', 'Public holiday 8-hour wage - day shift') },
    { id: 'b-hol8n', name: 'Lương 8h ca đêm Lễ, Tết', unit: 'VNĐ/8h/đêm', calc: calc('none', 8, OT_NIGHT_HOLIDAY), aliases: ['Lương ngày Lễ, Tết ca đêm 8 tiếng'], i18n: tr('节假日8小时夜班工资', 'Public holiday 8-hour wage - night shift') },
    { id: 'b-ot-hol', std: 'ot_hol', name: 'Lương tăng ca ngày Lễ, Tết (ca ngày)', unit: 'VNĐ/giờ', calc: calc('none', 1, OT_DAY_HOLIDAY), aliases: ['Lương tăng ca ngày lễ, Tết 1 tiếng'], i18n: tr('节假日白班加班工资', 'Public holiday overtime - day shift') },
    { id: 'b-ot-hol-night', std: 'ot_hol_night', name: 'Lương tăng ca ngày Lễ, Tết (ca đêm)', unit: 'VNĐ/giờ', calc: calc('none', 1, OT_NIGHT_HOLIDAY), aliases: ['Lương tăng ca ngày lễ, Tết 1 tiếng ca đêm'], i18n: tr('节假日夜班加班工资', 'Public holiday overtime - night shift') },
    { id: 'b-hol12', name: 'Lương ca 12h ngày Lễ, Tết (ca ngày)', unit: 'VNĐ/12h/ngày', calc: calc('none', 12, OT_DAY_HOLIDAY), i18n: tr('节假日12小时白班工资', 'Public holiday 12-hour wage - day shift') },
    { id: 'b-hol12n', name: 'Lương ca 12h ngày Lễ, Tết (ca đêm)', unit: 'VNĐ/12h/đêm', calc: calc('none', 12, OT_NIGHT_HOLIDAY), i18n: tr('节假日12小时夜班工资', 'Public holiday 12-hour wage - night shift') },
    { id: 'b-ot2', name: 'Lương tăng ca ngày thường 2 tiếng', unit: 'VNĐ/2 giờ', calc: calc('none', 2, OT_DAY_WEEKDAY), hidden: true, i18n: tr('平日加班2小时工资', 'Weekday overtime (2 hours)') },
    { id: 'b-ot4', name: 'Lương tăng ca ngày thường 4 tiếng', unit: 'VNĐ/4 giờ', calc: calc('none', 4, OT_DAY_WEEKDAY), hidden: true, i18n: tr('平日加班4小时工资', 'Weekday overtime (4 hours)') },
  ]),
  // ── III. Bảo hiểm & chính sách bảo hiểm (% tính trên lương đóng BHXH của phương án: tối thiểu vùng / mức riêng / lương) ──
  ...grp('insurance', [
    { id: 'b-ins-worker', name: 'Phí tham gia BHXH người lao động phải đóng', unit: 'VNĐ/người/tháng', calc: calc('insSalary', 0, 0.105), hint: '8% BHXH + 1,5% BHYT + 1% BHTN', i18n: tr('员工应缴社会保险费', 'Employee social insurance contribution') },
    { id: 'b-ins-company', name: 'Chi phí BHXH doanh nghiệp đóng', unit: 'VNĐ/người/tháng', calc: calc('insSalary', 0, 0.175), hint: '17,5% — gồm cả BHYT, BHTN thì đổi 21,5%', i18n: tr('企业缴纳社会保险费', 'Employer social insurance contribution') },
    { id: 'b-ins-all', std: 'insurance', name: 'Bảo hiểm xã hội, y tế, thất nghiệp (doanh nghiệp đóng)', unit: 'VNĐ/người/tháng', calc: calc('insSalary', 0, 0.215), hint: '17,5% + 3% + 1% — thu riêng theo tháng', aliases: ['Bảo hiểm xã hội, y tế, thất nghiệp', 'BHXH, BHYT, BHTN (DN đóng 21,5%)'], i18n: tr('社会保险、医疗保险、失业保险（企业缴纳）', 'Social, health & unemployment insurance (employer)') },
    { id: 'b-ins-health', name: 'Chi phí Bảo hiểm y tế (BHYT - 3%)', unit: 'VNĐ/người/tháng', calc: calc('insSalary', 0, 0.03), i18n: tr('医疗保险费（3%）', 'Health insurance (3%)') },
    { id: 'b-ins-unemp', name: 'Chi phí Bảo hiểm thất nghiệp (BHTN - 1%)', unit: 'VNĐ/người/tháng', calc: calc('insSalary', 0, 0.01), i18n: tr('失业保险费（1%）', 'Unemployment insurance (1%)') },
    { id: 'b-ins-accident', name: 'Phí BHTNLĐ - BNN (0.5%)', unit: 'VNĐ/người/tháng', calc: calc('insSalary', 0, 0.005), i18n: tr('工伤及职业病保险费（0.5%）', 'Occupational accident & disease insurance (0.5%)') },
    { id: 'b-union-fee', name: 'Kinh phí công đoàn (2%)', unit: 'VNĐ/người/tháng', calc: calc('insSalary', 0, 0.02), hidden: true, hint: 'doanh nghiệp nộp 2% quỹ lương đóng BHXH', aliases: ['Kinh phí Công đoàn (DN nộp 2%)'], i18n: tr('工会经费（2%）', 'Trade union fee (2%)') },
    { id: 'b-annual-leave', name: 'Dự phòng phép năm có lương', unit: 'VNĐ/người/tháng', price: 0, hidden: true, hint: '12 ngày/năm (nặng nhọc, độc hại: 14)', i18n: tr('带薪年假准备金', 'Paid annual leave provision') },
    { id: 'b-ins-24h', name: 'Phí Bảo hiểm tai nạn 24h', unit: 'VNĐ/người/tháng', price: 0, aliases: ['Bảo hiểm tai nạn 24/24'], i18n: tr('24小时意外保险费', '24-hour accident insurance') },
    { id: 'b-health-check', name: 'Chi phí khám sức khỏe định kỳ (1 năm/lần)', unit: 'VNĐ/người/tháng', price: 0, hint: 'chi phí 1 lần/năm chia 12 tháng', aliases: ['Khám sức khoẻ định kỳ'], i18n: tr('定期体检费（每年一次）', 'Periodic health check (once a year)') },
    { id: 'b-toxic', name: 'Phụ cấp độc hại / Bảo hộ đặc thù', unit: 'VNĐ/tháng', price: 0, aliases: ['Phụ cấp độc hại', 'Phụ cấp độc hại (tiền mặt / hiện vật)'], i18n: tr('有毒有害津贴 / 特殊劳保', 'Hazard allowance / special protective equipment') },
  ]),
  // ── IV. Phụ cấp & hỗ trợ lao động ──
  ...grp('allowance', [
    { id: 'b-attend', name: 'Phụ cấp chuyên cần', unit: 'VNĐ/tháng', price: 0, hint: 'hoặc VNĐ/26 công', i18n: tr('全勤津贴', 'Attendance allowance') },
    { id: 'b-nightallow', name: 'Phụ cấp ca đêm / Hỗ trợ làm ca đêm', unit: 'VNĐ/đêm', calc: calc('none', 8, 0.3), hint: '30% lương ngày — làm đêm tối thiểu +30%', aliases: ['Phụ cấp ca đêm'], i18n: tr('夜班津贴', 'Night shift allowance') },
    { id: 'b-meal', name: 'Phụ cấp cơm / Hỗ trợ tiền ăn ca', unit: 'VNĐ/suất', price: 0, hint: 'hoặc VNĐ/buổi, VNĐ/26 công', aliases: ['Phụ cấp cơm', 'Phụ cấp cơm ca'], i18n: tr('餐费补贴', 'Meal allowance') },
    { id: 'b-meal-ot', name: 'Phụ cấp cơm tăng ca (tăng ca từ 3 giờ trở lên)', unit: 'VNĐ/suất', price: 0, i18n: tr('加班餐费补贴（加班3小时以上）', 'Overtime meal allowance (3+ overtime hours)') },
    { id: 'b-travel', name: 'Phụ cấp đi lại / Xăng xe', unit: 'VNĐ/tháng', price: 0, hint: 'hoặc VNĐ/26 công', aliases: ['Phụ cấp xăng xe', 'Phụ cấp đi lại'], i18n: tr('交通补贴 / 油费补贴', 'Transport / fuel allowance') },
    { id: 'b-travel-special', name: 'Hỗ trợ xe / Xăng làm việc ca đêm, Chủ nhật, ngày Lễ', unit: 'VNĐ/người/ngày', price: 0, i18n: tr('夜班、周日、节假日交通补贴', 'Transport support for night shifts, Sundays & holidays') },
    { id: 'b-housing', name: 'Phụ cấp nhà ở / Cư trú', unit: 'VNĐ/tháng', price: 0, hint: 'hoặc VNĐ/ngày', aliases: ['Phụ cấp nhà ở', 'Phụ cấp nhà ở / nhà trọ'], i18n: tr('住房补贴', 'Housing allowance') },
    { id: 'b-skill', name: 'Phụ cấp tay nghề theo cấp bậc', unit: 'VNĐ/ngày', price: 0, hint: 'Bậc SL3-C, SL3-B, SL3-A…', aliases: ['Phụ cấp tay nghề (thợ hàn / CNC)'], i18n: tr('技能等级津贴', 'Skill grade allowance') },
    { id: 'b-responsibility', name: 'Phụ cấp nghề nghiệp / Phụ cấp trách nhiệm', unit: 'VNĐ/tháng', price: 0, i18n: tr('职业津贴 / 责任津贴', 'Professional / responsibility allowance') },
    { id: 'b-fixed', name: 'Phụ cấp cố định / Phụ cấp xưởng đặc thù', unit: 'VNĐ/công', price: 0, hint: 'hoặc VNĐ/tháng', i18n: tr('固定津贴 / 车间特殊津贴', 'Fixed allowance / special workshop allowance') },
  ]),
  // ── V. Thưởng, phí dịch vụ giám sát & các khoản khấu trừ ──
  ...grp('fee', [
    { id: 'b-bonus-perf', name: 'Thưởng hiệu suất / Thưởng vượt trội', unit: 'VNĐ/tháng', price: 0, i18n: tr('绩效奖金', 'Performance bonus') },
    { id: 'b-bonus-13', name: 'Thưởng Tết / Lương tháng 13 (dự phòng)', unit: 'VNĐ/tháng', price: 0, hidden: true, hint: '1 tháng lương chia đều 12 tháng', aliases: ['Thưởng Tết / tháng 13 (dự phòng)'], i18n: tr('春节奖金 / 第13个月工资（预提）', 'Tet bonus / 13th-month salary (provision)') },
    { id: 'b-bonus-hire', name: 'Thưởng phỏng vấn và nhận việc (áp dụng tháng đầu)', unit: 'VNĐ/lần', price: 0, i18n: tr('面试及入职奖金（首月）', 'Interview & onboarding bonus (first month)') },
    { id: 'b-svc-fee', std: 'service_fee', name: 'Phí dịch vụ quản lý nhân sự', unit: 'VNĐ/người/tháng', price: 0, hint: 'hoặc VNĐ/ngày công, % tổng chi phí lương', aliases: ['Phí dịch vụ'], i18n: tr('人力资源管理服务费', 'HR management service fee') },
    { id: 'b-uniform', name: 'Phí đồng phục / Áo thun / Giày / Thẻ TTV', unit: 'VNĐ/bộ', price: 0, hint: 'trừ vào lương hoặc hoàn trả khi nghỉ', aliases: ['Đồng phục, bảo hộ lao động', 'Đồng phục / bảo hộ lao động', 'Đồng phục'], i18n: tr('工服、T恤、鞋、工牌费', 'Uniform, T-shirt, shoes & ID card fee') },
    { id: 'b-recruit', name: 'Chi phí tuyển dụng & đào tạo ban đầu', unit: 'VNĐ/người', price: 0, hidden: true, i18n: tr('招聘及入职培训费', 'Recruitment & initial training cost') },
    { id: 'b-supervise', name: 'Chi phí quản lý tại chỗ (tổ trưởng, giám sát)', unit: 'VNĐ/công', price: 0, hidden: true, i18n: tr('现场管理费（组长、监督）', 'On-site management (team leader, supervisor)') },
    { id: 'b-deduct', name: 'Trừ lương do nghỉ tự ý / nghỉ không báo trước', unit: 'Theo quy định công ty', price: 0, hidden: true, i18n: tr('擅自旷工 / 未提前通知离职扣薪', 'Deduction for unauthorized absence / leaving without notice') },
    { id: 'b-profit-share', name: 'Tỷ lệ chia sẻ lợi nhuận / Hoa hồng dự án', unit: 'VNĐ/công', price: 0, hint: 'hoặc VNĐ/giờ, % phân chia', hidden: true, i18n: tr('利润分成 / 项目佣金', 'Profit sharing / project commission') },
  ]),
];

const fixed = (section: CostSection, unit: 'day' | 'month', p: Partial<CatalogCost> = {}): CatalogCost => ({ section, mode: 'fixed', unit, value: 0, ...p });
const pctOf = (section: CostSection, value: number, base: 'insurable' | 'base_wage' = 'insurable'): CatalogCost => ({ section, mode: 'percent', base, value });
/**
 * Mục nào dùng được ở BẢNG CHI PHÍ (bước 1) và vào đó thế nào. Không có tên ở đây = chỉ dùng ở bảng giá:
 * lương ca / tăng ca / Chủ nhật / Lễ (suy từ lương cơ bản), BHXH phần NLĐ đóng (trừ lương), lương khoán, phí DV (dòng riêng),
 * trừ lương, hoa hồng (thuộc phần chia lợi nhuận), cơm tăng ca & hỗ trợ xe ngày đặc biệt (chỉ phát sinh khi tăng ca / ngày đặc biệt).
 */
const BUILTIN_COST: Record<string, CatalogCost> = {
  // III. Bảo hiểm & chế độ — % trên lương đóng BHXH (tối thiểu vùng / mức riêng / lương, theo cài đặt phương án)
  'b-ins-all': pctOf('compliance', 21.5), 'b-ins-company': pctOf('compliance', 17.5), 'b-ins-health': pctOf('compliance', 3),
  'b-ins-unemp': pctOf('compliance', 1), 'b-ins-accident': pctOf('compliance', 0.5), 'b-union-fee': pctOf('compliance', 2),
  'b-annual-leave': { section: 'compliance', mode: 'leave', value: 12 },
  'b-ins-24h': fixed('compliance', 'month'), 'b-health-check': fixed('compliance', 'month'),
  'b-toxic': fixed('worker', 'month', { insurable: true }),
  // IV. Phụ cấp trả NLĐ — phụ cấp gắn với công việc tính vào lương đóng BHXH; tiền ăn, đi lại, nhà ở, chuyên cần thì không
  'b-attend': fixed('worker', 'month'), 'b-nightallow': fixed('worker', 'day'), 'b-meal': fixed('worker', 'day'),
  'b-travel': fixed('worker', 'month'), 'b-housing': fixed('worker', 'month'),
  'b-skill': fixed('worker', 'day', { insurable: true }), 'b-responsibility': fixed('worker', 'month', { insurable: true }),
  'b-fixed': fixed('worker', 'day', { insurable: true }),
  // V. Thưởng (trả NLĐ), chi phí tuyển / quản lý (chi phí khác), đồng phục (công ty chịu — trừ lương NLĐ thì đặt "Không dùng")
  'b-bonus-perf': fixed('worker', 'month'), 'b-bonus-13': pctOf('worker', 8.33, 'base_wage'),
  'b-bonus-hire': fixed('other', 'month'), 'b-recruit': fixed('other', 'day'), 'b-supervise': fixed('other', 'day'),
  'b-uniform': fixed('compliance', 'month'),
};

export const BUILTIN_CATALOG: CatalogItem[] = RAW_BUILTIN.map(i => (BUILTIN_COST[i.id] ? { ...i, cost: BUILTIN_COST[i.id] } : i));
export const BUILTIN_BY_ID = new Map(BUILTIN_CATALOG.map(b => [b.id, b]));

/**
 * Tên / đơn vị của kho có sẵn ĐỜI ĐẦU (trước khi chia 5 nhóm). Kho của công ty lưu nguyên bản sao các mục này mà không sửa gì
 * → coi như chưa sửa, dùng bản mới (tên chuẩn, đơn vị, bản dịch mới); chỉ giữ cờ ẩn.
 */
export const LEGACY_BUILTIN: Record<string, [string, string]> = {
  'b-day12': ['Lương ca ngày 12 tiếng', 'VNĐ/ngày'], 'b-night12': ['Lương ca đêm 12 tiếng', 'VNĐ/ngày (ca đêm)'],
  'b-sun8': ['Lương Chủ nhật ca ngày 8 tiếng', 'VNĐ/ngày'], 'b-sun8n': ['Lương Chủ nhật ca đêm 8 tiếng', 'VNĐ/ngày (ca đêm)'],
  'b-hol8': ['Lương ngày Lễ, Tết ca ngày 8 tiếng', 'VNĐ/ngày'], 'b-hol8n': ['Lương ngày Lễ, Tết ca đêm 8 tiếng', 'VNĐ/ngày (ca đêm)'],
  'b-ot2': ['Lương tăng ca ngày thường 2 tiếng', 'VNĐ/2 giờ'], 'b-ot4': ['Lương tăng ca ngày thường 4 tiếng', 'VNĐ/4 giờ'],
  'b-nightallow': ['Phụ cấp ca đêm', 'VNĐ/ngày'], 'b-meal': ['Phụ cấp cơm', 'VNĐ/suất'], 'b-travel': ['Phụ cấp xăng xe', 'VNĐ/ngày'],
  'b-attend': ['Phụ cấp chuyên cần', 'VNĐ/ngày'], 'b-toxic': ['Phụ cấp độc hại', 'VNĐ/ngày'], 'b-housing': ['Phụ cấp nhà ở', 'VNĐ/tháng'],
  'b-uniform': ['Đồng phục, bảo hộ lao động', 'VNĐ/người'],
};

export const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
/** Bỏ dấu, bỏ dấu câu, "12 tiếng" / "12 giờ" / "12h" → "12h" — để so tên không phụ thuộc cách gõ. */
export const foldName = (s: string) => normName(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/(\d+)\s*(?:h|gio|tieng)\b/g, '$1h').replace(/[^a-z0-9%.]+/g, ' ').replace(/(^|\s)\.|\.(\s|$)/g, ' ').trim();

/** Tên / tên cũ của mục có sẵn → mã (cố định trong code nên dùng được để TỰ GẮN dòng cùng tên, cả ở phương án cũ). */
const BUILTIN_NAME_INDEX = new Map<string, string>();
for (const b of BUILTIN_CATALOG) for (const n of [b.name, ...(b.aliases ?? [])]) if (!BUILTIN_NAME_INDEX.has(foldName(n))) BUILTIN_NAME_INDEX.set(foldName(n), b.id);
/** Mã mục có sẵn trùng đúng tên (hoặc tên cũ) — null nếu không có. */
export const builtinRefByName = (name: string): string | null => BUILTIN_NAME_INDEX.get(foldName(name)) ?? null;

