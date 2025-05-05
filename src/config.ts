import { readFile } from 'fs/promises';
import { resolve } from 'path';

export type TransportConfigStdio = {
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  active?: boolean;
}

export type TransportConfigSSE = {
  name?: string;
  url: string;
  active?: boolean;
}

export type TransportConfig = (TransportConfigStdio | TransportConfigSSE) & { name?: string, active?: boolean };

export interface Config {
  mcpServers: Record<string, TransportConfig>;
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