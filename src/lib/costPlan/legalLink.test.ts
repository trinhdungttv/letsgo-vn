import { describe, expect, it } from 'vitest';
import { DEFAULT_HEADER, DEFAULT_LAYOUT, findEntity, normalizeHeader, normalizeLayout, pickEntity, type LegalEntityLite, type StampRow } from './entity';
import { entityIndex, isGenericLabel, mergeEntities, sameCompany, shortEntityName } from './legalLink';
import { emptyProfile } from './quoteDoc';

const legal = (p: Partial<LegalEntityLite> & { id: string; name: string }): LegalEntityLite => ({
  short_name: '', tax_code: '', address: '', phone: '', email: '', website: '', legal_rep: '', legal_rep_title: '',
  status: 'active', logo_url: null, quote_entity_id: null, color: '#0071E3', ...p,
});
const stamp = (p: Partial<StampRow> & { id: string }): StampRow => ({
  label: 'Pháp nhân 1', data: emptyProfile(), layout: DEFAULT_LAYOUT, logo: null, signature: null, seal: null,
  has_signature: false, has_seal: false, sort_order: 0, updated_by_name: null, updated_at: null, legal_entity_id: null, ...p,
});

describe('shortEntityName', () => {
  it('bỏ loại hình doanh nghiệp đứng đầu', () => {
    expect(shortEntityName("CÔNG TY CỔ PHẦN LET'S GO VN")).toBe("LET'S GO VN");
    expect(shortEntityName('Công ty TNHH MTV Dịch vụ ABC')).toBe('Dịch vụ ABC');
    expect(shortEntityName('Công ty trách nhiệm hữu hạn Một thành viên XYZ')).toBe('XYZ');
    expect(shortEntityName('Chi nhánh Công ty TNHH Let’s Go - Bình Dương')).toBe('Let’s Go - Bình Dương');
  });
  it('không có loại hình → giữ nguyên; chỉ có loại hình → giữ nguyên', () => {
    expect(shortEntityName('Lets Go Group')).toBe('Lets Go Group');
    expect(shortEntityName('Công ty')).toBe('Công ty');
    expect(shortEntityName('')).toBe('');
  });
  it('tên tự đặt "Pháp nhân 1" coi là chưa đặt', () => {
    expect(isGenericLabel('Pháp nhân 1')).toBe(true);
    expect(isGenericLabel('  phap nhan 2 ')).toBe(true);
    expect(isGenericLabel('LGVN')).toBe(false);
  });
});

describe('sameCompany', () => {
  it('cùng MST (bỏ dấu cách / gạch) hoặc cùng tên bỏ dấu', () => {
    expect(sameCompany({ name: 'X', taxCode: '3603 123 456' }, { name: 'Y', tax_code: '3603123456' })).toBe(true);
    expect(sameCompany({ name: "CÔNG TY CỔ PHẦN LET'S GO VN", taxCode: '' }, { name: "Công ty Cổ phần Let's Go VN", tax_code: '' })).toBe(true);
    expect(sameCompany({ name: 'Công ty A', taxCode: '' }, { name: 'Công ty B', tax_code: '' })).toBe(false);
    expect(sameCompany({ name: '', taxCode: '' }, { name: '', tax_code: '' })).toBe(false);
  });
});

describe('mergeEntities', () => {
  const lg = legal({
    id: 'L1', name: "CÔNG TY CỔ PHẦN LET'S GO VN", short_name: 'LGVN', tax_code: '3603000111', address: '273 Tổ 5, Long Bình, Đồng Nai',
    phone: '0251 000', legal_rep: 'Trịnh Văn Dũng', legal_rep_title: 'Tổng Giám đốc', logo_url: 'https://x/logo.png',
  });

  it('thông tin lấy từ Pháp lý, chữ ký / con dấu / nơi ký giữ ở bộ ký-dấu cũ (ghép theo tên)', () => {
    const s = stamp({
      id: 'Q1', data: { ...emptyProfile(), name: "CÔNG TY CỔ PHẦN LET'S GO VN", address: 'địa chỉ cũ', website: 'https://vieclamletsgo.com/', place: 'Biên Hòa' },
      signature: 'data:sig', seal: 'data:seal', has_signature: true, has_seal: true, logo: 'data:own-logo',
    });
    const [e, ...rest] = mergeEntities([s], [lg], new Map([['https://x/logo.png', 'data:legal-logo']]));
    expect(rest).toHaveLength(0);
    expect(e.id).toBe('L1');
    expect(e.stamp_id).toBe('Q1');
    expect(e.label).toBe('LGVN');
    expect(e.data.address).toBe('273 Tổ 5, Long Bình, Đồng Nai');
    expect(e.data.website).toBe('https://vieclamletsgo.com/');           // Pháp lý trống → giữ dữ liệu cũ
    expect(e.data.signerName).toBe('Trịnh Văn Dũng');
    expect(e.data.signerTitle).toBe('Tổng Giám đốc');
    expect(e.data.place).toBe('Biên Hòa');
    expect(e.signature).toBe('data:sig');
    expect(e.logo).toBe('data:legal-logo');
    expect(e.logo_source).toBe('legal');
    expect(e.own.data.address).toBe('địa chỉ cũ');                        // lưu lại không ghi đè bằng dữ liệu Pháp lý
  });

  it('người ký ghi riêng (uỷ quyền) thắng người đại diện; logo riêng khi bật logoOwn hoặc Pháp lý chưa có logo', () => {
    const s = stamp({ id: 'Q1', legal_entity_id: 'L1', data: { ...emptyProfile(), signerName: 'Nguyễn B', signerTitle: 'Phó Giám đốc' }, logo: 'data:own', layout: { ...DEFAULT_LAYOUT, logoOwn: true } });
    const [e] = mergeEntities([s], [lg], new Map([['https://x/logo.png', 'data:legal-logo']]));
    expect(e.data.signerName).toBe('Nguyễn B');
    expect(e.data.signerTitle).toBe('Phó Giám đốc');
    expect(e.logo).toBe('data:own');
    const [e2] = mergeEntities([stamp({ id: 'Q1', legal_entity_id: 'L1', logo: 'data:own' })], [lg]);   // tải logo Pháp lý lỗi
    expect(e2.logo).toBe('data:own');
    expect(e2.logo_source).toBe('own');
  });

  it('pháp nhân Pháp lý chưa có bộ ký/dấu vẫn dùng được (stamp_id null); tên viết tắt tự lấy từ tên công ty', () => {
    const l2 = legal({ id: 'L2', name: 'Công ty TNHH Orient Office', legal_rep: 'A' });
    const list = mergeEntities([], [lg, l2]);
    expect(list.map(e => e.label)).toEqual(['LGVN', 'Orient Office']);
    expect(list[1].stamp_id).toBeNull();
    expect(list[1].has_signature).toBe(false);
  });

  it('thứ tự ghép: legal_entity_id → quote_entity_id ở Pháp lý → MST → tên; bộ chưa gắn hiện cuối', () => {
    const a = legal({ id: 'A', name: 'Công ty A', quote_entity_id: 'Q2' });
    const b = legal({ id: 'B', name: 'Công ty B', tax_code: '0101' + '234567' });
    const c = legal({ id: 'C', name: 'Công ty C' });
    const stamps = [
      stamp({ id: 'Q1', legal_entity_id: 'C' }),
      stamp({ id: 'Q2', data: { ...emptyProfile(), name: 'tên khác' } }),
      stamp({ id: 'Q3', data: { ...emptyProfile(), taxCode: '0101234567' } }),
      stamp({ id: 'Q4', label: 'Pháp nhân 4', data: { ...emptyProfile(), name: 'CÔNG TY TNHH MỚI' } }),
    ];
    const list = mergeEntities(stamps, [a, b, c]);
    expect(list.map(e => [e.id, e.stamp_id])).toEqual([['A', 'Q2'], ['B', 'Q3'], ['C', 'Q1'], ['Q4', 'Q4']]);
    expect(list[3].legal_id).toBeNull();
    expect(list[3].label).toBe('MỚI');
  });

  it('pháp nhân đã giải thể: ẩn cả bộ ký/dấu đã gắn; Pháp lý tải lỗi → vẫn còn bộ ký/dấu cũ', () => {
    const d = legal({ id: 'D', name: 'Công ty D', status: 'dissolved' });
    expect(mergeEntities([stamp({ id: 'Q1', legal_entity_id: 'D' })], [d])).toHaveLength(0);
    const list = mergeEntities([stamp({ id: 'Q1', legal_entity_id: 'D', label: 'D cũ' })], []);
    expect(list.map(e => e.label)).toEqual(['D cũ']);
  });

  it('giấy tờ cũ lưu id bộ ký/dấu vẫn tìm ra pháp nhân', () => {
    const list = mergeEntities([stamp({ id: 'Q1', legal_entity_id: 'L1' })], [lg]);
    expect(findEntity(list, 'Q1')?.id).toBe('L1');
    expect(findEntity(list, 'L1')?.id).toBe('L1');
    expect(findEntity(list, 'zzz')).toBeNull();
    expect(pickEntity(list, 'Q1', null)?.id).toBe('L1');
    expect(entityIndex(list).get('Q1')?.label).toBe('LGVN');
  });
});

describe('đầu trang (HeaderLayout)', () => {
  it('giới hạn giá trị, thụt lề làm tròn 9px, giữ khi chuẩn hoá layout', () => {
    expect(normalizeHeader(null)).toBeNull();
    const h = normalizeHeader({ logoScale: 9, logoDx: 40, headDx: 20, headAlign: 'center', titleScale: 0.1 });
    expect(h).toEqual({ ...DEFAULT_HEADER, logoScale: 2.5, logoDx: 40, headDx: 18, headAlign: 'center', titleScale: 0.6 });
    const l = normalizeLayout({ header: { logoScale: 1.5 }, logoOwn: true });
    expect(l.header?.logoScale).toBe(1.5);
    expect(l.logoOwn).toBe(true);
    expect(normalizeLayout({}).header).toBeUndefined();
  });
});
