-- Миграция: Обновление таблицы users для системы управления пользователями
-- Дата: 2026-01-17

-- 1. Переименовываем существующие колонки
ALTER TABLE users RENAME COLUMN username TO email;
ALTER TABLE users RENAME COLUMN password TO password_hash;

-- 2. Добавляем новые колонки
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN gdpr_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN gdpr_consent_at TIMESTAMP;
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN created_by VARCHAR(36);

-- 3. Устанавливаем имена для существующих пользователей (из email/username)
UPDATE users SET name = email WHERE name IS NULL;

-- 4. Существующие пользователи уже активны и согласились с GDPR (раз они уже работают)
UPDATE users SET status = 'active', gdpr_consent = true, gdpr_consent_at = NOW() WHERE status = 'active';

-- 5. Добавляем constraint на status
ALTER TABLE users ADD CONSTRAINT users_status_check 
  CHECK (status IN ('pending', 'active', 'inactive'));