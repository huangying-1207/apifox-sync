/**
 * Apifox MCP 连接管理
 * 用于管理与 Apifox 服务器的连接和项目信息获取
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class ApifoxMCP {
  constructor() {
    this.baseUrl = 'https://api.apifox.cn';
    this.connections = new Map(); // 存储项目连接信息
    this.credentialsPath = path.join(process.cwd(), '.apifox-credentials.json');
    this.loadCredentials();
  }

  /**
   * 加载已保存的凭据
   */
  loadCredentials() {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
        Object.keys(credentials).forEach(projectName => {
          this.connections.set(projectName, credentials[projectName]);
        });
        console.log(`已加载 ${this.connections.size} 个项目的连接信息`);
      }
    } catch (error) {
      console.warn('加载凭据文件失败:', error.message);
    }
  }

  /**
   * 保存凭据
   */
  saveCredentials() {
    const credentials = Array.from(this.connections.entries()).reduce((acc, [projectName, config]) => {
      acc[projectName] = config;
      return acc;
    }, {});
    fs.writeFileSync(this.credentialsPath, JSON.stringify(credentials, null, 2));
  }

  /**
   * 连接到 Apifox 项目
   */
  async connect(projectName, projectId, apiKey) {
    console.log(`正在连接到 Apifox 项目: ${projectName}`);

    // 验证连接
    try {
      const response = await axios.get(`${this.baseUrl}/v1/projects/${projectId}/info`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

      if (response.status === 200) {
        console.log('✅ 连接成功');

        // 保存连接信息
        this.connections.set(projectName, {
          projectId,
          apiKey,
          projectInfo: response.data,
          connectedAt: new Date()
        });

        // 保存凭据
        this.saveCredentials();

        return response.data;
      } else {
        console.error('❌ 连接失败');
        return null;
      }
    } catch (error) {
      console.error('❌ 连接失败:', error.message);
      return null;
    }
  }

  /**
   * 断开连接
   */
  disconnect(projectName) {
    if (this.connections.has(projectName)) {
      this.connections.delete(projectName);
      this.saveCredentials();
      console.log(`已断开与项目 "${projectName}" 的连接`);
    } else {
      console.warn(`项目 "${projectName}" 未连接`);
    }
  }

  /**
   * 检查是否已连接到项目
   */
  isConnected(projectName) {
    return this.connections.has(projectName);
  }

  /**
   * 获取项目连接信息
   */
  getConnectionInfo(projectName) {
    return this.connections.get(projectName);
  }

  /**
   * 获取已连接项目列表
   */
  getConnectedProjects() {
    return Array.from(this.connections.keys());
  }

  /**
   * 获取项目的所有接口信息（包含完整的 OpenAPI 文档）
   */
  async getProjectApis(projectName, includeFullDoc = false) {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return null;
    }

    try {
      const response = await axios.post(`${this.baseUrl}/v1/projects/${connectionInfo.projectId}/export-openapi`, {
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
          'Authorization': `Bearer ${connectionInfo.apiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

      if (response.data) {
        const openApiDoc = response.data;

        if (includeFullDoc) {
          // 直接返回完整的 OpenAPI 文档
          return openApiDoc;
        } else {
          // 只返回接口的基本信息
          const apis = [];
          if (openApiDoc.paths) {
            Object.keys(openApiDoc.paths).forEach(path => {
              const methods = openApiDoc.paths[path];
              Object.keys(methods).forEach(method => {
                apis.push({
                  path: path,
                  method: method.toLowerCase(),
                  summary: methods[method].summary || '未命名接口',
                  description: methods[method].description || ''
                });
              });
            });
          }
          return apis;
        }
      }

      return null;
    } catch (error) {
      console.error('获取项目接口信息失败:', error.message);
      return null;
    }
  }

  /**
   * 获取项目的文档信息
   */
  async getProjectDocuments(projectName) {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return [];
    }

    try {
      const response = await axios.get(`${this.baseUrl}/v1/projects/${connectionInfo.projectId}/documents`, {
        headers: {
          'Authorization': `Bearer ${connectionInfo.apiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

      if (response.status === 200) {
        // 确保返回数组类型
        return Array.isArray(response.data) ? response.data : (response.data.documents || []);
      }

      return [];
    } catch (error) {
      console.error('获取项目文档信息失败:', error.message);
      return [];
    }
  }

  /**
   * 获取项目的环境信息
   */
  async getProjectEnvironments(projectName) {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return [];
    }

    try {
      const response = await axios.get(`${this.baseUrl}/v1/projects/${connectionInfo.projectId}/environments`, {
        headers: {
          'Authorization': `Bearer ${connectionInfo.apiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

      if (response.status === 200) {
        // 确保返回数组类型
        return Array.isArray(response.data) ? response.data : (response.data.environments || []);
      }

      return [];
    } catch (error) {
      console.error('获取项目环境信息失败:', error.message);
      return [];
    }
  }

  /**
   * 获取项目的环境变量信息
   */
  async getProjectVariables(projectName) {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return [];
    }

    try {
      const response = await axios.get(`${this.baseUrl}/v1/projects/${connectionInfo.projectId}/variables`, {
        headers: {
          'Authorization': `Bearer ${connectionInfo.apiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

      if (response.status === 200) {
        // 确保返回数组类型
        return Array.isArray(response.data) ? response.data : (response.data.variables || []);
      }

      return [];
    } catch (error) {
      console.error('获取项目变量信息失败:', error.message);
      return [];
    }
  }

  /**
   * 测试连接
   */
  async testConnection(projectName) {
    const connectionInfo = this.connections.get(projectName);
    if (!connectionInfo) {
      console.error(`项目 "${projectName}" 未连接`);
      return false;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/v1/projects/${connectionInfo.projectId}/info`, {
        headers: {
          'Authorization': `Bearer ${connectionInfo.apiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

      return response.status === 200;
    } catch (error) {
      console.error('连接测试失败:', error.message);
      return false;
    }
  }
}

// 创建单例实例
const apifoxMCP = new ApifoxMCP();
module.exports = apifoxMCP;
