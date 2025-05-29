## 增强的可靠性特性

MCP 代理服务器包含多项特性，用以提升其自身弹性以及与后端 MCP 服务交互的可靠性，确保更平稳的操作和更一致的工具执行。

### 1. 错误传播
代理服务器确保从后端 MCP 服务产生的错误能够一致地传播给请求客户端。这些错误被格式化为标准的 JSON-RPC 错误响应，使客户端更容易统一处理它们。

### 2. SSE 工具调用的连接重试
当对基于 SSE 的后端服务器执行 `tools/call` 操作时，如果底层连接丢失或遇到错误，代理服务器将自动尝试：
1.  重新建立与 SSE 后端的连接。
2.  如果重新连接成功，它将重试原始的 `tools/call` 请求**一次**。

此行为有助于缓解可能暂时中断 SSE 连接的瞬时网络问题。

**配置：**
此功能通过 `config/mcp_server.json` 文件中 `proxy` 对象内的 `retrySseToolCallOnDisconnect` 属性进行控制。
-   **`retrySseToolCallOnDisconnect`** (布尔型):
    -   设置为 `true` (默认值) 以启用自动重新连接和重试。
    -   设置为 `false` 以禁用此功能。

**示例 (`config/mcp_server.json`):**
```json
{
  "mcpServers": {
    "my-sse-server": {
      "type": "sse",
      "url": "http://example.com/sse-endpoint"
      // ... 其他服务器配置
    }
  },
  "proxy": {
    "retrySseToolCallOnDisconnect": true
    // ... 其他代理设置
  }
}
```

### 3. HTTP 工具调用的请求重试
对于定向到基于 HTTP 的后端服务器的 `tools/call` 操作，代理服务器为连接错误（例如，“failed to fetch”、网络超时）实现了一套重试机制。

**重试机制：**
如果初始 HTTP 请求因连接错误而失败，代理将使用指数退避策略重试该请求。这意味着每次后续重试尝试之前的延迟会指数级增加，并加入少量抖动（随机性）以防止“惊群效应”。

**配置：**
这些设置在 `config/mcp_server.json` 文件的 `proxy` 对象内进行配置。

-   **`retryHttpToolCall`** (布尔型):
    -   设置为 `true` (默认值) 以启用 HTTP 工具调用的重试。
    -   设置为 `false` 以禁用此功能。

-   **`httpToolCallMaxRetries`** (数字型):
    -   指定在初次失败尝试*之后*的最大重试次数。例如，如果设置为 `2`，则会有一次初始尝试和最多两次重试尝试，总共最多三次尝试。
    -   **默认值:** `2`。

-   **`httpToolCallRetryDelayBaseMs`** (数字型):
    -   用于指数退避计算的基础延迟（以毫秒为单位）。第 *n* 次重试（0索引）之前的延迟大约是 `httpToolCallRetryDelayBaseMs * (2^n) + jitter`。
    -   **默认值:** `300` (毫秒)。

**示例 (`config/mcp_server.json`):**
```json
{
  "mcpServers": {
    "my-http-server": {
      "type": "http",
      "url": "http://example.com/mcp-endpoint"
      // ... 其他服务器配置
    }
  },
  "proxy": {
    "retryHttpToolCall": true,
    "httpToolCallMaxRetries": 3,
    "httpToolCallRetryDelayBaseMs": 500
    // ... 其他代理设置
  }
}
```
