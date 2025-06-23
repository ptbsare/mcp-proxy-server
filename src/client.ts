import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport, SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport, StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { TransportConfig, isSSEConfig, isStdioConfig, isHttpConfig } from './config.js';
import { EventSource } from 'eventsource';
import { logger } from './logger.js'; // Import logger functions

const sleep = (time: number) => new Promise<void>(resolve => setTimeout(() => resolve(), time))
export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  name: string;
  config: TransportConfig; // Added config
  transportType: 'sse' | 'stdio' | 'http'; // Added transportType
}

const createClient = (name: string, transportConfig: TransportConfig): { client: Client | undefined, transport: Transport | undefined, transportType: 'sse' | 'stdio' | 'http' | undefined } => {

  let transport: Transport | null = null;
  let transportType: 'sse' | 'stdio' | 'http' | undefined = undefined;
  try {
    if (isSSEConfig(transportConfig)) {
      transportType = 'sse';
      const transportOptions: SSEClientTransportOptions = {};
      let customHeaders: Record<string, string> | undefined;

      if (transportConfig.bearerToken) {
        customHeaders = { 'Authorization': `Bearer ${transportConfig.bearerToken}` };
        logger.debug(`  Using Bearer Token for SSE connection to ${name}`); // Changed to debug
      } else if (transportConfig.apiKey) {
        customHeaders = { 'X-Api-Key': transportConfig.apiKey };
         logger.debug(`  Using X-Api-Key for SSE connection to ${name}`); // Changed to debug
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
       transportType = 'stdio';
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
       transportType = 'http';
       const transportOptions: StreamableHTTPClientTransportOptions = {};
       let customHeaders: Record<string, string> | undefined;

       if (transportConfig.bearerToken) {
         customHeaders = { 'Authorization': `Bearer ${transportConfig.bearerToken}` };
         logger.debug(`  Using Bearer Token for StreamableHTTP connection to ${name}`); // Changed to debug
       } else if (transportConfig.apiKey) {
         customHeaders = { 'X-Api-Key': transportConfig.apiKey };
          logger.debug(`  Using X-Api-Key for StreamableHTTP connection to ${name}`); // Changed to debug
       }

       if (customHeaders) {
         transportOptions.requestInit = { headers: customHeaders };
       }
       // Note: StreamableHTTPClientTransport handles session ID internally if configured.
       // We might pass transportConfig.sessionId if we want to force a specific one.
       transport = new StreamableHTTPClientTransport(new URL(transportConfig.url), transportOptions);
     } else {
       logger.error(`Invalid or unknown transport type in configuration for server: ${name}`); // Changed to error
     }
   } catch (error) {
     let transportType = 'unknown';
     if (isSSEConfig(transportConfig)) transportType = 'sse';
     else if (isStdioConfig(transportConfig)) transportType = 'stdio';
     else if (isHttpConfig(transportConfig)) transportType = 'http';
     logger.error(`Failed to create transport ${transportType} to ${name}:`, error); // Changed to error
   }

   if (!transport || !transportType) { // Also check transportType
     logger.warn(`Transport or transportType for ${name} not available.`); // Changed to warn
     return { transport: undefined, client: undefined, transportType: undefined };
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

   return { client, transport, transportType }
}

export const createClients = async (mcpServers: Record<string, TransportConfig>): Promise<ConnectedClient[]> => {
  const clients: ConnectedClient[] = [];

  for (const [name, transportConfig] of Object.entries(mcpServers)) {
    logger.log(`Connecting to server: ${name}`); // Changed to log

    const waitFor = 2500;
    const retries = 3;
    let count = 0
    let retry = true

    while (retry) {

      const { client, transport, transportType } = createClient(name, transportConfig); // Capture transportType
      if (!client || !transport || !transportType) { // Check transportType
        logger.warn(`Skipping client ${name} due to failed client/transport creation.`); // Changed to warn
        break;
      }

      try {
        await client.connect(transport);
        logger.log(`Connected to server: ${name}`); // Changed to log

        clients.push({
          client,
          name: name,
          config: transportConfig, // Store config
          transportType: transportType, // Store transportType
          cleanup: async () => {
            await transport.close();
          }
        });

        break

      } catch (error: any) {
        logger.error(`Failed to connect to ${name}: ${error.message}`); // Log error message
        count++;
        retry = (count < retries);
        if (retry) {
          try {
            await client.close();
          } catch { }
          logger.log(`Retry connection to ${name} in ${waitFor}ms (${count}/${retries})`); // Changed to log
          await sleep(waitFor);
        }
      }

    }

  }

  return clients;
};

// No longer using ReconnectedClientResult, returning full ConnectedClient-like structure
// but as a direct object, which refreshBackendConnection will use to create a full ConnectedClient.

export async function reconnectSingleClient(
  name: string,
  transportConfig: TransportConfig,
  existingCleanup?: () => Promise<void>
): Promise<Omit<ConnectedClient, 'name'>> { // Returns the parts needed to reconstruct a ConnectedClient
  logger.log(`Attempting to reconnect client: ${name}`); // Changed to log

  if (existingCleanup) {
    try {
      await existingCleanup();
      logger.log(`Existing client ${name} cleaned up before reconnecting.`); // Changed to log
    } catch (e: any) {
      logger.warn(`Error during cleanup of existing client ${name} before reconnect: ${e.message}`); // Changed to warn
    }
  }

  let transport: Transport | null = null;
  let determinedTransportType: 'sse' | 'stdio' | 'http' | undefined = undefined;

  try {
    if (isSSEConfig(transportConfig)) {
      determinedTransportType = 'sse';
      const transportOptions: SSEClientTransportOptions = {};
      let customHeaders: Record<string, string> | undefined;
      if (transportConfig.bearerToken) {
        customHeaders = { 'Authorization': `Bearer ${transportConfig.bearerToken}` };
        logger.debug(`  Using Bearer Token for SSE connection to ${name} (reconnect)`); // Changed to debug
      } else if (transportConfig.apiKey) {
        customHeaders = { 'X-Api-Key': transportConfig.apiKey };
        logger.debug(`  Using X-Api-Key for SSE connection to ${name} (reconnect)`); // Changed to debug
      }
      if (customHeaders) {
        transportOptions.requestInit = { headers: customHeaders };
        const headersToAdd = customHeaders; // Closure for fetch
        transportOptions.eventSourceInit = {
            fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
                const originalHeaders = new Headers(init?.headers || {});
                for (const key in headersToAdd) {
                     originalHeaders.set(key, headersToAdd[key]);
                 }
                 return fetch(input, { ...init, headers: originalHeaders });
             },
        } as any;
      }
      transport = new SSEClientTransport(new URL(transportConfig.url), transportOptions);
    } else if (isStdioConfig(transportConfig)) {
      determinedTransportType = 'stdio';
      const mergedEnv = { ...process.env, ...transportConfig.env };
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
      logger.debug(`  Configured Stdio transport for ${name} (reconnect)`); // Changed to debug
    } else if (isHttpConfig(transportConfig)) {
      determinedTransportType = 'http';
      const transportOptions: StreamableHTTPClientTransportOptions = {};
      let customHeaders: Record<string, string> | undefined;
      if (transportConfig.bearerToken) {
        customHeaders = { 'Authorization': `Bearer ${transportConfig.bearerToken}` };
        logger.debug(`  Using Bearer Token for StreamableHTTP connection to ${name} (reconnect)`); // Changed to debug
      } else if (transportConfig.apiKey) {
        customHeaders = { 'X-Api-Key': transportConfig.apiKey };
        logger.debug(`  Using X-Api-Key for StreamableHTTP connection to ${name} (reconnect)`); // Changed to debug
      }
      if (customHeaders) {
        transportOptions.requestInit = { headers: customHeaders };
      }
      transport = new StreamableHTTPClientTransport(new URL(transportConfig.url), transportOptions);
    } else {
      throw new Error(`Invalid or unknown transport type in configuration for server: ${name}`);
    }
  } catch (error: any) {
    logger.error(`Failed to create transport for ${name} during reconnect: ${error.message}`); // Changed to error
    throw error;
  }

  if (!transport || !determinedTransportType) { // Check determinedTransportType as well
    throw new Error(`Transport or transport type for ${name} could not be created during reconnect.`);
  }

  const newSdkClient = new Client({
    name: 'mcp-proxy-client-reconnect',
    version: '1.0.1',
  }, {
    capabilities: { prompts: {}, resources: { subscribe: true }, tools: {} }
  });

  try {
    await newSdkClient.connect(transport);
    logger.log(`Successfully reconnected to server: ${name}`); // Changed to log
    const finalTransport = transport; // Capture for closure
    return {
      client: newSdkClient,
      config: transportConfig, // Return config
      transportType: determinedTransportType, // Return transportType
      cleanup: async () => {
        if (finalTransport) {
            await finalTransport.close();
        }
      }
    };
  } catch (error: any) {
    logger.error(`Failed to connect to ${name} during reconnect attempt: ${error.message}`); // Changed to error
    try {
      if (transport) {
          await transport.close();
      }
    } catch (closeError: any) {
      logger.warn(`Failed to close transport for ${name} after reconnect failure: ${closeError.message}`); // Changed to warn
    }
    throw error;
  }
}
