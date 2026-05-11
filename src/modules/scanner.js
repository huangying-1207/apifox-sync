const fs = require('fs');
const path = require('path');
const { sync: globSync } = require('glob');
const { normalizePath } = require('../utils/helper');
const ErrorHandler = require('../utils/errorHandler');

class ApiScanner {
  constructor() {
    this.changedFiles = [];
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
   * 扫描 Spring Boot 项目代码
   */
  async scanSpringBootCode(sourcePath) {
    const controllers = [];
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

          const paramPattern = /@PathVariable\s*(\w+)/g;
          const paramMatches = [...content.matchAll(paramPattern)];
          if (paramMatches.length > 0) {
            paramMatches.forEach(paramMatch => {
              api.parameters.push({
                name: paramMatch[1],
                type: 'path'
              });
            });
          }

          controllers.push(api);
        });
      });
    }

    return controllers;
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
