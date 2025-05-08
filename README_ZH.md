# MCP 代理服务器

[English](README.md)

## ✨ 主要特性亮点

*   **🌐 Web UI 管理:** 通过直观的网页界面轻松管理所有连接的 MCP 服务器（可选功能，需要启用）。
*   **🔧 精细化工具控制:** 通过 Web UI 启用或禁用由已连接 MCP 服务器提供的单个工具，并可覆盖其显示名称/描述。
*   **🔒 双重 SSE 认证:** 使用灵活的认证选项保护您的 SSE 端点：
    *   `Authorization: Bearer <token>`
    *   `X-API-Key: <key>`
*   **🔄 改进的 SSE 会话处理**: 更健壮地处理客户端重连，依赖服务器发送的 `endpoint` 事件进行会话同步。
*   **✨ 实时安装输出**: 在 Web UI 中直接监控 Stdio 服务器的安装进度（stdout/stderr）。
*   **✨ 网页终端**: 在 Admin UI 中访问命令行终端，用于直接与服务器环境交互（可选功能，请谨慎使用，存在安全风险）。

---

本服务器作为模型上下文协议 (MCP) 资源服务器的中心枢纽。它可以：

- 连接并管理多个后端的 MCP 服务器（支持 Stdio 和 SSE 类型）。
- 通过统一的 SSE 接口暴露它们组合后的能力（工具、资源），**或者**本身作为一个基于 Stdio 的 MCP 服务器运行。
- 处理将请求路由到合适的后端服务器。
- 在需要时聚合来自多个来源的响应（主要作为代理）。
- 支持多个并发的 SSE 客户端连接，并提供可选的 API 密钥认证。

## 功能特性

### 通过代理进行资源和工具管理
- 发现并连接到 `config/mcp_server.json` 中定义的多个 MCP 资源服务器。
- 聚合来自所有已连接 *活动* 服务器的工具和资源。
- 将工具调用和资源访问请求路由到正确的后端服务器。
- 维护一致的 URI 方案。

### ✨ 可选的 Web Admin UI (`ENABLE_ADMIN_UI=true`)
提供一个基于浏览器的界面，用于管理代理服务器配置和连接的工具。功能包括：
- **服务器配置**: 查看、添加、编辑和删除服务器条目 (`mcp_server.json`)。支持 Stdio 和 SSE 两种服务器类型，并提供相关选项（command, args, env, url, apiKey, bearerToken, install config）。
- **工具配置**: 查看从活动后端服务器发现的所有工具。启用或禁用特定工具。为每个工具覆盖显示名称和描述 (`tool_config.json`)。
- **实时重载**: 通过触发配置重载来应用服务器和工具的配置更改，无需重启整个代理服务器进程。
- **Stdio 服务器安装**: 对于 Stdio 类型的服务器，您可以在配置中定义安装命令。Admin UI 允许您：
    - 触发这些安装命令的执行。
    - **实时监控安装进度**，将实时的 stdout 和 stderr 输出直接流式传输到 UI。
- **网页终端**: 访问集成的基于 Web 的终端，提供对代理服务器运行环境的 shell 访问。
    - **安全警告**: 此功能授予显著的访问权限，应极其谨慎使用，尤其是在管理界面暴露于外部网络时。

## 配置

配置主要通过环境变量和位于 `./config` 目录中的 JSON 文件完成。

### 1. 服务器连接 (`config/mcp_server.json`)
此文件定义了代理应连接的后端 MCP 服务器。

示例 `config/mcp_server.json`:
```json
{
  "mcpServers": {
    "unique-server-key1": {
      "name": "我的 Stdio 服务器",
      "active": true,
      "command": "/path/to/server/executable",
      "args": ["--port", "1234"],
      "env": {
        "API_KEY": "server_specific_key"
      },
      "installDirectory": "/tools/unique-server-key1",
      "installCommands": [
        "git clone https://github.com/some/repo /tools/unique-server-key1",
        "cd /tools/unique-server-key1 && npm install && npm run build"
      ]
    },
    "another-sse-server": {
      "name": "我的 SSE 服务器",
      "active": true,
      "url": "http://localhost:8080/sse",
      "apiKey": "sse_server_api_key"
    },
    "disabled-server": {
        "name": "已禁用的示例",
        "active": false,
        "command": "echo '此服务器已禁用'"
    }
  }
}
```

**字段说明:**
-   `mcpServers`: (必需) 一个对象，其中每个键是后端服务器的唯一标识符。
-   `name`: (可选) 服务器的用户友好显示名称（在 Admin UI 中使用）。
-   `active`: (可选, 默认: `true`) 设置为 `false` 以阻止代理连接到此服务器。
-   `command`: (Stdio 类型必需) 执行服务器进程的命令。
-   `args`: (Stdio 类型可选) 传递给命令的字符串参数数组。
-   `env`: (Stdio 类型可选) 为服务器进程设置的环境变量对象 (`KEY: "value"`)。这些变量会与代理服务器的环境变量合并。
-   `url`: (SSE 类型必需) 后端服务器 SSE 端点的完整 URL。
-   `apiKey`: (SSE 类型可选) 当代理连接到*此特定后端* SSE 服务器时，在 `X-Api-Key` 头部中发送的 API 密钥。
-   `bearerToken`: (SSE 类型可选) 当代理连接到*此特定后端* SSE 服务器时，在 `Authorization: Bearer <token>` 头部中发送的令牌。(如果同时提供了 `apiKey` 和 `bearerToken`，`bearerToken` 优先)。
-   `installDirectory`: (Stdio 类型可选) 服务器应安装到或预期所在的绝对路径。由 Admin UI 的安装功能使用。如果省略，则默认为 `/tools/<server_key>`（相对于容器/环境根目录）。如果使用默认路径并希望使用安装功能，请确保运行代理服务器的用户对父目录（例如 `/tools`）具有写权限。
-   `installCommands`: (Stdio 类型可选) 一个 shell 命令数组。如果 `installDirectory` 不存在，Admin UI 的安装功能将按顺序执行这些命令。命令从代理服务器的工作目录执行。**由于存在安全风险，请谨慎使用。**

### 2. 工具配置 (`config/tool_config.json`)
此文件允许覆盖从后端服务器发现的工具的属性。主要通过 Admin UI 进行管理，但也可以手动编辑。

示例 `config/tool_config.json`:
```json
{
  "tools": {
    "unique-server-key1--tool-name-from-server": {
      "enabled": true,
      "displayName": "我的自定义工具名称",
      "description": "一个更友好的描述。"
    },
    "another-sse-server--another-tool": {
      "enabled": false
    }
  }
}
```
- 键的格式为 `<server_key>--<original_tool_name>`。
- `enabled`: (可选, 默认: `true`) 设置为 `false` 以向连接到代理的客户端隐藏此工具。
- `displayName`: (可选) 在客户端 UI 中覆盖工具的名称。
- `description`: (可选) 覆盖工具的描述。

### 3. 环境变量

-   **`PORT`**: 代理服务器主 SSE 端点（以及 Admin UI，如果启用）监听的端口。默认: `3663`。**注意：** 仅在以 SSE 模式运行时（例如，通过 `npm run dev:sse` 或 Docker 容器）使用。`npm run dev` 脚本以 Stdio 模式运行。
    ```bash
    export PORT=8080
    ```
-   **`MCP_PROXY_SSE_ALLOWED_KEYS`**: (可选) 用于保护代理主 `/sse` 端点的 API 密钥列表（逗号分隔，仅在 SSE 模式下生效）。如果未设置，则禁用认证。客户端必须通过 `X-Api-Key` 头部或 `?key=` 查询参数提供其中一个密钥。
    ```bash
    export MCP_PROXY_SSE_ALLOWED_KEYS="client_key1,client_key2"
    ```
-   **`ENABLE_ADMIN_UI`**: (可选) 设置为 `true` 以启用 Web Admin UI（仅在 SSE 模式下生效）。默认: `false`。
    ```bash
    export ENABLE_ADMIN_UI=true
    ```
-   **`ADMIN_USERNAME`**: (启用 Admin UI 时必需) Admin UI 登录用户名。默认: `admin`。
-   **`ADMIN_PASSWORD`**: (启用 Admin UI 时必需) Admin UI 登录密码。默认: `password` (**请修改!**)。
    ```bash
    export ADMIN_USERNAME=myadmin
    export ADMIN_PASSWORD=aVerySecurePassword123!
    ```
-   **`SESSION_SECRET`**: (可选, 启用 Admin UI 时推荐) 用于签名 session cookie 的密钥。如果未设置，将使用一个默认的、不太安全的密钥，并发出警告。如果未通过环境变量提供，服务器将在首次启用 Admin UI 运行时自动生成一个安全的密钥并保存到 `config/.session_secret`。
    ```bash
    # 推荐: 生成一个强密钥 (例如 openssl rand -hex 32)
    export SESSION_SECRET='your_very_strong_random_secret_here'
    ```

## 开发

安装依赖:
```bash
npm install
# 或 yarn install
```

构建服务器 (将 TypeScript 编译为 JavaScript 到 `build/` 目录):
```bash
npm run build
```

在开发模式下运行 (使用 `tsx` 直接执行 TS 文件，并在文件更改时自动重启):
```bash
# 以 Stdio MCP 服务器模式运行 (默认模式)
npm run dev

# 以 SSE MCP 服务器模式运行 (启用 SSE 端点和 Admin UI，如果配置了)
# 确保按需设置环境变量 (PORT, ENABLE_ADMIN_UI 等)
ENABLE_ADMIN_UI=true npm run dev:sse
```

监视文件更改并自动重新构建 (如果不使用 `tsx`):
```bash
npm run watch
```

## 使用 Docker 运行

项目提供了 `Dockerfile`。容器默认以 **SSE 模式** 运行 (使用 `build/sse.js`) 并包含所有依赖项。

**推荐：使用预构建镜像 (来自 GHCR)**

建议使用 GitHub Container Registry 上的预构建镜像以便于设置。

```bash
# 拉取最新镜像
docker pull ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:latest

# 或拉取特定版本 (例如 v0.1.0)
# docker pull ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:v0.1.0
```

然后，使用拉取的镜像名称运行容器：

```bash
docker run -d \
  -p 3663:3663 \
  -e PORT=3663 \
  -e ENABLE_ADMIN_UI=true \
  -e ADMIN_USERNAME=myadmin \
  -e ADMIN_PASSWORD=yoursupersecretpassword \
  -e MCP_PROXY_SSE_ALLOWED_KEYS="clientkey1" \
  -v ./my_config:/app/config \
  -v /path/on/host/to/tools:/tools \
  --name mcp-proxy \
  ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:latest
```
- 将 `./my_config` 替换为您宿主机上包含 `mcp_server.json` 和可选的 `tool_config.json` 的目录路径。容器期望配置文件位于 `/app/config`。
- 如果您的 Stdio 服务器需要访问挂载到容器内 `/tools` 的可执行文件，请替换 `/path/on/host/to/tools`。
- 如果您拉取了特定版本，请调整标签 (`:latest`)。
- 按需使用 `-e` 标志设置环境变量。

**本地构建镜像 (可选):**
```bash
docker build -t mcp-proxy-server .
```
*(如果您在本地构建，请在上面的 `docker run` 命令中使用 `mcp-proxy-server` 替代 `ghcr.io/...` 镜像名称)。*

## 安装与客户端使用

此代理服务器主要有两种使用方式：

**1. 作为 Stdio MCP 服务器:**
   配置您的 MCP 客户端（如 Claude Desktop）直接运行此代理服务器。代理将连接到其 `config/mcp_server.json` 中定义的后端服务器。

   Claude Desktop 示例 (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "mcp-proxy": {
         "name": "MCP 代理 (聚合器)",
         "command": "/path/to/mcp-proxy-server/build/index.js",
         "env": {
            "NODE_ENV": "production" // 可选: 为代理本身设置环境变量
         }
       }
     }
   }
   ```
   - 将 `/path/to/mcp-proxy-server/build/index.js` 替换为此代理服务器项目构建后的实际入口点路径。确保 `config` 目录相对于命令运行的位置是正确的，或者在代理自己的配置中使用绝对路径。

**2. 作为 SSE MCP 服务器:**
   以 SSE 模式运行代理服务器（例如 `npm run dev:sse` 或 Docker 容器）。然后，配置您的 MCP 客户端连接到代理的 SSE 端点（例如 `http://localhost:3663/sse`）。如果代理启用了 API 密钥认证，请在客户端配置中提供密钥。

   Claude Desktop 示例 (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "my-proxy-sse": {
         "name": "MCP 代理 (SSE)",
         "url": "http://localhost:3663/sse",
         "apiKey": "clientkey1" // 在 MCP_PROXY_SSE_ALLOWED_KEYS 中定义的密钥
       }
     }
   }
   ```

## 调试

使用 [MCP Inspector](https://github.com/modelcontextprotocol/inspector) 进行通信调试（主要用于 Stdio 模式）：
```bash
npm run inspector
```
此脚本会使用 inspector 包装已构建的服务器 (`build/index.js`) 来执行。通过控制台中提供的 URL 访问 inspector UI。对于 SSE 模式，可以使用标准的浏览器开发者工具检查网络请求。

## 参考

本项目最初受到 [ycjcl868/mcp-proxy-server](https://github.com/ycjcl868/mcp-proxy-server) 的启发并基于其进行了重构。