// Vercel Serverless Function (Edge) — tim cong ty / nha cung ung lao dong quanh 1 KCN tren Google Maps
// (Google Places API (New) — Text Search) cho chuc nang "Tai thong tin KCN" cua Khao sat KCN.
//
// GET                         -> { enabled: boolean }  (da cai khoa GOOGLE_MAPS_API_KEY tren Vercel chua)
// POST { query, rect?, circle?, pageToken? }  (header x-letsgo-token)
//   rect   = { low: {lat,lng}, high: {lat,lng} }   chi lay ket qua TRONG khung (cong ty trong KCN)
//   circle = { lat, lng, radius }                  uu tien quanh diem (nha cung ung quanh KCN)
//   -> { places: [{ id, name, address, lat, lng, type, types, mapsUrl, status }], nextPageToken }
//
// Khoa: GOOGLE_MAPS_API_KEY (bien moi truong phia server, KHONG dat VITE_ — khong lo ra trinh duyet).
// Chi lay truong nhom "Pro" (ten, dia chi, toa do, loai, link Maps) — khong lay SDT / website (nhom Enterprise dat hon).
// An toan: yeu cau dang nhap (requireSession); query gioi han do dai; chi goi dung 1 dia chi cua Google.
import { requireSession } from './_letsgoSession';

export const config = { runtime: 'edge' };

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.primaryTypeDisplayName',
  'places.types', 'places.googleMapsUri', 'places.businessStatus', 'nextPageToken',
].join(',');

interface Body {
  query?: unknown;
  rect?: { low?: { lat?: unknown; lng?: unknown }; high?: { lat?: unknown; lng?: unknown } };
  circle?: { lat?: unknown; lng?: unknown; radius?: unknown };
  pageToken?: unknown;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default async function handler(req: Request): Promise<Response> {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  if (req.method === 'GET') return json({ enabled: !!key }, 200);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const denied = await requireSession(req);
  if (denied) return denied;
  if (!key) return json({ error: 'Chưa cài khoá Google Maps (GOOGLE_MAPS_API_KEY) trên máy chủ' }, 501);

  let b: Body;
  try { b = (await req.json()) as Body; } catch { return json({ error: 'Body khong hop le' }, 400); }
  const query = typeof b.query === 'string' ? b.query.trim().slice(0, 120) : '';
  if (!query) return json({ error: 'Thiếu từ khoá' }, 400);

  const payload: Record<string, unknown> = { textQuery: query, languageCode: 'vi', regionCode: 'VN', pageSize: 20 };
  const lowLat = num(b.rect?.low?.lat), lowLng = num(b.rect?.low?.lng), hiLat = num(b.rect?.high?.lat), hiLng = num(b.rect?.high?.lng);
  const cLat = num(b.circle?.lat), cLng = num(b.circle?.lng), cR = num(b.circle?.radius);
  if (lowLat != null && lowLng != null && hiLat != null && hiLng != null) {
    payload.locationRestriction = { rectangle: { low: { latitude: lowLat, longitude: lowLng }, high: { latitude: hiLat, longitude: hiLng } } };
  } else if (cLat != null && cLng != null) {
    payload.locationBias = { circle: { center: { latitude: cLat, longitude: cLng }, radius: Math.min(50_000, Math.max(100, cR ?? 5000)) } };
  }
  if (typeof b.pageToken === 'string' && b.pageToken.length < 2000) payload.pageToken = b.pageToken;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify(payload),
    });
  } catch {
    return json({ error: 'Không kết nối được Google Maps' }, 502);
  }
  const data = (await res.json().catch(() => ({}))) as {
    places?: {
      id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number };
      primaryTypeDisplayName?: { text?: string }; types?: string[]; googleMapsUri?: string; businessStatus?: string;
    }[];
    nextPageToken?: string;
    error?: { message?: string; status?: string };
  };
  if (!res.ok) {
    const msg = data.error?.status === 'PERMISSION_DENIED' ? 'Khoá Google chưa bật Places API (New) hoặc chưa gắn thanh toán'
      : data.error?.status === 'RESOURCE_EXHAUSTED' ? 'Đã hết hạn mức gọi Google Maps hôm nay'
      : `Google Maps báo lỗi ${res.status}`;
    return json({ error: msg }, 502);
  }
  const places = (data.places ?? [])
    .filter(p => p.id && p.displayName?.text && p.location?.latitude != null && p.location?.longitude != null)
    .map(p => ({
      id: p.id!, name: p.displayName!.text!, address: p.formattedAddress ?? '',
      lat: p.location!.latitude!, lng: p.location!.longitude!,
      type: p.primaryTypeDisplayName?.text ?? '', types: p.types ?? [], mapsUrl: p.googleMapsUri ?? '', status: p.businessStatus ?? '',
    }));
  return json({ places, nextPageToken: data.nextPageToken ?? null }, 200);
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
