/**
 * 项目类型定义
 */

export interface ApiInfo {
  path: string;
  method: string;
  controller?: string;
  file?: string;
  parameters?: ApiParameter[];
  requestBodyType?: string;
  returnType?: string;
  mapFields?: Record<string, any>;
  baseType?: string;
  summary?: string;
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
