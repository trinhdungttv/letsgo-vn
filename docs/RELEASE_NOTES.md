# Popup "Có phiên bản mới" & release notes

Mỗi lần Tony push và Vercel deploy xong, mọi tab / máy đang mở app sẽ thấy thẻ **"Có phiên bản mới"** kèm **tên chức năng mới**.
Tên chức năng lấy từ `src/lib/releaseNotes.ts`.

## QUY ƯỚC (bắt buộc cho mọi phiên làm việc)

**Mỗi lần hoàn thành 1 chức năng mới → thêm 1 mục Ở ĐẦU danh sách `RELEASE_NOTES` trong `src/lib/releaseNotes.ts`, trước khi báo xong.**
Sửa lỗi nhỏ không cần mục riêng (popup tự ghi "Cải tiến và sửa lỗi nhỏ" nếu bản mới không có mục nào mới).

```ts
{
  id: '2026-10-27-ten-ngan',   // 'YYYY-MM-DD-slug', duy nhất; mục ĐẦU danh sách = bản mới nhất
  date: '2026-10-27',
  title: 'CSKH',               // tuỳ chọn: nhóm chức năng
  features: [                  // tên chức năng NGẮN, tiếng Việt, người dùng đọc được (không tên file / tên hàm)
    'Lọc người liên hệ theo quê quán',
  ],
},
```

- Không sửa / xoá mục cũ. Cùng ngày có nhiều chức năng → có thể gộp vào 1 mục (nhiều `features`) hoặc thêm mục mới (id khác).
- `npx vitest run src/lib/releaseUpdate.test.ts` kiểm tra file này (id trùng, sai ngày, thiếu tên chức năng, thứ tự ngày).

## Cách hoạt động

| Thành phần | Việc |
|---|---|
| `vite.config.ts` → plugin `release-version` | Lúc `npm run build`: nhúng mã build (`__APP_BUILD_ID__`) + id release mới nhất (`__APP_RELEASE_ID__`) vào bundle và ghi `dist/version.json` = `{ buildId, builtAt, releaseId, notes }`. Mã build = 7 ký tự đầu `VERCEL_GIT_COMMIT_SHA` (Vercel tự có); không có thì `t<giờ build UTC>`. **Không cần cấu hình biến môi trường.** |
| `src/lib/releaseUpdate.ts` | Logic thuần (so sánh mã, lọc mục mới hơn bản đã thấy, gộp nhiều bản, "Để sau") — có test |
| `src/lib/releaseCheck.ts` | Tải `/version.json` (`no-store`), nhớ `lgvn_release_seen` / `lgvn_release_dismissed` trong localStorage, nút cập nhật (xoá Cache Storage rồi tải lại) |
| `src/components/ReleaseUpdatePrompt.tsx` | Thẻ nổi, gắn ở gốc `App` (mọi màn hình, kể cả đăng nhập). Kiểm tra khi mở app, mỗi 3 phút, khi quay lại tab / có mạng lại |
| `src/lib/appVersion.ts` | Lỗi tải phần cũ sau deploy ("Failed to fetch dynamically imported module") → thanh báo cũ + phát sự kiện để popup kiểm tra server ngay (hiện dù đã bấm "Để sau") |

Hành vi:

- **Không tự tải lại trang** — người dùng có thể đang nhập dở. Bấm "Cập nhật ngay" mới tải lại; "Để sau" ẩn tới khi có bản mới hơn (hoặc sau 4 giờ).
- Người mới (chưa có `lgvn_release_seen`): chỉ ghi nhận, không báo. Sau khi tải lại sang bản mới: thẻ nhỏ "Đã cập nhật" liệt kê chức năng đã có từ lần trước (tự tắt sau 12 giây).
- Popup lấy danh sách chức năng từ `version.json` của **server**, nên bản cũ đang mở vẫn hiện được tên chức năng của bản mới. Bỏ lỡ nhiều bản → gộp tất cả.
- Đang mở hộp thoại modal (`aria-modal="true"`, vd nhắc sinh nhật) thì chờ đóng rồi mới hiện — không chồng lên.
- Chạy `npm run dev` thì tắt hoàn toàn (mã build = `dev`). Mọi lỗi mạng / localStorage đều im lặng.
- Link chia sẻ Phương án giá (`#/p/…`) không hiện popup.

## Thử giả lập 2 bản

```bash
npm run build && npx vite preview --port 5198
```

Mở `http://localhost:5198`, rồi sửa `dist/version.json` (đổi `buildId` sang mã khác, thêm 1 mục ở đầu `notes`, đặt `releaseId` = id mục đó).
Quay lại tab (hoặc đợi tối đa 3 phút) → popup hiện. Chỉ cần đổi `buildId` thì popup hiện với "Cải tiến và sửa lỗi nhỏ".
