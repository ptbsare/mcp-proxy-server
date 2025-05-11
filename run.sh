#!/usr/bin/with-contenv bashio
# ==============================================================================
# Home Assistant Add-on: MCP Proxy Server
#
# This script starts the MCP Proxy Server.
# ==============================================================================

# --- Read configuration from options.json ---
export PORT=$(bashio::config 'port')
export ENABLE_ADMIN_UI=$(bashio::config 'enable_admin_ui')
export ADMIN_USERNAME=$(bashio::config 'admin_username')
export ADMIN_PASSWORD=$(bashio::config 'admin_password')
export TOOLS_FOLDER=$(bashio::config 'tools_folder')
export MCP_PROXY_SSE_ALLOWED_KEYS=$(bashio::config 'mcp_proxy_sse_allowed_keys')

bashio::log.info "Starting MCP Proxy Server..."
bashio::log.info "Port: ${PORT}"
bashio::log.info "Admin UI Enabled: ${ENABLE_ADMIN_UI}"
if [[ "${ENABLE_ADMIN_UI}" == "true" ]]; then
    bashio::log.info "Admin Username: ${ADMIN_USERNAME}"
fi
bashio::log.info "Tools Folder: ${TOOLS_FOLDER}" # This is /share/mcp_tools by default
if [[ -n "${MCP_PROXY_SSE_ALLOWED_KEYS}" ]]; then
    bashio::log.info "Allowed SSE Keys are configured."
else
    bashio::log.info "No SSE Keys configured, SSE endpoint is open or uses internal auth."
fi

# --- Define application paths ---
# APP_BASE_DIR is the working directory set in Dockerfile, and where app files are copied.
APP_BASE_DIR="/mcp-proxy-server"
# APP_CONFIG_DIR_PERSISTENT is the path INSIDE the container where the app's config
# is persistently stored. This path is mapped from the host's addon config directory.
APP_CONFIG_DIR_PERSISTENT="${APP_BASE_DIR}/config" # i.e., /mcp-proxy-server/config

# --- Ensure application persistent config folder exists ---
# This directory inside the container is mapped from the host.
if [ ! -d "${APP_CONFIG_DIR_PERSISTENT}" ]; then
    bashio::log.info "Creating application persistent config folder at ${APP_CONFIG_DIR_PERSISTENT}..."
    # This directory should be created by HA supervisor based on 'map' in config.yaml
    # but creating it here ensures it if somehow not present.
    mkdir -p "${APP_CONFIG_DIR_PERSISTENT}"
fi

# --- Copy example config files if they don't exist in the persistent config volume ---
# Example files are assumed to be part of the application build,
# located at $APP_BASE_DIR/config/ (e.g., /mcp-proxy-server/config/mcp_server.json.example)
# These are copied to the *persistent* config directory if not already present.
EXAMPLE_CONFIG_SOURCE_DIR="${APP_BASE_DIR}/config" # Source of examples within the built app

if [ -f "${EXAMPLE_CONFIG_SOURCE_DIR}/mcp_server.json.example" ] && [ ! -f "${APP_CONFIG_DIR_PERSISTENT}/mcp_server.json" ]; then
    bashio::log.info "Copying mcp_server.json.example to ${APP_CONFIG_DIR_PERSISTENT}/mcp_server.json..."
    cp "${EXAMPLE_CONFIG_SOURCE_DIR}/mcp_server.json.example" "${APP_CONFIG_DIR_PERSISTENT}/mcp_server.json"
fi
if [ -f "${EXAMPLE_CONFIG_SOURCE_DIR}/tool_config.json.example" ] && [ ! -f "${APP_CONFIG_DIR_PERSISTENT}/tool_config.json" ]; then
    bashio::log.info "Copying tool_config.json.example to ${APP_CONFIG_DIR_PERSISTENT}/tool_config.json..."
    cp "${EXAMPLE_CONFIG_SOURCE_DIR}/tool_config.json.example" "${APP_CONFIG_DIR_PERSISTENT}/tool_config.json"
fi
# Note: The application itself needs to be configured to read from APP_CONFIG_DIR_PERSISTENT.
# For example, src/config.ts should use paths like /mcp-proxy-server/config/mcp_server.json

# --- Ensure tools folder exists (mapped from /share by config.yaml) ---
if [ ! -d "${TOOLS_FOLDER}" ]; then
    bashio::log.info "Creating tools folder at ${TOOLS_FOLDER}..."
    mkdir -p "${TOOLS_FOLDER}"
fi

# --- Navigate to application base directory and start the server ---
cd "${APP_BASE_DIR}" || exit 1

bashio::log.info "Executing Node.js application: node build/sse.js"
bashio::log.info "Application should read its config from: ${APP_CONFIG_DIR_PERSISTENT}"
bashio::log.info "IMPORTANT: Ensure your application (e.g., src/config.ts) uses the absolute path '${APP_CONFIG_DIR_PERSISTENT}' for its configuration files (mcp_server.json, tool_config.json)."

# Environment variables PORT, ENABLE_ADMIN_UI, etc., are set.
# The application (build/sse.js) must be modified to load its mcp_server.json
# and tool_config.json from the absolute path APP_CONFIG_DIR_PERSISTENT.
exec node build/sse.js