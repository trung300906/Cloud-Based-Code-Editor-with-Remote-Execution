# Project "Cloud-Based IDE"

## Setup
dựa vào hệ điều hành của bạn, hãy tự tải node về, khuyến nghị nodejs version 22.22.3(lts/jod)(nếu muốn dùng các nodejs version > 24.16.0 thì tự config lại trong package.json của các folder)

**lưu ý: các version nodejs > 24.16.0 có thể không tương thích hoặc hành vi lạ, không khuyến khích sử dụng**

### install node_modules needed for the project
trước tiên chạy lệnh sau để vào thư mục client:
```bash
cd client
npm install
```
sau khi xong vào tiếp Middleware/ và SERVER/ và gõ lệnh 
``` bash
cd Middleware
npm install
```

``` bash
cd SERVER
npm install
```

## build Electron apps
```bash
cd client
npm run dist
```

## chạy project

### CLIENT
nếu đã build app (sau khi chạy npm run dist trong client), bạn có thể chạy trực tiếp app bên trong thư mục client/dist, tìm file exe hoặc appimage tùy hệ điều hành windows hay linux
#### install
[windows](https://github.com/trung300906/Cloud-Based-Code-Editor-with-Remote-Execution/raw/refs/heads/master/client/dist/CBECode%201.0.0.exe?download=)

[linux-appimage](https://github.com/trung300906/Cloud-Based-Code-Editor-with-Remote-Execution/raw/refs/heads/master/client/dist/CBECode-1.0.0.AppImage?download=)

[linux-snap](https://github.com/trung300906/Cloud-Based-Code-Editor-with-Remote-Execution/raw/refs/heads/master/client/dist/CBECode_1.0.0_amd64.snap?download=)

### MIDDLEWARE
```bash
cd Middleware
node GatewayServer.js
```

### SERVER
```bash
cd SERVER
node WorkerNode.js
```