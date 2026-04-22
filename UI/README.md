# RCE App (UI/UX Branch)

Nhánh này chứa giao diện người dùng (UI) cơ bản và tính năng File Explorer cho ứng dụng.

## Tính năng đã hoàn thiện
- [x] Giao diện Editor tích hợp Monaco Editor.
- [x] Nút Toggle Theme (Dark/Light mode).
- [x] Nút chọn ngôn ngữ (C++ / Python).
- [x] **File Explorer:** Đọc danh sách file/folder từ máy tính và hiển thị dạng Tree.

## Yêu cầu hệ thống (Prerequisites)
Để chạy được project này, máy bạn BẮT BUỘC phải cài đặt:
- Node.js (Khuyến nghị bản LTS - v18 hoặc v20 trở lên).
- Git.

## 🛠 Hướng dẫn cài đặt và chạy thử (sử dụng Git Bash)

**Bước 1:** Clone project và chuyển sang nhánh `UI/UX`
``` bash
git clone https://github.com/trung300906/Cloud-Based-Code-Editor-with-Remote-Execution
cd <tên-thư-mục-project>
git checkout UI/UX
```

sau đó vào folder UI
**Bước 2:** Cài đặt các thư viện cần thiết (Chỉ cần chạy 1 lần)
``` bash
npm install
```
*(Lưu ý: Lệnh này sẽ đọc file package.json và tự động tạo ra thư mục node_modules cho bạn)*

**Bước 3:** Khởi chạy ứng dụng
```bash
npm start
```

## Ghi chú cho Dev
- Menu mở thư mục nằm ở: **File > Open Folder** (Trên thanh công cụ của cửa sổ ứng dụng).
- Nếu sửa code ở `main.js` hoặc `preload.js`, vui lòng tắt terminal (Ctrl+C) và chạy lại `npm start`.
- Lưu ý rằng là nodejs và lẫn npm cần được install trên chính máy của bạn