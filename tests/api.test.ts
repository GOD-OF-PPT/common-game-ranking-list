import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import { issueToken } from '../src/auth.js';
import type { Database } from '../src/types.js';

const adminKey = 'test-admin-secret-at-least-32-characters';
const playerSecret = 'test-player-secret-at-least-32-characters';
const admin = { authorization: `Bearer ${adminKey}` };
let pg: PGlite;
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  db = {
    query: async <T>(sql: string, values?: unknown[]) => ({
      rows: (await pg.query<T>(sql, values)).rows,
    }),
  };
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE entries, leaderboards, games CASCADE');
  app = await buildApp(db, { adminKey, playerSecret, corsOrigins: '*' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
afterAll(async () => {
  await pg.close();
});

async function game(slug = 'test-game', allowGuest = true) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/games',
    headers: admin,
    payload: { slug, name: '测试游戏', allowGuest },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}
async function board(slug = 'test-game', options: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/games/${slug}/boards`,
    headers: admin,
    payload: {
      slug: 'high-score',
      name: '总分榜',
      sortRules: [
        { field: 'score', order: 'desc' },
        { field: 'duration', order: 'asc' },
      ],
      ...options,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().board;
}
async function session(slug = 'test-game') {
  const res = await app.inject({ method: 'POST', url: `/api/v1/games/${slug}/sessions` });
  expect(res.statusCode).toBe(201);
  return res.json();
}
const path = '/api/v1/games/test-game/boards/high-score';
function submit(
  playerId: string,
  score: number,
  duration = 30,
  extra: Record<string, unknown> = {},
  headers = admin,
) {
  return app.inject({
    method: 'POST',
    url: `${path}/scores`,
    headers,
    payload: { playerId, username: playerId, metrics: { score, duration }, ...extra },
  });
}

describe('ranking service with real PostgreSQL SQL via PGlite', () => {
  it('protects management, returns a key only at creation and isolates game keys', async () => {
    expect((await app.inject('/api/v1/admin/session')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/admin/session', headers: admin })).json().authenticated,
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/admin/games',
          payload: { slug: 'x', name: 'X' },
        })
      ).statusCode,
    ).toBe(401);
    const created = await game();
    const other = await game('other');
    expect(created.apiKey).toMatch(/^grk_/);
    expect((await app.inject('/api/v1/games')).body).not.toContain(created.apiKey);
    expect((await app.inject('/api/v1/games')).body).not.toContain('api_key_hash');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/games/test-game/boards',
          headers: { 'x-api-key': other.apiKey },
          payload: { slug: 'a', name: 'A', sortRules: [{ field: 'score', order: 'desc' }] },
        })
      ).statusCode,
    ).toBe(401);
    await board();
    expect((await submit('alice', 100, 30, {}, { 'x-api-key': created.apiKey })).statusCode).toBe(
      200,
    );
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/games/test-game/rotate-key',
      headers: admin,
    });
    expect((await submit('alice', 200, 30, {}, { 'x-api-key': created.apiKey })).statusCode).toBe(
      401,
    );
  });
  it('orders multiple fields, keeps competition ties and paginates consistently', async () => {
    await game();
    await board();
    await submit('alice', 100, 40);
    await submit('bob', 100, 30);
    await submit('carol', 100, 30);
    await submit('dan', 80, 20);
    const data = (await app.inject(`${path}?limit=3`)).json();
    expect(data.entries.map((e: { playerId: string }) => e.playerId)).toEqual([
      'bob',
      'carol',
      'alice',
    ]);
    expect(data.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 1, 3]);
    expect(data.total).toBe(4);
    expect((await app.inject(`${path}?offset=3&limit=3`)).json().entries[0].rank).toBe(4);
    expect((await app.inject(`${path}?offset=99`)).json()).toMatchObject({ total: 4, entries: [] });
    expect((await app.inject(`${path}/players/alice`)).json().entry.rank).toBe(3);
  });
  it('best keeps the full winning payload, accepts tie-break improvements and rejects equal scores', async () => {
    await game();
    await board();
    await submit('alice', 100, 40, { username: '原玩家', info: { level: 9 } });
    expect((await submit('alice', 50, 10, { info: { level: 1 } })).json().accepted).toBe(false);
    expect((await submit('alice', 100, 40)).json().accepted).toBe(false);
    expect((await app.inject(`${path}/players/alice`)).json().entry).toMatchObject({
      username: '原玩家',
      metrics: { score: 100, duration: 40 },
      info: { level: 9 },
    });
    expect((await submit('alice', 100, 30)).json().accepted).toBe(true);
    expect((await app.inject(`${path}/players/alice`)).json().entry.metrics.duration).toBe(30);
  });
  it('latest can replace a better result', async () => {
    await game();
    await board('test-game', { updateMode: 'latest' });
    await submit('alice', 100);
    await submit('alice', 5);
    expect((await app.inject(`${path}/players/alice`)).json().entry.metrics.score).toBe(5);
  });
  it('retains the best result under concurrent writes', async () => {
    await game();
    await board();
    await Promise.all([400, 70, 900, 250, 600, 20].map((n) => submit('alice', n)));
    expect((await app.inject(path)).json()).toMatchObject({
      total: 1,
      entries: [{ metrics: { score: 900 } }],
    });
  });
  it('binds anonymous submissions to the correct player and game', async () => {
    await game();
    await board();
    await game('other');
    const a = await session();
    const b = await session();
    const headers = { authorization: `Bearer ${a.token}` };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${path}/scores`,
          headers,
          payload: {
            username: '游客',
            metrics: { score: 99, duration: 25 },
            info: { character: '法师' },
          },
        })
      ).json().playerId,
    ).toBe(a.playerId);
    expect((await submit(b.playerId, 100, 30, {}, headers)).statusCode).toBe(403);
    const wrongGameToken = (await session('other')).token;
    expect(
      (await submit('alice', 100, 30, {}, { authorization: `Bearer ${wrongGameToken}` }))
        .statusCode,
    ).toBe(401);
    expect(
      (await submit('alice', 100, 30, {}, { authorization: `Bearer ${a.token}x` })).statusCode,
    ).toBe(401);
    expect((await app.inject(`${path}/players/${a.playerId}`)).json().entry.username).toBe('游客');
  });
  it('expires tokens and rejects disabled guest writes while allowing a game backend', async () => {
    const created = await game();
    await board();
    const identity = await session();
    const signed = issueToken(created.game.id, 'guest_expired', playerSecret);
    vi.spyOn(Date, 'now').mockReturnValue((signed.expiresAt + 1) * 1000);
    expect(
      (await submit('guest_expired', 1, 2, {}, { authorization: `Bearer ${signed.token}` }))
        .statusCode,
    ).toBe(401);
    vi.restoreAllMocks();
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/games/test-game',
      headers: admin,
      payload: { allowGuest: false },
    });
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/games/test-game/sessions' })).statusCode,
    ).toBe(403);
    expect(
      (await submit(identity.playerId, 100, 30, {}, { authorization: `Bearer ${identity.token}` }))
        .statusCode,
    ).toBe(401);
    expect(
      (await submit('backend-user', 100, 30, {}, { 'x-api-key': created.apiKey })).statusCode,
    ).toBe(200);
  });
  it('validates missing metrics, duplicate fields, huge info and invalid numeric values', async () => {
    await game();
    await board();
    expect((await submit('alice', 100, 30, { metrics: { score: 2 } })).json().code).toBe(
      'MISSING_METRIC',
    );
    for (const score of ['100', null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        (await submit('alice', 100, 30, { metrics: { score, duration: 30 } })).statusCode,
      ).toBe(400);
    }
    expect((await submit('alice', 100, 30, { info: { data: 'x'.repeat(17000) } })).statusCode).toBe(
      400,
    );
    expect((await app.inject(`${path}?limit=1000`)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/games/test-game/boards',
          headers: admin,
          payload: {
            slug: 'bad',
            name: 'Bad',
            sortRules: [
              { field: 'score', order: 'asc' },
              { field: 'score', order: 'desc' },
            ],
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('isolates games and private boards and permits moderation', async () => {
    await game();
    await board('test-game', { public: false });
    await submit('alice', 100);
    expect((await app.inject(path)).statusCode).toBe(401);
    expect((await app.inject('/api/v1/games/test-game/boards')).json().boards).toEqual([]);
    const identity = await session();
    expect(
      (
        await app.inject({ url: path, headers: { authorization: `Bearer ${identity.token}` } })
      ).json().total,
    ).toBe(1);
    await game('other');
    await board('other');
    expect((await app.inject('/api/v1/games/other/boards/high-score')).json().total).toBe(0);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/v1/admin/games/test-game/boards/high-score/players/alice',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/v1/admin/games/test-game/boards/high-score/players/alice',
          headers: admin,
        })
      ).statusCode,
    ).toBe(204);
    expect((await app.inject({ url: `${path}/players/alice`, headers: admin })).statusCode).toBe(
      404,
    );
  });
  it('handles descending negative numbers, ascending decimals and empty results', async () => {
    await game();
    await board('test-game', { sortRules: [{ field: 'score', order: 'asc' }] });
    expect((await app.inject(path)).json()).toMatchObject({ entries: [], total: 0 });
    await submit('a', 0.25);
    await submit('b', -0.5);
    await submit('c', 0);
    expect(
      (await app.inject(path)).json().entries.map((e: { playerId: string }) => e.playerId),
    ).toEqual(['b', 'c', 'a']);
  });
  it('serves cross-origin API requests, preflights, SDK modules, docs and health', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: `${path}/scores`,
      headers: {
        origin: 'https://another-game.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
    expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
    for (const url of ['/health', '/', '/sdk.js', '/playground.html', '/docs/', '/openapi.json']) {
      expect(
        (await app.inject({ url, headers: { origin: 'https://another-game.example' } })).statusCode,
      ).toBe(200);
    }
    const spec = (await app.inject('/openapi.json')).json();
    expect(
      spec.paths[`${path.replace('test-game', '{game}').replace('high-score', '{board}')}/scores`],
    ).toBeDefined();
    expect((await app.inject('/.env')).statusCode).toBe(404);
  });
  it('honors exact origin allowlists and surfaces database unavailability', async () => {
    await app.close();
    app = await buildApp(db, { adminKey, playerSecret, corsOrigins: ['https://allowed.example'] });
    const allowed = await app.inject({
      url: '/health',
      headers: { origin: 'https://allowed.example' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example');
    const blocked = await app.inject({
      url: '/health',
      headers: { origin: 'https://blocked.example' },
    });
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    vi.spyOn(db, 'query').mockRejectedValue(new Error('DB down'));
    expect((await app.inject('/health')).statusCode).toBe(503);
  });
  it('SDK reuses a stored identity and shares concurrent session creation', async () => {
    await game();
    await board();
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    vi.stubGlobal(
      'fetch',
      async (
        url: string,
        options: { method?: string; headers?: Record<string, string>; body?: string } = {},
      ) => {
        const response = await app.inject({
          method: (options.method as 'POST') ?? 'GET',
          url: new URL(url).pathname + new URL(url).search,
          headers: options.headers,
          payload: options.body,
        });
        return {
          ok: response.statusCode < 400,
          status: response.statusCode,
          json: async () => response.json(),
        };
      },
    );
    try {
      // @ts-expect-error The browser SDK deliberately ships as dependency-free JavaScript.
      const { RankingClient } = await import('../public/sdk.js');
      const client = new RankingClient({
        baseUrl: 'http://ranking.test',
        game: 'test-game',
        storage: adapter,
      });
      const [a, b] = await Promise.all([client.session(), client.session()]);
      expect(a.playerId).toBe(b.playerId);
      await client.submit('high-score', {
        username: '<script>alert(1)</script>',
        metrics: { score: 200, duration: 30 },
        info: { level: 2 },
      });
      const secondClient = new RankingClient({
        baseUrl: 'http://ranking.test',
        game: 'test-game',
        storage: adapter,
      });
      expect((await secondClient.me('high-score')).entry.rank).toBe(1);
      expect((await secondClient.session()).playerId).toBe(a.playerId);
      expect((await client.top('high-score')).total).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
