/**
 * 通用辅助函数
 */

// 检查字符串是否包含中文字符
function containsChinese(str) {
  return /[一-鿿]/.test(str);
}

// 转换为驼峰命名
function convertToCamelCase(name) {
  return name.replace(/[-_]([a-z])/g, (match, letter) => letter.toUpperCase())
             .replace(/^[a-z]/, match => match.toUpperCase());
}

// 获取默认接口摘要
function getDefaultSummary(path, method) {
  const methodMap = {
    'get': '查询',
    'post': '新增',
    'put': '更新',
    'delete': '删除',
    'patch': '修改'
  };

  const resource = path.split('/').filter(part => part && !part.startsWith('{')).pop() || '数据';
  return `${methodMap[method.toLowerCase()] || '操作'}${resource}`;
}

// 获取默认参数描述
function getDefaultParamDescription(paramName) {
  return `${convertToCamelCase(paramName)}参数`;
}

// 获取默认属性描述
function getDefaultPropDescription(propName) {
  return `${convertToCamelCase(propName)}字段`;
}

// 获取默认响应描述
function getDefaultResponseDescription(statusCode) {
  const statusMap = {
    '200': '成功',
    '201': '创建成功',
    '204': '删除成功',
    '400': '请求参数错误',
    '401': '未授权',
    '403': '禁止访问',
    '404': '资源不存在',
    '500': '服务器错误'
  };

  return statusMap[statusCode] || '响应';
}

// 规范化路径
function normalizePath(path) {
  return path.replace(/\/$/, '');
}

// 导出所有辅助函数
module.exports = {
  containsChinese,
  convertToCamelCase,
  getDefaultSummary,
  getDefaultParamDescription,
  getDefaultPropDescription,
  getDefaultResponseDescription,
  normalizePath
};
