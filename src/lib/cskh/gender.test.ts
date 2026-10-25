// Port từ PRM Tony Study (src/lib/prm/gender.test.mjs) + kiểu tên của danh bạ LetsGo.
import { describe, expect, it } from 'vitest';
import { effectiveGender, guessGender, matchesGender } from './gender';
import type { Gender } from './types';

const g = (fullName: string, nickname = '') => guessGender({ fullName, nickname })?.gender ?? null;

describe('đoán giới tính theo tên', () => {
  it('tên đệm Thị / Văn trong họ tên đầy đủ', () => {
    expect(g('E Hương - TP Nhân Sự', 'Trần Thị Hương')).toBe('female');
    expect(g('Nguyễn Thị Lan')).toBe('female');
    expect(g('Lê Văn Tám')).toBe('male');
    expect(g('Trưởng Văn Phòng')).toBeNull(); // "Văn phòng" không phải tên đệm
  });

  it('xưng hô ở đầu tên', () => {
    expect(g('C Lan')).toBe('female');
    expect(g('CHỊ THẢO - KẾ TOÁN')).toBe('female');
    expect(g('Ms. Sở')).toBe('female');
    expect(g('Cô Mai')).toBe('female');
    expect(g('A Khoa - Piano')).toBe('male');
    expect(g('Anh Minh')).toBe('male');
    expect(g('Mr Tuấn')).toBe('male');
    expect(g('TTV - Chị Lan')).toBe('female');
  });

  it('kiểu tên danh bạ LetsGo: "Ms Lan – HR", "Mr. Kim (Hàn)", "[KH] Mrs Hoa"', () => {
    expect(g('Ms Lan – HR')).toBe('female');
    expect(g('Ms Thanh - TP Nhân Sự - Midea')).toBe('female');
    expect(g('Mr. Kim (Hàn)')).toBe('male');
    expect(g('MR PARK')).toBe('male');
    expect(g('[KH] Mrs Hoa')).toBe('female');
    expect(g('Msa Trading')).toBeNull(); // "Ms" phải là một từ riêng
  });

  it('không đoán khi không chắc: "E" (em), "Bác", tên trơn', () => {
    expect(g('E Nhi - TTV')).toBeNull();
    expect(g('BÁC TƯ')).toBeNull();
    expect(g('Hoài Phương - MKT')).toBeNull();
    expect(g('Ngọc Ánh - MKT')).toBeNull();
    expect(g('Cường')).toBeNull(); // "C" phải đứng riêng mới là "Chị"
    expect(g('An Nhiên')).toBeNull(); // "A" phải đứng riêng mới là "Anh"
  });

  it('có lý do để hiện cho người dùng', () => {
    expect(guessGender({ fullName: 'Ms Lan', nickname: '' })?.reason).toBe('Ms. / Mrs.');
    expect(guessGender({ fullName: 'Nguyễn Thị Lan', nickname: '' })?.reason).toBe('Tên đệm "Thị"');
  });
});

describe('bộ lọc giới tính', () => {
  const p = (fullName: string, gender: Gender) => ({ fullName, nickname: '', gender });
  it('đã lưu / chưa rõ / gợi ý', () => {
    const lan = p('C Lan', '');
    const hoa = p('Hoa', 'female');
    const tuan = p('A Tuấn', 'male');
    expect(matchesGender(hoa, 'female')).toBe(true);
    expect(matchesGender(tuan, 'female')).toBe(false);
    expect(matchesGender(lan, 'unknown')).toBe(true);
    expect(matchesGender(lan, 'guess_female')).toBe(true);
    expect(matchesGender(hoa, 'guess_female')).toBe(false); // đã đặt rồi thì không còn là gợi ý
    expect(matchesGender(lan, 'guess_male')).toBe(false);
    expect(matchesGender(tuan, 'all')).toBe(true);
  });

  it('giới tính hiệu lực: đã lưu > gợi ý theo tên', () => {
    expect(effectiveGender(p('Ms Lan', 'male'))).toEqual({ gender: 'male', guessed: false });
    expect(effectiveGender(p('Ms Lan', ''))).toEqual({ gender: 'female', guessed: true });
    expect(effectiveGender(p('Lan', ''))).toEqual({ gender: '', guessed: false });
  });
});
