import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installStaleBuildNotice } from './lib/appVersion';

// App vừa deploy bản mới khi trang đang mở → các phần tải sau báo lỗi; hiện thanh "Tải lại trang" thay vì lỗi khó hiểu
installStaleBuildNotice();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
