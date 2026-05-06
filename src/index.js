#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { sync: globSync } = require('glob');
const configManager = require('./config');

/**
 * 与 Apifox 项目同步后端接口的 Skill 主入口
 * 支持接口新增、删除及参数变更同步，字段说明使用中文展示
 */
class ApifoxSync {
    constructor() {
        this.baseUrl = 'https://api.apifox.com';
        this.scanResults = {
            added: [],
            updated: [],
            removed: []
        };
        this.changedFiles = [];
    }

    /**
     * 解析命令行参数
     */
    parseArgs() {
        const args = process.argv.slice(2);
        const parsed = {};
        let i = 0;

        while (i < args.length) {
            const arg = args[i];

            if (arg === '--help' || arg === '-h') {
                parsed['help'] = true;
                i++;
                continue;
            }

            if (arg.startsWith('--')) {
                const key = arg.slice(2);
                i++;
                if (i < args.length && !args[i].startsWith('--')) {
                    let value = args[i];
                    // 处理 Windows 路径问题
                    if (key === 'api-path' && value && (value.startsWith('C:') || value.includes('\\'))) {
                        // 还原路径
                        value = value.replace(/C:\/Program Files\/Git/, '');
                        value = value.replace(/\\/g, '/');
                    }
                    parsed[key] = value;
                    i++;
                } else {
                    parsed[key] = true;
                }
            } else {
                i++;
            }
        }

        // 从配置文件读取默认值
        const config = configManager.readConfig();
        if (config) {
            Object.keys(config).forEach(key => {
                if (parsed[key] === undefined) {
                    parsed[key] = config[key];
                }
            });
        }

        return parsed;
    }

    /**
     * 验证与 Apifox 的连接
     */
    async validateApifoxConnection(args) {
        if (args['source-type'] === 'swagger' || !args['apifox-project-id'] || !args['apifox-api-key']) {
            console.log('跳过 Apifox 连接验证');
            return true;
        }

        console.log('正在验证 Apifox 连接...');

        try {
            // 尝试获取项目信息
            const response = await axios.get(`${this.baseUrl}/v1/projects/${args['apifox-project-id']}/info`, {
                headers: {
                    'Authorization': `Bearer ${args['apifox-api-key']}`,
                    'Content-Type': 'application/json',
                    'X-Apifox-Api-Version': '2024-03-28'
                },
                timeout: 60000
            });

            if (response.status === 200) {
                console.log('✅ Apifox 连接验证成功');
                return true;
            } else {
                console.error('❌ Apifox 连接验证失败');
                return false;
            }
        } catch (error) {
            console.error('❌ Apifox 连接验证失败');
            console.error('详细信息:', error.response?.data || error.message);

            if (error.response?.status === 401) {
                console.error('  - API 密钥无效');
            } else if (error.response?.status === 404) {
                console.error('  - 项目 ID 不存在');
            }

            return false;
        }
    }

    /**
     * 验证参数是否完整
     */
    validateArgs(args) {
        const commands = process.argv.slice(2)[0];

        if (commands === 'sync') {
            const requiredFields = ['apifox-project-id', 'apifox-api-key', 'source-type', 'source-path'];
            const missingFields = requiredFields.filter(field => !args[field]);

            if (missingFields.length > 0) {
                console.error('Error: Missing required arguments:');
                missingFields.forEach(field => console.error(`- --${field}`));
                console.log('\nUsage:');
                console.log('  从 Swagger 同步:');
                console.log('    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type swagger --source-path <url>');
                console.log('  从代码同步:');
                console.log('    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type code --source-path <dir> --framework <springboot|nodejs>');
                console.log('');
                console.log('Options:');
                console.log('  --trigger-mode <auto|manual> 触发模式 (默认: auto)');
                console.log('  --sync-mode <incremental|full> 同步模式 (默认: incremental)');
                process.exit(1);
            }

            if (args['sync-mode'] && !['incremental', 'full'].includes(args['sync-mode'])) {
                console.error('Error: 无效的同步模式 --sync-mode, 支持: incremental (增量同步) 或 full (全量更新)');
                process.exit(1);
            }

            if (args['source-type'] === 'code' && !args['framework']) {
                console.error('Error: 从代码同步时需要指定框架类型 --framework <springboot|nodejs>');
                process.exit(1);
            }
        } else if (commands === 'scan') {
            const requiredFields = ['source-type', 'source-path'];
            const missingFields = requiredFields.filter(field => !args[field]);

            if (missingFields.length > 0) {
                console.error('Error: Missing required arguments:');
                missingFields.forEach(field => console.error(`- --${field}`));
                console.log('\nUsage:');
                console.log('  扫描所有接口:');
                console.log('    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs> --scan-type all');
                console.log('  只扫描变更接口:');
                console.log('    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs> --scan-type changed');
                console.log('  扫描文档变更:');
                console.log('    api-sync-to-apifox scan --source-type swagger --source-path <url>');
                process.exit(1);
            }

            if (args['scan-type'] && !['all', 'changed'].includes(args['scan-type'])) {
                console.error('Error: 无效的扫描类型 --scan-type, 支持: all (所有接口) 或 changed (仅变更接口)');
                process.exit(1);
            }

            if (args['source-type'] === 'code' && !args['framework']) {
                console.error('Error: 从代码同步时需要指定框架类型 --framework <springboot|nodejs>');
                process.exit(1);
            }
        }
    }

    /**
     * 统计需要格式化的接口数量（字段说明非中文的接口）
     */
    countUnformattedChinese(doc) {
        let count = 0;

        if (doc.paths) {
            Object.keys(doc.paths).forEach(path => {
                const methods = doc.paths[path];
                Object.keys(methods).forEach(method => {
                    const operation = methods[method];
                    let needFormat = false;

                    // 检查接口摘要和描述
                    if (!this.containsChinese(operation.summary)) {
                        needFormat = true;
                    }
                    if (!this.containsChinese(operation.description)) {
                        needFormat = true;
                    }

                    // 检查请求参数
                    if (operation.parameters) {
                        operation.parameters.forEach(param => {
                            if (!this.containsChinese(param.description)) {
                                needFormat = true;
                            }
                        });
                    }

                    // 检查请求体
                    if (operation.requestBody) {
                        this.checkRequestBodyForFormatting(operation.requestBody, needFormat);
                    }

                    // 检查响应
                    if (operation.responses) {
                        Object.keys(operation.responses).forEach(statusCode => {
                            const response = operation.responses[statusCode];
                            if (!this.containsChinese(response.description)) {
                                needFormat = true;
                            }
                            if (response.content && response.content['application/json']) {
                                const schema = response.content['application/json'].schema;
                                if (schema) {
                                    this.checkSchemaForFormatting(schema, needFormat);
                                }
                            }
                        });
                    }

                    if (needFormat) {
                        count++;
                    }
                });
            });
        }

        return count;
    }

    /**
     * 检查请求体是否需要格式化
     */
    checkRequestBodyForFormatting(requestBody, needFormat) {
        if (requestBody.description && !this.containsChinese(requestBody.description)) {
            needFormat = true;
        }
        if (requestBody.content) {
            Object.keys(requestBody.content).forEach(contentType => {
                const mediaType = requestBody.content[contentType];
                if (mediaType.schema) {
                    this.checkSchemaForFormatting(mediaType.schema, needFormat);
                }
            });
        }
    }

    /**
     * 检查 Schema 是否需要格式化
     */
    checkSchemaForFormatting(schema, needFormat) {
        if (schema.description && !this.containsChinese(schema.description)) {
            needFormat = true;
        }
        if (schema.properties) {
            Object.keys(schema.properties).forEach(propName => {
                const prop = schema.properties[propName];
                if (!this.containsChinese(prop.description)) {
                    needFormat = true;
                }
                if (prop.type === 'object' && prop.properties) {
                    this.checkSchemaForFormatting(prop, needFormat);
                }
                if (prop.type === 'array' && prop.items) {
                    if (prop.items.type === 'object' && prop.items.properties) {
                        this.checkSchemaForFormatting(prop.items, needFormat);
                    }
                }
            });
        }
    }

    /**
     * 检查字符串是否包含中文字符
     */
    containsChinese(str) {
        return /[一-鿿]/.test(str);
    }

    /**
     * 格式化 OpenAPI 文档，确保字段说明为中文
     */
    formatOpenApiDoc(doc) {
        console.log('格式化 API 文档，确保字段说明使用中文...');

        // 格式化接口路径
        if (doc.paths) {
            Object.keys(doc.paths).forEach(path => {
                const methods = doc.paths[path];
                Object.keys(methods).forEach(method => {
                    const operation = methods[method];

                    // 确保接口描述为中文
                    if (!operation.summary || !this.containsChinese(operation.summary)) {
                        operation.summary = this.getDefaultSummary(path, method);
                    }

                    if (!operation.description || !this.containsChinese(operation.description)) {
                        operation.description = operation.summary;
                    }

                    // 格式化请求参数
                    if (operation.parameters) {
                        operation.parameters = operation.parameters.map(param => {
                            if (!param.description || !this.containsChinese(param.description)) {
                                param.description = this.getDefaultParamDescription(param.name);
                            }
                            return param;
                        });
                    }

                    // 格式化请求体
                    if (operation.requestBody) {
                        this.formatRequestBody(operation.requestBody);
                    }

                    // 格式化响应
                    if (operation.responses) {
                        this.formatResponses(operation.responses);
                    }
                });
            });
        }

        // 格式化组件
        if (doc.components) {
            if (doc.components.schemas) {
                Object.keys(doc.components.schemas).forEach(schemaName => {
                    doc.components.schemas[schemaName] = this.formatSchema(doc.components.schemas[schemaName]);
                });
            }

            if (doc.components.parameters) {
                Object.keys(doc.components.parameters).forEach(paramName => {
                    if (!doc.components.parameters[paramName].description || !this.containsChinese(doc.components.parameters[paramName].description)) {
                        doc.components.parameters[paramName].description = this.getDefaultParamDescription(paramName);
                    }
                });
            }
        }

        return doc;
    }

    /**
     * 格式化请求体
     */
    formatRequestBody(requestBody) {
        if (requestBody.content && requestBody.content['application/json']) {
            const schema = requestBody.content['application/json'].schema;
            if (schema) {
                this.formatSchema(schema);
            }
        }

        if (requestBody.description && !this.containsChinese(requestBody.description)) {
            requestBody.description = '请求参数';
        }
    }

    /**
     * 格式化响应
     */
    formatResponses(responses) {
        Object.keys(responses).forEach(statusCode => {
            const response = responses[statusCode];

            if (!response.description || !this.containsChinese(response.description)) {
                response.description = this.getDefaultResponseDescription(statusCode);
            }

            if (response.content && response.content['application/json']) {
                const schema = response.content['application/json'].schema;
                if (schema) {
                    this.formatSchema(schema);
                }
            }
        });
    }

    /**
     * 格式化 Schema
     */
    formatSchema(schema) {
        if (schema.description && !this.containsChinese(schema.description)) {
            schema.description = '数据模型';
        }

        // 格式化属性
        if (schema.properties) {
            Object.keys(schema.properties).forEach(propName => {
                const prop = schema.properties[propName];

                if (!prop.description || !this.containsChinese(prop.description)) {
                    prop.description = this.getDefaultPropDescription(propName);
                }

                // 递归格式化嵌套属性
                if (prop.type === 'object' && prop.properties) {
                    this.formatSchema(prop);
                }

                if (prop.type === 'array' && prop.items) {
                    if (prop.items.type === 'object' && prop.items.properties) {
                        this.formatSchema(prop.items);
                    }
                }
            });
        }

        return schema;
    }

    /**
     * 检查字符串是否包含中文字符
     */
    containsChinese(str) {
        return /[一-鿿]/.test(str);
    }

    /**
     * 获取默认接口摘要
     */
    getDefaultSummary(path, method) {
        const methodMap = {
            'get': '查询',
            'post': '新增',
            'put': '更新',
            'delete': '删除',
            'patch': '修改'
        };

        const resource = path.split('/').filter(part => part && !part.startsWith('{')).pop() || '数据';
        return `${methodMap[method.toLowerCase()] || '操作'}${resource}`;
    }

    /**
     * 获取默认参数描述
     */
    getDefaultParamDescription(paramName) {
        return `${this.convertToCamelCase(paramName)}参数`;
    }

    /**
     * 获取默认属性描述
     */
    getDefaultPropDescription(propName) {
        return `${this.convertToCamelCase(propName)}字段`;
    }

    /**
     * 获取默认响应描述
     */
    getDefaultResponseDescription(statusCode) {
        const statusMap = {
            '200': '成功',
            '201': '创建成功',
            '204': '删除成功',
            '400': '请求参数错误',
            '401': '未授权',
            '403': '禁止访问',
            '404': '资源不存在',
            '500': '服务器错误'
        };

        return statusMap[statusCode] || '响应';
    }

    /**
     * 转换为驼峰命名并添加中文注释
     */
    convertToCamelCase(name) {
        // 处理下划线和短横线
        return name.replace(/[-_]([a-z])/g, (match, letter) => letter.toUpperCase())
                   .replace(/^[a-z]/, match => match.toUpperCase());
    }

    /**
     * 获取 OpenAPI 文档
     */
    async getOpenApiDoc(url) {
        console.log(`正在获取 OpenAPI 文档: ${url}`);

        try {
            let doc;

            // 检查是否是本地文件路径
            if (url.startsWith('./') || url.startsWith('../') || url.startsWith('/')) {
                console.log('检测到本地文件，读取文件内容...');
                const content = fs.readFileSync(url, 'utf8');
                try {
                    doc = YAML.parse(content);
                } catch (e) {
                    doc = JSON.parse(content);
                }
            } else {
                // 远程 URL
                const response = await axios.get(url, {
                    timeout: 60000
                });

                if (typeof response.data === 'string') {
                    try {
                        doc = YAML.parse(response.data);
                    } catch (e) {
                        doc = JSON.parse(response.data);
                    }
                } else {
                    doc = response.data;
                }
            }

            console.log('API 文档获取成功');
            return doc;
        } catch (error) {
            console.error('Error: 获取 API 文档失败');
            if (error.response) {
                console.error(`Status: ${error.response.status}`);
                console.error(`Data: ${error.response.data}`);
            } else {
                console.error(`Message: ${error.message}`);
            }
            process.exit(1);
        }
    }

    /**
     * 同步 API 文档到 Apifox
     */
    async syncToApifox(doc, projectId, apiKey) {
        console.log(`正在同步 API 文档到 Apifox 项目: ${projectId}`);

        try {
            const response = await axios.post(`${this.baseUrl}/v1/projects/${projectId}/import-openapi`, {
                input: JSON.stringify(doc),
                options: {
                    endpointOverwriteBehavior: 'OVERWRITE_EXISTING',
                    schemaOverwriteBehavior: 'OVERWRITE_EXISTING',
                    updateFolderOfChangedEndpoint: false,
                    prependBasePath: false,
                    deleteUnmatchedResources: true
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'X-Apifox-Api-Version': '2024-03-28'
                },
                timeout: 60000
            });

            console.log('API 文档同步成功');
            console.log('同步结果:', JSON.stringify(response.data, null, 2));

            return response.data;
        } catch (error) {
            console.error('Error: 同步 API 文档失败');
            if (error.response) {
                console.error(`Status: ${error.response.status}`);
                console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
                console.error(`Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
            } else {
                console.error(`Message: ${error.message}`);
            }
            process.exit(1);
        }
    }

    /**
     * 保存文档到本地（调试用）
     */
    saveDocToFile(doc, filename) {
        const dir = path.join(__dirname, '../temp');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, JSON.stringify(doc, null, 2));
        console.log(`文档已保存到: ${filePath}`);
    }

    /**
     * 扫描后端代码中的接口变化
     */
    async scanCodeForChanges(sourcePath, framework) {
        console.log(`正在扫描 ${framework} 项目接口变化: ${sourcePath}`);

        try {
            let detectedApis = [];

            if (framework === 'springboot') {
                detectedApis = await this.scanSpringBootCode(sourcePath);
            } else if (framework === 'nodejs') {
                detectedApis = await this.scanNodeJsCode(sourcePath);
            } else {
                console.error(`Error: 不支持的框架类型: ${framework}`);
                process.exit(1);
            }

            console.log(`✅ 扫描完成，发现 ${detectedApis.length} 个接口`);
            return detectedApis;
        } catch (error) {
            console.error('Error: 代码扫描失败');
            console.error(error.stack);
            process.exit(1);
        }
    }

    /**
     * 检测代码变更
     */
    async detectCodeChanges(sourcePath) {
        console.log('正在检测代码变更...');

        try {
            // 使用 git diff 检测变更的文件
            const gitStatus = await new Promise((resolve, reject) => {
                // 找到正确的 git 根目录
                let projectRoot = sourcePath;
                // 向上查找 .git 目录
                while (projectRoot && projectRoot !== '/' && projectRoot !== 'D:' && projectRoot !== 'C:') {
                    if (fs.existsSync(path.join(projectRoot, '.git'))) {
                        break;
                    }
                    projectRoot = path.dirname(projectRoot);
                }

                const childProcess = require('child_process');
                const status = childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot });
                if (status.error) reject(status.error);
                else resolve(status.stdout.toString().trim());
            });

            const modifiedFiles = [];

            if (gitStatus) {
                const lines = gitStatus.split('\n').filter(line => line.trim());
                lines.forEach(line => {
                    const parts = line.trim().split(/\s+/);
                    const relativePath = parts.slice(1).join(' ');

                    // 构建绝对路径
                    let absolutePath;
                    if (relativePath.startsWith('/')) {
                        absolutePath = relativePath;
                    } else {
                        // 找到正确的 git 根目录
                        let projectRoot = sourcePath;
                        while (projectRoot && projectRoot !== '/' && projectRoot !== 'D:' && projectRoot !== 'C:') {
                            if (fs.existsSync(path.join(projectRoot, '.git'))) {
                                break;
                            }
                            projectRoot = path.dirname(projectRoot);
                        }

                        absolutePath = path.join(projectRoot, relativePath);
                    }

                    // 规范化路径，防止出现重复的 src/main/java 部分
                    absolutePath = path.normalize(absolutePath);

                    // 只关注 Java 或 JavaScript 文件
                    if (absolutePath.match(/\.(java|js)$/)) {
                        modifiedFiles.push(absolutePath);
                    }
                });
            }

            console.log(`检测到 ${modifiedFiles.length} 个文件有变更`);
            this.changedFiles = modifiedFiles;
            return modifiedFiles;
        } catch (error) {
            console.warn('Git 变更检测失败，将扫描所有文件');
            this.changedFiles = [];
            return [];
        }
    }

    /**
     * 扫描 Spring Boot 项目代码
     */
    async scanSpringBootCode(sourcePath) {
        const controllers = [];
        const apiPatterns = {
            'get': /@GetMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
            'post': /@PostMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
            'put': /@PutMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
            'delete': /@DeleteMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g
        };

        let controllerFiles;

        // 如果是增量同步，只扫描变更的文件
        if (this.changedFiles.length > 0) {
            console.log('增量同步模式：只扫描变更的文件');
            controllerFiles = this.changedFiles.filter(file => file.match(/Controller\.java$/));

            // 调试：打印所有检测到的文件路径
            console.log('检测到的变更文件：');
            controllerFiles.forEach(file => console.log(`- ${file}`));
        } else {
            // 扫描所有 controller 文件
            try {
                controllerFiles = globSync(`${sourcePath}/**/*Controller.java`);
            } catch (error) {
                console.error(`扫描 controller 文件失败: ${error.message}`);
                return [];
            }
        }

        console.log(`发现 ${controllerFiles.length} 个 Controller 文件`);

        for (const file of controllerFiles) {
            // 确保文件路径是正确的，防止路径重复
            let normalizedFile = file;

            // 检查文件路径是否已经是绝对路径且存在
            if (!fs.existsSync(normalizedFile)) {
                // 尝试从 sourcePath 解析相对路径
                const relativeFile = path.join(sourcePath, normalizedFile.split(path.sep).pop());
                if (fs.existsSync(relativeFile)) {
                    normalizedFile = relativeFile;
                } else {
                    console.warn(`警告：文件不存在，将跳过: ${file}`);
                    continue;
                }
            }

            const content = fs.readFileSync(normalizedFile, 'utf8');
            const fileName = path.basename(normalizedFile);

            // 提取类级别的路径前缀 @RequestMapping
            let classPathPrefix = '';
            const classRequestMappingPattern = /@RequestMapping\s*\(\s*["']?([^"']*)["']?\s*\)/;
            const classPathMatch = content.match(classRequestMappingPattern);
            if (classPathMatch) {
                classPathPrefix = classPathMatch[1];
                // 规范化路径前缀
                if (classPathPrefix && !classPathPrefix.startsWith('/')) {
                    classPathPrefix = '/' + classPathPrefix;
                }
                if (classPathPrefix && classPathPrefix.endsWith('/')) {
                    classPathPrefix = classPathPrefix.slice(0, -1);
                }
            }

            // 提取所有 API 映射
            Object.keys(apiPatterns).forEach(method => {
                const matches = [...content.matchAll(apiPatterns[method])];
                matches.forEach(match => {
                    let apiPath = match[1];
                    // 规范化方法级别的路径
                    if (apiPath && !apiPath.startsWith('/')) {
                        apiPath = '/' + apiPath;
                    }
                    if (apiPath && apiPath.endsWith('/') && apiPath.length > 1) {
                        apiPath = apiPath.slice(0, -1);
                    }
                    // 合并类路径前缀和方法路径
                    const fullPath = (classPathPrefix + apiPath).replace(/\/+/g, '/');

                    // 提取方法参数信息，特别是路径参数
                    const api = {
                        path: fullPath,
                        method: method,
                        controller: fileName,
                        file: file,
                        parameters: []
                    };

                    // 尝试提取方法的参数信息
                    // 简单的参数提取，需要更复杂的解析器
                    const paramPattern = /@PathVariable\s*(\w+)/g;
                    const paramMatches = [...content.matchAll(paramPattern)];
                    if (paramMatches.length > 0) {
                        paramMatches.forEach(paramMatch => {
                            api.parameters.push({
                                name: paramMatch[1],
                                type: 'path'
                            });
                        });
                    }

                    controllers.push(api);
                });
            });
        }

        return controllers;
    }

    /**
     * 扫描 Node.js 项目代码
     */
    async scanNodeJsCode(sourcePath) {
        const routes = [];
        const routePatterns = {
            'get': /app\.get\s*\(\s*["']([^"']*)["']/g,
            'post': /app\.post\s*\(\s*["']([^"']*)["']/g,
            'put': /app\.put\s*\(\s*["']([^"']*)["']/g,
            'delete': /app\.delete\s*\(\s*["']([^"']*)["']/g
        };

        let routeFiles;

        // 如果是增量同步，只扫描变更的文件
        if (this.changedFiles.length > 0) {
            console.log('增量同步模式：只扫描变更的文件');
            routeFiles = this.changedFiles.filter(file => file.match(/route.*\.js$/));
        } else {
            // 扫描所有路由文件
            try {
                routeFiles = globSync(`${sourcePath}/**/*route*.js`);
            } catch (error) {
                console.error(`扫描路由文件失败: ${error.message}`);
                return [];
            }
        }

        console.log(`发现 ${routeFiles.length} 个路由文件`);

        for (const file of routeFiles) {
            const content = fs.readFileSync(file, 'utf8');
            const fileName = path.basename(file);

            // 提取所有路由
            Object.keys(routePatterns).forEach(method => {
                const matches = [...content.matchAll(routePatterns[method])];
                matches.forEach(match => {
                    const apiPath = match[1];
                    routes.push({
                        path: apiPath,
                        method: method,
                        controller: fileName,
                        file: file
                    });
                });
            });
        }

        return routes;
    }

    /**
     * 从 Apifox 获取现有接口信息
     */
    async getApifoxExistingApis(projectId, apiKey) {
        try {
            const response = await axios.post(`${this.baseUrl}/v1/projects/${projectId}/export-openapi`, {
                scope: {
                    type: 'ALL'
                },
                options: {
                    includeApifoxExtensionProperties: false,
                    addFoldersToTags: false
                },
                oasVersion: '3.1',
                exportFormat: 'JSON'
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'X-Apifox-Api-Version': '2024-03-28'
                },
                timeout: 60000
            });

            // 解析导出的 OpenAPI 文档，提取接口信息
            if (!response.data || typeof response.data === 'string') {
                console.warn('警告：未获取到 Apifox 现有接口信息，将同步所有检测到的接口');
                return [];
            }

            const openApiDoc = response.data;
            const existingApis = [];

            if (openApiDoc.paths) {
                Object.keys(openApiDoc.paths).forEach(path => {
                    const methods = openApiDoc.paths[path];
                    Object.keys(methods).forEach(method => {
                        existingApis.push({
                            path: path,
                            method: method.toLowerCase()
                        });
                    });
                });
            }

            return existingApis;
        } catch (error) {
            console.error('Error: 获取 Apifox 现有接口失败');
            console.error(error.response?.data || error.message);
            process.exit(1);
        }
    }

    /**
     * 比较接口变化
     */
    compareApiChanges(detectedApis, existingApis) {
        console.log('正在比较接口变化...');

        // 标准化接口路径，用于更宽松的比较
        const normalizePath = (path) => {
            // 移除末尾的斜杠
            return path.replace(/\/$/, '');
        };

        const detectedMap = new Map();
        detectedApis.forEach(api => {
            const normalizedPath = normalizePath(api.path);
            detectedMap.set(`${api.method}:${normalizedPath}`, api);
        });

        const existingMap = new Map();
        existingApis.forEach(api => {
            const normalizedPath = normalizePath(api.path);
            existingMap.set(`${api.method.toLowerCase()}:${normalizedPath}`, api);
        });

        // 查找新增接口
        detectedApis.forEach(api => {
            const normalizedPath = normalizePath(api.path);
            if (!existingMap.has(`${api.method}:${normalizedPath}`)) {
                this.scanResults.added.push(api);
            }
        });

        // 查找已删除接口
        existingApis.forEach(api => {
            const normalizedPath = normalizePath(api.path);
            if (!detectedMap.has(`${api.method.toLowerCase()}:${normalizedPath}`)) {
                this.scanResults.removed.push(api);
            }
        });

        // 查找已更新接口（比较路径和参数）
        detectedApis.forEach(api => {
            const normalizedPath = normalizePath(api.path);
            if (existingMap.has(`${api.method}:${normalizedPath}`)) {
                const existingApi = existingMap.get(`${api.method}:${normalizedPath}`);

                // 检查接口是否有路径参数变更（例如 /api/users/{id} 和 /api/users/{id}/{type}）
                const detectedParamCount = (api.path.match(/\{[^}]+\}/g) || []).length;
                const existingParamCount = (existingApi.path.match(/\{[^}]+\}/g) || []).length;

                // 检查参数变化
                if (detectedParamCount !== existingParamCount) {
                    this.scanResults.updated.push(api);
                    console.log(`检测到路径参数数量变化: 从 ${existingParamCount} 变为 ${detectedParamCount}`);
                }
            }
        });

        console.log(`接口变化统计: 新增 ${this.scanResults.added.length}, 更新 ${this.scanResults.updated.length}, 删除 ${this.scanResults.removed.length}`);

        // 输出变更接口列表
        this.outputChangeDetails();

        return this.scanResults;
    }

    /**
     * 输出接口变化详细信息
     */
    outputChangeDetails() {
        console.log('\n=== 接口变化详细信息 ===');

        if (this.scanResults.added.length > 0) {
            console.log('\n新增接口:');
            this.scanResults.added.forEach(api => {
                console.log(`  ✚ ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
            });
        }

        if (this.scanResults.updated.length > 0) {
            console.log('\n更新接口:');
            this.scanResults.updated.forEach(api => {
                console.log(`  ⭐ ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
            });
        }

        if (this.scanResults.removed.length > 0) {
            console.log('\n删除接口:');
            this.scanResults.removed.forEach(api => {
                console.log(`  ✖ ${api.method.toUpperCase()} ${api.path}`);
            });
        }

        console.log('');
    }

    /**
     * 生成接口文档
     */
    generateApiDocFromCode(detectedApis) {
        console.log('正在根据代码生成接口文档...');

        const openApiDoc = {
            openapi: '3.0.0',
            info: {
                title: '自动生成的 API 文档',
                version: '1.0.0',
                description: '根据代码自动解析生成的 API 接口文档'
            },
            paths: {},
            components: {
                schemas: {},
                parameters: {}
            }
        };

        detectedApis.forEach(api => {
            if (!openApiDoc.paths[api.path]) {
                openApiDoc.paths[api.path] = {};
            }

            openApiDoc.paths[api.path][api.method] = {
                summary: `Auto-generated summary for ${api.method.toUpperCase()} ${api.path}`,
                description: `Auto-generated description for ${api.method.toUpperCase()} ${api.path}`,
                tags: [api.controller],
                responses: {
                    '200': {
                        description: 'Auto-generated success response',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        code: { type: 'integer', description: 'Auto-generated response code' },
                                        message: { type: 'string', description: 'Auto-generated response message' },
                                        data: { type: 'object', description: 'Auto-generated response data' }
                                    }
                                }
                            }
                        }
                    }
                }
            };
        });

        return openApiDoc;
    }

    /**
     * 手动同步接口变更
     */
    async manualSyncChanges(projectId, apiKey, changes) {
        console.log('开始手动同步接口变更...');

        try {
            // 根据变更类型执行同步操作
            const results = {
                added: [],
                updated: [],
                removed: []
            };

            // 同步新增接口
            for (const api of changes.added) {
                console.log(`正在新增接口: ${api.method.toUpperCase()} ${api.path}`);
                const result = await this.addApiToApifox(projectId, apiKey, api);
                results.added.push(result);
            }

            // 同步更新接口
            for (const api of changes.updated) {
                console.log(`正在更新接口: ${api.method.toUpperCase()} ${api.path}`);
                const result = await this.updateApiInApifox(projectId, apiKey, api);
                results.updated.push(result);
            }

            // 同步删除接口
            for (const api of changes.removed) {
                console.log(`正在删除接口: ${api.method.toUpperCase()} ${api.path}`);
                const result = await this.deleteApiFromApifox(projectId, apiKey, api);
                results.removed.push(result);
            }

            console.log('✅ 接口变更同步完成');
            return results;

        } catch (error) {
            console.error('Error: 手动同步接口变更失败');
            console.error(error.stack);
            process.exit(1);
        }
    }

    /**
     * 扫描命令执行
     */
    async scan() {
        try {
            console.log('=== 开始接口变化扫描 ===');

            const args = this.parseArgs();
            const { 'source-type': sourceType, 'source-path': sourcePath, 'framework': framework, 'scan-type': scanType, 'apifox-project-id': projectId, 'apifox-api-key': apiKey } = args;

            if (projectId && apiKey) {
                const connectionValid = await this.validateApifoxConnection(args);
                if (!connectionValid) {
                    process.exit(1);
                }
            }

            if (sourceType === 'code') {
                if (scanType === 'changed') {
                    await this.detectCodeChanges(sourcePath);
                }

                const detectedApis = await this.scanCodeForChanges(sourcePath, framework);

                if (projectId && apiKey) {
                    // 与 Apifox 现有接口进行比较
                    const existingApis = await this.getApifoxExistingApis(projectId, apiKey);
                    this.compareApiChanges(detectedApis, existingApis);

                    // 检查是否有接口需要格式化字段说明
                    const docToCheck = this.generateApiDocFromCode(detectedApis);
                    const unformattedCount = this.countUnformattedChinese(docToCheck);
                    if (unformattedCount > 0) {
                        console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
                    }

                    // 检查是否有接口变更
                    const hasChanges = this.scanResults.added.length > 0 || this.scanResults.updated.length > 0 || this.scanResults.removed.length > 0;
                    if (hasChanges) {
                        console.log(`\n🚨 检测到接口变更！请执行 npm run sync 命令进行同步`);
                    }
                } else {
                    if (scanType === 'changed' && this.changedFiles.length > 0) {
                        console.log(`只扫描变更的 ${detectedApis.length} 个接口:`);
                        detectedApis.forEach(api => {
                            console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
                        });

                        // 检查是否有接口需要格式化字段说明
                        const docToCheck = this.generateApiDocFromCode(detectedApis);
                        const unformattedCount = this.countUnformattedChinese(docToCheck);
                        if (unformattedCount > 0) {
                            console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
                        }
                    } else if (scanType === 'all') {
                        console.log(`发现接口: ${detectedApis.length}个`);
                        console.log(`接口详情:`);
                        detectedApis.forEach(api => {
                            console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
                        });

                        // 检查是否有接口需要格式化字段说明
                        const docToCheck = this.generateApiDocFromCode(detectedApis);
                        const unformattedCount = this.countUnformattedChinese(docToCheck);
                        if (unformattedCount > 0) {
                            console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
                        }
                    } else {
                        console.log(`无接口变更`);
                    }
                }
            } else {
                // Swagger/OpenAPI 文档扫描
                const doc = await this.getOpenApiDoc(sourcePath);
                const apis = this.extractApisFromDoc(doc);
                console.log(`发现接口: ${apis.length}个`);
                console.log(`接口详情:`);
                apis.forEach(api => {
                    console.log(`  ${api.method.toUpperCase()} ${api.path} - ${api.summary}`);
                });
            }

            console.log('=== 扫描完成 ===');
        } catch (error) {
            console.error('Error: 扫描过程中发生错误');
            console.error(error.stack);
            process.exit(1);
        }
    }

    /**
     * 从文档中提取接口列表
     */
    extractApisFromDoc(doc) {
        const apis = [];

        if (doc.paths) {
            Object.keys(doc.paths).forEach(path => {
                const methods = doc.paths[path];
                Object.keys(methods).forEach(method => {
                    apis.push({
                        path: path,
                        method: method,
                        summary: methods[method].summary || '未命名接口'
                    });
                });
            });
        }

        return apis;
    }

    /**
     * 主同步方法
     */
    async sync() {
        try {
            console.log('=== 开始 Apifox 接口同步 ===');

            const args = this.parseArgs();

            // 验证 Apifox 连接
            const connectionValid = await this.validateApifoxConnection(args);
            if (!connectionValid) {
                process.exit(1);
            }

            if (args['trigger-mode'] === 'manual') {
                console.log('启用手动触发同步模式');
            }

            const { 'apifox-project-id': projectId, 'apifox-api-key': apiKey, 'source-type': sourceType, 'source-path': sourcePath, 'framework': framework, 'sync-mode': syncMode, 'api-path': apiPath, 'api-method': apiMethod } = args;

            let openApiDoc;

            if (sourceType === 'code') {
                if (apiPath && apiMethod) {
                    // 单独接口同步
                    console.log(`启用单独接口同步模式: ${apiMethod.toUpperCase()} ${apiPath}`);
                    openApiDoc = await this.generateSingleApiDoc(sourcePath, framework, apiMethod, apiPath);
                    if (!openApiDoc) {
                        console.log('未找到指定的接口');
                        return;
                    }
                } else {
                    // 全量或增量同步
                    if (syncMode === 'full') {
                        console.log('启用全量更新模式');
                    } else {
                        console.log('启用增量同步模式');
                    }

                    // 检测代码变更
                    if (syncMode === 'incremental') {
                        await this.detectCodeChanges(sourcePath);
                    }

                    const detectedApis = await this.scanCodeForChanges(sourcePath, framework);
                    openApiDoc = this.generateApiDocFromCode(detectedApis);

                    if (syncMode === 'incremental' && !args['api-path']) {
                        const existingApis = await this.getApifoxExistingApis(projectId, apiKey);
                        this.compareApiChanges(detectedApis, existingApis);

                        if (this.scanResults.added.length > 0 || this.scanResults.updated.length > 0 || this.scanResults.removed.length > 0) {
                            const readline = require('readline');
                            const rl = readline.createInterface({
                                input: process.stdin,
                                output: process.stdout
                            });

                            rl.question('\n是否继续同步以上接口变更？(y/N): ', (answer) => {
                                if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                                    rl.close();
                                    const formattedDoc = this.formatOpenApiDoc(openApiDoc);
                                    this.performSync(formattedDoc, projectId, apiKey, syncMode);
                                } else {
                                    console.log('\n同步已取消');
                                    rl.close();
                                    process.exit(0);
                                }
                            });

                            return;
                        } else {
                            console.log('无接口变更，无需同步');
                            return;
                        }
                    }
                }
            } else {
                // Swagger 文档同步
                const originalDoc = await this.getOpenApiDoc(sourcePath);
                openApiDoc = this.formatOpenApiDoc(originalDoc);
            }

            const formattedDoc = this.formatOpenApiDoc(openApiDoc);
            this.saveDocToFile(formattedDoc, 'formatted-api-doc.json');

            this.performSync(formattedDoc, projectId, apiKey, syncMode);

        } catch (error) {
            console.error('\nError: 同步过程中发生意外错误');
            console.error(error.stack);
            process.exit(1);
        }
    }

    /**
     * 生成单个接口的文档
     */
    async generateSingleApiDoc(sourcePath, framework, method, apiPath) {
        const detectedApis = await this.scanCodeForChanges(sourcePath, framework);
        const targetApi = detectedApis.find(api =>
            api.method.toLowerCase() === method.toLowerCase() &&
            (api.path === apiPath || api.path === apiPath + '/' || api.path === apiPath.replace(/\/$/, ''))
        );

        if (!targetApi) {
            return null;
        }

        return this.generateApiDocFromCode([targetApi]);
    }

    /**
     * 执行实际同步操作
     */
    async performSync(formattedDoc, projectId, apiKey, syncMode) {
        try {
            const result = await this.syncToApifox(formattedDoc, projectId, apiKey);

            console.log('\n=== 同步完成 ===');
            console.log('✅ 后端接口已成功同步到 Apifox');
            console.log('✅ 所有字段说明已格式化为中文');

            if (syncMode === 'incremental' && Object.keys(this.scanResults).length > 0 && (this.scanResults.added.length > 0 || this.scanResults.updated.length > 0 || this.scanResults.removed.length > 0)) {
                this.outputChangeDetails();
            } else if (syncMode === 'full') {
                console.log('全量更新模式：所有接口已同步');
            }

        } catch (error) {
            console.error('\nError: 同步过程中发生意外错误');
            console.error(error.stack);
            process.exit(1);
        }
    }
}

/**
 * 主入口函数
 */
async function main() {
    const command = process.argv.slice(2)[0];
    const args = new ApifoxSync().parseArgs();

    if (args['help']) {
        try {
            const helpContent = fs.readFileSync(path.join(__dirname, '../help.txt'), 'utf8');
            console.log(helpContent);
        } catch (error) {
            console.log('=== Apifox 同步技能帮助 ===');
            console.log('');
            console.log('可用命令：');
            console.log('');
            console.log('api-sync-to-apifox config [action]');
            console.log('  管理配置文件');
            console.log('');
            console.log('api-sync-to-apifox scan [参数]');
            console.log('  扫描后端接口变更（不执行同步）');
            console.log('');
            console.log('api-sync-to-apifox sync [参数]');
            console.log('  同步后端接口到 Apifox');
            console.log('');
            console.log('api-sync-to-apifox help');
            console.log('  显示详细帮助信息');
        }
        return;
    }

    if (command === 'config') {
        // 配置命令
        const configSkill = new ApifoxSync();
        const args = process.argv.slice(3);

        if (args.length > 0 && args[0] === 'init') {
            configManager.createDefaultConfig();
        } else {
            console.log('=== Apifox 同步技能配置 ===');
            console.log('');
            console.log('配置文件管理命令：');
            console.log('');
            console.log('api-sync-to-apifox config init');
            console.log('  初始化配置文件，创建默认配置');
            console.log('');
            console.log('配置文件格式：');
            console.log('  在项目根目录创建 .apifoxsync.json 文件');
            console.log('');
            console.log('示例配置：');
            console.log(`  {`);
            console.log(`    "apifox-project-id": "12345",`);
            console.log(`    "apifox-api-key": "abc123456",`);
            console.log(`    "source-type": "code",`);
            console.log(`    "source-path": "./src",`);
            console.log(`    "framework": "springboot",`);
            console.log(`    "trigger-mode": "auto",`);
            console.log(`    "sync-mode": "incremental",`);
            console.log(`    "scan-type": "changed"`);
            console.log(`  }`);
        }
    } else if (command === 'scan') {
        // 扫描命令
        const scanSkill = new ApifoxSync();
        await scanSkill.scan();
    } else if (command === 'sync') {
        // 同步命令
        const syncSkill = new ApifoxSync();
        await syncSkill.sync();
    } else if (command === 'help' || command === '--help' || command === '-h') {
        // 帮助信息
        try {
            const helpContent = fs.readFileSync(path.join(__dirname, '../help.txt'), 'utf8');
            console.log(helpContent);
        } catch (error) {
            console.log('=== Apifox 同步技能帮助 ===');
            console.log('');
            console.log('可用命令：');
            console.log('');
            console.log('api-sync-to-apifox config [action]');
            console.log('  管理配置文件');
            console.log('');
            console.log('api-sync-to-apifox scan [参数]');
            console.log('  扫描后端接口变更（不执行同步）');
            console.log('');
            console.log('api-sync-to-apifox sync [参数]');
            console.log('  同步后端接口到 Apifox');
            console.log('');
            console.log('api-sync-to-apifox help');
            console.log('  显示详细帮助信息');
        }
    } else {
        // 默认执行同步命令
        console.log('=== Apifox 同步技能 ===');
        console.log('');
        console.log('未指定命令，可使用以下命令：');
        console.log('');
        console.log('api-sync-to-apifox config init');
        console.log('  初始化配置文件');
        console.log('');
        console.log('api-sync-to-apifox scan');
        console.log('  扫描接口变更');
        console.log('');
        console.log('api-sync-to-apifox sync');
        console.log('  同步接口到 Apifox');
        console.log('');
        console.log('api-sync-to-apifox help');
        console.log('  显示详细帮助');
    }
}

// 执行主程序
main().catch(error => {
    console.error('=== 执行错误 ===');
    console.error(error.stack);
    process.exit(1);
});