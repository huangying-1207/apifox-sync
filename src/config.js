const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor() {
        this.config = null;
        this.configPath = null;
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
            return this.config;
        } catch (error) {
            console.error('读取配置文件失败:', error.message);
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
        const defaultConfig = {
            "apifox-project-id": "",
            "apifox-api-key": "",
            "source-type": "code",
            "source-path": "./src",
            "framework": "springboot",
            "trigger-mode": "auto",
            "sync-mode": "incremental",
            "scan-type": "changed"
        };

        const defaultPath = path.join(process.cwd(), '.apifoxsync.json');
        fs.writeFileSync(defaultPath, JSON.stringify(defaultConfig, null, 2));
        console.log(`已创建默认配置文件: ${defaultPath}`);
        return defaultPath;
    }
}

module.exports = new ConfigManager();