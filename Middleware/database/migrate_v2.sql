-- =====================================================================
-- Migration: Upgrade schema from v1 (naive) to v2 (OCC + Project-based)
-- Run this on existing databases that already have the old tables.
-- Safe to run multiple times (idempotent via IF NOT EXISTS / IF EXISTS).
-- =====================================================================

-- 1. Update projects table: add unique constraint and updated_at column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_projects_owner_name'
    ) THEN
        ALTER TABLE projects ADD CONSTRAINT uq_projects_owner_name UNIQUE (owner_id, name);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE projects ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- 2. Rebuild files table to match new schema
-- Drop old columns if they exist (from v1 schema)
ALTER TABLE files DROP COLUMN IF EXISTS filename;
ALTER TABLE files DROP COLUMN IF EXISTS minio_object_path;

-- Add new columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'files' AND column_name = 'path'
    ) THEN
        ALTER TABLE files ADD COLUMN path VARCHAR(512) NOT NULL DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'files' AND column_name = 'hash'
    ) THEN
        ALTER TABLE files ADD COLUMN hash VARCHAR(32) NOT NULL DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'files' AND column_name = 'last_modified_by'
    ) THEN
        ALTER TABLE files ADD COLUMN last_modified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Ensure version column exists and has correct default
ALTER TABLE files ALTER COLUMN version SET DEFAULT 1;
ALTER TABLE files ALTER COLUMN version SET NOT NULL;

-- Add unique constraint on (project_id, path)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_files_project_path'
    ) THEN
        ALTER TABLE files ADD CONSTRAINT uq_files_project_path UNIQUE (project_id, path);
    END IF;
END $$;

-- Performance index
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
