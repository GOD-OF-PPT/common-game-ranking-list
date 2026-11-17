import { z } from 'zod';
import { buildApp } from './app.js';
import { connectDatabase } from './db.js';

const env = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_API_KEY: z.string().min(32),
  PLAYER_TOKEN_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: z.string().default('*')
}).parse(process.env);
if (env.ADMIN_API_KEY === env.PLAYER_TOKEN_SECRET) throw new Error('Use separate admin and player secrets');
const { db, close } = await connectDatabase(env.DATABASE_URL);
const app = await buildApp(db, {
  adminKey: env.ADMIN_API_KEY, playerSecret: env.PLAYER_TOKEN_SECRET,
  corsOrigins: env.CORS_ORIGINS.trim() === '*' ? '*' : env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
  logger: true,
  // Railway's single edge proxy; do not trust an arbitrary X-Forwarded-For chain.
  trustProxy: process.env.RAILWAY_ENVIRONMENT_ID ? (_address, hop) => hop < 1 : false
});
app.addHook('onClose', close);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  void app.close().then(() => { clearTimeout(timeout); process.exit(0); });
});
await app.listen({ host: '0.0.0.0', port: env.PORT });
