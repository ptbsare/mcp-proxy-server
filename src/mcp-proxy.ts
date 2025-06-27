import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "@modelcontextprotocol/sdk/shared/protocol.js"; // Import the constant
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  ListToolsResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ResourceTemplate,
  CompatibilityCallToolResultSchema,
  GetPromptResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import { createClients, ConnectedClient, reconnectSingleClient } from './client.js';
import { logger } from './logger.js';
import { Config, loadConfig, TransportConfig, isSSEConfig, isStdioConfig, isHttpConfig, ToolConfig, loadToolConfig, DEFAULT_SERVER_TOOLNAME_SEPERATOR } from './config.js';
import { z } from 'zod';
import * as eventsource from 'eventsource';

global.EventSource = eventsource.EventSource;

// --- Shared State ---
// Keep track of connected clients and the maps globally within this module
let currentConnectedClients: ConnectedClient[] = [];
const toolToClientMap = new Map<string, { client: ConnectedClient, toolInfo: Tool }>(); // Store full tool info
const resourceToClientMap = new Map<string, ConnectedClient>();
const promptToClientMap = new Map<string, ConnectedClient>();
let currentToolConfig: ToolConfig = { tools: {} }; // Store loaded tool config
let currentActiveServersConfig: Record<string, TransportConfig> = {}; // Added for retry logic
let currentSeparator: string = DEFAULT_SERVER_TOOLNAME_SEPERATOR; // Store the current separator

// Define Global Default Proxy Settings
const defaultProxySettingsFull: Required<NonNullable<Config['proxy']>> = {
    retrySseToolCall: true, // Renamed from retrySseToolCallOnDisconnect
    sseToolCallMaxRetries: 2,
    sseToolCallRetryDelayBaseMs: 300,
    retryHttpToolCall: true,
    httpToolCallMaxRetries: 2,
    httpToolCallRetryDelayBaseMs: 300,
    retryStdioToolCall: true,
    stdioToolCallMaxRetries: 2,
    stdioToolCallRetryDelayBaseMs: 300,
};

let currentProxyConfig: Required<NonNullable<Config['proxy']>> = { ...defaultProxySettingsFull }; // Initialize with full defaults

// --- Function to update backend connections and maps ---
export const updateBackendConnections = async (newServerConfig: Config, newToolConfig: ToolConfig) => {
    logger.log("Starting update of backend connections...");
    currentToolConfig = newToolConfig; // Update stored tool config
    currentProxyConfig = { // Update currentProxyConfig using full defaults
        ...defaultProxySettingsFull,
        ...(newServerConfig.proxy || {}),
    };
    // Update the current separator from the new config
    currentSeparator = newServerConfig.serverToolnameSeparator || DEFAULT_SERVER_TOOLNAME_SEPERATOR;
    logger.log(`Using server toolname separator: "${currentSeparator}"`);

    const activeServersConfigLocal: Record<string, TransportConfig> = {}; // Renamed to avoid conflict with module-level
    for (const serverKey in newServerConfig.mcpServers) {
        if (Object.prototype.hasOwnProperty.call(newServerConfig.mcpServers, serverKey)) {
            const serverConf = newServerConfig.mcpServers[serverKey];
            const isActive = !(serverConf.active === false || String(serverConf.active).toLowerCase() === 'false');
            if (isActive) {
                activeServersConfigLocal[serverKey] = serverConf;
            } else {
                 const serverName = serverKey;
                 logger.log(`Skipping inactive server during update: ${serverName}`);
            }
        }
    }
    currentActiveServersConfig = activeServersConfigLocal; // Update module-level variable

    const newClientKeys = new Set(Object.keys(activeServersConfigLocal));
    const currentClientKeys = new Set(currentConnectedClients.map(c => c.name));

    const clientsToRemove = currentConnectedClients.filter(c => !newClientKeys.has(c.name));
    const clientsToKeep = currentConnectedClients.filter(c => newClientKeys.has(c.name));
    const keysToAdd = Object.keys(activeServersConfigLocal).filter(key => !currentClientKeys.has(key));

    logger.log(`Clients to remove: ${clientsToRemove.map(c => c.name).join(', ') || 'None'}`);
    logger.log(`Clients to keep: ${clientsToKeep.map(c => c.name).join(', ') || 'None'}`);
    logger.log(`Server keys to add: ${keysToAdd.join(', ') || 'None'}`);

    // 1. Cleanup removed clients
    if (clientsToRemove.length > 0) {
        logger.log(`Cleaning up ${clientsToRemove.length} removed clients...`);
        await Promise.all(clientsToRemove.map(async ({ name, cleanup }) => {
            try {
                await cleanup();
                logger.log(`  Cleaned up client: ${name}`);
            } catch (error: any) {
                logger.error(`  Error cleaning up client ${name}: ${error.message}`);
            }
        }));
    }

    // 2. Connect new clients
    let newlyConnectedClients: ConnectedClient[] = [];
    if (keysToAdd.length > 0) {
        const configToAdd: Record<string, TransportConfig> = {};
        keysToAdd.forEach(key => { configToAdd[key] = activeServersConfigLocal[key]; });
        logger.log(`Connecting ${keysToAdd.length} new clients...`);
        newlyConnectedClients = await createClients(configToAdd);
        logger.log(`Successfully connected to ${newlyConnectedClients.length} out of ${keysToAdd.length} new clients.`);
    }

    // 3. Update the main list
    currentConnectedClients = [...clientsToKeep, ...newlyConnectedClients];
    logger.log(`Total active clients after update: ${currentConnectedClients.length}`);

    // 4. Clear and repopulate maps immediately (important for consistency)
    logger.log("Clearing and repopulating internal maps (tools, resources, prompts)...");
    toolToClientMap.clear();
    resourceToClientMap.clear();
    promptToClientMap.clear();

    // Repopulate Tools Map
    for (const connectedClient of currentConnectedClients) {
        try {
            const result = await connectedClient.client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
            if (result.tools && result.tools.length > 0) {
                for (const tool of result.tools) {
                    const qualifiedName = `${connectedClient.name}${currentSeparator}${tool.name}`; // Use the current separator
                    const toolSettings = currentToolConfig.tools[qualifiedName];
                    const isEnabled = !toolSettings || toolSettings.enabled !== false;
                    if (isEnabled) {
                        // Store the client and the full tool info from the backend
                        toolToClientMap.set(qualifiedName, { client: connectedClient, toolInfo: tool });
                    }
                }
            }
        } catch (error: any) {
             if (!(error?.name === 'McpError' && error?.code === -32601)) { // Ignore 'Method not found'
                 logger.error(`Error fetching tools from ${connectedClient.name} during map update:`, error?.message || error);
             }
        }
    }
    logger.log(`  Updated tool map with ${toolToClientMap.size} enabled tools.`);

    // Repopulate Resources Map
    for (const connectedClient of currentConnectedClients) {
         try {
             const result = await connectedClient.client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
             if (result.resources) {
                 result.resources.forEach(resource => resourceToClientMap.set(resource.uri, connectedClient));
             }
         } catch (error: any) {
              if (!(error?.name === 'McpError' && error?.code === -32601)) { // Ignore 'Method not found'
                  logger.error(`Error fetching resources from ${connectedClient.name} during map update:`, error?.message || error);
              }
         }
    }
     logger.log(`  Updated resource map with ${resourceToClientMap.size} resources.`);

    // Repopulate Prompts Map
    for (const connectedClient of currentConnectedClients) {
         try {
             const result = await connectedClient.client.request({ method: 'prompts/list', params: {} }, ListPromptsResultSchema);
             if (result.prompts) {
                 result.prompts.forEach(prompt => promptToClientMap.set(prompt.name, connectedClient));
             }
         } catch (error: any) {
              if (!(error?.name === 'McpError' && error?.code === -32601)) { // Ignore 'Method not found'
                  logger.error(`Error fetching prompts from ${connectedClient.name} during map update:`, error?.message || error);
              }
         }
    }
    logger.log(`  Updated prompt map with ${promptToClientMap.size} prompts.`);
    logger.log("Backend connections update finished.");
};

async function refreshBackendConnection(serverKey: string, serverConfig: TransportConfig): Promise<boolean> {
  logger.log(`Attempting to refresh backend connection for server: ${serverKey}`);
  const existingClientIndex = currentConnectedClients.findIndex(c => c.name === serverKey);
  let oldCleanup: (() => Promise<void>) | undefined = undefined;
  let existingConfig: TransportConfig | undefined = currentConnectedClients[existingClientIndex]?.config;

  if (existingClientIndex !== -1 && currentConnectedClients[existingClientIndex]) {
    oldCleanup = currentConnectedClients[existingClientIndex].cleanup;
    existingConfig = currentConnectedClients[existingClientIndex].config;
  } else {
    // Fallback to currentActiveServersConfig if not found in currentConnectedClients (should be rare for refresh)
    existingConfig = currentActiveServersConfig[serverKey];
  }

  if (!existingConfig) {
    logger.error(`Configuration for server ${serverKey} not found. Cannot refresh.`);
    return false;
  }
  // Use the passed serverConfig if available (e.g. from initial load), otherwise fallback to existingConfig.
  // The `serverConfig` parameter in refreshBackendConnection might be more up-to-date if called during a config reload.
  const configToUse = serverConfig || existingConfig;


  try {
    // reconnectSingleClient returns Omit<ConnectedClient, 'name'>
    const reconnectedClientParts = await reconnectSingleClient(serverKey, configToUse, oldCleanup);

    const newConnectedClientEntry: ConnectedClient = {
      ...reconnectedClientParts, // Spread the parts (client, cleanup, config, transportType)
      name: serverKey, // Add the name back
    };

    if (existingClientIndex !== -1) {
      currentConnectedClients[existingClientIndex] = newConnectedClientEntry;
      logger.log(`Updated existing client entry for ${serverKey} in currentConnectedClients.`);
    } else {
      currentConnectedClients.push(newConnectedClientEntry);
      logger.log(`Added new client entry for ${serverKey} to currentConnectedClients (this path might be taken if client was previously removed due to error).`);
    }

    // Clear existing entries for this client
    for (const [key, value] of toolToClientMap.entries()) {
      if (value.client.name === serverKey) {
        toolToClientMap.delete(key);
      }
    }
    for (const [key, value] of resourceToClientMap.entries()) {
      // Assuming value is ConnectedClient, so value.name is the server key
      if (value.name === serverKey) {
        resourceToClientMap.delete(key);
      }
    }
    for (const [key, value] of promptToClientMap.entries()) {
      // Assuming value is ConnectedClient, so value.name is the server key
      if (value.name === serverKey) {
        promptToClientMap.delete(key);
      }
    }
    logger.log(`Cleared map entries for ${serverKey}.`);

    // Repopulate maps for the reconnected client
    const connectedClient = newConnectedClientEntry;
    try {
        const result = await connectedClient.client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
        if (result.tools && result.tools.length > 0) {
            for (const tool of result.tools) {
                const qualifiedName = `${connectedClient.name}${currentSeparator}${tool.name}`; // Use the current separator
                const toolSettings = currentToolConfig.tools[qualifiedName];
                const isEnabled = !toolSettings || toolSettings.enabled !== false;
                if (isEnabled) {
                    toolToClientMap.set(qualifiedName, { client: connectedClient, toolInfo: tool });
                }
            }
        }
    } catch (error: any) {
         if (!(error?.name === 'McpError' && error?.code === -32601)) {
             logger.error(`Error fetching tools from ${connectedClient.name} during refresh:`, error?.message || error);
         }
    }

    try {
         const result = await connectedClient.client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
         if (result.resources) {
             result.resources.forEach(resource => resourceToClientMap.set(resource.uri, connectedClient));
         }
     } catch (error: any) {
          if (!(error?.name === 'McpError' && error?.code === -32601)) {
              logger.error(`Error fetching resources from ${connectedClient.name} during refresh:`, error?.message || error);
          }
     }

    try {
         const result = await connectedClient.client.request({ method: 'prompts/list', params: {} }, ListPromptsResultSchema);
         if (result.prompts) {
             result.prompts.forEach(prompt => promptToClientMap.set(prompt.name, connectedClient));
         }
     } catch (error: any) {
          if (!(error?.name === 'McpError' && error?.code === -32601)) {
              logger.error(`Error fetching prompts from ${connectedClient.name} during refresh:`, error?.message || error);
          }
     }
    logger.log(`Repopulated maps for ${serverKey}.`);
    return true;

  } catch (error: any) {
    logger.error(`Failed to refresh backend connection for ${serverKey}: ${error.message}`);
    // If refresh failed, we remove the client to prevent further attempts with a known bad state.
    // This also cleans up its entries from the maps.
    if (existingClientIndex !== -1) {
        currentConnectedClients.splice(existingClientIndex, 1);
    }
    // Clear any potentially lingering map entries if refresh failed mid-way
    for (const [key, value] of toolToClientMap.entries()) {
      if (value.client.name === serverKey) toolToClientMap.delete(key);
    }
    for (const [key, value] of resourceToClientMap.entries()) {
      if (value.name === serverKey) resourceToClientMap.delete(key);
    }
    for (const [key, value] of promptToClientMap.entries()) {
      if (value.name === serverKey) promptToClientMap.delete(key);
    }
    logger.log(`Removed client ${serverKey} and its map entries after failed refresh.`);
    return false;
  }
}

// --- Function to get current proxy state ---
export const getCurrentProxyState = () => {
    // Return copies or relevant info to avoid direct mutation
    const tools = Array.from(toolToClientMap.entries()).map(([qualifiedName, { client: connectedClient, toolInfo }]) => {
        // Return structure expected by the frontend (tools.js)
        return {
            // Frontend expects original tool name here
            name: toolInfo.name,
            // Frontend expects snake_case server name here
            serverName: connectedClient?.name || 'Unknown',
            // Frontend expects original description here
            description: toolInfo.description
            // qualifiedName is not directly used by the frontend display logic,
            // but could be added if needed: qualified_name: qualifiedName
        };
    });
    // Could add resources and prompts here if needed by admin UI later
    // Also return the current separator for the frontend
    return { tools, serverToolnameSeparator: currentSeparator };
};

// Helper function to identify connection errors
const isConnectionError = (err: any): boolean => {
  if (err && err.message) {
    const lowerMessage = err.message.toLowerCase();
    return lowerMessage.includes("disconnected") ||
           lowerMessage.includes("not connected") ||
           lowerMessage.includes("connection closed") ||
           lowerMessage.includes("transport is closed") || // SDK specific
           lowerMessage.includes("failed to fetch") || 
           lowerMessage.includes("not found") || //404
           lowerMessage.includes("eof") || // Network level
           lowerMessage.includes("tls") || // TLS handshake
           lowerMessage.includes("timeout") ||
           lowerMessage.includes("timed out"); 
  }
  return false;
};

// --- Server Creation ---
export const createServer = async () => {
  // Load initial config
  const initialServerConfig = await loadConfig(); // This now includes proxy settings
  const initialToolConfig = await loadToolConfig();

  // Initialize currentActiveServersConfig AND currentProxyConfig from the initial load
  const initialActiveServers: Record<string, TransportConfig> = {};
    for (const serverKey in initialServerConfig.mcpServers) {
        if (Object.prototype.hasOwnProperty.call(initialServerConfig.mcpServers, serverKey)) {
            const serverConf = initialServerConfig.mcpServers[serverKey];
            const isActive = !(serverConf.active === false || String(serverConf.active).toLowerCase() === 'false');
            if (isActive) {
                initialActiveServers[serverKey] = serverConf;
            }
        }
    }
  currentActiveServersConfig = initialActiveServers;
  // Update currentProxyConfig using initialServerConfig and global defaults
  currentProxyConfig = {
      ...defaultProxySettingsFull,
      ...(initialServerConfig.proxy || {}),
  };


  // Perform initial connection and map population
  await updateBackendConnections(initialServerConfig, initialToolConfig);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)); // Define sleep

  // Create the main proxy server instance
  const server = new Server(
    {
      name: "mcp_proxy_server",
      version: "1.0.0", // Consider updating version dynamically
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
      },
    },
  );

  // --- Request Handlers ---
  // These handlers now rely on the maps populated by updateBackendConnections
  // Note: InitializeRequest is handled by the SDK's Server default behavior.

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    logger.log("Received tools/list request - applying overrides from config");
    const enabledTools: Tool[] = [];
    // Access the globally stored tool config which includes overrides
    const toolOverrides = currentToolConfig.tools || {};

    for (const [originalQualifiedName, { client: connectedClient, toolInfo }] of toolToClientMap.entries()) {
        const overrideSettings = toolOverrides[originalQualifiedName];

        // Determine the final name and description to expose
        // Use override if present, otherwise use original value
        const exposedName = overrideSettings?.exposedName || originalQualifiedName;
        const exposedDescription = overrideSettings?.exposedDescription || toolInfo.description;

        // Construct the Tool object for the response
        enabledTools.push({
            name: exposedName, // Use the final exposed name
            description: exposedDescription, // Use the final exposed description
            inputSchema: toolInfo.inputSchema, // Schema is never overridden
        });
    }
    logger.log(`Returning ${enabledTools.length} enabled tools with applied overrides.`);
    return { tools: enabledTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: requestedExposedName, arguments: args } = request.params;
    let originalQualifiedName: string | undefined;
    let mapEntry: { client: ConnectedClient, toolInfo: Tool } | undefined;

    // Need to find the original tool based on the potentially overridden exposed name
    const toolOverrides = currentToolConfig.tools || {};

    // Iterate through the live tool map to find which original tool corresponds
    // to the requested exposed name.
    for (const [key, { client, toolInfo: currentToolInfo }] of toolToClientMap.entries()) { // Renamed toolInfo to currentToolInfo to avoid conflict
        const overrideSettings = toolOverrides[key];
        const currentExposedName = overrideSettings?.exposedName || key; // Calculate the exposed name for this tool

        if (currentExposedName === requestedExposedName) {
            originalQualifiedName = key; // Found the original key
            mapEntry = { client, toolInfo: currentToolInfo }; // Get the corresponding entry
            break;
        }
    }

    // If no entry was found after checking all enabled tools and their potential overrides
    if (!mapEntry || !originalQualifiedName) {
        logger.error(`Attempted to call tool with exposed name "${requestedExposedName}", but no corresponding enabled tool or override configuration found.`);
        throw new Error(`Unknown or disabled tool: ${requestedExposedName}`);
    }

    // Now we have the correct mapEntry and the originalQualifiedName
    let { client: clientForTool, toolInfo } = mapEntry; // toolInfo here is the correct one from the found mapEntry
    const originalToolNameForBackend = toolInfo.name; // The actual name the backend server expects (from the original toolInfo)

    // --- Retry Logic ---
    // Use HTTP retry settings for SSE as a fallback for retry count and delay
    const maxRetries = clientForTool.transportType === 'sse' ? (currentProxyConfig.retrySseToolCall ? currentProxyConfig.sseToolCallMaxRetries : 0) : // Use SSE specific max retries, check retrySseToolCall
                       clientForTool.transportType === 'stdio' ? (currentProxyConfig.retryStdioToolCall ? currentProxyConfig.stdioToolCallMaxRetries : 0) :
                       clientForTool.transportType === 'http' ? (currentProxyConfig.retryHttpToolCall ? currentProxyConfig.httpToolCallMaxRetries : 0) : 0;
    const retryDelayBaseMs = clientForTool.transportType === 'sse' ? currentProxyConfig.sseToolCallRetryDelayBaseMs : // Use SSE specific retry delay
                             clientForTool.transportType === 'stdio' ? (currentProxyConfig.retryStdioToolCall ? currentProxyConfig.stdioToolCallRetryDelayBaseMs : 0) : // Added check for stdio retry enabled
                             clientForTool.transportType === 'http' ? (currentProxyConfig.retryHttpToolCall ? currentProxyConfig.httpToolCallRetryDelayBaseMs : 0) : 0; // Added check for http retry enabled

    let lastError: any = null;

    // Loop includes the initial attempt (attempt 0) plus maxRetries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const delay = retryDelayBaseMs * Math.pow(2, attempt - 1) + (Math.random() * retryDelayBaseMs * 0.5);
            logger.log(`Tool call failed for '${requestedExposedName}'. Attempt ${attempt}/${maxRetries}. Retrying in ${delay.toFixed(0)}ms...`);
            await sleep(delay);

            // For SSE, attempt reconnect before retrying the call if the last error was a connection error
            if (clientForTool.transportType === 'sse' && isConnectionError(lastError)) {
                 logger.log(`SSE connection error for tool '${requestedExposedName}' on server '${clientForTool.name}'. Attempting reconnect before retry.`);
                 const clientTransportConfig = currentActiveServersConfig[clientForTool.name];
                 if (!clientTransportConfig) {
                   logger.error(`Cannot retry SSE: TransportConfig for server '${clientForTool.name}' not found.`);
                   // If config is missing, we can't reconnect, so break retry loop
                   break;
                 }
                 const refreshed = await refreshBackendConnection(clientForTool.name, clientTransportConfig);
                 if (refreshed) {
                   logger.log(`Successfully reconnected to server '${clientForTool.name}' via SSE.`);
                   // Update clientForTool and toolInfo references after refresh
                   const newMapEntry = toolToClientMap.get(originalQualifiedName);
                   if (!newMapEntry) {
                     logger.error(`Tool '${originalQualifiedName}' not found in map after successful SSE refresh for server '${clientForTool.name}'.`);
                     // If tool disappears after refresh, something is wrong, break retry loop
                     break;
                   }
                   clientForTool = newMapEntry.client;
                   toolInfo = newMapEntry.toolInfo;
                 } else {
                   logger.error(`SSE Reconnection to server '${clientForTool.name}' failed.`);
                   // If reconnect fails, break retry loop
                   break;
                 }
            }
        }

        try {
            logger.log(`Forwarding tool call for exposed name '${requestedExposedName}' (original qualified name: '${originalQualifiedName}'). Forwarding to server '${clientForTool.name}' as tool '${originalToolNameForBackend}' (Attempt ${attempt + 1})`);
            // Explicitly set a timeout for the request using SDK's RequestOptions
            const backendResponse = await clientForTool.client.request(
                {
                    method: 'tools/call',
                    params: { name: originalToolNameForBackend, arguments: args || {}, _meta: { progressToken: request.params._meta?.progressToken } }
                },
                CompatibilityCallToolResultSchema,
                { timeout: DEFAULT_REQUEST_TIMEOUT_MSEC } // Set timeout explicitly
            );
            logger.log(`[Tool Call] Backend response received for '${requestedExposedName}'. Passing to SDK Server.`);
            return backendResponse; // Success! Return the response.
        } catch (error: any) {
            lastError = error;
            logger.warn(`Attempt ${attempt + 1} to call tool '${requestedExposedName}' failed: ${error.message}`);

            // Check if this error warrants a retry based on type and configuration
            const isRetryableError = isConnectionError(error) || (error?.name === 'McpError' && error?.code === -32001); // Consider timeout as retryable
            const shouldRetry = (clientForTool.transportType === 'sse' && currentProxyConfig.retrySseToolCall && isRetryableError) || // Check retrySseToolCall
                                (clientForTool.transportType === 'stdio' && currentProxyConfig.retryStdioToolCall && isRetryableError) ||
                                (clientForTool.transportType === 'http' && currentProxyConfig.retryHttpToolCall && isRetryableError);


            if (!shouldRetry && attempt === 0) {
                 // If it's the first attempt and not a retryable error type, re-throw immediately
                 logger.error(`Tool call for '${requestedExposedName}' failed with non-retryable error on first attempt: ${error.message}`, error);
                 throw error;
            }

             if (!shouldRetry && attempt > 0) {
                 // If it's a subsequent attempt and the error is no longer retryable (e.g., backend returned a specific error after reconnect)
                 logger.error(`Tool call for '${requestedExposedName}' failed with non-retryable error after retries: ${error.message}`, error);
                 throw error;
            }

            // If it's a retryable error and we are within maxRetries, the loop continues.
            // If it's a retryable error but we are at maxRetries, the loop will exit after this iteration.
        }
    }

    // If the loop finishes without returning, it means all retries failed.
    const errorMessage = `Error calling tool '${requestedExposedName}' after ${maxRetries} retries (on backend server '${clientForTool.name}', original tool name '${originalToolNameForBackend}'): ${lastError?.message || 'An unknown error occurred'}`;
    logger.error(errorMessage, lastError);
    throw new Error(errorMessage);
});

// ... rest of the file ...

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    const clientForPrompt = promptToClientMap.get(name);

    if (!clientForPrompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    try {
      logger.log('Forwarding prompt request:', name);

      const response = await clientForPrompt.client.request(
        {
          method: 'prompts/get' as const,
          params: {
            name,
            arguments: request.params.arguments || {},
            _meta: request.params._meta || {
              progressToken: undefined
            }
          }
        },
        GetPromptResultSchema
      );

      logger.log('Prompt result:', response);
      return response;
    } catch (error: any) {
      const errorMessage = `Error getting prompt '${name}' from backend server '${clientForPrompt.name}': ${error.message || 'An unknown error occurred'}`;
      logger.error(errorMessage, error);
      throw new Error(errorMessage);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    logger.log("Received prompts/list request - returning from cached map");
    // Directly use the pre-populated map
    const allPrompts: z.infer<typeof ListPromptsResultSchema>['prompts'] = [];
     for (const [name, connectedClient] of promptToClientMap.entries()) {
         // Similar simplification as tools/list
         allPrompts.push({
             name: name, // The map key is the original name
             description: `[${connectedClient.name}] Prompt (details omitted in list)`,
             inputSchema: {},
         });
        }
       logger.log(`Returning ${allPrompts.length} prompts from map.`);
       return {
         prompts: allPrompts,
      nextCursor: undefined // Caching doesn't support pagination easily here
    };
  });

   server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
       logger.log("Received resources/list request - returning from cached map");
       const allResources: z.infer<typeof ListResourcesResultSchema>['resources'] = [];
       for (const [uri, connectedClient] of resourceToClientMap.entries()) {
           // Simplified response
           allResources.push({
               uri: uri,
               name: `[${connectedClient.name}] Resource (details omitted in list)`,
               description: undefined,
               methods: [], // Cannot know methods without asking client
           });
       }
       logger.log(`Returning ${allResources.length} resources from map.`);
       return {
           resources: allResources,
           nextCursor: undefined // Caching doesn't support pagination easily here
       };
   });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    // This logic remains the same, using the map
    const { uri } = request.params;
    const clientForResource = resourceToClientMap.get(uri);

    if (!clientForResource) {
      throw new Error(`Unknown resource: ${uri}`);
    }

    try {
      return await clientForResource.client.request(
        {
          method: 'resources/read',
          params: {
            uri,
            _meta: request.params._meta
          }
        },
        ReadResourceResultSchema
      );
    } catch (error: any) {
      const errorMessage = `Error reading resource '${uri}' from backend server '${clientForResource.name}': ${error.message || 'An unknown error occurred'}`;
      logger.error(errorMessage, error);
      throw new Error(errorMessage);
    }
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    const allTemplates: ResourceTemplate[] = [];

    // Iterate over the correct client list
    for (const connectedClient of currentConnectedClients) { // FIX: Use currentConnectedClients
      try {
        const result = await connectedClient.client.request(
          {
            method: 'resources/templates/list' as const,
            params: {
              cursor: request.params?.cursor,
              _meta: request.params?._meta || {
                progressToken: undefined
              }
            }
          },
          ListResourceTemplatesResultSchema
        );

        if (result.resourceTemplates) {
          // Add explicit type for template parameter
          const templatesWithSource = result.resourceTemplates.map((template: ResourceTemplate) => ({ // FIX: Ensure type is present
            ...template,
            name: `[${connectedClient.name}] ${template.name || ''}`,
            description: template.description ? `[${connectedClient.name}] ${template.description}` : undefined
          }));
          allTemplates.push(...templatesWithSource);
        }
      } catch (error: any) {
        const isMethodNotFoundError = error?.name === 'McpError' && error?.code === -32601;

        if (isMethodNotFoundError) {
          logger.warn(`Warning: Method 'resources/templates/list' not found on server ${connectedClient.name}. Proceeding without templates from this source.`);
        } else {
          // Standardize error propagation for other errors
          const errorMessage = `Error fetching resource templates from backend server '${connectedClient.name}': ${error.message || 'An unknown error occurred'}`;
          logger.error(errorMessage, error); // Log the detailed error
          // We are in a loop, so we might not want to throw and stop the whole process.
          // Instead, we log the error and continue to try fetching from other clients.
          // If we needed to inform the client that partial data occurred, we'd need a different strategy.
          // For now, just logging and continuing. If *all* sources fail, the client gets an empty list.
        }
      }
    }

    return {
      resourceTemplates: allTemplates,
      nextCursor: request.params?.cursor
    };
  });

  // Cleanup function needs to handle the *current* list of clients
  const cleanup = async () => {
    logger.log(`Cleaning up ${currentConnectedClients.length} connected clients...`);
    await Promise.all(currentConnectedClients.map(async ({ name, cleanup: clientCleanup }) => {
        try {
            await clientCleanup();
             logger.log(`  Cleaned up client: ${name}`);
        } catch(error: any) {
             logger.error(`  Error cleaning up client ${name}: ${error.message}`);
        }
    }));
    currentConnectedClients = []; // Clear the list after cleanup
  };

  // Return the server instance and the cleanup function
  // We don't return connectedClients anymore as it's managed internally
  return { server, cleanup };
};
