/**
 * API 扫描器类
 * 用于扫描不同框架的代码以提取接口信息
 */

import fs from 'fs';
import path from 'path';
import { sync as globSync } from 'glob';
import { ApiInfo, FrameworkConfig } from '../../types';
import { ErrorHandler } from '../../utils/errorHandler';

const FRAMEWORK_CONFIGS: Record<string, FrameworkConfig> = {
  springboot: {
    name: 'Spring Boot',
    filePattern: '**/*Controller.java',
    methodPatterns: {
      get: /@GetMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      post: /@PostMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      put: /@PutMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      delete: /@DeleteMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
    },
    classPathPattern: /@RequestMapping\s*\(\s*["']?([^"']*)["']?\s*\)/,
    fileExts: ['.java'],
  },
  nodejs: {
    name: 'Node.js',
    filePattern: '**/*{route,Route,router,Router,routes,Routes}*.{js,ts}',
    methodPatterns: {
      get: /(?:app|router|Route)\.get\s*\(\s*["'`]([^"'`]*)["'`]/g,
      post: /(?:app|router|Route)\.post\s*\(\s*["'`]([^"'`]*)["'`]/g,
      put: /(?:app|router|Route)\.put\s*\(\s*["'`]([^"'`]*)["'`]/g,
      delete: /(?:app|router|Route)\.delete\s*\(\s*["'`]([^"'`]*)["'`]/g,
      patch: /(?:app|router|Route)\.patch\s*\(\s*["'`]([^"'`]*)["'`]/g,
    },
    classPathPattern: undefined,
    fileExts: ['.js', '.ts'],
  },
  django: {
    name: 'Django',
    filePattern: '**/urls.py',
    methodPatterns: {
      get: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      post: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      put: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      delete: /path\(\s*["']([^"']*)["'].*,.*views\./g,
    },
    classPathPattern: undefined,
    fileExts: ['.py'],
  },
};

export class ApiScanner {
  private changedFiles: string[] = [];
  private dtoSchemas: any = {};

  /**
   * 查找 git 仓库根目录
   */
  private findGitRoot(dir: string): string {
    let current = path.resolve(dir);
    while (current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, '.git'))) {
        return current;
      }
      current = path.dirname(current);
    }

    // 检查根目录本身
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    return dir;
  }

  /**
   * 检测代码变更
   */
  async detectCodeChanges(sourcePath: string): Promise<string[]> {
    console.log('正在检测代码变更...');

    try {
      const projectRoot = this.findGitRoot(sourcePath);
      const childProcess = require('child_process');
      const status = childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot });

      if (status.error) throw status.error;

      const gitStatus = status.stdout.toString().trim();
      const modifiedFiles: string[] = [];

      if (gitStatus) {
        const lines = gitStatus.split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          const parts = line.trim().split(/\s+/);
          const relativePath = parts.slice(1).join(' ');

          let absolutePath: string;
          if (relativePath.startsWith('/')) {
            absolutePath = relativePath;
          } else {
            absolutePath = path.join(projectRoot, relativePath);
          }

          absolutePath = path.normalize(absolutePath);

          if (absolutePath.match(/\.(java|js|py)$/)) {
            modifiedFiles.push(absolutePath);
          }
        });
      }

      console.log(`检测到 ${modifiedFiles.length} 个文件有变更`);
      this.changedFiles = modifiedFiles;
      return modifiedFiles;
    } catch (_error: any) {
      console.warn('Git 变更检测失败，将扫描所有文件');
      this.changedFiles = [];
      return [];
    }
  }

  /**
   * 扫描 Java 类文件，提取字段定义
   */
  scanJavaClasses(sourcePath: string): any {
    const classSchemas: any = {};

    try {
      // 处理 Windows 路径格式
      const normalizedSourcePath = sourcePath.replace(/\\/g, '/');
      const javaFiles = globSync(normalizedSourcePath + '/**/*.java');
      for (const file of javaFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const className = path.basename(file, '.java');

        // 跳过 Controller、Service、Repository 等非数据类
        if (/@(Controller|RestController|Service|Repository|Component|Configuration|Aspect)\b/.test(content)) {
          continue;
        }

        const fields: any = {};
        const fieldPattern = /private\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/g;
        let fieldMatch;
        while ((fieldMatch = fieldPattern.exec(content)) !== null) {
          fields[fieldMatch[2]] = fieldMatch[1];
        }

        if (Object.keys(fields).length > 0) {
          classSchemas[className] = fields;
        }
      }

      this.dtoSchemas = classSchemas;
    } catch (_error: any) {
      console.warn('Java 类文件扫描失败，将使用默认 Schema');
    }

    return classSchemas;
  }

  /**
   * 推断泛型集合的实际类型（如 List<Object> 中 Object 的实际类型）
   * 通过分析方法体中 new Xxxx() 和 .add(varName) 调用推断
   */
  inferGenericTypes(returnType: string, methodContent: string, api: ApiInfo): string {
    if (!returnType) return returnType;

    const genericMatch = returnType.match(/^(List|Set|Collection)<(.+)>$/);
    if (!genericMatch) return returnType;

    const innerType = genericMatch[2];
    if (innerType !== 'Object') return returnType;

    const inferredTypes = new Set<string>();

    // 从方法体中查找 new XxxType() 调用
    const newPattern = /new\s+(\w+)\s*\(/g;
    let newMatch;
    while ((newMatch = newPattern.exec(methodContent)) !== null) {
      const typeName = newMatch[1];
      if (
        ![
          'ArrayList',
          'HashMap',
          'HashSet',
          'LinkedList',
          'TreeMap',
          'TreeSet',
          'String',
          'Integer',
          'Long',
          'Double',
          'Float',
          'Boolean',
          'Object',
          'Date',
          'LinkedHashMap',
        ].includes(typeName)
      ) {
        inferredTypes.add(typeName);
      }
    }

    // 从 .add(varName) 调用追踪变量类型
    if (inferredTypes.size === 0) {
      const addPattern = /\w+\.add\s*\(\s*(\w+)\s*\)/g;
      let addMatch;
      while ((addMatch = addPattern.exec(methodContent)) !== null) {
        const varName = addMatch[1];
        const varDeclPattern = new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?(\\w+(?:<[^>]+>)?)\\s+${varName}\\b`);
        const varDeclMatch = methodContent.match(varDeclPattern);
        if (varDeclMatch) {
          const varType = varDeclMatch[1];
          if (
            ![
              'String',
              'Integer',
              'Long',
              'Double',
              'Float',
              'Boolean',
              'Object',
              'int',
              'long',
              'double',
              'float',
              'boolean',
            ].includes(varType)
          ) {
            inferredTypes.add(varType);
          }
        }
      }
    }

    // 专门处理 JSON.toJSON() 转换的情况
    const toJsonPattern = /JSON\.toJSON\s*\(\s*(\w+)\s*\)/;
    const toJsonMatch = methodContent.match(toJsonPattern);
    if (toJsonMatch) {
      const sourceVar = toJsonMatch[1];
      const sourceDeclPattern = new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?(\\w+)\\s+${sourceVar}\\b`);
      const sourceDeclMatch = methodContent.match(sourceDeclPattern);
      if (sourceDeclMatch) {
        api.baseType = sourceDeclMatch[1];
        return `${genericMatch[1]}<${sourceDeclMatch[1]}>`;
      }
    }

    if (inferredTypes.size === 1) {
      const actualType = [...inferredTypes][0];

      // 如果推断出 JSONObject，尝试追踪 JSON.toJSON() 的原始对象类型
      if (actualType === 'JSONObject' || actualType.includes('Map')) {
        if (toJsonMatch) {
          const sourceVar = toJsonMatch[1];
          const sourceDeclPattern = new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?(\\w+)\\s+${sourceVar}\\b`);
          const sourceDeclMatch = methodContent.match(sourceDeclPattern);
          if (sourceDeclMatch) {
            api.baseType = sourceDeclMatch[1];
            return `${genericMatch[1]}<${sourceDeclMatch[1]}>`;
          }
        }
      }

      return `${genericMatch[1]}<${actualType}>`;
    }

    return returnType;
  }

  /**
   * 从方法体中提取 Map.put() 调用的字段
   */
  extractMapFields(methodContent: string): any {
    const fields: any = {};

    // 先去除方法内容中的注释
    let cleanContent = methodContent;
    // 去除多行注释 /* ... */
    cleanContent = cleanContent.replace(/\/\*[\s\S]*?\*\//g, '');
    // 去除单行注释 // ...
    cleanContent = cleanContent.replace(/\/\/.*$/gm, '');

    const putPattern = /\w+\.put\s*\(\s*"(\w+)"\s*,\s*([^)]+)\s*\)/g;
    let match;
    while ((match = putPattern.exec(cleanContent)) !== null) {
      const fieldName = match[1];
      const valueExpr = match[2].trim();

      if (/^".*"$/.test(valueExpr)) {
        fields[fieldName] = { type: 'string' };
      } else if (/^\d+$/.test(valueExpr)) {
        fields[fieldName] = { type: 'integer' };
      } else if (/^\d+\.\d+$/.test(valueExpr)) {
        fields[fieldName] = { type: 'number' };
      } else if (/^(true|false)$/.test(valueExpr)) {
        fields[fieldName] = { type: 'boolean' };
      } else if (/new\s+(java\.util\.)?Date/.test(valueExpr)) {
        fields[fieldName] = { type: 'string', format: 'date-time' };
      } else if (/^\d+L$/i.test(valueExpr)) {
        fields[fieldName] = { type: 'integer' };
      } else {
        fields[fieldName] = { type: 'string' };
      }
    }

    return fields;
  }

  /**
   * 扫描 Spring Boot 项目代码
   */
  async scanSpringBootCode(sourcePath: string): Promise<ApiInfo[]> {
    const controllers: ApiInfo[] = [];

    this.scanJavaClasses(sourcePath);

    const apiPatterns = {
      get: /@GetMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      post: /@PostMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      put: /@PutMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      delete: /@DeleteMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
    };

    let controllerFiles: string[];

    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      controllerFiles = this.changedFiles.filter((file) => file.match(/Controller\.java$/));
      console.log('检测到的变更文件：');
      controllerFiles.forEach((file) => console.log(`- ${file}`));
    } else {
      try {
        controllerFiles = globSync(`${sourcePath}/**/*Controller.java`);
      } catch (error: any) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${controllerFiles.length} 个 Controller 文件`);

    for (const file of controllerFiles) {
      let normalizedFile = file;

      if (!fs.existsSync(normalizedFile)) {
        const relativeFile = path.join(sourcePath, normalizedFile.split(path.sep).pop() || '');
        if (fs.existsSync(relativeFile)) {
          normalizedFile = relativeFile;
        } else {
          console.warn(`警告：文件不存在，将跳过: ${file}`);
          continue;
        }
      }

      const content = fs.readFileSync(normalizedFile, 'utf8');
      const fileName = path.basename(normalizedFile);

      let classPathPrefix = '';
      const classRequestMappingPattern = /@RequestMapping\s*\(\s*["']?([^"']*)["']?\s*\)/;
      const classPathMatch = content.match(classRequestMappingPattern);
      if (classPathMatch) {
        classPathPrefix = classPathMatch[1];
        if (classPathPrefix && !classPathPrefix.startsWith('/')) {
          classPathPrefix = '/' + classPathPrefix;
        }
        if (classPathPrefix && classPathPrefix.endsWith('/')) {
          classPathPrefix = classPathPrefix.slice(0, -1);
        }
      }

      Object.keys(apiPatterns).forEach((method: string) => {
        const matches = [...content.matchAll((apiPatterns as any)[method])];
        matches.forEach((match) => {
          let apiPath = match[1];
          if (apiPath && !apiPath.startsWith('/')) {
            apiPath = '/' + apiPath;
          }
          if (apiPath && apiPath.endsWith('/') && apiPath.length > 1) {
            apiPath = apiPath.slice(0, -1);
          }

          const fullPath = (classPathPrefix + apiPath).replace(/\/+/g, '/');

          const api: ApiInfo = {
            path: fullPath,
            method: method,
            controller: fileName,
            file: file,
            parameters: [],
          };

          // 确定当前方法的范围，只在该范围内匹配参数
          const methodStart = match.index!;
          const methodEnd = this.findMethodEnd(content, methodStart);
          const methodContent = content.slice(methodStart, methodEnd);

          // 匹配路径参数 (@PathVariable)
          const pathParamPattern = /@PathVariable(?:\([^)]*\))?\s*\w+\s*(\w+)/g;
          const pathParamMatches = [...methodContent.matchAll(pathParamPattern)];
          if (pathParamMatches.length > 0) {
            pathParamMatches.forEach((paramMatch) => {
              api.parameters?.push({
                name: paramMatch[1],
                type: 'path',
              });
            });
          }

          // 匹配查询参数 (@RequestParam)
          const queryParamPattern = /@RequestParam(?:\([^)]*\))?\s*\w+\s*(\w+)/g;
          const queryParamMatches = [...methodContent.matchAll(queryParamPattern)];
          if (queryParamMatches.length > 0) {
            queryParamMatches.forEach((paramMatch) => {
              api.parameters?.push({
                name: paramMatch[1],
                type: 'query',
              });
            });
          }

          // 匹配请求体 (@RequestBody)
          const requestBodyPattern = /@RequestBody\s+(\w+(?:<[^>]+>)?)\s+(\w+)/;
          const requestBodyMatch = methodContent.match(requestBodyPattern);
          if (requestBodyMatch) {
            api.requestBodyType = requestBodyMatch[1];
          }

          // 匹配返回值类型，支持复杂类型如 List<UserDTO> 和 JSON 对象类型
          const returnTypePattern = /public\s+([^\s]+(\<[^\>]+\>)?)?\s+\w+\s*\(/;
          const returnTypeMatch = methodContent.match(returnTypePattern);
          if (returnTypeMatch) {
            let returnType = returnTypeMatch[1];
            // 处理 JSON 对象类型
            if (
              returnType &&
              (returnType.includes('JSONObject') ||
                returnType.includes('Map') ||
                returnType.includes('HashMap') ||
                returnType.includes('LinkedHashMap') ||
                returnType.includes('TreeMap'))
            ) {
              api.returnType = 'JSONObject';
            } else {
              api.returnType = this.inferGenericTypes(returnType!, methodContent, api);
            }
            // 对所有方法都尝试提取 map put 字段
            const mapFields = this.extractMapFields(methodContent);
            if (Object.keys(mapFields).length > 0) {
              api.mapFields = mapFields;
            }
          }

          controllers.push(api);
        });
      });
    }

    return controllers;
  }

  /**
   * 确定方法的结束位置
   */
  findMethodEnd(content: string, startIndex: number): number {
    let braceCount = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inComment = false;
    let inLineComment = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (inLineComment) {
        if (char === '\n') {
          inLineComment = false;
        }
        continue;
      }

      if (inComment) {
        if (char === '*' && nextChar === '/') {
          inComment = false;
          i++;
        }
        continue;
      }

      if (inSingleQuote) {
        if (char === '\\' && nextChar) {
          i++;
        } else if (char === "'") {
          inSingleQuote = false;
        }
        continue;
      }

      if (inDoubleQuote) {
        if (char === '\\' && nextChar) {
          i++;
        } else if (char === '"') {
          inDoubleQuote = false;
        }
        continue;
      }

      // 不在任何字符串或注释中
      if (char === '/' && nextChar === '*') {
        inComment = true;
        i++;
      } else if (char === '/' && nextChar === '/') {
        inLineComment = true;
        i++;
      } else if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return i + 1;
        }
      }
    }

    return content.length;
  }

  /**
   * 扫描 Node.js 项目代码
   */
  async scanNodeJsCode(sourcePath: string): Promise<ApiInfo[]> {
    const routes: ApiInfo[] = [];
    // 支持 app.get/router.get/express.Router() 等多种模式
    const routePatterns = {
      get: /(?:app|router|Route)\.get\s*\(\s*["'`]([^"'`]*)["'`]/g,
      post: /(?:app|router|Route)\.post\s*\(\s*["'`]([^"'`]*)["'`]/g,
      put: /(?:app|router|Route)\.put\s*\(\s*["'`]([^"'`]*)["'`]/g,
      delete: /(?:app|router|Route)\.delete\s*\(\s*["'`]([^"'`]*)["'`]/g,
      patch: /(?:app|router|Route)\.patch\s*\(\s*["'`]([^"'`]*)["'`]/g,
    };

    let routeFiles: string[];

    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      routeFiles = this.changedFiles.filter((file) => file.match(/\.(js|ts)$/));
    } else {
      try {
        routeFiles = globSync(`${sourcePath}/**/*{route,Route,router,Router,routes,Routes}*.{js,ts}`, {
          ignore: ['**/node_modules/**'],
        });
        const indexFiles = globSync(`${sourcePath}/**/{index,app,server}.{js,ts}`, {
          ignore: ['**/node_modules/**'],
        });
        routeFiles = [...new Set([...routeFiles, ...indexFiles])];
      } catch (error: any) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${routeFiles.length} 个路由文件`);

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const fileName = path.basename(file);

      Object.keys(routePatterns).forEach((method) => {
        const matches = [...content.matchAll((routePatterns as any)[method])];
        matches.forEach((match) => {
          const apiPath = match[1];
          routes.push({
            path: apiPath,
            method: method,
            controller: fileName,
            file: file,
          });
        });
      });
    }

    return routes;
  }

  /**
   * 扫描 Django 项目代码
   */
  async scanDjangoCode(sourcePath: string): Promise<ApiInfo[]> {
    const views: ApiInfo[] = [];
    const urlPatterns = {
      get: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      post: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      put: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      delete: /path\(\s*["']([^"']*)["'].*,.*views\./g,
    };

    let urlFiles: string[];

    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      urlFiles = this.changedFiles.filter((file) => file.match(/urls\.py$/));
    } else {
      try {
        urlFiles = globSync(`${sourcePath}/**/urls.py`);
      } catch (error: any) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${urlFiles.length} 个 URL 配置文件`);

    for (const file of urlFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const fileName = path.basename(file);

      Object.keys(urlPatterns).forEach((method) => {
        const matches = [...content.matchAll((urlPatterns as any)[method])];
        matches.forEach((match) => {
          const apiPath = match[1];
          views.push({
            path: `/${apiPath}`,
            method: method,
            controller: fileName,
            file: file,
          });
        });
      });
    }

    return views;
  }

  /**
   * 通用扫描方法
   */
  async scanCodeByFramework(sourcePath: string, framework: string): Promise<ApiInfo[]> {
    const config = FRAMEWORK_CONFIGS[framework];
    if (!config) {
      const error = ErrorHandler.createCustomError('UNSUPPORTED_FRAMEWORK', `不支持的框架类型: ${framework}`, {
        framework,
      });
      ErrorHandler.handleValidationError([error]);
      ErrorHandler.logError(error, {
        framework,
        operation: 'scanCodeForChanges',
      });
      throw error;
    }

    console.log(`正在扫描 ${config.name} 项目接口变化: ${sourcePath}`);

    // 扫描 Java 类文件以获取 DTO 模式
    if (framework === 'springboot') {
      this.scanJavaClasses(sourcePath);
    }

    let files: string[];
    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      files = this.changedFiles.filter((file) => {
        // 检查文件是否匹配框架的文件扩展名
        return config.fileExts.some((ext) => file.endsWith(ext));
      });
    } else {
      try {
        files = globSync(`${sourcePath}/${config.filePattern}`);
      } catch (error: any) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${files.length} 个 Controller 文件`);

    const apis: ApiInfo[] = [];

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.warn(`警告：文件不存在，将跳过: ${file}`);
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      const fileName = path.basename(file);

      let classPathPrefix = '';
      if (config.classPathPattern) {
        const classPathMatch = content.match(config.classPathPattern);
        if (classPathMatch) {
          classPathPrefix = classPathMatch[1];
          if (classPathPrefix && !classPathPrefix.startsWith('/')) {
            classPathPrefix = '/' + classPathPrefix;
          }
          if (classPathPrefix && classPathPrefix.endsWith('/')) {
            classPathPrefix = classPathPrefix.slice(0, -1);
          }
        }
      }

      Object.keys(config.methodPatterns).forEach((method) => {
        const matches = [...content.matchAll(config.methodPatterns[method])];
        matches.forEach((match) => {
          let apiPath = match[1];

          // 规范化路径
          if (apiPath && !apiPath.startsWith('/')) {
            apiPath = '/' + apiPath;
          }
          if (apiPath && apiPath.endsWith('/') && apiPath.length > 1) {
            apiPath = apiPath.slice(0, -1);
          }

          const fullPath = (classPathPrefix + apiPath).replace(/\/+/g, '/');

          const api: ApiInfo = {
            path: fullPath,
            method: method,
            controller: fileName,
            file: file,
            parameters: [],
          };

          // 根据框架类型解析额外信息
          if (framework === 'springboot') {
            this.parseSpringBootApiDetails(content, api, match.index!);
          } else if (framework === 'nodejs') {
            this.parseNodeJsApiDetails(content, api, match.index!);
          } else if (framework === 'django') {
            this.parseDjangoApiDetails(content, api, match.index!);
          }

          apis.push(api);
        });
      });
    }

    console.log(`✅ 扫描完成，发现 ${apis.length} 个接口`);
    return apis;
  }

  /**
   * 解析 Spring Boot API 详情
   */
  parseSpringBootApiDetails(content: string, api: ApiInfo, startIndex: number): void {
    const methodContent = this.extractMethodContent(content, startIndex);

    // 匹配路径参数 (@PathVariable)
    const pathParamPattern = /@PathVariable(?:\([^)]*\))?\s*\w+\s*(\w+)/g;
    const pathParamMatches = [...methodContent.matchAll(pathParamPattern)];
    if (pathParamMatches.length > 0) {
      pathParamMatches.forEach((paramMatch) => {
        api.parameters?.push({
          name: paramMatch[1],
          type: 'path',
        });
      });
    }

    // 匹配查询参数 (@RequestParam)
    const queryParamPattern = /@RequestParam(?:\([^)]*\))?\s*\w+\s*(\w+)/g;
    const queryParamMatches = [...methodContent.matchAll(queryParamPattern)];
    if (queryParamMatches.length > 0) {
      queryParamMatches.forEach((paramMatch) => {
        api.parameters?.push({
          name: paramMatch[1],
          type: 'query',
        });
      });
    }

    // 匹配请求体 (@RequestBody)
    const requestBodyPattern = /@RequestBody\s+(\w+(?:<[^>]+>)?)\s+(\w+)/;
    const requestBodyMatch = methodContent.match(requestBodyPattern);
    if (requestBodyMatch) {
      api.requestBodyType = requestBodyMatch[1];
    }

    // 匹配返回值类型
    const returnTypePattern = /public\s+([^\s]+(\<[^\>]+\>)?)?\s+\w+\s*\(/;
    const returnTypeMatch = methodContent.match(returnTypePattern);
    if (returnTypeMatch) {
      let returnType = returnTypeMatch[1];

      if (returnType && (returnType.includes('JSONObject') || returnType.includes('Map'))) {
        api.returnType = 'JSONObject';
      } else {
        api.returnType = this.inferGenericTypes(returnType!, methodContent, api);
      }

      const mapFields = this.extractMapFields(methodContent);
      if (Object.keys(mapFields).length > 0) {
        api.mapFields = mapFields;
      }
    }

    // 提取响应字段列表（用于对比）
    api.responseFields = this.extractResponseFieldNames(api);
  }

  /**
   * 根据返回类型提取响应字段名列表
   */
  extractResponseFieldNames(api: ApiInfo): string[] {
    const fields: string[] = [];

    // 优先从 mapFields 提取
    if (api.mapFields && Object.keys(api.mapFields).length > 0) {
      fields.push(...Object.keys(api.mapFields));
    }

    // 从 DTO Schema 提取（使用 baseType 或 returnType）
    const dtoType = api.baseType || api.returnType;
    if (dtoType) {
      // 处理泛型，如 List<UserDTO> -> UserDTO
      const genericMatch = dtoType.match(/^(?:List|Set|Collection)<(.+)>$/);
      const typeName = genericMatch ? genericMatch[1] : dtoType;

      if (this.dtoSchemas[typeName]) {
        const dtoFields = Object.keys(this.dtoSchemas[typeName]);
        dtoFields.forEach((f) => {
          if (!fields.includes(f)) {
            fields.push(f);
          }
        });
      }
    }

    return fields;
  }

  /**
   * 解析 Node.js API 详情
   */
  parseNodeJsApiDetails(_content: string, _api: ApiInfo, _startIndex: number): void {
    // Node.js 简单解析，主要获取路径和方法
  }

  /**
   * 解析 Django API 详情
   */
  parseDjangoApiDetails(_content: string, _api: ApiInfo, _startIndex: number): void {
    // Django 简单解析，主要获取路径和方法
  }

  /**
   * 提取方法内容
   */
  extractMethodContent(content: string, startIndex: number): string {
    const methodEnd = this.findMethodEnd(content, startIndex);
    return content.slice(startIndex, methodEnd);
  }

  /**
   * 扫描后端代码中的接口变化
   */
  async scanCodeForChanges(sourcePath: string, framework: string): Promise<ApiInfo[]> {
    return await this.scanCodeByFramework(sourcePath, framework);
  }

  /**
   * 获取 DTO 模式
   */
  getDtoSchemas(): any {
    return this.dtoSchemas;
  }

  /**
   * 获取变更文件列表
   */
  getChangedFiles(): string[] {
    return this.changedFiles;
  }
}

export default ApiScanner;
