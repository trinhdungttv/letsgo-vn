import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installStaleBuildNotice } from './lib/appVersion';
import { captureGoogleRedirect } from './lib/googleLogin';

// App vừa deploy bản mới khi trang đang mở → các phần tải sau báo lỗi; hiện thanh "Tải lại trang" thay vì lỗi khó hiểu
installStaleBuildNotice();
// Vừa quay về từ trang Google → nhận mã đăng nhập và dọn khỏi địa chỉ trước khi App đọc hash (#/...)
captureGoogleRedirect();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
