扫描已配置项目的 API 变更。

步骤：
1. 阅读 BASECASE.md 文件，确保所有基础情况成立
2. 执行 `npm run build` 确保编译通过
3. 检查前置条件：
   - 读取 `.apifox-credentials.json`，检查是否有 MCP 连接信息
   - 读取 `.apifoxsync.json`，检查配置是否完整（source-path、framework 等是否有有效值）
   - 如果缺少 MCP 连接信息：提示用户需要先连接 Apifox 项目，然后执行 `node dist/index.js mcp connect <项目名> <项目ID> <API密钥>` 完成连接
   - 如果配置文件缺失或关键字段（source-path、framework）为空/默认值：提示用户需要先配置项目信息，然后执行 `node dist/index.js config init --source-path <项目源码路径> --framework <框架类型>` 完成配置
   - 如果两项都缺，先连接 MCP 再配置项目
4. 如果用户通过 $ARGUMENTS 指定了参数（如 --source-path、--framework），使用用户指定的参数覆盖配置，并执行 `node dist/index.js config init --source-path <用户指定值> --framework <用户指定值>` 更新配置
5. 前置条件满足后，执行 `node dist/index.js config init` 将凭据和配置合并写入配置文件
6. 使用配置中的参数执行扫描：`node dist/index.js scan --source-type <配置值> --source-path <配置值> --framework <配置值> --scan-type <配置值>`

汇报扫描结果，列出检测到的 API 变更（新增、修改、删除的接口）。
