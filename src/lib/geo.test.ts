// Tra địa chỉ: Nominatim bị chặn (mạng chặn *.openstreetmap.org) → tự chuyển Photon. fetch + localStorage giả.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GEOCODER_BLOCK_MS, geocoderBlocked, nominatimBoundaryNear, nominatimGeocode, nominatimGeocodeBoundary, pickPhotonPoint } from './geo';

const NOW = Date.UTC(2026, 9, 25, 2, 0, 0);
const feature = (lng: number, lat: number, countrycode?: string) =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: countrycode ? { countrycode } : {} });

describe('hàm thuần', () => {
  it('nhớ "Nominatim bị chặn" 24 giờ', () => {
    expect(geocoderBlocked(null, NOW)).toBe(false);
    expect(geocoderBlocked('abc', NOW)).toBe(false);
    expect(geocoderBlocked(String(NOW - 1000), NOW)).toBe(true);
    expect(geocoderBlocked(String(NOW - GEOCODER_BLOCK_MS - 1), NOW)).toBe(false);
    expect(geocoderBlocked(String(NOW + 60_000), NOW)).toBe(false); // giờ máy lùi → không tin
  });

  it('Photon: lấy điểm đầu tiên trong Việt Nam, bỏ điểm nước khác / ngoài khung', () => {
    expect(pickPhotonPoint({ features: [feature(106.17, 20.43, 'VN')] })).toEqual({ lat: 20.43, lng: 106.17 });
    expect(pickPhotonPoint({ features: [feature(2.35, 48.85, 'FR'), feature(106.65, 10.98, 'VN')] })).toEqual({ lat: 10.98, lng: 106.65 });
    expect(pickPhotonPoint({ features: [feature(100.5, 13.7, 'TH')] })).toBeNull();
    expect(pickPhotonPoint({ features: [feature(106.65, 10.98)] })).toEqual({ lat: 10.98, lng: 106.65 });
    expect(pickPhotonPoint({ features: [] })).toBeNull();
    expect(pickPhotonPoint('rác')).toBeNull();
  });
});

describe('Nominatim → Photon', () => {
  const store = new Map<string, string>();
  const asked: string[] = [];
  let nominatim: 'ok' | 'blocked' | 'error' | 'empty' = 'ok';
  let photonUp = true;

  beforeEach(() => {
    store.clear();
    asked.length = 0;
    nominatim = 'ok';
    photonUp = true;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url.includes('nominatim') ? 'nominatim' : 'photon');
      if (url.includes('nominatim')) {
        if (nominatim === 'blocked') throw new TypeError('Failed to fetch');
        if (nominatim === 'error') return new Response('busy', { status: 503 });
        const body = nominatim === 'empty' ? [] : [{ lat: '20.42', lon: '106.16', class: 'boundary', geojson: { type: 'Polygon', coordinates: [] } }];
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (!photonUp) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ features: [feature(106.17, 20.43, 'VN')] }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('Nominatim chạy → dùng Nominatim, không gọi Photon', async () => {
    expect(await nominatimGeocode('Nam Định, Việt Nam')).toEqual({ lat: 20.42, lng: 106.16 });
    expect(asked).toEqual(['nominatim']);
  });

  it('Nominatim không tìm thấy / lỗi máy chủ → null, không chuyển Photon', async () => {
    nominatim = 'empty';
    expect(await nominatimGeocode('xyz')).toBeNull();
    nominatim = 'error';
    expect(await nominatimGeocode('xyz')).toBeNull();
    expect(asked).toEqual(['nominatim', 'nominatim']);
  });

  it('Nominatim bị chặn → Photon; nhớ lại nên lần sau gọi thẳng Photon', async () => {
    nominatim = 'blocked';
    expect(await nominatimGeocode('Nam Định, Việt Nam')).toEqual({ lat: 20.43, lng: 106.17 });
    expect(asked).toEqual(['nominatim', 'photon']);
    expect(store.size).toBe(1);
    asked.length = 0;
    expect(await nominatimGeocode('Thái Bình, Việt Nam')).toEqual({ lat: 20.43, lng: 106.17 });
    expect(asked).toEqual(['photon']);
  });

  it('mất mạng hẳn (cả Photon) → null, KHÔNG nhớ nhầm Nominatim bị chặn', async () => {
    nominatim = 'blocked';
    photonUp = false;
    expect(await nominatimGeocode('Nam Định')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('ranh giới: bị chặn → điểm Photon không polygon; tìm gần → null', async () => {
    nominatim = 'blocked';
    expect(await nominatimGeocodeBoundary('Phường 1, Nam Định')).toEqual({ lat: 20.43, lng: 106.17, geometry: null });
    expect(await nominatimBoundaryNear('Phường 1', { lat: 20.4, lng: 106.1 })).toBeNull();
  });
});
