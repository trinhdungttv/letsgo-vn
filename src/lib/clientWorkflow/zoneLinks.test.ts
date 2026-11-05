import { describe, expect, it } from 'vitest';
import type { ClientSiteMap } from '../clientMaps/siteMaps';
import { newStep, newWorkshop } from './workflow';
import { workshopsByZone, zoneOptions } from './zoneLinks';

const zone = (id: string, label: string) => ({ id, label, note: '', color: '#1D4ED8', x: 0, y: 0 });

describe('zoneLinks', () => {
  it('gom khu vực của cả bản vẽ ảnh và vệ tinh', () => {
    const maps = [
      { id: 'm1', kind: 'image', title: 'Tầng 1', zones: [zone('z1', 'B1')], geo: null },
      { id: 'm2', kind: 'map', title: '', zones: [], geo: { zones: [{ id: 'g1', label: 'Khu 1', note: 'May', color: '#f00', pts: [] }] } },
    ] as unknown as ClientSiteMap[];
    const o = zoneOptions(maps);
    expect(o.map(x => [x.mapId, x.zoneId, x.label])).toEqual([['m1', 'z1', 'B1'], ['m2', 'g1', 'Khu 1']]);
    expect(o[1].mapTitle).toBe('Bản đồ vệ tinh');
  });
  it('tra ngược khu vực → xưởng, đếm công đoạn', () => {
    const w = { ...newWorkshop('Xưởng may'), steps: [newStep(), newStep()], zones: [{ mapId: 'm2', zoneId: 'g1', label: 'Khu 1', mapTitle: '' }] };
    const m = workshopsByZone([w, newWorkshop('Kho')]);
    expect(m.get('g1')).toEqual([{ id: w.id, name: 'Xưởng may', steps: 2, media: 0 }]);
    expect(m.size).toBe(1);
  });
});
