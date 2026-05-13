/**
 * 错误处理工具
 */

import fs from 'fs';
import path from 'path';

export class ErrorHandler {
  /**
   * 处理网络请求错误
   */
  static handleNetworkError(error: any) {
    console.error('❌ 网络请求失败');

    if (error.response) {
      console.error(`状态码: ${error.response.status}`);
      console.error(`响应数据: ${JSON.stringify(error.response.data, null, 2)}`);

      const errorTypes: Record<number, string> = {
        400: '请求参数错误，请检查输入格式',
        401: '认证失败，请检查 API 密钥是否有效',
        403: '权限不足，请检查您是否有访问该项目的权限',
        404: '资源不存在，请检查项目 ID 是否正确',
        429: '请求频率超限，请稍后重试',
        500: '服务器内部错误，请稍后重试',
        503: '服务器维护中，请稍后重试',
      };

      if (errorTypes[error.response.status]) {
        console.error(`  - ${errorTypes[error.response.status]}`);
      } else {
        console.error(`  - 未知错误，状态码: ${error.response.status}`);
      }
    } else if (error.request) {
      console.error('请求已发送但未收到响应，请检查网络连接');
      console.error(`请求详情: ${error.request}`);
    } else {
      console.error(`请求配置错误: ${error.message}`);
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理文件操作错误
   */
  static handleFileError(error: any, fileName: string) {
    console.error(`❌ 文件操作失败: ${fileName}`);
    console.error(`错误信息: ${error.message}`);

    const errorCodes: Record<string, string> = {
      ENOENT: '  - 文件不存在',
      EACCES: '  - 权限不足',
      EISDIR: '  - 路径是目录而不是文件',
      ENOTDIR: '  - 目标路径不是目录',
      EEXIST: '  - 文件已存在',
    };

    if (errorCodes[error.code]) {
      console.error(errorCodes[error.code]);
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理配置错误
   */
  static handleConfigError(error: any) {
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
  static handleScanError(error: any, sourcePath: string) {
    console.error(`❌ 代码扫描失败: ${sourcePath}`);
    console.error(`错误信息: ${error.message}`);

    const errorCodes: Record<string, string> = {
      ENOENT: '  - 源代码目录不存在',
      EACCES: '  - 无法访问源代码目录',
      ENOTDIR: '  - 路径不是有效的目录',
    };

    if (errorCodes[error.code]) {
      console.error(errorCodes[error.code]);
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理同步错误
   */
  static handleSyncError(error: any, apiInfo: string) {
    console.error(`❌ 接口同步失败: ${apiInfo}`);
    console.error(`错误信息: ${error.message}`);

    const errorCodes: Record<string, string> = {
      API_RATE_LIMIT: '  - API 请求频率超限，请稍后重试',
      API_CONNECTION: '  - 无法连接到 Apifox 服务器',
      TIMEOUT: '  - 请求超时，请检查网络连接',
    };

    if (errorCodes[error.code]) {
      console.error(errorCodes[error.code]);
    }

    console.error(`错误堆栈: ${error.stack}`);
  }

  /**
   * 处理参数验证错误
   */
  static handleValidationError(errors: any[]) {
    console.error('❌ 参数验证失败');
    errors.forEach((error) => {
      console.error(`  - ${error.message}`);
    });
  }

  /**
   * 处理未预期的错误
   */
  static handleUnexpectedError(error: any) {
    console.error('❌ 发生未预期的错误');
    console.error(`错误信息: ${error.message}`);
    console.error(`错误类型: ${error.constructor.name}`);
    console.error(`错误堆栈: ${error.stack}`);
    console.error('\n请报告此问题，包括上面的错误信息');
  }

  /**
   * 创建自定义错误
   */
  static createCustomError(type: string, message: string, details: any = {}) {
    const error = new Error(message);
    (error as any).type = type;
    Object.assign(error, details);
    return error;
  }

  /**
   * 格式化错误信息
   */
  static formatError(error: any) {
    const formatted: any = {
      type: error.type || 'UNEXPECTED',
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: error.stack,
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
  static logError(error: any, context: any = {}) {
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, `apifox-sync-${new Date().toISOString().split('T')[0]}.log`);
    const logEntry = {
      timestamp: new Date().toISOString(),
      context,
      error: this.formatError(error),
    };

    try {
      fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    } catch (writeError) {
      console.error('无法写入错误日志');
      console.error(writeError);
    }
  }
}

export default ErrorHandler;
