import { describe, it, expect } from 'vitest';
import { buildCompanyIndex, companyKey, compareKeys, editDistance, findDuplicatePairs, findSimilarCompanies, worstLevel } from './companyMatch';

const idx = (...names: string[]) => buildCompanyIndex({ clients: names.map((name, i) => ({ id: `c${i}`, name })), pipeline: [], leads: [] });
const top = (name: string, ...existing: string[]) => findSimilarCompanies(name, idx(...existing))[0];

describe('chuẩn hoá tên công ty', () => {
  it('bỏ dấu, loại hình, ký tự thừa, dính chữ → cùng tên lõi', () => {
    for (const n of ['Ampacs', '- Ampacs', '-Công ty tNHH ampacs', 'CÔNG TY TNHH AMPACS VIỆT NAM', 'côngty ampacs', 'Cty TNHH Ampacs (Vietnam)', 'AMPACS Co., Ltd', 'Công ty Cổ phần Ampacs', 'CTCP Ampacs']) {
      expect(companyKey(n).core, n).toBe('ampacs');
    }
    expect(companyKey('Pou Chen').core).toBe(companyKey('POUCHEN').core);
  });
  it('"CP", "Việt" là tên riêng thì giữ; chỉ bỏ "Việt Nam" ở cuối', () => {
    expect(companyKey('CÔNG TY TNHH CÔNG NGHIỆP BAO CP VIỆT NAM').tokens).toEqual(['cong', 'nghiep', 'bao', 'cp']);
    expect(companyKey('Công ty TNHH Bao bì Trường Việt').tokens).toEqual(['bao', 'bi', 'truong', 'viet']);
    expect(companyKey('Công ty CP Việt Tiến').core).toBe('viettien');
    expect(companyKey('Công ty Cổ phần ABC').core).toBe('abc');
  });
});

describe('khoảng cách chỉnh sửa', () => {
  it('thiếu / thừa / sai / đảo 2 chữ liền kề = 1 bước', () => {
    expect(editDistance('ampacs', 'ampasc')).toBe(1);   // đảo
    expect(editDistance('ampacs', 'ampac')).toBe(1);    // thiếu
    expect(editDistance('ampacs', 'ampacss')).toBe(1);  // thừa
    expect(editDistance('ampacs', 'ampaxs')).toBe(1);   // sai
    expect(editDistance('ampacs', 'zzzzzz', 2)).toBeGreaterThan(2);
  });
});

describe('dò công ty đã tồn tại (ví dụ của user: Ampacs / Công ty tNHH ampacs / côngty ampasc)', () => {
  it('cả 3 cách gõ đều bắt được công ty "Ampacs" đã có', () => {
    expect(top('Công ty tNHH ampacs', 'Ampacs')).toMatchObject({ level: 'same' });
    expect(top('- Ampacs', 'Công ty TNHH Ampacs')).toMatchObject({ level: 'same' });
    const t = top('côngty ampasc', 'Ampacs');
    expect(t.level).toBe('likely');
    expect(t.entry.name).toBe('Ampacs');
    expect(t.reason).toMatch(/1 ký tự/);
  });
  it('copy thiếu / thừa 1 ký tự, sai dấu, dính chữ', () => {
    expect(top('Công ty TNHH Baolijia Vietnam', 'CÔNG TY TNHH VẬT LIỆU MỚI BAOLIJIA(VIETNAM)')?.level).toBeTruthy();
    expect(top('Pou Chen Vietnam', 'CÔNG TY TNHH POU CHEN VIỆT NAM').level).toBe('same');
    expect(top('Công ty Pouchen', 'Công ty TNHH Pou Chen Việt Nam').level).toBe('same');
    expect(top('Cong ty TNHH Bao bi Truong Viet', 'CÔNG TY TNHH BAO BÌ TRƯỜNG VIỆT').level).toBe('same');
    expect(top('Công ty TNHH Bao bi Truong Vie', 'CÔNG TY TNHH BAO BÌ TRƯỜNG VIỆT').level).toBe('likely');   // thiếu 1 chữ cuối
    expect(top('Sinodod', 'Sinodod - Sx bo mạch điện tử')?.level).toBe('maybe');                                // tên nằm trong tên dài
  });
  it('từ ngành chung (sản xuất, thương mại…) không làm mất nhận diện', () => {
    expect(top('Công ty TNHH Sản xuất Thương mại Ampacs', 'Ampacs').level).toBe('likely');
  });
  it('công ty khác nhau KHÔNG bị báo trùng', () => {
    expect(findSimilarCompanies('Công ty TNHH Samsung', idx('Công ty TNHH Sanyo', 'LG Display', 'Công ty TNHH Pou Chen'))).toEqual([]);
    expect(findSimilarCompanies('Ampacs', idx('Ampere Technology', 'Amcor Packaging'))).toEqual([]);
    expect(findSimilarCompanies('Bao bì Trường Việt', idx('Bao bì Trường Phát'))).toEqual([]);
  });
  it('khác số thì chỉ là nghi ngờ (cơ sở khác), không phải "rất giống"; tên quá ngắn chỉ so khi giống hệt', () => {
    expect(top('Công ty ABC 2', 'Công ty ABC 1')?.level).toBe('maybe');
    expect(top('Công ty ABC Tech 3', 'Công ty XYZ 1')).toBeUndefined();
    expect(findSimilarCompanies('ABD', idx('ABC'))).toEqual([]);
    expect(top('LG', 'LG Electronics')).toBeUndefined();                       // < 3 ký tự lõi không dò
    expect(top('Công ty TNHH', 'Công ty TNHH ABC')).toBeUndefined();
  });
  it('sắp giống nhất lên đầu, có giới hạn; bỏ qua chính bản ghi đang sửa', () => {
    const index = idx('Ampacs', 'Ampacs Packaging', 'Ampac');
    const hits = findSimilarCompanies('Công ty Ampacs', index);
    expect(hits.map(h => h.entry.name)).toEqual(['Ampacs', 'Ampac', 'Ampacs Packaging']);
    expect(findSimilarCompanies('Ampacs', index, { limit: 1 })).toHaveLength(1);
    expect(findSimilarCompanies('Ampacs', index, { ignoreIds: ['c0'] }).map(h => h.entry.name)).not.toContain('Ampacs');
    expect(worstLevel(hits)).toBe('same');
    expect(worstLevel([])).toBeNull();
  });
});

describe('chỉ mục gộp theo liên kết', () => {
  it('khách hàng + hồ sơ CRM + dự án thị trường liên kết nhau = 1 công ty (không báo trùng chính nó); không liên kết thì là bản trùng thật', () => {
    const index = buildCompanyIndex({
      clients: [{ id: 'c1', name: 'CÔNG TY TNHH AMPACS' }],
      pipeline: [{ id: 'p1', company_name: 'Ampacs', client_id: 'c1', note: 'Hợp tác' }, { id: 'p2', company_name: 'Ampacs VN' }],
      leads: [{ id: 'l1', company_name: 'ampacs', crm_id: 'p1' }, { id: 'l2', company_name: 'Ampasc' }],
    });
    expect(index).toHaveLength(3);
    expect(index[0].refs.map(r => r.source)).toEqual(['client', 'pipeline', 'lead']);
    expect(index[0].name).toBe('CÔNG TY TNHH AMPACS');
    const hits = findSimilarCompanies('Ampacs', index);
    expect(hits).toHaveLength(3);
    expect(hits.map(h => h.entry.refs[0].id).sort()).toEqual(['c1', 'l2', 'p2']);
  });
  it('so cả tên ở các nguồn: tên ở Khách hàng khác hẳn nhưng tên ở Pipeline giống', () => {
    const index = buildCompanyIndex({ clients: [{ id: 'c1', name: 'Tập đoàn Zhongshan' }], pipeline: [{ id: 'p1', company_name: 'Ampacs', client_id: 'c1' }], leads: [] });
    expect(findSimilarCompanies('Ampasc', index)[0]?.entry.name).toBe('Tập đoàn Zhongshan');
  });
});

describe('tìm trùng lẫn nhau trong danh sách (file nhập, quét dữ liệu)', () => {
  it('ra các cặp trùng, giống nhất trước; bỏ qua cặp khác nhau', () => {
    const names = ['Ampacs', 'Công ty TNHH Ampacs', 'Samsung', 'côngty ampasc', 'LG Display', 'Công ty LG Dispaly'];
    const pairs = findDuplicatePairs(names).map(p => [p.i, p.j, p.match.level]);
    expect(pairs).toContainEqual([0, 1, 'same']);
    expect(pairs).toContainEqual([0, 3, 'likely']);
    expect(pairs).toContainEqual([4, 5, 'likely']);
    expect(pairs.some(([i, j]) => i === 2 || j === 2)).toBe(false);
  });
  it('compareKeys đối xứng', () => {
    const a = companyKey('Ampacs'), b = companyKey('Ampasc');
    expect(compareKeys(a, b)?.level).toBe(compareKeys(b, a)?.level);
  });
});
