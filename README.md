# MCP Proxy Server

An MCP proxy server that aggregates and serves multiple MCP resource servers through a single interface. This server acts as a central hub that can:

- Connect to and manage multiple MCP resource servers
- Expose their combined capabilities through a unified interface
- Handle routing of requests to appropriate backend servers
- Aggregate responses from multiple sources
- Supports multiple simultaneous SSE client connections

## Features

### Resource Management
- Discover and connect to multiple MCP resource servers
- Aggregate resources from all connected servers
- Maintain consistent URI schemes across servers
- Handle resource routing and resolution

### Tool Aggregation
- Expose tools from all connected servers
- Route tool calls to appropriate backend servers
- Maintain tool state and handle responses

### Prompt Handling
- Aggregate prompts from all connected servers
- Route prompt requests to appropriate backends
- Handle multi-server prompt responses

## Configuration

The server requires a JSON configuration file named `mcp_server.json` located in the `config` subdirectory relative to the working directory (i.e., `./config/mcp_server.json`), specifying the MCP servers to connect to. A default empty configuration file is included.

Example `config/mcp_server.json` structure:
```json
{
  "mcpServers": {
    "server1-name": {
      "command": "/path/to/server1/executable",
      "args": ["--optional-arg"],
      "env": {
        "API_KEY": "your_api_key_here"
      }
    },
    "server2-stdio": {
      "command": "server2-command"
    },
    "server3-sse": {
      "url": "http://localhost:8080/sse"
    }
  }
}
```

-   `mcpServers`: An object where each key is a unique name for the server.
-   `command`: (Required for stdio) The command to execute the server.
-   `args`: (Optional for stdio) An array of arguments to pass to the command.
-   `env`: (Optional for stdio) An object of environment variables to set for the server process. These are merged with the proxy server's environment.
-   `url`: (Required for SSE) The URL for the Server-Sent Events endpoint.

The server reads `mcp_server.json` from the `config` subdirectory.

### SSE Server Port

The port on which the SSE server listens can be configured using the `PORT` environment variable. If this variable is not set, the server defaults to port `3663`.

Example:
```bash
export PORT=8080
```
### SSE Authentication (Optional)

To secure the `/sse` endpoint, you can configure API key authentication using the `MCP_PROXY_SSE_ALLOWED_KEYS` environment variable.

```bash
export MCP_PROXY_SSE_ALLOWED_KEYS="key1,key2,another-secure-key"
```

- Set `MCP_PROXY_SSE_ALLOWED_KEYS` to a comma-separated list of allowed API keys.
- If this variable is not set or is empty, authentication is disabled, and any client can connect to `/sse`.
- Clients must provide one of the allowed keys either via the `X-API-Key` HTTP header or the `key` query parameter (e.g., `/sse?key=key1`).

## Development

Install dependencies (uses `@modelcontextprotocol/sdk` v1.11.0 or later):
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

For development with continuous run:
```bash
# Stdio
npm run dev
# SSE
npm run dev:sse
```

## Running with Docker

A `Dockerfile` is provided to build a container image for the proxy server.

**Building the Image:**

```bash
docker build -t mcp-proxy-server .
```

**Running the Container (Building Locally):**

If you built the image locally, you need to mount volumes for the configuration and any external tools:

```bash
docker run -d \
  -p 3663:3663 \
  -v ./path/to/your/config:/mcp-proxy-server/config \
  -v ./path/to/your/tools:/tools \
  --name mcp-proxy-server \
  mcp-proxy-server
```

- Replace `./path/to/your/config` with the path to a directory on your host machine containing your `mcp_server.json` file. The container expects the file at `/mcp-proxy-server/config/mcp_server.json`.
- Replace `./path/to/your/tools` with the path to a directory containing executables or scripts for any external MCP servers you reference in your config using absolute paths like `/tools/my-server/run.sh`.
- You can pass environment variables like `MCP_PROXY_SSE_ALLOWED_KEYS` using the `-e` flag (e.g., `-e MCP_PROXY_SSE_ALLOWED_KEYS="key1,key2"`).

**Using the Pre-built Image (from GHCR):**

Alternatively, you can pull the pre-built image directly from the GitHub Container Registry:

```bash
# Pull the latest image
docker pull ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:latest

# Or pull a specific version (e.g., v0.1.0)
# docker pull ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:v0.1.0
```

Then, run the container using the pulled image name:

```bash
docker run -d \
  -p 3663:3663 \
  -v ./path/to/your/config:/mcp-proxy-server/config \
  -v ./path/to/your/tools:/tools \
  --name mcp-proxy-server \
  ghcr.io/ptbsare/mcp-proxy-server/mcp-proxy-server:latest
```

- Remember to replace `./path/to/your/config` and `./path/to/your/tools` with your actual host paths.
- Adjust the tag (`:latest`) if you pulled a specific version.
- Pass environment variables using the `-e` flag as needed.

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-proxy-server": {
      "command": "/path/to/mcp-proxy-server/build/index.js",
      "env": {}
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Referrance

Rewrite from (https://github.com/ycjcl868/mcp-proxy-server)