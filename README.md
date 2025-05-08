# MCP Proxy Server

[简体中文](README_ZH.md)
## ✨ Key Features Highlight

*   **🌐 Web UI Management:** Easily manage all connected MCP servers through an intuitive web interface (optional, requires enabling).
*   **🔧 Granular Tool Control:** Enable or disable individual tools, and override display names/descriptions via the Web UI.
*   **🔒 Dual SSE Authentication:** Secure your SSE endpoint with flexible authentication options (`Authorization: Bearer <token>` or `X-API-Key: <key>`).
*   **🔄 Improved SSE Session Handling**: More robust handling of client reconnections, relying on server-sent `endpoint` events for session synchronization.
*   **✨ Real-time Install Output**: Monitor Stdio server installation progress (stdout/stderr) directly in the Web UI.
*   **✨ Web Terminal**: Access a command-line terminal within the Admin UI for direct server interaction (optional,  use with caution due to security risks).

---

This server acts as a central hub for Model Context Protocol (MCP) resource servers. It can:

- Connect to and manage multiple backend MCP servers (both Stdio and SSE types).
- Expose their combined capabilities (tools, resources) through a single, unified SSE interface.
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
- **Server Configuration**: View, add, edit, and delete server entries (`mcp_server.json`). Supports both Stdio and SSE server types with relevant options (command, args, env, url, apiKey, bearerToken, install config).
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
      "name": "My Stdio Server",
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
      "name": "My SSE Server",
      "active": true,
      "url": "http://localhost:8080/sse",
      "apiKey": "sse_server_api_key"
    },
    "disabled-server": {
        "name": "Disabled Example",
        "active": false,
        "command": "echo 'This server is disabled'"
    }
  }
}
```

**Fields:**
-   `mcpServers`: (Required) An object where each key is a unique identifier for a backend server.
-   `name`: (Optional) A user-friendly display name for the server (used in Admin UI).
-   `active`: (Optional, default: `true`) Set to `false` to prevent the proxy from connecting to this server.
-   `command`: (Required for Stdio type) The command to execute the server process.
-   `args`: (Optional for Stdio type) An array of string arguments to pass to the command.
-   `env`: (Optional for Stdio type) An object of environment variables (`KEY: "value"`) to set for the server process. These are merged with the proxy server's environment.
-   `url`: (Required for SSE type) The full URL of the backend server's SSE endpoint.
-   `apiKey`: (Optional for SSE type) An API key to send in the `X-Api-Key` header when the proxy connects to *this specific backend* SSE server.
-   `bearerToken`: (Optional for SSE type) A token to send in the `Authorization: Bearer <token>` header when connecting to *this specific backend* SSE server. (If both `apiKey` and `bearerToken` are provided, `bearerToken` takes precedence).
-   `installDirectory`: (Optional for Stdio type) The absolute path where the server should be installed or is expected to be found. Used by the Admin UI's installation feature. If omitted, it defaults to `/tools/<server_key>` (relative to the container/environment root). Ensure the parent directory (e.g., `/tools`) is writable by the user running the proxy server if using the default and the install feature.
-   `installCommands`: (Optional for Stdio type) An array of shell commands executed sequentially by the Admin UI's installation feature if the `installDirectory` does not exist. Commands are executed from the proxy server's working directory. **Use with extreme caution due to security risks.**

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

-   **`PORT`**: Port for the proxy server's main SSE endpoint (and Admin UI if enabled). Default: `3663`.
    ```bash
    export PORT=8080
    ```
-   **`MCP_PROXY_SSE_ALLOWED_KEYS`**: (Optional) Comma-separated list of API keys to secure the proxy's main `/sse` endpoint. If not set, authentication is disabled. Clients must provide a key via `X-Api-Key` header or `?key=` query parameter.
    ```bash
    export MCP_PROXY_SSE_ALLOWED_KEYS="client_key1,client_key2"
    ```
-   **`ENABLE_ADMIN_UI`**: (Optional) Set to `true` to enable the Web Admin UI. Default: `false`.
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
# For the main proxy server (usually connects to stdio backends)
npm run dev

# For the SSE-only server variant (if needed, uses src/sse.ts entry point)
# Ensure environment variables (PORT, ENABLE_ADMIN_UI etc.) are set as needed
ENABLE_ADMIN_UI=true npm run dev:sse
```

Watch for changes and rebuild automatically (useful if not using `tsx`):
```bash
npm run watch
```

## Running with Docker

A `Dockerfile` is provided which includes `node-pty`.

**Building the Image:**
```bash
docker build -t mcp-proxy-server .
```

**Running the Container:**
Mount your configuration directory and optionally a tools directory. Set environment variables as needed.

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
  mcp-proxy-server
```
- Replace `./my_config` with your host path containing `mcp_server.json` and optionally `tool_config.json`. The container expects config files in `/app/config`.
- Replace `/path/on/host/to/tools` if your Stdio servers require access to executables mounted at `/tools` inside the container.
- The image includes `node-pty` by default.

## Installation & Usage with Clients

Configure your MCP client (like Claude Desktop, VS Code extensions, etc.) to connect to the proxy server's SSE endpoint (e.g., `http://localhost:3663/sse`). If you enabled API key authentication, provide one of the allowed keys in the client configuration (usually via `apiKey` or headers).

Example for Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "my-proxy": {
      "name": "MCP Proxy",
      "url": "http://localhost:3663/sse",
      "apiKey": "clientkey1"
    }
  }
}
```
*(Note: The original README section about installing the proxy *as* a backend server seems less relevant now, as the primary use case is running the proxy and having clients connect *to* it. The above example shows how a client connects.)*

## Debugging

Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for debugging communication:
```bash
npm run inspector
```
This script wraps the execution of the built server (`build/index.js`) with the inspector. Access the inspector UI via the URL provided in the console output.

## Reference

This project was originally inspired by and refactored from [ycjcl868/mcp-proxy-server](https://github.com/ycjcl868/mcp-proxy-server).