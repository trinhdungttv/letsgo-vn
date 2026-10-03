import { describe, it, expect } from 'vitest';
import { planCuts } from './pdf';

const H = 1123;
describe('chia trang PDF theo khối', () => {
  it('vừa 1 trang → chỉ 1 trang', () => expect(planCuts([], 1100, H)).toEqual([0]));
  it('dài hơn 1 chút nhưng không quá 2px → vẫn 1 trang (không sinh trang trắng)', () => expect(planCuts([], 1124, H)).toEqual([0]));
  it('dài hơn, không có khối nào ở chỗ cắt → cắt đúng chiều cao trang', () => expect(planCuts([], 1500, H)).toEqual([0, H]));
  it('chỗ cắt rơi giữa khối nhỏ (vd khối chữ ký) → dời lên đầu khối đó', () => {
    expect(planCuts([{ top: 1000, bottom: 1300 }], 1315, H)).toEqual([0, 1000]);
  });
  it('khối nằm ngay sau chỗ cắt thì không cần dời', () => expect(planCuts([{ top: 1130, bottom: 1300 }], 1315, H)).toEqual([0, H]));
  it('dòng bảng bị cắt đôi → dời lên đầu dòng', () => {
    const rows = [{ top: 1080, bottom: 1130 }, { top: 1130, bottom: 1180 }];
    expect(planCuts(rows, 1400, H)).toEqual([0, 1080]);
  });
  it('khối quá cao (≥ 60% trang) thì để cắt tự nhiên, không đẩy cả khối sang trang sau', () => {
    expect(planCuts([{ top: 300, bottom: 1300 }], 1400, H)).toEqual([0, H]);
  });
  it('không dời quá xa: khối bắt đầu ở nửa đầu trang thì bỏ qua', () => {
    expect(planCuts([{ top: 200, bottom: 1200 }], 1400, H)).toEqual([0, H]);
  });
  it('tiêu đề mục + vùng "giữ cùng nội dung sau" (pdfKeep) nằm cuối trang → sang trang sau cùng nội dung', () => {
    // tiêu đề cao 24px ở 1090–1114, +46px keep → coi như chiếm tới 1160, vượt chỗ cắt 1123
    expect(planCuts([{ top: 1090, bottom: 1114 + 46 }], 1500, H)).toEqual([0, 1090]);
  });
  it('3 trang: mỗi chỗ cắt tính từ trang trước', () => {
    expect(planCuts([{ top: 2100, bottom: 2300 }], 3200, H)).toEqual([0, H, 2100]);
  });
});

import { fitScale, A4_H, MIN_FIT } from '../../components/workspace/costplan/QuoteDocument';
describe('thu nhỏ chữ để vừa 1 trang', () => {
  it('đã vừa → giữ nguyên', () => { expect(fitScale(900)).toBe(1); expect(fitScale(A4_H)).toBe(1); expect(fitScale(A4_H + 1)).toBe(1); });
  it('dôi ra một chút → thu nhỏ vừa đúng 1 trang (không vượt khổ)', () => {
    const f = fitScale(1394);
    expect(f).toBeLessThan(1); expect(f).toBeGreaterThanOrEqual(MIN_FIT);
    expect(1394 * f).toBeLessThanOrEqual(A4_H);
  });
  it('dôi ra quá nhiều (cần thu < 80%) → không thu, để sang trang 2', () => expect(fitScale(1500)).toBe(1));
  it('đúng ngưỡng 80% vẫn thu', () => expect(fitScale(A4_H / MIN_FIT)).toBeGreaterThanOrEqual(MIN_FIT));
});
