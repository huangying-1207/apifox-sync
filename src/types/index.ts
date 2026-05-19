/**
 * 项目类型定义
 */

export interface ApiInfo {
  path: string;
  method: string;
  controller?: string;
  file?: string;
  javaMethodName?: string;
  parameters?: ApiParameter[];
  requestBodyType?: string;
  returnType?: string;
  mapFields?: Record<string, any>;
  baseType?: string;
  summary?: string;
  responseFields?: string[];
}

export interface ApiParameter {
  name: string;
  type: 'path' | 'query' | 'body' | 'header';
  required?: boolean;
  description?: string;
}

export interface ApiComparisonResult {
  added: ApiInfo[];
  updated: ApiInfo[];
  removed: ApiInfo[];
}

export interface ApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  paths: Record<string, Record<string, any>>;
  components: {
    schemas: Record<string, any>;
    parameters: Record<string, any>;
  };
}

/** Java 类解析结果 */
export interface ClassInfo {
  name: string;
  file: string;
  isController: boolean;
  isService: boolean;
  fields: Record<string, string>;
  extendsClass: string | null;
  implementsInterfaces: string[];
  methods: MethodInfo[];
  injectedFields: Record<string, string>;
}

/** Java 方法解析结果 */
export interface MethodInfo {
  name: string;
  returnType: string;
  parameterTypes: string[];
  requestBodyType?: string;
  calls: string[];
  putFields: Record<string, any>;
  dataCalls: string[];
  /** 方法体内 new ClassName() 构造调用 */
  constructorCalls: string[];
  /** 方法体中按类型分组的字段访问（TypeName → [fieldName, ...]），用于构造调用追踪时的字段级过滤 */
  typedFieldAccesses: Record<string, string[]>;
  /** 方法体中的 BeanUtils.copyProperties 调用（sourceVar → targetVar） */
  copyPropertiesCalls: Array<{ sourceVar: string; targetVar: string }>;
  /** 方法体中的类型转换调用（如 JSONObject.toJSON(dto), JSON.parseObject(str, Type.class)） */
  typeConversionCalls: Array<{
    sourceVar: string;
    sourceType: string;
    conversionMethod: string;
    targetTypeName: string;
    resultVar?: string;
    flowsToReturn: boolean;
  }>;
}

/** 字段级变更（git diff 检测） */
export interface FieldChange {
  className: string;
  file: string;
  addedFields: string[];
  removedFields: string[];
  changedFields: string[];
}

/** 变更点（反向追踪起点） */
export interface ChangePoint {
  className: string;
  changeType: 'field' | 'method' | 'put_fields';
  methodName?: string;
  changeDetail?: string;
}

/** 受影响的 Controller 方法 */
export interface AffectedControllerMethod {
  controllerFile: string;
  controllerClass: string;
  methodName: string;
  tracePath: string[];
  /** 触发此追踪的变更源类名 */
  changeSource: string;
  /** 变更类型 */
  changeType: 'field' | 'method' | 'put_fields';
  /** 变更详情（如字段增删） */
  changeDetail?: string;
  /** 影响类型：入参受影响 / 响应受影响 */
  impactType: 'request_body' | 'response';
}

export interface FrameworkConfig {
  name: string;
  filePattern: string;
  methodPatterns: { [key: string]: RegExp };
  classPathPattern?: RegExp;
  fileExts: string[];
}

export interface Config {
  'apifox-project-id'?: string;
  'apifox-api-key'?: string;
  'project-name'?: string;
  'source-type': 'code' | 'swagger';
  'source-path': string;
  framework?: 'springboot' | 'nodejs' | 'django';
  'sync-mode'?: 'incremental' | 'full';
  'scan-type'?: 'all' | 'changed';
  'trigger-mode'?: 'auto' | 'manual';
  'api-path'?: string;
  'api-method'?: string;
  apis?: string;
}

export interface ProjectConnectionInfo {
  projectId: string;
  apiKey: string;
}
