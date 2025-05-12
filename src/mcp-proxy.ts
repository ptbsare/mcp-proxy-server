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
import { createClients, ConnectedClient } from './client.js';
import { Config, loadConfig, TransportConfig, isSSEConfig, isStdioConfig, ToolConfig, loadToolConfig } from './config.js';
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

// --- Function to update backend connections and maps ---
export const updateBackendConnections = async (newServerConfig: Config, newToolConfig: ToolConfig) => {
    console.log("Starting update of backend connections...");
    currentToolConfig = newToolConfig; // Update stored tool config

    const activeServersConfig: Record<string, TransportConfig> = {};
    for (const serverKey in newServerConfig.mcpServers) {
        if (Object.prototype.hasOwnProperty.call(newServerConfig.mcpServers, serverKey)) {
            const serverConf = newServerConfig.mcpServers[serverKey];
            const isActive = !(serverConf.active === false || String(serverConf.active).toLowerCase() === 'false');
            if (isActive) {
                activeServersConfig[serverKey] = serverConf;
            } else {
                 const serverName = serverConf.name || (isSSEConfig(serverConf) ? serverConf.url : isStdioConfig(serverConf) ? serverConf.command : serverKey);
                 console.log(`Skipping inactive server during update: ${serverName}`);
            }
        }
    }

    const newClientKeys = new Set(Object.keys(activeServersConfig));
    const currentClientKeys = new Set(currentConnectedClients.map(c => c.name));

    const clientsToRemove = currentConnectedClients.filter(c => !newClientKeys.has(c.name));
    const clientsToKeep = currentConnectedClients.filter(c => newClientKeys.has(c.name));
    const keysToAdd = Object.keys(activeServersConfig).filter(key => !currentClientKeys.has(key));

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
        keysToAdd.forEach(key => { configToAdd[key] = activeServersConfig[key]; });
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


// --- Server Creation ---
export const createServer = async () => {
  // Load initial config
  const initialServerConfig = await loadConfig();
  const initialToolConfig = await loadToolConfig();

  // Perform initial connection and map population
  await updateBackendConnections(initialServerConfig, initialToolConfig);

  // Create the main proxy server instance
  const server = new Server(
    {
      name: "mcp-proxy-server",
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
    const { client: clientForTool, toolInfo } = mapEntry; // toolInfo here is the correct one from the found mapEntry
    const originalToolNameForBackend = toolInfo.name; // The actual name the backend server expects (from the original toolInfo)

    try {
      // Log using the exposed name and the original name for clarity
      console.log(`Received tool call for exposed name '${requestedExposedName}' (original qualified name: '${originalQualifiedName}'). Forwarding to server '${clientForTool.name}' as tool '${originalToolNameForBackend}'`);

      // Access the actual MCP client via clientForTool.client
      return await clientForTool.client.request(
        {
          method: 'tools/call',
          params: {
            name: originalToolNameForBackend, // Send the original tool name (from toolInfo.name) to the backend
            arguments: args || {},
            _meta: {
              progressToken: request.params._meta?.progressToken
            }
          }
        },
        CompatibilityCallToolResultSchema
      );
    } catch (error) {
      console.error(`Error calling tool through ${clientForTool.name}:`, error); // Access name via clientForTool
      throw error;
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
    } catch (error) {
      console.error(`Error getting prompt from ${clientForPrompt.name}:`, error);
      throw error;
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
    } catch (error) {
      console.error(`Error reading resource from ${clientForResource.name}:`, error);
      throw error;
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
          console.error(`Error fetching resource templates from ${connectedClient.name}:`, error?.message || error);
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
