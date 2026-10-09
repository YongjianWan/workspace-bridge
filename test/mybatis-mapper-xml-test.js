#!/usr/bin/env node
// @fast
// @semantic
// MyBatis Mapper XML 纳入依赖图（ROADMAP 阶段 1 · T1.1）夹具测试。
//
// 锁定的契约：
//  - 发现口径：仅「路径含 /mapper/ 或 basename 以 Mapper.xml 结尾」的 .xml 进图；
//    pom.xml、applicationContext.xml 等完全不进索引、不解析、不产生孤儿。
//  - namespace 双向绑定 Mapper 接口（XML→Java 解析产生，Java→XML 建图后处理派生）；
//    类型引用（resultType / parameterType / resultMap type）单向 XML→实体，不得反向。
//  - 类型引用走 resolveImport 策略链；短类名靠符号表兜底，解析不到保持 unresolved，
//    不得猜测误连到无关类。
//  - Mapper XML 是配置不是程序启动点，不得被标成入口。
//  - 非 mapper XML 的解析输出必须为空；解析器是 regex 设计路径，必须
//    parseMode='regex' 且 parseModeReason≠'regex-fallback'（否则缓存永不命中）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const PARSER_PATH = path.join(__dirname, '..', 'src', 'services', 'dep-graph', 'parsers', 'mybatis-xml.js');

const MAPPER_XML_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.demo.mapper.UserMapper">
  <select id="findById" resultType="com.demo.entity.User">
    SELECT * FROM users WHERE id = #{id}
  </select>
  <resultMap id="userMap" type="com.demo.entity.User">
    <id property="id" column="id"/>
  </resultMap>
  <select id="findByShortName" resultType="User">
    SELECT * FROM users WHERE name = #{name}
  </select>
</mapper>
`;

const POM_XML_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.demo</groupId>
  <artifactId>demo</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.mybatis</groupId>
      <artifactId>mybatis</artifactId>
    </dependency>
  </dependencies>
</project>
`;

const APP_CONTEXT_XML_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans">
  <bean id="userService" class="com.demo.service.UserService"/>
  <bean id="userMapper" class="com.demo.mapper.UserMapper"/>
</beans>
`;

const USER_MAPPER_JAVA = `package com.demo.mapper;

import com.demo.entity.User;

public interface UserMapper {
    User findById(long id);
    User findByName(String name);
}
`;

const USER_JAVA = `package com.demo.entity;

public class User {
    private long id;
    private String name;

    public long getId() {
        return id;
    }

    public String getName() {
        return name;
    }
}
`;

const USER_SERVICE_JAVA = `package com.demo.service;

import com.demo.mapper.UserMapper;

public class UserService {
    private UserMapper userMapper;

    public Object findById(long id) {
        return userMapper.findById(id);
    }
}
`;

function write(root, rel, text) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, 'utf8');
  return full;
}

const base = (p) => String(p).replace(/\\/g, '/').split('/').pop().toLowerCase();

const fmtPaths = (paths) => (paths || []).map(base).join(', ') || '(空)';

const fmtRecords = (records) =>
  (records || [])
    .map((r) => `${r.source}→${r.resolved ? base(r.resolved) : 'unresolved'}[${r.importKind || r.patternId || '-'}]`)
    .join(', ') || '(空)';

const oneLine = (err) => String(err && err.message ? err.message : err).split('\n')[0].slice(0, 400);

function makeChecker() {
  const items = [];
  return {
    items,
    check(name, fn) {
      try {
        fn();
        items.push({ name, status: 'ok' });
      } catch (err) {
        items.push({ name, status: 'fail', detail: oneLine(err) });
      }
    },
    notReady(name, detail) {
      items.push({ name, status: 'not-ready', detail });
    },
    report() {
      let ok = 0;
      let fail = 0;
      let notReady = 0;
      console.log('mybatis-mapper-xml-test:');
      for (const item of items) {
        const mark = item.status === 'ok' ? 'OK' : item.status === 'not-ready' ? 'NOT-READY' : 'FAIL';
        if (item.status === 'ok') ok++;
        else if (item.status === 'not-ready') notReady++;
        else fail++;
        console.log(`  ${mark.padEnd(9)} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
      }
      console.log(`mybatis-mapper-xml-test: ${ok} ok, ${fail} fail, ${notReady} not-ready`);
      if (fail + notReady > 0) process.exitCode = 1;
    },
  };
}

function loadParser() {
  try {
    const mod = require(PARSER_PATH);
    const parseMybatisXml = typeof mod === 'function' ? mod : mod && mod.parseMybatisXml;
    return typeof parseMybatisXml === 'function' ? parseMybatisXml : null;
  } catch {
    return null;
  }
}

function assertEmptyParse(result, label) {
  const r = result || {};
  assert.deepStrictEqual(r.imports || [], [], `${label} 不应产生 imports，实际：${fmtPaths(r.imports)}`);
  assert.deepStrictEqual(r.importRecords || [], [], `${label} 不应产生 importRecords，实际：${fmtRecords(r.importRecords)}`);
  assert.deepStrictEqual(r.exports || [], [], `${label} 不应产生 exports，实际：${JSON.stringify(r.exports)}`);
}

async function main() {
  const root = makeTempDir('wb-mybatis-mapper-xml-');
  const checker = makeChecker();
  try {
    write(root, 'pom.xml', POM_XML_CONTENT);
    write(root, 'src/main/resources/applicationContext.xml', APP_CONTEXT_XML_CONTENT);
    write(root, 'src/main/resources/mapper/user/UserMapper.xml', MAPPER_XML_CONTENT);
    write(root, 'src/main/java/com/demo/mapper/UserMapper.java', USER_MAPPER_JAVA);
    write(root, 'src/main/java/com/demo/entity/User.java', USER_JAVA);
    write(root, 'src/main/java/com/demo/service/UserService.java', USER_SERVICE_JAVA);

    const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
    try {
      await container.initialize(root, 120000, { watch: false });
      const dg = container.snapshot.graph;
      const key = (rel) => dg.normalizeFilePath(path.join(root, rel));

      const xmlKey = key('src/main/resources/mapper/user/UserMapper.xml');
      const mapperJavaKey = key('src/main/java/com/demo/mapper/UserMapper.java');
      const userJavaKey = key('src/main/java/com/demo/entity/User.java');
      const serviceJavaKey = key('src/main/java/com/demo/service/UserService.java');

      const allPaths = dg.getAllFilePaths();
      const basenames = allPaths.map(base);

      // ① 发现口径：mapper XML 进图/进索引，其他 XML 完全不进
      checker.check('①图/索引含 UserMapper.xml', () => {
        assert.ok(dg.hasFile(xmlKey), `UserMapper.xml 不在图中；图内文件：${basenames.join(', ') || '(空)'}`);
      });
      checker.check('①夹具 sanity：三份 Java 均在图中', () => {
        for (const k of [mapperJavaKey, userJavaKey, serviceJavaKey]) {
          assert.ok(dg.hasFile(k), `${base(k)} 不在图中；图内文件：${basenames.join(', ') || '(空)'}`);
        }
      });
      checker.check('①图/索引不含 applicationContext.xml、pom.xml', () => {
        assert.ok(!basenames.includes('pom.xml'), 'pom.xml 不应进图');
        assert.ok(!basenames.includes('applicationcontext.xml'), 'applicationContext.xml 不应进图');
      });

      const xmlInGraph = dg.hasFile(xmlKey);
      const xmlDeps = xmlInGraph ? dg.getDependencies(xmlKey) : [];
      const xmlRecords = xmlInGraph ? dg.getFileInfo(xmlKey)?.importRecords || [] : [];
      const xmlDependents = xmlInGraph ? dg.getDependents(xmlKey) : [];

      if (!xmlInGraph) {
        const why = 'UserMapper.xml 未入图（发现口径/解析器实现未就绪）';
        checker.notReady('②XML 引用解析到 UserMapper.java 与 User.java', why);
        checker.notReady('②namespace 记录 importKind=mybatis-namespace → UserMapper.java', why);
        checker.notReady('②类型记录 importKind=mybatis-type（FQCN）→ User.java', why);
        checker.notReady('③UserMapper.java 图边含 UserMapper.xml（反向边）', why);
        checker.notReady('③反向视图：XML 的 dependents 含 UserMapper.java', why);
        checker.notReady('③反向记录标 isImplicit + patternId=mybatis-namespace', why);
        checker.notReady('④User.java 的 imports 不含 UserMapper.xml（类型边单向）', why);
        checker.notReady('④类型边无反向：XML 的 dependents 不含 User.java', why);
        checker.notReady('⑤UserMapper.xml 不被标成入口', why);
        checker.notReady('⑥短类名 resultType="User" 被收集为 mybatis-type 记录', why);
        checker.notReady('⑥短类名只解析到 User.java 或保持 unresolved（不误连）', why);
      } else {
        // ② XML→Java / XML→实体
        checker.check('②XML 引用解析到 UserMapper.java', () => {
          assert.ok(xmlDeps.includes(mapperJavaKey), `UserMapper.xml 的 deps 不含 UserMapper.java；实际：${fmtPaths(xmlDeps)}`);
        });
        checker.check('②XML 引用解析到 User.java', () => {
          assert.ok(xmlDeps.includes(userJavaKey), `UserMapper.xml 的 deps 不含 User.java；实际：${fmtPaths(xmlDeps)}`);
        });
        checker.check('②namespace 记录 importKind=mybatis-namespace → UserMapper.java', () => {
          const rec = xmlRecords.find((r) => r.importKind === 'mybatis-namespace');
          assert.ok(rec, `无 mybatis-namespace 记录；records：${fmtRecords(xmlRecords)}`);
          assert.strictEqual(rec.source, 'com.demo.mapper.UserMapper', `namespace source 应为接口 FQCN，实际：${rec.source}`);
          assert.strictEqual(rec.resolved, mapperJavaKey, `namespace 应解析到 UserMapper.java，实际：${rec.resolved}`);
        });
        checker.check('②类型记录 importKind=mybatis-type（FQCN）→ User.java', () => {
          const rec = xmlRecords.find((r) => r.importKind === 'mybatis-type' && r.source === 'com.demo.entity.User');
          assert.ok(rec, `无 source=com.demo.entity.User 的 mybatis-type 记录；records：${fmtRecords(xmlRecords)}`);
          assert.strictEqual(rec.resolved, userJavaKey, `类型引用应解析到 User.java，实际：${rec.resolved}`);
        });

        // ③ namespace ↔ Mapper 接口双向（Java→XML 为建图后处理派生边）
        const mapperDeps = dg.getDependencies(mapperJavaKey);
        checker.check('③UserMapper.java 图边含 UserMapper.xml（反向边）', () => {
          assert.ok(mapperDeps.includes(xmlKey), `UserMapper.java 的 deps 不含 UserMapper.xml；实际：${fmtPaths(mapperDeps)}`);
        });
        checker.check('③反向视图：XML 的 dependents 含 UserMapper.java', () => {
          assert.ok(xmlDependents.includes(mapperJavaKey), `UserMapper.xml 的 dependents 不含 UserMapper.java；实际：${fmtPaths(xmlDependents)}`);
        });
        checker.check('③反向记录标 isImplicit + patternId=mybatis-namespace', () => {
          const rec = (dg.getFileInfo(mapperJavaKey)?.importRecords || []).find((r) => r.resolved === xmlKey);
          assert.ok(rec, 'UserMapper.java 上没有解析到 UserMapper.xml 的派生记录');
          assert.strictEqual(rec.isImplicit, true, '派生反向记录应标 isImplicit');
          assert.strictEqual(rec.patternId, 'mybatis-namespace', `派生反向记录 patternId 应为 mybatis-namespace，实际：${rec.patternId}`);
        });

        // ④ 类型引用单向：实体不得反向依赖 XML
        checker.check('④User.java 的 imports 不含 UserMapper.xml（类型边单向）', () => {
          const userDeps = dg.getDependencies(userJavaKey);
          assert.ok(!userDeps.includes(xmlKey), `User.java 的 deps 含 UserMapper.xml（类型边被做成双向）；实际：${fmtPaths(userDeps)}`);
        });
        checker.check('④类型边无反向：XML 的 dependents 不含 User.java', () => {
          assert.ok(!xmlDependents.includes(userJavaKey), `UserMapper.xml 的 dependents 含 User.java；实际：${fmtPaths(xmlDependents)}`);
        });

        // ⑤ Mapper XML 是配置不是启动点
        checker.check('⑤UserMapper.xml 不被标成入口', () => {
          assert.strictEqual(dg.isKnownEntryFile(xmlKey), false, 'UserMapper.xml 被标成了入口');
        });

        // ⑥ 短类名 resultType="User"：收集但不猜测
        checker.check('⑥短类名 resultType="User" 被收集为 mybatis-type 记录', () => {
          const rec = xmlRecords.find((r) => r.importKind === 'mybatis-type' && r.source === 'User');
          assert.ok(rec, `短类名 "User" 未被收集；records：${fmtRecords(xmlRecords)}`);
        });
        checker.check('⑥短类名只解析到 User.java 或保持 unresolved（不误连）', () => {
          const shorts = xmlRecords.filter(
            (r) => r.importKind === 'mybatis-type' && !String(r.source || '').includes('.')
          );
          assert.ok(shorts.length >= 1, `无短类名 mybatis-type 记录；records：${fmtRecords(xmlRecords)}`);
          for (const rec of shorts) {
            assert.ok(
              !rec.resolved || rec.resolved === userJavaKey,
              `短类名 ${rec.source} 误连到 ${rec.resolved}（应为 User.java 或 unresolved）`
            );
          }
          assert.ok(!xmlDeps.includes(serviceJavaKey), `UserMapper.xml 误连到无关类 UserService.java；实际：${fmtPaths(xmlDeps)}`);
        });
      }

      // ⑦ 非 mapper XML 的解析输出为空（解析器防御式契约）
      // ⑧ 解析契约守卫（设计契约 2/3）：regex 设计路径、importKind、短类名收集
      const parseMybatisXml = loadParser();
      const mapperXmlFull = path.join(root, 'src/main/resources/mapper/user/UserMapper.xml');
      const pomFull = path.join(root, 'pom.xml');
      const appCtxFull = path.join(root, 'src/main/resources/applicationContext.xml');

      if (!parseMybatisXml) {
        const why = 'src/services/dep-graph/parsers/mybatis-xml.js 未就绪（解析器实现未就绪）';
        checker.notReady('⑦非 mapper XML 解析输出为空（pom.xml）', why);
        checker.notReady('⑦非 mapper XML 解析输出为空（applicationContext.xml）', why);
        checker.notReady('⑧解析契约：parseMode=regex 且 parseModeReason≠regex-fallback', why);
        checker.notReady('⑧解析契约：importKind 记录与短类名收集', why);
      } else {
        checker.check('⑦非 mapper XML 解析输出为空（pom.xml）', () => {
          assertEmptyParse(parseMybatisXml(POM_XML_CONTENT, pomFull), 'pom.xml');
        });
        checker.check('⑦非 mapper XML 解析输出为空（applicationContext.xml）', () => {
          assertEmptyParse(parseMybatisXml(APP_CONTEXT_XML_CONTENT, appCtxFull), 'applicationContext.xml');
        });
        checker.check('⑧解析契约：parseMode=regex 且 parseModeReason≠regex-fallback', () => {
          const r = parseMybatisXml(MAPPER_XML_CONTENT, mapperXmlFull) || {};
          assert.strictEqual(r.parseMode, 'regex', `parseMode 应为 regex（regex 设计路径），实际：${r.parseMode}`);
          assert.ok(
            typeof r.parseModeReason === 'string' && r.parseModeReason.length > 0 && r.parseModeReason !== 'regex-fallback',
            `parseModeReason 应为明确的非 regex-fallback 值（否则缓存永不命中），实际：${r.parseModeReason}`
          );
        });
        checker.check('⑧解析契约：importKind 记录与短类名收集', () => {
          const records = parseMybatisXml(MAPPER_XML_CONTENT, mapperXmlFull)?.importRecords || [];
          const ns = records.find((r) => r.importKind === 'mybatis-namespace' && r.source === 'com.demo.mapper.UserMapper');
          assert.ok(ns, `缺 namespace 记录；records：${fmtRecords(records)}`);
          const fqcnType = records.find((r) => r.importKind === 'mybatis-type' && r.source === 'com.demo.entity.User');
          assert.ok(fqcnType, `缺 FQCN 类型记录；records：${fmtRecords(records)}`);
          const shortType = records.find((r) => r.importKind === 'mybatis-type' && r.source === 'User');
          assert.ok(shortType, `缺短类名类型记录；records：${fmtRecords(records)}`);
        });
      }
    } finally {
      await container.shutdown();
    }
  } finally {
    cleanupTempDir(root);
    checker.report();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
