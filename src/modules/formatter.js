const {
  containsChinese,
  getDefaultSummary,
  getDefaultParamDescription,
  getDefaultPropDescription,
  getDefaultResponseDescription
} = require('../utils/helper');
const ErrorHandler = require('../utils/errorHandler');

class ApiFormatter {
  constructor() {
    this.dtoSchemas = {};
  }

  /**
   * 设置 DTO Schema 映射（由 scanner 提供）
   */
  setDtoSchemas(schemas) {
    this.dtoSchemas = schemas || {};
  }

  /**
   * Java 类型转 OpenAPI 类型
   */
  javaTypeToOpenApi(javaType) {
    if (!javaType) return { type: 'string' };

    const t = javaType.trim();

    if (['Long', 'Integer', 'int', 'long', 'Short', 'short', 'Byte', 'byte'].includes(t)) {
      return { type: 'integer' };
    }
    if (['Double', 'Float', 'double', 'float', 'BigDecimal'].includes(t)) {
      return { type: 'number' };
    }
    if (['Boolean', 'boolean'].includes(t)) {
      return { type: 'boolean' };
    }
    if (t === 'String') {
      return { type: 'string' };
    }
    if (['Date', 'LocalDateTime', 'LocalDate', 'Timestamp', 'Instant', 'ZonedDateTime'].includes(t)) {
      return { type: 'string', format: 'date-time' };
    }
    if (t === 'LocalTime') {
      return { type: 'string', format: 'time' };
    }
    const listMatch = t.match(/^(?:List|Set|Collection)<(.+)>$/);
    if (listMatch) {
      const itemType = this.javaTypeToOpenApi(listMatch[1]);
      return { type: 'array', items: itemType.type === 'object' ? { type: 'object' } : itemType };
    }
    if (this.dtoSchemas[t]) {
      return { type: 'object', properties: this.generateObjectProperties(t) };
    }
    return { type: 'object' };
  }
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
  /**
   * 根据返回值类型生成响应模式
   */
  generateResponseSchema(returnType, api) {
    // 简单类型的响应模式
    if (!returnType || ['String', 'Integer', 'Long', 'Boolean', 'Double', 'Float'].includes(returnType)) {
      return {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '响应码' },
          message: { type: 'string', description: '响应消息' },
          data: { type: returnType && returnType.toLowerCase && returnType.toLowerCase() === 'string' ? 'string' : 'integer', description: '响应数据' }
        }
      };
    } else if (returnType.startsWith('List<') || returnType.startsWith('Set<')) {
      // 集合类型的响应模式，如 List<UserDTO> 或 Set<UserDTO>
      const genericType = returnType.match(/<([^>]+)>/)[1];
      return {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '响应码' },
          message: { type: 'string', description: '响应消息' },
          data: {
            type: 'array',
            description: '响应数据列表',
            items: {
              type: 'object',
              properties: this.generateObjectProperties(genericType, api)
            }
          }
        }
      };
    } else if (returnType === 'JSONObject') {
      // JSON 对象类型的响应模式
      return {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '响应码' },
          message: { type: 'string', description: '响应消息' },
          data: {
            type: 'object',
            description: '响应数据（JSON 对象）',
            properties: this.generateObjectProperties(returnType, api),
            additionalProperties: true
          }
        }
      };
    } else {
      // 对象类型的响应模式
      return {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '响应码' },
          message: { type: 'string', description: '响应消息' },
          data: {
            type: 'object',
            description: `响应数据 (${returnType})`,
            properties: this.generateObjectProperties(returnType, api)
          }
        }
      };
    }
  }

  /**
   * 生成对象类型的响应模式
   */
  generateObjectProperties(objectType, api) {
    const props = {};

    // 使用 baseType（JSON 转换前的原始类型）或 objectType 的 DTO Schema 作为基础字段
    const baseObjectType = (api && api.baseType) ? api.baseType : objectType;
    if (this.dtoSchemas[baseObjectType]) {
      const fields = this.dtoSchemas[baseObjectType];
      Object.keys(fields).forEach(fieldName => {
        props[fieldName] = {
          ...this.javaTypeToOpenApi(fields[fieldName]),
          description: getDefaultPropDescription(fieldName)
        };
      });
    }

    // 合并 mapFields（方法体中 .put() 添加的字段，会覆盖同名字段）
    if (api && api.mapFields && Object.keys(api.mapFields).length > 0) {
      Object.keys(api.mapFields).forEach(fieldName => {
        const fieldDef = api.mapFields[fieldName];
        props[fieldName] = {
          ...fieldDef,
          description: getDefaultPropDescription(fieldName)
        };
      });
    }

    // 如果有字段则返回，否则兜底
    if (Object.keys(props).length > 0) {
      return props;
    }

    // 兜底：最小默认 schema
    return {
      id: { type: 'integer', description: getDefaultPropDescription('id') },
      name: { type: 'string', description: getDefaultPropDescription('name') }
    };
  }

  /**
   * 根据请求体类型生成 Schema
   */
  generateBodySchema(bodyType) {
    const openApiType = this.javaTypeToOpenApi(bodyType);
    if (openApiType.type === 'object' && this.dtoSchemas[bodyType]) {
      openApiType.properties = this.generateObjectProperties(bodyType);
      return openApiType;
    }
    if (openApiType.type === 'string' || openApiType.type === 'integer' || openApiType.type === 'number' || openApiType.type === 'boolean') {
      return { type: openApiType.type };
    }
    return { type: 'object', description: `请求体 (${bodyType})` };
  }

  generateApiDocFromCode(detectedApis) {
    console.log('正在根据代码生成接口文档...');
    console.log('检测到的接口数量:', detectedApis.length);
    detectedApis.forEach((api, index) => {
      console.log(`接口 ${index + 1}:`, api.method.toUpperCase(), api.path, '返回类型:', api.returnType);
    });

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

      const operation = {
        summary: `Auto-generated summary for ${api.method.toUpperCase()} ${api.path}`,
        description: `Auto-generated description for ${api.method.toUpperCase()} ${api.path}`,
        tags: [api.controller],
        responses: {
          '200': {
            description: 'Auto-generated success response',
            content: {
              'application/json': {
                schema: this.generateResponseSchema(api.returnType, api)
              }
            }
          }
        }
      };

      // 添加接口参数
      if (api.parameters && api.parameters.length > 0) {
        operation.parameters = [];
        api.parameters.forEach(param => {
          operation.parameters.push({
            name: param.name,
            in: param.type,
            required: true,
            description: `Auto-generated description for ${param.name}`,
            schema: {
              type: 'string'
            }
          });
        });
      }

      // 添加请求体
      if (api.requestBodyType) {
        const bodySchema = this.generateBodySchema(api.requestBodyType);
        operation.requestBody = {
          description: '请求参数',
          required: true,
          content: {
            'application/json': {
              schema: bodySchema
            }
          }
        };
      }

      openApiDoc.paths[api.path][api.method] = operation;
    });

    return openApiDoc;
  }
}

module.exports = ApiFormatter;
