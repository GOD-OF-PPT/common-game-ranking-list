# Common Game Ranking List

面向网页小游戏的通用排行榜服务。支持游戏名、用户名、用户游戏信息和自定义排序依据，直接通过跨域 HTTP API 或浏览器 SDK 接入。

当前部署：[工作台](https://ranking-api-production-a8ed42bc.up.railway.app/) · [API 文档](https://ranking-api-production-a8ed42bc.up.railway.app/docs) · [接入试验场](https://ranking-api-production-a8ed42bc.up.railway.app/playground.html)。

其他网页小游戏项目请先阅读 [网页小游戏接入指南](docs/web-game-integration.md)：包含完整代码示例、工程集成、字段约定、身份复用、错误处理和可直接转发的接入任务。

已创建 `demo` 示例游戏，包含 `high-score` 总分榜和 `speed-run` 速通榜。示例成绩明确标记为测试数据。

## 能力与数据模型

```text
游戏 game（slug、名称、游客开关、独立后端密钥）
  └── 榜单 leaderboard（slug、名称、排序规则、成绩更新方式）
        └── 成绩 entry（playerId、username、metrics、info、记录时间）
```

- **一个游戏多个榜单**：总分、速通、不同难度或赛季分别建榜；创建新赛季的榜单即可保留旧赛季记录。
- **最多 5 个排序字段**：按顺序逐项比较，支持每项独立升序 `asc` / 降序 `desc`。例如先比较分数，分数相同时再比较耗时。
- **最好或最新**：`best` 保存完整的最好成绩及当次用户名、游戏信息；相同成绩不覆盖。`latest` 覆盖为最新成绩。
- **同分并列**：全部排序字段相同时并列，名次为 `1、1、3`；展示顺序按达到该成绩的时间、玩家 ID 保持稳定。
- **用户游戏信息**：`info` 是最多 16 KB 的 JSON 对象，例如关卡、角色、装备。会随成绩展示，请勿上传邮箱、手机号、密钥等隐私数据。
- **身份分离**：用户名只作展示，可以重名。玩家 ID 用于关联，匿名玩家由服务端分配，不能指定其他玩家的 ID。
- **PostgreSQL 持久化**：每榜每玩家一条记录，原子 UPSERT 保证并发上报不会让较差成绩覆盖较好成绩。启动时执行带数据库锁的版本迁移。

技术栈：Node.js 22.12+、TypeScript、Fastify、PostgreSQL。无需 Redis。工作台位于 `/`，API 交互文档位于 `/docs`，浏览器接入试验场位于 `/playground.html`。

## 网页小游戏接入

### 1. 创建游戏和榜单

打开工作台，点击“管理访问”，输入 Railway `ranking-api` 服务变量中的 `ADMIN_API_KEY`，然后创建游戏及榜单。管理密钥只在当前页面的内存中使用。

也可以通过 HTTP 创建：

```bash
# 将 URL 替换为自己的部署地址；管理密钥仅用于管理或受信任的后端。
export BASE_URL="http://localhost:3000"
export ADMIN_API_KEY="your-admin-key"

curl "$BASE_URL/api/v1/admin/games" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug":"pixel-runner","name":"像素跑酷","allowGuest":true}'

curl "$BASE_URL/api/v1/games/pixel-runner/boards" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug":"high-score","name":"总分榜","sortRules":[{"field":"score","order":"desc"},{"field":"duration","order":"asc"}],"updateMode":"best","public":true}'
```

游戏 `slug` 和榜单 `slug` 使用小写字母、数字和单连字符，最多 64 字符。创建后排序规则固定，避免旧成绩被错误解释；更换规则请新建榜单。

### 2. 在网页中调用 SDK

SDK 是无依赖 ESM，随服务发布。它的跨域模块加载也允许 CORS。

```html
<script type="module">
  import { RankingClient } from 'https://YOUR-SERVICE.up.railway.app/sdk.js';

  const ranking = new RankingClient({
    baseUrl: 'https://YOUR-SERVICE.up.railway.app',
    game: 'pixel-runner',
  });

  // 在游戏结束后调用；首次提交会自动领取匿名玩家令牌。
  const result = await ranking.submit('high-score', {
    username: '小明',
    metrics: { score: 1200, duration: 65.3 },
    info: { level: 8, character: '法师', equipment: ['木杖'] },
  });
  // accepted=false 表示成绩有效，但已保留更好或相同的历史成绩。
  console.log(result.accepted);

  const { entries, total } = await ranking.top('high-score', { limit: 20 });
  const { entry } = await ranking.me('high-score');
  console.log(entries, total, entry.rank);
</script>
```

SDK 默认在**游戏网站自身的 localStorage** 保存令牌，30 天有效。相同浏览器、网站来源和游戏会复用身份。清除存储、换设备、换网站来源或令牌到期后会产生新身份；首版不提供账号恢复和跨设备合并。localStorage 不可用时退化为当前客户端实例的内存存储。需要自己的存储时，传入实现 `getItem` / `setItem` 的 `storage`；传 `null` 仅在内存保留。

公开榜单无需令牌即可读取。若榜单设置 `public:false`，需 `ranking.top('board', { authenticated:true })`；该设置只要求同游戏有效身份，**不代表仅管理员或指定玩家可见**。游客开放的游戏任何访问者都能申请身份。

仓库还提供 [独立站点接入示例](examples/index.html)，可在其他来源运行，验证真实浏览器跨域：

```bash
python -m http.server 3817 --bind 127.0.0.1 --directory examples
# 打开 http://127.0.0.1:3817，默认连接已部署的 demo 游戏。
```

### 3. 不使用 SDK 时的请求链路

```text
POST /api/v1/games/pixel-runner/sessions
  → { playerId, token, expiresAt }   // expiresAt 为 Unix 秒

POST /api/v1/games/pixel-runner/boards/high-score/scores
Authorization: Bearer <token>
Content-Type: application/json
{ "username":"小明", "metrics":{"score":1200,"duration":65.3}, "info":{"level":8} }
  → { accepted:true, playerId, message }

GET /api/v1/games/pixel-runner/boards/high-score?limit=20&offset=0
  → { game, board, entries:[{rank,playerId,username,metrics,info,achievedAt}], total, limit, offset }

GET /api/v1/games/pixel-runner/boards/high-score/players/<playerId>
  → { entry:{rank,playerId,username,metrics,info,achievedAt} }
```

匿名提交可以省略 `playerId`，由令牌决定；如果提供，必须与令牌一致。排序字段必须全部包含在 `metrics` 中，且为有限数值，范围为 `±Number.MAX_SAFE_INTEGER`；其余数值字段也可保存，最多 20 项。建议用整数分或毫秒，避免浮点精度影响同分判断。

`limit` 为 1–100，`offset` 为 0–10000，默认 20 / 0。分页查询期间有新成绩时位置会变化，不提供快照分页。

## 接口一览

| 方法   | 路径（前缀 `/api/v1`）                             | 权限                                 |
| ------ | -------------------------------------------------- | ------------------------------------ |
| GET    | `/admin/session`                                   | 管理员，校验管理身份                 |
| GET    | `/games`                                           | 公开，返回游戏目录                   |
| POST   | `/admin/games`                                     | 管理员，创建游戏，后端密钥仅返回一次 |
| PATCH  | `/admin/games/:game`                               | 管理员，修改名称和游客开关           |
| POST   | `/admin/games/:game/rotate-key`                    | 管理员，轮换后端密钥                 |
| POST   | `/games/:game/sessions`                            | 开启游客的游戏，领取身份             |
| GET    | `/games/:game/boards`                              | 公开；私有榜单需同游戏身份           |
| POST   | `/games/:game/boards`                              | 管理员或该游戏后端密钥               |
| GET    | `/games/:game/boards/:board`                       | 公开榜单公开；其他需同游戏身份       |
| GET    | `/games/:game/boards/:board/players/:player`       | 同榜单读取权限                       |
| POST   | `/games/:game/boards/:board/scores`                | 同游戏玩家令牌、后端密钥或管理员     |
| DELETE | `/admin/games/:game/boards/:board/players/:player` | 管理员或该游戏后端密钥，移除违规成绩 |

管理员通过 `Authorization: Bearer <ADMIN_API_KEY>` 鉴权。游戏后端通过 `X-API-Key: <apiKey>` 鉴权，上报时需要指定自己的稳定 `playerId`，允许字母、数字、下划线和连字符，最长 128 字符。`guest_` 前缀为匿名身份保留。密钥在数据库中仅存 SHA-256 哈希。

错误响应为 `{code,message,requestId}`，参数错误可能附带 `details`。常见状态码：400 参数错误、401 缺少有效身份、403 身份不匹配或游客关闭、404 游戏/榜单/玩家不存在、409 标识重复、413 请求体过大、429 频率过高、503 健康检查失败。

## 跨域和信任边界

- 默认 `CORS_ORIGINS=*`，允许任意网页小游戏访问；支持 OPTIONS 预检、`Authorization`、`Content-Type`、`X-API-Key`。不使用 Cookie，不需要 `credentials:include`。
- 可设置 `CORS_ORIGINS=https://game-a.example,https://game-b.example` 为精确来源列表。来源包含协议和端口，不包含路径或末尾斜杠。控制台与服务同源访问正常；外部 SDK 模块也受此列表约束。
- **CORS 不是防作弊措施。** 浏览器上报的成绩可以被玩家改写，令牌只能保护身份，不能证明分数真实。默认游客直连适合娱乐榜；不适合奖金、竞技认证等场景。
- 要使用可信成绩，关闭游戏 `allowGuest`，让游戏后端验证身份、成绩并使用独立游戏密钥上报。玩家 ID 由后端的账号系统提供。
- 不要把管理员密钥或游戏后端密钥放进网页、游戏包、URL 或公共仓库。游客令牌只允许同游戏内该身份写入。
- 默认每 IP 每分钟 120 请求，领取身份每 IP 每小时 20 次，存于单进程内存；重启会重置。批量共享同一出口的玩家应按实际情况调整。扩容多实例前应接入共享限流存储。
- 用户名、游戏信息在自带工作台中用 `textContent` 展示，不作为 HTML 执行。接入方也应安全渲染玩家数据。

## 本地开发

```bash
npm ci
cp .env.example .env
# 修改 ADMIN_API_KEY 和 PLAYER_TOKEN_SECRET，分别使用至少 32 字符的随机值。
docker compose up -d
npm run dev
```

打开 [本地工作台](http://localhost:3000)、[本地 API 文档](http://localhost:3000/docs)。`npm run dev` 和 `npm start` 自动读取本地 `.env`。数据库表在启动时自动迁移。

| 变量                  | 说明                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`        | 必填，PostgreSQL 连接字符串                                                      |
| `ADMIN_API_KEY`       | 必填，至少 32 字符随机管理员密钥                                                 |
| `PLAYER_TOKEN_SECRET` | 必填，至少 32 字符、与管理员密钥不同的随机令牌签名密钥；轮换会使所有游客令牌失效 |
| `PORT`                | 默认 3000；Railway 自动注入                                                      |
| `CORS_ORIGINS`        | 默认 `*`，或精确来源的逗号分隔列表                                               |

```bash
npm run check
npm test
npm run build
npm start
```

测试使用 PGlite 的真实 PostgreSQL 执行引擎运行迁移及业务 SQL，不依赖 Docker，也不以假仓储替代排名查询。覆盖混合排序、并列名次、个人最好/最新、并发覆盖、游戏和玩家隔离、令牌过期、私有榜单、跨域预检、校验、密钥轮换和浏览器 SDK 身份复用。CI 自动运行类型检查、测试和构建。

线上验收脚本读取环境变量或本地 `.env` 中的管理员密钥，不输出凭据；会补齐 `demo` 游戏和两个榜单，写入并清理自己的临时测试成绩：

```bash
BASE_URL=https://YOUR-SERVICE.up.railway.app node scripts/verify-live.mjs
```

实际部署与验收结果见 [验证记录](docs/verification.md)。

## Railway 部署

1. 从此仓库 `main` 创建服务，使用仓库内 `Dockerfile` 和 `railway.json`。
2. 添加 PostgreSQL 模板，保留持久卷。
3. 为 API 服务设置 `DATABASE_URL=${{Postgres.DATABASE_URL}}`，分别生成 `ADMIN_API_KEY` 和 `PLAYER_TOKEN_SECRET`，并设置 `CORS_ORIGINS=*`。
4. API 与 PostgreSQL 放在同一地区；数据库走 Railway 私网，不需要公开数据库端口。
5. 生成 API 公网域名。`/health` 会实际查询数据库，失败返回 503。进程监听 `0.0.0.0:$PORT`。
6. 打开工作台输入管理员密钥，创建游戏及榜单，网页小游戏即可接入。

服务不将数据写在容器临时磁盘。数据库备份及恢复策略需在 Railway 单独配置；本项目不自动删除旧赛季或记录。首版以单实例、中小规模榜单为目标，保留排序索引；排名分页使用窗口查询，大规模数据上线前应压测，再评估 Redis Sorted Set、预计算名次或游标查询。当前没有百万级性能或高可用承诺。

## 设计选择

排序值根据规则转换为 PostgreSQL 数值数组：降序字段取负值，升序保持原值，统一按数组字典序升序排列。由此支持多字段组合，同时用同一数据库索引和比较表达式判断“是否更好”；不会拼接用户提供的 SQL 字段或排序片段。游戏、榜单和玩家记录分别隔离，业务查询均参数化。

赛季、模式、难度通过不同榜单表达；装备、关卡等游戏特有信息通过 `info` 表达。首版保留每人每榜单一份成绩，不保存每次尝试历史，不提供累计分数、好友关系或自动赛季结算。
