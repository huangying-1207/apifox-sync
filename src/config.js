const fs = require('fs');
const path = require('path');
const ErrorHandler = require('./utils/errorHandler');
const ConfigValidator = require('./utils/configValidator');

class ConfigManager {
    constructor() {
        this.config = null;
        this.configPath = null;
    }

    /**
     * 验证配置的完整性和正确性
     */
    validateConfig() {
        if (!this.config) {
            return null;
        }

        const validationErrors = ConfigValidator.validate(this.config);

        if (validationErrors.length > 0) {
            console.warn('配置验证失败：');
            validationErrors.forEach(error => {
                console.warn(`- ${error.message}`);
            });
            return validationErrors;
        }

        return null;
    }

    /**
     * 查找配置文件
     */
    findConfigFile() {
        const possiblePaths = [
            path.join(process.cwd(), '.apifoxsync.json'),
            path.join(process.cwd(), '.claude', 'apifoxsync.json'),
            path.join(process.cwd(), 'config', 'apifoxsync.json'),
            path.join(process.env.HOME || process.env.USERPROFILE, '.apifoxsync.json')
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
    readConfig() {
        try {
            if (!this.configPath && !this.findConfigFile()) {
                console.log('未找到配置文件，将使用命令行参数');
                return null;
            }

            const configContent = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configContent);

            // 验证配置
            const validationErrors = this.validateConfig();
            if (validationErrors) {
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
        } catch (error) {
            ErrorHandler.handleFileError(error, this.configPath);
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
    getConfig(key, defaultValue = null) {
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
    createDefaultConfig() {
        const defaultConfig = ConfigValidator.generateDefaultConfig();
        const defaultPath = path.join(process.cwd(), '.apifoxsync.json');
        fs.writeFileSync(defaultPath, JSON.stringify(defaultConfig, null, 2));
        console.log(`已创建默认配置文件: ${defaultPath}`);
        return defaultPath;
    }
}

module.exports = new ConfigManager();