// Port từ PRM Tony Study (src/lib/prm/contactActions.test.mjs) + tách nhiều số của LetsGo.
import { describe, it, expect } from 'vitest';
import {
  normalizePhone, primaryPhone, zaloPhoneOf, contactActionLinks, zaloUrl, interactionTypeOfChannel, splitPhones,
} from './contactActions';

describe('chuẩn hoá số điện thoại', () => {
  it('số Việt Nam: bỏ khoảng trắng/dấu, +84 → 0', () => {
    expect(normalizePhone('0901 234 567')).toBe('0901234567');
    expect(normalizePhone('090.123.4567')).toBe('0901234567');
    expect(normalizePhone('(090) 123-4567')).toBe('0901234567');
    expect(normalizePhone('+84 90 123 4567')).toBe('0901234567');
    expect(normalizePhone('+84901234567')).toBe('0901234567');
    expect(normalizePhone('84901234567')).toBe('0901234567');
    expect(normalizePhone('0084901234567')).toBe('0901234567');
    expect(normalizePhone('+84 (0) 901 234 567')).toBe('0901234567');
  });

  it('số nội địa bắt đầu bằng 84 nhưng ngắn không bị coi là quốc tế', () => {
    expect(normalizePhone('8412345')).toBe('8412345');
  });

  it('số nước ngoài giữ dạng +<mã nước>', () => {
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('rỗng / không có chữ số → chuỗi rỗng', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone('không có')).toBe('');
  });
});

describe('LetsGo: cột phone nhập nhiều số', () => {
  it('tách theo phẩy / chấm phẩy / gạch chéo / xuống dòng', () => {
    expect(splitPhones('0901 234 567, 0912 345 678')).toEqual(['0901 234 567', '0912 345 678']);
    expect(splitPhones('0901234567 / 0281234567;0909\n0911')).toEqual(['0901234567', '0281234567', '0909', '0911']);
    expect(splitPhones(null)).toEqual([]);
    expect(splitPhones(' , ')).toEqual([]);
  });
});

describe('nút Gọi / Zalo / SMS', () => {
  it('primaryPhone lấy số dùng được đầu tiên', () => {
    expect(primaryPhone({ phones: ['', 'n/a', '+84 91 111 2222', '0903333444'] })).toBe('0911112222');
    expect(primaryPhone({ phones: [] })).toBe('');
  });

  it('Zalo: ưu tiên số Zalo riêng, không có thì dùng số chính', () => {
    expect(zaloPhoneOf({ phones: ['0901234567'], zaloPhone: '+84 98 777 6666' })).toBe('0987776666');
    expect(zaloPhoneOf({ phones: ['0901234567'], zaloPhone: '' })).toBe('0901234567');
    expect(zaloPhoneOf({ phones: [], zaloPhone: '' })).toBe('');
  });

  it('chỉ trả về nút có dữ liệu', () => {
    expect(contactActionLinks({ phones: [], zaloPhone: '' })).toEqual([]);
    expect(contactActionLinks({ phones: [], zaloPhone: '0988777666' }).map(l => l.channel)).toEqual(['zalo']);
    expect(contactActionLinks({ phones: ['+84 90 123 4567'], zaloPhone: '' }).map(l => [l.channel, l.url])).toEqual([
      ['call', 'tel:0901234567'],
      ['zalo', 'https://zalo.me/0901234567'],
      ['sms', 'sms:0901234567'],
    ]);
  });

  it('zaloUrl bỏ dấu + cho số quốc tế', () => {
    expect(zaloUrl('+14155550100')).toBe('https://zalo.me/14155550100');
    expect(zaloUrl('0901234567')).toBe('https://zalo.me/0901234567');
  });

  it('Zalo và SMS đều ghi là tin nhắn, gọi là cuộc gọi', () => {
    expect(interactionTypeOfChannel('call')).toBe('call');
    expect(interactionTypeOfChannel('zalo')).toBe('message');
    expect(interactionTypeOfChannel('sms')).toBe('message');
  });
});
