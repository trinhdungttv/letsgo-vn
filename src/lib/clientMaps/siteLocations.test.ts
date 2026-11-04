// Vị trí nhà máy của khách: gộp điểm trùng chỗ, ưu tiên nhà máy đã ghim.
import { describe, expect, it } from 'vitest';
import { dedupeLocations, type SiteLocation } from './siteLocations';

const loc = (key: string, source: SiteLocation['source'], lat: number, lng: number): SiteLocation => ({ key, label: key, source, lat, lng });

describe('dedupeLocations', () => {
  it('2 điểm cách nhau dưới 40 m chỉ giữ điểm đứng trước (nhà máy đã ghim)', () => {
    const out = dedupeLocations([loc('f', 'factory', 11.2967, 106.6285), loc('c', 'client', 11.29672, 106.62851)]);
    expect(out.map(l => l.key)).toEqual(['f']);
  });
  it('điểm ở KCN khác nhau đều được giữ', () => {
    const out = dedupeLocations([loc('a', 'factory', 11.2967, 106.6285), loc('b', 'factory', 10.9, 106.9), loc('c', 'client', 11.2967, 106.6285)]);
    expect(out.map(l => l.key)).toEqual(['a', 'b']);
  });
  it('danh sách rỗng', () => {
    expect(dedupeLocations([])).toEqual([]);
  });
});
