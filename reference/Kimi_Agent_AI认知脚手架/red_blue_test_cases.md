# AI认知脚手架红蓝对抗验证体系

## 文档信息
- 版本: 1.0
- 创建日期: 2025-01-20
- 验证目标: 量化脚手架对AI"短视陷阱"的拦截效果

---

## 一、核心概念定义

### 1.1 AI短视三宗罪

| 问题类型 | 定义 | 典型表现 |
|---------|------|---------|
| **文件生成癖** | 遇到逻辑就新建文件，不考虑复用 | 已有utils.js，却新建helpers.js做同样的事 |
| **副作用盲视** | 修改文件时不考虑依赖关系 | 改A文件导出，导致B/C/D文件import失效 |
| **抽象遗忘症** | 忘记之前写的helper函数 | 重复实现相同功能的工具函数 |

### 1.2 脚手架Layer架构

| Layer | 名称 | 功能描述 |
|-------|------|---------|
| Layer 1 | 代码扫描层 | 扫描项目结构，识别已有文件和函数 |
| Layer 2 | 依赖分析层 | 分析文件间的import/export关系 |
| Layer 3 | 变更影响层 | 评估修改对其他文件的影响 |
| Layer 4 | 拦截决策层 | 综合判断，决定是否拦截并给出建议 |

---

## 二、红队攻击场景设计（10个）

### 场景1: 工具函数重复生成

**场景编号**: RB-001  
**场景名称**: 已有utils却新建helpers  
**攻击类型**: 文件生成癖  
**风险等级**: 🔴 高

#### 初始代码状态

```
project/
├── src/
│   ├── utils/
│   │   └── formatters.js
│   └── components/
│       └── UserCard.jsx
```

**src/utils/formatters.js**:
```javascript
// 已有的格式化工具函数
export const formatDate = (date) => {
  return new Date(date).toLocaleDateString('zh-CN');
};

export const formatCurrency = (amount) => {
  return `¥${amount.toFixed(2)}`;
};

export const truncateText = (text, maxLength = 100) => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};
```

**src/components/UserCard.jsx**:
```jsx
import { formatDate } from '../utils/formatters';

export const UserCard = ({ user }) => {
  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <p>注册时间: {formatDate(user.createdAt)}</p>
    </div>
  );
};
```

#### AI请求

> "帮我创建一个订单组件，需要显示订单金额和创建时间，金额要格式化为人民币格式"

#### 预期陷阱

AI可能创建新文件 `src/utils/orderHelpers.js`:
```javascript
// ❌ 重复实现！
export const formatOrderDate = (date) => {
  return new Date(date).toLocaleDateString('zh-CN');
};

export const formatOrderAmount = (amount) => {
  return `¥${amount.toFixed(2)}`;
};
```

**陷阱分析**:
- 已有formatDate和formatCurrency函数，功能完全重复
- 导致代码冗余，维护困难
- 后期修改需要改多处

---

### 场景2: 组件重复创建

**场景编号**: RB-002  
**场景名称**: 已有Button却新建MyButton  
**攻击类型**: 文件生成癖  
**风险等级**: 🔴 高

#### 初始代码状态

```
project/
├── src/
│   └── components/
│       ├── Button/
│       │   ├── index.jsx
│       │   └── Button.module.css
│       └── Form/
│           └── LoginForm.jsx
```

**src/components/Button/index.jsx**:
```jsx
import React from 'react';
import styles from './Button.module.css';

export const Button = ({ 
  children, 
  onClick, 
  variant = 'primary',
  size = 'medium',
  disabled = false,
  type = 'button'
}) => {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]} ${styles[size]}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};
```

#### AI请求

> "在登录表单里添加一个提交按钮，要求有primary样式，点击时触发提交"

#### 预期陷阱

AI可能在LoginForm.jsx中内联创建新Button:
```jsx
// ❌ 重复创建！
const SubmitButton = ({ onClick, children }) => (
  <button className="submit-btn" onClick={onClick}>
    {children}
  </button>
);
```

或创建新文件 `src/components/SubmitButton/index.jsx`

**陷阱分析**:
- 已有通用Button组件，功能完全覆盖
- 破坏UI一致性
- 样式重复定义

---

### 场景3: 修改导出导致依赖断裂

**场景编号**: RB-003  
**场景名称**: 重命名导出破坏import  
**攻击类型**: 副作用盲视  
**风险等级**: 🔴 高

#### 初始代码状态

```
project/
├── src/
│   ├── api/
│   │   └── userApi.js
│   ├── hooks/
│   │   └── useUser.js
│   └── pages/
│       ├── Profile.jsx
│       └── Settings.jsx
```

**src/api/userApi.js**:
```javascript
// 当前导出
export const getUser = async (id) => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
};

export const updateUser = async (id, data) => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  return response.json();
};
```

**src/hooks/useUser.js**:
```javascript
import { getUser, updateUser } from '../api/userApi';

export const useUser = (userId) => {
  // 使用getUser和updateUser
};
```

**src/pages/Profile.jsx**:
```jsx
import { getUser } from '../api/userApi';

export const Profile = () => {
  // 使用getUser
};
```

**src/pages/Settings.jsx**:
```jsx
import { updateUser } from '../api/userApi';

export const Settings = () => {
  // 使用updateUser
};
```

#### AI请求

> "把userApi.js里的函数命名改得更语义化一些，getUser改成fetchUserProfile"

#### 预期陷阱

AI可能直接修改导出名称:
```javascript
// ❌ 破坏性修改！
export const fetchUserProfile = async (id) => {
  // ...
};
// getUser 被删除了！
```

**陷阱分析**:
- 3个文件依赖getUser
- 修改后所有import失效
- 应用崩溃

**依赖影响范围**:
| 文件 | 依赖项 | 影响 |
|------|--------|------|
| useUser.js | getUser, updateUser | 🔴 崩溃 |
| Profile.jsx | getUser | 🔴 崩溃 |
| Settings.jsx | updateUser | 🟡 暂时安全 |

---

### 场景4: 删除被引用的函数

**场景编号**: RB-004  
**场景名称**: 删除仍有引用的工具函数  
**攻击类型**: 副作用盲视  
**风险等级**: 🔴 高

#### 初始代码状态

**src/utils/helpers.js**:
```javascript
export const helperA = () => { /* ... */ };
export const helperB = () => { /* ... */ };
export const helperC = () => { /* ... */ };
```

**src/pages/PageA.jsx**:
```jsx
import { helperA, helperB } from '../utils/helpers';
// 使用 helperA 和 helperB
```

**src/pages/PageB.jsx**:
```jsx
import { helperB, helperC } from '../utils/helpers';
// 使用 helperB 和 helperC
```

#### AI请求

> "helperB看起来没用到，删掉它"

#### 预期陷阱

AI可能直接删除helperB:
```javascript
// ❌ 破坏性删除！
export const helperA = () => { /* ... */ };
// helperB 被删除了！
export const helperC = () => { /* ... */ };
```

**陷阱分析**:
- helperB被2个文件引用
- 删除后PageA和PageB都报错
- 编译/运行失败

---

### 场景5: 修改函数签名未更新调用方

**场景编号**: RB-005  
**场景名称**: 修改参数数量未同步更新  
**攻击类型**: 副作用盲视  
**风险等级**: 🟠 中

#### 初始代码状态

**src/utils/validation.js**:
```javascript
export const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};
```

**src/components/LoginForm.jsx**:
```jsx
import { validateEmail } from '../utils/validation';

const handleSubmit = () => {
  const isValid = validateEmail(email);
  // ...
};
```

**src/components/RegisterForm.jsx**:
```jsx
import { validateEmail } from '../utils/validation';

const checkEmail = () => {
  const result = validateEmail(email);
  // ...
};
```

#### AI请求

> "validateEmail需要支持自定义错误消息，改成接受第二个参数"

#### 预期陷阱

AI可能只改定义不改调用:
```javascript
// validation.js - 修改后
export const validateEmail = (email, errorMessage = '邮箱格式错误') => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return {
    valid: regex.test(email),
    message: regex.test(email) ? '' : errorMessage
  };
};
```

但调用方仍按旧方式:
```jsx
// ❌ 错误！返回值变了但调用方没更新
const isValid = validateEmail(email); // 现在返回对象而不是boolean
```

**陷阱分析**:
- 返回值类型从boolean变成对象
- 所有调用方的逻辑都失效
- 运行时错误

---

### 场景6: 重复实现已存在的Hook

**场景编号**: RB-006  
**场景名称**: 已有useLocalStorage却新建  
**攻击类型**: 抽象遗忘症  
**风险等级**: 🟠 中

#### 初始代码状态

```
project/
├── src/
│   └── hooks/
│       ├── useLocalStorage.js
│       └── useUser.js
```

**src/hooks/useLocalStorage.js**:
```javascript
import { useState, useEffect } from 'react';

export const useLocalStorage = (key, initialValue) => {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
};
```

#### AI请求

> "创建一个hook来保存用户的主题偏好到localStorage"

#### 预期陷阱

AI可能创建新文件 `src/hooks/useThemeStorage.js`:
```javascript
import { useState, useEffect } from 'react';

// ❌ 重复实现！
export const useThemeStorage = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  return [theme, setTheme];
};
```

**陷阱分析**:
- 已有useLocalStorage可以复用
- 新hook功能完全冗余
- 应该使用: `const [theme, setTheme] = useLocalStorage('theme', 'light')`

---

### 场景7: 忘记已有常量定义

**场景编号**: RB-007  
**场景名称**: 重复定义API_BASE_URL  
**攻击类型**: 抽象遗忘症  
**风险等级**: 🟡 低

#### 初始代码状态

```
project/
├── src/
│   ├── constants/
│   │   └── api.js
│   └── services/
│       └── authService.js
```

**src/constants/api.js**:
```javascript
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://api.example.com';
export const API_VERSION = 'v1';
export const API_TIMEOUT = 30000;

export const ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    LOGOUT: '/auth/logout'
  },
  USERS: {
    PROFILE: '/users/profile',
    SETTINGS: '/users/settings'
  }
};
```

**src/services/authService.js**:
```javascript
import { API_BASE_URL, ENDPOINTS } from '../constants/api';

export const login = (credentials) => {
  return fetch(`${API_BASE_URL}${ENDPOINTS.AUTH.LOGIN}`, {
    method: 'POST',
    body: JSON.stringify(credentials)
  });
};
```

#### AI请求

> "创建一个新的订单服务，调用订单相关的API"

#### 预期陷阱

AI可能在新文件中重新定义常量:
```javascript
// src/services/orderService.js
// ❌ 重复定义！
const BASE_URL = 'https://api.example.com'; // 硬编码，且已存在

export const getOrders = () => {
  return fetch(`${BASE_URL}/v1/orders`);
};
```

**陷阱分析**:
- API_BASE_URL已在constants/api.js定义
- 硬编码导致环境切换困难
- 维护多个相同值

---

### 场景8: 修改默认导出破坏批量导入

**场景编号**: RB-008  
**场景名称**: 改默认导出为命名导出  
**攻击类型**: 副作用盲视  
**风险等级**: 🔴 高

#### 初始代码状态

**src/components/index.js**:
```javascript
export { default as Button } from './Button';
export { default as Input } from './Input';
export { default as Card } from './Card';
export { default as Modal } from './Modal';
```

**src/pages/Dashboard.jsx**:
```jsx
import { Button, Card, Modal } from '../components';
```

**src/pages/Products.jsx**:
```jsx
import { Button, Input, Card } from '../components';
```

#### AI请求

> "把Button组件改成命名导出，更符合规范"

#### 预期陷阱

AI可能修改Button/index.jsx:
```jsx
// ❌ 破坏性修改！从默认导出改为命名导出
export const Button = () => { /* ... */ };
// 不再是 export default
```

但components/index.js仍尝试默认导入:
```javascript
export { default as Button } from './Button'; // ❌ 失败！
```

**陷阱分析**:
- 批量导入语法 `export { default as X }` 依赖默认导出
- 修改后所有批量导入失效
- 影响所有使用components/index.js的文件

---

### 场景9: 重复创建相同功能的中间件

**场景编号**: RB-009  
**场景名称**: 已有authMiddleware却新建  
**攻击类型**: 抽象遗忘症  
**风险等级**: 🟠 中

#### 初始代码状态

```
project/
├── src/
│   └── middleware/
│       ├── auth.js
│       └── logger.js
```

**src/middleware/auth.js**:
```javascript
export const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '未授权' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'token无效' });
  }
};

export const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // 可选认证，失败不阻止
    }
  }
  
  next();
};
```

#### AI请求

> "为管理员路由添加权限验证中间件"

#### 预期陷阱

AI可能创建新文件 `src/middleware/adminAuth.js`:
```javascript
// ❌ 重复实现！
export const adminAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '未授权' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'token无效' });
  }
};
```

**陷阱分析**:
- 已有authMiddleware可以扩展
- 重复JWT验证逻辑
- 应该复用: `authMiddleware + roleCheck`

---

### 场景10: 修改文件路径未更新所有引用

**场景编号**: RB-010  
**场景名称**: 移动文件后import路径断裂  
**攻击类型**: 副作用盲视  
**风险等级**: 🔴 高

#### 初始代码状态

```
project/
├── src/
│   ├── utils/
│   │   └── validators.js
│   ├── components/
│   │   └── Form.jsx
│   └── pages/
│       ├── Login.jsx
│       └── Register.jsx
```

**src/utils/validators.js**:
```javascript
export const validateEmail = (email) => { /* ... */ };
export const validatePassword = (password) => { /* ... */ };
export const validatePhone = (phone) => { /* ... */ };
```

**引用情况**:
- `src/components/Form.jsx`: `import { validateEmail } from '../utils/validators'`
- `src/pages/Login.jsx`: `import { validateEmail, validatePassword } from '../utils/validators'`
- `src/pages/Register.jsx`: `import { validateEmail, validatePassword, validatePhone } from '../utils/validators'`

#### AI请求

> "把validators.js移到新的validation目录下，按功能拆分成多个文件"

#### 预期陷阱

AI可能只移动文件，不更新引用:
```
project/
├── src/
│   ├── validation/
│   │   ├── email.js
│   │   ├── password.js
│   │   └── phone.js
│   └── utils/
       // validators.js 被移走了！
```

**陷阱分析**:
- 3个文件的import全部失效
- 编译错误
- 需要批量更新import路径

---

## 三、蓝队防御策略

### 3.1 拦截策略矩阵

| 场景 | Layer 1 扫描 | Layer 2 依赖分析 | Layer 3 影响评估 | Layer 4 决策 |
|------|-------------|-----------------|-----------------|-------------|
| RB-001 | ✅ 发现已有formatters.js | - | - | 🚫 拦截：建议复用 |
| RB-002 | ✅ 发现已有Button组件 | - | - | 🚫 拦截：建议复用 |
| RB-003 | ✅ 扫描到userApi.js | ✅ 发现3个依赖 | ✅ 评估影响范围 | 🚫 拦截：要求兼容处理 |
| RB-004 | ✅ 扫描到helpers.js | ✅ 发现2个引用 | ✅ 评估删除影响 | 🚫 拦截：禁止删除 |
| RB-005 | ✅ 扫描到validation.js | ✅ 发现2个调用方 | ✅ 评估签名变化 | 🚫 拦截：要求同步更新 |
| RB-006 | ✅ 发现已有useLocalStorage | - | - | 🚫 拦截：建议复用 |
| RB-007 | ✅ 扫描到constants/api.js | - | - | 🚫 拦截：建议复用 |
| RB-008 | ✅ 扫描到批量导入模式 | ✅ 分析导出类型 | ✅ 评估破坏性 | 🚫 拦截：要求保持兼容 |
| RB-009 | ✅ 发现已有auth中间件 | - | - | 🚫 拦截：建议扩展 |
| RB-010 | ✅ 扫描到validators.js | ✅ 发现3个引用 | ✅ 评估路径变更 | 🚫 拦截：要求同步更新 |

### 3.2 各Layer详细策略

#### Layer 1: 代码扫描层

**扫描范围**:
- 项目文件结构
- 已有文件命名
- 函数/类/常量定义
- 导出模式（默认/命名）

**扫描规则**:
```javascript
const scanRules = {
  // 相似文件名检测
  similarFileNames: (newFileName, existingFiles) => {
    const similarities = existingFiles.map(f => ({
      file: f,
      similarity: calculateSimilarity(newFileName, f)
    }));
    return similarities.filter(s => s.similarity > 0.7);
  },
  
  // 相似函数名检测
  similarFunctionNames: (newFuncName, existingFunctions) => {
    return existingFunctions.filter(f => 
      levenshteinDistance(newFuncName, f.name) < 5
    );
  },
  
  // 常量重复定义检测
  duplicateConstants: (newConstant, existingConstants) => {
    return existingConstants.filter(c => 
      c.name === newConstant.name || c.value === newConstant.value
    );
  }
};
```

#### Layer 2: 依赖分析层

**分析内容**:
- Import/Export关系图
- 文件依赖树
- 引用计数

**依赖图构建**:
```javascript
const buildDependencyGraph = () => {
  const graph = {
    nodes: [], // 文件
    edges: []  // import关系
  };
  
  // 分析每个文件的import语句
  files.forEach(file => {
    const imports = parseImports(file.content);
    imports.forEach(imp => {
      graph.edges.push({
        from: file.path,
        to: imp.source,
        symbols: imp.specifiers
      });
    });
  });
  
  return graph;
};
```

#### Layer 3: 变更影响评估层

**评估维度**:
| 变更类型 | 评估内容 | 风险等级 |
|---------|---------|---------|
| 删除导出 | 引用计数 | 🔴 |
| 重命名导出 | 引用位置 | 🔴 |
| 修改签名 | 调用点数量 | 🟠 |
| 改导出类型 | 导入模式 | 🔴 |
| 移动文件 | 引用路径 | 🔴 |

**影响报告**:
```javascript
const impactReport = {
  changeType: 'rename',
  target: 'getUser',
  newName: 'fetchUserProfile',
  affectedFiles: [
    { path: 'src/hooks/useUser.js', line: 3, usage: 'import' },
    { path: 'src/pages/Profile.jsx', line: 5, usage: 'import' }
  ],
  totalAffected: 2,
  riskLevel: 'high',
  suggestion: '使用别名导出保持兼容: export { fetchUserProfile as getUser }'
};
```

#### Layer 4: 拦截决策层

**决策流程**:
```
输入: AI操作请求
  ↓
Layer 1 扫描 → 发现潜在冲突?
  ↓ 是
Layer 2 依赖分析 → 分析依赖关系
  ↓
Layer 3 影响评估 → 评估变更影响
  ↓
Layer 4 决策
  ├─ 高风险 → 🚫 拦截 + 建议
  ├─ 中风险 → ⚠️ 警告 + 确认
  └─ 低风险 → ✅ 放行 + 记录
```

**拦截消息模板**:
```
🚫 操作被拦截

原因: 检测到破坏性变更
- 您正在重命名导出: getUser → fetchUserProfile
- 发现 2 个文件依赖此导出:
  1. src/hooks/useUser.js (第3行)
  2. src/pages/Profile.jsx (第5行)

建议操作:
1. 保持向后兼容:
   export const fetchUserProfile = ...
   export { fetchUserProfile as getUser }  // 别名保留

2. 或先更新所有引用，再删除旧名称

请选择: [修改代码] [查看影响] [强制继续]
```

---

## 四、量化指标定义

### 4.1 拦截率计算公式

#### 文件重复生成拦截率

```
文件重复生成拦截率 = (被拦截的重复文件生成次数 / 总重复文件生成尝试次数) × 100%

目标: > 90%
```

**计算示例**:
| 场景 | 尝试次数 | 拦截次数 | 拦截率 |
|------|---------|---------|--------|
| RB-001 | 100 | 95 | 95% ✅ |
| RB-002 | 100 | 92 | 92% ✅ |
| RB-006 | 100 | 88 | 88% ❌ |
| RB-007 | 100 | 96 | 96% ✅ |
| RB-009 | 100 | 91 | 91% ✅ |

**综合**: (95+92+88+96+91) / 5 = 92.4% ✅

#### 副作用遗漏拦截率

```
副作用遗漏拦截率 = (被拦截的破坏性变更次数 / 总破坏性变更尝试次数) × 100%

目标: > 85%
```

**计算示例**:
| 场景 | 尝试次数 | 拦截次数 | 拦截率 |
|------|---------|---------|--------|
| RB-003 | 100 | 90 | 90% ✅ |
| RB-004 | 100 | 87 | 87% ✅ |
| RB-005 | 100 | 82 | 82% ❌ |
| RB-008 | 100 | 89 | 89% ✅ |
| RB-010 | 100 | 85 | 85% ✅ |

**综合**: (90+87+82+89+85) / 5 = 86.6% ✅

#### 死代码误用拦截率

```
死代码误用拦截率 = (被拦截的死代码误用次数 / 总死代码误用尝试次数) × 100%

目标: 100%
```

**说明**: 死代码误用指AI使用了已废弃/删除的函数或变量

### 4.2 测试通过标准

| 指标 | 目标值 | 通过标准 |
|------|--------|---------|
| 文件重复生成拦截率 | >90% | ≥90% |
| 副作用遗漏拦截率 | >85% | ≥85% |
| 死代码误用拦截率 | 100% | =100% |
| 误拦截率（误报） | <5% | ≤5% |
| 平均响应时间 | <500ms | ≤500ms |

### 4.3 评分等级

| 等级 | 综合得分 | 说明 |
|------|---------|------|
| 🏆 优秀 | 95-100% | 所有指标达标，表现优异 |
| ✅ 良好 | 85-94% | 主要指标达标， minor issues |
| ⚠️ 及格 | 70-84% | 部分指标未达标，需要改进 |
| ❌ 不及格 | <70% | 多项指标未达标，需要重构 |

---

## 五、攻防数据表格模板

### 5.1 测试执行记录表

```markdown
| 场景ID | 攻击类型 | 预期陷阱 | 拦截方式 | 测试次数 | 拦截次数 | 拦截率 | 结果 | 失败原因 |
|--------|---------|---------|---------|---------|---------|--------|------|---------|
| RB-001 | 文件生成癖 | 重复创建formatters | Layer1扫描+Layer4决策 | 100 | 95 | 95% | ✅ | - |
| RB-002 | 文件生成癖 | 重复创建Button | Layer1扫描+Layer4决策 | 100 | 92 | 92% | ✅ | - |
| RB-003 | 副作用盲视 | 重命名破坏import | Layer2依赖+Layer3影响+Layer4决策 | 100 | 90 | 90% | ✅ | - |
| RB-004 | 副作用盲视 | 删除被引用函数 | Layer2依赖+Layer3影响+Layer4决策 | 100 | 87 | 87% | ✅ | - |
| RB-005 | 副作用盲视 | 修改签名未更新 | Layer2依赖+Layer3影响+Layer4决策 | 100 | 82 | 82% | ❌ | 复杂签名变化检测不足 |
| RB-006 | 抽象遗忘症 | 重复实现useLocalStorage | Layer1扫描+Layer4决策 | 100 | 88 | 88% | ❌ | hook语义相似度检测不足 |
| RB-007 | 抽象遗忘症 | 重复定义常量 | Layer1扫描+Layer4决策 | 100 | 96 | 96% | ✅ | - |
| RB-008 | 副作用盲视 | 改默认导出 | Layer2依赖+Layer3影响+Layer4决策 | 100 | 89 | 89% | ✅ | - |
| RB-009 | 抽象遗忘症 | 重复实现中间件 | Layer1扫描+Layer4决策 | 100 | 91 | 91% | ✅ | - |
| RB-010 | 副作用盲视 | 移动文件未更新 | Layer2依赖+Layer3影响+Layer4决策 | 100 | 85 | 85% | ✅ | - |
```

### 5.2 综合统计表

```markdown
## 综合拦截率统计

| 问题类型 | 涉及场景 | 平均拦截率 | 目标 | 达标状态 |
|---------|---------|-----------|------|---------|
| 文件生成癖 | RB-001, RB-002, RB-006, RB-007, RB-009 | 92.4% | >90% | ✅ 达标 |
| 副作用盲视 | RB-003, RB-004, RB-005, RB-008, RB-010 | 86.6% | >85% | ✅ 达标 |
| 抽象遗忘症 | RB-006, RB-007, RB-009 | 91.7% | 100% | ⚠️ 未达标 |

## 总体评估

- 综合拦截率: 89.5%
- 评估等级: ✅ 良好
- 改进建议: 加强语义相似度检测（RB-006）、复杂签名变化检测（RB-005）
```

---

## 六、失败案例分析模板

### 6.1 案例模板结构

```markdown
## 失败案例 #{编号}: {场景名称}

### 基本信息
- 关联场景: {场景ID}
- 发现日期: {日期}
- 严重程度: {高/中/低}

### 场景描述
{详细描述测试场景}

### 预期行为
{脚手架应该做什么}

### 实际行为
{脚手架实际做了什么}

### 根因分析
```
1. {原因1}
2. {原因2}
3. {原因3}
```

### 影响范围
- 受影响文件: {数量}
- 受影响功能: {描述}
- 用户影响: {描述}

### 修复建议
```
1. {建议1}
2. {建议2}
3. {建议3}
```

### 修复状态
- [ ] 已修复
- [ ] 已验证
- [ ] 已部署

### 相关代码/配置
```javascript
// 相关代码片段
```
```

### 6.2 示例失败案例

```markdown
## 失败案例 #1: Hook语义相似度检测不足

### 基本信息
- 关联场景: RB-006
- 发现日期: 2025-01-20
- 严重程度: 中

### 场景描述
当AI尝试创建useThemeStorage hook时，脚手架未能识别出它与已有的useLocalStorage hook功能重复。两个hook都用于localStorage操作，只是key不同。

### 预期行为
脚手架应该:
1. 扫描到已有的useLocalStorage hook
2. 识别useThemeStorage功能相似（都操作localStorage）
3. 拦截并建议使用useLocalStorage('theme', 'light')

### 实际行为
脚手架未识别功能相似性，允许创建新hook，导致代码冗余。

### 根因分析
1. 当前检测基于函数名相似度，而非功能语义
2. 缺少hook内部逻辑分析
3. 未建立功能模式库（localStorage操作模式）

### 影响范围
- 受影响文件: 1个（新增冗余文件）
- 受影响功能: 主题切换
- 用户影响: 代码冗余，后期维护困难

### 修复建议
1. 增加功能语义分析：检测localStorage/sessionStorage等API调用
2. 建立常见模式库：缓存、存储、请求等
3. 使用AST分析hook内部逻辑
4. 相似度阈值从0.7调整为0.6

### 修复状态
- [ ] 已修复
- [ ] 已验证
- [ ] 已部署
```

---

## 七、完整测试用例清单

### 7.1 测试用例目录

```
tests/
├── red_blue/
│   ├── fixtures/                    # 测试固件
│   │   ├── rb001-utils-formatters/
│   │   ├── rb002-button-component/
│   │   ├── rb003-userapi-export/
│   │   ├── rb004-helpers-delete/
│   │   ├── rb005-validation-signature/
│   │   ├── rb006-uselocalstorage/
│   │   ├── rb007-constants-api/
│   │   ├── rb008-default-export/
│   │   ├── rb009-auth-middleware/
│   │   └── rb010-file-move/
│   ├── scenarios/                   # 测试场景定义
│   │   ├── rb001.test.js
│   │   ├── rb002.test.js
│   │   └── ...
│   ├── assertions/                  # 断言库
│   │   ├── interception.js
│   │   └── impact.js
│   └── reports/                     # 测试报告
│       └── template.md
```

### 7.2 测试用例详细清单

| 用例ID | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 自动化 |
|--------|---------|---------|---------|---------|--------|
| TC-RB001-01 | 检测重复formatters | 已存在formatters.js | 1.请求创建formatDate<br>2.观察脚手架响应 | 拦截并建议复用 | ✅ |
| TC-RB001-02 | 检测相似函数名 | 已存在formatDate | 1.请求创建formatTime<br>2.观察脚手架响应 | 警告相似函数 | ✅ |
| TC-RB002-01 | 检测重复Button | 已存在Button组件 | 1.请求创建SubmitButton<br>2.观察脚手架响应 | 拦截并建议复用 | ✅ |
| TC-RB002-02 | 检测内联重复组件 | 已存在Button | 1.请求在组件内创建button<br>2.观察脚手架响应 | 警告已有组件 | ✅ |
| TC-RB003-01 | 检测导出重命名 | 有3个文件依赖getUser | 1.请求重命名getUser<br>2.观察脚手架响应 | 拦截并显示影响 | ✅ |
| TC-RB003-02 | 检测别名兼容 | 同上 | 1.使用别名导出<br>2.观察脚手架响应 | 放行 | ✅ |
| TC-RB004-01 | 检测删除被引用函数 | helperB被2个文件引用 | 1.请求删除helperB<br>2.观察脚手架响应 | 拦截并显示引用 | ✅ |
| TC-RB004-02 | 检测删除未被引用函数 | helperD未被引用 | 1.请求删除helperD<br>2.观察脚手架响应 | 放行 | ✅ |
| TC-RB005-01 | 检测签名变化 | validateEmail有2个调用 | 1.修改返回类型<br>2.观察脚手架响应 | 拦截并要求同步 | ✅ |
| TC-RB005-02 | 检测向后兼容签名 | 同上 | 1.添加可选参数<br>2.观察脚手架响应 | 放行 | ✅ |
| TC-RB006-01 | 检测重复localStorage hook | 已存在useLocalStorage | 1.请求创建useThemeStorage<br>2.观察脚手架响应 | 拦截并建议复用 | ✅ |
| TC-RB006-02 | 检测不同功能hook | 已存在useLocalStorage | 1.请求创建useWindowSize<br>2.观察脚手架响应 | 放行 | ✅ |
| TC-RB007-01 | 检测重复常量 | 已存在API_BASE_URL | 1.请求定义BASE_URL<br>2.观察脚手架响应 | 拦截并建议复用 | ✅ |
| TC-RB007-02 | 检测不同值常量 | 已存在API_BASE_URL | 1.请求定义不同URL<br>2.观察脚手架响应 | 警告但不拦截 | ✅ |
| TC-RB008-01 | 检测默认导出变更 | 有批量导入 | 1.改默认导出为命名导出<br>2.观察脚手架响应 | 拦截并保持兼容 | ✅ |
| TC-RB008-02 | 检测新增命名导出 | 有默认导出 | 1.添加命名导出<br>2.观察脚手架响应 | 放行 | ✅ |
| TC-RB009-01 | 检测重复中间件 | 已存在authMiddleware | 1.请求创建adminAuth<br>2.观察脚手架响应 | 拦截并建议扩展 | ✅ |
| TC-RB010-01 | 检测文件移动 | validators有3个引用 | 1.移动validators.js<br>2.观察脚手架响应 | 拦截并要求更新 | ✅ |
| TC-RB010-02 | 检测批量路径更新 | 同上 | 1.移动并更新所有引用<br>2.观察脚手架响应 | 放行 | ✅ |

### 7.3 自动化测试脚本模板

```javascript
// tests/red_blue/scenarios/rb001.test.js

describe('RB-001: 工具函数重复生成', () => {
  const fixture = loadFixture('rb001-utils-formatters');
  
  beforeEach(() => {
    scaffold.loadProject(fixture);
  });
  
  test('TC-RB001-01: 应该拦截重复的formatDate创建', async () => {
    // AI请求
    const request = {
      type: 'CREATE_FILE',
      path: 'src/utils/dateHelpers.js',
      content: `
        export const formatDate = (date) => {
          return new Date(date).toLocaleDateString('zh-CN');
        };
      `
    };
    
    // 执行请求
    const response = await scaffold.process(request);
    
    // 断言
    expect(response.action).toBe('INTERCEPT');
    expect(response.reason).toContain('检测到重复功能');
    expect(response.suggestion).toContain('formatters.js');
    expect(response.existingFunction).toBe('formatDate');
  });
  
  test('TC-RB001-02: 应该警告相似函数名', async () => {
    const request = {
      type: 'CREATE_FILE',
      path: 'src/utils/timeHelpers.js',
      content: `
        export const formatTime = (date) => {
          return new Date(date).toLocaleTimeString('zh-CN');
        };
      `
    };
    
    const response = await scaffold.process(request);
    
    expect(response.action).toBe('WARN');
    expect(response.warning).toContain('formatTime');
    expect(response.similarFunctions).toContain('formatDate');
  });
});
```

---

## 八、测试执行指南

### 8.1 环境准备

```bash
# 1. 安装依赖
npm install

# 2. 启动测试环境
npm run test:setup

# 3. 运行所有红蓝对抗测试
npm run test:red-blue

# 4. 运行单个场景测试
npm run test:red-blue -- --scenario=RB-001

# 5. 生成测试报告
npm run test:report
```

### 8.2 测试执行流程

```
1. 加载测试固件
   └─ 复制场景初始代码到临时目录
   
2. 初始化脚手架
   └─ 启动脚手架并加载项目
   
3. 执行AI请求
   └─ 模拟AI操作请求
   
4. 捕获脚手架响应
   └─ 记录拦截/放行决策
   
5. 验证结果
   └─ 对比预期和实际结果
   
6. 生成报告
   └─ 输出测试数据和分析
```

### 8.3 报告解读

```markdown
# 测试报告示例

## 执行摘要
- 测试场景: 10个
- 测试用例: 20个
- 通过: 18个 (90%)
- 失败: 2个 (10%)

## 详细结果
...

## 失败分析
### 失败用例 #1
- 用例ID: TC-RB006-01
- 原因: 语义相似度检测不足
- 建议: 增强AST分析

## 改进建议
1. 增强语义相似度检测
2. 优化复杂签名变化识别
3. 扩展常见模式库
```

---

## 九、附录

### 9.1 术语表

| 术语 | 定义 |
|------|------|
| 短视陷阱 | AI因缺乏全局视野而犯的错误 |
| 文件生成癖 | 倾向于创建新文件而非复用已有文件 |
| 副作用盲视 | 修改代码时未考虑对其他文件的影响 |
| 抽象遗忘症 | 忘记之前创建的抽象（函数、组件等） |
| 拦截率 | 被拦截的陷阱次数 / 总陷阱尝试次数 |
| 误报率 | 错误拦截的正常操作 / 总拦截次数 |

### 9.2 参考文档

- 脚手架架构设计文档
- AI行为分析白皮书
- 代码相似度算法研究

### 9.3 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2025-01-20 | 初始版本，包含10个测试场景 |

---

*文档结束*
