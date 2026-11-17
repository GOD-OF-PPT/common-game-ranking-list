import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const hashKey = (value: string) => createHash('sha256').update(value).digest('hex');
export const newKey = () => `grk_${randomBytes(32).toString('base64url')}`;
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hashKey(a)), Buffer.from(hashKey(b)));
}
const signature = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');
export function issueToken(gameId: string, playerId: string, secret: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const payload = Buffer.from(JSON.stringify({ gid: gameId, sub: playerId, exp: expiresAt })).toString('base64url');
  return { token: `${payload}.${signature(payload, secret)}`, expiresAt };
}
export function verifyToken(token: string, gameId: string, secret: string): string | null {
  try {
    const parts = token.split('.');
    const [payload, sig] = parts;
    if (parts.length !== 2 || !payload || !sig || !equalSecret(sig, signature(payload, secret))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.gid === gameId && typeof data.sub === 'string' && data.sub.startsWith('guest_') &&
      typeof data.exp === 'number' && data.exp > Date.now() / 1000 ? data.sub : null;
  } catch { return null; }
}
