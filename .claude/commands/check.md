检查已配置项目中本地代码与 Apifox 上现有 API 的差异，只做对比不同步。

步骤：
1. 执行 `npm run build` 确保编译通过
2. 读取 `.apifoxsync.json` 获取已配置的参数
3. 读取 `.apifox-credentials.json` 获取已连接的 MCP 项目信息
4. 如果用户通过 $ARGUMENTS 指定了参数，使用用户指定的参数覆盖配置
5. 扫描全部接口：`node dist/index.js scan --source-type <配置值> --source-path <配置值> --framework <配置值> --scan-type all`
6. 对比扫描结果与 Apifox 现有接口，汇总差异

仅汇报差异，不执行同步操作。
