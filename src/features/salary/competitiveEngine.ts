// L5 — Định giá cạnh tranh (SPEC §4.6). Hàm THUẦN, không import React.
//
// Điểm cốt lõi: phép nhân ngược ở đây đi từ GIÁ KHÁCH TRẢ, không đi từ lương. "Lương tối đa có
// thể chào" = phần còn lại của doanh thu sau khi trừ chi phí gián tiếp, phụ cấp, biên mục tiêu và
// gánh nặng bảo hiểm. Đó mới là con số quyết định thắng/thua khi đấu giá với đối thủ.
import {
  buildWageTable, equivalentHours, computeRevenue, computeInsurance, directWage,
  sumAllowanceWorker, type WageTableRow,
} from './salaryEngine';
import { resolveMinWage } from './minWage';
import type {
  WageBasis, VolumeProfile, PriceBook, AllowanceLine, OverheadConfig, SupplierQuote, MinWageBatch,
} from './types';

/** Dung sai so sánh đơn giá giờ (đồng/giờ). Dưới mức này coi là bằng nhau. */
export const SHR_COMPARE_EPSILON = 0.5;

/** Chi phí gián tiếp/tháng/đầu người — dùng chung cho ta và cho ước lượng đối thủ. */
export const indirectCostOf = (o: OverheadConfig): number =>
  o.opsCostPerHeadMonth + o.otherCostPerHeadMonth + o.recruitCostPerHire * (o.monthlyTurnoverPercent / 100);

export interface MaxAffordableResult {
  shrPayMax: number;
  budget: number;
  targetProfit: number;
  revenueMonth: number;
  indirectCostMonth: number;
  equivalentHours: number;
  /** Bảng 14 dòng dựng từ shrPayMax — "BẢNG LƯƠNG TỐI ĐA CÓ THỂ CHÀO". */
  table: WageTableRow[];
}

/** §4.6(a) — phép nhân ngược QUAN TRỌNG NHẤT của cả dự án. */
export function maxAffordableShr(
  basis: WageBasis, volume: VolumeProfile, priceBook: PriceBook, allowances: AllowanceLine[],
  overhead: OverheadConfig,
): MaxAffordableResult {
  const table = buildWageTable(basis);
  const eh = equivalentHours(table, volume);
  const revenueMonth = computeRevenue(table, volume, priceBook, allowances).revenueMonth;
  const indirect = indirectCostOf(overhead);

  const targetProfit = revenueMonth * overhead.targetNetMarginPercent / 100;
  let budget = revenueMonth - indirect - targetProfit - sumAllowanceWorker(allowances);

  let shrPayMax: number;
  if (basis.shrBhxhMode === 'custom') {
    // Nền BHXH CỐ ĐỊNH → chi phí bảo hiểm không đổi theo lương, trừ thẳng ra khỏi ngân sách.
    const ins = computeInsurance(basis, allowances, overhead);
    budget -= (ins.employerInsurance + ins.unionFee);
    shrPayMax = eh > 0 ? budget / eh : 0;
  } else {
    // Nền BHXH BÁM THEO LƯƠNG → mỗi đồng lương kéo theo (21,5% + 2%) trên 8h × ngày công, nên
    // phải chia cho (EH + gánh nặng bảo hiểm) chứ không phải chia cho EH.
    const insLoad = (overhead.employerInsurancePercent + overhead.unionFeePercent) / 100
      * 8 * basis.workdaysPerMonth;
    const denom = eh + insLoad;
    shrPayMax = denom > 0 ? budget / denom : 0;
  }

  return {
    shrPayMax,
    budget,
    targetProfit,
    revenueMonth,
    indirectCostMonth: indirect,
    equivalentHours: eh,
    table: buildWageTable({ ...basis, shrPay: Math.max(0, shrPayMax), overrides: {} }),
  };
}

export interface CompetitorStat {
  id: string;
  supplierName: string;
  shrPay: number;
  /** Gói NLĐ nhận/tháng — chạy trên CÙNG volume profile mới so được (§5.6). */
  packageForWorker: number;
  directCost: number;
  /** Giá khách trả − chi phí lương của họ. Cho biết họ còn bao nhiêu room hạ giá tiếp. */
  impliedMargin: number;
  table: WageTableRow[];
}

/** Các số phải in trong banner FLAG_CANNOT_WIN (§5.6).
 *
 *  ⚠ §5.6 dùng CÙNG một chữ "Y" cho hai đại lượng KHÁC NHAU: "thiếu Y đ/tháng/người" và "giảm chi
 *  phí gián tiếp Y đ/tháng". Hai số này không bằng nhau khi nền BHXH bám theo lương: mỗi đồng lương
 *  tăng thêm còn kéo theo 23,5% bảo hiểm + KPCĐ, nên muốn trả thêm gapPerMonth tiền lương thì phải
 *  cắt NHIỀU HƠN thế mới đủ. Tách làm 2 field, không gộp — gộp là in ra một lời khuyên sai. */
export interface CannotWinRemedy {
  /** X — thiếu bao nhiêu đ/giờ. */
  gapPerHour: number;
  /** Y₁ — phần LƯƠNG còn thiếu, đ/tháng/người (= X × EH). Đây là số §5.6 định nghĩa. */
  gapPerMonth: number;
  /** Y₂ — số tiền chi phí gián tiếp phải CẮT để đủ chào mức đề xuất (đã gồm gánh bảo hiểm). */
  indirectCutNeeded: number;
  /** Z — biên mục tiêu phải hạ xuống còn bao nhiêu % để vừa đủ chào mức shrProposed. */
  targetMarginNeededPercent: number;
  /** W — giá khách cần đàm phán lên bao nhiêu đ/ngày công (ca 8h), quy theo tỷ trọng giờ hiện tại. */
  customerPricePerWorkdayNeeded: number;
}

export interface CompetitiveResult {
  us: MaxAffordableResult;
  competitors: CompetitorStat[];
  strongest: CompetitorStat | null;
  /** Bảng "Biên ngầm của đối thủ" — sắp xếp giảm dần (§5.6). */
  impliedMarginTable: CompetitorStat[];
  shrCompetitorMax: number;
  shrFloorLegal: number;
  shrProposed: number;
  proposedTable: WageTableRow[];
  flagCannotWin: boolean;
  flagBelowLegal: boolean;
  /** shrPayMax > shr_competitor_max × 1,15 → banner xanh "có room lớn". */
  flagBigRoom: boolean;
  /** % có thể chào cao hơn đối thủ mạnh nhất mà vẫn đạt biên mục tiêu. */
  roomAbovePercent: number;
  gapPerHour: number;
  gapPerMonth: number;
  remedy: CannotWinRemedy | null;
  legalRule: ReturnType<typeof resolveMinWage>;
}

/** §4.6(b)(c). `deltaPercent` = vượt đối thủ mạnh nhất bao nhiêu % (mặc định 2). */
export function computeCompetitive(
  basis: WageBasis, volume: VolumeProfile, priceBook: PriceBook, allowances: AllowanceLine[],
  overhead: OverheadConfig, competitors: SupplierQuote[],
  deltaPercent = 2, atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): CompetitiveResult {
  const us = maxAffordableShr(basis, volume, priceBook, allowances, overhead);
  const ourTable = buildWageTable(basis);
  const eh = equivalentHours(ourTable, volume);
  const revenueMonth = us.revenueMonth;
  const indirect = us.indirectCostMonth;

  const stats: CompetitorStat[] = competitors.map(c => {
    // Ép về ĐÚNG ngày công dùng chung; volume profile cũng dùng chung — mỗi NCC một profile riêng
    // thì câu hỏi "ai trả NLĐ cao hơn" là vô nghĩa (§5.6).
    const cBasis: WageBasis = { ...c.basis, workdaysPerMonth: basis.workdaysPerMonth };
    const cTable = buildWageTable(cBasis);
    const cWage = directWage(cTable, volume);
    const cAllowW = sumAllowanceWorker(c.allowances);
    const cIns = computeInsurance(cBasis, c.allowances, overhead);
    const cDirect = cWage + cAllowW + cIns.employerInsurance + cIns.unionFee;
    return {
      id: c.id,
      supplierName: c.supplierName,
      shrPay: c.basis.shrPay,
      packageForWorker: cWage + cAllowW,
      directCost: cDirect,
      impliedMargin: revenueMonth - cDirect - indirect,
      table: cTable,
    };
  });

  const strongest = stats.reduce<CompetitorStat | null>(
    (best, s) => (best == null || s.shrPay > best.shrPay ? s : best), null);
  const shrCompetitorMax = strongest?.shrPay ?? 0;
  const legalRule = resolveMinWage(basis.region, atDate, dbBatches);
  const shrFloorLegal = legalRule?.hourly ?? 0;
  const shrProposed = Math.max(shrCompetitorMax * (1 + deltaPercent / 100), shrFloorLegal);

  const gapPerHour = shrProposed - us.shrPayMax;
  const gapPerMonth = gapPerHour * eh;
  // So sánh có dung sai: chênh dưới nửa đồng/giờ không phải một tình huống kinh doanh thật, mà chỉ
  // là sai số dấu phẩy động. Không có epsilon thì đúng tại điểm hoà vốn banner sẽ nhấp nháy, và
  // lời khuyên "đàm phán lên W đồng" hoá ra vẫn báo đỏ sau khi người dùng đã làm đúng như vậy.
  const flagCannotWin = gapPerHour > SHR_COMPARE_EPSILON;

  // §5.6: banner phải in ĐỦ 4 số, không được nói chung chung. Mỗi số là một cách khác nhau để
  // đóng đúng khoảng thiếu gapPerMonth.
  const isCustomBhxh = basis.shrBhxhMode === 'custom';
  const insLoad = isCustomBhxh ? 0
    : (overhead.employerInsurancePercent + overhead.unionFeePercent) / 100 * 8 * basis.workdaysPerMonth;
  // Mẫu số mà shrPayMax đã được chia cho — mọi phép "cần thêm bao nhiêu" phải nhân lại đúng nó.
  const denom = isCustomBhxh ? eh : eh + insLoad;
  const fixedIns = isCustomBhxh
    ? (() => { const i = computeInsurance(basis, allowances, overhead); return i.employerInsurance + i.unionFee; })()
    : 0;
  const allowW = sumAllowanceWorker(allowances);
  /** Tổng chi phí/tháng nếu trả đúng mức đề xuất — chưa gồm biên mục tiêu. */
  const costAtProposed = shrProposed * denom + indirect + allowW + fixedIns;

  const remedy: CannotWinRemedy | null = flagCannotWin ? {
    gapPerHour,
    gapPerMonth,
    // Thiếu hụt NGÂN SÁCH = X × mẫu số (không phải × EH) — vì phần lương tăng thêm còn kéo bảo hiểm.
    indirectCutNeeded: gapPerHour * denom,
    // Hạ biên mục tiêu xuống mức vừa đủ (âm ⇒ kể cả biên 0 vẫn không đủ, phải đàm phán giá).
    targetMarginNeededPercent: revenueMonth > 0 ? (revenueMonth - costAtProposed) / revenueMonth * 100 : 0,
    // Hoặc giữ biên mục tiêu và đàm phán giá khách lên mức này. Quy doanh thu cần thiết về đơn giá
    // 1 ngày công (ca 8h) theo đúng tỷ trọng giờ đang chạy: revenue = rate/8 × EH.
    customerPricePerWorkdayNeeded: eh > 0
      ? (costAtProposed / (1 - overhead.targetNetMarginPercent / 100)) * 8 / eh
      : 0,
  } : null;

  return {
    us,
    competitors: stats,
    strongest,
    impliedMarginTable: [...stats].sort((a, b) => b.impliedMargin - a.impliedMargin),
    shrCompetitorMax,
    shrFloorLegal,
    shrProposed,
    proposedTable: buildWageTable({ ...basis, shrPay: shrProposed, overrides: {} }),
    flagCannotWin,
    // Không đủ tiền trả tới sàn pháp lý ⇒ job này KHÔNG NHẬN ĐƯỢC, không phải "biên mỏng".
    flagBelowLegal: shrFloorLegal > 0 && us.shrPayMax < shrFloorLegal,
    flagBigRoom: shrCompetitorMax > 0 && us.shrPayMax > shrCompetitorMax * 1.15,
    roomAbovePercent: shrCompetitorMax > 0 ? (us.shrPayMax / shrCompetitorMax - 1) * 100 : 0,
    gapPerHour,
    gapPerMonth,
    remedy,
    legalRule,
  };
}
