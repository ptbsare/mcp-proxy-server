# MCP Proxy Server Home Assistant Add-on

This add-on integrates the MCP Proxy Server into Home Assistant, allowing you to manage and proxy multiple Model Context Protocol (MCP) servers through a unified interface.

## About

The MCP Proxy Server acts as a central hub for your MCP resource servers. Key features include:

*   **Web UI Management**: Easily manage all connected MCP servers (Stdio and SSE types) through an intuitive web interface.
*   **Granular Tool Control**: Enable or disable individual tools from backend servers and override their display names/descriptions.
*   **SSE Authentication**: Secure the proxy's SSE endpoint.
*   **Real-time Installation Output**: Monitor Stdio server installation progress directly in the Web UI.
*   **Web Terminal**: Access a command-line terminal within the Admin UI for direct server interaction (use with caution).

This add-on exposes these features within your Home Assistant environment.

## Installation

1.  **Add the Repository**:
    *   Navigate to the Home Assistant Supervisor add-on store.
    *   Click on the 3-dots menu in the top right and select "Repositories".
    *   Add the following URL: `https://github.com/ptbsare/home-assistant-addons`.
    *   Close the dialog.

2.  **Install the Add-on**:
    *   After adding the repository, refresh the add-on store page (you might need to wait a few moments for the new repository to be processed).
    *   Search for "MCP Proxy Server" and click on it.
    *   Click "INSTALL" and wait for the installation to complete.

## Configuration

Once installed, you need to configure the add-on before starting it. The following options are available in the "Configuration" tab of the add-on:

| Option                         | Type    | Default Value        | Description                                                                                                                               |
| ------------------------------ | ------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `port`                         | integer | `3663`               | The network port on which the MCP Proxy Server's SSE endpoint and Admin Web UI will be accessible.                                        |
| `enable_admin_ui`              | boolean | `true`               | Set to `true` to enable the Admin Web UI. This is required for Ingress access.                                                            |
| `admin_username`               | string  | `admin`              | Username for accessing the Admin Web UI. **It is strongly recommended to change this.**                                                     |
| `admin_password`               | password| `password`           | Password for accessing the Admin Web UI. **It is strongly recommended to change this to a strong, unique password.**                         |
| `tools_folder`                 | string  | `/share/mcp_tools`   | The base directory within Home Assistant's `/share` folder where Stdio MCP servers can be installed via the Admin UI.                       |
| `mcp_proxy_sse_allowed_keys` | string  | (empty)              | Optional. A comma-separated list of API keys to secure the proxy's main `/sse` endpoint. If empty, authentication for the SSE endpoint is disabled. |

**Important Configuration Notes**:

*   **Persistent Configuration Files**: The core configuration files for the MCP Proxy Server itself (`mcp_server.json` and `tool_config.json`) are stored within the add-on's persistent configuration directory. In Home Assistant, this is mapped from `/mcp-proxy-server/config` inside the container to a location like `/config/addons_config/mcp_proxy_server/` (or similar, depending on your HA setup) on your Home Assistant host system.
    *   You should place your `mcp_server.json` (defining backend MCP servers) and `tool_config.json` (for tool overrides) in this mapped directory on your Home Assistant host.
    *   Refer to the main [MCP Proxy Server README](README.md) for details on the structure of these JSON files.
    *   If these files are not present when the add-on starts, example versions might be copied, which you can then edit.
*   **Tools Folder**: The `tools_folder` option defaults to `/share/mcp_tools`. This means any Stdio servers installed via the Admin UI will be placed in a subdirectory under the `/share/mcp_tools/` directory on your Home Assistant host system. Ensure this path is accessible and writable if you intend to use this feature.

## Usage

1.  **Start the Add-on**: Once configured, go to the add-on page and click "START". Check the "Log" tab for any errors.
2.  **Accessing the Admin UI**:
    *   If Ingress is enabled (default), you can access the Admin UI directly from the Home Assistant sidebar by clicking on "MCP Proxy Server".
    *   Alternatively, if `enable_admin_ui` is `true`, you can access it at `http://<your-home-assistant-ip>:<port_configured_in_options>`.
3.  **Configuring Backend Servers**: Use the Admin UI to add and manage your backend MCP servers (both Stdio and SSE types). This involves editing the `mcp_server.json` content through the UI or directly in the file system.
4.  **Managing Tools**: Use the Admin UI to enable/disable tools from connected servers or override their display names and descriptions (`tool_config.json`).
5.  **Connecting Clients**: Configure your MCP clients (e.g., Claude Desktop, other compatible applications) to connect to this add-on's SSE endpoint:
    *   **URL**: `http://<your-home-assistant-ip>:<port_configured_in_options>/sse`
    *   **Authentication**: If you have set `mcp_proxy_sse_allowed_keys`, your client will need to provide one of these keys, typically via an `X-Api-Key` header or a `?key=<your_key>` query parameter in the URL.

## Support and Issues

For issues specifically related to this Home Assistant add-on, please open an issue on the [GitHub repository](https://github.com/ptbsare/home-assistant-addons/issues).

For issues related to the MCP Proxy Server application itself, refer to its own documentation or support channels.

---

*This documentation is for the MCP Proxy Server Home Assistant Add-on. For more detailed information about the MCP Proxy Server application, please see its main [README.md](README.md).*