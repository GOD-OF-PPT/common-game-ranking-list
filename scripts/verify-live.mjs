import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL?.replace(/\/$/, '');
if (!base) throw new Error('Set BASE_URL to the deployed service URL');
let adminKey = process.env.ADMIN_API_KEY;
if (!adminKey) {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  adminKey = env.match(/^ADMIN_API_KEY=(.+)$/m)?.[1]?.trim();
}
if (!adminKey) throw new Error('Set ADMIN_API_KEY or provide it in local .env');
const admin = { Authorization: `Bearer ${adminKey}` };
async function request(path, { method = 'GET', headers = {}, body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
assert.equal((await request('/health')).status, 'ok');
await request('/api/v1/admin/session', { headers: admin });
const games = await request('/api/v1/games');
if (!games.games.some((g) => g.slug === 'demo')) {
  await request('/api/v1/admin/games', {
    method: 'POST',
    headers: admin,
    body: { slug: 'demo', name: '示例小游戏', allowGuest: true },
    expected: 201,
  });
}
const boards = await request('/api/v1/games/demo/boards');
for (const board of [
  {
    slug: 'high-score',
    name: '总分榜',
    sortRules: [
      { field: 'score', order: 'desc' },
      { field: 'duration', order: 'asc' },
    ],
  },
  { slug: 'speed-run', name: '速通榜', sortRules: [{ field: 'duration', order: 'asc' }] },
]) {
  if (!boards.boards.some((b) => b.slug === board.slug))
    await request('/api/v1/games/demo/boards', {
      method: 'POST',
      headers: admin,
      body: { ...board, updateMode: 'best', public: true },
      expected: 201,
    });
}
const path = '/api/v1/games/demo/boards/high-score';
const id = `smoke-${Date.now()}`;
try {
  const send = (score, duration) =>
    request(`${path}/scores`, {
      method: 'POST',
      headers: admin,
      body: {
        playerId: id,
        username: '线上接口验收（临时数据）',
        metrics: { score, duration },
        info: { test: true },
      },
    });
  assert.equal((await send(100, 50)).accepted, true);
  assert.equal((await send(10, 10)).accepted, false);
  assert.equal((await send(100, 40)).accepted, true);
  const player = await request(`${path}/players/${id}`);
  assert.equal(player.entry.metrics.duration, 40);
  assert(player.entry.rank >= 1);
  assert((await request(path)).entries.some((e) => e.playerId === id));
  const cors = await fetch(`${base}${path}/scores`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://cross-origin-game.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('access-control-allow-origin'), '*');
  await request(`${path}/scores`, {
    method: 'POST',
    body: { username: '无令牌', metrics: { score: 9, duration: 9 } },
    expected: 401,
  });
  for (const endpoint of ['/', '/sdk.js', '/docs/', '/openapi.json']) {
    assert.equal((await fetch(`${base}${endpoint}`)).status, 200);
  }
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        baseUrl: base,
        checks: [
          'database-health',
          'admin-auth',
          'real-write-read',
          'best-score',
          'tie-break',
          'player-rank',
          'CORS-preflight',
          'unauthorized-write-rejected',
          'SDK-and-docs',
        ],
        demo: { game: 'demo', boards: ['high-score', 'speed-run'] },
      },
      null,
      2,
    ),
  );
} finally {
  await request(`/api/v1/admin/games/demo/boards/high-score/players/${id}`, {
    method: 'DELETE',
    headers: admin,
    expected: 204,
  });
}
