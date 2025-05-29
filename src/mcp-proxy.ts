import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
import { Config, loadConfig, TransportConfig, isSSEConfig, isStdioConfig, isHttpConfig, ToolConfig, loadToolConfig } from './config.js';
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

// Define Global Default Proxy Settings
const defaultProxySettingsFull: Required<NonNullable<Config['proxy']>> = {
    retrySseToolCallOnDisconnect: true,
    retryHttpToolCall: true,
    httpToolCallMaxRetries: 2,
    httpToolCallRetryDelayBaseMs: 300,
};

let currentProxyConfig: Required<NonNullable<Config['proxy']>> = { ...defaultProxySettingsFull }; // Initialize with full defaults

// --- Function to update backend connections and maps ---
export const updateBackendConnections = async (newServerConfig: Config, newToolConfig: ToolConfig) => {
    console.log("Starting update of backend connections...");
    currentToolConfig = newToolConfig; // Update stored tool config
    currentProxyConfig = { // Update currentProxyConfig using full defaults
        ...defaultProxySettingsFull,
        ...(newServerConfig.proxy || {}),
    };

    const activeServersConfigLocal: Record<string, TransportConfig> = {}; // Renamed to avoid conflict with module-level
    for (const serverKey in newServerConfig.mcpServers) {
        if (Object.prototype.hasOwnProperty.call(newServerConfig.mcpServers, serverKey)) {
            const serverConf = newServerConfig.mcpServers[serverKey];
            const isActive = !(serverConf.active === false || String(serverConf.active).toLowerCase() === 'false');
            if (isActive) {
                activeServersConfigLocal[serverKey] = serverConf;
            } else {
                 const serverName = serverConf.name || (isSSEConfig(serverConf) ? serverConf.url : isStdioConfig(serverConf) ? serverConf.command : serverKey);
                 console.log(`Skipping inactive server during update: ${serverName}`);
            }
        }
    }
    currentActiveServersConfig = activeServersConfigLocal; // Update module-level variable

    const newClientKeys = new Set(Object.keys(activeServersConfigLocal));
    const currentClientKeys = new Set(currentConnectedClients.map(c => c.name));

    const clientsToRemove = currentConnectedClients.filter(c => !newClientKeys.has(c.name));
    const clientsToKeep = currentConnectedClients.filter(c => newClientKeys.has(c.name));
    const keysToAdd = Object.keys(activeServersConfigLocal).filter(key => !currentClientKeys.has(key));

    console.log(`Clients to remove: ${clientsToRemove.map(c => c.name).join(', ') || 'None'}`);
    console.log(`Clients to keep: ${clientsToKeep.map(c => c.name).join(', ') || 'None'}`);
    console.log(`Server keys to add: ${keysToAdd.join(', ') || 'None'}`);

    // 1. Cleanup removed clients
    if (clientsToRemove.length > 0) {
        console.log(`Cleaning up ${clientsToRemove.length} removed clients...`);
        await Promise.all(clientsToRemove.map(async ({ name, cleanup }) => {
            try {
                await cleanup();
                console.log(`  Cleaned up client: ${name}`);
            } catch (error) {
                console.error(`  Error cleaning up client ${name}:`, error);
            }
        }));
    }

    // 2. Connect new clients
    let newlyConnectedClients: ConnectedClient[] = [];
    if (keysToAdd.length > 0) {
        const configToAdd: Record<string, TransportConfig> = {};
        keysToAdd.forEach(key => { configToAdd[key] = activeServersConfigLocal[key]; });
        console.log(`Connecting ${keysToAdd.length} new clients...`);
        newlyConnectedClients = await createClients(configToAdd);
        console.log(`Successfully connected to ${newlyConnectedClients.length} out of ${keysToAdd.length} new clients.`);
    }

    // 3. Update the main list
    currentConnectedClients = [...clientsToKeep, ...newlyConnectedClients];
    console.log(`Total active clients after update: ${currentConnectedClients.length}`);

    // 4. Clear and repopulate maps immediately (important for consistency)
    console.log("Clearing and repopulating internal maps (tools, resources, prompts)...");
    toolToClientMap.clear();
    resourceToClientMap.clear();
    promptToClientMap.clear();

    // Repopulate Tools Map
    for (const connectedClient of currentConnectedClients) {
        try {
            const result = await connectedClient.client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
            if (result.tools && result.tools.length > 0) {
                for (const tool of result.tools) {
                    const qualifiedName = `${connectedClient.name}--${tool.name}`; // Changed separator to --
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
                 console.error(`Error fetching tools from ${connectedClient.name} during map update:`, error?.message || error);
             }
        }
    }
    console.log(`  Updated tool map with ${toolToClientMap.size} enabled tools.`);

    // Repopulate Resources Map
    for (const connectedClient of currentConnectedClients) {
         try {
             const result = await connectedClient.client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
             if (result.resources) {
                 result.resources.forEach(resource => resourceToClientMap.set(resource.uri, connectedClient));
             }
         } catch (error: any) {
              if (!(error?.name === 'McpError' && error?.code === -32601)) { // Ignore 'Method not found'
                  console.error(`Error fetching resources from ${connectedClient.name} during map update:`, error?.message || error);
              }
         }
    }
     console.log(`  Updated resource map with ${resourceToClientMap.size} resources.`);

    // Repopulate Prompts Map
    for (const connectedClient of currentConnectedClients) {
         try {
             const result = await connectedClient.client.request({ method: 'prompts/list', params: {} }, ListPromptsResultSchema);
             if (result.prompts) {
                 result.prompts.forEach(prompt => promptToClientMap.set(prompt.name, connectedClient));
             }
         } catch (error: any) {
              if (!(error?.name === 'McpError' && error?.code === -32601)) { // Ignore 'Method not found'
                  console.error(`Error fetching prompts from ${connectedClient.name} during map update:`, error?.message || error);
              }
         }
    }
    console.log(`  Updated prompt map with ${promptToClientMap.size} prompts.`);
    console.log("Backend connections update finished.");
};

async function refreshBackendConnection(serverKey: string, serverConfig: TransportConfig): Promise<boolean> {
  console.log(`Attempting to refresh backend connection for server: ${serverKey}`);
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
    console.error(`Configuration for server ${serverKey} not found. Cannot refresh.`);
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
      console.log(`Updated existing client entry for ${serverKey} in currentConnectedClients.`);
    } else {
      currentConnectedClients.push(newConnectedClientEntry);
      console.log(`Added new client entry for ${serverKey} to currentConnectedClients (this path might be taken if client was previously removed due to error).`);
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
    console.log(`Cleared map entries for ${serverKey}.`);

    // Repopulate maps for the reconnected client
    const connectedClient = newConnectedClientEntry;
    try {
        const result = await connectedClient.client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
        if (result.tools && result.tools.length > 0) {
            for (const tool of result.tools) {
                const qualifiedName = `${connectedClient.name}--${tool.name}`;
                const toolSettings = currentToolConfig.tools[qualifiedName];
                const isEnabled = !toolSettings || toolSettings.enabled !== false;
                if (isEnabled) {
                    toolToClientMap.set(qualifiedName, { client: connectedClient, toolInfo: tool });
                }
            }
        }
    } catch (error: any) {
         if (!(error?.name === 'McpError' && error?.code === -32601)) {
             console.error(`Error fetching tools from ${connectedClient.name} during refresh:`, error?.message || error);
         }
    }

    try {
         const result = await connectedClient.client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
         if (result.resources) {
             result.resources.forEach(resource => resourceToClientMap.set(resource.uri, connectedClient));
         }
     } catch (error: any) {
          if (!(error?.name === 'McpError' && error?.code === -32601)) {
              console.error(`Error fetching resources from ${connectedClient.name} during refresh:`, error?.message || error);
          }
     }

    try {
         const result = await connectedClient.client.request({ method: 'prompts/list', params: {} }, ListPromptsResultSchema);
         if (result.prompts) {
             result.prompts.forEach(prompt => promptToClientMap.set(prompt.name, connectedClient));
         }
     } catch (error: any) {
          if (!(error?.name === 'McpError' && error?.code === -32601)) {
              console.error(`Error fetching prompts from ${connectedClient.name} during refresh:`, error?.message || error);
          }
     }
    console.log(`Repopulated maps for ${serverKey}.`);
    return true;

  } catch (error) {
    console.error(`Failed to refresh backend connection for ${serverKey}:`, error);
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
    console.log(`Removed client ${serverKey} and its map entries after failed refresh.`);
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
    return { tools };
};

// Helper function to identify connection errors
const isConnectionError = (err: any): boolean => {
  if (err && err.message) {
    const lowerMessage = err.message.toLowerCase();
    return lowerMessage.includes("disconnected") ||
           lowerMessage.includes("not connected") ||
           lowerMessage.includes("connection closed") ||
           lowerMessage.includes("transport is closed") || // SDK specific
           lowerMessage.includes("failed to fetch"); // Network level
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
    console.log("Received tools/list request - applying overrides from config");
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
    console.log(`Returning ${enabledTools.length} enabled tools with applied overrides.`);
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
        console.error(`Attempted to call tool with exposed name "${requestedExposedName}", but no corresponding enabled tool or override configuration found.`);
        throw new Error(`Unknown or disabled tool: ${requestedExposedName}`);
    }

    // Now we have the correct mapEntry and the originalQualifiedName
    let { client: clientForTool, toolInfo } = mapEntry; // toolInfo here is the correct one from the found mapEntry
    const originalToolNameForBackend = toolInfo.name; // The actual name the backend server expects (from the original toolInfo)

    try {
      console.log(`Received tool call for exposed name '${requestedExposedName}' (original qualified name: '${originalQualifiedName}'). Forwarding to server '${clientForTool.name}' as tool '${originalToolNameForBackend}' (Attempt 1)`);
      return await clientForTool.client.request(
        {
          method: 'tools/call',
          params: { name: originalToolNameForBackend, arguments: args || {}, _meta: { progressToken: request.params._meta?.progressToken } }
        },
        CompatibilityCallToolResultSchema
      );
    } catch (error: any) {
      console.warn(`Initial attempt to call tool '${requestedExposedName}' failed: ${error.message}`);

      // Access currentProxyConfig directly as it's guaranteed to be defined
      const shouldRetrySse = currentProxyConfig.retrySseToolCallOnDisconnect !== false;

      if (clientForTool.transportType === 'sse' && isConnectionError(error) && shouldRetrySse) {
        console.log(`SSE connection error for tool '${requestedExposedName}' on server '${clientForTool.name}'. Attempting reconnect and retry.`);
        const clientTransportConfig = currentActiveServersConfig[clientForTool.name];
        if (!clientTransportConfig) {
          console.error(`Cannot retry SSE: TransportConfig for server '${clientForTool.name}' not found.`);
          throw new Error(`Error calling tool '${requestedExposedName}': Original error: ${error.message}. SSE Retry failed: server configuration not found.`);
        }
        const refreshed = await refreshBackendConnection(clientForTool.name, clientTransportConfig);
        if (refreshed) {
          console.log(`Successfully reconnected to server '${clientForTool.name}' via SSE. Retrying tool call for '${requestedExposedName}'.`);
          const newMapEntry = toolToClientMap.get(originalQualifiedName);
          if (!newMapEntry) {
            console.error(`Tool '${originalQualifiedName}' not found in map after successful SSE refresh for server '${clientForTool.name}'.`);
            throw new Error(`Error calling tool '${requestedExposedName}': Original error: ${error.message}. SSE Retry failed: tool not found in map after refresh.`);
          }
          clientForTool = newMapEntry.client;
          toolInfo = newMapEntry.toolInfo;
          try {
            console.log(`Retrying tool call (SSE) for '${requestedExposedName}' to server '${clientForTool.name}' as tool '${originalToolNameForBackend}' (Attempt 2)`);
            return await clientForTool.client.request(
              { method: 'tools/call', params: { name: originalToolNameForBackend, arguments: args || {}, _meta: { progressToken: request.params._meta?.progressToken } } },
              CompatibilityCallToolResultSchema
            );
          } catch (retryError: any) {
            const errorMessage = `Error calling tool '${requestedExposedName}' (on backend '${clientForTool.name}') after SSE retry: ${retryError.message || 'An unknown error occurred during retry'}`;
            console.error(errorMessage, retryError);
            throw new Error(errorMessage);
          }
        } else {
          const errorMessage = `Error calling tool '${requestedExposedName}': SSE Reconnection to server '${clientForTool.name}' failed. Original error: ${error.message || 'An unknown error occurred'}`;
          console.error(errorMessage);
          throw new Error(errorMessage);
        }
      } 
      // HTTP Retry Logic
      else if (clientForTool.transportType === 'http' && 
               (currentProxyConfig.retryHttpToolCall !== false) && // Retry enabled by default, access directly
               isConnectionError(error)) {
        
        // Access properties directly. Defaults are assured by currentProxyConfig's initialization.
        const maxRetries = currentProxyConfig.httpToolCallMaxRetries;
        const retryDelayBaseMs = currentProxyConfig.httpToolCallRetryDelayBaseMs;
        let lastError: any = error;

        console.log(`HTTP connection error for tool '${requestedExposedName}' on server '${clientForTool.name}'. Attempting up to ${maxRetries} retries.`);

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const delay = retryDelayBaseMs * Math.pow(2, attempt) + (Math.random() * retryDelayBaseMs * 0.5);
            console.log(`HTTP tool call failed for '${requestedExposedName}'. Attempt ${attempt + 1}/${maxRetries}. Retrying in ${delay.toFixed(0)}ms...`);
            await sleep(delay);
            
            console.log(`Retrying tool call (HTTP) for '${requestedExposedName}' to server '${clientForTool.name}' as tool '${originalToolNameForBackend}' (Attempt ${attempt + 2})`);
            return await clientForTool.client.request(
              { method: 'tools/call', params: { name: originalToolNameForBackend, arguments: args || {}, _meta: { progressToken: request.params._meta?.progressToken } } },
              CompatibilityCallToolResultSchema
            );
          } catch (retryError: any) {
            lastError = retryError;
            console.error(`HTTP tool call retry attempt ${attempt + 1}/${maxRetries} for '${requestedExposedName}' failed:`, retryError.message);
            if (attempt === maxRetries - 1) {
              break; 
            }
          }
        }
        const errorMessage = `Error calling HTTP tool '${requestedExposedName}' after ${maxRetries} retries (on backend server '${clientForTool.name}', original tool name '${originalToolNameForBackend}'): ${lastError.message || 'An unknown error occurred'}`;
        console.error(errorMessage, lastError);
        throw new Error(errorMessage);

      } else {
        let reason = "Unknown reason for no retry.";
        if (clientForTool.transportType === 'sse' && !shouldRetrySse) reason = "SSE retry disabled in config";
        else if (clientForTool.transportType === 'sse' && !isConnectionError(error)) reason = "Error not a connection error for SSE";
        else if (clientForTool.transportType === 'http' && (currentProxyConfig.retryHttpToolCall === false)) reason = "HTTP retry disabled in config"; // Access directly
        else if (clientForTool.transportType === 'http' && !isConnectionError(error)) reason = "Error not a connection error for HTTP";
        else if (clientForTool.transportType !== 'sse' && clientForTool.transportType !== 'http') reason = `Unsupported transport type for retry: ${clientForTool.transportType}`;
        
        console.warn(`Not retrying tool call for '${requestedExposedName}'. Reason: ${reason}. Original error: ${error.message}`);
        const errorMessage = `Error calling tool '${requestedExposedName}' (on backend server '${clientForTool.name}', original tool name '${originalToolNameForBackend}'): ${error.message || 'An unknown error occurred'}`;
        console.error(errorMessage, error);
        throw new Error(errorMessage);
      }
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    const clientForPrompt = promptToClientMap.get(name);

    if (!clientForPrompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    try {
      console.log('Forwarding prompt request:', name);

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

      console.log('Prompt result:', response);
      return response;
    } catch (error: any) {
      const errorMessage = `Error getting prompt '${name}' from backend server '${clientForPrompt.name}': ${error.message || 'An unknown error occurred'}`;
      console.error(errorMessage, error);
      throw new Error(errorMessage);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    console.log("Received prompts/list request - returning from cached map");
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
    console.log(`Returning ${allPrompts.length} prompts from map.`);
    return {
      prompts: allPrompts,
      nextCursor: undefined // Caching doesn't support pagination easily here
    };
  });

   server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
       console.log("Received resources/list request - returning from cached map");
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
       console.log(`Returning ${allResources.length} resources from map.`);
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
      console.error(errorMessage, error);
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
          console.warn(`Warning: Method 'resources/templates/list' not found on server ${connectedClient.name}. Proceeding without templates from this source.`);
        } else {
          // Standardize error propagation for other errors
          const errorMessage = `Error fetching resource templates from backend server '${connectedClient.name}': ${error.message || 'An unknown error occurred'}`;
          console.error(errorMessage, error); // Log the detailed error
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
    console.log(`Cleaning up ${currentConnectedClients.length} connected clients...`);
    await Promise.all(currentConnectedClients.map(async ({ name, cleanup: clientCleanup }) => {
        try {
            await clientCleanup();
             console.log(`  Cleaned up client: ${name}`);
        } catch(error) {
             console.error(`  Error cleaning up client ${name}:`, error);
        }
    }));
    currentConnectedClients = []; // Clear the list after cleanup
  };

  // Return the server instance and the cleanup function
  // We don't return connectedClients anymore as it's managed internally
  return { server, cleanup };
};
