import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { APIFOX_API_BASE_URL } from '../config';
import { ErrorHandler } from '../utils/errorHandler';
import { retryRequest } from '../utils/helper';
import apifoxMCP from '../mcp/apifox';
import { ApiInfo } from '../types';

class ApifoxSyncer {
  private baseUrl: string;

  constructor() {
    this.baseUrl = APIFOX_API_BASE_URL;
  }

  /**
   * 从 MCP 获取项目连接信息
   */
  getConnectionInfo(projectName: string): any {
    return apifoxMCP.getConnectionInfo(projectName);
  }

  /**
   * 验证项目是否已连接
   */
  isProjectConnected(projectName: string): boolean {
    return apifoxMCP.isConnected(projectName);
  }

  /**
   * 验证与 Apifox 的连接
   */
  async validateApifoxConnection(projectId: string, apiKey: string, projectName?: string): Promise<boolean> {
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
      const response = await retryRequest(() =>
        axios.get(`${this.baseUrl}/v1/projects/${actualProjectId}/info`, {
          headers: {
            Authorization: `Bearer ${actualApiKey}`,
            'Content-Type': 'application/json',
            'X-Apifox-Api-Version': '2024-03-28',
          },
          timeout: 60000,
        }),
      );

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
  async getApifoxExistingApis(projectId: string, apiKey: string, projectName?: string): Promise<ApiInfo[]> {
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
      const response = await retryRequest(() =>
        axios.post(
          `${this.baseUrl}/v1/projects/${actualProjectId}/export-openapi`,
          {
            scope: {
              type: 'ALL',
            },
            options: {
              includeApifoxExtensionProperties: false,
              addFoldersToTags: false,
            },
            oasVersion: '3.1',
            exportFormat: 'JSON',
          },
          {
            headers: {
              Authorization: `Bearer ${actualApiKey}`,
              'Content-Type': 'application/json',
              'X-Apifox-Api-Version': '2024-03-28',
            },
            timeout: 60000,
          },
        ),
      );

      if (!response.data || typeof response.data === 'string') {
        console.warn('警告：未获取到 Apifox 现有接口信息，将同步所有检测到的接口');
        return [];
      }

      const openApiDoc = response.data;
      const existingApis: ApiInfo[] = [];

      if (openApiDoc.paths) {
        for (const [apiPath, methods] of Object.entries(openApiDoc.paths)) {
          for (const [method, details] of Object.entries(methods as any)) {
            const api: ApiInfo = {
              path: apiPath,
              method: method.toLowerCase(),
              parameters: [],
            };

            const methodDetails = details as any;

            // Extract parameters from OpenAPI doc
            if (methodDetails.parameters && Array.isArray(methodDetails.parameters)) {
              for (const param of methodDetails.parameters) {
                api.parameters!.push({
                  name: param.name,
                  type: param.in || 'query', // path, query, header, cookie
                });
              }
            }

            // Extract request body type
            if (methodDetails.requestBody?.content) {
              const contentTypes = Object.keys(methodDetails.requestBody.content);
              for (const contentType of contentTypes) {
                const schema = methodDetails.requestBody.content[contentType].schema;
                if (schema) {
                  api.requestBodyType = schema.$ref ? schema.$ref.split('/').pop() : schema.type;
                  break;
                }
              }
            }

            // Extract return type and response fields from responses
            if (methodDetails.responses?.['200']?.content) {
              const contentTypes = Object.keys(methodDetails.responses['200'].content);
              for (const contentType of contentTypes) {
                const schema = methodDetails.responses['200'].content[contentType].schema;
                if (schema) {
                  if (schema.$ref) {
                    api.returnType = schema.$ref.split('/').pop();
                  } else if (schema.type === 'array' && schema.items?.$ref) {
                    api.returnType = `List<${schema.items.$ref.split('/').pop()}>`;
                  } else if (schema.type === 'array' && schema.items?.type) {
                    api.returnType = `List<${schema.items.type}>`;
                  } else {
                    api.returnType = schema.type;
                  }

                  // Extract response field names from schema
                  api.responseFields = this.extractResponseFieldNamesFromSchema(schema, openApiDoc.components?.schemas);
                  break;
                }
              }
            }

            existingApis.push(api);
          }
        }
      }

      return existingApis;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, {
        projectId,
        operation: 'getExistingApis',
      });
      throw error;
    }
  }

  /**
   * 同步 API 文档到 Apifox
   */
  async syncToApifox(doc: any, projectId: string, apiKey: string, projectName?: string): Promise<any> {
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
      const response = await retryRequest(() =>
        axios.post(
          `${this.baseUrl}/v1/projects/${actualProjectId}/import-openapi`,
          {
            input: JSON.stringify(doc),
            options: {
              endpointOverwriteBehavior: 'OVERWRITE_EXISTING',
              schemaOverwriteBehavior: 'OVERWRITE_EXISTING',
              updateFolderOfChangedEndpoint: false,
              prependBasePath: false,
              deleteUnmatchedResources: false,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${actualApiKey}`,
              'Content-Type': 'application/json',
              'X-Apifox-Api-Version': '2024-03-28',
            },
            timeout: 60000,
          },
        ),
      );

      console.log('API 文档同步成功');
      console.log('同步结果:', JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error) {
      ErrorHandler.handleNetworkError(error);
      ErrorHandler.logError(error, {
        projectId,
        operation: 'syncToApifox',
      });
      throw error;
    }
  }

  /**
   * 保存文档到本地（调试用）
   */
  saveDocToFile(doc: any, filename: string): void {
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
  async getOpenApiDoc(url: string): Promise<any> {
    console.log(`正在获取 OpenAPI 文档: ${url}`);

    try {
      let doc: any;

      if (url.startsWith('./') || url.startsWith('../') || url.startsWith('/')) {
        console.log('检测到本地文件，读取文件内容...');
        const content = fs.readFileSync(url, 'utf8');
        try {
          doc = require('yaml').parse(content);
        } catch (_e) {
          doc = JSON.parse(content);
        }
      } else {
        const response = await retryRequest(() =>
          axios.get(url, {
            timeout: 60000,
          }),
        );

        if (typeof response.data === 'string') {
          try {
            doc = require('yaml').parse(response.data);
          } catch (_e) {
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
        operation: 'getOpenApiDoc',
      });
      throw error;
    }
  }

  /**
   * 从 OpenAPI schema 中提取响应字段名
   * 只提取 data 内部的业务字段，跳过 code/message/data 包装体字段
   * 处理 $ref 引用、嵌套 properties、数组 items 等
   */
  private extractResponseFieldNamesFromSchema(schema: any, componentSchemas?: any): string[] {
    const fields: string[] = [];

    const resolveSchema = (s: any): any => {
      if (s?.$ref && componentSchemas) {
        const refName = s.$ref.split('/').pop();
        return componentSchemas[refName] || null;
      }
      return s;
    };

    const collectFields = (s: any, depth: number = 0): void => {
      if (!s || depth > 3) return; // Prevent infinite recursion

      const resolved = resolveSchema(s);
      if (!resolved) return;

      // Handle wrapped response (e.g. { code, message, data: { ... } })
      // Only extract fields from inside data, skip wrapper fields
      if (resolved.properties?.data) {
        const dataSchema = resolveSchema(resolved.properties.data);
        if (dataSchema?.properties) {
          Object.keys(dataSchema.properties).forEach((key) => {
            if (!fields.includes(key)) {
              fields.push(key);
            }
          });
        }
        // data is array with items
        if (dataSchema?.type === 'array' && dataSchema?.items) {
          collectFields(dataSchema.items, depth + 1);
        }
        // data is $ref
        if (dataSchema?.$ref) {
          collectFields(dataSchema, depth + 1);
        }
        return; // Don't add wrapper fields (code, message, data)
      }

      if (resolved.properties) {
        Object.keys(resolved.properties).forEach((key) => {
          if (!fields.includes(key)) {
            fields.push(key);
          }
        });
      }

      // Handle array type: extract from items
      if (resolved.type === 'array' && resolved.items) {
        collectFields(resolved.items, depth + 1);
      }
    };

    collectFields(schema);
    return fields;
  }

  /**
   * 从文档中提取接口列表
   */
  extractApisFromDoc(doc: any): ApiInfo[] {
    const apis: ApiInfo[] = [];

    if (doc.paths) {
      Object.keys(doc.paths).forEach((path) => {
        const methods = doc.paths[path];
        Object.keys(methods).forEach((method) => {
          apis.push({
            path: path,
            method: method,
            summary: methods[method].summary || '未命名接口',
          });
        });
      });
    }

    return apis;
  }
}

export default ApifoxSyncer;
