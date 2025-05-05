import { readFile } from 'fs/promises';
import { resolve } from 'path';

export type TransportConfigStdio = {
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  active?: boolean;
  installDirectory?: string;
  installCommands?: string[];
}

export type TransportConfigSSE = {
  name?: string;
  url: string;
  active?: boolean;
  apiKey?: string;
  bearerToken?: string;
}

export type TransportConfig = (TransportConfigStdio | TransportConfigSSE) & { name?: string, active?: boolean };

export interface Config {
  mcpServers: Record<string, TransportConfig>;
}


export interface ToolSettings {
  enabled: boolean;
}

export interface ToolConfig {
  tools: Record<string, ToolSettings>;
}


export function isSSEConfig(config: TransportConfig): config is TransportConfigSSE {
  return (config as TransportConfigSSE).url !== undefined;
}

export function isStdioConfig(config: TransportConfig): config is TransportConfigStdio {
  return (config as TransportConfigStdio).command !== undefined;
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

    return parsedConfig;
  } catch (error) {
    console.error(`Error loading config/mcp_server.json:`, error);
    return { mcpServers: {} };
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