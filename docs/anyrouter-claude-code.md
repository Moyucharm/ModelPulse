# AnyRouter Claude Code 兼容探测改造说明

本文记录为了解决 AnyRouter/类似 Claude Code 中转对请求形态校验严格，导致探测报错 `invalid claude code request` 而做的改造点，以及如何调试/覆盖。

## 背景与问题

- AnyRouter 的 Claude Code 端点会对请求做“像不像 Claude Code”的校验。
- 之前探测器使用的是普通 Anthropic Messages 形态（或过于简化的 CC 形态），因此被拒绝并返回 `invalid claude code request`。
- 同时该渠道的 Chat 探测没有意义，应该支持关闭，避免 404/无效请求干扰结果。

## 目标

1. **Claude (Claude Code) 探测**支持“自动探测可通过的请求模板 + 失败回退 + 缓存”，尽量在一次流程里找到可用的 profile。
2. **Chat 探测开关**支持按模型关闭（默认开启），让 AnyRouter/CC-only 渠道可以只跑 `CLAUDE` 检测。

## 关键改造点概览

### 1) Claude profiles：自动探测 + 回退 + 缓存

相关代码：

- `src/lib/detection/claude-profile.ts`
- `src/lib/detection/detector.ts`

做法：

- 针对 `EndpointType.CLAUDE`，不再只有一种固定请求，而是按固定顺序尝试多个 **ClaudeProfile**。
- 成功条件统一为：
  - HTTP `2xx`，且
  - 响应体不包含错误字段（复用 `checkResponseBodyForError`：`src/lib/detection/response-error.ts`）
- Profile 会缓存（TTL 6 小时）：
  - cache key = `channelId + modelName + apiKeyHash(sha256 前 16 位)`
  - 缓存命中后优先用缓存 profile
  - 如果缓存 profile 失败且命中“请求结构类错误”（例如包含 `invalid claude code request`），则清缓存并回退重试
- 全部失败时返回聚合错误摘要：包含每个 profile 的 `profileId + statusCode + error` 简短摘要，便于定位。

当前默认尝试顺序（见 `getOrderedClaudeProfileEndpoints`）：

1. `custom_profile`（如果配置了 `CLAUDE_PROBE_CUSTOM_PROFILE_JSON`）
2. `claude_code_bearer_blocks_stream`
3. `claude_code_blocks_stream`（该 profile 不带 `?beta=true`，覆盖“只认 header beta”的中转）
4. `claude_code_legacy_stream`
5. `claude_code_blocks_nostream`
6. `claude_code_legacy_nostream`
7. `claude_code_bearer_blocks_nostream`
8. `anthropic_blocks_nostream`
9. `anthropic_legacy_nostream`
10. `anthropic_legacy_stream`
11. `bearer_blocks_nostream`

### 2) Claude Code 请求拟真：headers/body 更接近真实 Claude Code

相关代码：

- `src/lib/detection/claude-profile.ts`

核心思路：AnyRouter 这类“CC-only”中转往往不是看你能不能调用 `/v1/messages`，而是看你的请求是否具备 Claude Code 的典型特征。

#### 2.1 请求头（Claude Code 风格）

CC profiles 统一使用 `buildClaudeCodeHeaders(...)`，关键点：

- `Accept` 会随 `stream` 切换：
  - `stream=true` -> `text/event-stream`
  - `stream=false` -> `application/json`
- 默认使用更保守的 CC 头（可通过 env 覆盖）：
  - `User-Agent` 默认：`claude-cli/2.0.31 (external, cli)`
  - `anthropic-beta` 默认：`claude-code-20250219,fine-grained-tool-streaming-2025-05-14`
  - `anthropic-version: 2023-06-01`
  - `anthropic-dangerous-direct-browser-access: true`
  - `x-app: cli`

认证方式覆盖：

- `claude_code_bearer_*`：`Authorization: Bearer <apiKey>`
- `claude_code_*`：dual auth（`Authorization: Bearer ...` + `X-Api-Key ...`）以覆盖不同中转的校验差异

#### 2.2 请求体（Claude Code 风格）

CC profiles 的 body 主要变化：

- `system` 使用“两段式”：
  1. marker：`You are Claude Code, Anthropic's official CLI for Claude.`
  2. followup：`You are an interactive CLI tool...`
- `messages[0].content` 增加 Claude Code 常见的 `<system-reminder>` 两段，再附上实际探测 prompt
- `tools` 改为 **非空**，工具名对齐 Claude Code 常见集合（例如 `Task/Bash/Glob/Grep/Read/Edit/Write/WebFetch/.../EnterPlanMode/ExitPlanMode`）
- 增加更像 CLI 的控制字段：
  - `temperature: 0`
  - `max_tokens: 256`
  - `tool_choice: { type: "auto" }`
  - `metadata.user_id` 使用更 Claude 风格的结构化字符串

### 3) 调试信息：看到每个 profile 到底发了什么“特征”

相关代码：

- `src/lib/detection/detector.ts`

当 `CLAUDE_PROBE_DEBUG=true` 时，会输出每次 profile 尝试的关键特征：

```
[claude-probe] channel=... model=... profile=... status=... code=... url=... stream=... tools=... ua=... beta=...
```

注：不会打印 Authorization/X-Api-Key 的值，避免泄露。

### 4) Chat 探测开关：按模型关闭（默认开启）

相关代码：

- `prisma/schema.prisma`：`Model.enableChatDetection Boolean @default(true) @map("enable_chat_detection")`
- `src/lib/queue/endpoint-filter.ts`：`EndpointType.CHAT` 受 `enableChatDetection` 控制
- `src/lib/queue/service.ts`：`selectedModelCliConfig` 输入结构扩展为 `{ chat?, gemini?, codex?, claude? }`，缺失 `chat` 默认按 `true`

这能避免 AnyRouter 这类 CC-only 渠道去跑无意义的 Chat 探测（常见表现就是一直 404/无结果）。

## 环境变量（与本改造相关）

见 `.env.example` 对应条目。

### 探测调试

- `CLAUDE_PROBE_DEBUG="true"`：打印每个 profile 的尝试摘要（含 url/ua/beta/stream/tools）

### Claude Code 头/提示词覆盖（便于试探中转 allowlist）

- `CLAUDE_CODE_PROBE_USER_AGENT=""`
- `CLAUDE_CODE_PROBE_ANTHROPIC_BETA=""`
  - 如果该变量被设置为 **空字符串**，会直接 **移除** `anthropic-beta` header
- `CLAUDE_CODE_PROBE_SYSTEM_MARKER=""`
- `CLAUDE_CODE_PROBE_SYSTEM_FOLLOWUP=""`

### 自定义 profile（最高自由度）

- `CLAUDE_PROBE_CUSTOM_PROFILE_JSON`
  - 格式：`{"headers": {...}, "bodyPatch": {...}}`
  - 用途：当某个中转需要非常特定的 header/body 字段组合时，可以直接 patch。

## 验收步骤（手动）

1. 在模型 UI 中关闭目标 Claude 模型的 `Chat` 探测（保留 `Claude/Claude CLI` 探测）。
2. `.env` 设置 `CLAUDE_PROBE_DEBUG=true`，重启服务。
3. 触发该模型检测：
   - 预期不会再出现 Chat 404
   - `Claude CLI` 会在某个 profile 下返回 `SUCCESS`
4. 如果失败：
   - 看日志中每个 profile 的 `url/ua/beta/stream/tools`，按需用 `CLAUDE_CODE_PROBE_*` 或 `CLAUDE_PROBE_CUSTOM_PROFILE_JSON` 做定点覆盖。

## 常见排障

- 仍然 `invalid claude code request`：
  - 优先看是否至少尝试了 `stream=true` 的 profile（日志 `stream=true`）
  - 尝试覆盖 `CLAUDE_CODE_PROBE_USER_AGENT`（例如更旧的 `claude-cli/1.0.xx (external, cli)`）
  - 尝试将 `CLAUDE_CODE_PROBE_ANTHROPIC_BETA` 置空以移除该 header（极少数中转会对 beta 值/数量严格校验）
  - 极端情况下用 `CLAUDE_PROBE_CUSTOM_PROFILE_JSON` 复刻你抓包到的真实请求

