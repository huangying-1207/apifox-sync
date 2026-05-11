const fs = require('fs');
const path = require('path');
const { sync: globSync } = require('glob');
const { normalizePath } = require('../utils/helper');
const ErrorHandler = require('../utils/errorHandler');

class ApiScanner {
  constructor() {
    this.changedFiles = [];
    this.dtoSchemas = {};
  }

  /**
   * 检测代码变更
   */
  async detectCodeChanges(sourcePath) {
    console.log('正在检测代码变更...');

    try {
      // 使用 git diff 检测变更的文件
      const gitStatus = await new Promise((resolve, reject) => {
        let projectRoot = sourcePath;
        while (projectRoot && projectRoot !== '/' && projectRoot !== 'D:' && projectRoot !== 'C:') {
          if (fs.existsSync(path.join(projectRoot, '.git'))) {
            break;
          }
          projectRoot = path.dirname(projectRoot);
        }

        const childProcess = require('child_process');
        const status = childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot });
        if (status.error) reject(status.error);
        else resolve(status.stdout.toString().trim());
      });

      const modifiedFiles = [];

      if (gitStatus) {
        const lines = gitStatus.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          const parts = line.trim().split(/\s+/);
          const relativePath = parts.slice(1).join(' ');

          let absolutePath;
          if (relativePath.startsWith('/')) {
            absolutePath = relativePath;
          } else {
            let projectRoot = sourcePath;
            while (projectRoot && projectRoot !== '/' && projectRoot !== 'D:' && projectRoot !== 'C:') {
              if (fs.existsSync(path.join(projectRoot, '.git'))) {
                break;
              }
              projectRoot = path.dirname(projectRoot);
            }

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
    } catch (error) {
      console.warn('Git 变更检测失败，将扫描所有文件');
      this.changedFiles = [];
      return [];
    }
  }

  /**
   * 扫描 Java 类文件，提取字段定义
   */
  scanJavaClasses(sourcePath) {
    const classSchemas = {};

    try {
      const javaFiles = globSync(`${sourcePath}/**/*.java`);
      for (const file of javaFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const className = path.basename(file, '.java');

        // 跳过 Controller、Service、Repository 等非数据类
        if (/@(Controller|RestController|Service|Repository|Component|Configuration|Aspect)\b/.test(content)) {
          continue;
        }

        const fields = {};
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
    } catch (error) {
      console.warn('Java 类文件扫描失败，将使用默认 Schema');
    }

    return classSchemas;
  }

  /**
   * 推断泛型集合的实际类型（如 List<Object> 中 Object 的实际类型）
   * 通过分析方法体中 new Xxxx() 和 .add(varName) 调用推断
   */
  inferGenericTypes(returnType, methodContent, api) {
    if (!returnType) return returnType;

    const genericMatch = returnType.match(/^(List|Set|Collection)<(.+)>$/);
    if (!genericMatch) return returnType;

    const innerType = genericMatch[2];
    if (innerType !== 'Object') return returnType;

    const inferredTypes = new Set();

    // 从方法体中查找 new XxxType() 调用
    const newPattern = /new\s+(\w+)\s*\(/g;
    let newMatch;
    while ((newMatch = newPattern.exec(methodContent)) !== null) {
      const typeName = newMatch[1];
      if (!['ArrayList', 'HashMap', 'HashSet', 'LinkedList', 'TreeMap', 'TreeSet',
            'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Object',
            'Date', 'LinkedHashMap'].includes(typeName)) {
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
          if (!['String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Object',
                'int', 'long', 'double', 'float', 'boolean'].includes(varType)) {
            inferredTypes.add(varType);
          }
        }
      }
    }

    if (inferredTypes.size === 1) {
      const actualType = [...inferredTypes][0];

      // 如果推断出 JSONObject，尝试追踪 JSON.toJSON() 的原始对象类型
      if (actualType === 'JSONObject' || actualType.includes('Map')) {
        const toJsonPattern = /JSON\.toJSON\s*\(\s*(\w+)\s*\)/;
        const toJsonMatch = methodContent.match(toJsonPattern);
        if (toJsonMatch) {
          const sourceVar = toJsonMatch[1];
          const sourceDeclPattern = new RegExp(`(?:@\\w+(?:\\([^)]*\\))?\\s+)?(\\w+)\\s+${sourceVar}\\b`);
          const sourceDeclMatch = methodContent.match(sourceDeclPattern);
          if (sourceDeclMatch) {
            api.baseType = sourceDeclMatch[1];
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
  extractMapFields(methodContent) {
    const fields = {};

    const putPattern = /\w+\.put\s*\(\s*"(\w+)"\s*,\s*([^)]+)\s*\)/g;
    let match;
    while ((match = putPattern.exec(methodContent)) !== null) {
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
  async scanSpringBootCode(sourcePath) {
    const controllers = [];

    this.scanJavaClasses(sourcePath);

    const apiPatterns = {
      'get': /@GetMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      'post': /@PostMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      'put': /@PutMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g,
      'delete': /@DeleteMapping\s*\(\s*["']?([^"']*)["']?\s*\)/g
    };

    let controllerFiles;

    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      controllerFiles = this.changedFiles.filter(file => file.match(/Controller\.java$/));
      console.log('检测到的变更文件：');
      controllerFiles.forEach(file => console.log(`- ${file}`));
    } else {
      try {
        controllerFiles = globSync(`${sourcePath}/**/*Controller.java`);
      } catch (error) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${controllerFiles.length} 个 Controller 文件`);

    for (const file of controllerFiles) {
      let normalizedFile = file;

      if (!fs.existsSync(normalizedFile)) {
        const relativeFile = path.join(sourcePath, normalizedFile.split(path.sep).pop());
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

      Object.keys(apiPatterns).forEach(method => {
        const matches = [...content.matchAll(apiPatterns[method])];
        matches.forEach(match => {
          let apiPath = match[1];
          if (apiPath && !apiPath.startsWith('/')) {
            apiPath = '/' + apiPath;
          }
          if (apiPath && apiPath.endsWith('/') && apiPath.length > 1) {
            apiPath = apiPath.slice(0, -1);
          }

          const fullPath = (classPathPrefix + apiPath).replace(/\/+/g, '/');

          const api = {
            path: fullPath,
            method: method,
            controller: fileName,
            file: file,
            parameters: []
          };

          // 确定当前方法的范围，只在该范围内匹配参数
          const methodStart = match.index;
          const methodEnd = this.findMethodEnd(content, methodStart);
          const methodContent = content.slice(methodStart, methodEnd);
          console.log(`方法内容: ${methodContent}`);

          // 匹配路径参数 (@PathVariable)
          const pathParamPattern = /@PathVariable(?:\([^)]*\))?\s*\w+\s*(\w+)/g;
          const pathParamMatches = [...methodContent.matchAll(pathParamPattern)];
          if (pathParamMatches.length > 0) {
            pathParamMatches.forEach(paramMatch => {
              api.parameters.push({
                name: paramMatch[1],
                type: 'path'
              });
            });
          }

          // 匹配查询参数 (@RequestParam)
          const queryParamPattern = /@RequestParam(?:\([^)]*\))?\s*\w+\s*(\w+)/g;
          const queryParamMatches = [...methodContent.matchAll(queryParamPattern)];
          console.log(`查询参数匹配结果: ${JSON.stringify(queryParamMatches, null, 2)}`);
          if (queryParamMatches.length > 0) {
            queryParamMatches.forEach(paramMatch => {
              api.parameters.push({
                name: paramMatch[1],
                type: 'query'
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
            if (returnType && (returnType.includes('JSONObject') || returnType.includes('Map') || returnType.includes('HashMap') ||
                returnType.includes('LinkedHashMap') || returnType.includes('TreeMap'))) {
              api.returnType = 'JSONObject';
            } else {
              api.returnType = this.inferGenericTypes(returnType, methodContent, api);
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
  findMethodEnd(content, startIndex) {
    let braceCount = 0;
    let inString = false;
    let inComment = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];

      // 处理字符串
      if (char === '"' || char === "'") {
        inString = !inString;
      } else if (!inString && !inComment) {
        // 处理注释
        if (char === '/' && content[i + 1] === '*') {
          inComment = true;
          i++;
        } else if (char === '/' && content[i + 1] === '/') {
          // 单行注释，跳过到行尾
          while (i < content.length && content[i] !== '\n') {
            i++;
          }
        } else if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            return i + 1;
          }
        }
      } else if (inComment && char === '*' && content[i + 1] === '/') {
        inComment = false;
        i++;
      }
    }

    // 如果没有找到对应的闭合大括号，返回内容的结尾
    return content.length;
  }

  /**
   * 扫描 Node.js 项目代码
   */
  async scanNodeJsCode(sourcePath) {
    const routes = [];
    const routePatterns = {
      'get': /app\.get\s*\(\s*["']([^"']*)["']/g,
      'post': /app\.post\s*\(\s*["']([^"']*)["']/g,
      'put': /app\.put\s*\(\s*["']([^"']*)["']/g,
      'delete': /app\.delete\s*\(\s*["']([^"']*)["']/g
    };

    let routeFiles;

    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      routeFiles = this.changedFiles.filter(file => file.match(/route.*\.js$/));
    } else {
      try {
        routeFiles = globSync(`${sourcePath}/**/*route*.js`);
      } catch (error) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${routeFiles.length} 个路由文件`);

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const fileName = path.basename(file);

      Object.keys(routePatterns).forEach(method => {
        const matches = [...content.matchAll(routePatterns[method])];
        matches.forEach(match => {
          const apiPath = match[1];
          routes.push({
            path: apiPath,
            method: method,
            controller: fileName,
            file: file
          });
        });
      });
    }

    return routes;
  }

  /**
   * 扫描 Django 项目代码
   */
  async scanDjangoCode(sourcePath) {
    const views = [];
    const urlPatterns = {
      'get': /path\(\s*["']([^"']*)["'].*,.*views\./g,
      'post': /path\(\s*["']([^"']*)["'].*,.*views\./g,
      'put': /path\(\s*["']([^"']*)["'].*,.*views\./g,
      'delete': /path\(\s*["']([^"']*)["'].*,.*views\./g
    };

    let urlFiles;

    if (this.changedFiles.length > 0) {
      console.log('增量同步模式：只扫描变更的文件');
      urlFiles = this.changedFiles.filter(file => file.match(/urls\.py$/));
    } else {
      try {
        urlFiles = globSync(`${sourcePath}/**/urls.py`);
      } catch (error) {
        ErrorHandler.handleScanError(error, sourcePath);
        return [];
      }
    }

    console.log(`发现 ${urlFiles.length} 个 URL 配置文件`);

    for (const file of urlFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const fileName = path.basename(file);

      Object.keys(urlPatterns).forEach(method => {
        const matches = [...content.matchAll(urlPatterns[method])];
        matches.forEach(match => {
          const apiPath = match[1];
          views.push({
            path: `/${apiPath}`,
            method: method,
            controller: fileName,
            file: file
          });
        });
      });
    }

    return views;
  }

  /**
   * 扫描后端代码中的接口变化
   */
  async scanCodeForChanges(sourcePath, framework) {
    console.log(`正在扫描 ${framework} 项目接口变化: ${sourcePath}`);

    try {
      let detectedApis = [];

      if (framework === 'springboot') {
        detectedApis = await this.scanSpringBootCode(sourcePath);
      } else if (framework === 'nodejs') {
        detectedApis = await this.scanNodeJsCode(sourcePath);
      } else if (framework === 'django') {
        detectedApis = await this.scanDjangoCode(sourcePath);
      } else {
        const error = ErrorHandler.createCustomError(
          'UNSUPPORTED_FRAMEWORK',
          `不支持的框架类型: ${framework}`,
          { framework }
        );
        ErrorHandler.handleValidationError([error]);
        ErrorHandler.logError(error, {
          framework,
          operation: 'scanCodeForChanges'
        });
        process.exit(1);
      }

      console.log(`✅ 扫描完成，发现 ${detectedApis.length} 个接口`);
      return detectedApis;
    } catch (error) {
      ErrorHandler.handleScanError(error, sourcePath);
      ErrorHandler.logError(error, {
        framework,
        sourcePath,
        operation: 'scanCodeForChanges'
      });
      process.exit(1);
    }
  }
}

module.exports = ApiScanner;
