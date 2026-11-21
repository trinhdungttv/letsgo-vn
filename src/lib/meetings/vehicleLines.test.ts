import { describe, expect, it } from 'vitest';
import { vehicleLines } from './gateList';
import { normalizeGate } from './types';

describe('xe đi họp', () => {
  it('1 xe: không đánh số; 2 xe: đánh số', () => {
    expect(vehicleLines([{ type: 'Ô tô 4 chỗ', plate: '51l-97992' }])).toEqual(['Phương tiện đăng ký vào cổng:', 'Xe: Ô tô 4 chỗ - BKS: 51L-97992']);
    expect(vehicleLines([{ type: 'Xe máy', plate: '' }, { type: '', plate: '60A-1' }]).slice(1)).toEqual(['1. Xe: Xe máy', '2. Xe: BKS: 60A-1']);
    expect(vehicleLines([])).toEqual([]);
  });
  it('đọc lại bản cũ chỉ có biển số (chuỗi)', () => {
    expect(normalizeGate({ vehicles: ['51L-97992', { type: 'Xe máy', plate: '' }, ''] }).vehicles).toEqual([{ type: '', plate: '51L-97992' }, { type: 'Xe máy', plate: '' }]);
  });
});
