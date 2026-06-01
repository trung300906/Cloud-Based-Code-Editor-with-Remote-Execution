# Project "Cloud-Based IDE"

## MEMBER LIST
24521891 - Tạ Duy Trung
24521554 - Nguyễn Tấn Tài
24521080 - Nguyễn Tuấn Minh
24522013 - Lê Quang Vinh

## about this project

Cloud-Based IDE (CBECode) là ứng dụng desktop (Electron) kết hợp Gateway + Worker để cho phép sửa code, đồng bộ file, và chạy code từ xa. Hệ thống gồm 3 phần: client (Electron UI), middleware (Gateway + Auth + Sync API), và server (WorkerNode thực thi).

## Tính năng

### Client (Electron)
- Monaco Editor, tab, split pane, breadcrumb.
- File Explorer: mở folder, tạo/đổi tên/xoá file/folder, copy path, mở file binary (image/pdf).
- Quick Open (Ctrl+P) và Command Palette (>) với nhiều lệnh thao tác nhanh.
- Terminal tích hợp (xterm + node-pty): nhiều terminal, resize, kill, toggle.
- Run code từ xa (C++/Python) và trả kết quả ra terminal.
- Realtime collab (Yjs + y-monaco): đồng bộ cursor và nội dung.
- OCC Sync: tự động đồng bộ file lên cloud, xử lý conflict, nhận FS event từ server.
- Thông báo (toast) và xử lý kick khỏi room.

### Middleware (Gateway + Auth + Sync API)
- TCP Gateway: nhận edit/run/lint/collab, forward tới worker.
- Rate limit và frame parser (bảo mật, chống spam).
- Heartbeat: quản lý worker, chọn worker tốt nhất.
- Auth service: login/register/refresh/logout (JWT + Redis session).
- Project API + OCC Sync: lưu metadata file ở Postgres, content ở MinIO.

### Server (WorkerNode)
- Kéo workspace từ MinIO, thực thi code trong Docker pool.
- Quản lý queue/timeout, trả kết quả về Gateway.

## Yêu cầu hệ thống
- Node.js LTS (khuyến nghị 22.22.3). Nếu Node > 24.16.0 cần tự điều chỉnh package.json.
- Docker (để WorkerNode chạy job).
- Docker Compose (để khởi động Postgres/Redis/MinIO nhanh).
- Postgres + Redis + MinIO (có thể chạy qua docker-compose).

## Setup

### 1) Cài node_modules
```bash
cd client
npm install
```

```bash
cd Middleware
npm install
```

```bash
cd SERVER
npm install
```

### 2) Khởi động Postgres/Redis/MinIO
```bash
cd Middleware/database
docker compose up -d
```

### 3) Khởi tạo database schema (Postgres)
```bash
psql -h 127.0.0.1 -U admin -d cloud_ide -f Middleware/database/init.sql
```

### 4) Các biến môi trường (tuỳ chỉnh)
Tất cả đều có giá trị mặc định. Nếu cần đổi, tạo file .env (Middleware/.env và SERVER/.env) hoặc export biến môi trường:

**Middleware / Auth / Gateway**
- AUTH_PORT (default 3000)
- JWT_HMAC_SECRET, JWT_TTL_SECONDS
- PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
- REDIS_URL (default redis://127.0.0.1:6379)
- MINIO_ENDPOINT, MINIO_USER, MINIO_PASS, MINIO_BUCKET
- GATEWAY_PORT (default 8080), GATEWAY_HB_PORT (default 4000)
- GATEWAY_REQUIRE_AUTH (default 1), GATEWAY_START_AUTH (default 1)

**Server / WorkerNode**
- GATEWAY_HOST, GATEWAY_HB_PORT
- WORKER_PORT, NODE_ID
- MINIO_ENDPOINT, MINIO_USER, MINIO_PASS, MINIO_BUCKET
- WORKER_SLOTS, EXEC_TIMEOUT_MS, JOB_QUEUE_TIMEOUT_MS

## Chạy project

### 1) Middleware (Gateway + Auth)
```bash
cd Middleware
node GatewayServer.js
```

Mặc định Gateway sẽ tự khởi động Auth Service (GATEWAY_START_AUTH=1).

### 2) WorkerNode
```bash
cd SERVER
node WorkerNode.js
```

### 3) Client (Electron)
```bash
cd client
npm start
```

## Build Electron app
```bash
cd client
npm run dist
```
## Chạy client từ file build (tuỳ chọn)
Nếu đã build app (npm run dist), bạn có thể mở file trong client/dist.
#### install
[windows](https://github.com/trung300906/Cloud-Based-Code-Editor-with-Remote-Execution/raw/refs/heads/master/client/dist/CBECode%201.0.0.exe?download=)

[linux-appimage](https://github.com/trung300906/Cloud-Based-Code-Editor-with-Remote-Execution/raw/refs/heads/master/client/dist/CBECode-1.0.0.AppImage?download=)

[linux-snap](https://github.com/trung300906/Cloud-Based-Code-Editor-with-Remote-Execution/raw/refs/heads/master/client/dist/CBECode_1.0.0_amd64.snap?download=)

