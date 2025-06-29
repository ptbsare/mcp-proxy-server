# MCP Proxy Server

[简体中文](README_ZH.md)
## ✨ Key Features Highlight

*   **🌐 Web UI Management:** Easily manage all connected MCP servers through an intuitive web interface (optional, requires enabling).
*   **🔧 Granular Tool Control:** Enable or disable individual tools, and override names/descriptions via the Web UI.
*   **🛡️ Flexible Endpoint Authentication:** Secure your HTTP-based endpoints (`/sse`, `/mcp`) with flexible authentication options (`Authorization: Bearer <token>` or `X-API-Key: <key>`).
*   **🔄 Robust Session Handling & Concurrency**:
    *   Improved SSE session handling for client reconnections (relying on server-sent `endpoint` events) and support for concurrent connections.
    *   Streamable HTTP endpoint (`/mcp`) also supports concurrent client interactions.
*   **🚀 Versatile MCP Operations (Server & Proxy):**
    *   **Acts as a Proxy:** Connects to and aggregates multiple backend MCP servers of various types (Stdio, SSE, Streamable HTTP).
    *   **Acts as a Server:** Exposes these aggregated capabilities through its own Streamable HTTP (`/mcp`) and SSE (`/sse`) endpoints. Can also run in a pure Stdio mode.
*   **✨ Real-time Install Output**: Monitor Stdio server installation progress (stdout/stderr) directly in the Web UI.
*   **✨ Web Terminal**: Access a command-line terminal within the Admin UI for direct server interaction (optional, use with caution due to security risks).

---

This server acts as a central hub for Model Context Protocol (MCP) resource servers. It can:

- Connect to and manage multiple backend MCP servers (Stdio, SSE, and Streamable HTTP types).
- Expose their combined capabilities (tools, resources) through a single, unified SSE interface, a Streamable HTTP interface, **or** act as a single Stdio-based MCP server itself.
- Handle routing of requests to the appropriate backend servers.
- Aggregate responses if needed (though primarily acts as a proxy).
- Support multiple simultaneous SSE client connections with optional API key authentication.

## Features

### Resource & Tool Management via Proxy
- Discovers and connects to multiple MCP resource servers defined in `config/mcp_server.json`.
- Aggregates tools and resources from all connected *active* servers.
- Routes tool calls and resource access requests to the correct backend server.
- Maintains consistent URI schemes.

### ✨ Optional Web Admin UI (`ENABLE_ADMIN_UI=true`)
Provides a browser-based interface for managing the proxy server configuration and connected tools. Features include:
- **Server Configuration**: View, add, edit, and delete server entries (`mcp_server.json`). Supports Stdio, SSE, and HTTP server types with relevant options (type, command, args, env, url, apiKey, bearerToken, install config).
- **Tool Configuration**: View all tools discovered from active backend servers. Enable or disable specific tools. Override the display name and description for each tool (`tool_config.json`).
- **Live Reload**: Apply server and tool configuration changes by triggering a configuration reload without needing to restart the entire proxy server process.
- **Stdio Server Installation**: For Stdio servers, you can define installation commands in the configuration. The Admin UI allows you to:
    - Trigger the execution of these installation commands.
    - **Monitor installation progress in real-time** with live stdout and stderr output streamed directly to the UI.
- **Web Terminal**: Access an integrated web-based terminal that provides shell access to the environment where the proxy server is running.
    - **Security Warning**: This feature grants significant access and should be used with extreme caution, especially if the admin interface is exposed.

## Configuration

Configuration is primarily done via environment variables and JSON files located in the `./config` directory.

### 1. Server Connections (`config/mcp_server.json`)
This file defines the backend MCP servers the proxy should connect to.

Example `config/mcp_server.json`:
```json
{
  "mcpServers": {
    "unique-server-key1": {
      "type": "stdio",
      "name": "My Stdio Server",
      "active": true,
      "command": "/path/to/server/executable",
      "args": ["--port", "1234"],
      "env": {
        "API_KEY": "server_specific_key"
      },
      "installDirectory": "/custom_install_path/unique-server-key1",
      "installCommands": [
        "git clone https://github.com/some/repo unique-server-key1",
        "cd unique-server-key1 && npm install && npm run build"
      ]
    },
    "another-sse-server": {
      "type": "sse",
      "name": "My SSE Server",
      "active": true,
      "url": "http://localhost:8080/sse",
      "apiKey": "sse_server_api_key"
    },
    "http-mcp-server": {
      "type": "http",
      "name": "My Streamable HTTP Server",
      "active": true,
      "url": "http://localhost:8081/mcp",
      "bearerToken": "some_secure_token_for_http_server"
    },
    "stdio-default-install": {
        "type": "stdio",
        "name": "Stdio Server with Default Install Path",
        "active": true,
        "command": "my_other_server",
        "installCommands": ["echo 'Installing to default location...'"]
    }
  }
}
```

**Fields:**
-   `mcpServers`: (Required) An object where each key is a unique identifier for a backend server.
-   `name`: (Optional) A user-friendly display name for the server (used in Admin UI).
-   `active`: (Optional, default: `true`) Set to `false` to prevent the proxy from connecting to this server.
-   `type`: (Required) Specifies the transport type. Must be one of `"stdio"`, `"sse"`, or `"http"`.
-   `command`: (Required if `type` is "stdio") The command to execute the server process.
-   `args`: (Optional if `type` is "stdio") An array of string arguments to pass to the command.
-   `env`: (Optional if `type` is "stdio") An object of environment variables (`KEY: "value"`) to set for the server process. These are merged with the proxy server's environment.
-   `url`: (Required if `type` is "sse" or "http") The full URL of the backend server's endpoint (e.g., SSE endpoint for "sse", MCP endpoint for "http").
-   `apiKey`: (Optional if `type` is "sse" or "http") An API key to send in the `X-Api-Key` header when the proxy connects to *this specific backend* server.
-   `bearerToken`: (Optional if `type` is "sse" or "http") A token to send in the `Authorization: Bearer <token>` header when connecting to *this specific backend* server. (If both `apiKey` and `bearerToken` are provided, `bearerToken` generally takes precedence for that specific backend connection).
-   `installDirectory`: (Optional if `type` is "stdio") The absolute path where the server *itself* should be installed (e.g., `/opt/my-server-files`). Used by the Admin UI's installation feature.
    - If provided in `mcp_server.json`, this exact path is used.
    - If omitted, the effective directory depends on the `TOOLS_FOLDER` environment variable (see Environment Variables section).
        - If `TOOLS_FOLDER` is set and not empty, the server will be installed in a subdirectory named after the server key within this folder (e.g., `${TOOLS_FOLDER}/<server_key>`).
        - If `TOOLS_FOLDER` is also empty or not set, it defaults to a `tools` subdirectory within the proxy server's working directory (e.g., `./tools/<server_key>`).
    - Ensure the parent directory of the target installation path (e.g., `TOOLS_FOLDER` or `./tools`) is writable by the user running the proxy server.
-   `installCommands`: (Optional for Stdio type) An array of shell commands executed sequentially by the Admin UI's installation feature if the target server directory (derived from `installDirectory` or defaults) does not exist. Commands are executed from the **parent directory** of the target server installation directory (e.g., if `installDirectory` resolves to `/opt/tools/my-server`, commands run in `/opt/tools/`). **Use with extreme caution due to security risks.**

### 2. Tool Configuration (`config/tool_config.json`)
This file allows overriding properties of tools discovered from backend servers. It is primarily managed via the Admin UI but can be edited manually.

Example `config/tool_config.json`:
```json
{
  "tools": {
    "unique-server-key1__tool-name-from-server": {
      "enabled": true,
      "displayName": "My Custom Tool Name",
      "description": "A more user-friendly description."
    },
    "another-sse-server__another-tool": {
      "enabled": false
    }
  }
}
```
- Keys are in the format `<server_key><separator><original_tool_name>`, where `<separator>` is the value of the `SERVER_TOOLNAME_SEPERATOR` environment variable (defaults to `__`).
- `enabled`: (Optional, default: `true`) Set to `false` to hide this tool from clients connecting to the proxy.
- `displayName`: (Optional) Override the tool's name in client UIs.
- `description`: (Optional) Override the tool's description.

### 3. Environment Variables

-   **`PORT`**: Port for the proxy server's HTTP-based endpoints (`/sse`, `/mcp`, and Admin UI if enabled). Default: `3663`. **Note:** This is only used when running in a mode that starts an HTTP server (e.g., via `npm run dev:sse` or the Docker container). The `npm run dev` script runs in Stdio mode.
    ```bash
    export PORT=8080
    ```
-   **`ALLOWED_KEYS`**: (Optional) Comma-separated list of API keys to secure the proxy's HTTP-based endpoints (`/sse`, `/mcp`). If neither `ALLOWED_KEYS` nor `ALLOWED_TOKENS` are set, authentication is disabled for these endpoints. Clients must provide a key via `X-Api-Key` header or `?key=` query parameter.
    ```bash
    export ALLOWED_KEYS="client_key1,client_key2"
    ```
-   **`ALLOWED_TOKENS`**: (Optional) Comma-separated list of Bearer Tokens to secure the proxy's HTTP-based endpoints (`/sse`, `/mcp`). If neither `ALLOWED_KEYS` nor `ALLOWED_TOKENS` are set, authentication is disabled. Clients must provide a token via the `Authorization: Bearer <token>` header. If both `ALLOWED_KEYS` and `ALLOWED_TOKENS` are configured, Bearer Token authentication will be attempted first.
    ```bash
    export MCP_PROXY_SSE_ALLOWED_TOKENS="your_bearer_token_1,your_bearer_token_2"
    ```
-   **`ENABLE_ADMIN_UI`**: (Optional) Set to `true` to enable the Web Admin UI (only applicable in SSE mode). Default: `false`.
    ```bash
    export ENABLE_ADMIN_UI=true
    ```
-   **`ADMIN_USERNAME`**: (Required if Admin UI enabled) Username for Admin UI login. Default: `admin`.
-   **`ADMIN_PASSWORD`**: (Required if Admin UI enabled) Password for Admin UI login. Default: `password` (**Change this!**).
    ```bash
    export ADMIN_USERNAME=myadmin
    export ADMIN_PASSWORD=aVerySecurePassword123!
    ```
-   **`SESSION_SECRET`**: (Optional, recommended if Admin UI enabled) Secret used to sign session cookies. If not set, a default, less secure secret is used, and a warning is issued. A secure secret is automatically generated and saved to `config/.session_secret` on first run if not provided via environment variable.
    ```bash
    # Recommended: Generate a strong secret (e.g., openssl rand -hex 32)
    export SESSION_SECRET='your_very_strong_random_secret_here'
    ```
-   **`TOOLS_FOLDER`**: (Optional) Specifies the base directory for Stdio server installations initiated via the Admin UI, used when `installDirectory` is not explicitly set in `mcp_server.json` for a specific server.
    - If set (e.g., `/custom/tools_path`), installations for servers without a specific `installDirectory` will target a subdirectory named after the server key within this folder (e.g., `${TOOLS_FOLDER}/<server_key>`).
    - If `TOOLS_FOLDER` is not set or is empty, such installations will default to a `tools` subdirectory within the proxy server's working directory (e.g., `./tools/<server_key>`).
    - The Dockerfile sets this to `/tools` by default.
    ```bash
    export TOOLS_FOLDER=/srv/mcp_tools
    ```

-   **`SERVER_TOOLNAME_SEPERATOR`**: (Optional) Defines the separator used to combine the server name and tool name when generating the unique key for tools (e.g., `server-key__tool-name`). This key is used internally and in the `tool_config.json` file.
    -   Default: `__`.
    -   Must be at least 2 characters long and contain only letters (a-z, A-Z), numbers (0-9), hyphens (`-`), and underscores (`_`).
    -   If the provided value is invalid, the default (`__`) will be used, and a warning will be logged.
    ```bash
    export SERVER_TOOLNAME_SEPERATOR="___" # Example: using triple underscore
    ```

-   **`LOGGING`**: (Optional) Controls the minimum log level output by the server.
    -   Possible values (case-insensitive): `error`, `warn`, `info`, `debug`.
    -   Logs at the specified level and all levels above it will be shown.
    -   Default: `info`.
    ```bash
    export LOGGING="debug"
    ```

-   **`RETRY_SSE_TOOL_CALL`**: (Optional) Controls whether to enable retries for SSE tool calls. Set to `"true"` to enable, `"false"` to disable. Default: `true`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export RETRY_SSE_TOOL_CALL="true"
    ```
-   **`SSE_TOOL_CALL_MAX_RETRIES`**: (Optional) Maximum number of retry attempts for SSE tool calls (after the initial failure). Default: `2`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export SSE_TOOL_CALL_MAX_RETRIES="2"
    ```
-   **`SSE_TOOL_CALL_RETRY_DELAY_BASE_MS`**: (Optional) Base delay in milliseconds for SSE tool call retries, used in exponential backoff. Default: `300`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export SSE_TOOL_CALL_RETRY_DELAY_BASE_MS="300"
    ```
-   **`RETRY_HTTP_TOOL_CALL`**: (Optional) Controls whether to retry on HTTP tool call connection errors. Set to `"true"` to enable, `"false"` to disable. Default: `true`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export RETRY_HTTP_TOOL_CALL="true"
    ```
-   **`HTTP_TOOL_CALL_MAX_RETRIES`**: (Optional) Maximum number of retry attempts for HTTP tool calls (after the initial failure). Default: `2`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export HTTP_TOOL_CALL_MAX_RETRIES="3"
    ```
-   **`HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`**: (Optional) Base delay in milliseconds for HTTP tool call retries, used in exponential backoff. Default: `300`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS="500"
    ```
-   **`RETRY_STDIO_TOOL_CALL`**: (Optional) Controls whether to retry on Stdio tool call connection errors (attempts to restart the process). Set to `"true"` to enable, `"false"` to disable. Default: `true`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export RETRY_STDIO_TOOL_CALL="true"
    ```
-   **`STDIO_TOOL_CALL_MAX_RETRIES`**: (Optional) Maximum number of retry attempts for Stdio tool calls (after the initial failure). Default: `2`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export STDIO_TOOL_CALL_MAX_RETRIES="5"
    ```
-   **`STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS`**: (Optional) Base delay in milliseconds for Stdio tool call retries, used in exponential backoff. Default: `300`. See the "Enhanced Reliability Features" section for details.
    ```bash
    export STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS="1000"
    ```

## Enhanced Reliability Features

The MCP Proxy Server includes features to improve its resilience and the reliability of interactions with backend MCP services, ensuring smoother operations and more consistent tool execution.

### 1. Error Propagation
The proxy server ensures that errors originating from backend MCP services are consistently propagated to the requesting client. These errors are formatted as standard JSON-RPC error responses, making it easier for clients to handle them uniformly.

### 2. SSE Tool Call Retry
When a `tools/call` operation is made to an SSE-based backend server, and the underlying connection is lost or experiences an error (including timeouts), the proxy server implements a retry mechanism.

**Retry Mechanism:**
If an initial SSE tool call fails due to a connection error or timeout, the proxy will attempt to re-establish the connection to the SSE backend. If reconnection is successful, it will then retry the original `tools/call` request using an exponential backoff strategy, similar to HTTP and Stdio retries. This means the delay before each subsequent retry attempt increases exponentially, with a small amount of jitter (randomness) added.

**Configuration:**
These settings are primarily controlled by environment variables. Values in `config/mcp_server.json` under the `proxy` object for these specific keys will be overridden by environment variables if set.

-   **`RETRY_SSE_TOOL_CALL`** (environment variable):
    -   Set to `"true"` to enable retries for SSE tool calls.
    -   Set to `"false"` to disable this feature.
    -   **Default Behavior:** `true` (if the environment variable is not set, is empty, or is an invalid value).

-   **`SSE_TOOL_CALL_MAX_RETRIES`** (environment variable):
    -   Specifies the maximum number of retry attempts *after* the initial failed attempt. For example, if set to `"2"`, there will be one initial attempt and up to two retry attempts, totaling a maximum of three attempts.
    -   **Default Behavior:** `2` (if the environment variable is not set, is empty, or is not a valid integer).

-   **`SSE_TOOL_CALL_RETRY_DELAY_BASE_MS`** (environment variable):
    -   The base delay in milliseconds used in the exponential backoff calculation. The delay before the *n*-th retry (0-indexed) is roughly `SSE_TOOL_CALL_RETRY_DELAY_BASE_MS * (2^n) + jitter`.
    -   **Default Behavior:** `300` (milliseconds) (if the environment variable is not set, is empty, or is not a valid integer).

**Example (Environment Variables):**
```bash
export RETRY_SSE_TOOL_CALL="true"
export SSE_TOOL_CALL_MAX_RETRIES="3"
export SSE_TOOL_CALL_RETRY_DELAY_BASE_MS="500"
```

### 3. HTTP Request Retry for Tool Calls
For `tools/call` operations directed to HTTP-based backend servers, the proxy implements a retry mechanism for connection errors (e.g., "failed to fetch", network timeouts).

**Retry Mechanism:**
If an initial HTTP request fails due to a connection error, the proxy will retry the request using an exponential backoff strategy. This means the delay before each subsequent retry attempt increases exponentially, with a small amount of jitter (randomness) added to prevent thundering herd scenarios.

**Configuration:**
These settings are primarily controlled by environment variables.

-   **`RETRY_HTTP_TOOL_CALL`** (environment variable):
    -   Set to `"true"` to enable retries for HTTP tool calls.
    -   Set to `"false"` to disable this feature.
    -   **Default Behavior:** `true` (if the environment variable is not set, is empty, or is an invalid value).

-   **`HTTP_TOOL_CALL_MAX_RETRIES`** (environment variable):
    -   Specifies the maximum number of retry attempts *after* the initial failed attempt. For example, if set to `"2"`，there will be one initial attempt and up to two retry attempts, totaling a maximum of three attempts.
    -   **Default Behavior:** `2` (if the environment variable is not set, is empty, or is not a valid integer).

-   **`HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`** (environment variable):
    -   The base delay in milliseconds used in the exponential backoff calculation. The delay before the *n*-th retry (0-indexed) is roughly `HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS * (2^n) + jitter`.
    -   **Default Behavior:** `300` (milliseconds) (if the environment variable is not set, is empty, or is not a valid integer).

### 4. Stdio Connection Retry for Tool Calls
For `tools/call` operations directed to Stdio-based backend servers, the proxy implements a retry mechanism for connection errors (e.g., process crash or unresponsiveness).

**Retry Mechanism:**
If an initial Stdio connection or tool call fails, the proxy will attempt to restart the Stdio process and retry the request. This mechanism follows an exponential backoff strategy similar to HTTP retries.

**Configuration:**
These settings are primarily controlled by environment variables.

-   **`RETRY_STDIO_TOOL_CALL`** (environment variable):
    -   Set to `"true"` to enable Stdio tool call retries.
    -   Set to `"false"` to disable this feature.
    -   **Default Behavior:** `true` (if the environment variable is not set, is empty, or is an invalid value).

-   **`STDIO_TOOL_CALL_MAX_RETRIES`** (environment variable):
    -   Specifies the maximum number of retry attempts *after* the initial failed attempt. For example, if set to `"2"`，there will be one initial attempt and up to two retry attempts, totaling a maximum of three attempts.
    -   **Default Behavior:** `2` (if the environment variable is not set, is empty, or is not a valid integer).

-   **`STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS`** (environment variable):
    -   The base delay in milliseconds used in the exponential backoff calculation. The delay before the *n*-th retry (0-indexed) is roughly `STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS * (2^n) + jitter`.
    -   **Default Behavior:** `300` (milliseconds) (if the environment variable is not set, is empty, or is not a valid integer).

**General Notes on Environment Variable Parsing:**
-   Boolean environment variables (`RETRY_SSE_TOOL_CALL`, `RETRY_HTTP_TOOL_CALL`, `RETRY_STDIO_TOOL_CALL`) are considered `true` if their lowercase value is exactly `"true"`. Any other value (including empty or not set) results in the default being applied or `false` if the default is `false` (though for these specific variables, the default is `true`)。
-   Numeric environment variables (`SSE_TOOL_CALL_MAX_RETRIES`, `SSE_TOOL_CALL_RETRY_DELAY_BASE_MS`, `HTTP_TOOL_CALL_MAX_RETRIES`, `HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`, `STDIO_TOOL_CALL_MAX_RETRIES`, `STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS`) are parsed as base-10 integers. If parsing fails (e.g., the value is not a number, or the variable is empty/not set), the default value is used。

## Development

The MCP Proxy Server includes features to improve its resilience and the reliability of interactions with backend MCP services, ensuring smoother operations and more consistent tool execution.

### 1. Error Propagation
The proxy server ensures that errors originating from backend MCP services are consistently propagated to the requesting client. These errors are formatted as standard JSON-RPC error responses, making it easier for clients to handle them uniformly.

### 2. SSE Connection Retry for Tool Calls
When a `tools/call` operation is made to an SSE-based backend server, and the underlying connection is lost or experiences an error, the proxy server will automatically attempt to:
1.  Re-establish the connection to the SSE backend.
2.  If reconnection is successful, it will retry the original `tools/call` request **once**.

This behavior helps mitigate transient network issues that might temporarily disrupt SSE connections.

**Configuration:**
This feature is primarily controlled by the **`RETRY_SSE_TOOL_CALL_ON_DISCONNECT`** environment variable.
-   **`RETRY_SSE_TOOL_CALL_ON_DISCONNECT`** (environment variable):
    -   Set to `"true"` to enable the automatic reconnect and retry.
    -   Set to `"false"` to disable this feature.
    -   **Default Behavior:** `true` (if the environment variable is not set, is empty, or is an invalid value).
    -   *Note: If this setting is also present in `config/mcp_server.json` under `proxy`, the environment variable takes precedence.*

**Example (Environment Variable):**
```bash
export RETRY_SSE_TOOL_CALL_ON_DISCONNECT="true"
```
*(The JSON example for `mcp_server.json` under "Proxy Behavior Configuration" illustrates where other proxy settings might go, but this specific setting is best managed via its environment variable.)*

### 3. HTTP Request Retry for Tool Calls
For `tools/call` operations directed to HTTP-based backend servers, the proxy implements a retry mechanism for connection errors (e.g., "failed to fetch", network timeouts).

**Retry Mechanism:**
If an initial HTTP request fails due to a connection error, the proxy will retry the request using an exponential backoff strategy. This means the delay before each subsequent retry attempt increases exponentially, with a small amount of jitter (randomness) added to prevent thundering herd scenarios.

**Configuration:**
These settings are primarily controlled by environment variables. Values in `config/mcp_server.json` under the `proxy` object for these specific keys will be overridden by environment variables if set.

-   **`RETRY_HTTP_TOOL_CALL`** (environment variable):
    -   Set to `"true"` to enable retries for HTTP tool calls.
    -   Set to `"false"` to disable this feature.
    -   **Default Behavior:** `true` (if the environment variable is not set, is empty, or is an invalid value).

-   **`HTTP_TOOL_CALL_MAX_RETRIES`** (environment variable):
    -   Specifies the maximum number of retry attempts *after* the initial failed attempt. For example, if set to `"2"`, there will be one initial attempt and up to two retry attempts, totaling a maximum of three attempts.
    -   **Default Behavior:** `2` (if the environment variable is not set, is empty, or is not a valid integer).

-   **`HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`** (environment variable):
    -   The base delay in milliseconds used in the exponential backoff calculation. The delay before the *n*-th retry (0-indexed) is roughly `HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS * (2^n) + jitter`.
    -   **Default Behavior:** `300` (milliseconds) (if the environment variable is not set, is empty, or is not a valid integer).

**General Notes on Environment Variable Parsing:**
-   Boolean environment variables (`RETRY_SSE_TOOL_CALL`, `RETRY_HTTP_TOOL_CALL`, `RETRY_STDIO_TOOL_CALL`) are considered `true` if their lowercase value is exactly `"true"`. Any other value (including empty or not set) results in the default being applied or `false` if the default is `false` (though for these specific variables, the default is `true`).
-   Numeric environment variables (`SSE_TOOL_CALL_MAX_RETRIES`, `SSE_TOOL_CALL_RETRY_DELAY_BASE_MS`, `HTTP_TOOL_CALL_MAX_RETRIES`, `HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`, `STDIO_TOOL_CALL_MAX_RETRIES`, `STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS`) are parsed as base-10 integers. If parsing fails (e.g., the value is not a number, or the variable is empty/not set), the default value is used.

**Example (Environment Variables):**
```bash
export RETRY_HTTP_TOOL_CALL="true"
export HTTP_TOOL_CALL_MAX_RETRIES="3"
export HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS="500"
```

### 4. Stdio Connection Retry for Tool Calls
For `tools/call` operations directed to Stdio-based backend servers, the proxy implements a retry mechanism for connection errors (e.g., process crash or unresponsiveness).

**Retry Mechanism:**
If an initial Stdio connection or tool call fails, the proxy will attempt to restart the Stdio process and retry the request. This mechanism follows an exponential backoff strategy similar to HTTP retries.

**Configuration:**
These settings are primarily controlled by environment variables.

-   **`RETRY_STDIO_TOOL_CALL`** (environment variable):
    -   Set to `"true"` to enable Stdio tool call retries.
    -   Set to `"false"` to disable this feature.
    -   **Default Behavior:** `true` (if the environment variable is not set, is empty, or is an invalid value).

-   **`STDIO_TOOL_CALL_MAX_RETRIES`** (environment variable):
    -   Specifies the maximum number of retry attempts *after* the initial failed attempt. For example, if set to `"2"`, there will be one initial attempt and up to two retry attempts, totaling a maximum of three attempts.
    -   **Default Behavior:** `2` (if the environment variable is not set, is empty, or is not a valid integer).

-   **`STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS`** (environment variable):
    -   The base delay in milliseconds used in the exponential backoff calculation. The delay before the *n*-th retry (0-indexed) is roughly `STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS * (2^n) + jitter`.
    -   **Default Behavior:** `300` (milliseconds) (if the environment variable is not set, is empty, or is not a valid integer).

**General Notes on Environment Variable Parsing:**
-   Boolean environment variables (`RETRY_SSE_TOOL_CALL`, `RETRY_HTTP_TOOL_CALL`, `RETRY_STDIO_TOOL_CALL`) are considered `true` if their lowercase value is exactly `"true"`. Any other value (including empty or not set) results in the default being applied or `false` if the default is `false` (though for these specific variables, the default is `true`)。
-   Numeric environment variables (`SSE_TOOL_CALL_MAX_RETRIES`, `SSE_TOOL_CALL_RETRY_DELAY_BASE_MS`, `HTTP_TOOL_CALL_MAX_RETRIES`, `HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS`, `STDIO_TOOL_CALL_MAX_RETRIES`, `STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS`) are parsed as base-10 integers. If parsing fails (e.g., the value is not a number, or the variable is empty/not set), the default value is used.

## Development

Install dependencies:
```bash
npm install
# or yarn install
```

Build the server (compiles TypeScript to JavaScript in `build/`):
```bash
npm run build
```

Run in development mode (uses `tsx` for direct TS execution with auto-restart on changes):
```bash
# Run as a Stdio MCP server (default mode)
npm run dev

# Run as an SSE MCP server (enables SSE endpoint and Admin UI if configured)
# Ensure environment variables (PORT, ENABLE_ADMIN_UI etc.) are set as needed
ENABLE_ADMIN_UI=true npm run dev:sse
```

Watch for changes and rebuild automatically (useful if not using `tsx`):
```bash
npm run watch
```

## Running with Docker

A `Dockerfile` is provided. The container runs the server in **SSE mode** by default (using `build/sse.js`) and includes all necessary dependencies. The `TOOLS_FOLDER` environment variable defaults to `/tools` inside the container.

**Recommended: Using the Pre-built Image (from GHCR)**

It's recommended to use the pre-built image from GitHub Container Registry for easier setup. We provide two types of images:

1.  **Standard Image (Lean)**: This is the default and recommended image for most users. It contains the core MCP Proxy Server functionality.
    *   Tags: `latest`, `<version>` (e.g., `0.1.2`)
    ```bash
    # Pull the latest standard image
    docker pull ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:latest

    # Or pull a specific version
    # docker pull ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:0.1.2
    ```

2.  **Bundled Image (Full-featured)**: This image includes a set of pre-installed MCP servers and Playwright browser dependencies. It's significantly larger but provides out-of-the-box access to common tools.
    *   Tag: `<version>-bundled-mcpservers-playwright` (e.g., `0.1.2-bundled-mcpservers-playwright`) or latest-bundled-mcpservers-playwright
    ```bash
    # Pull a bundled version
    # docker pull ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:latest-bundled-mcpservers-playwright
    ```

    The bundled image includes the following pre-installed components (via Docker build arguments):
    *   **PIP Packages** (`PRE_INSTALLED_PIP_PACKAGES_ARG`):
        *   `mcp-server-time`
        *   `markitdown-mcp`
        *   `mcp-proxy`
    *   **NPM Packages** (`PRE_INSTALLED_NPM_PACKAGES_ARG`):
        *   `g-search-mcp`
        *   `fetcher-mcp`
        *   `playwright`
        *   `time-mcp`
        *   `mcp-trends-hub`
        *   `@adenot/mcp-google-search`
        *   `edgeone-pages-mcp`
        *   `@modelcontextprotocol/server-filesystem`
        *   `mcp-server-weibo`
        *   `@variflight-ai/variflight-mcp`
        *   `@baidumap/mcp-server-baidu-map`
        *   `@modelcontextprotocol/inspector`
    *   **Initialization Command** (`PRE_INSTALLED_INIT_COMMAND_ARG`):
        *   `playwright install --with-deps chromium`

Choose the image type that best suits your needs. For most users, the standard image is sufficient, and backend MCP servers can be configured via `mcp_server.json`.

Then, run your chosen container image:

```bash
docker run -d \
  -p 3663:3663 \
  -e PORT=3663 \
  -e ENABLE_ADMIN_UI=true \
  -e ADMIN_USERNAME=myadmin \
  -e ADMIN_PASSWORD=yoursupersecretpassword \
  -e ALLOWED_KEYS="clientkey1" \
  -e TOOLS_FOLDER=/my/custom_tools_volume # Optional: Override default /tools for server installations
  -v ./my_config:/mcp-proxy-server/config \
  -v /path/on/host/to/tools:/my/custom_tools_volume `# Mount a volume for TOOLS_FOLDER if overridden` \
  --name mcp-proxy-server \
  ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:latest
```
- Replace `./my_config` with your host path containing `mcp_server.json` and optionally `tool_config.json`. The container expects config files in `/app/config`.
- If you override `TOOLS_FOLDER` for server installations via Admin UI, ensure you mount a corresponding volume (e.g., `-v /path/on/host/for_tools:/my/custom_tools_volume`). If using the default `/tools` (set by `TOOLS_FOLDER` in Dockerfile), you can mount to `/tools` (e.g., `-v /path/on/host/to/tools_default:/tools`).
- Adjust the tag (`:latest`) if you pulled a specific version.
- Set other environment variables using the `-e` flag as needed.

**Building the Image Locally (Optional):**
```bash
docker build -t mcp-proxy-server .
```
*(If you build locally, use `mcp-proxy-server` instead of the `ghcr.io/...` image name in the `docker run` command above).*

## Installation & Usage with Clients

This proxy server can be used in two main ways:

**1. As a Stdio MCP Server:**
   Configure your MCP client (like Claude Desktop) to run the proxy server directly using its command (`build/index.js`). The proxy will then connect to the backend servers defined in its `config/mcp_server.json`.

   Example for Claude Desktop (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "mcp-proxy": {
         "name": "MCP Proxy (Aggregator)",
         "command": "/path/to/mcp-proxy-server/build/index.js",
         "env": {
            "NODE_ENV": "production", // Optional: Set environment for the proxy itself
            "TOOLS_FOLDER": "/custom/path/for/proxy/tools" // Optional: If proxy needs to install its own backends
         }
       }
     }
   }
   ```
   - Replace `/path/to/mcp-proxy-server/build/index.js` with the actual path to the built entry point of this proxy server project. Ensure the `config` directory is correctly located relative to where the command is run, or use absolute paths in the proxy's own config if needed.

**2. As an SSE or Streamable HTTP MCP Server:**
   Run the proxy server in a mode that starts its HTTP server (e.g., `npm run dev:sse` or the Docker container). Then, configure your MCP client to connect to the proxy's appropriate endpoint:
    - For SSE: `http://localhost:3663/sse`
    - For Streamable HTTP: `http://localhost:3663/mcp`

   If authentication is enabled on the proxy (via `ALLOWED_KEYS` or `ALLOWED_TOKENS`), the client needs to provide the corresponding credentials.

   **Authentication Methods (for `/sse` and `/mcp`):**
   *   **API Key:** Provide the key in the client configuration. For the `/sse` endpoint, the URL query parameter `?key=...` is supported. For both `/sse` and `/mcp`, the `X-Api-Key` header is supported.
   *   **Bearer Token:** Set the `Authorization: Bearer <token>` header in the client configuration.

   Example for Claude Desktop (`claude_desktop_config.json`) connecting to SSE:
   ```json
   {
     "mcpServers": {
       "my-proxy-sse": {
         "type": "sse", // Important for clients that distinguish
         "name": "MCP Proxy (SSE)",
         // If using API Key authentication, append ?key=<your_key>
         "url": "http://localhost:3663/sse?key=clientkey1"
         // If using Bearer Token authentication, the client configuration method may vary.
         // For example, some clients might support setting custom headers:
         // "headers": {
         //   "Authorization": "Bearer your_bearer_token_1"
         // }
       }
     }
   }
   ```

   Example for a generic Streamable HTTP client configuration:
   ```json
   {
     "mcpServers": {
       "my-proxy-http": {
         "type": "http", // Or the client's specific designation
         "name": "MCP Proxy (Streamable HTTP)",
         "url": "http://localhost:3663/mcp",
         // Authentication headers would be configured according to the client's capabilities
         // e.g., "requestInit": { "headers": { "X-Api-Key": "clientkey1" } }
       }
     }
   }
   ```

## Debugging

Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for debugging communication (primarily for Stdio mode):
```bash
npm run inspector
```
This script wraps the execution of the built server (`build/index.js`) with the inspector. Access the inspector UI via the URL provided in the console output. For SSE mode, standard browser developer tools can be used to inspect network requests.

## Reference

This project was originally inspired by and refactored from [adamwattis/mcp-proxy-server](https://github.com/adamwattis/mcp-proxy-server).