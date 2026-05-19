/**
 * 依赖图构建与反向追踪引擎
 * 从变更点沿继承树和调用链反向追踪到 Controller
 */

import fs from 'fs';
import path from 'path';
import { sync as globSync } from 'glob';
import { ClassInfo, MethodInfo, FieldChange, ChangePoint, AffectedControllerMethod } from '../../types';

interface CallEdge {
  callerClass: string;
  callerMethod: string;
}

export class DependencyGraph {
  private static readonly JAVA_BUILTIN_TYPES = [
    'ArrayList',
    'HashMap',
    'HashSet',
    'LinkedList',
    'TreeMap',
    'TreeSet',
    'String',
    'Integer',
    'Long',
    'Double',
    'Float',
    'Boolean',
    'Object',
    'Date',
    'LinkedHashMap',
    'StringBuilder',
    'StringBuffer',
    'BigInteger',
    'BigDecimal',
    'JSONObject',
    'JSONArray',
    'Response',
    'Page',
    'CompletableFuture',
    'Optional',
    'Tuple',
    'Thread',
    'Runnable',
    'File',
    'InputStream',
    'OutputStream',
    'IOException',
    'Exception',
    'RuntimeException',
    'IllegalArgumentException',
    'ArrayList',
    'byte[]',
    'Byte',
  ];

  private classIndex: Map<string, ClassInfo> = new Map();
  private inheritanceTree: Map<string, Set<string>> = new Map();
  private reverseCallGraph: Map<string, Set<CallEdge>> = new Map();

  build(sourcePath: string): boolean {
    try {
      this.buildClassIndex(sourcePath);
      if (this.classIndex.size === 0) {
        console.warn('DependencyGraph: 未找到 Java 类');
        return false;
      }
      this.buildInheritanceTree();
      this.buildCallGraph();
      console.log(
        `依赖图构建完成: ${this.classIndex.size} 个类, ` +
          `${this.inheritanceTree.size} 条继承边, ` +
          `${this.reverseCallGraph.size} 条调用边`,
      );
      return true;
    } catch (error: any) {
      console.warn('依赖图构建失败:', error.message || error);
      return false;
    }
  }

  getClassIndex(): Map<string, ClassInfo> {
    return this.classIndex;
  }

  getDescendants(className: string): Set<string> {
    const result = new Set<string>();
    const queue = [className];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (result.has(current)) continue;
      result.add(current);
      const children = this.inheritanceTree.get(current);
      if (children) {
        for (const child of children) {
          if (!result.has(child)) queue.push(child);
        }
      }
    }
    result.delete(className);
    return result;
  }

  getAncestors(className: string): Set<string> {
    const result = new Set<string>();
    const classInfo = this.classIndex.get(className);
    if (!classInfo) return result;

    const queue: string[] = [];
    if (classInfo.extendsClass) queue.push(classInfo.extendsClass);
    queue.push(...classInfo.implementsInterfaces);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (result.has(current)) continue;
      result.add(current);
      const parent = this.classIndex.get(current);
      if (parent) {
        if (parent.extendsClass) queue.push(parent.extendsClass);
        queue.push(...parent.implementsInterfaces);
      }
    }
    return result;
  }

  /**
   * 检测方法级变更：通过 git diff 中的 @@ hunks 定位实际变更的方法名
   */
  detectMethodLevelChanges(projectRoot: string, changedFiles: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>(); // className -> changed method names
    const nonControllerFiles = changedFiles.filter((f) => f.endsWith('.java') && !f.match(/Controller\.java$/));

    for (const file of nonControllerFiles) {
      const relativePath = path.relative(projectRoot, file).replace(/\\/g, '/');
      const className = path.basename(file, '.java');

      const diffOutput = this.getGitDiff(projectRoot, relativePath);

      if (!diffOutput) {
        // 无法 diff 的文件，标记为整个类变更
        result.set(className, []);
        continue;
      }

      // 从 diff hunks 中提取变更行号附近的方法名
      const changedMethods = new Set<string>();
      const classInfo = this.classIndex.get(className);
      if (!classInfo) continue;

      // 解析 @@ -a,b +c,d @@ 格式的 hunk header
      const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm;
      let hunkMatch;
      while ((hunkMatch = hunkPattern.exec(diffOutput)) !== null) {
        const newFileLine = parseInt(hunkMatch[1], 10);

        // 找到这个行号所在的方法
        const methodInfo = this.findMethodAtLine(classInfo, newFileLine);
        if (methodInfo) {
          changedMethods.add(methodInfo);
        }
      }

      // 也从 +- 行中匹配方法签名变更
      const methodSigInDiff = /^[+-]\s*(?:public|protected|private)\s+\S+\s+(\w+)\s*\(/gm;
      let sigMatch;
      while ((sigMatch = methodSigInDiff.exec(diffOutput)) !== null) {
        const methodName = sigMatch[1];
        // 排除构造函数（类名 == 方法名）
        if (methodName !== className) {
          changedMethods.add(methodName);
        }
      }

      if (changedMethods.size > 0) {
        result.set(className, [...changedMethods]);
      } else if (diffOutput.length > 0) {
        // 有 diff 但没匹配到方法 → 类级变更
        result.set(className, []);
      }
    }

    return result;
  }

  /**
   * 根据行号找到方法名（基于类索引中的方法位置信息）
   */
  private findMethodAtLine(classInfo: ClassInfo, targetLine: number): string | null {
    // 需要重新读取文件来获取行号映射
    try {
      const content = fs.readFileSync(classInfo.file, 'utf8');

      // 扫描方法声明并记录行号
      const methodPositions: Array<{ name: string; startLine: number; endLine: number }> = [];
      const methodSigPattern =
        /(?:public|protected|private)\s+(?:\S+\s+)?(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/g;
      let sigMatch;
      while ((sigMatch = methodSigPattern.exec(content)) !== null) {
        const methodName = sigMatch[1];
        const startLine = content.slice(0, sigMatch.index).split('\n').length;
        const methodEnd = this.findMethodEnd(content, sigMatch.index);
        const endLine = content.slice(0, methodEnd).split('\n').length;
        methodPositions.push({ name: methodName, startLine, endLine });
      }

      // 找到包含目标行号的方法
      for (const mp of methodPositions) {
        if (targetLine >= mp.startLine && targetLine <= mp.endLine) {
          // 排除构造函数
          if (mp.name !== classInfo.name) {
            return mp.name;
          }
        }
      }
    } catch (_error: any) {
      // 文件读取失败
    }

    return null;
  }

  /**
   * 获取文件的 git diff 输出，按优先级尝试多种 diff 策略
   * 1. git diff HEAD (工作目录 vs 最新提交)
   * 2. git diff --cached + git diff (暂存区 vs HEAD + 工作目录 vs 暂存区)
   */
  private getGitDiff(projectRoot: string, relativePath: string): string {
    const childProcess = require('child_process');

    // 策略1：工作目录 vs HEAD（覆盖 staged + unstaged 变更）
    try {
      const r = childProcess.spawnSync('git', ['diff', 'HEAD', '--', relativePath], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      if (!r.error && r.stdout && r.stdout.trim().length > 0) {
        return r.stdout;
      }
    } catch (_e: any) {
      // fall through
    }

    // 策略2：分别获取 staged 和 unstaged diff 并合并
    let combined = '';
    try {
      const cached = childProcess.spawnSync('git', ['diff', '--cached', '--', relativePath], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      if (!cached.error && cached.stdout) combined += cached.stdout;
    } catch (_e: any) {
      // ignore
    }
    try {
      const unstaged = childProcess.spawnSync('git', ['diff', '--', relativePath], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      if (!unstaged.error && unstaged.stdout) combined += unstaged.stdout;
    } catch (_e: any) {
      // ignore
    }

    return combined.trim();
  }

  detectFieldLevelChanges(projectRoot: string, changedFiles: string[]): FieldChange[] {
    const changes: FieldChange[] = [];
    const nonControllerFiles = changedFiles.filter((f) => f.endsWith('.java') && !f.match(/Controller\.java$/));

    for (const file of nonControllerFiles) {
      const relativePath = path.relative(projectRoot, file).replace(/\\/g, '/');
      const className = path.basename(file, '.java');

      let diffOutput = '';
      diffOutput = this.getGitDiff(projectRoot, relativePath);

      if (!diffOutput) {
        // 新文件或无法 diff：当前所有字段视为新增
        const classInfo = this.classIndex.get(className);
        if (classInfo && Object.keys(classInfo.fields).length > 0) {
          changes.push({
            className,
            file,
            addedFields: Object.keys(classInfo.fields),
            removedFields: [],
            changedFields: [],
          });
        }
        continue;
      }

      const fieldDeclPattern = /^[+-]\s*(?:private|protected|public)\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/;
      const addedFieldNames = new Map<string, string>();
      const removedFieldNames = new Map<string, string>();

      for (const line of diffOutput.split('\n')) {
        const match = line.match(fieldDeclPattern);
        if (!match) continue;
        const isAdd = line.startsWith('+');
        if (isAdd) {
          addedFieldNames.set(match[2], match[1]);
        } else {
          removedFieldNames.set(match[2], match[1]);
        }
      }

      const addedFields: string[] = [];
      const removedFields: string[] = [];
      const changedFields: string[] = [];

      for (const [fieldName, fieldType] of addedFieldNames) {
        if (removedFieldNames.has(fieldName)) {
          if (removedFieldNames.get(fieldName) !== fieldType) {
            changedFields.push(fieldName);
          }
          removedFieldNames.delete(fieldName);
        } else {
          addedFields.push(fieldName);
        }
      }
      for (const [fieldName] of removedFieldNames) {
        removedFields.push(fieldName);
      }

      if (addedFields.length > 0 || removedFields.length > 0 || changedFields.length > 0) {
        changes.push({ className, file, addedFields, removedFields, changedFields });
      }
    }

    return changes;
  }

  /**
   * 基于 schema 引用的受影响接口追踪
   * 追踪 DTO 字段变更对 Controller 方法的 @RequestBody / 返回类型的影响，
   * 当签名类型为"黑盒"（JSONObject/Response 等）时，沿方法体调用链查找间接引用
   */
  findSchemaAffectedControllers(changePoints: ChangePoint[], fieldChanges?: FieldChange[]): AffectedControllerMethod[] {
    const affected: AffectedControllerMethod[] = [];

    // 1. 收集所有字段级变更的 DTO 类名
    const fieldChangePoints = changePoints.filter((cp) => cp.changeType === 'field');
    if (fieldChangePoints.length === 0) return affected;

    const changedDtos = new Set<string>();
    for (const cp of fieldChangePoints) {
      // 变更 DTO 本身
      changedDtos.add(cp.className);
      // 子类（继承链）
      const descendants = this.getDescendants(cp.className);
      for (const d of descendants) {
        changedDtos.add(d);
      }
    }

    // 2. 构建 DTO 嵌入闭包：如果 A 有字段类型 B 且 B 在 changedDtos 中，则 A 也受影响
    console.log('=== 变更的 DTO 列表 ===');
    for (const dto of changedDtos) {
      console.log(`- ${dto}`);
    }
    console.log('=== 字段级变更 ===');
    if (fieldChanges) {
      for (const fc of fieldChanges) {
        console.log(`- ${fc.className}: 新增=${fc.addedFields}, 删除=${fc.removedFields}, 变更=${fc.changedFields}`);
      }
    } else {
      console.log('无字段级变更信息');
    }
    const embeddedClosure = this.buildEmbeddedClosure(changedDtos, fieldChanges);

    // 2.5. 构造调用追踪：找到方法体内 new 了受影响 DTO 的方法，沿反向调用图追踪到 Controller
    const constructorAffected = this.traceConstructorImpactedToControllers(
      embeddedClosure,
      changedDtos,
      fieldChangePoints,
      fieldChanges,
    );
    for (const ref of constructorAffected) {
      const alreadyExists = affected.some(
        (a) =>
          a.controllerClass === ref.controllerClass &&
          a.methodName === ref.methodName &&
          a.impactType === ref.impactType &&
          a.changeSource === ref.changeSource,
      );
      if (!alreadyExists) {
        affected.push(ref);
      }
    }

    // 2.6. 类型转换追踪：当 DTO 通过 JSONObject.toJSON/JSON.parseObject 等转换成其他类型且被返回时，追踪到 Controller
    const typeConversionAffected = this.traceTypeConversionAffected(changedDtos, fieldChangePoints, fieldChanges);
    for (const ref of typeConversionAffected) {
      const alreadyExists = affected.some(
        (a) =>
          a.controllerClass === ref.controllerClass &&
          a.methodName === ref.methodName &&
          a.impactType === ref.impactType &&
          a.changeSource === ref.changeSource,
      );
      if (!alreadyExists) {
        affected.push(ref);
      }
    }

    // 3. 遍历所有 Controller 类的方法，检查 requestBodyType / returnType
    for (const [className, classInfo] of this.classIndex) {
      if (!classInfo.isController) continue;

      for (const method of classInfo.methods) {
        const directRequestBody =
          method.requestBodyType && this.isTypeAffected(method.requestBodyType, embeddedClosure);
        const directResponse = method.returnType && this.isTypeAffected(method.returnType, embeddedClosure);

        // 检查 @RequestBody 是否直接引用了受影响的 DTO
        if (directRequestBody) {
          const changeSource = this.findChangeSourceForType(method.requestBodyType!, changedDtos, fieldChangePoints);
          const changeDetail = fieldChangePoints.find((cp) => cp.className === changeSource)?.changeDetail;
          affected.push({
            controllerFile: classInfo.file,
            controllerClass: classInfo.name,
            methodName: method.name,
            tracePath: [`${changeSource} 字段变更`, `→ ${className}.${method.name} 入参引用 ${method.requestBodyType}`],
            changeSource: changeSource,
            changeType: 'field',
            changeDetail,
            impactType: 'request_body',
          });
        }

        // 检查返回类型是否直接引用了受影响的 DTO
        if (directResponse) {
          const changeSource = this.findChangeSourceForType(method.returnType, changedDtos, fieldChangePoints);
          const changeDetail = fieldChangePoints.find((cp) => cp.className === changeSource)?.changeDetail;
          affected.push({
            controllerFile: classInfo.file,
            controllerClass: classInfo.name,
            methodName: method.name,
            tracePath: [`${changeSource} 字段变更`, `→ ${className}.${method.name} 响应引用 ${method.returnType}`],
            changeSource: changeSource,
            changeType: 'field',
            changeDetail,
            impactType: 'response',
          });
        }

        // 签名类型为黑盒时，沿方法体调用链查找间接引用
        const returnOpaque = !directResponse && this.isOpaqueType(method.returnType);
        const requestOpaque = !directRequestBody && this.isOpaqueType(method.requestBodyType);

        if (returnOpaque || requestOpaque) {
          const indirectRefs = this.findIndirectDtoReferences(
            classInfo,
            method,
            embeddedClosure,
            changedDtos,
            fieldChangePoints,
            fieldChanges,
          );
          for (const ref of indirectRefs) {
            const alreadyExists = affected.some(
              (a) =>
                a.controllerClass === ref.controllerClass &&
                a.methodName === ref.methodName &&
                a.impactType === ref.impactType &&
                a.changeSource === ref.changeSource,
            );
            if (!alreadyExists) {
              affected.push(ref);
            }
          }
        }
      }
    }

    return affected;
  }

  /**
   * 类型转换追踪：当变更的 DTO 被通过 JSONObject.toJSON/JSON.parseObject 等转换成其他类型，
   * 且转换结果被方法返回，则沿反向调用图追踪到 Controller，标记响应受影响。
   *
   * 优化：在追踪过程中检查每个调用者方法是否真正传递了类型转换结果
   * - 如果调用者返回类型是 void，且没有修改引用参数，则类型转换结果不会影响接口响应
   * - 只有当调用者返回了转换结果，或修改了引用参数且该参数在方法外被使用时，才继续追踪
   */
  private traceTypeConversionAffected(
    changedDtos: Set<string>,
    fieldChangePoints: ChangePoint[],
    _fieldChanges?: FieldChange[],
  ): AffectedControllerMethod[] {
    const results: AffectedControllerMethod[] = [];
    const MAX_DEPTH = 8;
    const visited: Set<string> = new Set();

    // 1. 扫描所有方法，找到包含类型转换调用且转换源变量类型是受影响 DTO 的方法
    const seedMethods: Array<{
      className: string;
      methodName: string;
      changeSource: string;
      tracePath: string[];
    }> = [];

    console.log('=== 类型转换追踪 ===');
    for (const [className, classInfo] of this.classIndex) {
      for (const method of classInfo.methods) {
        if (method.typeConversionCalls.length === 0) continue;

        for (const tc of method.typeConversionCalls) {
          // 检查源变量类型是否受影响
          const sourceBaseType = tc.sourceType.replace(/<.*>/, '');
          const isAffected = this.isTypeAffected(tc.sourceType, changedDtos) || changedDtos.has(sourceBaseType);
          if (!isAffected) continue;

          // 检查类型转换结果是否流向返回值，避免误报
          if (!tc.flowsToReturn) continue;

          // 确定变更源
          const changeSource = this.findChangeSourceForType(tc.sourceType, changedDtos, fieldChangePoints);

          // 字段级过滤：如果方法体中通过 getter/setter 访问了变更字段，或直接通过 toJSON 序列化了整个对象
          // toJSON 是对整个对象的序列化，所以不需要字段级过滤，对象的所有字段变更都会影响结果
          const key = `${className}.${method.name}|typeconv|${changeSource}`;
          if (visited.has(key)) continue;
          visited.add(key);

          seedMethods.push({
            className,
            methodName: method.name,
            changeSource,
            tracePath: [
              `${changeSource} 字段变更`,
              `→ ${className}.${method.name}() 通过 ${tc.conversionMethod}(${tc.sourceVar}) 转为 ${tc.targetTypeName}`,
            ],
          });
        }
      }
    }

    console.log(`  类型转换种子方法数: ${seedMethods.length}`);
    for (const s of seedMethods.slice(0, 10)) {
      console.log(`    种子: ${s.className}.${s.methodName} ← ${s.changeSource}`);
    }
    if (seedMethods.length > 10) {
      console.log(`    ... 以及其他 ${seedMethods.length - 10} 个种子方法`);
    }

    // 2. 从种子方法沿反向调用图 BFS 追踪到 Controller，途中检查数据流
    const queue: Array<{
      className: string;
      methodName: string;
      depth: number;
      changeSource: string;
      tracePath: string[];
    }> = seedMethods.map((s) => ({ ...s, depth: 0 }));

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth > MAX_DEPTH) continue;

      const classInfo = this.classIndex.get(current.className);
      if (!classInfo) continue;

      // 到达 Controller → 记录受影响
      if (classInfo.isController) {
        const changeDetail = fieldChangePoints.find((cp) => cp.className === current.changeSource)?.changeDetail;
        const alreadyExists = results.some(
          (r) =>
            r.controllerClass === current.className &&
            r.methodName === current.methodName &&
            r.changeSource === current.changeSource &&
            r.impactType === 'response',
        );
        if (!alreadyExists) {
          results.push({
            controllerFile: classInfo.file,
            controllerClass: current.className,
            methodName: current.methodName,
            tracePath: current.tracePath,
            changeSource: current.changeSource,
            changeType: 'field',
            changeDetail,
            impactType: 'response',
          });
        }
        continue;
      }

      // 继续沿反向调用图向上追踪，但检查调用者是否真正传递了数据流
      const callKey = `${current.className}.${current.methodName}`;
      const callers = this.reverseCallGraph.get(callKey);
      if (callers) {
        for (const edge of callers) {
          const visitedKey = `${edge.callerClass}.${edge.callerMethod}|typeconv|${current.changeSource}`;
          if (visited.has(visitedKey)) continue;

          // 检查调用者方法是否真正传递了类型转换结果
          const callerClassInfo = this.classIndex.get(edge.callerClass);
          if (!callerClassInfo) continue;

          const callerMethod = callerClassInfo.methods.find((m) => m.name === edge.callerMethod);
          if (!callerMethod) continue;

          // 检查调用者是否满足以下条件之一，才继续追踪：
          // 1. 调用者返回类型不是 void（可能返回了类型转换结果）
          // 2. 调用者有参数类型是受影响的 DTO（可能修改了引用参数）
          const returnsValue = callerMethod.returnType !== 'void';
          const hasAffectedParam = callerMethod.parameterTypes.some(
            (pt) => this.isTypeAffected(pt, changedDtos) || changedDtos.has(pt.replace(/<.*>/, '')),
          );

          if (!returnsValue && !hasAffectedParam) {
            console.log(`  跳过追踪: ${edge.callerClass}.${edge.callerMethod} 返回 void 且无受影响参数`);
            continue;
          }

          visited.add(visitedKey);
          queue.push({
            className: edge.callerClass,
            methodName: edge.callerMethod,
            depth: current.depth + 1,
            changeSource: current.changeSource,
            tracePath: [...current.tracePath, `→ 被调用 ${edge.callerClass}.${edge.callerMethod}`],
          });
        }
      }

      // 接口方法 → 也查实现类的调用者
      const children = this.inheritanceTree.get(current.className);
      if (children) {
        for (const child of children) {
          const childCallKey = `${child}.${current.methodName}`;
          const childCallers = this.reverseCallGraph.get(childCallKey);
          if (childCallers) {
            for (const edge of childCallers) {
              const visitedKey = `${edge.callerClass}.${edge.callerMethod}|typeconv|${current.changeSource}`;
              if (visited.has(visitedKey)) continue;

              // 检查调用者方法是否真正传递了类型转换结果
              const callerClassInfo = this.classIndex.get(edge.callerClass);
              if (!callerClassInfo) continue;

              const callerMethod = callerClassInfo.methods.find((m) => m.name === edge.callerMethod);
              if (!callerMethod) continue;

              const returnsValue = callerMethod.returnType !== 'void';
              const hasAffectedParam = callerMethod.parameterTypes.some(
                (pt) => this.isTypeAffected(pt, changedDtos) || changedDtos.has(pt.replace(/<.*>/, '')),
              );

              if (!returnsValue && !hasAffectedParam) {
                console.log(`  跳过追踪: ${edge.callerClass}.${edge.callerMethod} 返回 void 且无受影响参数`);
                continue;
              }

              visited.add(visitedKey);
              queue.push({
                className: edge.callerClass,
                methodName: edge.callerMethod,
                depth: current.depth + 1,
                changeSource: current.changeSource,
                tracePath: [...current.tracePath, `→ 被调用 ${edge.callerClass}.${edge.callerMethod}`],
              });
            }
          }
        }
      }
    }

    console.log(`  类型转换追踪到 ${results.length} 个受影响的 Controller 方法`);
    return results;
  }

  /**
   * 构造调用追踪：找到方法体内 new 了受影响 DTO 的方法，沿反向调用图 BFS 追踪到 Controller
   */
  private traceConstructorImpactedToControllers(
    affectedDtos: Set<string>,
    changedDtos: Set<string>,
    fieldChangePoints: ChangePoint[],
    fieldChanges?: FieldChange[],
  ): AffectedControllerMethod[] {
    const results: AffectedControllerMethod[] = [];
    const MAX_DEPTH = 8;

    const queue: Array<{
      className: string;
      methodName?: string;
      depth: number;
      tracePath: string[];
      changedDto?: string;
      changeSource: string;
      changeType: 'field' | 'method' | 'put_fields';
      changeDetail?: string;
    }> = [];
    // visited 键包含 changeSource，使同一方法可被不同变更 DTO 独立追踪
    const visited: Set<string> = new Set();

    // 从所有方法中找出构造了受影响 DTO 的方法，作为 BFS 起点
    for (const [className, classInfo] of this.classIndex) {
      for (const method of classInfo.methods) {
        const impactedTypes = method.constructorCalls.filter((ct) => this.isTypeAffected(ct, affectedDtos));
        if (impactedTypes.length === 0) continue;

        for (const dto of impactedTypes) {
          const changeSource = this.findChangeSourceForType(dto, changedDtos, fieldChangePoints);

          // 字段级过滤：只有当方法实际访问了变更字段时才作为种子
          if (fieldChanges) {
            const fc = fieldChanges.find((f) => f.className === changeSource);
            if (fc) {
              const changedFields = new Set([...fc.addedFields, ...fc.removedFields, ...fc.changedFields]);
              const accessedFields = method.typedFieldAccesses[changeSource] || [];
              const hasFieldOverlap = accessedFields.some((f) => changedFields.has(f));
              if (!hasFieldOverlap) continue;
            }
          }

          const key = `${className}.${method.name}|${changeSource}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push({
              className,
              methodName: method.name,
              depth: 0,
              tracePath: [`${changeSource} 字段变更`, `→ ${className}.${method.name}() 构造 ${dto}`],
              changedDto: undefined,
              changeSource,
              changeType: 'field',
              changeDetail: undefined,
            });
          }
        }
      }
    }

    // BFS 沿反向调用图向上追踪
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > MAX_DEPTH) continue;

      const classInfo = this.classIndex.get(current.className);
      if (!classInfo) continue;

      if (classInfo.isController) {
        if (!current.methodName) continue;
        const method = classInfo.methods.find((m) => m.name === current.methodName);
        if (method) {
          // 返回类型为黑盒且无 .data(...) 调用 → 不返回业务数据，跳过
          if (this.isOpaqueType(method.returnType) && method.dataCalls.length === 0) continue;
        }
        const changeDetail = fieldChangePoints.find((cp) => cp.className === current.changeSource)?.changeDetail;
        results.push({
          controllerFile: classInfo.file,
          controllerClass: classInfo.name,
          methodName: current.methodName,
          tracePath: [...current.tracePath, `→ Controller ${classInfo.name}.${current.methodName}`],
          changeSource: current.changeSource,
          changeType: 'field',
          changeDetail,
          impactType: 'response',
        });
        continue;
      }

      // 数据流检查（depth > 0）：当前方法必须通过返回值或参数将受影响 DTO 的数据传递给调用者
      // depth=0 是种子方法（构造了受影响 DTO 的方法），直接允许传播
      // - 返回类型包含受影响 DTO → 数据通过返回值流回调用者
      // - 返回类型为黑盒 → 非Controller层直接允许传播（dataCalls仅在Controller层有意义）
      // - 参数类型包含受影响 DTO → 数据通过参数修改流回调用者（void 方法也可能修改参数对象）
      // - 以上都不满足 → DTO 数据未流回调用者，停止传播
      if (current.depth > 0) {
        const currentMethod = classInfo.methods.find((m) => m.name === current.methodName);
        if (currentMethod) {
          const returnRefAffected =
            currentMethod.returnType !== 'void' && this.isTypeAffected(currentMethod.returnType, affectedDtos);
          const returnOpaque = this.isOpaqueType(currentMethod.returnType);
          const paramRefAffected = currentMethod.parameterTypes.some((pt) => this.isTypeAffected(pt, affectedDtos));
          if (!returnRefAffected && !returnOpaque && !paramRefAffected) continue;
        }
      }

      const callKey = `${current.className}.${current.methodName}`;
      const callers = this.reverseCallGraph.get(callKey);
      if (callers) {
        for (const edge of callers) {
          const visitedKey = `${edge.callerClass}.${edge.callerMethod}|${current.changeSource}`;
          if (visited.has(visitedKey)) continue;
          visited.add(visitedKey);
          queue.push({
            className: edge.callerClass,
            methodName: edge.callerMethod,
            depth: current.depth + 1,
            tracePath: [...current.tracePath, `→ 被调用 ${edge.callerClass}.${edge.callerMethod}`],
            changedDto: undefined,
            changeSource: current.changeSource,
            changeType: 'field',
            changeDetail: undefined,
          });
        }
      }

      // 接口方法 → 也查实现类的调用者
      const children = this.inheritanceTree.get(current.className);
      if (children) {
        for (const child of children) {
          const childCallKey = `${child}.${current.methodName}`;
          const childCallers = this.reverseCallGraph.get(childCallKey);
          if (childCallers) {
            for (const edge of childCallers) {
              const visitedKey = `${edge.callerClass}.${edge.callerMethod}|${current.changeSource}`;
              if (visited.has(visitedKey)) continue;
              visited.add(visitedKey);
              queue.push({
                className: edge.callerClass,
                methodName: edge.callerMethod,
                depth: current.depth + 1,
                tracePath: [...current.tracePath, `→ 被调用 ${edge.callerClass}.${edge.callerMethod}`],
                changedDto: undefined,
                changeSource: current.changeSource,
                changeType: 'field',
                changeDetail: undefined,
              });
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * 检查类型是否在受影响集合中（支持泛型，如 List<DramaProjectParam>）
   */
  private isTypeAffected(type: string, affectedDtos: Set<string>): boolean {
    if (affectedDtos.has(type)) return true;
    // 处理泛型：List<DramaProjectParam> → 提取 DramaProjectParam
    const genericMatch = type.match(/<(.*?)>/);
    if (genericMatch) {
      const innerTypes = genericMatch[1].split(',').map((t) => t.trim());
      for (const inner of innerTypes) {
        if (affectedDtos.has(inner)) return true;
      }
    }
    return false;
  }

  /**
   * 判断类型是否为"黑盒"类型（签名上看不出内部 DTO 结构）
   */
  private isOpaqueType(type: string | undefined): boolean {
    if (!type) return false;
    const opaqueTypes = ['JSONObject', 'Object', 'Map', 'HashMap', 'LinkedHashMap', 'Response', 'JsonNode'];
    const baseType = type.replace(/<.*>/, '');
    if (opaqueTypes.includes(baseType)) return true;
    // 泛型包装的 opaque 类型，如 List<JSONObject>、Response<XXX>
    const containerTypes = ['List', 'ArrayList', 'Set', 'HashSet', 'Collection'];
    if (containerTypes.includes(baseType)) {
      const genericMatch = type.match(/<(.*?)>/);
      if (genericMatch) {
        const innerType = genericMatch[1].split(',')[0].trim();
        if (opaqueTypes.includes(innerType)) return true;
      }
    }
    return false;
  }

  /**
   * 当 Controller 方法签名类型为"黑盒"时，沿方法体调用链查找间接引用的受影响 DTO
   * 响应方向：签名类型为黑盒时，需有 .data(...) 调用才追踪；沿 service 调用查找返回类型
   * 入参方向：签名类型为黑盒时，沿 service 调用查找参数类型
   */
  private findIndirectDtoReferences(
    controllerClass: ClassInfo,
    method: MethodInfo,
    affectedDtos: Set<string>,
    changedDtos: Set<string>,
    fieldChangePoints: ChangePoint[],
    fieldChanges?: FieldChange[],
    depth: number = 0,
    maxDepth: number = 10,
  ): AffectedControllerMethod[] {
    const results: AffectedControllerMethod[] = [];
    const returnOpaque = this.isOpaqueType(method.returnType);
    const requestOpaque = this.isOpaqueType(method.requestBodyType);

    // 响应方向：签名类型为黑盒，但方法体没有 .data(...) → 不返回业务数据，跳过
    if (returnOpaque && method.dataCalls.length === 0) {
      // 不追踪响应
    } else if (returnOpaque) {
      // 有 .data(...)，沿调用链查找返回类型引用了受影响 DTO 的 service 方法
      const responseRefs = this.traceCallsForDto(
        controllerClass,
        method,
        affectedDtos,
        changedDtos,
        fieldChangePoints,
        'response',
        depth,
        maxDepth,
        fieldChanges,
      );
      results.push(...responseRefs);
    }

    // 入参方向：签名类型为黑盒，沿调用链查找参数类型引用了受影响 DTO 的 service 方法
    if (requestOpaque) {
      const requestRefs = this.traceCallsForDto(
        controllerClass,
        method,
        affectedDtos,
        changedDtos,
        fieldChangePoints,
        'request_body',
        depth,
        maxDepth,
        fieldChanges,
      );
      results.push(...requestRefs);
    }

    return results;
  }

  /**
   * 沿方法体的调用链查找引用了受影响 DTO 的 service 方法
   */
  private traceCallsForDto(
    callerClass: ClassInfo,
    callerMethod: MethodInfo,
    affectedDtos: Set<string>,
    changedDtos: Set<string>,
    fieldChangePoints: ChangePoint[],
    direction: 'request_body' | 'response',
    depth: number,
    maxDepth: number,
    fieldChanges?: FieldChange[],
  ): AffectedControllerMethod[] {
    const results: AffectedControllerMethod[] = [];

    for (const call of callerMethod.calls) {
      const dotIndex = call.indexOf('.');
      const objectName = call.slice(0, dotIndex);
      const methodName = call.slice(dotIndex + 1);

      const calleeClassName = this.resolveObjectType(callerClass, objectName);
      if (!calleeClassName) continue;

      // 查找被调用类（可能是接口，也要找实现类）
      const classesToCheck = [calleeClassName];
      const children = this.inheritanceTree.get(calleeClassName);
      if (children) {
        for (const child of children) {
          classesToCheck.push(child);
        }
      }

      for (const className of classesToCheck) {
        const calleeClassInfo = this.classIndex.get(className);
        if (!calleeClassInfo) continue;

        const calleeMethod = calleeClassInfo.methods.find((m) => m.name === methodName);
        if (!calleeMethod) continue;

        if (direction === 'response') {
          // 检查 service 方法的返回类型
          if (calleeMethod.returnType && this.isTypeAffected(calleeMethod.returnType, affectedDtos)) {
            const changeSource = this.findChangeSourceForType(calleeMethod.returnType, changedDtos, fieldChangePoints);
            const changeDetail = fieldChangePoints.find((cp) => cp.className === changeSource)?.changeDetail;
            results.push({
              controllerFile: callerClass.file,
              controllerClass: callerClass.name,
              methodName: callerMethod.name,
              tracePath: [
                `${changeSource} 字段变更`,
                `→ ${calleeClassInfo.name}.${methodName}() 返回 ${calleeMethod.returnType}`,
                `→ ${callerClass.name}.${callerMethod.name}() 响应间接引用`,
              ],
              changeSource,
              changeType: 'field',
              changeDetail,
              impactType: 'response',
            });
          }
          // 检查 service 方法体内的构造调用
          for (const ctorCall of calleeMethod.constructorCalls) {
            if (this.isTypeAffected(ctorCall, affectedDtos)) {
              const changeSource = this.findChangeSourceForType(ctorCall, changedDtos, fieldChangePoints);
              // 字段级过滤：只有当被调用方法实际访问了变更字段时才标记受影响
              if (fieldChanges) {
                const fc = fieldChanges.find((f) => f.className === changeSource);
                if (fc) {
                  const changedFields = new Set([...fc.addedFields, ...fc.removedFields, ...fc.changedFields]);
                  const accessedFields = calleeMethod.typedFieldAccesses[changeSource] || [];
                  const hasFieldOverlap = accessedFields.some((f) => changedFields.has(f));
                  if (!hasFieldOverlap) continue;
                }
              }
              const alreadyInResults = results.some(
                (r) =>
                  r.controllerClass === callerClass.name &&
                  r.methodName === callerMethod.name &&
                  r.changeSource === changeSource &&
                  r.impactType === 'response',
              );
              if (!alreadyInResults) {
                const changeDetail = fieldChangePoints.find((cp) => cp.className === changeSource)?.changeDetail;
                results.push({
                  controllerFile: callerClass.file,
                  controllerClass: callerClass.name,
                  methodName: callerMethod.name,
                  tracePath: [
                    `${changeSource} 字段变更`,
                    `→ ${calleeClassInfo.name}.${methodName}() 构造 ${ctorCall}`,
                    `→ ${callerClass.name}.${callerMethod.name}() 响应间接引用`,
                  ],
                  changeSource,
                  changeType: 'field',
                  changeDetail,
                  impactType: 'response',
                });
              }
            }
          }
          // 如果 service 方法返回类型也是黑盒，递归追踪
          if (this.isOpaqueType(calleeMethod.returnType) && depth < maxDepth && calleeMethod.dataCalls.length > 0) {
            const deeperRefs = this.traceCallsForDto(
              calleeClassInfo,
              calleeMethod,
              affectedDtos,
              changedDtos,
              fieldChangePoints,
              direction,
              depth + 1,
              maxDepth,
              fieldChanges,
            );
            // 将递归结果中的 controllerFile/controllerClass/methodName 替换为原始 Controller
            for (const ref of deeperRefs) {
              results.push({
                ...ref,
                controllerFile: callerClass.file,
                controllerClass: callerClass.name,
                methodName: callerMethod.name,
                tracePath: [
                  ...ref.tracePath.slice(0, -1),
                  `→ ${calleeClassInfo.name}.${methodName}() (间接)`,
                  `→ ${callerClass.name}.${callerMethod.name}() 响应间接引用`,
                ],
              });
            }
          }
        } else {
          // 入参方向：检查 service 方法的参数类型
          for (const paramType of calleeMethod.parameterTypes) {
            if (this.isTypeAffected(paramType, affectedDtos)) {
              const changeSource = this.findChangeSourceForType(paramType, changedDtos, fieldChangePoints);
              const changeDetail = fieldChangePoints.find((cp) => cp.className === changeSource)?.changeDetail;
              results.push({
                controllerFile: callerClass.file,
                controllerClass: callerClass.name,
                methodName: callerMethod.name,
                tracePath: [
                  `${changeSource} 字段变更`,
                  `→ ${calleeClassInfo.name}.${methodName}() 参数引用 ${paramType}`,
                  `→ ${callerClass.name}.${callerMethod.name}() 入参间接引用`,
                ],
                changeSource,
                changeType: 'field',
                changeDetail,
                impactType: 'request_body',
              });
            }
          }
          // 检查 service 方法体内的构造调用（入参方向）
          for (const ctorCall of calleeMethod.constructorCalls) {
            if (this.isTypeAffected(ctorCall, affectedDtos)) {
              const changeSource = this.findChangeSourceForType(ctorCall, changedDtos, fieldChangePoints);
              // 字段级过滤：只有当被调用方法实际访问了变更字段时才标记受影响
              if (fieldChanges) {
                const fc = fieldChanges.find((f) => f.className === changeSource);
                if (fc) {
                  const changedFields = new Set([...fc.addedFields, ...fc.removedFields, ...fc.changedFields]);
                  const accessedFields = calleeMethod.typedFieldAccesses[changeSource] || [];
                  const hasFieldOverlap = accessedFields.some((f) => changedFields.has(f));
                  if (!hasFieldOverlap) continue;
                }
              }
              const alreadyInResults = results.some(
                (r) =>
                  r.controllerClass === callerClass.name &&
                  r.methodName === callerMethod.name &&
                  r.changeSource === changeSource &&
                  r.impactType === 'request_body',
              );
              if (!alreadyInResults) {
                const changeDetail = fieldChangePoints.find((cp) => cp.className === changeSource)?.changeDetail;
                results.push({
                  controllerFile: callerClass.file,
                  controllerClass: callerClass.name,
                  methodName: callerMethod.name,
                  tracePath: [
                    `${changeSource} 字段变更`,
                    `→ ${calleeClassInfo.name}.${methodName}() 构造 ${ctorCall}`,
                    `→ ${callerClass.name}.${callerMethod.name}() 入参间接引用`,
                  ],
                  changeSource,
                  changeType: 'field',
                  changeDetail,
                  impactType: 'request_body',
                });
              }
            }
          }
          // 如果 service 方法参数类型也是黑盒，递归追踪
          if (calleeMethod.requestBodyType && this.isOpaqueType(calleeMethod.requestBodyType) && depth < maxDepth) {
            const deeperRefs = this.traceCallsForDto(
              calleeClassInfo,
              calleeMethod,
              affectedDtos,
              changedDtos,
              fieldChangePoints,
              direction,
              depth + 1,
              maxDepth,
              fieldChanges,
            );
            for (const ref of deeperRefs) {
              results.push({
                ...ref,
                controllerFile: callerClass.file,
                controllerClass: callerClass.name,
                methodName: callerMethod.name,
                tracePath: [
                  ...ref.tracePath.slice(0, -1),
                  `→ ${calleeClassInfo.name}.${methodName}() (间接)`,
                  `→ ${callerClass.name}.${callerMethod.name}() 入参间接引用`,
                ],
              });
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * 为受影响的类型找到原始变更源
   * 先检查类型本身是否是变更 DTO，再沿继承链/嵌入链向上找
   */
  private findChangeSourceForType(type: string, changedDtos: Set<string>, changePoints: ChangePoint[]): string {
    // 提取泛型内的实际类型
    const genericMatch = type.match(/<(.*?)>/);
    const actualType = genericMatch ? genericMatch[1].split(',')[0].trim() : type;

    // 直接匹配
    if (changedDtos.has(actualType)) return actualType;

    // 沿继承链向上找：如果 actualType 的祖先中有变更 DTO
    const ancestors = this.getAncestors(actualType);
    for (const ancestor of ancestors) {
      if (changedDtos.has(ancestor)) return ancestor;
    }

    // 兜底：返回第一个变更点
    return changePoints[0]?.className || actualType;
  }

  /**
   * 构建 DTO 嵌入闭包
   * 如果 A 有字段类型 B 且 B ∈ changedDtos，则 A 也加入受影响集合
   * 递归传递（B → A → C 如果 C 有字段类型 A）
   * 同时处理 BeanUtils.copyProperties 调用：如果方法中有 copyProperties(source, target)，
   * 且 sourceType 是受影响 DTO，targetType 有与 source 变更字段同名的字段，则 targetType 也受影响
   */
  private buildEmbeddedClosure(changedDtos: Set<string>, fieldChanges?: FieldChange[]): Set<string> {
    const closure = new Set(changedDtos);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const [className, classInfo] of this.classIndex) {
        if (closure.has(className)) continue;
        if (classInfo.isController || classInfo.isService) continue;

        // 检查该类是否有字段类型在闭包中
        for (const fieldType of Object.values(classInfo.fields)) {
          if (this.isTypeAffected(fieldType, closure)) {
            closure.add(className);
            expanded = true;
            break;
          }
        }
      }

      // 处理 BeanUtils.copyProperties 调用
      if (fieldChanges) {
        console.log('=== 处理 BeanUtils.copyProperties 调用 ===');
        let copyPropHitCount = 0;
        for (const [className, classInfo] of this.classIndex) {
          for (const method of classInfo.methods) {
            for (const copyCall of method.copyPropertiesCalls) {
              let sourceType: string | undefined;
              let targetType: string | undefined;
              try {
                const content = fs
                  .readFileSync(classInfo.file, 'utf8')
                  .replace(/\/\*[\s\S]*?\*\//g, '')
                  .replace(/^[ \t]*\/\/.*$/gm, '');

                const methodSigPattern = new RegExp(
                  `(?:public|protected|private)\\s+(?:\\S+\\s+)?${method.name}\\s*\\(`,
                );
                const sigMatch = methodSigPattern.exec(content);
                if (sigMatch) {
                  const methodStart = sigMatch.index;
                  const methodEnd = this.findMethodEnd(content, methodStart);
                  const methodContent = content.slice(methodStart, methodEnd);
                  const localVarTypes = this.extractLocalVarTypes(methodContent);

                  if (copyCall.sourceVar.includes('.') || copyCall.sourceVar.includes('(')) {
                    sourceType = this.resolveMethodCallReturnType(methodContent, className, copyCall.sourceVar);
                  } else {
                    sourceType = localVarTypes.get(copyCall.sourceVar);
                  }

                  if (copyCall.targetVar.includes('.') || copyCall.targetVar.includes('(')) {
                    targetType = this.resolveMethodCallReturnType(methodContent, className, copyCall.targetVar);
                  } else {
                    targetType = localVarTypes.get(copyCall.targetVar);
                  }

                  if (sourceType === 'return') {
                    sourceType = method.returnType;
                  }
                  if (targetType === 'return') {
                    targetType = method.returnType;
                  }
                }
              } catch (_error: unknown) {
                continue;
              }

              if (sourceType && this.isTypeAffected(sourceType, closure)) {
                const sourceChange = fieldChanges.find((fc) => fc.className === sourceType);
                if (sourceChange) {
                  const changedFields = new Set([
                    ...sourceChange.addedFields,
                    ...sourceChange.removedFields,
                    ...sourceChange.changedFields,
                  ]);
                  if (targetType && this.classIndex.has(targetType)) {
                    const targetClassInfo = this.classIndex.get(targetType)!;
                    const targetHasMatchingFields = Object.keys(targetClassInfo.fields).some((field) =>
                      changedFields.has(field),
                    );
                    if (targetHasMatchingFields && !closure.has(targetType)) {
                      console.log(`  copyProperties 传播: ${sourceType} → ${targetType}`);
                      copyPropHitCount++;
                      closure.add(targetType);
                      expanded = true;
                    }
                  }
                }
              }
            }
          }
        }
        if (copyPropHitCount === 0) {
          console.log('  未发现 copyProperties 字段传播');
        }
      }
    }
    return closure;
  }

  findAffectedControllers(
    changePoints: ChangePoint[],
    _fieldChangeDetails?: Map<string, string>,
  ): AffectedControllerMethod[] {
    const MAX_DEPTH = 5;
    const affected: AffectedControllerMethod[] = [];
    const visited: Set<string> = new Set();

    const queue: Array<{
      className: string;
      methodName?: string;
      depth: number;
      tracePath: string[];
      /** 追踪的变更 DTO 类名，用于在 Controller 级做方法级过滤 */
      changedDto?: string;
      /** 触发此追踪的变更源类名 */
      changeSource: string;
      /** 变更类型 */
      changeType: 'field' | 'method' | 'put_fields';
      /** 变更详情 */
      changeDetail?: string;
    }> = [];

    for (const cp of changePoints) {
      if (cp.changeType === 'field') {
        const affectedClasses = this.getDescendants(cp.className);
        affectedClasses.add(cp.className);
        for (const cls of affectedClasses) {
          if (!visited.has(cls)) {
            visited.add(cls);
            queue.push({
              className: cls,
              depth: 0,
              tracePath: [`${cp.className} 字段变更`],
              changedDto: cp.className,
              changeSource: cp.className,
              changeType: 'field',
              changeDetail: cp.changeDetail,
            });
          }
        }
      } else {
        const key = `${cp.className}.${cp.methodName || '*'}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({
            className: cp.className,
            methodName: cp.methodName,
            depth: 0,
            tracePath: [
              `${cp.changeType === 'put_fields' ? 'put写入' : '方法变更'} ${cp.className}.${cp.methodName || '*'}`,
            ],
            changeSource: cp.className,
            changeType: cp.changeType,
            changeDetail: cp.changeDetail,
          });
        }
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > MAX_DEPTH) continue;

      const classInfo = this.classIndex.get(current.className);
      if (!classInfo) continue;

      if (classInfo.isController) {
        if (current.methodName) {
          // 有明确方法名：只标记该方法
          affected.push({
            controllerFile: classInfo.file,
            controllerClass: classInfo.name,
            methodName: current.methodName,
            tracePath: [...current.tracePath, `→ Controller ${classInfo.name}.${current.methodName}`],
            changeSource: current.changeSource,
            changeType: current.changeType,
            changeDetail: current.changeDetail,
            impactType: 'response',
          });
        } else if (current.changedDto) {
          // 有变更 DTO 信息：只标记返回类型或参数引用了该 DTO 的方法
          for (const method of classInfo.methods) {
            const isAffected =
              method.returnType === current.changedDto ||
              method.returnType.includes(`<${current.changedDto}>`) ||
              method.calls.some((c) => c.includes(`.${method.name}`) || c.includes(current.changedDto!));
            if (isAffected) {
              affected.push({
                controllerFile: classInfo.file,
                controllerClass: classInfo.name,
                methodName: method.name,
                tracePath: [...current.tracePath, `→ Controller ${classInfo.name}.${method.name}`],
                changeSource: current.changeSource,
                changeType: current.changeType,
                changeDetail: current.changeDetail,
                impactType: 'response',
              });
            }
          }
        } else {
          // 无明确信息：保守处理，标记所有方法
          for (const method of classInfo.methods) {
            affected.push({
              controllerFile: classInfo.file,
              controllerClass: classInfo.name,
              methodName: method.name,
              tracePath: [...current.tracePath, `→ Controller ${classInfo.name}.${method.name}`],
              changeSource: current.changeSource,
              changeType: current.changeType,
              changeDetail: current.changeDetail,
              impactType: 'response',
            });
          }
        }
        continue;
      }

      // 沿反向调用图向上追踪
      if (current.methodName) {
        this.enqueueCallers(
          current.className,
          current.methodName,
          current.depth,
          current.tracePath,
          visited,
          queue,
          current.changeSource,
          current.changeType,
          current.changeDetail,
          current.changedDto,
        );

        // 接口方法 → 也查实现类的调用者
        const children = this.inheritanceTree.get(current.className);
        if (children) {
          for (const child of children) {
            this.enqueueCallers(
              child,
              current.methodName,
              current.depth,
              current.tracePath,
              visited,
              queue,
              current.changeSource,
              current.changeType,
              current.changeDetail,
              current.changedDto,
            );
          }
        }
      }

      // 字段级变更：查找以该类为字段类型或方法返回类型的其他类
      if (!current.methodName) {
        for (const [otherName, otherClass] of this.classIndex) {
          if (otherName === current.className) continue;

          const hasFieldRef = Object.values(otherClass.fields).some(
            (ft) => ft === current.className || ft.includes(`<${current.className}>`),
          );

          // 找到返回类型引用了变更类的具体方法，按方法级入队（而非类级）
          const returnRefMethods = otherClass.methods.filter(
            (m) =>
              m.returnType === current.className ||
              m.returnType.includes(`<${current.className}>`) ||
              m.returnType.includes(`<${current.className},`),
          );

          // 找到参数类型引用了变更类的具体方法（如 @RequestBody DTO）
          const paramRefMethods = otherClass.methods.filter((m) =>
            m.parameterTypes.some(
              (pt) =>
                pt === current.className ||
                pt.includes(`<${current.className}>`) ||
                pt.includes(`<${current.className},`),
            ),
          );

          if (hasFieldRef) {
            const key = otherName;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push({
                className: otherName,
                depth: current.depth + 1,
                tracePath: [...current.tracePath, `→ 字段引用 ${otherName}`],
                changedDto: current.changedDto,
                changeSource: current.changeSource,
                changeType: current.changeType,
                changeDetail: current.changeDetail,
              });
            }
          }

          // 返回类型引用：按方法级入队，这样才能沿调用链追踪
          for (const m of returnRefMethods) {
            const key = `${otherName}.${m.name}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push({
                className: otherName,
                methodName: m.name,
                depth: current.depth + 1,
                tracePath: [...current.tracePath, `→ 返回类型引用 ${otherName}.${m.name}`],
                changedDto: current.changedDto,
                changeSource: current.changeSource,
                changeType: current.changeType,
                changeDetail: current.changeDetail,
              });
            }
          }

          // 参数类型引用：按方法级入队（如 @RequestBody DTO 变更影响对应接口）
          for (const m of paramRefMethods) {
            const key = `${otherName}.${m.name}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push({
                className: otherName,
                methodName: m.name,
                depth: current.depth + 1,
                tracePath: [...current.tracePath, `→ 参数类型引用 ${otherName}.${m.name}`],
                changedDto: current.changedDto,
                changeSource: current.changeSource,
                changeType: current.changeType,
                changeDetail: current.changeDetail,
              });
            }
          }

          // 构造调用引用：方法体内 new 了变更类的方法
          const constructorRefMethods = otherClass.methods.filter((m) =>
            m.constructorCalls.some((ct) => ct === current.className || ct.includes(`<${current.className}>`)),
          );

          for (const m of constructorRefMethods) {
            const key = `${otherName}.${m.name}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push({
                className: otherName,
                methodName: m.name,
                depth: current.depth + 1,
                tracePath: [...current.tracePath, `→ 构造调用 ${otherName}.${m.name}`],
                changedDto: current.changedDto,
                changeSource: current.changeSource,
                changeType: current.changeType,
                changeDetail: current.changeDetail,
              });
            }
          }
        }
      }
    }

    return affected;
  }

  private enqueueCallers(
    className: string,
    methodName: string,
    currentDepth: number,
    currentTracePath: string[],
    visited: Set<string>,
    queue: Array<{
      className: string;
      methodName?: string;
      depth: number;
      tracePath: string[];
      changedDto?: string;
      changeSource: string;
      changeType: 'field' | 'method' | 'put_fields';
      changeDetail?: string;
    }>,
    changeSource: string,
    changeType: 'field' | 'method' | 'put_fields',
    changeDetail?: string,
    changedDto?: string,
  ): void {
    const callKey = `${className}.${methodName}`;
    const callers = this.reverseCallGraph.get(callKey);
    if (!callers) return;

    for (const edge of callers) {
      const visitedKey = `${edge.callerClass}.${edge.callerMethod}`;
      if (visited.has(visitedKey)) continue;
      visited.add(visitedKey);
      queue.push({
        className: edge.callerClass,
        methodName: edge.callerMethod,
        depth: currentDepth + 1,
        tracePath: [...currentTracePath, `→ 被调用 ${edge.callerClass}.${edge.callerMethod}`],
        changeSource,
        changeType,
        changeDetail,
        changedDto,
      });
    }
  }

  private buildClassIndex(sourcePath: string): void {
    const normalizedSourcePath = sourcePath.replace(/\\/g, '/');
    const javaFiles = globSync(normalizedSourcePath + '/**/*.java');

    for (const file of javaFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const classInfo = this.parseJavaFile(file, content);
        if (classInfo) {
          this.classIndex.set(classInfo.name, classInfo);
        }
      } catch (_error: any) {
        // skip unreadable files
      }
    }
  }

  private parseJavaFile(filePath: string, rawContent: string): ClassInfo | null {
    // 去除注释，避免解析到被注释掉的方法
    const content = rawContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    // 类声明
    const classPattern =
      /(?:public\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/;
    const classMatch = content.match(classPattern);
    if (!classMatch) return null;

    const name = classMatch[1];
    const extendsClass = classMatch[2] || null;
    const implementsInterfaces = classMatch[3]
      ? classMatch[3]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const isController = /@(Controller|RestController)\b/.test(content);
    const isService = /@(Service|Repository|Component|Configuration|Aspect)\b/.test(content);

    // 字段提取
    const fields: Record<string, string> = {};
    const fieldPattern = /private\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/g;
    let fieldMatch;
    while ((fieldMatch = fieldPattern.exec(content)) !== null) {
      fields[fieldMatch[2]] = fieldMatch[1];
    }

    // @Autowired / @Resource 注入
    const injectedFields: Record<string, string> = {};
    const autowiredPattern =
      /@(?:Autowired|Resource|Inject)(?:\([^)]*\))?\s+(?:private\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/g;
    let autowiredMatch;
    while ((autowiredMatch = autowiredPattern.exec(content)) !== null) {
      injectedFields[autowiredMatch[2]] = autowiredMatch[1];
    }

    // 构造器注入: @Autowired public XxxController(ServiceA a, ServiceB b)
    const constructorInjectPattern = /@Autowired\s+(?:public\s+)?\w+\s*\(([^)]+)\)/g;
    let constructorMatch;
    while ((constructorMatch = constructorInjectPattern.exec(content)) !== null) {
      const params = constructorMatch[1];
      const paramPattern = /(\w+(?:<[^>]+>)?)\s+(\w+)/g;
      let paramMatch;
      while ((paramMatch = paramPattern.exec(params)) !== null) {
        if (!['String', 'Integer', 'Long', 'Boolean', 'int', 'long', 'boolean'].includes(paramMatch[1])) {
          injectedFields[paramMatch[2]] = paramMatch[1];
        }
      }
    }

    // 方法提取 — 使用括号计数处理参数中嵌套括号的情况（如 @RequestHeader(value="x")）
    const methods: MethodInfo[] = [];
    const isInterface = /(?:public\s+)?interface\s+\w+/.test(content);
    const isAbstractClass = /(?:public\s+)?abstract\s+class\s+\w+/.test(content);

    const methodStartPattern = /(?:public|protected|private)\s+(?:abstract\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g;
    let methodStartMatch;
    while ((methodStartMatch = methodStartPattern.exec(content)) !== null) {
      const returnType = methodStartMatch[1];
      const methodName = methodStartMatch[2];

      // 跳过标准 JavaBean getter/setter/toString 等（只跳过参数匹配的，不影响业务方法）
      if (methodName === 'toString' || methodName === 'hashCode' || methodName === 'equals') continue;
      // getter/setter 过滤延迟到参数解析后，根据参数数量判断
      if (methods.some((m) => m.name === methodName)) continue;

      // 用括号计数找到参数列表的结束位置
      const openParen = methodStartMatch.index + methodStartMatch[0].length - 1;
      let depth = 1;
      let pos = openParen + 1;
      while (pos < content.length && depth > 0) {
        if (content[pos] === '(') depth++;
        else if (content[pos] === ')') depth--;
        pos++;
      }
      const closeParen = pos - 1; // matching )
      const paramsText = content.slice(openParen + 1, closeParen);

      // 简化参数类型提取：去掉注解后取类型名
      const paramTypes = paramsText
        .split(',')
        .map((p) => {
          const stripped = p.replace(/@\w+(\([^)]*\))?/g, '').trim();
          const parts = stripped.split(/\s+/);
          return parts.length >= 2 ? parts[0] : '';
        })
        .filter(Boolean);

      // 提取 @RequestBody 参数类型
      const requestBodyMatch = paramsText.match(
        /@RequestBody(?:\([^)]*\))?\s+(?:@\w+(?:\([^)]*\))?\s+)*(\w+(?:<[^>]+>)?)\s+\w+/,
      );
      const requestBodyType = requestBodyMatch ? requestBodyMatch[1] : undefined;
      // 传给 push 的变量（作用域在 push 之前定义）
      const rbt = requestBodyType;

      // 检查签名结束后是 { 还是 ; （区分有方法体 vs 接口/抽象方法）
      const afterParams = content.slice(closeParen + 1).replace(/^\s*/, '');
      const hasBody =
        afterParams.startsWith('{') || /^\{/.test(afterParams) || /^(throws\s+[\w,\s]+)?\s*\{/.test(afterParams);

      // 跳过标准 JavaBean getter（无参+返回非void）和 setter（一参+返回void）
      if (methodName.startsWith('get') && methodName.length > 3 && paramTypes.length === 0 && returnType !== 'void')
        continue;
      if (methodName.startsWith('set') && methodName.length > 3 && paramTypes.length === 1 && returnType === 'void')
        continue;
      if (
        methodName.startsWith('is') &&
        methodName.length > 2 &&
        paramTypes.length === 0 &&
        (returnType === 'boolean' || returnType === 'Boolean')
      )
        continue;

      if (hasBody) {
        const methodStart = methodStartMatch.index;
        const methodEnd = this.findMethodEnd(content, methodStart);
        const methodContent = content.slice(methodStart, methodEnd);

        const calls: string[] = [];
        const callPattern = /(?:this\.)?(\w+)\.(\w+)\s*\(/g;
        let callMatch;
        while ((callMatch = callPattern.exec(methodContent)) !== null) {
          const objName = callMatch[1];
          const methName = callMatch[2];
          if (
            !['System', 'log', 'logger', 'Math', 'Collections', 'Arrays', 'Objects', 'String'].includes(objName) &&
            !['toString', 'equals', 'hashCode', 'getClass', 'notify', 'wait'].includes(methName)
          ) {
            calls.push(`${objName}.${methName}`);
          }
        }

        const putFields = this.extractMapFields(methodContent);

        const dataCalls: string[] = [];
        const dataPattern = /\.data\s*\(\s*([^)]+)\s*\)/g;
        let dataMatch;
        while ((dataMatch = dataPattern.exec(methodContent)) !== null) {
          dataCalls.push(dataMatch[1].trim());
        }

        const constructorCalls: string[] = [];
        const constructorPattern = /\bnew\s+(\w+)\s*\(/g;
        let constructorMatch;
        while ((constructorMatch = constructorPattern.exec(methodContent)) !== null) {
          const typeName = constructorMatch[1];
          if (!DependencyGraph.JAVA_BUILTIN_TYPES.includes(typeName)) {
            constructorCalls.push(typeName);
          }
        }

        // 提取方法体中的局部变量类型映射和字段访问
        const typedFieldAccesses = this.extractTypedFieldAccesses(methodContent);

        // 提取 BeanUtils.copyProperties 调用
        const copyPropertiesCalls: Array<{ sourceVar: string; targetVar: string }> = [];
        // 更高级的方法，使用括号计数来正确解析源变量和目标变量
        const basePattern = /BeanUtils\.copyProperties\s*\(/g;
        let match;
        while ((match = basePattern.exec(methodContent)) !== null) {
          const openParen = match.index + match[0].length - 1;
          let depth = 1;
          let pos = openParen + 1;
          const commaPositions: number[] = []; // 记录第一层括号内的逗号位置
          let closeParenPos = -1;

          while (pos < methodContent.length && depth > 0) {
            if (methodContent[pos] === '(') {
              depth++;
            } else if (methodContent[pos] === ')') {
              depth--;
              if (depth === 0) {
                closeParenPos = pos;
                break;
              }
            } else if (methodContent[pos] === ',' && depth === 1) {
              // 只有在第一层括号内的逗号才是参数分隔符
              commaPositions.push(pos);
            }
            pos++;
          }

          if (commaPositions.length >= 1 && closeParenPos !== -1) {
            const sourceVar = methodContent.slice(openParen + 1, commaPositions[0]).trim();
            // 目标变量是第一个和第二个逗号之间的内容（如果有第二个逗号），否则是第一个逗号到结束括号之间的内容
            const targetEndPos = commaPositions.length >= 2 ? commaPositions[1] : closeParenPos;
            const targetVar = methodContent.slice(commaPositions[0] + 1, targetEndPos).trim();
            copyPropertiesCalls.push({
              sourceVar,
              targetVar,
            });
          }
        }

        // 提取类型转换调用（JSONObject.toJSON, JSON.toJSON, JSON.parseObject 等）
        const typeConversionCalls = this.extractTypeConversionCalls(methodContent);

        methods.push({
          name: methodName,
          returnType,
          parameterTypes: paramTypes,
          requestBodyType: rbt,
          calls,
          putFields,
          dataCalls,
          constructorCalls,
          typedFieldAccesses,
          copyPropertiesCalls,
          typeConversionCalls,
        });
      } else if (isInterface || isAbstractClass) {
        // 接口方法或抽象方法以 ; 结尾，无方法体
        if (returnType === 'void') continue;
        methods.push({
          name: methodName,
          returnType,
          parameterTypes: paramTypes,
          requestBodyType: rbt,
          calls: [],
          putFields: {},
          dataCalls: [],
          constructorCalls: [],
          typedFieldAccesses: {},
          copyPropertiesCalls: [],
          typeConversionCalls: [],
        });
      }
    }

    return {
      name,
      file: filePath,
      isController,
      isService,
      fields,
      extendsClass,
      implementsInterfaces,
      methods,
      injectedFields,
    };
  }

  private buildInheritanceTree(): void {
    for (const [className, classInfo] of this.classIndex) {
      if (classInfo.extendsClass) {
        if (!this.inheritanceTree.has(classInfo.extendsClass)) {
          this.inheritanceTree.set(classInfo.extendsClass, new Set());
        }
        this.inheritanceTree.get(classInfo.extendsClass)!.add(className);
      }
      for (const iface of classInfo.implementsInterfaces) {
        if (!this.inheritanceTree.has(iface)) {
          this.inheritanceTree.set(iface, new Set());
        }
        this.inheritanceTree.get(iface)!.add(className);
      }
    }
  }

  private buildCallGraph(): void {
    for (const [className, classInfo] of this.classIndex) {
      for (const method of classInfo.methods) {
        for (const call of method.calls) {
          const dotIndex = call.indexOf('.');
          const objectName = call.slice(0, dotIndex);
          const methodName = call.slice(dotIndex + 1);

          const calleeClass = this.resolveObjectType(classInfo, objectName);
          if (calleeClass) {
            const callKey = `${calleeClass}.${methodName}`;
            if (!this.reverseCallGraph.has(callKey)) {
              this.reverseCallGraph.set(callKey, new Set());
            }
            this.reverseCallGraph.get(callKey)!.add({
              callerClass: className,
              callerMethod: method.name,
            });

            // 接口方法也同时注册到实现类
            const children = this.inheritanceTree.get(calleeClass);
            if (children) {
              for (const child of children) {
                const implKey = `${child}.${methodName}`;
                if (!this.reverseCallGraph.has(implKey)) {
                  this.reverseCallGraph.set(implKey, new Set());
                }
                this.reverseCallGraph.get(implKey)!.add({
                  callerClass: className,
                  callerMethod: method.name,
                });
              }
            }
          }
        }
      }

      // 补充同类内部裸方法调用的反向调用图
      // 当方法 A 调用同类方法 B（如 getAuthProjectList5(...)），但未显式使用 this.
      // 需要重新读取源文件来检测这类调用
      this.addSelfCallEdges(classInfo);
    }
  }

  /**
   * 为同一类内部的裸方法调用（如 methodB() 而非 this.methodB()）添加反向调用边
   */
  private addSelfCallEdges(classInfo: ClassInfo): void {
    const knownMethodNames = new Set(classInfo.methods.map((m) => m.name));
    const methodMap = new Map<string, (typeof classInfo.methods)[0]>();
    for (const m of classInfo.methods) {
      methodMap.set(m.name, m);
    }

    for (const method of classInfo.methods) {
      try {
        const content = fs
          .readFileSync(classInfo.file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');

        // 提取方法体
        const methodSigPattern = new RegExp(`(?:public|protected|private)\\s+(?:\\S+\\s+)?${method.name}\\s*\\(`);
        const sigMatch = methodSigPattern.exec(content);
        if (!sigMatch) continue;

        const methodStart = sigMatch.index;
        const methodEnd = this.findMethodEnd(content, methodStart);
        const methodContent = content.slice(methodStart, methodEnd);

        // 查找裸方法调用：标识符后面跟 ( 且不在 . 后面
        const bareCallPattern = /(?<![.\w])(\w+)\s*\(/g;
        let match;
        while ((match = bareCallPattern.exec(methodContent)) !== null) {
          const calleeName = match[1];
          // 跳过 Java 关键字、已知非方法标识符、和当前方法自身
          if (
            [
              'if',
              'for',
              'while',
              'switch',
              'try',
              'catch',
              'return',
              'new',
              'throw',
              'assert',
              'super',
              'this',
              'else',
              'synchronized',
            ].includes(calleeName)
          )
            continue;
          if (calleeName === method.name) continue;
          if (calleeName === classInfo.name) continue; // 构造函数
          // 跳过已通过 obj.method() 模式捕获的
          if (method.calls.some((c) => c.endsWith(`.${calleeName}`))) continue;
          // 检查是否是同类中定义的方法
          if (knownMethodNames.has(calleeName)) {
            const callKey = `${classInfo.name}.${calleeName}`;
            if (!this.reverseCallGraph.has(callKey)) {
              this.reverseCallGraph.set(callKey, new Set());
            }
            this.reverseCallGraph.get(callKey)!.add({
              callerClass: classInfo.name,
              callerMethod: method.name,
            });
          }
        }
      } catch (_error: any) {
        // 文件读取失败，跳过
      }
    }
  }

  private resolveObjectType(callerClass: ClassInfo, objectName: string): string | null {
    // 1. @Autowired 注入字段
    if (callerClass.injectedFields[objectName]) {
      return callerClass.injectedFields[objectName];
    }

    // 2. this
    if (objectName === 'this') {
      return callerClass.name;
    }

    // 3. 类字段声明（非 private 或同类内 private）
    if (callerClass.fields[objectName]) {
      return callerClass.fields[objectName];
    }

    // 4. 静态调用 — objectName 匹配已知类名
    if (this.classIndex.has(objectName)) {
      return objectName;
    }

    return null;
  }

  private extractMapFields(methodContent: string): Record<string, any> {
    const fields: Record<string, any> = {};
    let cleanContent = methodContent;
    cleanContent = cleanContent.replace(/\/\*[\s\S]*?\*\//g, '');
    cleanContent = cleanContent.replace(/\/\/.*$/gm, '');

    const putPattern = /\w+\.put\s*\(\s*"(\w+)"\s*,\s*([^)]+)\s*\)/g;
    let match;
    while ((match = putPattern.exec(cleanContent)) !== null) {
      const fieldName = match[1];
      const valueExpr = match[2].trim();

      if (/^".*"$/.test(valueExpr)) {
        fields[fieldName] = { type: 'string' };
      } else if (/^\d+$/.test(valueExpr)) {
        fields[fieldName] = { type: 'integer' };
      } else if (/^\d+\.\d+$/.test(valueExpr)) {
        fields[fieldName] = { type: 'number' };
      } else if (/^(true|false)$/.test(valueExpr)) {
        fields[fieldName] = { type: 'boolean' };
      } else if (/new\s+(java\.util\.)?Date/.test(valueExpr)) {
        fields[fieldName] = { type: 'string', format: 'date-time' };
      } else if (/^\d+L$/i.test(valueExpr)) {
        fields[fieldName] = { type: 'integer' };
      } else {
        fields[fieldName] = { type: 'string' };
      }
    }
    return fields;
  }

  /**
   * 解析方法体中的局部变量类型映射
   */
  private extractLocalVarTypes(methodContent: string): Map<string, string> {
    const localVarTypes = new Map<string, string>();
    const localVarPattern = /\b(\w+(?:<[^>]+>)?)\s+(\w+)\s*(?:=|;|\))/g;
    let localVarMatch;
    while ((localVarMatch = localVarPattern.exec(methodContent)) !== null) {
      const typeName = localVarMatch[1];
      const varName = localVarMatch[2];
      if (
        [
          'if',
          'for',
          'while',
          'switch',
          'return',
          'new',
          'int',
          'long',
          'boolean',
          'double',
          'float',
          'byte',
          'short',
          'char',
          'void',
          'this',
          'super',
        ].includes(varName)
      )
        continue;
      if (
        [
          'int',
          'long',
          'boolean',
          'double',
          'float',
          'byte',
          'short',
          'char',
          'void',
          'String',
          'Integer',
          'Long',
          'Boolean',
          'Double',
          'Float',
          'Object',
        ].includes(typeName)
      )
        continue;
      localVarTypes.set(varName, typeName);
    }
    return localVarTypes;
  }

  /**
   * 解析方法调用表达式，获取返回类型
   * 支持模式：this.methodName(...) 或 objectName.methodName(...)
   */
  private resolveMethodCallReturnType(
    methodContent: string,
    callerClass: string,
    methodCallExpr: string,
  ): string | undefined {
    // 解析方法名：去除参数、括号等
    const methodNamePattern = /(\w+)\s*\(/;
    const methodNameMatch = methodCallExpr.match(methodNamePattern);
    if (!methodNameMatch) {
      console.log(`  无法解析方法调用表达式：${methodCallExpr}`);
      return undefined;
    }
    const methodName = methodNameMatch[1];

    // 在 callerClass 中查找该方法
    const callerClassInfo = this.classIndex.get(callerClass);
    if (!callerClassInfo) {
      console.log(`  找不到调用类：${callerClass}`);
      return undefined;
    }

    const methodInfo = callerClassInfo.methods.find((method) => method.name === methodName);

    if (!methodInfo) {
      console.log(`  在类 ${callerClass} 中找不到方法：${methodName}`);
      // 检查是否是继承或实现的方法
      const parents: string[] = [];
      if (callerClassInfo.extendsClass) parents.push(callerClassInfo.extendsClass);
      parents.push(...callerClassInfo.implementsInterfaces);
      for (const parent of parents) {
        const parentClassInfo = this.classIndex.get(parent);
        if (parentClassInfo) {
          const parentMethodInfo = parentClassInfo.methods.find((m) => m.name === methodName);
          if (parentMethodInfo) {
            return parentMethodInfo.returnType;
          }
        }
      }
      return undefined;
    }

    return methodInfo?.returnType;
  }

  /**
   * 提取方法体中按类型分组的字段访问
   * 1. 构建局部变量类型映射：Type varName = ... / Type varName; / for (Type varName : ...)
   * 2. 匹配 varName.getXxx() 模式，将 getXxx → xxx 映射到类型
   */
  private extractTypedFieldAccesses(methodContent: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    // 1. 构建局部变量类型映射
    const localVarTypes = this.extractLocalVarTypes(methodContent);

    // 2. 匹配 varName.getXxx() 和 varName.isXxx() 模式
    const getterPattern = /(\w+)\.(get|is)([A-Z]\w*)\s*\(/g;
    let getterMatch;
    while ((getterMatch = getterPattern.exec(methodContent)) !== null) {
      const varName = getterMatch[1];
      const fieldName = getterMatch[3].charAt(0).toLowerCase() + getterMatch[3].slice(1);
      const typeName = localVarTypes.get(varName);
      if (!typeName) continue;
      // 提取泛型内的实际类型（如 Response<DramaProject> → DramaProject 不做，取原始类型名）
      const baseType = typeName.replace(/<.*>/, '');
      if (!result[baseType]) result[baseType] = [];
      if (!result[baseType].includes(fieldName)) {
        result[baseType].push(fieldName);
      }
    }

    // 3. 匹配 varName.setXxx(...) 模式（setter 也算字段访问）
    const setterPattern = /(\w+)\.set([A-Z]\w*)\s*\(/g;
    let setterMatch;
    while ((setterMatch = setterPattern.exec(methodContent)) !== null) {
      const varName = setterMatch[1];
      const fieldName = setterMatch[2].charAt(0).toLowerCase() + setterMatch[2].slice(1);
      const typeName = localVarTypes.get(varName);
      if (!typeName) continue;
      const baseType = typeName.replace(/<.*>/, '');
      if (!result[baseType]) result[baseType] = [];
      if (!result[baseType].includes(fieldName)) {
        result[baseType].push(fieldName);
      }
    }

    return result;
  }

  /**
   * 提取方法体中的类型转换调用
   * 支持模式：
   *   JSONObject.toJSON(dramaProjectResp)        → sourceVar=dramaProjectResp, conversionMethod=JSONObject.toJSON, targetTypeName=JSONObject
   *   JSON.toJSON(dramaProjectResp)              → sourceVar=dramaProjectResp, conversionMethod=JSON.toJSON, targetTypeName=JSONObject
   *   JSONObject.parseObject(str, Type.class)     → sourceVar=str, conversionMethod=JSONObject.parseObject, targetTypeName=Type
   *   JSON.parseObject(str, Type.class)           → sourceVar=str, conversionMethod=JSON.parseObject, targetTypeName=Type
   *   JSONArray.parseArray(JSON.toJSONString(x))   → 递归提取内层
   */
  private extractTypeConversionCalls(methodContent: string): Array<{
    sourceVar: string;
    sourceType: string;
    conversionMethod: string;
    targetTypeName: string;
    resultVar?: string;
    flowsToReturn: boolean;
  }> {
    const results: Array<{
      sourceVar: string;
      sourceType: string;
      conversionMethod: string;
      targetTypeName: string;
      resultVar?: string;
      flowsToReturn: boolean;
    }> = [];
    const localVarTypes = this.extractLocalVarTypes(methodContent);

    // 模式1: (JSONObject)JSONObject.toJSON(varName) 或 (JSONObject)JSON.toJSON(varName)
    const toJsonPattern = /(?:\(\s*JSONObject\s*\)\s*)?(?:JSONObject|JSON)\.toJSON\s*\(\s*(\w+)\s*\)/g;
    let match;
    while ((match = toJsonPattern.exec(methodContent)) !== null) {
      const sourceVar = match[1];
      const sourceType = localVarTypes.get(sourceVar) || '';
      const { resultVar, flowsToReturn } = this.analyzeTypeConversionFlow(methodContent, match.index, match[0]);
      results.push({
        sourceVar,
        sourceType,
        conversionMethod: 'JSONObject.toJSON',
        targetTypeName: 'JSONObject',
        resultVar,
        flowsToReturn,
      });
    }

    // 模式2: JSONObject.parseObject(expr, Type.class) 或 JSON.parseObject(expr, Type.class)
    const parseObjectPattern = /(?:JSONObject|JSON)\.parseObject\s*\(\s*[^,]+,\s*(\w+)\.class\s*\)/g;
    while ((match = parseObjectPattern.exec(methodContent)) !== null) {
      const targetTypeName = match[1];
      // 提取第一个参数（源变量）
      const fullMatch = match[0];
      const argsStart = fullMatch.indexOf('(') + 1;
      const firstArgEnd = fullMatch.indexOf(',');
      const sourceExpr = fullMatch.slice(argsStart, firstArgEnd).trim();
      const sourceVar = sourceExpr.replace(/\(.*\)/, '').trim();
      const sourceType = localVarTypes.get(sourceVar) || '';
      const { resultVar, flowsToReturn } = this.analyzeTypeConversionFlow(methodContent, match.index, match[0]);
      results.push({
        sourceVar,
        sourceType,
        conversionMethod: 'JSON.parseObject',
        targetTypeName,
        resultVar,
        flowsToReturn,
      });
    }

    // 模式3: JSON.toJSONString(varName) — 源变量转成 String，间接追踪
    const toJsonStringPattern = /JSON\.toJSONString\s*\(\s*(\w+)\s*\)/g;
    while ((match = toJsonStringPattern.exec(methodContent)) !== null) {
      const sourceVar = match[1];
      const sourceType = localVarTypes.get(sourceVar) || '';
      const { resultVar, flowsToReturn } = this.analyzeTypeConversionFlow(methodContent, match.index, match[0]);
      results.push({
        sourceVar,
        sourceType,
        conversionMethod: 'JSON.toJSONString',
        targetTypeName: 'String',
        resultVar,
        flowsToReturn,
      });
    }

    // 模式4: JSONArray.parseArray(JSON.toJSONString(varName)) — 递归场景
    const parseArrayPattern = /JSONArray\.parseArray\s*\(.*?(?:JSON\.toJSONString\s*\(\s*(\w+)\s*\)).*?\)/g;
    while ((match = parseArrayPattern.exec(methodContent)) !== null) {
      const sourceVar = match[1];
      const sourceType = localVarTypes.get(sourceVar) || '';
      const { resultVar, flowsToReturn } = this.analyzeTypeConversionFlow(methodContent, match.index, match[0]);
      results.push({
        sourceVar,
        sourceType,
        conversionMethod: 'JSONArray.parseArray',
        targetTypeName: 'JSONArray',
        resultVar,
        flowsToReturn,
      });
    }

    return results;
  }

  /**
   * 分析类型转换结果的数据流：是否被赋值给变量，以及变量是否流向返回值
   */
  private analyzeTypeConversionFlow(
    methodContent: string,
    matchIndex: number,
    fullMatch: string,
  ): { resultVar?: string; flowsToReturn: boolean } {
    // 检查是否有变量接收转换结果：Type varName = conversionCall;
    const beforeContext = methodContent.slice(0, matchIndex).trim();
    const lastLine = beforeContext.split('\n').pop()?.trim() || '';

    let resultVar: string | undefined;
    let flowsToReturn = false;

    // 情况1: 直接赋值给变量
    // 匹配模式: Type varName = (JSONObject)JSONObject.toJSON(varName);
    const assignmentMatch = lastLine.match(/(\w+)\s*=\s*[^;]*$/);
    if (assignmentMatch) {
      resultVar = assignmentMatch[1];

      // 检查该变量是否在后续代码中被返回
      const afterContext = methodContent.slice(matchIndex + fullMatch.length);
      const returnPattern = new RegExp(`return\\s+${resultVar}\\s*;`);
      flowsToReturn = returnPattern.test(afterContext);
    } else {
      // 情况2: 直接作为返回值
      // 匹配模式: return (JSONObject)JSONObject.toJSON(varName);
      const returnMatch = lastLine.match(/return\s+[^;]*$/);
      if (returnMatch) {
        flowsToReturn = true;
      }
    }

    return { resultVar, flowsToReturn };
  }

  private findMethodEnd(content: string, startIndex: number): number {
    let braceCount = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inComment = false;
    let inLineComment = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        continue;
      }

      if (inComment) {
        if (char === '*' && nextChar === '/') {
          inComment = false;
          i++;
        }
        continue;
      }

      if (inSingleQuote) {
        if (char === '\\' && nextChar) {
          i++;
        } else if (char === "'") {
          inSingleQuote = false;
        }
        continue;
      }

      if (inDoubleQuote) {
        if (char === '\\' && nextChar) {
          i++;
        } else if (char === '"') {
          inDoubleQuote = false;
        }
        continue;
      }

      if (char === '/' && nextChar === '*') {
        inComment = true;
        i++;
      } else if (char === '/' && nextChar === '/') {
        inLineComment = true;
        i++;
      } else if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) return i + 1;
      }
    }

    return content.length;
  }
}
