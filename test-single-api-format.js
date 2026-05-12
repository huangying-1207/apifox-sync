
const { ApiScanner } = require('./dist/core/scanner/ApiScanner');
const ApiFormatter = require('./dist/modules/formatter').default;

async function test() {
  const scanner = new ApiScanner();
  const formatter = new ApiFormatter();
  const sourcePath = 'D:\\IDEA\\simple-spring-boot';

  console.log('正在扫描 Java 类文件...');
  const classSchemas = scanner.scanJavaClasses(sourcePath);
  console.log('UserDTO 字段:', classSchemas['UserDTO'] || '未找到 UserDTO');

  console.log('\n正在扫描代码中的接口...');
  const detectedApis = await scanner.scanCodeForChanges(sourcePath, 'springboot');
  console.log('扫描到的接口数量:', detectedApis.length);

  console.log('\n接口详情:');
  detectedApis.forEach((api, index) => {
    console.log(`\n接口 ${index + 1}:`);
    console.log(`  路径: ${api.path}`);
    console.log(`  方法: ${api.method}`);
    console.log(`  控制器: ${api.controller}`);
    console.log(`  请求体类型: ${api.requestBodyType}`);
    console.log(`  返回类型: ${api.returnType}`);
    console.log(`  基础类型: ${api.baseType}`);
    if (api.mapFields) {
      console.log(`  Map 字段: ${JSON.stringify(api.mapFields)}`);
    }
  });

  const postApi = detectedApis.find(api => api.method === 'post' && api.path.includes('/api/users'));
  if (!postApi) {
    console.log('\n未找到 POST /api/users 接口');
    return;
  }

  console.log('\n=== POST /api/users 接口详情 ===');
  console.log(postApi);

  console.log('\n=== 设置 DTO 模式 ===');
  formatter.setDtoSchemas(classSchemas);

  console.log('\n=== 生成单个接口的文档 ===');
  const singleApiDoc = formatter.generateApiDocFromCode([postApi]);
  console.log(JSON.stringify(singleApiDoc, null, 2));
}

test().catch(err => {
  console.error('测试失败:', err);
});
