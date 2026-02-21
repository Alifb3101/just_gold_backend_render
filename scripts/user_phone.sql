-- Add phone column to users if missing
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
