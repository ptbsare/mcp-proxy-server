# Default base image for standalone builds. For addons, this is overridden by build.yaml.
ARG BUILD_FROM=nikolaik/python-nodejs:python3.12-nodejs23
ARG NODE_VERSION=23 # Default Node.js version for addon OS setup

FROM $BUILD_FROM AS base

WORKDIR /mcp-proxy-server

# Arguments for pre-installed packages, primarily for standalone builds.
# These allow users of the standalone Docker image to inject packages at build time.
ARG PRE_INSTALLED_PIP_PACKAGES_ARG="mcp-server-time markitdown-mcp mcp-proxy"
ARG PRE_INSTALLED_NPM_PACKAGES_ARG="g-search-mcp fetcher-mcp playwright time-mcp mcp-trends-hub @adenot/mcp-google-search edgeone-pages-mcp @modelcontextprotocol/server-filesystem mcp-server-weibo @variflight-ai/variflight-mcp @baidumap/mcp-server-baidu-map @modelcontextprotocol/inspector"
ARG PRE_INSTALLED_INIT_COMMAND_ARG="playwright install --with-deps chromium"

# --- OS Level Setup ---
# This section handles OS package installations.
# It differentiates between addon builds (Debian base) and standalone (nikolaik base).

# Common packages needed by the application or build process, regardless of base.
# For nikolaik base, some might be present. For HA base, many need explicit install.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    build-essential \
    python3-dev \
    libffi-dev \
    libssl-dev \
    curl \
    unzip \
    ca-certificates \
    bash \
    ffmpeg \
    git \
    vim \
    dnsutils \
    iputils-ping \
    tini \
    gnupg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# --- Addon Specific OS Setup ---
# Executed only if BUILD_FROM indicates a Home Assistant base image.
RUN if echo "$BUILD_FROM" | grep -q "home-assistant"; then \
    echo "Addon build detected (BUILD_FROM: $BUILD_FROM). Performing addon-specific OS setup." && \
    # Ensure essential build tools and Python are explicitly installed if not already on HA base
    # The common apt-get above might have covered some, this ensures specific versions or presence.
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip && \
    pip3 install uv --no-cache-dir && \
    # Install specific Node.js version for addon
    echo "Installing Node.js v${NODE_VERSION} for addon..." && \
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
    # Install S6-Overlay for addon service management
    echo "Installing S6-Overlay for addon..." && \
    S6_OVERLAY_VERSION=$(curl -sL "https://api.github.com/repos/just-containers/s6-overlay/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/') && \
    echo "Latest S6-Overlay version: $S6_OVERLAY_VERSION" && \
    curl -o /usr/local/bin/s6-overlay-installer.sh -L "https://github.com/just-containers/s6-overlay/releases/download/${S6_OVERLAY_VERSION}/s6-overlay-installer.sh" && \
    chmod +x /usr/local/bin/s6-overlay-installer.sh && \
    /usr/local/bin/s6-overlay-installer.sh / && \
    # Cleanup for addon OS setup
    echo "Cleaning up apt cache for addon OS setup..." && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*; \
    else \
    echo "Standalone build detected (BUILD_FROM: $BUILD_FROM). Skipping addon-specific OS setup."; \
    fi

RUN npm install -g pnpm

RUN if [ -n "$PRE_INSTALLED_PIP_PACKAGES_ARG" ]; then \
      echo "Installing pre-defined PIP packages: $PRE_INSTALLED_PIP_PACKAGES_ARG" && \
      uv pip install --system --no-cache-dir $PRE_INSTALLED_PIP_PACKAGES_ARG; \
    else \
      echo "Skipping pre-defined PIP packages installation."; \
    fi

RUN if [ -n "$PRE_INSTALLED_NPM_PACKAGES_ARG" ]; then \
      echo "Installing pre-defined NPM packages: $PRE_INSTALLED_NPM_PACKAGES_ARG" && \
      npm install -g $PRE_INSTALLED_NPM_PACKAGES_ARG; \
    else \
      echo "Skipping pre-defined NPM packages installation."; \
    fi

RUN if [ -n "$PRE_INSTALLED_INIT_COMMAND_ARG" ]; then \
      echo "Running pre-defined init command: $PRE_INSTALLED_INIT_COMMAND_ARG" && \
      eval $PRE_INSTALLED_INIT_COMMAND_ARG; \
    else \
      echo "Skipping pre-defined init command."; \
    fi

#COPY package.json package-lock.json* ./
#COPY tsconfig.json ./
#COPY public ./public
COPY . .

RUN npm install
RUN npm run build

# --- Environment Variables ---
# Port for the SSE server (and Admin UI if enabled)
ENV PORT=3663

# Optional: Allowed API keys for SSE endpoint (comma-separated)
# ENV MCP_PROXY_SSE_ALLOWED_KEYS=""
# Optional: Enable Admin Web UI (set to "true" to enable)
ENV ENABLE_ADMIN_UI=false

# Optional: Admin UI Credentials (required if ENABLE_ADMIN_UI=true)
# It's recommended to set these via `docker run -e` instead of hardcoding here
ENV ADMIN_USERNAME=admin
ENV ADMIN_PASSWORD=password

# Optional: Default folder for Stdio server installations via Admin UI
ENV TOOLS_FOLDER=/tools

# --- Volumes ---
  # For mcp_server.json and .session_secret
VOLUME /mcp-proxy-server/config
  # For external tools referenced in config, and default install location if TOOLS_FOLDER is /tools
VOLUME /tools

RUN if echo "$BUILD_FROM" | grep -q "home-assistant"; then \
echo "Addon build: Making S6 run script executable..." && \
mkdir -p /etc/cont-init.d/ && \
cp run.sh /etc/cont-init.d/99-run-mcp-proxy && \
chmod +x /etc/cont-init.d/99-run-mcp-proxy; \
else \
echo "Standalone build: S6 run script not made executable (or should be removed if not needed)."; \
# For a pure standalone build without S6, this file might be removed:
# rm -f /etc/cont-init.d/99-run-mcp-proxy; \
fi

# --- Expose Port ---
EXPOSE 3663

# --- Entrypoint & Command ---
ENTRYPOINT ["tini", "--"]

CMD ["node", "build/sse.js"]