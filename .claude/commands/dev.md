一键开发检查：编译 + lint + 测试。

步骤：
1. 阅读 BASECASE.md 文件，确保所有基础情况成立
2. `npm run build` — 编译 TypeScript
3. `npm run lint` — ESLint 检查
4. `npm run test` — 运行测试

如果任何步骤失败，报告失败原因并停止。全部通过则汇报"开发检查全部通过"。
