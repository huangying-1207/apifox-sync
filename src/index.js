#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const configManager = require('./config');
const ApiScanner = require('./modules/scanner');
const ApiComparer = require('./modules/comparer');
const ApiFormatter = require('./modules/formatter');
const ApifoxSyncer = require('./modules/syncer');
const ErrorHandler = require('./utils/errorHandler');
const ConfigValidator = require('./utils/configValidator');

class ApifoxSync {
  constructor() {
    this.scanner = new ApiScanner();
    this.comparer = new ApiComparer();
    this.formatter = new ApiFormatter();
    this.syncer = new ApifoxSyncer();
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
          if (key === 'api-path' && value && (value.startsWith('C:') || value.includes('\\'))) {
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

    const config = configManager.readConfig();
    if (config) {
      Object.keys(config).forEach(key => {
        if (parsed[key] === undefined) {
          parsed[key] = config[key];
        }
      });
    }

    // 如果提供了 project-name 参数，从 MCP 获取连接信息
    if (parsed['project-name'] && !parsed['apifox-project-id'] && !parsed['apifox-api-key']) {
      const apifoxMCP = require('./mcp/apifox');
      const connectionInfo = apifoxMCP.getConnectionInfo(parsed['project-name']);
      if (connectionInfo) {
        parsed['apifox-project-id'] = connectionInfo.projectId;
        parsed['apifox-api-key'] = connectionInfo.apiKey;
        console.log(`使用 MCP 项目 "${parsed['project-name']}" 的连接信息 (ID: ${connectionInfo.projectId})`);
      } else {
        // 如果没有连接到项目，不强制要求连接，继续执行
        console.warn(`项目 "${parsed['project-name']}" 未连接，将只扫描接口变化`);
        parsed['apifox-project-id'] = null;
        parsed['apifox-api-key'] = null;
      }
    }

    return parsed;
  }

  /**
   * 验证参数是否完整
   */
  validateArgs(args) {
    const commands = process.argv.slice(2)[0];

    // 使用 ConfigValidator 验证配置
    const validationErrors = ConfigValidator.validate(args);

    if (validationErrors.length > 0) {
      console.error('参数验证失败:');
      validationErrors.forEach(error => {
        console.error(`- ${error.message}`);
      });

      if (commands === 'sync') {
        console.log('\nUsage:');
        console.log('  从 Swagger 同步:');
        console.log('    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type swagger --source-path <url>');
        console.log('  从代码同步:');
        console.log('    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type code --source-path <dir> --framework <springboot|nodejs|django>');
        console.log('');
        console.log('Options:');
        console.log('  --trigger-mode <auto|manual> 触发模式 (默认: auto)');
        console.log('  --sync-mode <incremental|full> 同步模式 (默认: incremental)');
      } else if (commands === 'scan') {
        console.log('\nUsage:');
        console.log('  扫描所有接口:');
        console.log('    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs|django> --scan-type all');
        console.log('  只扫描变更接口:');
        console.log('    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs|django> --scan-type changed');
        console.log('  扫描文档变更:');
        console.log('    api-sync-to-apifox scan --source-type swagger --source-path <url>');
      }

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
        const connectionValid = await this.syncer.validateApifoxConnection(projectId, apiKey);
        if (!connectionValid) {
          process.exit(1);
        }
      }

      if (sourceType === 'code') {
        if (scanType === 'changed') {
          await this.scanner.detectCodeChanges(sourcePath);
        }

        const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);

        if (projectId && apiKey) {
          const existingApis = await this.syncer.getApifoxExistingApis(projectId, apiKey);
          this.comparer.compareApiChanges(detectedApis, existingApis);

          const docToCheck = this.formatter.generateApiDocFromCode(detectedApis);
          const unformattedCount = this.formatter.countUnformattedChinese(docToCheck);
          if (unformattedCount > 0) {
            console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
          }

          const hasChanges = this.comparer.scanResults.added.length > 0 || this.comparer.scanResults.updated.length > 0 || this.comparer.scanResults.removed.length > 0;
          if (hasChanges) {
            console.log(`\n🚨 检测到接口变更！请执行 npm run sync 命令进行同步`);
          }
        } else {
          if (scanType === 'changed' && this.scanner.changedFiles.length > 0) {
            console.log(`只扫描变更的 ${detectedApis.length} 个接口:`);
            detectedApis.forEach(api => {
              console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
            });

            const docToCheck = this.formatter.generateApiDocFromCode(detectedApis);
            const unformattedCount = this.formatter.countUnformattedChinese(docToCheck);
            if (unformattedCount > 0) {
              console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
            }
          } else if (scanType === 'all') {
            console.log(`发现接口: ${detectedApis.length}个`);
            console.log(`接口详情:`);
            detectedApis.forEach(api => {
              console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
            });

            const docToCheck = this.formatter.generateApiDocFromCode(detectedApis);
            const unformattedCount = this.formatter.countUnformattedChinese(docToCheck);
            if (unformattedCount > 0) {
              console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
            }
          } else {
            console.log(`无接口变更`);
          }
        }
      } else {
        const doc = await this.syncer.getOpenApiDoc(sourcePath);
        const apis = this.syncer.extractApisFromDoc(doc);
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
   * 主同步方法
   */
  async sync() {
    try {
      console.log('=== 开始 Apifox 接口同步 ===');

      const args = this.parseArgs();

      // 检查是否连接到 Apifox 项目
      let connectionValid = false;
      if (args['apifox-project-id'] && args['apifox-api-key']) {
        connectionValid = await this.syncer.validateApifoxConnection(args['apifox-project-id'], args['apifox-api-key']);
        if (!connectionValid) {
          console.warn('Apifox 连接无效，将只扫描接口变化');
        }
      } else {
        console.warn('未提供 Apifox 项目信息，将只扫描接口变化');
      }

      if (args['trigger-mode'] === 'manual') {
        console.log('启用手动触发同步模式');
      }

      const { 'apifox-project-id': projectId, 'apifox-api-key': apiKey, 'source-type': sourceType, 'source-path': sourcePath, 'framework': framework, 'sync-mode': syncMode, 'api-path': apiPath, 'api-method': apiMethod } = args;

      let openApiDoc;

      if (sourceType === 'code') {
        if (apiPath && apiMethod) {
          console.log(`启用单独接口同步模式: ${apiMethod.toUpperCase()} ${apiPath}`);
          openApiDoc = await this.generateSingleApiDoc(sourcePath, framework, apiMethod, apiPath);
          if (!openApiDoc) {
            console.log('未找到指定的接口');
            return;
          }
        } else {
          if (syncMode === 'full') {
            console.log('启用全量更新模式');
          } else {
            console.log('启用增量同步模式');
          }

          if (syncMode === 'incremental') {
            await this.scanner.detectCodeChanges(sourcePath);
          }

          const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
          openApiDoc = this.formatter.generateApiDocFromCode(detectedApis);

          if (syncMode === 'incremental' && !args['api-path']) {
            // 如果连接到 Apifox 项目，比较接口变化
            if (args['apifox-project-id'] && args['apifox-api-key']) {
              const existingApis = await this.syncer.getApifoxExistingApis(projectId, apiKey);
              this.comparer.compareApiChanges(detectedApis, existingApis);

              if (this.comparer.scanResults.added.length > 0 || this.comparer.scanResults.updated.length > 0 || this.comparer.scanResults.removed.length > 0) {
                const readline = require('readline');
                const rl = readline.createInterface({
                  input: process.stdin,
                  output: process.stdout
                });

                rl.question('\n是否继续同步以上接口变更？(y/N): ', (answer) => {
                  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                    rl.close();
                    const formattedDoc = this.formatter.formatOpenApiDoc(openApiDoc);
                    this.performSync(formattedDoc, projectId, apiKey, syncMode, detectedApis, existingApis);
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
            } else {
              // 如果没有连接到 Apifox 项目，生成并格式化接口文档
              console.log('未连接到 Apifox 项目，将生成并格式化接口文档');
              console.log(`发现接口: ${detectedApis.length}个`);
              console.log('接口详情:');
              detectedApis.forEach(api => {
                console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
                if (api.parameters && api.parameters.length > 0) {
                  console.log(`    参数: ${api.parameters.map(param => param.name + '(' + param.type + ')').join(', ')}`);
                }
              });

              // 生成并格式化接口文档
              const formattedDoc = this.formatter.formatOpenApiDoc(openApiDoc);
              this.syncer.saveDocToFile(formattedDoc, 'apifox-full-api-doc.json');
              console.log('接口文档已生成并格式化，保存到 apifox-full-api-doc.json 文件');
              return;
            }
          }
        }
      } else {
        const originalDoc = await this.syncer.getOpenApiDoc(sourcePath);
        openApiDoc = this.formatter.formatOpenApiDoc(originalDoc);
      }

      const formattedDoc = this.formatter.formatOpenApiDoc(openApiDoc);
      this.syncer.saveDocToFile(formattedDoc, 'formatted-api-doc.json');

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
    const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
    const targetApi = detectedApis.find(api =>
      api.method.toLowerCase() === method.toLowerCase() &&
      (api.path === apiPath || api.path === apiPath + '/' || api.path === apiPath.replace(/\/$/, ''))
    );

    if (!targetApi) {
      return null;
    }

    return this.formatter.generateApiDocFromCode([targetApi]);
  }

  /**
   * 执行实际同步操作
   */
  async performSync(formattedDoc, projectId, apiKey, syncMode, detectedApis = [], existingApis = []) {
    try {
      // 如果连接到 Apifox 项目，同步接口
      if (projectId && apiKey) {
        const result = await this.syncer.syncToApifox(formattedDoc, projectId, apiKey);

        console.log('\n=== 同步完成 ===');
        console.log('✅ 后端接口已成功同步到 Apifox');
        console.log('✅ 所有字段说明已格式化为中文');

        if (syncMode === 'incremental' && Object.keys(this.comparer.scanResults).length > 0 && (this.comparer.scanResults.added.length > 0 || this.comparer.scanResults.updated.length > 0 || this.comparer.scanResults.removed.length > 0)) {
          this.comparer.outputChangeDetails(detectedApis, existingApis);
        } else if (syncMode === 'full') {
          console.log('全量更新模式：所有接口已同步');
        }
      } else {
        // 如果没有连接到 Apifox 项目，只格式化接口文档
        console.log('\n=== 接口文档已格式化 ===');
        console.log('✅ 后端接口文档已成功格式化');
        console.log('✅ 所有字段说明已格式化为中文');
        console.log('❌ 未连接到 Apifox 项目，无法同步接口');
        console.log('请使用 mcp connect 命令连接到 Apifox 项目后再次执行同步命令');
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
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
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

  const syncInstance = new ApifoxSync();

  if (command === 'mcp') {
    // 启动 MCP 交互式控制台
    const { spawn } = require('child_process');
    const mcpProcess = spawn('node', ['src/mcp/mcp-server.js', ...process.argv.slice(3)], {
      stdio: 'inherit',
      shell: true
    });

    mcpProcess.on('close', (code) => {
      console.log(`MCP 控制台已退出，代码: ${code}`);
    });

    return;
  }

  if (command === 'config') {
    const configArgs = process.argv.slice(3);

    if (configArgs.length > 0 && configArgs[0] === 'init') {
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
    await syncInstance.scan();
  } else if (command === 'sync') {
    await syncInstance.sync();
  } else if (command === 'help' || command === '--help' || command === '-h') {
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
  ErrorHandler.handleUnexpectedError(error);
  ErrorHandler.logError(error, {
    operation: 'main'
  });
  process.exit(1);
});
