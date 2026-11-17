# 网页小游戏排行榜接入指南

适用于原生 HTML/JavaScript、Vite、React、Vue、Phaser、Three.js 等浏览器游戏。游戏继续使用自己的页面和玩法，通过 HTTPS 调用独立的排行榜服务。

本文对应当前已部署的 v1 接口。网页直连已开启跨域，无需另搭后端、登录系统或数据库。

## 1. 服务地址与接入参数

| 项目               | 地址或说明                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ |
| 服务地址 `baseUrl` | `https://ranking-api-production-a8ed42bc.up.railway.app`                             |
| 浏览器 SDK         | [sdk.js](https://ranking-api-production-a8ed42bc.up.railway.app/sdk.js)              |
| API 前缀           | `/api/v1`，SDK 会自动添加，**不要写进 `baseUrl`**                                    |
| 管理工作台         | [打开工作台](https://ranking-api-production-a8ed42bc.up.railway.app/)                |
| 接口文档           | [Swagger 文档](https://ranking-api-production-a8ed42bc.up.railway.app/docs)          |
| 在线体验           | [接入试验场](https://ranking-api-production-a8ed42bc.up.railway.app/playground.html) |
| 独立网页示例       | [examples/](../examples/)                                                            |

正式接入前，向服务管理员确认下面这份配置：

```json
{
  "baseUrl": "https://ranking-api-production-a8ed42bc.up.railway.app",
  "game": "your-game",
  "board": "high-score",
  "sortRules": [
    { "field": "score", "order": "desc" },
    { "field": "duration", "order": "asc" }
  ],
  "updateMode": "best",
  "public": true,
  "allowGuest": true
}
```

`your-game` 需要由管理员事先创建，不能直接上报来自动建游戏。网页直连必须开启 `allowGuest`。字段名、大小写和计量单位应与项目约定一致；本指南的 `duration` 单位为秒。

可以先使用现成的 `game: 'demo'`、`board: 'high-score'` 跑通流程。示例榜按 **score 降序 → duration 升序** 排序，保留个人最好成绩。正式项目使用自己的游戏标识，避免不同项目的数据混在示例榜中。

网页开发者只需上述公开配置，**不需要管理员密钥、游戏后端密钥或数据库地址**。

## 2. 管理员准备：每个游戏做一次

服务管理员在工作台中完成：

1. 点击“管理访问”，使用 Railway `ranking-api` 服务变量中的 `ADMIN_API_KEY` 登录。
2. 点击“创建游戏”，填写游戏展示名称和唯一标识，例如“像素跑酷” / `pixel-runner`。工作台创建的游戏默认开启游客直传。
3. 为该游戏新建榜单，例如“总分榜” / `high-score`，设置排序规则和成绩更新方式。
4. 把服务地址、游戏标识、榜单标识、排序规则与单位交给小游戏开发者。

不要把管理密钥发给网页项目。创建游戏时返回的 `apiKey` 是受信任游戏后端使用的密钥，浏览器直连模式不使用它。

同一游戏可以有多个榜单，例如 `high-score`、`speed-run`、`hard-mode`、`season-2026-11`。排序规则创建后固定；变更字段、单位或规则时，应新建榜单。

## 3. 最快接入：原生网页

将下面代码放入网页，用现成的 `demo` 即可试用。正式接入时修改 `game` 和榜单标识，并将示例成绩替换为本局实际结果。

```html
<button id="submit-score">提交本局成绩</button>
<button id="refresh-ranking">刷新排行榜</button>
<pre id="ranking-output" role="status" aria-live="polite"></pre>

<script type="module">
  import { RankingClient } from 'https://ranking-api-production-a8ed42bc.up.railway.app/sdk.js';

  // 一个游戏页面复用一个客户端实例，不要每一帧重新创建。
  const ranking = new RankingClient({
    baseUrl: 'https://ranking-api-production-a8ed42bc.up.railway.app',
    game: 'demo',
  });
  const board = 'high-score';
  const output = document.getElementById('ranking-output');
  const submitButton = document.getElementById('submit-score');

  async function refreshRanking() {
    const { entries, total } = await ranking.top(board, { limit: 20 });
    const lines = entries.map(
      (entry) =>
        `${entry.rank}. ${entry.username}：${entry.metrics.score} 分，${entry.metrics.duration} 秒`,
    );
    output.textContent = `共 ${total} 位玩家\n${lines.join('\n') || '暂无成绩'}`;
  }

  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    try {
      const result = await ranking.submit(board, {
        username: '网页体验玩家（测试数据）',
        metrics: { score: 1200, duration: 65 },
        info: { level: 8, character: '法师' },
      });
      const { entry } = await ranking.me(board);
      await refreshRanking();
      output.textContent += `\n${result.accepted ? '成绩已记录' : '已保留历史最好成绩'}，当前第 ${entry.rank} 名`;
    } catch (error) {
      output.textContent = error.message || '网络暂不可用，请稍后重试';
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById('refresh-ranking').addEventListener('click', () => {
    refreshRanking().catch((error) => {
      output.textContent = error.message || '排行榜暂不可用';
    });
  });
</script>
```

通过开发服务器的 HTTP 地址或已部署的 HTTPS 地址打开页面，不要直接双击 `file://` 文件。上例的按钮仅用于体验；游戏中应在结算确认后调用上报逻辑。

## 4. 在 Vite / React / Vue 等工程中接入

推荐把 [sdk.js](https://ranking-api-production-a8ed42bc.up.railway.app/sdk.js) 下载到项目，例如 `src/lib/ranking-sdk.js`，由构建工具一起打包。这样不用配置构建工具对远程 HTTPS 模块的处理，SDK 版本也由项目自己控制。

下面是 JavaScript 工程的封装示例 `src/services/leaderboard.js`：

```javascript
import { RankingClient } from '../lib/ranking-sdk.js';

const ranking = new RankingClient({
  baseUrl: 'https://ranking-api-production-a8ed42bc.up.railway.app',
  game: 'pixel-runner', // 改为已创建的正式游戏标识
});
const board = 'high-score';

export function submitGameResult({ username, score, durationSeconds, level, character }) {
  return ranking.submit(board, {
    username,
    metrics: { score, duration: durationSeconds },
    info: { level, character },
  });
}

export function loadLeaderboard(page = 1) {
  return ranking.top(board, { limit: 20, offset: (page - 1) * 20 });
}

export function loadMyRank() {
  return ranking.me(board);
}
```

在游戏结算事件中调用 `submitGameResult`，打开排行榜弹窗时调用 `loadLeaderboard`。不需要为了接入更改游戏引擎或组件结构。TypeScript 工程可将 SDK 纳入项目的 JavaScript 类型配置；如果希望直接使用已声明的接口类型，也可按第 9 节通过原生 `fetch` 接入。

推荐的调用时机：

| 时机            | 操作                                              |
| --------------- | ------------------------------------------------- |
| 玩家打开游戏    | 初始化一个 `RankingClient`，不必马上申请身份      |
| 玩家进入排行榜  | `ranking.top(board)`，公开榜不消耗身份申请次数    |
| 一局游戏结束    | `ranking.submit(board, result)`                   |
| 上报完成        | 刷新榜单，并调用 `ranking.me(board)` 显示个人名次 |
| 切换难度 / 赛季 | 改用对应榜单标识，继续复用同一游戏客户端          |

不要在渲染循环、每次分数变化或每次组件渲染时提交。网络失败时保留结算结果，让玩家可以重试；排行榜故障不应阻塞游戏结算本身。

## 5. 上报字段与排序含义

```json
{
  "username": "小明",
  "metrics": {
    "score": 1200,
    "duration": 65
  },
  "info": {
    "level": 8,
    "character": "法师",
    "equipment": ["木杖", "布甲"]
  }
}
```

| 字段               | 要求                                                       | 用途                                                 |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| `username`         | 去除首尾空格后 1–80 字符                                   | 展示名称，允许重名，不用来识别账号                   |
| `metrics`          | 数值对象，最多 20 个字段                                   | 保存成绩；榜单配置中的排序字段必须全部提供           |
| `metrics` 的字段名 | 以英文字母开头，其余为英文字母、数字或下划线，最长 40 字符 | 例如 `score`、`duration`、`kills`                    |
| `metrics` 的值     | 有限数值，范围为 `±Number.MAX_SAFE_INTEGER`                | 不能传 `"1200"` 这样的字符串、`null`、`NaN` 或无穷大 |
| `info`             | 可选 JSON 对象，最多 16 KB，默认 `{}`                      | 保存关卡、角色、装备等说明信息，不直接参与排序       |

整个请求体最多 32 KB。用户名和 `info` 会跟随成绩被有读取权限的人看到，请只放可展示的游戏信息。

计量单位要提前统一。如果玩法需要毫秒精度，可创建按 `durationMs` 升序的榜单，并始终上报整数毫秒；不要在已有 `duration` 秒榜中混用毫秒。参与排序的数据必须在 `metrics` 中，放在 `info` 里不会影响名次。

排序按规则依次比较。例如 `score desc`、`duration asc`：

| 玩家 | score | duration | 名次 |
| ---- | ----: | -------: | ---: |
| 小明 |  1200 |       50 |    1 |
| 小红 |  1200 |       50 |    1 |
| 小李 |  1200 |       65 |    3 |
| 小王 |  1100 |       30 |    4 |

全部排序字段相同才并列，同分时展示顺序按记录时间、玩家 ID 稳定排列。展示排名应使用返回的 `entry.rank`，不要自行用数组下标加一计算。

成绩更新方式由管理员建榜时选择：

- `best`：只在本局成绩按完整排序规则更好时更新；相同或较差时返回 `accepted:false`，请求本身仍然成功。
- `latest`：每次有效提交均覆盖该玩家在此榜的成绩。

每位玩家每个榜单保留一份成绩。`best` 模式保存的是最好那次的完整用户名、成绩和 `info`；较差的一局也不会覆盖这些展示信息。不提供自动累计得分或每局历史列表。

## 6. 查询榜单与个人名次

```javascript
// 前 20 名；下一页 offset=20，再下一页 offset=40。
const { entries, total, limit, offset } = await ranking.top('high-score', {
  limit: 20,
  offset: 0,
});

// 当前匿名玩家的个人名次，不受榜单前 20 条限制。
const { entry } = await ranking.me('high-score');
console.log(entry.rank);
```

排名条目格式如下，下面的值仅作结构示例：

```json
{
  "rank": 3,
  "playerId": "guest_12345678-1234-1234-1234-123456789012",
  "username": "小明",
  "metrics": { "score": 1200, "duration": 65 },
  "info": { "level": 8, "character": "法师" },
  "achievedAt": "2026-11-17T03:30:00.000Z"
}
```

`achievedAt` 为 ISO 时间，可通过 `new Date(entry.achievedAt).toLocaleString()` 按玩家本地时间展示。渲染玩家名称和游戏信息时使用 `textContent` 或框架默认的文本转义。

分页的 `limit` 为 1–100，`offset` 为 0–10000。`total` 是榜单玩家总数；空榜返回 `entries:[]`、`total:0`。实时成绩变化可能导致翻页时位置变化，不保证跨请求快照。

玩家尚未上榜时，`ranking.me()` 返回 HTTP 404、`code: 'PLAYER_NOT_RANKED'`，界面应显示“完成一局后上榜”。注意：`me()` 会先申请或复用匿名身份；如果只展示榜单而不需要个人信息，直接调用 `top()` 即可。

若榜单设为 `public:false`，使用：

```javascript
const data = await ranking.top('high-score', { authenticated: true });
```

这表示需要同游戏的有效身份，**不是只允许本人查看自己的成绩**。开启游客的游戏中，任何访问者都可以申请身份。

## 7. 匿名玩家身份

SDK 首次 `submit()`、`me()` 或 `session()` 时自动申请身份，后续在同一客户端中复用。

```javascript
const { playerId, expiresAt } = await ranking.session();
// expiresAt 的单位是 Unix 秒。
```

- 默认在小游戏网站自己的 `localStorage` 中保存玩家 ID、令牌及过期时间，刷新页面会复用。
- 身份按“服务地址 + 游戏标识”区分，同一游戏的多个榜单共用玩家身份。
- 令牌有效期为 30 天，SDK 在令牌过期或临近过期时重新申请身份；这会生成新的玩家 ID，旧成绩仍然保留。
- 清理浏览器存储、换浏览器、换设备、切换网站来源或端口，也会使用新身份。开发环境和正式网站的匿名玩家不会自动合并。
- 没有账号恢复、跨设备同步、身份合并功能；用户名相同也不会合并成绩。
- 存储不可用时，SDK 退化为当前客户端实例内存存储。需要自定义存储时传入同步的 `getItem(key)` / `setItem(key,value)` 实现；`storage:null` 则只在内存保留。

网页上报时不用传 `playerId`，令牌已绑定本人。不要自己用用户名、随机数或 `localStorage` 里的另一个自定义 ID 冒充服务端玩家 ID。

同一页面请共享一个客户端实例；不要在多个组件里同时各自初始化并首次申请身份，以免产生不同匿名玩家。

## 8. 错误处理与重试

SDK 的 HTTP 错误包含 `error.status`、`error.code`、`error.message`。断网、跨域阻止等浏览器网络错误可能只有 `message`，没有 HTTP 状态码。

```javascript
try {
  const { entry } = await ranking.me('high-score');
  console.log(`我的名次：${entry.rank}`);
} catch (error) {
  if (error.code === 'PLAYER_NOT_RANKED') {
    console.log('完成一局后上榜');
  } else if (error.status === 429) {
    console.log('操作太频繁，请稍后再试');
  } else {
    console.log(error.message || '排行榜暂不可用');
  }
}
```

| 现象或错误                           | 原因与处理                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| HTTP 200，`accepted:false`           | 正常业务结果，历史成绩更好或相同；展示“已保留最好成绩”                               |
| `MISSING_METRIC` / HTTP 400          | 漏传排序字段，核对建榜规则                                                           |
| `VALIDATION_ERROR` / HTTP 400        | 字段类型、范围、名称、长度或 `info` 大小不符合约束                                   |
| `GAME_NOT_FOUND` / `BOARD_NOT_FOUND` | 游戏或榜单未创建，或标识拼错；检查使用的是 slug，不是展示名称或 UUID                 |
| `PLAYER_NOT_RANKED`                  | 该身份还没有上榜，显示空状态                                                         |
| `UNAUTHORIZED` / HTTP 401            | 令牌无效、已被服务端签名密钥轮换作废，或游客提交已关闭；不要无限重试或换成管理员密钥 |
| `GUEST_DISABLED` / HTTP 403          | 游戏未开放网页游客直传，联系服务管理员                                               |
| `PLAYER_MISMATCH` / HTTP 403         | 自行传入的 `playerId` 与令牌不一致；SDK 正常提交不需要此字段                         |
| HTTP 413                             | 请求体超出 32 KB，精简游戏信息                                                       |
| HTTP 429                             | 触发限流，延迟后再请求，不要连续申请新身份                                           |
| `TypeError: Failed to fetch`         | 查看浏览器 Network：网络、服务地址、CORS、CSP 均可能导致                             |

当前限流为每 IP 每分钟 120 个请求，申请身份每 IP 每小时 20 次，多个玩家共用出口时会共享 IP 额度。不要轮询排行榜到每秒多次；优先在打开面板、游戏结算或玩家手动刷新时请求。

网络失败可保留本局结果供手动重试，但服务未提供幂等请求 ID 或离线提交队列。`best` 下重复成绩不会覆盖；`latest` 下重试或迟到请求仍会作为一次新提交，可能覆盖更新的结果。发生 401 时 SDK 不会自动把仍在本地有效期内的身份替换掉；需要先确认游客开关和服务端是否轮换过签名密钥，重新创建匿名身份会失去对旧身份的关联。

## 9. 不使用 SDK：原生 fetch / TypeScript

所有步骤均使用相同的 `baseUrl` 和游戏标识。下面用 `demo` 展示请求，实际项目替换为自己的标识。

### 9.1 申请身份

```http
POST https://ranking-api-production-a8ed42bc.up.railway.app/api/v1/games/demo/sessions
```

返回 HTTP 201：

```json
{
  "playerId": "guest_12345678-1234-1234-1234-123456789012",
  "token": "服务端签发的玩家令牌",
  "expiresAt": 1797476400
}
```

自己保存并复用 `playerId`、`token`、`expiresAt`。不要每次提交都重新申请身份。

### 9.2 提交成绩

```javascript
const response = await fetch(
  'https://ranking-api-production-a8ed42bc.up.railway.app/api/v1/games/demo/boards/high-score/scores',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${savedIdentity.token}`,
    },
    body: JSON.stringify({
      username: '小明',
      metrics: { score: 1200, duration: 65 },
      info: { level: 8 },
    }),
  },
);
const data = await response.json();
if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
```

`savedIdentity` 指上一步保存的身份对象。返回 HTTP 200：

```json
{
  "accepted": true,
  "playerId": "guest_12345678-1234-1234-1234-123456789012",
  "message": "成绩已记录"
}
```

### 9.3 查询数据

```http
GET https://ranking-api-production-a8ed42bc.up.railway.app/api/v1/games/demo/boards/high-score?limit=20&offset=0

GET https://ranking-api-production-a8ed42bc.up.railway.app/api/v1/games/demo/boards/high-score/players/你的playerId
```

公开榜单的这两个 GET 请求无需令牌。私有榜单需增加同游戏有效玩家令牌的 `Authorization` 请求头。

TypeScript 工程可按以下接口声明客户端数据；字段内容由各游戏定义，`info` 是普通 JSON 对象：

```typescript
interface PlayerIdentity {
  playerId: string;
  token: string;
  expiresAt: number;
}

interface RankingEntry {
  rank: number;
  playerId: string;
  username: string;
  metrics: Record<string, number>;
  info: Record<string, unknown>;
  achievedAt: string;
}
```

## 10. 跨域、发布与验证

当前服务配置 `CORS_ORIGINS=*`，允许网页游戏跨域访问，支持 `Authorization`、`Content-Type` 与 OPTIONS 预检。浏览器会自动发送预检请求，不需要小游戏手动实现 OPTIONS。

- 正常使用 `fetch` 默认跨域模式；不要设置 `mode:'no-cors'`，否则无法按此协议发送和读取数据。
- 不依赖 Cookie，不设置 `credentials:'include'`。
- 如游戏配置了 CSP，`connect-src` 要允许服务域名；从远程导入 SDK 时 `script-src` 也要允许该域名。SDK 打包进自己的站点后只需要放通对应 API 连接。
- 如果将来改为来源白名单，请把正式域名、预览域名和开发端口的完整 origin 交给管理员，格式如 `https://game.example.com`、`http://localhost:5173`，不含路径和末尾斜杠。
- 浏览器令牌只能防止覆盖他人的身份记录，不能证明分数真实。娱乐榜可直接接入；竞技、奖励等可信成绩应由游戏后端验证，关闭游客提交后使用后端专用密钥上报。

正式接入后，在小游戏自己的域名和浏览器中完成下面的检查：

1. 结算提交一局成绩，确认返回 `accepted:true`，工作台看到相同记录。
2. 刷新小游戏再提交，确认玩家 ID 不变，每人每榜仍只有一条记录。
3. `best` 模式提交更差成绩，确认返回 `accepted:false`，原记录保持不变。
4. 核对多字段排序和同分并列，界面显示服务返回的 `rank`。
5. 未上榜时显示空状态，断网或限流时游戏结算仍可继续。
6. 在正式网页来源验证跨域；不要只用 curl 或服务同源试验场代替这一项。

## 11. 可转发给项目开发者的接入任务

将下面内容连同本文链接交给小游戏开发者，填好方括号部分即可：

```text
请为本网页小游戏接入通用排行榜。

服务地址：https://ranking-api-production-a8ed42bc.up.railway.app
SDK：https://ranking-api-production-a8ed42bc.up.railway.app/sdk.js
游戏标识：[已经由管理员创建的 game slug]
榜单标识：[已经创建的 board slug]
排序规则及单位：[例如 score 降序，duration 秒数升序]
更新方式：[best 或 latest]
游客提交：[开启]

要求：
1. 在游戏结算时提交 username、metrics 和可展示的 info。
2. 同一页面复用 SDK 客户端，刷新后复用匿名身份。
3. 提供排行榜面板和我的名次，显示服务返回的 rank。
4. 区分 accepted:false、尚未上榜、网络失败和限流。
5. 不把管理员密钥或游戏后端密钥放入网页。
6. 在游戏自己的网页来源完成跨域提交、查询和刷新身份复用验收。

完整指南：https://github.com/GOD-OF-PPT/common-game-ranking-list/blob/main/docs/web-game-integration.md
```
