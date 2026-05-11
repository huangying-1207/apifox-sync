const axios = require('axios');

// 从 .apifox-credentials.json 中获取连接信息
const fs = require('fs');
const path = require('path');
const credentialsPath = path.join(__dirname, '.apifox-credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
const simpleSpringBoot = credentials['simple-spring-boot'];

console.log('项目连接信息:');
console.log('项目ID:', simpleSpringBoot.projectId);
console.log('API密钥:', simpleSpringBoot.apiKey);
console.log('');

// 测试获取项目信息的 API
console.log('=== 测试获取项目信息的 API ===');
axios.get(`https://api.apifox.com/v1/projects/${simpleSpringBoot.projectId}/info`, {
  headers: {
    'Authorization': `Bearer ${simpleSpringBoot.apiKey}`,
    'Content-Type': 'application/json',
    'X-Apifox-Api-Version': '2024-03-28'
  },
  timeout: 60000
})
.then(response => {
  console.log('响应状态码:', response.status);
  console.log('响应数据类型:', typeof response.data);
  console.log('响应数据:');
  console.log(response.data);
  console.log('');

  // 测试获取项目成员的 API
  console.log('=== 测试获取项目成员的 API ===');
  return axios.get(`https://api.apifox.com/v1/projects/${simpleSpringBoot.projectId}/members`, {
    headers: {
      'Authorization': `Bearer ${simpleSpringBoot.apiKey}`,
      'Content-Type': 'application/json',
      'X-Apifox-Api-Version': '2024-03-28'
    },
    timeout: 60000
  });
})
.then(response => {
  console.log('响应状态码:', response.status);
  console.log('响应数据类型:', typeof response.data);
  console.log('响应数据:');
  console.log(response.data);
  console.log('');

  // 检查响应数据是否是数组
  console.log('响应数据是否是数组:', Array.isArray(response.data));
  if (!Array.isArray(response.data)) {
    console.log('响应数据的所有键:');
    console.log(Object.keys(response.data));
  }
})
.catch(error => {
  console.error('请求失败:', error.message);
  if (error.response) {
    console.error('响应状态码:', error.response.status);
    console.error('响应数据:');
    console.error(error.response.data);
  }
});