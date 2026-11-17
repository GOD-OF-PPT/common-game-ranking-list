import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import type { Board, Config, Database, Entry, Game } from './types.js';
import { equalSecret, hashKey, issueToken, newKey, verifyToken } from './auth.js';
import * as s from './schemas.js';

class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
const bearer = (req: FastifyRequest) => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : '';
};
const gameView = (g: Game) => ({
  id: g.id,
  slug: g.slug,
  name: g.name,
  allowGuest: g.allow_guest,
  createdAt: g.created_at,
});
const boardView = (b: Board) => ({
  id: b.id,
  slug: b.slug,
  name: b.name,
  sortRules: b.sort_rules,
  updateMode: b.update_mode,
  public: b.public,
  createdAt: b.created_at,
});
const entryView = (e: Entry) => ({
  rank: Number(e.rank),
  playerId: e.player_id,
  username: e.username,
  metrics: e.metrics,
  info: e.info,
  achievedAt: e.achieved_at,
});

export async function buildApp(db: Database, config: Config) {
  const app = Fastify({
    logger: config.logger
      ? { redact: ['req.headers.authorization', 'req.headers["x-api-key"]'] }
      : false,
    bodyLimit: 32768,
    trustProxy: config.trustProxy ?? false,
    requestTimeout: 15000,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cors, {
    origin: config.corsOrigins === '*' ? '*' : config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: false,
    maxAge: 86400,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: '通用游戏排行榜 API',
        version: '1.0.0',
        description:
          '网页小游戏直接接入。先创建游戏及榜单，再领取玩家令牌上报成绩。完整接入指南见仓库 README。',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: '管理员密钥或匿名玩家令牌，具体权限取决于接口。',
          },
          gameKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: '游戏后端专用密钥，请勿放入网页代码。',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  await app.register(staticFiles, {
    root: fileURLToPath(new URL('../public', import.meta.url)),
    prefix: '/',
    index: ['index.html'],
  });

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .code(400)
        .send({
          code: 'VALIDATION_ERROR',
          message: '请求字段不合法',
          details: error.validation,
          requestId: request.id,
        });
    }
    const err =
      error instanceof Error
        ? (error as Error & { code?: string; statusCode?: number })
        : new Error('Unknown error');
    if ('code' in err && err.code === '23505') {
      return reply
        .code(409)
        .send({ code: 'ALREADY_EXISTS', message: '游戏或榜单标识已存在', requestId: request.id });
    }
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return reply
      .code(status)
      .send({
        code: 'code' in err ? err.code : 'INTERNAL_ERROR',
        message: status >= 500 ? '服务暂时不可用，请稍后重试' : err.message,
        requestId: request.id,
      });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ code: 'NOT_FOUND', message: '接口不存在', requestId: req.id }),
  );
  const isAdmin = (req: FastifyRequest) =>
    !!bearer(req) && equalSecret(bearer(req), config.adminKey);
  const requireAdmin = (req: FastifyRequest) => {
    if (!isAdmin(req)) fail(401, 'UNAUTHORIZED', '需要管理员密钥');
  };
  const hasGameKey = (req: FastifyRequest, game: Game) => {
    const key = req.headers['x-api-key'];
    return typeof key === 'string' && equalSecret(hashKey(key), game.api_key_hash);
  };
  const canManage = (req: FastifyRequest, game: Game) => isAdmin(req) || hasGameKey(req, game);
  const playerIdentity = (req: FastifyRequest, game: Game) =>
    game.allow_guest ? verifyToken(bearer(req), game.id, config.playerSecret) : null;
  const canReadPrivate = (req: FastifyRequest, game: Game) =>
    canManage(req, game) || !!playerIdentity(req, game);
  async function getGame(slug: string) {
    const { rows } = await db.query<Game>('SELECT * FROM games WHERE slug = $1', [slug]);
    return rows[0] ?? fail(404, 'GAME_NOT_FOUND', '游戏不存在');
  }
  async function getBoard(game: Game, slug: string) {
    const { rows } = await db.query<Board>(
      'SELECT * FROM leaderboards WHERE game_id = $1 AND slug = $2',
      [game.id, slug],
    );
    return rows[0] ?? fail(404, 'BOARD_NOT_FOUND', '榜单不存在');
  }
  const api = '/api/v1';
  const managerSecurity: Record<string, string[]>[] = [{ bearerAuth: [] }, { gameKey: [] }];

  app.get(
    `${api}/admin/session`,
    { schema: { tags: ['admin'], summary: '校验管理员密钥', security: [{ bearerAuth: [] }] } },
    async (req) => {
      requireAdmin(req);
      return { authenticated: true };
    },
  );

  app.get(
    '/health',
    { schema: { tags: ['system'], summary: '数据库就绪检查' } },
    async (_req, reply) => {
      try {
        await db.query('SELECT 1');
        return { status: 'ok' };
      } catch {
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  app.get(`${api}/games`, { schema: { tags: ['games'], summary: '列出游戏' } }, async () => {
    const { rows } = await db.query<Game>('SELECT * FROM games ORDER BY created_at, id');
    return { games: rows.map(gameView) };
  });
  app.post(
    `${api}/admin/games`,
    {
      schema: {
        tags: ['admin'],
        summary: '创建游戏（密钥仅返回一次）',
        body: s.createGame,
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      requireAdmin(req);
      const key = newKey();
      const { rows } = await db.query<Game>(
        `INSERT INTO games(id, slug, name, api_key_hash, allow_guest)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [randomUUID(), req.body.slug, req.body.name, hashKey(key), req.body.allowGuest],
      );
      return reply.code(201).send({ game: gameView(rows[0]!), apiKey: key });
    },
  );
  app.patch(
    `${api}/admin/games/:game`,
    {
      schema: {
        tags: ['admin'],
        summary: '修改游戏名或关闭游客直传',
        params: s.gameParams,
        body: s.createGame.pick({ name: true, allowGuest: true }).partial(),
        security: [{ bearerAuth: [] }],
      },
    },
    async (req) => {
      requireAdmin(req);
      const game = await getGame(req.params.game);
      const { rows } = await db.query<Game>(
        'UPDATE games SET name=$2, allow_guest=$3 WHERE id=$1 RETURNING *',
        [game.id, req.body.name ?? game.name, req.body.allowGuest ?? game.allow_guest],
      );
      return { game: gameView(rows[0]!) };
    },
  );
  app.post(
    `${api}/admin/games/:game/rotate-key`,
    {
      schema: {
        tags: ['admin'],
        summary: '轮换游戏后端密钥',
        params: s.gameParams,
        security: [{ bearerAuth: [] }],
      },
    },
    async (req) => {
      requireAdmin(req);
      const game = await getGame(req.params.game);
      const key = newKey();
      await db.query('UPDATE games SET api_key_hash=$2 WHERE id=$1', [game.id, hashKey(key)]);
      return { apiKey: key };
    },
  );
  app.post(
    `${api}/games/:game/sessions`,
    {
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        tags: ['players'],
        summary: '领取匿名玩家身份（有效 30 天）',
        params: s.gameParams,
      },
    },
    async (req, reply) => {
      const game = await getGame(req.params.game);
      if (!game.allow_guest) fail(403, 'GUEST_DISABLED', '此游戏只接受后端提交');
      const playerId = `guest_${randomUUID()}`;
      return reply
        .code(201)
        .send({ playerId, ...issueToken(game.id, playerId, config.playerSecret) });
    },
  );
  app.get(
    `${api}/games/:game/boards`,
    { schema: { tags: ['boards'], summary: '列出游戏榜单', params: s.gameParams } },
    async (req) => {
      const game = await getGame(req.params.game);
      const { rows } = await db.query<Board>(
        'SELECT * FROM leaderboards WHERE game_id=$1 AND (public OR $2) ORDER BY created_at, id',
        [game.id, canReadPrivate(req, game)],
      );
      return { game: gameView(game), boards: rows.map(boardView) };
    },
  );
  app.post(
    `${api}/games/:game/boards`,
    {
      schema: {
        tags: ['boards'],
        summary: '创建榜单（排序规则创建后固定）',
        params: s.gameParams,
        body: s.createBoard,
        security: managerSecurity,
      },
    },
    async (req, reply) => {
      const game = await getGame(req.params.game);
      if (!canManage(req, game)) fail(401, 'UNAUTHORIZED', '需要管理员密钥或游戏后端密钥');
      const body = req.body;
      const { rows } = await db.query<Board>(
        `INSERT INTO leaderboards(id, game_id, slug, name, sort_rules, update_mode, public)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          randomUUID(),
          game.id,
          body.slug,
          body.name,
          JSON.stringify(body.sortRules),
          body.updateMode,
          body.public,
        ],
      );
      return reply.code(201).send({ board: boardView(rows[0]!) });
    },
  );
  app.get(
    `${api}/games/:game/boards/:board`,
    {
      schema: {
        tags: ['boards'],
        summary: '获取排名（同分并列，如 1、1、3）',
        params: s.boardParams,
        querystring: s.pagination,
      },
    },
    async (req) => {
      const game = await getGame(req.params.game);
      const board = await getBoard(game, req.params.board);
      if (!board.public && !canReadPrivate(req, game))
        fail(401, 'UNAUTHORIZED', '此榜单需要玩家令牌或游戏密钥');
      const { rows } = await db.query<{ total: string; entries: Entry[] | null }>(
        `
      WITH ranked AS (
        SELECT player_id, username, metrics, info, achieved_at, sort_values,
          rank() OVER (ORDER BY sort_values) AS rank
        FROM entries WHERE leaderboard_id = $1
      ), page AS (
        SELECT * FROM ranked ORDER BY sort_values, achieved_at, player_id LIMIT $2 OFFSET $3
      ) SELECT (SELECT count(*) FROM ranked) AS total,
        (SELECT json_agg(page ORDER BY sort_values, achieved_at, player_id) FROM page) AS entries`,
        [board.id, req.query.limit, req.query.offset],
      );
      return {
        game: gameView(game),
        board: boardView(board),
        total: Number(rows[0]!.total),
        limit: req.query.limit,
        offset: req.query.offset,
        entries: (rows[0]!.entries ?? []).map(entryView),
      };
    },
  );
  app.get(
    `${api}/games/:game/boards/:board/players/:player`,
    {
      schema: {
        tags: ['players'],
        summary: '查询指定玩家名次',
        params: s.playerParams,
      },
    },
    async (req) => {
      const game = await getGame(req.params.game);
      const board = await getBoard(game, req.params.board);
      if (!board.public && !canReadPrivate(req, game))
        fail(401, 'UNAUTHORIZED', '此榜单需要玩家令牌或游戏密钥');
      const { rows } = await db.query<Entry>(
        `SELECT e.*, 1 + (SELECT count(*) FROM entries other
      WHERE other.leaderboard_id=e.leaderboard_id AND other.sort_values < e.sort_values) AS rank
      FROM entries e WHERE leaderboard_id=$1 AND player_id=$2`,
        [board.id, req.params.player],
      );
      if (!rows[0]) fail(404, 'PLAYER_NOT_RANKED', '玩家尚未上榜');
      return { entry: entryView(rows[0]!) };
    },
  );
  app.post(
    `${api}/games/:game/boards/:board/scores`,
    {
      schema: {
        tags: ['scores'],
        summary: '上报成绩（游客令牌自动绑定玩家）',
        params: s.boardParams,
        body: s.score,
        security: managerSecurity,
      },
    },
    async (req) => {
      const game = await getGame(req.params.game);
      const board = await getBoard(game, req.params.board);
      const server = canManage(req, game);
      const identity = server ? req.body.playerId : playerIdentity(req, game);
      if (!identity)
        fail(401, 'UNAUTHORIZED', server ? '后端提交必须提供 playerId' : '请先领取有效玩家令牌');
      if (!server && req.body.playerId && req.body.playerId !== identity)
        fail(403, 'PLAYER_MISMATCH', '只能提交自己的成绩');
      // Guest IDs are reserved so backend callers cannot accidentally collide with SDK identities.
      if (server && identity!.startsWith('guest_'))
        fail(400, 'RESERVED_PLAYER_ID', '后端 playerId 不能使用 guest_ 前缀');
      const values = board.sort_rules.map((rule) => {
        const value = req.body.metrics[rule.field];
        if (value === undefined) fail(400, 'MISSING_METRIC', `缺少排序字段：${rule.field}`);
        return rule.order === 'desc' ? -value! : value!;
      });
      const { rows } = await db.query<Entry>(
        `INSERT INTO entries(leaderboard_id, player_id, username, metrics, info, sort_values)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (leaderboard_id, player_id) DO UPDATE SET
        username=EXCLUDED.username, metrics=EXCLUDED.metrics, info=EXCLUDED.info,
        sort_values=EXCLUDED.sort_values, achieved_at=clock_timestamp()
      WHERE $7::boolean OR EXCLUDED.sort_values < entries.sort_values
      RETURNING *`,
        [
          board.id,
          identity,
          req.body.username,
          JSON.stringify(req.body.metrics),
          JSON.stringify(req.body.info),
          values,
          board.update_mode === 'latest',
        ],
      );
      return {
        accepted: rows.length > 0,
        playerId: identity,
        message: rows.length ? '成绩已记录' : '已保留更好或相同的历史成绩',
      };
    },
  );
  app.delete(
    `${api}/admin/games/:game/boards/:board/players/:player`,
    {
      schema: {
        tags: ['admin'],
        summary: '移除违规玩家成绩',
        params: s.playerParams,
        security: managerSecurity,
      },
    },
    async (req, reply) => {
      const game = await getGame(req.params.game);
      if (!canManage(req, game)) fail(401, 'UNAUTHORIZED', '需要管理员密钥或游戏后端密钥');
      const board = await getBoard(game, req.params.board);
      await db.query('DELETE FROM entries WHERE leaderboard_id=$1 AND player_id=$2', [
        board.id,
        req.params.player,
      ]);
      return reply.code(204).send();
    },
  );
  return app;
}
