# Codex Usage Desktop

一个本地优先的 Codex 使用量桌面看板。

它使用 Tauri 承载 React UI，在 Rust 中扫描本地 Codex session 日志，把每日 usage 汇总写入 SQLite，再展示最近 1 / 2 / 7 / 14 / 30 天的 token、成本和趋势。

## 当前能力

- 首次启动时扫描本地 Codex usage
- 将每日汇总缓存到本地 SQLite
- 展示总 tokens、总成本、日均、缓存命中率、每百万 token 成本
- 支持按 1d / 2d / 7d / 14d / 30d 切换窗口
- 支持重新扫描本地日志并刷新看板
- 支持将当前时间窗口导出为 Excel 或 Markdown

## 技术结构

- `src/`: React 19 + Vite 前端
- `src-tauri/`: Tauri v2 宿主和 Rust 原生 usage pipeline
- `codex-usage-desktop.db`: 运行时生成在 app data 目录中的本地 SQLite 缓存库

前端调用 Tauri commands：

- `scan_usage`
- `fetch_overview`
- `export_usage`

## 环境要求

- Node.js `>= 24`
- `pnpm`
- Rust toolchain
- Tauri v2 所需的系统依赖

## 安装

```bash
pnpm install
```

## 开发

推荐从真实启动路径进入：

```bash
pnpm dev:app
```

这个命令会通过 Tauri 启动桌面应用，并拉起 Vite 前端 `http://localhost:5173`。

单独运行 `pnpm dev` 只会启动浏览器前端，适合纯 UI 调试；真实扫描数据由 Tauri commands 提供。

## 构建

```bash
pnpm build
pnpm tauri build
```

打包后的 usage pipeline 是自包含的，不再启动 Node.js sidecar。

## 测试

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

## 可用环境变量

- `CODEX_HOME`: Codex home 目录，默认 `~/.codex`
- `CODEX_USAGE_TIMEZONE`: 日期分桶使用的时区，默认系统时区，失败时回退 UTC

## 已知边界

- 当前展示的是按天聚合后的 usage，不是会话级明细。
- 成本由 Rust app 内置的 model pricing 表计算；未知模型按零成本处理。
