# Đồng bộ 2 chiều Việc của tôi ↔ Google Tasks — Hướng dẫn cài đặt

Tính năng: mỗi user tự kết nối tài khoản Google của mình (nút trong feed **Việc của tôi**).
Sau khi kết nối, task trong `work_tasks` đồng bộ **2 chiều** với danh sách **"LetsGo"** trong Google Tasks
(hiện trong Google Tasks app + panel phải của Gmail/Google Calendar):

- Web → Google: tạo / sửa / đổi hạn / hoàn thành / xoá — đẩy lên trong ~3 giây.
- Google → Web: kéo về khi mở/quay lại trang Bàn làm việc + mỗi 30 giây + nút **Đồng bộ ngay**
  (Google Tasks API không có webhook nên phải poll).
- Xoá bên này = xoá bên kia. Tick hoàn thành bên này = done bên kia. Xung đột: bên sửa sau thắng.
- Task đã xong chỉ đẩy lên nếu hoàn thành trong 14 ngày gần đây (tránh đổ lịch sử cũ).

**Hiện trên Google Calendar:** không cần code riêng — Google Calendar **tự hiển thị Google Tasks**
kèm nút tick hoàn thành (bật mục **"Tasks"** trong sidebar trái của Google Calendar). Tick hoàn thành
ở đó chính là tick hoàn thành task thật (vì cùng 1 dữ liệu Google Tasks), nên sẽ đồng bộ ngược về web
như bình thường — không cần chọn lịch, không cần quyền Calendar riêng.

## Bước 1 — Chạy migration

Chạy `supabase/migrations/20260708090000_085_google_tasks_sync.sql` trong Supabase SQL Editor
(tạo 2 bảng `google_connections`, `google_task_links` — khoá hết anon, chỉ service role đọc được).

(2 migration `086`/`087` sau đó là thử nghiệm mirror Calendar riêng rồi bỏ lại — không cần quan tâm,
chạy `085` là đủ. Nếu đã chạy `086` trước đó, chạy tiếp `087` để dọn cột thừa.)

## Bước 2 — Tạo OAuth Client trên Google Cloud

1. Vào https://console.cloud.google.com → tạo project (hoặc dùng project sẵn có).
2. **APIs & Services → Library** → bật **Google Tasks API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → điền tên app "LetsGo", email hỗ trợ.
   - Scopes: thêm `https://www.googleapis.com/auth/tasks`.
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

1. Đăng nhập web → **Bàn làm việc** → thẻ "Đồng bộ việc với Google Tasks" → **Kết nối Google Tasks**.
2. Chọn tài khoản Google → đồng ý cấp quyền → quay về web, báo "Đã kết nối".
3. Tạo 1 việc mới → sau ~3s mở Google Tasks (danh sách "LetsGo") thấy task.
4. Muốn thấy việc trên Google Calendar: mở Google Calendar → sidebar trái → bật mục **"Tasks"** →
   việc hiện ở đúng ngày hạn, tick hoàn thành ngay tại đó được.
5. Sửa/tick hoàn thành task trong Google Tasks (hoặc Calendar) → bấm **Đồng bộ ngay**
   (hoặc đợi ≤30 giây / quay lại tab web) → web cập nhật.

⚠️ User đã kết nối khi tính năng còn xin quyền Calendar (bản cũ) nên **Ngắt kết nối** rồi **Kết nối**
lại 1 lần cho chắc (không bắt buộc, nhưng token cũ có thể xin dư quyền không dùng tới).

## Ghi chú kỹ thuật

- Code server: `api/google/` (`auth-url`, `callback`, `sync`, `account`; `_shared.ts`/`_sync.ts` là helper, không thành endpoint).
- Engine reconcile: `api/google/_sync.ts` — so `work_tasks.updated_at` và Google `.updated` với mốc lưu ở `google_task_links`.
- Client: `src/lib/googleSync.ts` (gọi API, debounce 2.5s push, poll 30s + visibility/focus pull) + `src/components/workspace/GoogleSyncCard.tsx` (UI).
- `/api` chỉ hoạt động trên bản deploy Vercel — chạy `vite dev` thuần sẽ không có (giống proxy Gemini).
- Trạng thái `ngung_hd` đẩy sang Google là "completed"; bỏ tick bên Google không mở lại task `ngung_hd`.
- Việc giao cho người khác (Giao việc) sẽ vào Google Tasks của NGƯỜI ĐƯỢC GIAO ở lần sync tiếp theo của họ (nếu họ đã kết nối).
- Chỉ dùng scope `tasks` — không xin quyền Calendar vì Google Calendar tự hiển thị Google Tasks sẵn.
