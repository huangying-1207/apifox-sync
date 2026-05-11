/**
 * 错误处理工具
 */

class ErrorHandler {
  /**
   * 处理网络请求错误
   */
  static handleNetworkError(error) {
    console.error('❌ 网络请求失败');

    if (error.response) {
      console.error(`状态码: ${error.response.status}`);
      console.error(`响应数据: ${JSON.stringify(error.response.data, null, 2)}`);
      console.error(`响应头: ${JSON.stringify(error.response.headers, null, 2)}`);

      if (error.response.status === 401) {
        console.error('  - 认证失败，请检查 API 密钥是否有效');
      } else if (error.response.status === 403) {
        console.error('  - 权限不足，请检查您是否有访问该项目的权限');
      } else if (error.response.status === 404) {
        console.error('  - 请求的资源不存在，请检查项目 ID 是否正确');
      } else if (error.response.status === 500) {
        console.error('  - 服务器内部错误，请稍后重试');
      }
    } else if (error.request) {
      console.error('请求已发送但未收到响应');
      console.error(`请求详情: ${error.request}`);
    } else {
      console.error(`请求配置错误: ${error.message}`);
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理文件操作错误
   */
  static handleFileError(error, fileName) {
    console.error(`❌ 文件操作失败: ${fileName}`);
    console.error(`错误信息: ${error.message}`);

    if (error.code === 'ENOENT') {
      console.error('  - 文件不存在');
    } else if (error.code === 'EACCES') {
      console.error('  - 权限不足');
    } else if (error.code === 'EISDIR') {
      console.error('  - 目标路径是目录而不是文件');
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理配置错误
   */
  static handleConfigError(error) {
    console.error('❌ 配置错误');
    console.error(`错误信息: ${error.message}`);

    if (error.type === 'missing_field') {
      console.error(`缺少配置字段: ${error.field}`);
    } else if (error.type === 'invalid_value') {
      console.error(`无效的配置值: ${error.field} = ${error.value}`);
    }

    console.error('请检查 .apifoxsync.json 配置文件');
    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理代码扫描错误
   */
  static handleScanError(error, sourcePath) {
    console.error(`❌ 代码扫描失败: ${sourcePath}`);
    console.error(`错误信息: ${error.message}`);

    if (error.code === 'ENOENT') {
      console.error('  - 源代码目录不存在');
    } else if (error.code === 'EACCES') {
      console.error('  - 无法访问源代码目录');
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理同步错误
   */
  static handleSyncError(error, apiInfo) {
    console.error(`❌ 接口同步失败: ${apiInfo}`);
    console.error(`错误信息: ${error.message}`);

    if (error.code === 'API_RATE_LIMIT') {
      console.error('  - API 请求频率超限，请稍后重试');
    } else if (error.code === 'API_CONNECTION') {
      console.error('  - 无法连接到 Apifox 服务器');
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理参数验证错误
   */
  static handleValidationError(errors) {
    console.error('❌ 参数验证失败');
    errors.forEach(error => {
      console.error(`  - ${error.message}`);
    });
  }

  /**
   * 处理未预期的错误
   */
  static handleUnexpectedError(error) {
    console.error('❌ 发生未预期的错误');
    console.error(`错误信息: ${error.message}`);
    console.error(`错误类型: ${error.constructor.name}`);
    console.error(`错误堆栈: ${error.stack}`);
    console.error('\n请报告此问题，包括上面的错误信息');
  }

  /**
   * 创建自定义错误
   */
  static createCustomError(type, message, details = {}) {
    const error = new Error(message);
    error.type = type;
    Object.assign(error, details);
    return error;
  }

  /**
   * 格式化错误信息
   */
  static formatError(error) {
    const formatted = {
      type: error.type || 'UNEXPECTED',
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: error.stack
    };

    if (error.code) {
      formatted.code = error.code;
    }

    if (error.field) {
      formatted.field = error.field;
    }

    if (error.value) {
      formatted.value = error.value;
    }

    return formatted;
  }

  /**
   * 记录错误日志
   */
  static logError(error, context = {}) {
    const fs = require('fs');
    const path = require('path');

    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, `apifox-sync-${new Date().toISOString().split('T')[0]}.log`);
    const logEntry = {
      timestamp: new Date().toISOString(),
      context,
      error: this.formatError(error)
    };

    try {
      fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    } catch (writeError) {
      console.error('无法写入错误日志');
      console.error(writeError);
    }
  }
}

module.exports = ErrorHandler;
