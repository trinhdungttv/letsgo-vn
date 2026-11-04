// Pháp lý — đọc link Google Drive / Docs / Sheets / Slides / YouTube để XEM NGAY TRONG APP (iframe).
// Hàm thuần, có test (drive.test.ts). Google chỉ hiện nội dung khi file được chia sẻ "Bất kỳ ai có đường liên kết"
// hoặc trình duyệt đang đăng nhập tài khoản Google có quyền xem → luôn kèm nút "Mở trong Google Drive".
import type { FileType } from './types';

export type LinkSource = 'drive' | 'docs' | 'sheets' | 'slides' | 'forms' | 'folder' | 'youtube' | 'image' | 'pdf' | 'web' | 'invalid';

export interface ParsedLink {
  source: LinkSource;
  /** mã file / thư mục / video (nếu đọc được) */
  id: string | null;
  /** đoán loại file — null khi link Drive không cho biết (file tải lên Drive: PDF, xlsx, pptx…) */
  fileType: FileType | null;
  /** link nhúng iframe; null = trang ngoài thường chặn nhúng → chỉ mở tab mới */
  embedUrl: string | null;
  /** link mở trong tab mới (đã chuẩn hoá) */
  openUrl: string;
  /** true = link Google (Drive / Docs / Sheets / Slides / Forms / thư mục) */
  google: boolean;
}

const ID = '([A-Za-z0-9_-]{10,})';

function normalize(raw: string): URL | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

export function parseDocLink(raw: string): ParsedLink {
  const u = normalize(raw);
  if (!u) return { source: 'invalid', id: null, fileType: null, embedUrl: null, openUrl: raw.trim(), google: false };
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;
  const href = u.toString();
  const m = (re: RegExp) => re.exec(path)?.[1] ?? null;

  if (host === 'docs.google.com') {
    // bản "Xuất bản lên web" (/d/e/<mã>/pub…) nhúng được nguyên link
    if (/\/d\/e\//.test(path)) {
      const kind = path.startsWith('/spreadsheets') ? 'sheets' : path.startsWith('/presentation') ? 'slides' : path.startsWith('/forms') ? 'forms' : 'docs';
      const embed = kind === 'slides' ? href.replace(/\/pub(\?|$)/, '/embed$1') : kind === 'forms' ? href : href.includes('?') ? `${href}&embedded=true` : `${href}?embedded=true`;
      return { source: kind, id: null, fileType: kind === 'sheets' ? 'sheet' : kind === 'slides' ? 'slide' : 'doc', embedUrl: embed, openUrl: href, google: true };
    }
    const doc = m(new RegExp(`^/document/(?:u/\\d+/)?d/${ID}`));
    if (doc) return { source: 'docs', id: doc, fileType: 'doc', embedUrl: `https://docs.google.com/document/d/${doc}/preview`, openUrl: `https://docs.google.com/document/d/${doc}/edit`, google: true };
    const sheet = m(new RegExp(`^/spreadsheets/(?:u/\\d+/)?d/${ID}`));
    if (sheet) {
      const gid = /[#&?]gid=(\d+)/.exec(href)?.[1];
      return {
        source: 'sheets', id: sheet, fileType: 'sheet',
        embedUrl: `https://docs.google.com/spreadsheets/d/${sheet}/preview${gid ? `#gid=${gid}` : ''}`,
        openUrl: `https://docs.google.com/spreadsheets/d/${sheet}/edit${gid ? `#gid=${gid}` : ''}`, google: true,
      };
    }
    const slide = m(new RegExp(`^/presentation/(?:u/\\d+/)?d/${ID}`));
    if (slide) return { source: 'slides', id: slide, fileType: 'slide', embedUrl: `https://docs.google.com/presentation/d/${slide}/preview`, openUrl: `https://docs.google.com/presentation/d/${slide}/edit`, google: true };
    const form = m(new RegExp(`^/forms/(?:u/\\d+/)?d/${ID}`));
    if (form) return { source: 'forms', id: form, fileType: 'web', embedUrl: `https://docs.google.com/forms/d/${form}/viewform?embedded=true`, openUrl: `https://docs.google.com/forms/d/${form}/viewform`, google: true };
    return { source: 'web', id: null, fileType: 'web', embedUrl: null, openUrl: href, google: true };
  }

  if (host === 'drive.google.com') {
    const folder = m(new RegExp(`^/drive/(?:u/\\d+/)?(?:mobile/)?folders/${ID}`)) ?? (path === '/embeddedfolderview' ? u.searchParams.get('id') : null);
    if (folder) return { source: 'folder', id: folder, fileType: 'folder', embedUrl: `https://drive.google.com/embeddedfolderview?id=${folder}#grid`, openUrl: `https://drive.google.com/drive/folders/${folder}`, google: true };
    const file = m(new RegExp(`^/file/(?:u/\\d+/)?d/${ID}`)) ?? ((path === '/open' || path === '/uc') ? u.searchParams.get('id') : null);
    if (file && new RegExp(`^${ID}$`).test(file)) {
      return { source: 'drive', id: file, fileType: null, embedUrl: `https://drive.google.com/file/d/${file}/preview`, openUrl: `https://drive.google.com/file/d/${file}/view`, google: true };
    }
    return { source: 'web', id: null, fileType: 'folder', embedUrl: null, openUrl: href, google: true };
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const vid = host === 'youtu.be' ? path.slice(1).split('/')[0] : (u.searchParams.get('v') ?? m(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/));
    if (vid) return { source: 'youtube', id: vid, fileType: 'video', embedUrl: `https://www.youtube.com/embed/${vid}`, openUrl: `https://www.youtube.com/watch?v=${vid}`, google: false };
  }

  if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path)) return { source: 'image', id: null, fileType: 'image', embedUrl: href, openUrl: href, google: false };
  if (/\.pdf$/i.test(path)) return { source: 'pdf', id: null, fileType: 'pdf', embedUrl: href, openUrl: href, google: false };
  return { source: 'web', id: null, fileType: 'web', embedUrl: null, openUrl: href, google: false };
}

/** Đoán loại file từ tên (vd "Điều lệ 2024.pdf", "Bảng lương.xlsx"). */
export function guessTypeFromName(name: string): FileType | null {
  const ext = /\.([a-z0-9]{2,5})\s*$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (!ext) return null;
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'slide';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  return null;
}

/** Loại file sẽ lưu cho 1 link: ưu tiên loại đọc được từ link, rồi tên file, mặc định PDF (Drive) / trang web. */
export function resolveFileType(link: ParsedLink, title: string, picked?: FileType | ''): FileType {
  if (picked) return picked;
  return link.fileType ?? guessTypeFromName(title) ?? (link.source === 'drive' ? 'pdf' : 'web');
}
