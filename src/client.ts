import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport, SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport, StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { TransportConfig, isSSEConfig, isStdioConfig, isHttpConfig } from './config.js';
import { EventSource } from 'eventsource';

const sleep = (time: number) => new Promise<void>(resolve => setTimeout(() => resolve(), time))
export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  name: string;
}

const createClient = (name: string, transportConfig: TransportConfig): { client: Client | undefined, transport: Transport | undefined } => {

  let transport: Transport | null = null;
  try {
    if (isSSEConfig(transportConfig)) {
      const transportOptions: SSEClientTransportOptions = {};
      let customHeaders: Record<string, string> | undefined;

      if (transportConfig.bearerToken) {
        customHeaders = { 'Authorization': `Bearer ${transportConfig.bearerToken}` };
        console.log(`  Using Bearer Token for SSE connection to ${name}`);
      } else if (transportConfig.apiKey) {
        customHeaders = { 'X-Api-Key': transportConfig.apiKey };
         console.log(`  Using X-Api-Key for SSE connection to ${name}`);
      }

      if (customHeaders) {
          // Apply custom headers to requestInit for POST requests
          transportOptions.requestInit = {
              headers: customHeaders,
          };

          // Apply custom headers to eventSourceInit.fetch for GET requests
          const headersToAdd = customHeaders;
          transportOptions.eventSourceInit = {
              fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
                  const originalHeaders = new Headers(init?.headers || {});
                  for (const key in headersToAdd) {
                       originalHeaders.set(key, headersToAdd[key]);
                   }
                   return fetch(input, {
                       ...init,
                       headers: originalHeaders,
                   });
               },
          } as any;
       }

       transport = new SSEClientTransport(new URL(transportConfig.url), transportOptions);
    } else if (isStdioConfig(transportConfig)) {
      const mergedEnv = {
        ...process.env,
        ...transportConfig.env
      };
      const filteredEnv: Record<string, string> = {};
      for (const key in mergedEnv) {
        if (Object.prototype.hasOwnProperty.call(mergedEnv, key) && mergedEnv[key] !== undefined) {
          filteredEnv[key] = mergedEnv[key] as string;
        }
      }
      transport = new StdioClientTransport({
        command: transportConfig.command,
        args: transportConfig.args,
        env: filteredEnv
      });
    } else if (isHttpConfig(transportConfig)) {
      const transportOptions: StreamableHTTPClientTransportOptions = {};
      let customHeaders: Record<string, string> | undefined;

      if (transportConfig.bearerToken) {
        customHeaders = { 'Authorization': `Bearer ${transportConfig.bearerToken}` };
        console.log(`  Using Bearer Token for StreamableHTTP connection to ${name}`);
      } else if (transportConfig.apiKey) {
        customHeaders = { 'X-Api-Key': transportConfig.apiKey };
         console.log(`  Using X-Api-Key for StreamableHTTP connection to ${name}`);
      }

      if (customHeaders) {
        transportOptions.requestInit = { headers: customHeaders };
      }
      // Note: StreamableHTTPClientTransport handles session ID internally if configured.
      // We might pass transportConfig.sessionId if we want to force a specific one.
      transport = new StreamableHTTPClientTransport(new URL(transportConfig.url), transportOptions);
    } else {
      console.error(`Invalid or unknown transport type in configuration for server: ${name}`);
    }
  } catch (error) {
    let transportType = 'unknown';
    if (isSSEConfig(transportConfig)) transportType = 'sse';
    else if (isStdioConfig(transportConfig)) transportType = 'stdio';
    else if (isHttpConfig(transportConfig)) transportType = 'http';
    console.error(`Failed to create transport ${transportType} to ${name}:`, error);
  }

  if (!transport) {
    console.warn(`Transport for ${name} not available.`);
    return { transport: undefined, client: undefined };
  }

  const client = new Client({
    name: 'mcp-proxy-client',
    version: '1.0.0',
  }, {
    capabilities: {
      prompts: {},
      resources: { subscribe: true },
      tools: {}
    }
  });

  return { client, transport }
}

export const createClients = async (mcpServers: Record<string, TransportConfig>): Promise<ConnectedClient[]> => {
  const clients: ConnectedClient[] = [];

  for (const [name, transportConfig] of Object.entries(mcpServers)) {
    console.log(`Connecting to server: ${name}`);

    const waitFor = 2500;
    const retries = 3;
    let count = 0
    let retry = true

    while (retry) {

      const { client, transport } = createClient(name, transportConfig);
      if (!client || !transport) {
        break;
      }

      try {
        await client.connect(transport);
        console.log(`Connected to server: ${name}`);

        clients.push({
          client,
          name: name,
          cleanup: async () => {
            await transport.close();
          }
        });

        break

      } catch (error) {
        console.error(`Failed to connect to ${name}:`, error);
        count++;
        retry = (count < retries);
        if (retry) {
          try {
            await client.close();
          } catch { }
          console.log(`Retry connection to ${name} in ${waitFor}ms (${count}/${retries})`);
          await sleep(waitFor);
        }
      }

    }

  }

  return clients;
};
