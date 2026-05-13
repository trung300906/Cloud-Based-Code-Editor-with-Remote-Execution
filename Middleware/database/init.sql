-- Bảng chứa thông tin User
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bảng chứa thông tin các Project/Room
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bảng chứa Metadata của File code (Nội dung thực tế lưu ở MinIO)
CREATE TABLE files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    minio_object_path VARCHAR(255) NOT NULL,
    version INTEGER DEFAULT 1,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tạo một user test luôn để lát nữa test Login
INSERT INTO users (username, password_hash) 
VALUES ('admin_test', '\$2b\$10\$l5peXUlzDmwCJgtLVBgWDu.YvrYbbzlkJ7782wA4BQ0QoFq3w/yMK'); 
-- (Password đã hash của user này là: 123456)