const axios = require('axios');

async function getApiDetails() {
    const baseUrl = 'https://api.apifox.com';
    const projectId = '8216636';
    const apiKey = 'afxp_b1f13cirg7pkYgT4N6YtaBZLsZ5eVVKXR13e';

    console.log('正在从 Apifox 导出完整接口文档...');

    try {
        const response = await axios.post(`${baseUrl}/v1/projects/${projectId}/export-openapi`, {
            scope: {
                type: 'ALL'
            },
            options: {
                includeApifoxExtensionProperties: true,
                addFoldersToTags: false
            },
            oasVersion: '3.1',
            exportFormat: 'JSON'
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-Apifox-Api-Version': '2024-03-28'
            },
            timeout: 60000
        });

        if (!response.data || typeof response.data === 'string') {
            console.error('未获取到有效的接口文档');
            return;
        }

        const openApiDoc = response.data;

        console.log('\n=== 接口文档获取成功 ===');
        console.log(`API 文档版本: ${openApiDoc.openapi}`);
        console.log(`项目标题: ${openApiDoc.info.title}`);
        console.log(`项目版本: ${openApiDoc.info.version}`);

        // 查找 / 接口
        if (openApiDoc.paths && openApiDoc.paths['/']) {
            console.log('\n=== 找到 / 接口 ===');

            const pathItem = openApiDoc.paths['/'];

            // 遍历所有 HTTP 方法
            Object.keys(pathItem).forEach(method => {
                console.log(`\n--- ${method.toUpperCase()} / ---`);

                const operation = pathItem[method];

                // 显示接口基本信息
                if (operation.summary) {
                    console.log(`摘要: ${operation.summary}`);
                }
                if (operation.description) {
                    console.log(`描述: ${operation.description}`);
                }

                // 显示参数信息
                if (operation.parameters) {
                    console.log(`\n参数: (${operation.parameters.length} 个)`);
                    operation.parameters.forEach(param => {
                        const required = param.required ? '必填' : '可选';
                        console.log(`  ${param.name} (${required})`);
                        console.log(`    位置: ${param.in}`);
                        console.log(`    类型: ${param.schema?.type}`);
                        if (param.description) {
                            console.log(`    描述: ${param.description}`);
                        }
                    });
                }

                // 显示请求体
                if (operation.requestBody) {
                    console.log(`\n请求体:`);
                    if (operation.requestBody.description) {
                        console.log(`  ${operation.requestBody.description}`);
                    }

                    const contentTypes = Object.keys(operation.requestBody.content);
                    contentTypes.forEach(contentType => {
                        console.log(`\n  内容类型: ${contentType}`);

                        const mediaType = operation.requestBody.content[contentType];
                        if (mediaType.schema) {
                            console.log(`  数据类型: ${mediaType.schema.type}`);

                            if (mediaType.schema.properties) {
                                console.log(`  字段: ${Object.keys(mediaType.schema.properties).length} 个`);
                                Object.keys(mediaType.schema.properties).forEach(propName => {
                                    const prop = mediaType.schema.properties[propName];
                                    const required = mediaType.schema.required?.includes(propName) ? '必填' : '可选';
                                    console.log(`    ${propName} (${required})`);
                                    console.log(`      类型: ${prop.type}`);
                                    if (prop.description) {
                                        console.log(`      描述: ${prop.description}`);
                                    }
                                });
                            }
                        }
                    });
                }

                // 显示响应信息
                if (operation.responses) {
                    console.log(`\n响应: ${Object.keys(operation.responses).length} 个`);
                    Object.keys(operation.responses).forEach(statusCode => {
                        const response = operation.responses[statusCode];
                        console.log(`  ${statusCode}: ${response.description}`);

                        if (response.content && response.content['application/json']) {
                            const schema = response.content['application/json'].schema;
                            if (schema?.properties) {
                                console.log(`    响应字段: ${Object.keys(schema.properties).length} 个`);
                            }
                        }
                    });
                }
            });
        } else {
            console.log('\n未找到 / 接口');
            console.log(`\n项目中包含的接口路径: ${Object.keys(openApiDoc.paths).join(', ')}`);
        }

        // 保存文档到文件
        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname, 'apifox-full-api-doc.json');
        fs.writeFileSync(outputPath, JSON.stringify(openApiDoc, null, 2));
        console.log(`\n完整文档已保存到: ${outputPath}`);

    } catch (error) {
        console.error('获取接口文档失败');
        if (error.response) {
            console.error(`状态码: ${error.response.status}`);
            console.error(`响应数据: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`错误信息: ${error.message}`);
        }
    }
}

getApiDetails();