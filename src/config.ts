/**
 * 配置管理模块
 */

import fs from 'fs';
import path from 'path';
import { Config } from './types';
import { ConfigValidator } from './utils/configValidator';
import { ErrorHandler } from './utils/errorHandler';

const APIFOX_API_BASE_URL = 'https://api.apifox.cn';

class ConfigManager {
  private config: Config | null = null;
  private configPath: string | null = null;

  /**
   * 验证配置的完整性和正确性
   */
  validateConfig(): any[] {
    if (!this.config) {
      return [];
    }

    return ConfigValidator.validate(this.config);
  }

  /**
   * 查找配置文件
   */
  findConfigFile(): boolean {
    const possiblePaths: string[] = [
      path.join(process.cwd(), '.apifoxsync.json'),
      path.join(process.cwd(), '.claude', 'apifoxsync.json'),
      path.join(process.cwd(), 'config', 'apifoxsync.json'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.apifoxsync.json')
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        this.configPath = configPath;
        console.log(`发现配置文件: ${configPath}`);
        return true;
      }
    }

    return false;
  }

  /**
   * 读取配置文件
   */
  readConfig(): Config | null {
    try {
      if (!this.configPath && !this.findConfigFile()) {
        console.log('未找到配置文件，将使用命令行参数');
        return null;
      }

      const configContent = fs.readFileSync(this.configPath!, 'utf8');
      this.config = JSON.parse(configContent);

      const validationErrors = this.validateConfig();
      if (validationErrors.length > 0) {
        ErrorHandler.logError(
          new Error('配置验证失败'),
          {
            operation: 'readConfig',
            configPath: this.configPath,
            errors: validationErrors
          }
        );
      }

      return this.config;
    } catch (error: any) {
      ErrorHandler.handleFileError(error, this.configPath!);
      ErrorHandler.logError(error, {
        operation: 'readConfig',
        configPath: this.configPath
      });
      return null;
    }
  }

  /**
   * 获取配置值
   */
  getConfig<T extends keyof Config>(key: T, defaultValue?: Config[T]): Config[T] | undefined {
    if (!this.config) {
      this.readConfig();
    }

    if (this.config && this.config[key] !== undefined) {
      return this.config[key];
    }

    return defaultValue;
  }

  /**
   * 创建默认配置文件
   */
  createDefaultConfig(): string {
    const defaultConfig = ConfigValidator.generateDefaultConfig();
    const defaultPath = path.join(process.cwd(), '.apifoxsync.json');
    fs.writeFileSync(defaultPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`已创建默认配置文件: ${defaultPath}`);
    return defaultPath;
  }

  /**
   * 设置配置值
   */
  setConfig<T extends keyof Config>(key: T, value: Config[T]): void {
    if (!this.config) {
      this.readConfig();
    }

    if (!this.config) {
      this.config = ConfigValidator.generateDefaultConfig();
    }

    this.config[key] = value;
  }

  /**
   * 保存配置到文件
   */
  saveConfig(): void {
    if (!this.configPath) {
      this.configPath = path.join(process.cwd(), '.apifoxsync.json');
    }

    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }
}

export const configManager = new ConfigManager();
export { APIFOX_API_BASE_URL };
