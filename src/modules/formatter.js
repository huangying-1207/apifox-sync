const {
  containsChinese,
  getDefaultSummary,
  getDefaultParamDescription,
  getDefaultPropDescription,
  getDefaultResponseDescription
} = require('../utils/helper');
const ErrorHandler = require('../utils/errorHandler');

class ApiFormatter {
  /**
   * 格式化 OpenAPI 文档，确保字段说明为中文
   */
  formatOpenApiDoc(doc) {
    console.log('格式化 API 文档，确保字段说明使用中文...');

    if (doc.paths) {
      Object.keys(doc.paths).forEach(path => {
        const methods = doc.paths[path];
        Object.keys(methods).forEach(method => {
          const operation = methods[method];

          if (!operation.summary || !containsChinese(operation.summary)) {
            operation.summary = getDefaultSummary(path, method);
          }

          if (!operation.description || !containsChinese(operation.description)) {
            operation.description = operation.summary;
          }

          if (operation.parameters) {
            operation.parameters = operation.parameters.map(param => {
              if (!param.description || !containsChinese(param.description)) {
                param.description = getDefaultParamDescription(param.name);
              }
              return param;
            });
          }

          if (operation.requestBody) {
            this.formatRequestBody(operation.requestBody);
          }

          if (operation.responses) {
            this.formatResponses(operation.responses);
          }
        });
      });
    }

    if (doc.components) {
      if (doc.components.schemas) {
        Object.keys(doc.components.schemas).forEach(schemaName => {
          doc.components.schemas[schemaName] = this.formatSchema(doc.components.schemas[schemaName]);
        });
      }

      if (doc.components.parameters) {
        Object.keys(doc.components.parameters).forEach(paramName => {
          if (!doc.components.parameters[paramName].description || !containsChinese(doc.components.parameters[paramName].description)) {
            doc.components.parameters[paramName].description = getDefaultParamDescription(paramName);
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

    if (requestBody.description && !containsChinese(requestBody.description)) {
      requestBody.description = '请求参数';
    }
  }

  /**
   * 格式化响应
   */
  formatResponses(responses) {
    Object.keys(responses).forEach(statusCode => {
      const response = responses[statusCode];

      if (!response.description || !containsChinese(response.description)) {
        response.description = getDefaultResponseDescription(statusCode);
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
    if (schema.description && !containsChinese(schema.description)) {
      schema.description = '数据模型';
    }

    if (schema.properties) {
      Object.keys(schema.properties).forEach(propName => {
        const prop = schema.properties[propName];

        if (!prop.description || !containsChinese(prop.description)) {
          prop.description = getDefaultPropDescription(propName);
        }

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

          if (!containsChinese(operation.summary)) {
            needFormat = true;
          }
          if (!containsChinese(operation.description)) {
            needFormat = true;
          }

          if (operation.parameters) {
            operation.parameters.forEach(param => {
              if (!containsChinese(param.description)) {
                needFormat = true;
              }
            });
          }

          if (operation.requestBody) {
            this.checkRequestBodyForFormatting(operation.requestBody, needFormat);
          }

          if (operation.responses) {
            Object.keys(operation.responses).forEach(statusCode => {
              const response = operation.responses[statusCode];
              if (!containsChinese(response.description)) {
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
    if (requestBody.description && !containsChinese(requestBody.description)) {
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
    if (schema.description && !containsChinese(schema.description)) {
      needFormat = true;
    }
    if (schema.properties) {
      Object.keys(schema.properties).forEach(propName => {
        const prop = schema.properties[propName];
        if (!containsChinese(prop.description)) {
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
}

module.exports = ApiFormatter;
