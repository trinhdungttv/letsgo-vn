# Đồng bộ 2 chiều Việc của tôi ↔ Google Calendar — Hướng dẫn cài đặt

Tính năng: mỗi user tự kết nối tài khoản Google của mình (nút trong feed **Việc của tôi**).
Sau khi kết nối và chọn 1 lịch, mỗi task trong `work_tasks` hiện thành **1 event cả ngày** trên
lịch đó, đồng bộ **2 chiều**:

- Web → Calendar: tạo / sửa tiêu đề / đổi hạn / ghi chú / đánh dấu hoàn thành / xoá — đẩy lên trong ~3 giây.
- Calendar → Web: đổi ngày (kéo event sang ngày khác), sửa tiêu đề/ghi chú trực tiếp trên Calendar
  sẽ kéo về cập nhật task trên web. Kéo về khi mở/quay lại trang Bàn làm việc + mỗi 30 giây + nút
  **Đồng bộ ngay** (Calendar API không có webhook nên phải poll).
- **Xoá bên web → xoá event bên Calendar.** Ngược lại, **xoá event trên Calendar KHÔNG ảnh hưởng
  task trên web** — lần sync sau hệ thống tự tạo lại event (mirror tự phục hồi, vì event chỉ là
  bản phản chiếu của task, không phải nguồn dữ liệu gốc).
- Task đã xong chỉ đẩy lên nếu hoàn thành trong 14 ngày gần đây (tránh đổ lịch sử cũ).
- **Không dùng Google Tasks.** Google Calendar event không có nút tick hoàn thành — muốn đánh dấu
  xong thì làm trên web (Calendar chỉ hiện icon ✅ trong tiêu đề để biết, không bấm được).
- Mỗi event được đánh dấu ngầm (extended property riêng của app) để hệ thống biết đâu là event do
  LetsGo tạo — không đụng tới các event/lịch cá nhân khác của user trên cùng lịch.

## Bước 1 — Chạy migration

Chạy các file theo thứ tự trong Supabase SQL Editor:
1. `supabase/migrations/20260708090000_085_google_tasks_sync.sql` — bảng `google_connections`, `google_task_links`.
2. `supabase/migrations/20260708140000_086_google_calendar_sync.sql` — cột lịch Calendar + event id.
3. `supabase/migrations/20260708160000_088_restore_calendar_mirror_columns.sql` — chỉ cần nếu trước đó
   đã lỡ chạy migration xoá cột (087, không còn trong repo) — dùng `IF NOT EXISTS` nên chạy lại vô hại.
4. `supabase/migrations/20260709090000_089_calendar_only_sync.sql` — bỏ ràng buộc NOT NULL của
   `google_task_id` (không còn tạo Google Task nữa, chỉ dùng `google_event_id`).

## Bước 2 — Tạo OAuth Client trên Google Cloud

1. Vào https://console.cloud.google.com → tạo project (hoặc dùng project sẵn có).
2. **APIs & Services → Library** → bật **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → điền tên app "LetsGo", email hỗ trợ.
   - Scopes: thêm `https://www.googleapis.com/auth/calendar.events`,
     `https://www.googleapis.com/auth/calendar.readonly`.
   - Test users: thêm email Google của các nhân viên sẽ dùng (khi app ở chế độ Testing).
     Muốn bỏ giới hạn test users thì bấm **Publish app**.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs: `https://<domain-cua-ban>/api/google/callback`
     (ví dụ `https://letsgo-vn.vercel.app/api/google/callback`).
   - Lưu lại **Client ID** và **Client Secret**.

## Bước 3 — Khai báo biến môi trường trên Vercel

Vercel → Project → Settings → Environment Variables (KHÔNG có tiền tố `VITE_`):

| Biến | Giá trị |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID ở bước 2 |
| `GOOGLE_CLIENT_SECRET` | Client Secret ở bước 2 |
| `GOOGLE_TOKEN_ENC_KEY` | Chạy `openssl rand -base64 32` rồi dán kết quả (key mã hoá refresh token) |
| `SUPABASE_URL` | Giống `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key |
| `GOOGLE_REDIRECT_URI` | (tuỳ chọn) chỉ cần khi domain khác với domain đang chạy |

Sau đó **Redeploy** để function nhận env mới.

## Bước 4 — Dùng thử

1. Đăng nhập web → **Bàn làm việc** → thẻ "Đồng bộ việc với Google Calendar" → **Kết nối Google**.
2. Chọn tài khoản Google → đồng ý cấp quyền → quay về web, báo "Đã kết nối".
3. Bấm **Chọn lịch Calendar** → chọn lịch muốn hiện việc.
4. Tạo 1 việc mới → sau ~3s mở Google Calendar thấy event cả ngày, tiêu đề có tiền tố 🎯.
5. Kéo event sang ngày khác trên Calendar → bấm **Đồng bộ ngay** (hoặc đợi ≤30 giây) → hạn trên web đổi theo.
6. Xoá event trên Calendar → sync lại → event được tạo lại (vì task trên web vẫn còn).

⚠️ User đã kết nối TRƯỚC khi có tính năng Calendar cần bấm **Ngắt kết nối** rồi **Kết nối Google** lại
(refresh token cũ chưa có quyền lịch, mọi thao tác Calendar sẽ báo lỗi cho tới khi nối lại).

⚠️ Google Calendar có 1 công tắc chung "Tasks" ở sidebar hiện TẤT CẢ Google Tasks của tài khoản
(không tách riêng theo danh sách) — nếu user còn dùng Google Tasks cho việc cá nhân khác thì công
tắc đó vẫn cần bật, không liên quan đến event mirror của LetsGo.

## Ghi chú kỹ thuật

- Code server: `api/google/` (`auth-url`, `callback`, `sync`, `account`; `_shared.ts`/`_sync.ts` là helper, không thành endpoint).
- Engine reconcile: `api/google/_sync.ts` — so `work_tasks.updated_at` và event `.updated` với mốc lưu ở
  `google_task_links` (cột `google_event_id`); bên sửa sau thắng (last-write-wins).
- Event được tạo với `extendedProperties.private.letsgo=1`; `listMirroredEvents` trong `_shared.ts`
  chỉ lấy các event có marker này (`privateExtendedProperty=letsgo=1`) — không đụng event cá nhân khác.
- Tiêu đề event: `🎯 ` + (`✅ ` nếu đã xong) + tên việc. Khi kéo tiêu đề từ Calendar về web, hệ thống
  tự bóc các tiền tố này để tên task trên web không bị dính icon thừa.
- Client: `src/lib/googleSync.ts` (push debounce 2.5s, poll 30s + visibility/focus pull) + `src/components/workspace/GoogleSyncCard.tsx` (UI kết nối + chọn lịch).
- `/api` chỉ hoạt động trên bản deploy Vercel — chạy `vite dev` thuần sẽ không có (giống proxy Gemini).
- Việc giao cho người khác (Giao việc) sẽ vào Calendar của NGƯỜI ĐƯỢC GIAO ở lần sync tiếp theo của họ (nếu họ đã kết nối và chọn lịch).
