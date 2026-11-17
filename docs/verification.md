# 部署与验证记录

日期：2026-11-17（Asia/Shanghai）。

## 部署

- GitHub：`GOD-OF-PPT/common-game-ranking-list`，`main` 分支，推送自动部署。
- Railway 项目：`common-game-ranking-list`（`5699d1d1-ddbb-41a3-a987-d03951333edd`）。
- 环境：`production`（`14c5ff0b-7087-4291-9c8e-0a39abc93773`）。
- API：`ranking-api`，单实例，新加坡 `asia-southeast1-eqsg3a`。
- 数据库：Railway PostgreSQL 18 模板，私网连接，5 GB 持久卷；数据库没有公开端口。
- 访问地址：https://ranking-api-production-a8ed42bc.up.railway.app/ 。
- 管理员和玩家签名密钥分别随机生成，保存在 Railway 服务变量及本地被 Git 忽略的 `.env`；未写入仓库。
- 首次成功部署：`a3b73ca9-2a40-429f-9939-6c499ef3e624`，业务源码 `d512f149372683deaf767895804437bab5fd259d`。

## 自动检查

- `npm run check`：通过。
- `npm test`：13 项通过，运行 PGlite PostgreSQL 引擎及实际业务 SQL。
- `npm run build`：通过。
- `npm audit`：0 已知漏洞（检查时锁文件版本）。
- `scripts/verify-live.mjs`：线上通过数据库健康、管理鉴权、真实写入与读取、保留更好成绩、同分耗时比较、玩家名次、跨域预检、无令牌写入拒绝、SDK 与文档可访问性。临时后端测试成绩已清理。

## 浏览器验证

在 Chrome 从独立来源 `http://127.0.0.1:3817` 打开仓库的 `examples/`：

1. 从 Railway HTTPS 域名跨域导入 `/sdk.js`。
2. SDK 向 Railway 申请匿名玩家身份。
3. 使用 Bearer 令牌跨域 POST 成绩，返回 `accepted:true`。
4. 查询我的名次，返回第 1 名，分数 1800、耗时 65。
5. 刷新独立示例网页，再查询名次：玩家 ID 保持一致，仍可查询自己的记录。
6. 打开线上工作台，看到同一份成绩和实际玩家总数。
7. 切换速通榜：独立空榜展示正常。
8. 从线上接入试验场读取榜单：返回相同的 1 条成绩。
9. 工作台浏览器控制台未发现错误或警告。

保留 `demo` 示例游戏及两个榜单；总分榜的一条记录名为“跨域演示玩家（测试数据）”，用于说明真实跨域接入结果，并非真实游戏用户。

## 验证范围

完成了实际 Railway 部署、数据库写入读取与桌面 Chrome 跨域链路验证。尚未进行大数据量压测、跨地区延迟测试、移动设备测试、备份恢复演练或游戏防作弊验证。匿名令牌保证身份绑定，不证明浏览器上报分数真实。
