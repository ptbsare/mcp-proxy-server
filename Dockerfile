# Default base image for standalone builds. For addons, this is overridden by build.yaml.
ARG BUILD_FROM=nikolaik/python-nodejs:python3.12-nodejs23


FROM $BUILD_FROM AS base
ARG NODE_VERSION=22 # Default Node.js version for addon OS setup
ARG BUILD_FROM # Re-declare ARG to make it available in this stage
WORKDIR /mcp-proxy-server

# Arguments for pre-installed packages, primarily for standalone builds.
# These allow users of the standalone Docker image to inject packages at build time.
ARG PRE_INSTALLED_PIP_PACKAGES_ARG=""
ARG PRE_INSTALLED_NPM_PACKAGES_ARG=""
ARG PRE_INSTALLED_INIT_COMMAND_ARG=""

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
    pip3 install uv --no-cache-dir --break-system-packages && \
    #mkdir -p /tmp/uv_test && uv --python 3.11 venv /tmp/uv_test && rm -rf /tmp/uv_test && \
    #mkdir -p /tmp/uv_test && uv --python 3.12 venv /tmp/uv_test && rm -rf /tmp/uv_test && \
    #mkdir -p /tmp/uv_test && uv --python 3.13 venv /tmp/uv_test && rm -rf /tmp/uv_test && \
    # Install specific Node.js version for addon
    echo "Installing Node.js v${NODE_VERSION} for addon..." && \
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" -o nodesource_setup.sh && \
    bash nodesource_setup.sh && \
    apt-get update && apt-get install -y nodejs && \
    # S6-Overlay is assumed to be part of the Home Assistant base image.
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
      pip install --break-system-packages --no-cache-dir $PRE_INSTALLED_PIP_PACKAGES_ARG; \
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
# COPY . . should come before conditional rootfs copy if rootfs might overlay app files,
# or after if app files might overlay rootfs defaults.
# Assuming app files are primary, then addon specifics overlay.
COPY . .

# --- Addon Specific: Copy rootfs for S6-Overlay and other addon specific files ---
RUN if echo "$BUILD_FROM" | grep -q "home-assistant"; then \
    echo "Addon build: Copying rootfs contents..." && \
    # Ensure rootfs directory exists in the build context
    if [ -d "rootfs" ]; then \
      cp -r rootfs/. / ; \
    else \
      echo "Warning: rootfs directory not found, skipping copy."; \
    fi; \
  else \
    echo "Standalone build: Skipping rootfs copy."; \
  fi

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

# --- Expose Port ---
EXPOSE 3663

# --- Entrypoint & Command ---
# For Home Assistant addon builds, the entrypoint is /init (from S6-Overlay in the base image).
# CMD is also typically handled by S6 services defined in rootfs.
# By not specifying ENTRYPOINT or CMD here, we rely on the base image's defaults when built as an addon.
# For standalone builds, users will need to specify the command when running the container,
# e.g., docker run <image_name> tini -- node build/sse.js
# Or, a multi-stage build could define a specific entrypoint/cmd for the standalone target.