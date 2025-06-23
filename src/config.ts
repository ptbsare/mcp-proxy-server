import { readFile } from 'fs/promises';
import { resolve } from 'path';

export type TransportConfigStdio = {
  type: 'stdio';
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  active?: boolean;
  installDirectory?: string;
  installCommands?: string[];
}

export type TransportConfigSSE = {
  type: 'sse';
  name?: string;
  url: string;
  active?: boolean;
  apiKey?: string;
  bearerToken?: string;
}

export type TransportConfigHTTP = {
  type: 'http';
  name?: string;
  url: string;
  active?: boolean;
  apiKey?: string; // Assuming similar auth for now
  bearerToken?: string; // Assuming similar auth for now
  // Add any HTTP specific options if needed, e.g., custom headers not covered by apiKey/bearerToken
  // requestInit?: RequestInit; // This is a more generic way if SDK supports it directly in config
}

export type TransportConfig = (TransportConfigStdio | TransportConfigSSE | TransportConfigHTTP) & { name?: string, active?: boolean, type: 'stdio' | 'sse' | 'http' };

export interface ProxySettings {
  retrySseToolCallOnDisconnect?: boolean;
  retryHttpToolCall?: boolean;
  httpToolCallMaxRetries?: number;
  httpToolCallRetryDelayBaseMs?: number;
  retryStdioToolCall?: boolean; // Add stdio retry flag
  stdioToolCallMaxRetries?: number; // Add stdio max retries
  stdioToolCallRetryDelayBaseMs?: number; // Add stdio retry delay
}

export interface Config {
  mcpServers: Record<string, TransportConfig>;
  proxy?: ProxySettings;
}


export interface ToolSettings {
  enabled: boolean;
  exposedName?: string;
  exposedDescription?: string;
}

export interface ToolConfig {
  tools: Record<string, ToolSettings>;
}


export function isSSEConfig(config: TransportConfig): config is TransportConfigSSE {
  return config.type === 'sse';
}

export function isStdioConfig(config: TransportConfig): config is TransportConfigStdio {
  return config.type === 'stdio';
}

export function isHttpConfig(config: TransportConfig): config is TransportConfigHTTP {
  return config.type === 'http';
}


export const loadConfig = async (): Promise<Config> => {
  // Define standard defaults for specific environment-overrideable proxy settings
  // This is moved here to be in scope for both try and catch blocks.
  const defaultEnvProxySettings = {
      retrySseToolCallOnDisconnect: true,
      retryHttpToolCall: true,
      httpToolCallMaxRetries: 2,
      httpToolCallRetryDelayBaseMs: 300,
      retryStdioToolCall: true, // Default for stdio retry
      stdioToolCallMaxRetries: 2, // Default for stdio max retries
      stdioToolCallRetryDelayBaseMs: 300, // Default for stdio retry delay
  };

  try {
    const configPath = resolve(process.cwd(), 'config', 'mcp_server.json');
    console.log(`Attempting to load configuration from: ${configPath}`);
    const fileContents = await readFile(configPath, 'utf-8');
    const parsedConfig = JSON.parse(fileContents) as Config;

    if (typeof parsedConfig !== 'object' || parsedConfig === null || typeof parsedConfig.mcpServers !== 'object') {
        throw new Error('Invalid config format: mcpServers object not found.');
    }

    // Initialize proxy object on parsedConfig if it doesn't exist
    // This ensures that other proxy settings from the file are preserved if they exist.
    parsedConfig.proxy = parsedConfig.proxy || {};

    // Override with environment variables or defaults for the specific settings
    // 1. RETRY_SSE_TOOL_CALL_ON_DISCONNECT
    const sseRetryEnv = process.env.RETRY_SSE_TOOL_CALL_ON_DISCONNECT;
    if (sseRetryEnv && sseRetryEnv.trim() !== '') {
        parsedConfig.proxy.retrySseToolCallOnDisconnect = sseRetryEnv.toLowerCase() === 'true';
    } else {
        parsedConfig.proxy.retrySseToolCallOnDisconnect = defaultEnvProxySettings.retrySseToolCallOnDisconnect;
    }

    // 2. RETRY_HTTP_TOOL_CALL
    const httpRetryEnv = process.env.RETRY_HTTP_TOOL_CALL;
    if (httpRetryEnv && httpRetryEnv.trim() !== '') {
        parsedConfig.proxy.retryHttpToolCall = httpRetryEnv.toLowerCase() === 'true';
    } else {
        parsedConfig.proxy.retryHttpToolCall = defaultEnvProxySettings.retryHttpToolCall;
    }

    // 3. HTTP_TOOL_CALL_MAX_RETRIES
    const maxRetriesEnv = process.env.HTTP_TOOL_CALL_MAX_RETRIES;
    if (maxRetriesEnv && maxRetriesEnv.trim() !== '') {
        const numVal = parseInt(maxRetriesEnv, 10);
        if (!isNaN(numVal)) {
            parsedConfig.proxy.httpToolCallMaxRetries = numVal;
        } else {
            console.warn(`Invalid value for HTTP_TOOL_CALL_MAX_RETRIES: "${maxRetriesEnv}". Using default: ${defaultEnvProxySettings.httpToolCallMaxRetries}.`);
            parsedConfig.proxy.httpToolCallMaxRetries = defaultEnvProxySettings.httpToolCallMaxRetries;
        }
    } else {
        parsedConfig.proxy.httpToolCallMaxRetries = defaultEnvProxySettings.httpToolCallMaxRetries;
    }

    // 4. HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS
    const delayBaseEnv = process.env.HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS;
    if (delayBaseEnv && delayBaseEnv.trim() !== '') {
        const numVal = parseInt(delayBaseEnv, 10);
        if (!isNaN(numVal)) {
            parsedConfig.proxy.httpToolCallRetryDelayBaseMs = numVal;
        } else {
            console.warn(`Invalid value for HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS: "${delayBaseEnv}". Using default: ${defaultEnvProxySettings.httpToolCallRetryDelayBaseMs}.`);
            parsedConfig.proxy.httpToolCallRetryDelayBaseMs = defaultEnvProxySettings.httpToolCallRetryDelayBaseMs;
        }
    } else {
        parsedConfig.proxy.httpToolCallRetryDelayBaseMs = defaultEnvProxySettings.httpToolCallRetryDelayBaseMs;
    }

    // 5. RETRY_STDIO_TOOL_CALL
    const stdioRetryEnv = process.env.RETRY_STDIO_TOOL_CALL;
    if (stdioRetryEnv && stdioRetryEnv.trim() !== '') {
        parsedConfig.proxy.retryStdioToolCall = stdioRetryEnv.toLowerCase() === 'true';
    } else {
        parsedConfig.proxy.retryStdioToolCall = defaultEnvProxySettings.retryStdioToolCall;
    }

    // 6. STDIO_TOOL_CALL_MAX_RETRIES
    const stdioMaxRetriesEnv = process.env.STDIO_TOOL_CALL_MAX_RETRIES;
    if (stdioMaxRetriesEnv && stdioMaxRetriesEnv.trim() !== '') {
        const numVal = parseInt(stdioMaxRetriesEnv, 10);
        if (!isNaN(numVal)) {
            parsedConfig.proxy.stdioToolCallMaxRetries = numVal;
        } else {
            console.warn(`Invalid value for STDIO_TOOL_CALL_MAX_RETRIES: "${stdioMaxRetriesEnv}". Using default: ${defaultEnvProxySettings.stdioToolCallMaxRetries}.`);
            parsedConfig.proxy.stdioToolCallMaxRetries = defaultEnvProxySettings.stdioToolCallMaxRetries;
        }
    } else {
        parsedConfig.proxy.stdioToolCallMaxRetries = defaultEnvProxySettings.stdioToolCallMaxRetries;
    }

    // 7. STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS
    const stdioDelayBaseEnv = process.env.STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS;
    if (stdioDelayBaseEnv && stdioDelayBaseEnv.trim() !== '') {
        const numVal = parseInt(stdioDelayBaseEnv, 10);
        if (!isNaN(numVal)) {
            parsedConfig.proxy.stdioToolCallRetryDelayBaseMs = numVal;
        } else {
            console.warn(`Invalid value for STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS: "${stdioDelayBaseEnv}". Using default: ${defaultEnvProxySettings.stdioToolCallRetryDelayBaseMs}.`);
            parsedConfig.proxy.stdioToolCallRetryDelayBaseMs = defaultEnvProxySettings.stdioToolCallRetryDelayBaseMs;
        }
    } else {
        parsedConfig.proxy.stdioToolCallRetryDelayBaseMs = defaultEnvProxySettings.stdioToolCallRetryDelayBaseMs;
    }

    // The parsedConfig now has its proxy settings correctly reflecting env overrides for the specified fields.
    // Other fields in parsedConfig.proxy loaded from the file remain untouched.
    // Other parts of parsedConfig (like mcpServers) are also as loaded from the file.

    console.log("Loaded config with final proxy settings (after env overrides):", parsedConfig.proxy);
    return parsedConfig; // Return the modified parsedConfig

  } catch (error) {
    console.error(`Error loading config/mcp_server.json:`, error);
    
    // If file loading fails, initialize with environment variables or defaults for proxy settings
    const proxySettingsFromEnvOrDefaults: ProxySettings = {
        retrySseToolCallOnDisconnect: defaultEnvProxySettings.retrySseToolCallOnDisconnect,
        retryHttpToolCall: defaultEnvProxySettings.retryHttpToolCall,
        httpToolCallMaxRetries: defaultEnvProxySettings.httpToolCallMaxRetries,
        httpToolCallRetryDelayBaseMs: defaultEnvProxySettings.httpToolCallRetryDelayBaseMs,
        retryStdioToolCall: defaultEnvProxySettings.retryStdioToolCall, // Default for stdio retry
        stdioToolCallMaxRetries: defaultEnvProxySettings.stdioToolCallMaxRetries, // Default for stdio max retries
        stdioToolCallRetryDelayBaseMs: defaultEnvProxySettings.stdioToolCallRetryDelayBaseMs, // Default for stdio retry delay
    };

    const sseRetryEnvCatch = process.env.RETRY_SSE_TOOL_CALL_ON_DISCONNECT;
    if (sseRetryEnvCatch && sseRetryEnvCatch.trim() !== '') {
        proxySettingsFromEnvOrDefaults.retrySseToolCallOnDisconnect = sseRetryEnvCatch.toLowerCase() === 'true';
    }

    const httpRetryEnvCatch = process.env.RETRY_HTTP_TOOL_CALL;
    if (httpRetryEnvCatch && httpRetryEnvCatch.trim() !== '') {
        proxySettingsFromEnvOrDefaults.retryHttpToolCall = httpRetryEnvCatch.toLowerCase() === 'true';
    }
    
    const maxRetriesEnvCatch = process.env.HTTP_TOOL_CALL_MAX_RETRIES;
    if (maxRetriesEnvCatch && maxRetriesEnvCatch.trim() !== '') {
        const numVal = parseInt(maxRetriesEnvCatch, 10);
        if (!isNaN(numVal)) {
            proxySettingsFromEnvOrDefaults.httpToolCallMaxRetries = numVal;
        } else {
            console.warn(`Invalid value for HTTP_TOOL_CALL_MAX_RETRIES: "${maxRetriesEnvCatch}" (during error handling). Using default: ${defaultEnvProxySettings.httpToolCallMaxRetries}.`);
        }
    }

    const delayBaseEnvCatch = process.env.HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS;
    if (delayBaseEnvCatch && delayBaseEnvCatch.trim() !== '') {
        const numVal = parseInt(delayBaseEnvCatch, 10);
        if (!isNaN(numVal)) {
            proxySettingsFromEnvOrDefaults.httpToolCallRetryDelayBaseMs = numVal;
        } else {
            console.warn(`Invalid value for HTTP_TOOL_CALL_RETRY_DELAY_BASE_MS: "${delayBaseEnvCatch}" (during error handling). Using default: ${defaultEnvProxySettings.httpToolCallRetryDelayBaseMs}.`);
        }
    }

    const stdioRetryEnvCatch = process.env.RETRY_STDIO_TOOL_CALL;
    if (stdioRetryEnvCatch && stdioRetryEnvCatch.trim() !== '') {
        proxySettingsFromEnvOrDefaults.retryStdioToolCall = stdioRetryEnvCatch.toLowerCase() === 'true';
    }

    const stdioMaxRetriesEnvCatch = process.env.STDIO_TOOL_CALL_MAX_RETRIES;
    if (stdioMaxRetriesEnvCatch && stdioMaxRetriesEnvCatch.trim() !== '') {
        const numVal = parseInt(stdioMaxRetriesEnvCatch, 10);
        if (!isNaN(numVal)) {
            proxySettingsFromEnvOrDefaults.stdioToolCallMaxRetries = numVal;
        } else {
            console.warn(`Invalid value for STDIO_TOOL_CALL_MAX_RETRIES: "${stdioMaxRetriesEnvCatch}" (during error handling). Using default: ${defaultEnvProxySettings.stdioToolCallMaxRetries}.`);
        }
    }

    const stdioDelayBaseEnvCatch = process.env.STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS;
    if (stdioDelayBaseEnvCatch && stdioDelayBaseEnvCatch.trim() !== '') {
        const numVal = parseInt(stdioDelayBaseEnvCatch, 10);
        if (!isNaN(numVal)) {
            proxySettingsFromEnvOrDefaults.stdioToolCallRetryDelayBaseMs = numVal;
        } else {
            console.warn(`Invalid value for STDIO_TOOL_CALL_RETRY_DELAY_BASE_MS: "${stdioDelayBaseEnvCatch}" (during error handling). Using default: ${defaultEnvProxySettings.stdioToolCallRetryDelayBaseMs}.`);
        }
    }

    console.log("Using proxy settings from environment/defaults due to mcp_server.json load error:", proxySettingsFromEnvOrDefaults);
    return {
      mcpServers: {},
      proxy: proxySettingsFromEnvOrDefaults,
    };
  }
};


export const loadToolConfig = async (): Promise<ToolConfig> => {
  const defaultConfig: ToolConfig = { tools: {} };
  try {
    const configPath = resolve(process.cwd(), 'config', 'tool_config.json');
    console.log(`Attempting to load tool configuration from: ${configPath}`);
    const fileContents = await readFile(configPath, 'utf-8');
    const parsedConfig = JSON.parse(fileContents) as ToolConfig;

    if (typeof parsedConfig !== 'object' || parsedConfig === null || typeof parsedConfig.tools !== 'object') {
        console.warn('Invalid tool_config.json format: "tools" object not found or invalid. Using default.');
        return defaultConfig;
    }
    for (const toolKey in parsedConfig.tools) {
        if (typeof parsedConfig.tools[toolKey]?.enabled !== 'boolean') {
             console.warn(`Invalid setting for tool "${toolKey}" in tool_config.json: 'enabled' is missing or not a boolean. Assuming enabled.`);
        }
    }

    console.log(`Successfully loaded tool configuration for ${Object.keys(parsedConfig.tools).length} tools.`);
    return parsedConfig;
  } catch (error: any) {
     if (error.code === 'ENOENT') {
        console.log('config/tool_config.json not found. Using default (all tools enabled).');
     } else {
        console.error(`Error loading config/tool_config.json:`, error);
        console.warn('Using default tool configuration (all tools enabled) due to error.');
     }
    return defaultConfig;
  }
};