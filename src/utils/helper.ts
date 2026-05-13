/**
 * 通用辅助函数
 */

// 检查字符串是否包含中文字符
export function containsChinese(str: string): boolean {
  return /[一-鿿]/.test(str);
}

// 转换为驼峰命名
export function convertToCamelCase(name: string): string {
  return name
    .replace(/[-_]([a-z])/g, (match, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (match) => match.toUpperCase());
}

// 获取默认接口摘要
export function getDefaultSummary(path: string, method: string): string {
  const methodMap: Record<string, string> = {
    get: '查询',
    post: '新增',
    put: '更新',
    delete: '删除',
    patch: '修改',
  };

  const resource =
    path
      .split('/')
      .filter((part) => part && !part.startsWith('{'))
      .pop() || '数据';
  return `${methodMap[method.toLowerCase()] || '操作'}${resource}`;
}

// 获取默认参数描述
export function getDefaultParamDescription(paramName: string): string {
  return `${convertToCamelCase(paramName)}参数`;
}

// 获取默认属性描述
export function getDefaultPropDescription(propName: string): string {
  return `${convertToCamelCase(propName)}字段`;
}

// 获取默认响应描述
export function getDefaultResponseDescription(statusCode: string): string {
  const statusMap: Record<string, string> = {
    '200': '成功',
    '201': '创建成功',
    '204': '删除成功',
    '400': '请求参数错误',
    '401': '未授权',
    '403': '禁止访问',
    '404': '资源不存在',
    '500': '服务器错误',
  };

  return statusMap[statusCode] || '响应';
}

// 规范化路径
export function normalizePath(path: string): string {
  return path.replace(/\/$/, '');
}

// 网络请求重试函数
export async function retryRequest<T>(
  requestFn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await requestFn();
    } catch (error: any) {
      const isRetryable = !error.response || (error.response.status >= 500 && error.response.status < 600);
      if (isRetryable && attempt < retries) {
        console.warn(`请求失败 (尝试 ${attempt}/${retries})，${delay}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }

  throw new Error('请求失败：已达到最大重试次数');
}
