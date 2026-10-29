# GitHub Actions 前的本地预检

触发 GitHub Actions 发布前，先在本地通过以下两项检查：

1. `pnpm test`：运行测试，包括翻译完整性和发布脚本检查。
2. `pnpm typecheck`：检查前端和 E2E 代码的 TypeScript 类型。
