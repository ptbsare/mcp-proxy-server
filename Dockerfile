FROM nikolaik/python-nodejs:python3.13-nodejs23

WORKDIR /mcp-proxy-server

ARG PRE_INSTALLED_PIP_PACKAGES_ARG="mcp-server-time markitdown-mcp mcp-proxy uv"
ARG PRE_INSTALLED_NPM_PACKAGES_ARG="g-search-mcp fetcher-mcp playwright time-mcp mcp-trends-hub@1.6.0 @adenot/mcp-google-search edgeone-pages-mcp @modelcontextprotocol/server-filesystem mcp-server-weibo @variflight-ai/variflight-mcp @baidumap/mcp-server-baidu-map @modelcontextprotocol/inspector"
ARG PRE_INSTALLED_INIT_COMMAND_ARG="playwright install --with-deps chromium"

ENV PRE_INSTALLED_PIP_PACKAGES=$PRE_INSTALLED_PIP_PACKAGES_ARG
ENV PRE_INSTALLED_NPM_PACKAGES=$PRE_INSTALLED_NPM_PACKAGES_ARG
ENV PRE_INSTALLED_INIT_COMMAND=$PRE_INSTALLED_INIT_COMMAND_ARG

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
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

RUN if [ -n "$PRE_INSTALLED_PIP_PACKAGES" ]; then \
      echo "Installing pre-defined PIP packages: $PRE_INSTALLED_PIP_PACKAGES" && \
      uv pip install --system --no-cache-dir $PRE_INSTALLED_PIP_PACKAGES; \
    else \
      echo "Skipping pre-defined PIP packages installation."; \
    fi

RUN if [ -n "$PRE_INSTALLED_NPM_PACKAGES" ]; then \
      echo "Installing pre-defined NPM packages: $PRE_INSTALLED_NPM_PACKAGES" && \
      npm install -g $PRE_INSTALLED_NPM_PACKAGES; \
    else \
      echo "Skipping pre-defined NPM packages installation."; \
    fi

RUN if [ -n "$PRE_INSTALLED_INIT_COMMAND" ]; then \
      echo "Running pre-defined init command: $PRE_INSTALLED_INIT_COMMAND" && \
      eval $PRE_INSTALLED_INIT_COMMAND; \
    else \
      echo "Skipping pre-defined init command."; \
    fi
    
COPY package.json package-lock.json* ./

COPY public ./public # Copy the admin UI files
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

# --- Volumes ---
  # For mcp_server.json and .session_secret
VOLUME /mcp-proxy-server/config
  # For external tools referenced in config
VOLUME /tools

# --- Expose Port ---
EXPOSE 3663

# --- Entrypoint & Command ---
ENTRYPOINT ["tini", "--"]

CMD ["node", "build/sse.js"]