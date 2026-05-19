import { normalizePath } from '../utils/helper';
import { ApiInfo } from '../types';

class ApiComparer {
  public scanResults: {
    added: ApiInfo[];
    updated: ApiInfo[];
    removed: ApiInfo[];
  };

  constructor() {
    this.scanResults = {
      added: [],
      updated: [],
      removed: [],
    };
  }

  /**
   * 比较接口变化
   * @param incremental 是否增量模式，增量模式下只对检测到的 Controller 范围内做删除判定
   */
  compareApiChanges(detectedApis: ApiInfo[], existingApis: ApiInfo[], incremental: boolean = false): any {
    console.log('正在比较接口变化...');

    const detectedMap = new Map<string, ApiInfo>();
    detectedApis.forEach((api) => {
      const normalizedPath = normalizePath(api.path);
      detectedMap.set(`${api.method}:${normalizedPath}`, api);
    });

    const existingMap = new Map<string, ApiInfo>();
    existingApis.forEach((api) => {
      const normalizedPath = normalizePath(api.path);
      existingMap.set(`${api.method.toLowerCase()}:${normalizedPath}`, api);
    });

    // 查找新增接口
    detectedApis.forEach((api) => {
      const normalizedPath = normalizePath(api.path);
      if (!existingMap.has(`${api.method}:${normalizedPath}`)) {
        this.scanResults.added.push(api);
      }
    });

    // 查找已删除接口
    // 增量模式下，只对本次扫描覆盖的 Controller 范围内判定删除，避免未扫描的接口被误判
    const scannedControllers = new Set(detectedApis.map((api) => api.controller).filter(Boolean) as string[]);
    existingApis.forEach((api) => {
      const normalizedPath = normalizePath(api.path);
      if (!detectedMap.has(`${api.method.toLowerCase()}:${normalizedPath}`)) {
        if (incremental && !scannedControllers.has(api.controller || '')) {
          return; // 增量模式下跳过未扫描的 Controller
        }
        this.scanResults.removed.push(api);
      }
    });

    // 查找已更新接口（比较详细信息）
    detectedApis.forEach((api) => {
      const normalizedPath = normalizePath(api.path);
      if (existingMap.has(`${api.method}:${normalizedPath}`)) {
        const existingApi = existingMap.get(`${api.method}:${normalizedPath}`);

        // 比较接口的详细信息
        const hasChanges = this.compareApiDetails(api, existingApi!);
        if (hasChanges) {
          this.scanResults.updated.push(api);
        }
      }
    });

    console.log(
      `接口变化统计: 新增 ${this.scanResults.added.length}, 更新 ${this.scanResults.updated.length}, 删除 ${this.scanResults.removed.length}`,
    );
    this.outputChangeDetails(detectedApis, existingApis);

    return this.scanResults;
  }

  /**
   * 比较接口的详细信息
   */
  compareApiDetails(detectedApi: ApiInfo, existingApi: ApiInfo): boolean {
    let hasChanges = false;

    // 比较路径参数
    const detectedParams = detectedApi.path.match(/\{[^}]+\}/g) || [];
    const existingParams = existingApi.path.match(/\{[^}]+\}/g) || [];
    if (detectedParams.length !== existingParams.length) {
      hasChanges = true;
    } else {
      const detectedParamSet = new Set(detectedParams.map((p) => p.replace(/[{}]/g, '')));
      const existingParamSet = new Set(existingParams.map((p) => p.replace(/[{}]/g, '')));
      const paramDiff = [...detectedParamSet]
        .filter((x) => !existingParamSet.has(x))
        .concat([...existingParamSet].filter((x) => !detectedParamSet.has(x)));
      if (paramDiff.length > 0) {
        hasChanges = true;
      }
    }

    // 比较接口的其他属性（如方法、路径等）
    if (detectedApi.method !== existingApi.method) {
      hasChanges = true;
    }

    if (normalizePath(detectedApi.path) !== normalizePath(existingApi.path)) {
      hasChanges = true;
    }

    // 比较接口的参数列表
    if (detectedApi.parameters && existingApi.parameters) {
      const detectedParamNames = new Set(detectedApi.parameters.map((p) => p.name));
      const existingParamNames = new Set(existingApi.parameters!.map((p) => p.name));
      const paramDiff = [...detectedParamNames]
        .filter((x) => !existingParamNames.has(x))
        .concat([...existingParamNames].filter((x) => !detectedParamNames.has(x)));
      if (paramDiff.length > 0) {
        hasChanges = true;
      }
    } else if (detectedApi.parameters || existingApi.parameters) {
      hasChanges = true;
    }

    // 比较接口的响应内容（如果有的话）
    if (detectedApi.returnType && existingApi.returnType && detectedApi.returnType !== existingApi.returnType) {
      // OpenAPI 导出的类型可能是通用的 object/array，Java 扫描器提取的是具体类型
      // object 是最通用的 OpenAPI 类型，可代表任何 Java 类型，不算实际变更
      const javaToOpenApiTypeMap: Record<string, string> = {
        String: 'string',
        Integer: 'integer',
        Long: 'integer',
        Double: 'number',
        Float: 'number',
        Boolean: 'boolean',
        Object: 'object',
        int: 'integer',
        long: 'integer',
        double: 'number',
        float: 'number',
        boolean: 'boolean',
      };
      const detectedNormalized = javaToOpenApiTypeMap[detectedApi.returnType] || detectedApi.returnType.toLowerCase();
      const existingNormalized = existingApi.returnType.toLowerCase();

      const isExistingGeneric = existingNormalized === 'object' || existingNormalized === 'array';
      const isTypeMappingMatch = javaToOpenApiTypeMap[detectedApi.returnType] === existingNormalized;

      if (!isExistingGeneric && !isTypeMappingMatch && detectedNormalized !== existingNormalized) {
        hasChanges = true;
      }
    }

    // 比较响应字段
    if (detectedApi.responseFields && existingApi.responseFields) {
      const detectedFieldSet = new Set(detectedApi.responseFields);
      const existingFieldSet = new Set(existingApi.responseFields);
      const addedFields = [...detectedFieldSet].filter((x) => !existingFieldSet.has(x));
      const removedFields = [...existingFieldSet].filter((x) => !detectedFieldSet.has(x));
      if (addedFields.length > 0 || removedFields.length > 0) {
        hasChanges = true;
      }
    } else if (detectedApi.responseFields?.length && !existingApi.responseFields?.length) {
      // 代码有响应字段但 Apifox 没有，可能是新接口或字段
      hasChanges = true;
    }

    return hasChanges;
  }

  /**
   * 输出接口变化详细信息（按类分组）
   */
  outputChangeDetails(detectedApis: ApiInfo[], existingApis: ApiInfo[]): void {
    console.log('\n=== 接口变化详细信息 ===');

    // 创建快速查找的映射
    const existingMap = new Map<string, ApiInfo>();
    existingApis.forEach((api) => {
      const normalizedPath = normalizePath(api.path);
      existingMap.set(`${api.method.toLowerCase()}:${normalizedPath}`, api);
    });

    // 按类（controller）分组所有变更
    interface GroupedChange {
      added: ApiInfo[];
      updated: ApiInfo[];
      removed: ApiInfo[];
    }
    const byController = new Map<string, GroupedChange>();

    const getGroup = (controller: string): GroupedChange => {
      if (!byController.has(controller)) {
        byController.set(controller, { added: [], updated: [], removed: [] });
      }
      return byController.get(controller)!;
    };

    this.scanResults.added.forEach((api) => {
      getGroup(api.controller || '未知类').added.push(api);
    });
    this.scanResults.updated.forEach((api) => {
      getGroup(api.controller || '未知类').updated.push(api);
    });
    this.scanResults.removed.forEach((api) => {
      getGroup(api.controller || '未知类').removed.push(api);
    });

    if (byController.size === 0) {
      console.log('');
      return;
    }

    // 先输出汇总统计
    const totalAdded = this.scanResults.added.length;
    const totalUpdated = this.scanResults.updated.length;
    const totalRemoved = this.scanResults.removed.length;
    console.log(`共 ${byController.size} 个类受到影响：新增 ${totalAdded}, 更新 ${totalUpdated}, 删除 ${totalRemoved}`);

    // 按类逐一输出
    byController.forEach((changes, controller) => {
      const count = changes.added.length + changes.updated.length + changes.removed.length;
      console.log(`\n📁 ${controller} (${count} 个变更)`);

      if (changes.added.length > 0) {
        changes.added.forEach((api) => {
          console.log(`  ✚ ${api.method.toUpperCase()} ${api.path}`);
        });
      }

      if (changes.updated.length > 0) {
        changes.updated.forEach((api) => {
          const normalizedPath = normalizePath(api.path);
          const existingApi = existingMap.get(`${api.method}:${normalizedPath}`);

          console.log(`  ⭐ ${api.method.toUpperCase()} ${api.path}`);
          if (existingApi) {
            this.outputApiChangeDetails(api, existingApi);
          }
        });
      }

      if (changes.removed.length > 0) {
        changes.removed.forEach((api) => {
          console.log(`  ✖ ${api.method.toUpperCase()} ${api.path}`);
        });
      }
    });

    console.log('');
  }

  /**
   * 输出接口内容的变更详情
   */
  outputApiChangeDetails(detectedApi: ApiInfo, existingApi: ApiInfo): void {
    const changes: string[] = [];

    // 比较路径参数
    const detectedParams = detectedApi.path.match(/\{[^}]+\}/g) || [];
    const existingParams = existingApi.path.match(/\{[^}]+\}/g) || [];
    if (detectedParams.length !== existingParams.length) {
      changes.push(`参数数量: 从 ${existingParams.length} 变为 ${detectedParams.length}`);
    } else {
      const detectedParamSet = new Set(detectedParams.map((p) => p.replace(/[{}]/g, '')));
      const existingParamSet = new Set(existingParams.map((p) => p.replace(/[{}]/g, '')));
      const paramDiff = [...detectedParamSet]
        .filter((x) => !existingParamSet.has(x))
        .concat([...existingParamSet].filter((x) => !detectedParamSet.has(x)));
      if (paramDiff.length > 0) {
        changes.push(`参数变更: ${paramDiff.join(', ')}`);
      }
    }

    // 比较接口的其他属性（如方法、路径等）
    if (detectedApi.method !== existingApi.method) {
      changes.push(`方法: 从 ${existingApi.method.toUpperCase()} 变为 ${detectedApi.method.toUpperCase()}`);
    }

    if (detectedApi.path !== existingApi.path) {
      changes.push(`路径: 从 ${existingApi.path} 变为 ${detectedApi.path}`);
    }

    // 比较接口的参数列表
    if (detectedApi.parameters && existingApi.parameters) {
      const detectedParamNames = new Set(detectedApi.parameters.map((p) => p.name));
      const existingParamNames = new Set(existingApi.parameters!.map((p) => p.name));

      const addedParams = [...detectedParamNames].filter((x) => !existingParamNames.has(x));
      const removedParams = [...existingParamNames].filter((x) => !detectedParamNames.has(x));

      if (addedParams.length > 0) {
        changes.push(`新增参数: ${addedParams.join(', ')}`);
      }

      if (removedParams.length > 0) {
        changes.push(`删除参数: ${removedParams.join(', ')}`);
      }
    } else if (detectedApi.parameters || existingApi.parameters) {
      if (detectedApi.parameters) {
        changes.push(`新增参数: ${detectedApi.parameters.map((p) => p.name).join(', ')}`);
      } else {
        changes.push(`删除参数: ${existingApi.parameters!.map((p) => p.name).join(', ')}`);
      }
    }

    // 比较接口的响应内容（如果有的话）
    if (detectedApi.returnType && existingApi.returnType && detectedApi.returnType !== existingApi.returnType) {
      changes.push(`返回类型: 从 ${existingApi.returnType} 变为 ${detectedApi.returnType}`);
    }

    // 比较接口的描述
    if (detectedApi.controller && existingApi.controller && detectedApi.controller !== existingApi.controller) {
      changes.push(`控制器: 从 ${existingApi.controller} 变为 ${detectedApi.controller}`);
    }

    // 比较响应字段
    if (detectedApi.responseFields && existingApi.responseFields) {
      const detectedFieldSet = new Set(detectedApi.responseFields);
      const existingFieldSet = new Set(existingApi.responseFields);
      const addedFields = [...detectedFieldSet].filter((x) => !existingFieldSet.has(x));
      const removedFields = [...existingFieldSet].filter((x) => !detectedFieldSet.has(x));

      if (addedFields.length > 0) {
        changes.push(`新增响应字段: ${addedFields.join(', ')}`);
      }

      if (removedFields.length > 0) {
        changes.push(`删除响应字段: ${removedFields.join(', ')}`);
      }
    } else if (detectedApi.responseFields?.length && !existingApi.responseFields?.length) {
      changes.push(`新增响应字段: ${detectedApi.responseFields.join(', ')}`);
    }

    // 输出变更详情
    if (changes.length > 0) {
      console.log(`    变更详情:`);
      changes.forEach((change) => {
        console.log(`      - ${change}`);
      });
    }
  }
}

export default ApiComparer;
