# Đồng bộ 2 chiều Việc của tôi ↔ Google Tasks + Google Calendar — Hướng dẫn cài đặt

Tính năng: mỗi user tự kết nối tài khoản Google của mình (nút trong feed **Việc của tôi**).
Sau khi kết nối, task trong `work_tasks` đồng bộ **2 chiều** với danh sách **"LetsGo"** trong Google Tasks
(hiện trong Google Tasks app + panel phải của Gmail/Google Calendar):

- Web → Google: tạo / sửa / đổi hạn / hoàn thành / xoá — đẩy lên trong ~3 giây.
- Google → Web: kéo về khi mở/quay lại trang Bàn làm việc + mỗi 30 giây + nút **Đồng bộ ngay**
  (Google Tasks API không có webhook nên phải poll).
- Xoá bên này = xoá bên kia. Tick hoàn thành bên này = done bên kia. Xung đột: bên sửa sau thắng.
- Task đã xong chỉ đẩy lên nếu hoàn thành trong 14 ngày gần đây (tránh đổ lịch sử cũ).

**Google Calendar (mirror 1 chiều):** sau khi kết nối, user bấm nút **"Chọn lịch Calendar"** để chọn
một lịch có sẵn trong Google Calendar của mình → mỗi việc hiện thành **event cả ngày** đúng ngày hạn,
việc xong có ✅ ở đầu tên. Sửa/xoá/đổi hạn trên web (hoặc qua Google Tasks) sẽ cập nhật event tương ứng.
Sửa event trực tiếp trên Calendar KHÔNG dội ngược về web — chỉnh việc thì làm trên web hoặc Google Tasks.
Đổi sang lịch khác: event ở lịch cũ được dọn tự động.

## Bước 1 — Chạy migration

Chạy các file theo thứ tự trong Supabase SQL Editor:
1. `supabase/migrations/20260708090000_085_google_tasks_sync.sql` — 2 bảng `google_connections`, `google_task_links`.
2. `supabase/migrations/20260708140000_086_google_calendar_sync.sql` — cột lịch Calendar + event id.
3. `supabase/migrations/20260708160000_088_restore_calendar_mirror_columns.sql` — chỉ cần nếu trước đó
   đã lỡ chạy migration xoá cột (087, không còn trong repo) — dùng `IF NOT EXISTS` nên chạy lại vô hại.

## Bước 2 — Tạo OAuth Client trên Google Cloud

1. Vào https://console.cloud.google.com → tạo project (hoặc dùng project sẵn có).
2. **APIs & Services → Library** → bật **Google Tasks API** và **Google Calendar API** (bật cả 2).
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → điền tên app "LetsGo", email hỗ trợ.
   - Scopes: thêm `https://www.googleapis.com/auth/tasks`, `https://www.googleapis.com/auth/calendar.events`,
     `https://www.googleapis.com/auth/calendar.readonly`.
   - Test users: thêm email Google của các nhân viên sẽ dùng (khi app ở chế độ Testing).
     Muốn bỏ giới hạn test users thì bấm **Publish app** (scope tasks không cần verify phức tạp).
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

1. Đăng nhập web → **Bàn làm việc** → thẻ "Đồng bộ việc với Google Tasks + Calendar" → **Kết nối Google**.
2. Chọn tài khoản Google → đồng ý cấp quyền → quay về web, báo "Đã kết nối".
3. Bấm **Chọn lịch Calendar** → chọn lịch muốn hiện việc (hoặc "Không hiện trên Calendar").
4. Tạo 1 việc mới → sau ~3s mở Google Tasks (danh sách "LetsGo") thấy task; mở Google Calendar thấy event cả ngày.
5. Sửa/tick hoàn thành task trong Google Tasks → bấm **Đồng bộ ngay** (hoặc đợi ≤30 giây / quay lại tab web) → web + Calendar cập nhật.

⚠️ User đã kết nối TRƯỚC khi có tính năng Calendar cần bấm **Ngắt kết nối** rồi **Kết nối Google** lại
(refresh token cũ chưa có quyền lịch, mọi thao tác Calendar sẽ báo lỗi cho tới khi nối lại).

## Ghi chú kỹ thuật

- Code server: `api/google/` (`auth-url`, `callback`, `sync`, `account`; `_shared.ts`/`_sync.ts` là helper, không thành endpoint).
- Engine reconcile: `api/google/_sync.ts` — so `work_tasks.updated_at` và Google `.updated` với mốc lưu ở `google_task_links`; lỗi Calendar (thiếu quyền...) chỉ tắt phần Calendar, không làm hỏng sync Tasks.
- Client: `src/lib/googleSync.ts` (push debounce 2.5s, poll 30s + visibility/focus pull) + `src/components/workspace/GoogleSyncCard.tsx` (UI kết nối + chọn lịch).
- `/api` chỉ hoạt động trên bản deploy Vercel — chạy `vite dev` thuần sẽ không có (giống proxy Gemini).
- Trạng thái `ngung_hd` đẩy sang Google là "completed"; bỏ tick bên Google không mở lại task `ngung_hd`.
- Việc giao cho người khác (Giao việc) sẽ vào Google Tasks của NGƯỜI ĐƯỢC GIAO ở lần sync tiếp theo của họ (nếu họ đã kết nối).
