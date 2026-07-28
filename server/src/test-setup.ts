// Vitest global setup: load env so Prisma sees DATABASE_URL the same way the
// dev server does — .env.local first (local Postgres), .env second (cloud).
import dotenv from 'dotenv';
import path from 'path';

const SERVER_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env.local'), override: true });
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });
