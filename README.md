# API 同步到 Apifox 工具 (v1.2.0)

与 Apifox 项目同步后端接口，支持自动解析接口增删改查和手动触发同步，字段说明使用中文展示。支持增量同步和全量更新。

## 更新历史

### v1.2.0
- 新增配置文件支持 (.apifoxsync.json)
- 优化增量同步算法
- 增强错误处理和用户体验
- 新增 `config init` 命令初始化配置

### v1.1.0
- 新增代码解析功能
- 支持增量同步
- 添加接口变化比较功能

### v1.0.0
- 基础功能实现
- 支持从代码和 Swagger 同步
- 自动生成接口文档

## 功能概述

- **自动接口同步**：检测接口增删改查并同步到 Apifox
- **中文字段说明**：自动格式化接口说明为中文
- **增量同步**：只同步变更过的接口
- **全量更新**：同步所有接口
- **代码解析**：支持 Spring Boot 和 Node.js 项目

## 快速开始

### 安装依赖
```bash
cd api-sync-to-apifox && npm install
```

### 初始化配置
```bash
api-sync-to-apifox config init
```

### 扫描接口
```bash
api-sync-to-apifox scan
```

### 同步接口
```bash
api-sync-to-apifox sync
```

## 支持的命令

### config
管理配置文件
```bash
api-sync-to-apifox config init        # 初始化配置文件
```

### scan
扫描接口变更
```bash
api-sync-to-apifox scan [参数]        # 扫描接口变更
```

**参数列表：**
- --source-type <swagger|code> (必填): 接口源类型（swagger: Swagger文档，code: 代码解析）
- --source-path <路径> (必填): 源路径（代码目录或 Swagger 文档 URL）
- --framework <springboot|nodejs> (可选): 后端框架类型（当 source-type 为 code 时必填）
- --scan-type <all|changed> (可选): 扫描类型（all: 所有接口，changed: 仅变更接口，默认: changed）

**使用示例：**
```bash
# 从 Spring Boot 代码扫描所有接口
api-sync-to-apifox scan --source-type code --source-path "./src" --framework springboot --scan-type all

# 从 Node.js 代码扫描变更接口
api-sync-to-apifox scan --source-type code --source-path "./routes" --framework nodejs --scan-type changed

# 从 Swagger 文档扫描接口
api-sync-to-apifox scan --source-type swagger --source-path "https://api.example.com/v2/api-docs"
```

### sync
同步接口到 Apifox
```bash
api-sync-to-apifox sync [参数]        # 同步接口
api-sync-to-apifox sync --sync-mode full  # 全量更新
```

**参数列表：**
- --apifox-project-id <ID> (可选): Apifox 项目 ID（如果已通过 MCP 连接项目，可省略）
- --apifox-api-key <API_KEY> (可选): Apifox API 密钥（如果已通过 MCP 连接项目，可省略）
- --project-name <name> (可选): 项目名称（从 MCP 连接信息中获取项目 ID 和 API 密钥）
- --source-type <swagger|code> (必填): 接口源类型（swagger: Swagger文档，code: 代码解析）
- --source-path <路径> (必填): 源路径（代码目录或 Swagger 文档 URL）
- --framework <springboot|nodejs> (可选): 后端框架类型（当 source-type 为 code 时必填）
- --sync-mode <incremental|full> (可选): 同步模式（incremental: 增量同步，full: 全量更新，默认: incremental）
- --trigger-mode <auto|manual> (可选): 触发模式（auto: 自动触发，manual: 手动触发，默认: auto）

**使用示例：**
```bash
# 使用项目名称同步接口（需要先通过 MCP 连接项目）
api-sync-to-apifox sync --project-name my-project --source-type code --source-path "./src" --framework springboot --sync-mode incremental

# 使用配置文件同步接口
api-sync-to-apifox sync

# 从代码增量同步
api-sync-to-apifox sync --apifox-project-id 12345 --apifox-api-key abc123 --source-type code --source-path "./src" --framework springboot --sync-mode incremental

# 全量更新所有接口
api-sync-to-apifox sync --apifox-project-id 12345 --apifox-api-key abc123 --source-type code --source-path "./src" --framework springboot --sync-mode full

# 从 Swagger 同步
api-sync-to-apifox sync --apifox-project-id 12345 --apifox-api-key abc123 --source-type swagger --source-path "https://api.example.com/v2/api-docs"
```

### help
显示帮助信息
```bash
api-sync-to-apifox help               # 显示详细帮助
```

## 配置文件

`.apifoxsync.json` 配置文件：
```json
{
  "apifox-project-id": "your-project-id",
  "apifox-api-key": "your-api-key",
  "source-type": "code",
  "source-path": "./src",
  "framework": "springboot",
  "sync-mode": "incremental"
}
```

## 使用示例

### 使用配置文件
```bash
api-sync-to-apifox config init       # 生成配置文件
api-sync-to-apifox scan              # 扫描接口
api-sync-to-apifox sync              # 同步接口
```

### 命令行参数
```bash
# 使用代码解析同步
api-sync-to-apifox sync --apifox-project-id 12345 --apifox-api-key abc123 --source-type code --source-path "./src" --framework springboot --sync-mode incremental
```

## 注意事项

- 代码解析基于 Git 变更检测，需要在 Git 仓库中使用
- 增量同步只处理变更过的文件
- 支持 Spring Boot 和 Node.js 项目

## 相关文件

- `help.txt`：详细使用说明
- `config.js`：配置文件管理
- `index.js`：工具主入口
- `skill.json`：工具描述文件
