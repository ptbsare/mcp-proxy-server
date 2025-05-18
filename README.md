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
    "unique-server-key1--tool-name-from-server": {
      "enabled": true,
      "displayName": "My Custom Tool Name",
      "description": "A more user-friendly description."
    },
    "another-sse-server--another-tool": {
      "enabled": false
    }
  }
}
```
- Keys are in the format `<server_key>--<original_tool_name>`.
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