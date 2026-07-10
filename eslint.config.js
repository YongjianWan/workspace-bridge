// eslint flat config — 只做正确性检查（recommended 级），不做风格约束。
// 风格一致性由 AGENTS.md TASTE 规则 + code review 负责，lint 只拦截真 bug 信号。
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'reference/**',
      'coverage/**',
      'scratch/**',
      'skills/**',
      'docs/**',
      '.workspace-bridge/**',
      'benchmark/results/**',
      'test-temp/**',
      '.playwright-mcp/**',
      // 测试夹具含故意的语法错误/边界语法，不属于 lint 对象
      'test/fixtures/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 下划线前缀 = 有意未使用（如解构丢弃、接口占位）
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // CLI 工具的 console 输出是产品行为，不是调试残留
      'no-console': 'off',
      // 空 catch 在降级路径中是显式设计（L1 铁律：shutdown/cleanup 逐步骤 try-catch）
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
