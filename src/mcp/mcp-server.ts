#!/usr/bin/env node

import readline from 'readline';
import apifoxMCP from './apifox';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

class MCPCommandHandler {
  private commands: any;

  constructor() {
    this.commands = {
      connect: this.handleConnect.bind(this),
      disconnect: this.handleDisconnect.bind(this),
      status: this.handleStatus.bind(this),
      projects: this.handleListProjects.bind(this),
      info: this.handleProjectInfo.bind(this),
      apis: this.handleGetApis.bind(this),
      documents: this.handleGetDocuments.bind(this),
      environments: this.handleGetEnvironments.bind(this),
      variables: this.handleGetVariables.bind(this),
      help: this.handleHelp.bind(this),
    };
  }

  async handleCommand(input: string): Promise<void> {
    const parts = input.trim().split(/\s+/);
    const command = parts[0].toLowerCase();

    if (command && this.commands[command]) {
      await this.commands[command](parts.slice(1));
    } else if (command) {
      console.log(`未知命令: ${command}`);
      this.handleHelp();
    }
  }

  async handleConnect(args: string[]): Promise<void> {
    if (args.length < 3) {
      console.log('使用方法: connect <项目名> <项目ID> <API密钥>');
      return;
    }

    const [projectName, projectId, apiKey] = args;
    const result = await apifoxMCP.connect(projectName, projectId, apiKey);

    if (result) {
      console.log(`✅ 成功连接到项目 "${projectName}"`);
      console.log(`项目名称: ${result.name}`);
      console.log(`项目描述: ${result.description || '无描述'}`);
      console.log(`创建时间: ${new Date(result.createdAt).toLocaleString()}`);
    }
  }

  handleDisconnect(args: string[]): void {
    if (args.length < 1) {
      console.log('使用方法: disconnect <项目名>');
      return;
    }

    const projectName = args[0];
    apifoxMCP.disconnect(projectName);
  }

  handleStatus(_args: string[]): void {
    const connectedProjects = apifoxMCP.getConnectedProjects();

    if (connectedProjects.length === 0) {
      console.log('未连接到任何 Apifox 项目');
    } else {
      console.log('当前连接的 Apifox 项目:');
      connectedProjects.forEach((projectName) => {
        const info = apifoxMCP.getConnectionInfo(projectName);
        console.log(`- ${projectName}`);
        console.log(`  项目ID: ${info.projectId}`);
        console.log(`  连接时间: ${new Date(info.connectedAt).toLocaleString()}`);
        console.log(`  项目名称: ${info.projectInfo?.name || '未获取到名称'}`);
      });
    }
  }

  handleListProjects(): void {
    const connectedProjects = apifoxMCP.getConnectedProjects();

    if (connectedProjects.length === 0) {
      console.log('未连接到任何 Apifox 项目');
    } else {
      console.log('已连接的项目:');
      connectedProjects.forEach((projectName, index) => {
        console.log(`${index + 1}. ${projectName}`);
      });
    }
  }

  async handleProjectInfo(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.log('使用方法: info <项目名>');
      return;
    }

    const projectName = args[0];
    if (!apifoxMCP.isConnected(projectName)) {
      console.log(`项目 "${projectName}" 未连接`);
      return;
    }

    const info = apifoxMCP.getConnectionInfo(projectName);
    console.log(`项目信息: ${projectName}`);
    console.log(`项目ID: ${info.projectId}`);
    console.log(`API密钥: ******`);
    console.log(`连接时间: ${new Date(info.connectedAt).toLocaleString()}`);
    console.log(`项目名称: ${info.projectInfo?.name || '未获取到名称'}`);
    console.log(`项目描述: ${info.projectInfo?.description || '无描述'}`);
    console.log(`项目状态: ${info.projectInfo?.status || '未知'}`);
  }

  async handleGetApis(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.log('使用方法: apis <项目名>');
      return;
    }

    const projectName = args[0];
    if (!apifoxMCP.isConnected(projectName)) {
      console.log(`项目 "${projectName}" 未连接`);
      return;
    }

    const apis = await apifoxMCP.getProjectApis(projectName);
    if (apis) {
      console.log(`项目 "${projectName}" 的接口列表 (共 ${apis.length} 个):`);
      apis.forEach((api: any, index: number) => {
        console.log(`${index + 1}. [${api.method.toUpperCase()}] ${api.path}`);
        if (api.summary) {
          console.log(`   描述: ${api.summary}`);
        }
      });
    }
  }

  async handleGetDocuments(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.log('使用方法: documents <项目名>');
      return;
    }

    const projectName = args[0];
    if (!apifoxMCP.isConnected(projectName)) {
      console.log(`项目 "${projectName}" 未连接`);
      return;
    }

    const documents = await apifoxMCP.getProjectDocuments(projectName);
    if (documents) {
      console.log(`项目 "${projectName}" 的文档 (共 ${documents.length} 个):`);
      documents.forEach((doc: any, index: number) => {
        console.log(`${index + 1}. ${doc.title}`);
        if (doc.description) {
          console.log(`   描述: ${doc.description}`);
        }
      });
    }
  }

  async handleGetEnvironments(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.log('使用方法: environments <项目名>');
      return;
    }

    const projectName = args[0];
    if (!apifoxMCP.isConnected(projectName)) {
      console.log(`项目 "${projectName}" 未连接`);
      return;
    }

    const environments = await apifoxMCP.getProjectEnvironments(projectName);
    if (environments) {
      console.log(`项目 "${projectName}" 的环境配置 (共 ${environments.length} 个):`);
      environments.forEach((env: any, index: number) => {
        console.log(`${index + 1}. ${env.name}`);
        if (env.description) {
          console.log(`   描述: ${env.description}`);
        }
      });
    }
  }

  async handleGetVariables(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.log('使用方法: variables <项目名>');
      return;
    }

    const projectName = args[0];
    if (!apifoxMCP.isConnected(projectName)) {
      console.log(`项目 "${projectName}" 未连接`);
      return;
    }

    const variables = await apifoxMCP.getProjectVariables(projectName);
    if (variables) {
      console.log(`项目 "${projectName}" 的变量配置 (共 ${variables.length} 个):`);
      variables.forEach((variable: any, index: number) => {
        console.log(`${index + 1}. ${variable.name}`);
        if (variable.description) {
          console.log(`   描述: ${variable.description}`);
        }
      });
    }
  }

  handleHelp(): void {
    console.log('');
    console.log('Apifox MCP 命令列表:');
    console.log('');
    console.log('connect <项目名> <项目ID> <API密钥>  - 连接到 Apifox 项目');
    console.log('disconnect <项目名>                 - 断开与项目的连接');
    console.log('status                               - 显示连接状态');
    console.log('projects                             - 列出已连接的项目');
    console.log('info <项目名>                        - 显示项目详细信息');
    console.log('apis <项目名>                        - 获取项目接口列表');
    console.log('documents <项目名>                   - 获取项目文档列表');
    console.log('environments <项目名>                - 获取项目环境配置');
    console.log('variables <项目名>                   - 获取项目变量配置');
    console.log('help                                 - 显示帮助信息');
    console.log('');
    console.log('输入 exit 或 quit 退出');
  }
}

class MCPInteractiveInterface {
  private commandHandler: MCPCommandHandler;

  constructor() {
    this.commandHandler = new MCPCommandHandler();
  }

  start(): void {
    console.log('=== Apifox MCP 交互式控制台 ===');
    console.log('输入 help 查看可用命令');
    console.log('');

    const connectedProjects = apifoxMCP.getConnectedProjects();
    if (connectedProjects.length > 0) {
      console.log(`已连接项目: ${connectedProjects.join(', ')}`);
      console.log('');
    }

    this.prompt();
  }

  prompt(): void {
    rl.question('apifox-mcp> ', async (input: string) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log('=== 退出 ===');
        rl.close();
        return;
      }

      if (input.trim()) {
        await this.commandHandler.handleCommand(input);
      }

      console.log('');
      this.prompt();
    });
  }
}

// 命令行参数处理
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // 非交互式模式 - 通过命令行参数执行命令
    const commandHandler = new MCPCommandHandler();
    await commandHandler.handleCommand(args.join(' '));
    rl.close();
    process.exit(0);
  } else {
    // 检查是否有标准输入（管道输入）
    const stdin = process.stdin;
    if (stdin.isTTY) {
      // 没有管道输入，进入交互式模式
      const interactiveInterface = new MCPInteractiveInterface();
      interactiveInterface.start();
    } else {
      // 有管道输入，读取输入并执行命令
      let input = '';
      stdin.on('data', (chunk: Buffer) => {
        input += chunk.toString();
      });

      stdin.on('end', async () => {
        const commandHandler = new MCPCommandHandler();
        await commandHandler.handleCommand(input.trim());
        rl.close();
        process.exit(0);
      });
    }
  }
}

main().catch((error) => {
  console.error('执行命令时出错:', error);
  rl.close();
  process.exit(1);
});
