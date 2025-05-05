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
      pnpm add -g $PRE_INSTALLED_NPM_PACKAGES; \
    else \
      echo "Skipping pre-defined NPM packages installation."; \
    fi

RUN if [ -n "$PRE_INSTALLED_INIT_COMMAND" ]; then \
      echo "Running pre-defined init command: $PRE_INSTALLED_INIT_COMMAND" && \
      eval $PRE_INSTALLED_INIT_COMMAND; \
    else \
      echo "Skipping pre-defined init command."; \
    fi

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile --prod=false

COPY . .

RUN pnpm run build

VOLUME /mcp-proxy-server/config
VOLUME /tools

EXPOSE 3663

ENTRYPOINT ["tini", "--"]

CMD ["node", "build/sse.js"]