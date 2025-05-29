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
  try {
    const configPath = resolve(process.cwd(), 'config', 'mcp_server.json');
    console.log(`Attempting to load configuration from: ${configPath}`);
    const fileContents = await readFile(configPath, 'utf-8');
    const parsedConfig = JSON.parse(fileContents) as Config;

    if (typeof parsedConfig !== 'object' || parsedConfig === null || typeof parsedConfig.mcpServers !== 'object') {
        throw new Error('Invalid config format: mcpServers object not found.');
    }

    // Initialize proxy settings with defaults
    const defaultProxySettings: Required<ProxySettings> = {
        retrySseToolCallOnDisconnect: true,
        retryHttpToolCall: true,
        httpToolCallMaxRetries: 2,
        httpToolCallRetryDelayBaseMs: 300,
    };

    const configWithDefaults: Config = {
      ...parsedConfig,
      proxy: {
        ...defaultProxySettings,
        ...(parsedConfig.proxy || {}), // Spread any existing proxy settings to override defaults
      }
    };

    // Ensure specific boolean and number types if they exist in parsedConfig.proxy
    if (parsedConfig.proxy) {
        if (typeof parsedConfig.proxy.retrySseToolCallOnDisconnect === 'boolean') {
            configWithDefaults.proxy!.retrySseToolCallOnDisconnect = parsedConfig.proxy.retrySseToolCallOnDisconnect;
        }
        if (typeof parsedConfig.proxy.retryHttpToolCall === 'boolean') {
            configWithDefaults.proxy!.retryHttpToolCall = parsedConfig.proxy.retryHttpToolCall;
        }
        if (typeof parsedConfig.proxy.httpToolCallMaxRetries === 'number') {
            configWithDefaults.proxy!.httpToolCallMaxRetries = parsedConfig.proxy.httpToolCallMaxRetries;
        }
        if (typeof parsedConfig.proxy.httpToolCallRetryDelayBaseMs === 'number') {
            configWithDefaults.proxy!.httpToolCallRetryDelayBaseMs = parsedConfig.proxy.httpToolCallRetryDelayBaseMs;
        }
    }

    console.log("Loaded config with proxy settings:", configWithDefaults.proxy);
    return configWithDefaults;
  } catch (error) {
    console.error(`Error loading config/mcp_server.json:`, error);
    // Return default structure in case of error
    return {
      mcpServers: {},
      proxy: { // Ensure all defaults are present here too
        retrySseToolCallOnDisconnect: true,
        retryHttpToolCall: true,
        httpToolCallMaxRetries: 2,
        httpToolCallRetryDelayBaseMs: 300,
      }
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