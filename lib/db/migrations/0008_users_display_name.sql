-- 0008_users_display_name.sql
-- 用户管理页（users.html）需要展示「姓名」，后端 handlers/auth/users.js
-- 读写 users.display_name；此前表结构缺该列导致接口 500。
-- 幂等：可重复执行。
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
