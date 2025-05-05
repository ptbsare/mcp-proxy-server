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
import { Config, loadConfig } from './config.js';
import { z } from 'zod';
import * as eventsource from 'eventsource';

global.EventSource = eventsource.EventSource

export const createServer = async () => {
  const config = await loadConfig();
  const connectedClients = await createClients(config.mcpServers);
  console.log(`Connected to ${connectedClients.length} servers`);

  const toolToClientMap = new Map<string, ConnectedClient>();
  const resourceToClientMap = new Map<string, ConnectedClient>();
  const promptToClientMap = new Map<string, ConnectedClient>();

  const server = new Server(
    {
      name: "mcp-proxy-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    console.log("Received tools/list request");
    const allTools: Tool[] = [];
    toolToClientMap.clear();
    console.log(`Querying ${connectedClients.length} connected clients for tools...`);

    for (const connectedClient of connectedClients) {
      console.log(`  Querying client: ${connectedClient.name}`);
      try {
        const result = await connectedClient.client.request(
          {
            method: 'tools/list',
            params: {
              _meta: request.params?._meta
            }
          },
          ListToolsResultSchema
        );
        console.log(`    Received response from ${connectedClient.name}:`, JSON.stringify(result));

        if (result.tools && result.tools.length > 0) {
          console.log(`      Found ${result.tools.length} tools from ${connectedClient.name}`);
          const toolsWithSource = result.tools.map(tool => {
            toolToClientMap.set(tool.name, connectedClient);
            return {
              ...tool,
              description: `[${connectedClient.name}] ${tool.description || ''}`
            };
          });
          allTools.push(...toolsWithSource);
        } else {
          console.log(`      No tools found from ${connectedClient.name}`);
        }
      } catch (error: any) {
        const isMethodNotFoundError = error?.name === 'McpError' && error?.code === -32601;

        if (isMethodNotFoundError) {
          console.warn(`Warning: Method 'tools/list' not found on server ${connectedClient.name}. Proceeding without tools from this source.`);
        } else {
          console.error(`  Error fetching tools from ${connectedClient.name}:`, error?.message || error);
        }
      }
    }

    console.log(`Finished querying clients. Returning ${allTools.length} total tools.`);
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const clientForTool = toolToClientMap.get(name);

    if (!clientForTool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      console.log('Forwarding tool call:', name);

      return await clientForTool.client.request(
        {
          method: 'tools/call',
          params: {
            name,
            arguments: args || {},
            _meta: {
              progressToken: request.params._meta?.progressToken
            }
          }
        },
        CompatibilityCallToolResultSchema
      );
    } catch (error) {
      console.error(`Error calling tool through ${clientForTool.name}:`, error);
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
    const allPrompts: z.infer<typeof ListPromptsResultSchema>['prompts'] = [];
    promptToClientMap.clear();

    for (const connectedClient of connectedClients) {
      try {
        const result = await connectedClient.client.request(
          {
            method: 'prompts/list' as const,
            params: {
              cursor: request.params?.cursor,
              _meta: request.params?._meta || {
                progressToken: undefined
              }
            }
          },
          ListPromptsResultSchema
        );

        if (result.prompts) {
          const promptsWithSource = result.prompts.map(prompt => {
            promptToClientMap.set(prompt.name, connectedClient);
            return {
              ...prompt,
              description: `[${connectedClient.name}] ${prompt.description || ''}`
            };
          });
          allPrompts.push(...promptsWithSource);
        }
      } catch (error: any) {
        const isMethodNotFoundError = error?.name === 'McpError' && error?.code === -32601;

        if (isMethodNotFoundError) {
          console.warn(`Warning: Method 'prompts/list' not found on server ${connectedClient.name}. Proceeding without prompts from this source.`);
        } else {
          console.error(`Error fetching prompts from ${connectedClient.name}:`, error?.message || error);
        }
      }
    }

    return {
      prompts: allPrompts,
      nextCursor: request.params?.cursor
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const allResources: z.infer<typeof ListResourcesResultSchema>['resources'] = [];
    resourceToClientMap.clear();

    for (const connectedClient of connectedClients) {
      try {
        const result = await connectedClient.client.request(
          {
            method: 'resources/list',
            params: {
              cursor: request.params?.cursor,
              _meta: request.params?._meta
            }
          },
          ListResourcesResultSchema
        );

        if (result.resources) {
          const resourcesWithSource = result.resources.map(resource => {
            resourceToClientMap.set(resource.uri, connectedClient);
            return {
              ...resource,
              name: `[${connectedClient.name}] ${resource.name || ''}`
            };
          });
          allResources.push(...resourcesWithSource);
        }
      } catch (error: any) { // Add type annotation
        const isMethodNotFoundError = error?.name === 'McpError' && error?.code === -32601;

        if (isMethodNotFoundError) {
          // Log a warning for "Method not found"
          console.warn(`Warning: Method 'resources/list' not found on server ${connectedClient.name}. Proceeding without resources from this source.`);
          // Allow loop to continue
        } else {
          // Log other errors as critical errors
          console.error(`Error fetching resources from ${connectedClient.name}:`, error?.message || error);
        }
      }
    }

    return {
      resources: allResources,
      nextCursor: undefined
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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

    for (const connectedClient of connectedClients) {
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
          const templatesWithSource = result.resourceTemplates.map(template => ({
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

  const cleanup = async () => {
    await Promise.all(connectedClients.map(({ cleanup }) => cleanup()));
  };

  return { server, cleanup };
};
