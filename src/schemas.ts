import { z } from 'zod';

export const slug = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const gameParams = z.object({ game: slug });
export const boardParams = gameParams.extend({ board: slug });
export const playerParams = boardParams.extend({ player: z.string().min(1).max(128) });
export const name = z.string().trim().min(1).max(100);
export const createGame = z.object({ slug, name, allowGuest: z.boolean().default(true) }).strict();
export const sortRules = z.array(z.object({
  field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  order: z.enum(['asc', 'desc'])
}).strict()).min(1).max(5).refine(rules => new Set(rules.map(r => r.field)).size === rules.length, '排序字段不能重复');
export const createBoard = z.object({
  slug, name, sortRules,
  updateMode: z.enum(['best', 'latest']).default('best'),
  public: z.boolean().default(true)
}).strict();
export const score = z.object({
  playerId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  username: z.string().trim().min(1).max(80),
  metrics: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER))
    .refine(v => Object.keys(v).length <= 20, '最多 20 个数值字段'),
  info: z.record(z.string(), z.json()).default({})
    .refine(v => Buffer.byteLength(JSON.stringify(v)) <= 16384, '用户游戏信息不能超过 16 KB')
}).strict();
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0)
});
