# Codex Usage Desktop

一个本地优先的 Codex 使用量桌面看板。

它使用 Tauri 承载 React UI，通过本地 sidecar API 调用 `ccusage-codex daily --json`，把最近的每日 usage 汇总写入 SQLite，再展示最近 1 / 2 / 7 / 14 / 30 天的 token、成本和趋势。

## 当前能力

- 首次启动时扫描本地 Codex usage
- 将每日汇总缓存到本地 SQLite
- 展示总 tokens、总成本、日均、缓存命中率、每百万 token 成本
- 支持按 1d / 2d / 7d / 14d / 30d 切换窗口
- 支持重新扫描本地日志并刷新看板

## 技术结构

- `src/`: React 19 + Vite 前端
- `src-sidecar/`: 本地 HTTP sidecar，默认监听 `127.0.0.1:43110`
- `src-tauri/`: Tauri v2 宿主
- `codex-usage-desktop.db`: 运行时生成的本地 SQLite 缓存库

sidecar 目前提供这几个接口：

- `GET /api/health`
- `POST /api/scan`
- `GET /api/overview?range=7d`

## 环境要求

- Node.js `>= 24`
- `pnpm`
- Rust toolchain
- Tauri v2 所需的系统依赖

项目依赖里已经包含 `@ccusage/codex`，sidecar 会直接调用仓库内 `node_modules/.bin/ccusage-codex`。

## 安装

```bash
pnpm install
```

## 开发

推荐从真实启动路径进入：

```bash
pnpm dev:app
```

这个命令会通过 Tauri 启动桌面应用，并在 dev 模式下先拉起：

- Vite 前端：`http://localhost:5173`
- 本地 sidecar：`http://127.0.0.1:43110`

如果你只想分别调试各部分：

```bash
pnpm dev
pnpm dev:sidecar
```

或者只启动“前端 + sidecar”而不打开 Tauri 窗口：

```bash
pnpm dev:tauri
```

注意：

- 单独运行 `pnpm dev` 只会启动前端，不会自动提供真实数据。
- 这个项目的 UI 依赖 sidecar API；如果 sidecar 没启动，页面会进入加载失败状态。

## 构建

```bash
pnpm build
```

这会产出：

- 前端静态资源
- `dist-sidecar/` 下的 sidecar 构建结果

当前仓库主要覆盖开发链路；如果你要继续做正式打包，需要确认 Tauri bundle 流程里也包含 sidecar 产物和运行时编排。

## 测试

```bash
pnpm test
pnpm typecheck
```

运行真实 sidecar API 集成测试：

```bash
pnpm test:api
```

其中 `test:api` 会带上 `RUN_REAL_API_TESTS=1`，执行真实 HTTP 接口测试。

## 调试 sidecar

健康检查：

```bash
curl http://127.0.0.1:43110/api/health
```

触发一次扫描：

```bash
curl -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:43110/api/scan
```

读取 7 天概览：

```bash
curl 'http://127.0.0.1:43110/api/overview?range=7d'
```

## 可用环境变量

- `VITE_API_BASE_URL`: 前端请求的 API 地址，默认 `http://127.0.0.1:43110`
- `CODEX_USAGE_DESKTOP_PORT`: sidecar 端口，默认 `43110`
- `CODEX_USAGE_DESKTOP_DB_PATH`: SQLite 文件路径，默认 `./codex-usage-desktop.db`

## 已知边界

- 当前展示的是按天聚合后的 usage，不是会话级明细。
- 首次扫描依赖本地 Codex usage 数据可被 `ccusage-codex` 正常读取。
- Tauri 开发模式已接通 sidecar；正式打包链路还需要继续完善。
