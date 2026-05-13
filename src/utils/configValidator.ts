/**
 * 配置验证工具
 */

import { Config } from '../types';

export class ConfigValidator {
  /**
   * 验证配置的完整性和正确性
   */
  static validate(config: Partial<Config>): any[] {
    const errors: any[] = [];

    if (!config) {
      errors.push({
        type: 'missing_config',
        message: '配置对象不存在',
      });
      return errors;
    }

    // 验证必填字段
    const requiredFields: string[] = ['source-type', 'source-path'];

    // 如果没有提供 project-name，则需要验证 apifox-project-id 和 apifox-api-key
    if (!config['project-name']) {
      requiredFields.push('apifox-project-id');
      requiredFields.push('apifox-api-key');
    }

    requiredFields.forEach((field) => {
      if (!config[field as keyof Config]) {
        errors.push({
          type: 'missing_field',
          field,
          message: `缺少必填配置字段: ${field}`,
        });
      }
    });

    // 验证源类型
    if (config['source-type'] && !['code', 'swagger'].includes(config['source-type'])) {
      errors.push({
        type: 'invalid_value',
        field: 'source-type',
        value: config['source-type'],
        message: '无效的源类型，支持 code 或 swagger',
      });
    }

    // 验证框架类型
    if (config['source-type'] === 'code' && !config['framework']) {
      errors.push({
        type: 'missing_field',
        field: 'framework',
        message: '当 source-type 为 code 时，需要指定 framework 字段',
      });
    }

    if (config['framework'] && !['springboot', 'nodejs', 'django'].includes(config['framework'])) {
      errors.push({
        type: 'invalid_value',
        field: 'framework',
        value: config['framework'],
        message: '无效的框架类型，支持 springboot、nodejs 或 django',
      });
    }

    // 验证同步模式
    if (config['sync-mode'] && !['incremental', 'full'].includes(config['sync-mode'])) {
      errors.push({
        type: 'invalid_value',
        field: 'sync-mode',
        value: config['sync-mode'],
        message: '无效的同步模式，支持 incremental 或 full',
      });
    }

    // 验证触发模式
    if (config['trigger-mode'] && !['auto', 'manual'].includes(config['trigger-mode'])) {
      errors.push({
        type: 'invalid_value',
        field: 'trigger-mode',
        value: config['trigger-mode'],
        message: '无效的触发模式，支持 auto 或 manual',
      });
    }

    // 验证扫描类型
    if (config['scan-type'] && !['all', 'changed'].includes(config['scan-type'])) {
      errors.push({
        type: 'invalid_value',
        field: 'scan-type',
        value: config['scan-type'],
        message: '无效的扫描类型，支持 all 或 changed',
      });
    }

    // 验证源路径格式
    if (config['source-type'] === 'swagger' && config['source-path']) {
      if (!config['source-path'].startsWith('http://') && !config['source-path'].startsWith('https://')) {
        errors.push({
          type: 'invalid_value',
          field: 'source-path',
          value: config['source-path'],
          message: 'Swagger 源路径必须是有效的 URL',
        });
      }
    }

    return errors;
  }

  /**
   * 验证配置是否有效
   */
  static isValid(config: Partial<Config>): boolean {
    return this.validate(config).length === 0;
  }

  /**
   * 格式化验证错误信息
   */
  static formatErrors(errors: any[]): string[] {
    return errors.map((error) => {
      let message = error.message;
      if (error.field) {
        message = `字段 ${error.field}: ${message}`;
      }
      return message;
    });
  }

  /**
   * 生成默认配置
   */
  static generateDefaultConfig(): Config {
    return {
      'apifox-project-id': '',
      'apifox-api-key': '',
      'source-type': 'code',
      'source-path': './src',
      framework: 'springboot',
      'trigger-mode': 'auto',
      'sync-mode': 'incremental',
      'scan-type': 'changed',
    };
  }

  /**
   * 合并配置
   */
  static mergeConfigs(baseConfig: Config, overrideConfig: Partial<Config>): Config {
    return {
      ...baseConfig,
      ...overrideConfig,
    };
  }
}

export default ConfigValidator;
