# OpenCode 插件与 LLM 交互流程

## 核心 Hook 触发时机

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OpenCode 主循环                                   │
│                                                                         │
│  1. 用户输入消息                                                         │
│  2. ├─ 检查是否需要 compaction（上下文窗口满 → 触发 compaction）            │
│  3. ├─ 调用 plugin: "chat.params" hook  (修改请求参数)                     │
│  4. ├─ 调用 plugin: "chat.headers" hook (修改请求头)                      │
│  5. ├─ 调用 plugin: auth.loader()         ← ★ 关键：每次消息都会触发     │
│  6. ├─ 发送请求到 LLM API                                                │
│  7. ├─ 接收 LLM 响应                                                     │
│  8. ├─ LLM 执行 Tool Call                                                │
│  9. ├─ 调用 plugin: "tool.execute.before/after" hook                     │
│ 10. └─ 返回结果给用户                                                    │
│                                                                         │
│  当上下文满时：                                                          │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                         │
│   11. 触发 compaction                                                     │
│   12. 调用 plugin: "experimental.session.compacting" hook                │
│   13. LLM 对历史消息做摘要压缩                                             │
│   14. 调用 plugin: "experimental.compaction.autocontinue" hook           │
│   15. 自动 continue                                                      │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 本插件 Hook 注册情况

```
OmniRouteAuthPlugin
│
├── config:         ✅ 已注册 — 初始化时加载 provider、设置 baseURL、读取 cache
├── auth.loader:    ✅ 已注册 — 每次 LLM 请求前调用，返回 apiKey + fetch interceptor
├── auth.methods:   ✅ 已注册 — "/connect omniroute" 命令
│
├── event:          ❌ 未注册
├── chat.params:    ❌ 未注册
├── chat.headers:   ❌ 未注册
├── tool:           ❌ 未注册
├── provider:       ❌ 未注册
├── experimental.session.compacting:   ❌ 未注册
├── experimental.compaction.autocontinue: ❌ 未注册
└── 其他 hooks:     ❌ 未注册
```

## auth.loader 完整调用链

```
OpenCode 准备发送 LLM 请求
         │
         ▼
   auth.loader() 被调用
         │
         ▼
   getAuth() → 从 auth.json 读取 API key
         │
         ▼
   createRuntimeConfig() → 构建配置
         │
         ▼
   fetchModels(config, apiKey, forceRefresh)
         │
         ├─ forceRefresh === true (默认)
         │      │
         │      ▼
         │   HTTP GET /v1/models (每次消息都请求)
         │      │
         │      ├─ 成功 → toProviderModels() → replaceProviderModels()
         │      │              │
         │      │              ▼
         │      │        provider.models 被替换 (写入)
         │      │              │
         │      │              ▼
         │      │        OpenCode 感知到 models 变化
         │      │        → LevelDB compaction
         │      │
         │      └─ 失败 → OMNIROUTE_DEFAULT_MODELS
         │
         └─ forceRefresh === false (使用 TTL cache)
                │
                ▼
                in-memory Map cache (5分钟 TTL)
```

## 关键发现

```
  ★ 问题: auth.loader() 在每次 LLM 请求前都会触发
  ★ 问题: forceRefresh 默认 true → 每次消息都调 /v1/models
  ★ 问题: provider.models 被替换 → OpenCode 内部 state 变化 → DB compaction

  ✓ 修复: config.refreshOnList 改为默认 false (forceRefresh = false)
  ✓ 效果: 5分钟内重复调用 auth.loader 不会触发 /v1/models

  ⚠ 但: 如果 compaction 仍然出现 (你说"跟这个没关系")
         → compaction 是 OpenCode 自身行为 !!
         → 每次消息累积 context → context 满 → compaction
         → 这 && 插件 && 关 !!
```

## Compaction 有两种

```
1.  OpenCode LevelDB 内部 compaction (数据库)
    └─ 原因: provider.models 频繁写入 → 数据库 state change → LevelDB auto compaction

2.  OpenCode Session compaction (上下文压缩)
    └─ 原因: context window 满了, LLM 对历史做摘要
    └─ 正常行为: 每次消息都有概率触发 (context 累积 → 达到上限 → compact → continue)
    └─ 异常: * 每 * 次 * 消 * 息 *  * 都 *  *  * compact → 说明 model 有问题
             →  model.contextWindow 太小 (当前插件设为 128k / 200k 没问题)
             →  provider model config 不正确 → context window 被设成 0 或极小值
```

## 需要你确认

```
1.  compaction 具体表现是 ?  (终端日志 ? OpenCode 内部 ? LevelDB ?)
2.  "不断触发" 是:
    □ 每次用户消息都 compact
    □ 每几秒钟 compact 多次
    □ 其他 _____________
3.  是否能看到 OpenCode 输出的 "Compacting session..." 或类似日志 ?
```