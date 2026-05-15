-- =====================================================================
-- CBCode IDE — PostgreSQL Schema (Production)
-- Supports: OCC (Optimistic Concurrency Control), Project-based storage
-- =====================================================================

-- Bảng chứa thông tin User
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bảng chứa thông tin các Project
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_id, name)
);

-- Bảng chứa Metadata của File code (Nội dung thực tế lưu ở MinIO)
-- MinIO Object Key format: ${owner_id}/${project_id}/${path}
CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path VARCHAR(512) NOT NULL,              -- Relative path: src/main.cpp
    version INTEGER NOT NULL DEFAULT 1,       -- OCC version counter
    hash VARCHAR(32) NOT NULL DEFAULT '',     -- MD5 hash of content for integrity check
    last_modified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, path)                 -- Mỗi file path chỉ tồn tại 1 lần trong project
);

-- Index cho truy vấn Worker: lấy tất cả file của 1 project
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);

-- Tạo user test (Password hash của '123456')
INSERT INTO users (username, password_hash)
VALUES ('admin_test', '$2b$10$l5peXUlzDmwCJgtLVBgWDu.YvrYbbzlkJ7782wA4BQ0QoFq3w/yMK')
ON CONFLICT (username) DO NOTHING;