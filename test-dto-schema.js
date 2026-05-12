
const { ApiScanner } = require('./dist/core/scanner/ApiScanner');

async function test() {
  const scanner = new ApiScanner();
  const sourcePath = 'D:\\IDEA\\simple-spring-boot';

  console.log('正在扫描 Java 类文件...');
  const classSchemas = scanner.scanJavaClasses(sourcePath);
  console.log('扫描到的类定义数量:', Object.keys(classSchemas).length);
  console.log('扫描到的类定义:');
  Object.keys(classSchemas).forEach(className => {
    console.log(`\n${className}:`);
    Object.keys(classSchemas[className]).forEach(fieldName => {
      console.log(`  ${fieldName}: ${classSchemas[className][fieldName]}`);
    });
  });

  console.log('\n\nUserDTO 字段:', classSchemas['UserDTO'] || '未找到 UserDTO');
}

test().catch(err => {
  console.error('测试失败:', err);
});
