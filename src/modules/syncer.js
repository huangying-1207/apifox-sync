const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ApiFormatter = require('./formatter');
const ApiScanner = require('./scanner');
const ErrorHandler = require('../utils/errorHandler');
const apifoxMCP = require('../mcp/apifox');

class ApifoxSyncer {
  constructor() {
    this.baseUrl = 'https://api.apifox.com';
    this.formatter = new ApiFormatter();
    this.scanner = new ApiScanner();
  }

  /**
   * 从 MCP 获取项目连接信息
   */
  getConnectionInfo(projectName) {
    return apifoxMCP.getConnectionInfo(projectName);
  }

  /**
   * 验证项目是否已连接
   */
  isProjectConnected(projectName) {
    return apifoxMCP.isConnected(projectName);
  }

  /**
   * 验证与 Apifox 的连接
   */
  async validateApifoxConnection(projectId, apiKey, projectName) {
    let actualProjectId = projectId;
    let actualApiKey = apiKey;

    if (projectName) {
      if (!this.isProjectConnected(projectName)) {
        console.error(`❌ 项目 "${projectName}" 未连接`);
        return false;
      }

      const connectionInfo = this.getConnectionInfo(projectName);
      actualProjectId = connectionInfo.projectId;
      actualApiKey = connectionInfo.apiKey;
    }

    if (!actualProjectId || !actualApiKey) {
      console.log('跳过 Apifox 连接验证');
      return true;
    }

    console.log('正在验证 Apifox 连接...');

    try {
      const response = await axios.get(`${this.baseUrl}/v1/projects/${actualProjectId}/info`, {
        headers: {
          'Authorization': `Bearer ${actualApiKey}`,
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
      ErrorHandler.handleNetworkError(error);
      return false;
    }
  }

  /**
   * 获取 Apifox 项目的现有接口信息
   */
  async getApifoxExistingApis(projectId, apiKey, projectName) {
    let actualProjectId = projectId;
    let actualApiKey = apiKey;

    if (projectName) {
      if (!this.isProjectConnected(projectName)) {
        console.error(`❌ 项目 "${projectName}" 未连接`);
        return [];
      }

      const connectionInfo = this.getConnectionInfo(projectName);
      actualProjectId = connectionInfo.projectId;
      actualApiKey = connectionInfo.apiKey;
    }

    try {
      const response = await axios.post(`${this.baseUrl}/v1/projects/${actualProjectId}/export-openapi`, {
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
          'Authorization': `Bearer ${actualApiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

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
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, {
        projectId,
        operation: 'getExistingApis'
      });
      process.exit(1);
    }
  }

  /**
   * 同步 API 文档到 Apifox
   */
  async syncToApifox(doc, projectId, apiKey, projectName) {
    let actualProjectId = projectId;
    let actualApiKey = apiKey;

    if (projectName) {
      if (!this.isProjectConnected(projectName)) {
        console.error(`❌ 项目 "${projectName}" 未连接`);
        return null;
      }

      const connectionInfo = this.getConnectionInfo(projectName);
      actualProjectId = connectionInfo.projectId;
      actualApiKey = connectionInfo.apiKey;
      console.log(`正在同步 API 文档到 Apifox 项目: ${projectName} (ID: ${actualProjectId})`);
    } else {
      console.log(`正在同步 API 文档到 Apifox 项目: ${actualProjectId}`);
    }

    try {
      const response = await axios.post(`${this.baseUrl}/v1/projects/${actualProjectId}/import-openapi`, {
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
          'Authorization': `Bearer ${actualApiKey}`,
          'Content-Type': 'application/json',
          'X-Apifox-Api-Version': '2024-03-28'
        },
        timeout: 60000
      });

      console.log('API 文档同步成功');
      console.log('同步结果:', JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, {
        projectId,
        operation: 'syncToApifox'
      });
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
   * 获取 OpenAPI 文档
   */
  async getOpenApiDoc(url) {
    console.log(`正在获取 OpenAPI 文档: ${url}`);

    try {
      let doc;

      if (url.startsWith('./') || url.startsWith('../') || url.startsWith('/')) {
        console.log('检测到本地文件，读取文件内容...');
        const content = fs.readFileSync(url, 'utf8');
        try {
          doc = require('yaml').parse(content);
        } catch (e) {
          doc = JSON.parse(content);
        }
      } else {
        const response = await axios.get(url, {
          timeout: 60000
        });

        if (typeof response.data === 'string') {
          try {
            doc = require('yaml').parse(response.data);
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
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, {
        url,
        operation: 'getOpenApiDoc'
      });
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
}

module.exports = ApifoxSyncer;
