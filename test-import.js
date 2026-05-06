
const axios = require('axios');
const config = require('./src/config').readConfig();
const fs = require('fs');
const path = require('path');

async function testImport() {
    try {
        const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'temp', 'formatted-api-doc.json'), 'utf8'));

        const endpoints = [
            `https://api.apifox.cn/api/v1/projects/${config['apifox-project-id']}/import`,
            `https://api.apifox.cn/v1/projects/${config['apifox-project-id']}/import`,
            `https://api.apifox.com/api/v1/projects/${config['apifox-project-id']}/import`,
            `https://api.apifox.com/v1/projects/${config['apifox-project-id']}/import`
        ];

        for (let i = 0; i < endpoints.length; i++) {
            try {
                console.log(`Testing endpoint ${i + 1}:`, endpoints[i]);
                const response = await axios.post(endpoints[i], {
                    data: JSON.stringify(doc),
                    format: 'openapi',
                    options: {
                        updateExisting: true,
                        deleteMissing: true,
                        mergeMode: 'smart',
                        importDescription: true,
                        importExamples: true
                    }
                }, {
                    headers: {
                        'Authorization': 'Bearer ' + config['apifox-api-key'],
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000,
                    maxRedirects: 0
                });

                console.log('Success:', JSON.stringify(response.data, null, 2));
                break;
            } catch (error) {
                console.error('Endpoint failed:', error.response?.status || error.code, error.response?.data || error.message);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testImport();
