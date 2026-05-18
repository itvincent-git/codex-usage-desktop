# Codex Usage Desktop

一个本地优先的 Codex CLI 使用量桌面看板，用来查看本机 Codex 使用量和预估成本。

如果你在本机使用 Codex CLI，并希望不用上传本地日志就能查看近期 token、成本趋势、模型用量和项目用量，可以使用这个应用。

## 功能亮点

- 本地扫描 Codex CLI session 日志。
- 支持从 1 天到 90 天的 Dashboard 时间窗口。
- 提供 Monthly 视图，查看更长期的自然月汇总。
- 展示 token、缓存、成本、模型和项目维度的拆分。
- 可将当前 Dashboard 时间窗口导出为 Excel 或 Markdown。
- 支持清空本地缓存，并从 Codex 日志重新构建 usage 数据。

## 如何使用

1. 打开桌面应用。
2. 首次启动时，应用会从 `~/.codex` 读取本地 Codex session 日志，并建立本地 usage 缓存。
3. 在 Dashboard 视图查看总 tokens、预估成本、日均、缓存命中率、每百万 token 成本、每日趋势、模型用量和项目用量。
4. 在 Dashboard 中切换 1d / 2d / 7d / 14d / 30d / 60d / 90d 时间窗口。
5. 打开 Monthly 视图查看自然月汇总。
6. 新的 Codex session 产生后，点击 `Rescan local logs` 刷新看板。
7. 点击 `Export`，将当前 Dashboard 时间窗口导出为 Excel (`.xlsx`) 或 Markdown (`.md`)。
8. 如果本地缓存需要重建，在 Settings 中点击 `Reset cache`，应用会清空缓存并从 Codex 日志重新构建。

## 数据和隐私

- 扫描和重置操作只读取本地 Codex 日志，不会删除原始日志。
- Usage 汇总会保存在应用数据目录中的本地 SQLite 缓存里。
- Pricing 数据会缓存在本地。缓存不存在时，应用会尝试从 LiteLLM 拉取 Codex 模型价格；如果拉取失败，则使用内置 pricing 表。
- 成本是基于应用当前可用 pricing 数据计算的估算值。

## 高级选项

- `CODEX_HOME`: Codex home 目录，默认 `~/.codex`
- `CODEX_USAGE_TIMEZONE`: 日期分桶使用的时区，默认系统时区，失败时回退 UTC

## 当前边界

- 当前展示的是按天和按月聚合后的 usage，不是会话级明细。
- 未知模型按零成本处理。

## 开发者说明

应用使用 React 19、Vite、Tauri v2 和 Rust 原生 usage pipeline 构建。本地开发需要 Node.js `>= 24`、`pnpm`、Rust 和 Tauri v2 系统依赖；安装依赖后运行 `pnpm install` 和 `pnpm dev:app`。常用检查命令是 `pnpm test`、`pnpm typecheck`、`cd src-tauri && cargo test`；打包使用 `pnpm build` 和 `pnpm tauri build`。
