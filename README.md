# Frontend Netlify — HeritageTune 1.1.3

Frontend tĩnh. Khi deploy trên Netlify phải đặt biến môi trường `HERITAGETUNE_API_URL` bằng URL HTTPS của backend Render.

Build script tự tạo `dist/_redirects` để proxy `/api/*` sang Render. Vì vậy mã JavaScript chỉ sử dụng đường dẫn tương đối `/api/...`.
