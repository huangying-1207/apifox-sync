#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { configManager } from './config';
import { ApiScanner } from './core/scanner/ApiScanner';
import ApiComparer from './modules/comparer';
import ApiFormatter from './modules/formatter';
import ApifoxSyncer from './modules/syncer';
import { ErrorHandler } from './utils/errorHandler';
import { ConfigValidator } from './utils/configValidator';

class ApifoxSync {
  private scanner: ApiScanner;
  private comparer: any;
  private formatter: any;
  private syncer: any;

  constructor() {
    this.scanner = new ApiScanner();
    this.comparer = new ApiComparer();
    this.formatter = new ApiFormatter();
    this.syncer = new ApifoxSyncer();
  }

  /**
   * 解析命令行参数
   */
  parseArgs(): any {
    const args = process.argv.slice(2);
    const parsed: any = {};
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
      Object.keys(config).forEach((key) => {
        if (parsed[key] === undefined) {
          parsed[key] = (config as any)[key];
        }
      });
    }

    // 如果提供了 project-name 参数，从 MCP 获取连接信息
    if (parsed['project-name'] && !parsed['apifox-project-id'] && !parsed['apifox-api-key']) {
      const apifoxMCP = require('./mcp/apifox').default;
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
  validateArgs(args: any): void {
    const commands = process.argv.slice(2)[0];

    // 使用 ConfigValidator 验证配置
    const validationErrors = ConfigValidator.validate(args);

    if (validationErrors.length > 0) {
      console.error('参数验证失败:');
      validationErrors.forEach((error) => {
        console.error(`- ${error.message}`);
      });

      if (commands === 'sync') {
        console.log('\nUsage:');
        console.log('  从 Swagger 同步:');
        console.log(
          '    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type swagger --source-path <url>',
        );
        console.log('  从代码同步:');
        console.log(
          '    api-sync-to-apifox sync --apifox-project-id <id> --apifox-api-key <key> --source-type code --source-path <dir> --framework <springboot|nodejs|django>',
        );
        console.log('');
        console.log('Options:');
        console.log('  --trigger-mode <auto|manual> 触发模式 (默认: auto)');
        console.log('  --sync-mode <incremental|full> 同步模式 (默认: incremental)');
        console.log('  --apis <METHOD:PATH,...> 指定多个接口同步 (例如: "GET:/api/users,POST:/api/users")');
        console.log('  --api-method <method> --api-path <path> 单独接口同步');
      } else if (commands === 'scan') {
        console.log('\nUsage:');
        console.log('  扫描所有接口:');
        console.log(
          '    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs|django> --scan-type all',
        );
        console.log('  只扫描变更接口:');
        console.log(
          '    api-sync-to-apifox scan --source-type code --source-path <dir> --framework <springboot|nodejs|django> --scan-type changed',
        );
        console.log('  扫描文档变更:');
        console.log('    api-sync-to-apifox scan --source-type swagger --source-path <url>');
      }

      process.exit(1);
    }
  }

  /**
   * 扫描命令执行
   */
  async scan(): Promise<void> {
    try {
      console.log('=== 开始接口变化扫描 ===');

      const args = this.parseArgs();
      const {
        'source-type': sourceType,
        'source-path': sourcePath,
        framework: framework,
        'scan-type': scanType,
        'apifox-project-id': projectId,
        'apifox-api-key': apiKey,
      } = args;

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
        this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());

        // 按变更源类分组输出受影响的接口
        const changeImpact = this.scanner.getChangeSourceImpact();
        if (changeImpact.size > 0) {
          const lines: string[] = ['变更源及受影响接口:\n'];
          changeImpact.forEach((methods, changeSource) => {
            // 按 impactType 分组
            const requestApis: string[] = [];
            const responseApis: string[] = [];
            for (const m of methods) {
              const matchedApis = detectedApis.filter((api) => {
                if (!api.controller || api.controller.replace('.java', '') !== m.controllerClass) return false;
                if (api.javaMethodName) {
                  return api.javaMethodName === m.methodName;
                }
                return true;
              });
              for (const api of matchedApis) {
                const label = `${api.method.toUpperCase()} ${api.path}`;
                if (m.impactType === 'request_body') {
                  if (!requestApis.includes(label)) requestApis.push(label);
                } else {
                  if (!responseApis.includes(label)) responseApis.push(label);
                }
              }
            }
            const total = requestApis.length + responseApis.length;
            console.log(`  ${changeSource} → ${total} 个接口`);
            lines.push(`${changeSource} → ${total} 个接口`);
            if (requestApis.length > 0) {
              console.log(`    影响入参:`);
              lines.push('  影响入参:');
              for (const line of requestApis) {
                console.log(`      ${line}`);
                lines.push(`    ${line}`);
              }
            }
            if (responseApis.length > 0) {
              console.log(`    影响响应:`);
              lines.push('  影响响应:');
              for (const line of responseApis) {
                console.log(`      ${line}`);
                lines.push(`    ${line}`);
              }
            }
            lines.push('');
          });
          // 写入文件
          const reportDir = path.join(process.cwd(), 'temp');
          if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
          }
          const reportPath = path.join(reportDir, 'change-impact-report.txt');
          fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
          console.log(`\n变更影响详情已写入: ${reportPath}`);
        }

        if (projectId && apiKey) {
          const existingApis = await this.syncer.getApifoxExistingApis(projectId, apiKey);
          this.comparer.compareApiChanges(detectedApis, existingApis, scanType === 'changed');

          const docToCheck = this.formatter.generateApiDocFromCode(detectedApis);
          const unformattedCount = this.formatter.countUnformattedChinese(docToCheck);
          if (unformattedCount > 0) {
            console.log(`\n需要格式化的接口：${unformattedCount}个接口的字段说明需要格式化为中文`);
          }

          const hasChanges =
            this.comparer.scanResults.added.length > 0 ||
            this.comparer.scanResults.updated.length > 0 ||
            this.comparer.scanResults.removed.length > 0;
          if (hasChanges) {
            console.log(`\n🚨 检测到接口变更！请执行 npm run sync 命令进行同步`);
          }
        } else {
          if (scanType === 'changed' && this.scanner.getChangedFiles().length > 0) {
            console.log(`只扫描变更的 ${detectedApis.length} 个接口:`);
            detectedApis.forEach((api) => {
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
            detectedApis.forEach((api) => {
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
        apis.forEach((api: any) => {
          console.log(`  ${api.method.toUpperCase()} ${api.path} - ${api.summary}`);
        });
      }

      console.log('=== 扫描完成 ===');
    } catch (error) {
      console.error('Error: 扫描过程中发生错误');
      console.error((error as any).stack);
      process.exit(1);
    }
  }

  /**
   * 主同步方法
   */
  async sync(): Promise<void> {
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

      const {
        'apifox-project-id': projectId,
        'apifox-api-key': apiKey,
        'source-type': sourceType,
        'source-path': sourcePath,
        framework: framework,
        'sync-mode': syncMode,
        'api-path': apiPath,
        'api-method': apiMethod,
        apis: apisParam,
      } = args;

      let openApiDoc: any;

      if (sourceType === 'code') {
        if (apisParam) {
          console.log(`启用多接口同步模式: ${apisParam}`);
          openApiDoc = await this.generateMultipleApisDoc(sourcePath, framework, apisParam);
          if (!openApiDoc) {
            console.log('未找到任何指定的接口');
            return;
          }
        } else if (apiPath && apiMethod) {
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
          this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());

          const changeImpact = this.scanner.getChangeSourceImpact();
          if (changeImpact.size > 0) {
            const lines: string[] = ['变更源及受影响接口:\n'];
            changeImpact.forEach((methods, changeSource) => {
              const requestApis: string[] = [];
              const responseApis: string[] = [];
              for (const m of methods) {
                const matchedApis = detectedApis.filter((api) => {
                  if (!api.controller || api.controller.replace('.java', '') !== m.controllerClass) return false;
                  if (api.javaMethodName) {
                    return api.javaMethodName === m.methodName;
                  }
                  return true;
                });
                for (const api of matchedApis) {
                  const label = `${api.method.toUpperCase()} ${api.path}`;
                  if (m.impactType === 'request_body') {
                    if (!requestApis.includes(label)) requestApis.push(label);
                  } else {
                    if (!responseApis.includes(label)) responseApis.push(label);
                  }
                }
              }
              const total = requestApis.length + responseApis.length;
              console.log(`  ${changeSource} → ${total} 个接口`);
              lines.push(`${changeSource} → ${total} 个接口`);
              if (requestApis.length > 0) {
                console.log(`    影响入参:`);
                lines.push('  影响入参:');
                for (const line of requestApis) {
                  console.log(`      ${line}`);
                  lines.push(`    ${line}`);
                }
              }
              if (responseApis.length > 0) {
                console.log(`    影响响应:`);
                lines.push('  影响响应:');
                for (const line of responseApis) {
                  console.log(`      ${line}`);
                  lines.push(`    ${line}`);
                }
              }
              lines.push('');
            });
            const reportDir = path.join(process.cwd(), 'temp');
            if (!fs.existsSync(reportDir)) {
              fs.mkdirSync(reportDir, { recursive: true });
            }
            const reportPath = path.join(reportDir, 'change-impact-report.txt');
            fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
            console.log(`\n变更影响详情已写入: ${reportPath}`);
          }

          openApiDoc = this.formatter.generateApiDocFromCode(detectedApis);

          if (syncMode === 'incremental' && !args['api-path']) {
            // 如果连接到 Apifox 项目，比较接口变化
            if (args['apifox-project-id'] && args['apifox-api-key']) {
              const existingApis = await this.syncer.getApifoxExistingApis(projectId, apiKey);
              this.comparer.compareApiChanges(detectedApis, existingApis, syncMode === 'incremental');

              if (
                this.comparer.scanResults.added.length > 0 ||
                this.comparer.scanResults.updated.length > 0 ||
                this.comparer.scanResults.removed.length > 0
              ) {
                const readline = require('readline');
                const rl = readline.createInterface({
                  input: process.stdin,
                  output: process.stdout,
                });

                rl.question('\n是否继续同步以上接口变更？(y/N): ', (answer: string) => {
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
              detectedApis.forEach((api) => {
                console.log(`  ${api.method.toUpperCase()} ${api.path} (${api.controller})`);
                if (api.parameters && api.parameters.length > 0) {
                  console.log(
                    `    参数: ${api.parameters.map((param) => param.name + '(' + param.type + ')').join(', ')}`,
                  );
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
      console.error((error as any).stack);
      process.exit(1);
    }
  }

  /**
   * 生成单个接口的文档
   */
  async generateSingleApiDoc(sourcePath: string, framework: string, method: string, apiPath: string): Promise<any> {
    const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
    this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());

    const tracedFiles = this.scanner.getDependencyTracedFiles();
    if (tracedFiles.length > 0) {
      console.log(`其中 ${tracedFiles.length} 个 Controller 因 DTO/Service 依赖变更而被纳入扫描:`);
      tracedFiles.forEach((file) => console.log(`  - ${path.basename(file)}`));
    }

    const targetApi = detectedApis.find(
      (api) =>
        api.method.toLowerCase() === method.toLowerCase() &&
        (api.path === apiPath || api.path === apiPath + '/' || api.path === apiPath.replace(/\/$/, '')),
    );

    if (!targetApi) {
      return null;
    }

    return this.formatter.generateApiDocFromCode([targetApi]);
  }

  /**
   * 生成多个指定接口的文档
   * @param {string} sourcePath - 源代码路径
   * @param {string} framework - 框架类型
   * @param {string} apisParam - 接口列表，格式: "GET:/api/users,POST:/api/orders"
   */
  async generateMultipleApisDoc(sourcePath: string, framework: string, apisParam: string): Promise<any> {
    const detectedApis = await this.scanner.scanCodeForChanges(sourcePath, framework);
    this.formatter.setDtoSchemas(this.scanner.getDtoSchemas());

    const tracedFiles = this.scanner.getDependencyTracedFiles();
    if (tracedFiles.length > 0) {
      console.log(`其中 ${tracedFiles.length} 个 Controller 因 DTO/Service 依赖变更而被纳入扫描:`);
      tracedFiles.forEach((file) => console.log(`  - ${path.basename(file)}`));
    }

    const apiList = apisParam
      .split(',')
      .map((item) => {
        const parts = item.trim().split(':');
        if (parts.length < 2) return null;
        return { method: parts[0].trim(), path: parts.slice(1).join(':').trim() };
      })
      .filter(Boolean);

    if (apiList.length === 0) {
      console.log('无效的接口列表格式，正确格式: "GET:/api/users,POST:/api/orders"');
      return null;
    }

    const targetApis: any[] = [];
    const notFound: string[] = [];

    for (const apiSpec of apiList as any[]) {
      const matched = detectedApis.find(
        (api) =>
          api.method.toLowerCase() === apiSpec.method.toLowerCase() &&
          (api.path === apiSpec.path ||
            api.path === apiSpec.path + '/' ||
            api.path === apiSpec.path.replace(/\/$/, '')),
      );

      if (matched) {
        targetApis.push(matched);
      } else {
        notFound.push(`${apiSpec.method.toUpperCase()} ${apiSpec.path}`);
      }
    }

    if (notFound.length > 0) {
      console.log(`以下接口未找到: ${notFound.join(', ')}`);
    }

    if (targetApis.length === 0) {
      return null;
    }

    console.log(`找到 ${targetApis.length} 个指定接口:`);
    targetApis.forEach((api) => {
      console.log(`  ${api.method.toUpperCase()} ${api.path}`);
    });

    return this.formatter.generateApiDocFromCode(targetApis);
  }

  /**
   * 执行实际同步操作
   */
  async performSync(
    formattedDoc: any,
    projectId: string,
    apiKey: string,
    syncMode: string,
    detectedApis: any[] = [],
    existingApis: any[] = [],
  ): Promise<void> {
    try {
      // 如果连接到 Apifox 项目，同步接口
      if (projectId && apiKey) {
        await this.syncer.syncToApifox(formattedDoc, projectId, apiKey);

        console.log('\n=== 同步完成 ===');
        console.log('✅ 后端接口已成功同步到 Apifox');
        console.log('✅ 所有字段说明已格式化为中文');

        if (
          syncMode === 'incremental' &&
          Object.keys(this.comparer.scanResults).length > 0 &&
          (this.comparer.scanResults.added.length > 0 ||
            this.comparer.scanResults.updated.length > 0 ||
            this.comparer.scanResults.removed.length > 0)
        ) {
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
      console.error((error as any).stack);
      process.exit(1);
    }
  }
}

/**
 * 主入口函数
 */
async function main(): Promise<void> {
  const command = process.argv.slice(2)[0];
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    try {
      const helpContent = fs.readFileSync(path.join(__dirname, '../help.txt'), 'utf8');
      console.log(helpContent);
    } catch (_error) {
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
      shell: true,
    });

    mcpProcess.on('close', (code: number) => {
      console.log(`MCP 控制台已退出，代码: ${code}`);
    });

    return;
  }

  if (command === 'config') {
    const configArgs = process.argv.slice(3);

    if (configArgs.length > 0 && configArgs[0] === 'init') {
      // Parse init-specific args
      const initArgs: any = {};
      for (let i = 1; i < configArgs.length; i++) {
        if (configArgs[i].startsWith('--') && i + 1 < configArgs.length && !configArgs[i + 1].startsWith('--')) {
          initArgs[configArgs[i].slice(2)] = configArgs[i + 1];
          i++;
        }
      }

      // Read credentials to auto-populate project info
      const apifoxMCP = require('./mcp/apifox').default;
      const connectedProjects = apifoxMCP.getConnectedProjects();

      if (connectedProjects.length > 0) {
        // Prefer the project already configured in .apifoxsync.json
        const existingProjectName = configManager.getConfig('project-name') as string | undefined;
        const projectName =
          existingProjectName && connectedProjects.includes(existingProjectName)
            ? existingProjectName
            : connectedProjects[0];
        const connectionInfo = apifoxMCP.getConnectionInfo(projectName);
        initArgs['project-name'] = projectName;
        initArgs['apifox-project-id'] = connectionInfo.projectId;
        initArgs['apifox-api-key'] = connectionInfo.apiKey;
        console.log(`已从凭据中加载项目 "${projectName}" 的连接信息`);
      } else {
        console.warn(
          '未检测到 MCP 连接信息，请先执行 `node dist/index.js mcp connect <项目名> <项目ID> <API密钥>` 连接 Apifox 项目',
        );
        console.warn('配置文件将使用默认值生成，apifox-project-id 和 apifox-api-key 为空');
      }

      // Generate default config and merge: existing config < defaults < init args
      // This preserves user-set values like source-path while filling in defaults for missing fields
      const defaultConfig = ConfigValidator.generateDefaultConfig();
      const existingConfig = configManager.getAllConfig();
      const mergedConfig = { ...defaultConfig, ...existingConfig, ...initArgs };
      configManager.setConfig('apifox-project-id', mergedConfig['apifox-project-id']);
      configManager.setConfig('apifox-api-key', mergedConfig['apifox-api-key']);
      if (mergedConfig['project-name']) configManager.setConfig('project-name', mergedConfig['project-name']);
      if (mergedConfig['source-type']) configManager.setConfig('source-type', mergedConfig['source-type']);
      if (mergedConfig['source-path']) configManager.setConfig('source-path', mergedConfig['source-path']);
      if (mergedConfig['framework']) configManager.setConfig('framework', mergedConfig['framework']);
      if (mergedConfig['sync-mode']) configManager.setConfig('sync-mode', mergedConfig['sync-mode']);
      if (mergedConfig['scan-type']) configManager.setConfig('scan-type', mergedConfig['scan-type']);
      if (mergedConfig['trigger-mode']) configManager.setConfig('trigger-mode', mergedConfig['trigger-mode']);
      configManager.saveConfig();
      console.log(`配置文件已更新: ${path.join(process.cwd(), '.apifoxsync.json')}`);
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
    } catch (_error) {
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
main().catch((error) => {
  console.error('=== 执行错误 ===');
  ErrorHandler.handleUnexpectedError(error);
  ErrorHandler.logError(error, {
    operation: 'main',
  });
  process.exit(1);
});
