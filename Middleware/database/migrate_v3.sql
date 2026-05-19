-- =====================================================================
-- Migration v3: Thêm Room ID (Collaboration) và Giới hạn Workspace
-- =====================================================================

DO $$
BEGIN
    -- 1. Thêm cột room_id (Mã số ngẫu nhiên 16 chữ số)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'room_id'
    ) THEN
        ALTER TABLE users ADD COLUMN room_id VARCHAR(16);
    END IF;
END $$;

-- 2. Hàm sinh ngẫu nhiên 16 số cho room_id ban đầu (nếu null)
UPDATE users 
SET room_id = lpad(floor(random() * 1e16)::bigint::text, 16, '0') 
WHERE room_id IS NULL;

-- 3. Ràng buộc UNIQUE để không bao giờ có 2 user trùng room_id
ALTER TABLE users ADD CONSTRAINT uq_users_room_id UNIQUE (room_id);
