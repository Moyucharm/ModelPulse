# Message Nest 通知配置

本文说明如何在面板中接入 Message Nest，用于接收自动检测的异常与恢复通知。

## 通知触发规则

- 仅自动检测会发送通知，手动检测不会发送。
- 当模型首次出现异常时，会发送一条异常通知。
- 如果下一次自动检测仍未恢复，不会重复打扰。
- 当模型恢复正常后，会再发送一条恢复通知。

## 面板配置步骤

1. 打开页面顶部的 `渠道管理`。
2. 点击工具栏中的 `通知设置` 按钮。
3. 在 `Message Nest` 区块中开启开关。
4. 填写以下内容：
   - `接口 URL`：你的 Message Nest 发送接口地址
   - `Token`：Message Nest 为该通知通道分配的 token
5. 点击 `保存`。

建议同时在 `.env` 中配置 `ENCRYPTION_KEY`，这样数据库中的通知 Token 会加密保存。

## 请求格式

当前 Message Nest 通知使用如下 JSON 请求体：

```json
{
  "token": "your-token",
  "title": "模型异常：示例渠道 / gpt-4.1",
  "placeholders": {
    "title": "模型异常：示例渠道 / gpt-4.1",
    "context": "自动检测发现模型异常。\n渠道：示例渠道\n模型：gpt-4.1\n状态：部分故障\n异常详情：\n- OpenAI Chat: upstream timeout"
  }
}
```

其中：

- `title`：通知标题
- `placeholders.title`：同样会写入标题，便于模板引用
- `placeholders.context`：完整通知正文，包含渠道、模型、状态和错误详情

## 你的接口示例

```bash
curl -X POST --location 'https://notify.milki.top/api/v2/message/send' \
--header 'Content-Type: application/json' \
--data '{
  "token": "928184a2b1e1b790a498b2e2aa",
  "title": "message title",
  "placeholders": {
    "title": "mock_title",
    "context": "mock_context"
  }
}'
```

如果你的 Message Nest 服务与上面的字段结构一致，直接把接口地址和 token 填进面板即可。
