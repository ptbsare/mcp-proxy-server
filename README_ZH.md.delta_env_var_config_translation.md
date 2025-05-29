### 4. 代理行为配置 (错误处理与重试)
虽然将来可能会在此处配置某些通用的代理行为，但主要的重试和错误处理设置现在通过**环境变量**进行管理，以便于针对特定部署进行覆盖。如果设置了相应的环境变量，`config/mcp_server.json` 中针对这些特定设置的值将被覆盖。

`config/mcp_server.json` 示例，展示其他可能的代理设置：
```json
{
  "mcpServers": {
    "...": "..."
  },
  "proxy": {
    "someOtherProxySettingNotOverriddenByEnv": "example_value"
    // 特定的重试设置，如 retrySseToolCallOnDisconnect, retryHttpToolCall, 
    // httpToolCallMaxRetries, 和 httpToolCallRetryDelayBaseMs 现在
    // 优先通过环境变量进行设置 (见下文)。
  }
}
```
有关这些选项的详细信息，请参阅“增强的可靠性特性”和“环境变量”部分。

## 增强的可靠性特性

MCP 代理服务器包含多项特性，用以提升其自身弹性以及与后端 MCP 服务交互的可靠性，确保更平稳的操作和更一致的工具执行。

**配置 (SSE 连接重试):**
此功能主要通过 **`RETRY_SSE_TOOL_CALL_ON_DISCONNECT`** 环境变量进行控制。
-   **`RETRY_SSE_TOOL_CALL_ON_DISCONNECT`** (环境变量):
    -   设置为 `"true"` 以启用自动重新连接和重试。
    -   设置为 `"false"` 以禁用此功能。
    -   **默认行为:** `true` (如果环境变量未设置、为空或为无效值)。
    -   *注意: 如果此设置也存在于 `config/mcp_server.json` 的 `proxy` 对象下，环境变量将优先。*

**示例 (环境变量):**
```bash
export RETRY_SSE_TOOL_CALL_ON_DISCONNECT="true"
```
*(`config/mcp_server.json` 中“代理行为配置”下的 JSON 示例说明了其他代理设置可能的位置，但此特定设置最好通过其环境变量进行管理。)*

**配置 (HTTP 请求重试):**
这些设置主要通过环境变量进行控制。如果设置了相应的环境变量，`config/mcp_server.json` 文件中 `proxy` 对象内这些特定键的值将被覆盖。

-   **`RETRY_HTTP_TOOL_CALL`** (环境变量):
    -   设置为 `"true"` 以启用 HTTP 工具调用的重试。
    -   设置为 `"false"` 以禁用此功能。
    -   **默认行为:** `true` (如果环境变量未设置、为空或为无效值)。

-   **`HTTP_TOOL_CALL_MAX_RETRIES`** (环境变量):
    -   指定在初次失败尝试*之后*的最大重试次数。例如，如果设置为 `"2"`，则会有一次初始尝试和最多两次重试尝试，总共最多三次尝试。
    -   **默认行为:** `2` (如果环境变量未设置、为空或不是一个有效的整数)。

-   **`HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`** (环境变量):
    -   用于指数退避计算的基础延迟（以毫秒为单位）。第 *n* 次重试（0索引）之前的延迟大约是 `HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS * (2^n) + jitter`。
    -   **默认行为:** `300` (毫秒) (如果环境变量未设置、为空或不是一个有效的整数)。

**关于环境变量解析的通用说明:**
-   布尔型环境变量 (`RETRY_SSE_TOOL_CALL_ON_DISCONNECT`, `RETRY_HTTP_TOOL_CALL`) 如果其小写值精确为 `"true"`，则被视为 `true`。任何其他值（包括空值或未设置）将导致应用默认值；如果默认值为 `false`，则解析为 `false`（尽管对于这些特定变量，默认值为 `true`）。
-   数字型环境变量 (`HTTP_TOOL_CALL_MAX_RETRIES`, `HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`) 被解析为十进制整数。如果解析失败（例如，值不是一个数字，或变量为空/未设置），则使用默认值。

**示例 (环境变量):**
```bash
export RETRY_HTTP_TOOL_CALL="true"
export HTTP_TOOL_CALL_MAX_RETRIES="3"
export HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS="500"
```
*(`config/mcp_server.json` 中“代理行为配置”下的 JSON 示例说明了其他不受环境变量覆盖的代理设置可能的位置。)*
