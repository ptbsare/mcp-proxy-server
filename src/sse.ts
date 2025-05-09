import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response, NextFunction } from "express";
import session from 'express-session';
import { ServerResponse } from "node:http"; // Import ServerResponse
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { exec as execCallback, spawn } from 'child_process'; // Import spawn
import { promisify } from 'util';
// Import the necessary functions from mcp-proxy and config
import { createServer, updateBackendConnections, getCurrentProxyState } from "./mcp-proxy.js";
import http from 'http';
import { fileURLToPath } from 'url';
import { Tool, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
// Import loadToolConfig as well
import { Config, loadConfig, isStdioConfig, loadToolConfig } from './config.js';
// Import terminal router and related types/variables for shutdown
import { terminalRouter, activeTerminals, TERMINAL_OUTPUT_SSE_CONNECTIONS, ActiveTerminal } from './terminal.js';

const exec = promisify(execCallback);

declare module 'express-session' {
  interface SessionData {
    user?: { username: string };
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const expressServer = http.createServer(app);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'mcp_server.json');
const TOOL_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'tool_config.json');
const SECRET_FILE_PATH = path.resolve(__dirname, '..', 'config', '.session_secret');
const publicPath = path.join(__dirname, '..', 'public');

// createServer no longer returns connectedClients
const { server, cleanup } = await createServer();

const allowedKeysRaw = process.env.MCP_PROXY_SSE_ALLOWED_KEYS || "";
const allowedKeys = new Set(allowedKeysRaw.split(',').map(k => k.trim()).filter(k => k.length > 0));
console.log(`SSE Authentication: ${allowedKeys.size > 0 ? `${allowedKeys.size} key(s) configured.` : 'No keys configured (disabled).'}`);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
const SESSION_SECRET = process.env.SESSION_SECRET || 'unsafe-default-secret';

if (ADMIN_PASSWORD === 'password' || SESSION_SECRET === 'unsafe-default-secret') {
    console.warn("WARNING: Using default admin credentials or session secret. Set ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET environment variables for security.");
}

const enableAdminUI = process.env.ENABLE_ADMIN_UI === 'true';

async function getSessionSecret(): Promise<string> {
    try {
        await access(SECRET_FILE_PATH);
        const secret = await readFile(SECRET_FILE_PATH, 'utf-8');
        console.log("Read existing session secret from file.");
        return secret.trim();
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log("Session secret file not found. Generating a new one...");
            const newSecret = crypto.randomBytes(32).toString('hex');
            try {
                await mkdir(path.dirname(SECRET_FILE_PATH), { recursive: true });
                await writeFile(SECRET_FILE_PATH, newSecret, { encoding: 'utf-8', mode: 0o600 });
                console.log(`New session secret generated and saved to ${SECRET_FILE_PATH}`);
                return newSecret;
            } catch (writeError) {
                console.error("FATAL: Could not write new session secret file:", writeError);
                process.exit(1);
            }
        } else {
            console.error("FATAL: Error accessing session secret file:", error);
            process.exit(1);
        }
    }
}

// Map to store active Admin UI SSE connections, keyed by Express session ID
// Defined globally so it can be accessed by routes defined within the 'if (enableAdminUI)' block
const adminSseConnections = new Map<string, ServerResponse>();

if (enableAdminUI) {
    console.log("Admin UI is ENABLED.");
    // Use global ADMIN_USERNAME and ADMIN_PASSWORD defined earlier.

    if (ADMIN_PASSWORD === 'password') { // Use global ADMIN_PASSWORD
        console.warn("WARNING: Using default admin password. Set ADMIN_USERNAME and ADMIN_PASSWORD environment variables for security.");
    }

    const sessionSecret = await getSessionSecret();

    app.use(session({
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
    }));

    const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
        if (req.session.user) {
            next();
        } else {
            if (req.headers.accept?.includes('application/json')) {
                 res.status(401).json({ error: 'Unauthorized' });
            } else {
                 res.status(401).send('Unauthorized. Please login via the admin interface.');
            }
        }
    };


    app.post('/admin/login', (req, res) => {
        const { username, password } = req.body;
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            req.session.user = { username: username };
            console.log(`Admin user '${username}' logged in.`);
            res.json({ success: true });
        } else {
            console.warn(`Failed admin login attempt for username: '${username}'`);
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
    });

    app.post('/admin/logout', (req, res) => {
        const username = req.session.user?.username;
        req.session.destroy((err) => {
            if (err) {
                console.error("Error destroying session:", err);
                return res.status(500).json({ success: false, error: 'Failed to logout' });
            }
            console.log(`Admin user '${username}' logged out.`);
            res.clearCookie('connect.sid');
            res.json({ success: true });
        });
    });

    app.get('/admin/config', isAuthenticated, async (req, res) => {
        try {
            console.log("Admin request: GET /admin/config");
            const configData = await readFile(CONFIG_PATH, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.send(configData);
        } catch (error: any) {
            console.error(`Error reading config file at ${CONFIG_PATH}:`, error);
            if (error.code === 'ENOENT') {
                 res.status(404).json({ error: 'Configuration file not found.' });
            } else {
                 res.status(500).json({ error: 'Failed to read configuration file.' });
            }
        }
    });

    app.post('/admin/config', isAuthenticated, async (req, res) => {
        try {
            console.log("Admin request: POST /admin/config");
            const newConfigData = req.body;

            if (typeof newConfigData !== 'object' || newConfigData === null) {
                return res.status(400).json({ error: 'Invalid configuration format: Expected a JSON object.' });
            }

            const configString = JSON.stringify(newConfigData, null, 2);
            await writeFile(CONFIG_PATH, configString, 'utf-8');
            console.log(`Configuration file updated successfully by admin '${req.session.user?.username}'.`);
            res.json({ success: true });
        } catch (error) {
            console.error(`Error writing config file at ${CONFIG_PATH}:`, error);
            res.status(500).json({ error: 'Failed to write configuration file.' });
        }
    });


    // Updated to use getCurrentProxyState
    app.get('/admin/tools/list', isAuthenticated, async (req, res) => {
        console.log("Admin request: GET /admin/tools/list");
        try {
            // Get the current tool state from the proxy module
            const { tools } = getCurrentProxyState();
            // The tools returned are already simplified for the UI
            console.log(`Admin tools/list: Returning ${tools.length} discovered tools from proxy state.`);
            res.json({ tools }); // Return the simplified list directly
        } catch (error: any) {
            console.error(`Admin tools/list: Error getting proxy state:`, error?.message || error);
            res.status(500).json({ error: 'Failed to retrieve tool list from proxy state.' });
        }
    });

    app.get('/admin/tools/config', isAuthenticated, async (req, res) => {
        try {
            console.log("Admin request: GET /admin/tools/config");
            const toolConfigData = await readFile(TOOL_CONFIG_PATH, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.send(toolConfigData);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                 console.log(`Tool config file ${TOOL_CONFIG_PATH} not found, returning empty config.`);
                 res.json({ tools: {} });
            } else {
                 console.error(`Error reading tool config file at ${TOOL_CONFIG_PATH}:`, error);
                 res.status(500).json({ error: 'Failed to read tool configuration file.' });
            }
        }
    });

    app.post('/admin/tools/config', isAuthenticated, async (req, res) => {
        try {
            console.log("Admin request: POST /admin/tools/config");
            const newToolConfigData = req.body;

            if (typeof newToolConfigData !== 'object' || newToolConfigData === null || typeof newToolConfigData.tools !== 'object') {
                return res.status(400).json({ error: 'Invalid tool configuration format: Expected { "tools": { ... } }.' });
            }

            const configString = JSON.stringify(newToolConfigData, null, 2);
            await writeFile(TOOL_CONFIG_PATH, configString, 'utf-8');
            console.log(`Tool configuration file updated successfully by admin '${req.session.user?.username}'.`);
            res.json({ success: true, message: "Configuration saved. Restart proxy server to apply changes." });
        } catch (error) {
            console.error(`Error writing tool config file at ${TOOL_CONFIG_PATH}:`, error);
            res.status(500).json({ error: 'Failed to write tool configuration file.' });
        }
    });
    // Renamed endpoint and updated logic for in-process reload
    app.post('/admin/server/reload', isAuthenticated, async (req, res) => {
        console.log(`Admin request: POST /admin/server/reload by user '${req.session.user?.username}'`);
        try {
            // Load the latest configurations
            const latestServerConfig = await loadConfig();
            const latestToolConfig = await loadToolConfig();

            // Trigger the update process in mcp-proxy
            await updateBackendConnections(latestServerConfig, latestToolConfig);

            console.log("Configuration reload completed successfully.");
            res.json({ success: true, message: 'Server configuration reloaded successfully.' });

        } catch (error: any) {
            console.error("Error during configuration reload:", error);
            res.status(500).json({ success: false, error: 'Failed to reload server configuration.', details: error.message });
        }
    });


    // Modified install endpoint to use spawn and send SSE updates
    app.post('/admin/server/install/:serverKey', isAuthenticated, async (req, res) => {
        const serverKey = req.params.serverKey;
        const adminSessionId = req.session.id; // Get current admin's session ID
        const clientId = req.ip || `admin-${Date.now()}`; // For logging

        console.log(`[${clientId}] Admin request: POST /admin/server/install/${serverKey} for session ${adminSessionId}`);
        console.warn(`[${clientId}] SECURITY WARNING: Attempting to execute installation commands for server '${serverKey}'.`);

        // Immediately respond to the HTTP request
        res.json({ success: true, message: `Installation process for '${serverKey}' started. Check for live updates.` });

        // Run the installation process asynchronously
        (async () => {
            const adminRes = adminSseConnections.get(adminSessionId); // Get the SSE connection for this admin

            // Helper function to send SSE events to the specific admin UI
            const sendAdminSseEvent = (event: string, data: any) => {
                if (adminRes && !adminRes.writableEnded) { // Check if connection exists and is writable
                    try {
                        // Ensure data is stringified to handle objects and special characters
                        adminRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                    } catch (e) {
                        console.error(`[${clientId}] Failed to send admin SSE event ${event} for session ${adminSessionId}:`, e);
                    }
                } else if (adminSessionId) { // Log warning only if we expected a connection
                     console.warn(`[${clientId}] No active admin SSE connection found for session ${adminSessionId} to send event ${event}.`);
                }
            };

            try {
                const config = await loadConfig();
                const serverConfig = config.mcpServers[serverKey];

                if (!serverConfig) {
                    sendAdminSseEvent('install_error', { serverKey, error: `Server configuration not found for key: ${serverKey}` });
                    return;
                }
                if (!isStdioConfig(serverConfig)) {
                    sendAdminSseEvent('install_error', { serverKey, error: `Installation commands only supported for stdio servers.` });
                    return;
                }

                const { installDirectory, installCommands } = serverConfig;
                let absoluteInstallDir: string; // This is the directory for the server itself, e.g., /tools/my-server

                if (installDirectory) { // 1. From mcp_server.json
                    absoluteInstallDir = path.resolve(installDirectory);
                    sendAdminSseEvent('install_info', { serverKey, message: `Using 'installDirectory' from config: ${absoluteInstallDir}` });
                } else if (process.env.TOOLS_FOLDER && process.env.TOOLS_FOLDER.trim() !== '') { // 2. From TOOLS_FOLDER env var
                    absoluteInstallDir = path.resolve(process.env.TOOLS_FOLDER.trim(), serverKey);
                    sendAdminSseEvent('install_info', { serverKey, message: `Using 'TOOLS_FOLDER' env var ('${process.env.TOOLS_FOLDER.trim()}'). Target server directory: ${absoluteInstallDir}` });
                } else { // 3. Default to a 'tools' subfolder in the project's current working directory
                    absoluteInstallDir = path.resolve(process.cwd(), 'tools', serverKey);
                    sendAdminSseEvent('install_info', { serverKey, message: `No 'installDirectory' in config or 'TOOLS_FOLDER' env var. Defaulting to project's 'tools' subfolder. Target server directory: ${absoluteInstallDir}` });
                }
                
                // Commands should be executed in the parent directory of the server's specific folder
                const executionCwd = path.dirname(absoluteInstallDir); 
                console.log(`[${clientId}] Target server installation directory for ${serverKey}: ${absoluteInstallDir}`);
                console.log(`[${clientId}] Execution CWD for install commands of ${serverKey}: ${executionCwd}`);
                sendAdminSseEvent('install_info', { serverKey, message: `Install commands will be executed in: ${executionCwd}` });

                // Ensure executionCwd (parent directory for installation) exists
                try {
                    await mkdir(executionCwd, { recursive: true });
                    sendAdminSseEvent('install_info', { serverKey, message: `Ensured execution directory exists: ${executionCwd}` });
                } catch (mkdirError: any) {
                    sendAdminSseEvent('install_error', { serverKey, error: `Failed to create execution directory '${executionCwd}': ${mkdirError.message}` });
                    throw mkdirError;
                }

                // 1. Check if the specific server directory (absoluteInstallDir) already exists
                try {
                    await access(absoluteInstallDir);
                    sendAdminSseEvent('install_info', { serverKey, message: `Target server directory '${absoluteInstallDir}' already exists. Installation skipped.` });
                    sendAdminSseEvent('install_complete', { serverKey, code: 0, message: "Already installed." });
                    return; // Stop if already installed
                } catch (error: any) {
                    if (error.code !== 'ENOENT') {
                         sendAdminSseEvent('install_error', { serverKey, error: `Error checking target server directory '${absoluteInstallDir}': ${error.message}` });
                         throw error; // Rethrow unexpected errors
                    }
                    sendAdminSseEvent('install_info', { serverKey, message: `Target server directory '${absoluteInstallDir}' does not exist. Proceeding with installation commands...` });
                }

                // 2. Execute install commands using spawn for live output
                const commandsToRun = installCommands && Array.isArray(installCommands) ? installCommands : [];
                if (commandsToRun.length > 0) {
                    sendAdminSseEvent('install_info', { serverKey, message: `Executing ${commandsToRun.length} installation command(s) in ${executionCwd}...` });
                    for (const command of commandsToRun) {
                        sendAdminSseEvent('install_info', { serverKey, message: `Executing: ${command}` });

                        const commandParts = command.split(' ');
                        const cmd = commandParts[0];
                        const args = commandParts.slice(1);

                        const child = spawn(cmd, args, {
                            shell: true, 
                            cwd: executionCwd, // Execute in the calculated parent directory
                            stdio: ['ignore', 'pipe', 'pipe'] 
                        });

                        // Stream stdout
                        child.stdout.on('data', (data) => {
                            const output = data.toString();
                            console.log(`[${clientId}] Install stdout (${serverKey}): ${output.trim()}`);
                            sendAdminSseEvent('install_stdout', { serverKey, output });
                        });

                        // Stream stderr
                        child.stderr.on('data', (data) => {
                            const output = data.toString();
                            console.error(`[${clientId}] Install stderr (${serverKey}): ${output.trim()}`);
                            sendAdminSseEvent('install_stderr', { serverKey, output });
                        });

                        // Wait for command completion
                        const exitCode = await new Promise<number | null>((resolve, reject) => {
                            child.on('close', resolve); 
                            child.on('error', (err) => { 
                                 console.error(`[${clientId}] Failed to start command "${command}":`, err);
                                 reject(err);
                            });
                        });

                        if (exitCode !== 0) {
                            const errorMsg = `Command "${command}" failed with exit code ${exitCode}.`;
                            sendAdminSseEvent('install_error', { serverKey, error: errorMsg, command, exitCode });
                            throw new Error(errorMsg); 
                        }
                        sendAdminSseEvent('install_info', { serverKey, message: `Command "${command}" completed successfully.` });
                    }
                    sendAdminSseEvent('install_info', { serverKey, message: `All installation commands executed successfully.` });
                } else {
                    sendAdminSseEvent('install_info', { serverKey, message: `No installation commands provided.` });
                }

                // 3. After commands, ensure the target server directory (absoluteInstallDir) itself exists.
                // This is important if installCommands were supposed to create it (e.g., git clone serverKey).
                try {
                    await access(absoluteInstallDir);
                    sendAdminSseEvent('install_info', { serverKey, message: `Confirmed target server directory exists: ${absoluteInstallDir}` });
                } catch (error: any) {
                     if (error.code === 'ENOENT') { // If it still doesn't exist (e.g. no commands, or commands didn't create it)
                        sendAdminSseEvent('install_info', { serverKey, message: `Target server directory ${absoluteInstallDir} not found after commands. If commands were expected to create it, check them. Creating directory now.` });
                        await mkdir(absoluteInstallDir, { recursive: true }); // Create it as a fallback.
                        sendAdminSseEvent('install_info', { serverKey, message: `Successfully created target server directory ${absoluteInstallDir}.` });
                     } else { // Other access error
                        sendAdminSseEvent('install_error', { serverKey, error: `Error after commands, verifying/creating directory '${absoluteInstallDir}': ${error.message}` });
                        throw error;
                     }
                }

                // 4. Send final success event
                sendAdminSseEvent('install_complete', { serverKey, code: 0, message: "Installation process completed successfully." });

            } catch (error: any) {
                console.error(`[${clientId}] Error during server installation process for '${serverKey}':`, error);
                if (!error.message?.includes('failed with exit code') && 
                    !error.message?.includes('Failed to create execution directory') &&
                    !error.message?.includes('Failed to create installation directory') &&
                    !error.message?.includes('Error checking target server directory') &&
                    !error.message?.includes('Error after commands, verifying/creating directory')) {
                     sendAdminSseEvent('install_error', { serverKey, error: `Installation failed: ${error.message}` });
                }
            }
        })(); // Immediately invoke the async function
    });

    // Add Admin SSE endpoint only if Admin UI is enabled
    app.get('/admin/sse/updates', isAuthenticated, (req, res) => {
        const sessionId = req.session.id; // Get Express session ID
        if (!sessionId) {
            res.status(400).send("Session not found");
            return;
        }

        console.log(`[Admin SSE] Connection received for session: ${sessionId}`);

        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        });

        // Send connected event
        res.write(`event: connected\ndata: ${JSON.stringify({ message: "Admin SSE connected" })}\n\n`);

        // Store connection
        adminSseConnections.set(sessionId, res);
        console.log(`[Admin SSE] Connection stored for session ${sessionId}. Total admin connections: ${adminSseConnections.size}`);

        // Remove connection on close
        req.on('close', () => {
            adminSseConnections.delete(sessionId);
            console.log(`[Admin SSE] Connection closed for session ${sessionId}. Total admin connections: ${adminSseConnections.size}`);
        });
    });

    // Mount the terminal router under /admin/terminal, protected by authentication
    app.use('/admin/terminal', isAuthenticated, terminalRouter);


    // Static file serving for admin UI should also be inside the if block
    console.log(`Serving static admin files from: ${publicPath}`);
    app.use('/admin', express.static(publicPath));

    app.get('/admin', (req, res) => {
        res.redirect('/admin/index.html');
    });
    app.get('/admin/', (req, res) => {
        res.redirect('/admin/index.html');
    });

} else { // Correctly placed else block for when Admin UI is disabled
     console.log("Admin UI is DISABLED. Set ENABLE_ADMIN_UI=true to enable.");
} // End of the main if (enableAdminUI) block


const sseTransports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req, res) => {
  const clientId = req.ip || `client-${Date.now()}`;
  console.log(`[${clientId}] SSE connection received`);

  if (allowedKeys.size > 0) {
    const headerKey = req.headers['x-api-key'] as string | undefined;
    const queryKey = req.query.key as string | undefined;
    const providedKey = headerKey || queryKey;

    if (!providedKey || !allowedKeys.has(providedKey)) {
      console.warn(`[${clientId}] Unauthorized SSE connection attempt. Key provided: ${providedKey ? "'"+providedKey+"'" : 'None'}`);
      res.status(401).send('Unauthorized');
      return;
    }
    console.log(`[${clientId}] Authorized SSE connection using ${headerKey ? 'header' : 'query'} key.`);
  }


  let clientTransport: SSEServerTransport | null = null;
  const sessionIdFromClientQuery = req.query.session_id as string | undefined;
  let actualTransportSessionId: string | undefined; // The ID generated and used by the SSEServerTransport instance

  try {
    // If client provides a session_id in query, and it exists on the server,
    // it implies an attempt to reconnect or a stale client. Clean up the old one.
    if (sessionIdFromClientQuery && sseTransports.has(sessionIdFromClientQuery)) {
      console.log(`[${clientId}] Client provided existing session ID: ${sessionIdFromClientQuery}. Closing and removing old transport.`);
      const existingTransport = sseTransports.get(sessionIdFromClientQuery)!;
      sseTransports.delete(sessionIdFromClientQuery); // Remove old one from map
      if (typeof existingTransport.close === 'function') {
        existingTransport.close().catch(err =>
          console.warn(`[${clientId}] Non-critical error closing existing transport for session ${sessionIdFromClientQuery}:`, err)
        );
      }
      console.log(`[${clientId}] Old transport for session ${sessionIdFromClientQuery} removed. Active sessions: ${sseTransports.size}`);
    } else if (sessionIdFromClientQuery) {
      console.log(`[${clientId}] Client provided session ID ${sessionIdFromClientQuery}, but no active session found for it. A new session will be created.`);
    }

    // Always create a new SSEServerTransport.
    // It will generate its own internal sessionId, which will be sent to the client via the 'endpoint' event.
    // The client is expected to use this server-provided sessionId for subsequent POST /message requests.
    console.log(`[${clientId}] Creating new SSEServerTransport...`);
    clientTransport = new SSEServerTransport("/message", res);
    actualTransportSessionId = clientTransport.sessionId; // Get the ID generated by the transport itself

    if (!actualTransportSessionId) {
      throw new Error("Failed to obtain session ID from new SSE transport instance.");
    }
    
    sseTransports.set(actualTransportSessionId, clientTransport); // Store the new transport with its own generated ID
    console.log(`[${clientId}] New SSE transport created. Actual Session ID for this connection: ${actualTransportSessionId}. Client initially provided: ${sessionIdFromClientQuery || 'none'}. Active sessions: ${sseTransports.size}`);
    
    const currentTransport = clientTransport; // To use in closures for onclose/onerror
    const currentSessionId = actualTransportSessionId; // To use in closures

    currentTransport.onerror = (err: any) => {
      console.error(`[${clientId}] SSE transport error for session ${currentSessionId}: ${err?.stack || err?.message || err}`);
      if (sseTransports.has(currentSessionId)) {
        sseTransports.delete(currentSessionId);
        console.log(`[${clientId}] Transport for session ${currentSessionId} removed due to error. Active sessions: ${sseTransports.size}`);
      }
    };

    currentTransport.onclose = () => {
      console.log(`[${clientId}] SSE client disconnected for session ${currentSessionId}.`);
      if (sseTransports.has(currentSessionId)) {
        sseTransports.delete(currentSessionId);
        console.log(`[${clientId}] Transport for session ${currentSessionId} removed on close. Active sessions: ${sseTransports.size}`);
      }
    };

    console.log(`[${clientId}] Attempting server.connect for new transport with session ${currentSessionId}...`);
    await server.connect(currentTransport);
    console.log(`[${clientId}] SSE client connected successfully via server.connect for session ${currentSessionId}.`);

  } catch (error: any) {
    const logSessionIdOnError = actualTransportSessionId || sessionIdFromClientQuery || "unknown_during_error_handling";
    console.error(`[${clientId}] Failed during SSE setup or connection for session attempt related to ${logSessionIdOnError}:`, error);
    
    // If a transport was created and added to the map, ensure it's cleaned up on error.
    if (actualTransportSessionId && sseTransports.has(actualTransportSessionId)) {
       sseTransports.delete(actualTransportSessionId);
       console.log(`[${clientId}] Transport for session ${actualTransportSessionId} removed due to setup/connection error. Active sessions: ${sseTransports.size}`);
    }
    // Ensure clientTransport (if partially created) is closed on error.
    if (clientTransport && typeof clientTransport.close === 'function') {
      clientTransport.close().catch((e: any) => console.error(`[${clientId}] Error closing transport for session ${logSessionIdOnError} after connection failure:`, e));
    }
    if (!res.headersSent) {
      res.status(500).send('Failed to establish SSE connection');
    }
  }
});

// Removed GET /message?action=new_session endpoint as it's deemed unnecessary.
// The client should rely on the sessionId provided by the 'endpoint' event from the /sse connection.

app.post("/message", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  console.log(`Received POST /message for Session ID: ${sessionId}`);

  if (!sessionId) {
    console.error("POST /message error: Missing sessionId query parameter.");
    return res.status(400).send({ error: "Missing sessionId query parameter" });
  }

  const transport = sseTransports.get(sessionId);

  if (!transport) {
    console.error(`POST /message error: No active transport found for Session ID: ${sessionId}`);
    return res.status(404).send({ error: `No active session found for ID ${sessionId}` });
  }

  console.log(`Found transport for session ${sessionId}. Handling POST message...`);
  try {
    await transport.handlePostMessage(req, res, req.body);
    console.log(`Successfully handled POST for session ${sessionId}`);
  } catch (error: any) {
    console.error(`Error in transport.handlePostMessage for session ${sessionId}:`, error);
    if (!res.headersSent) {
      res.status(500).send({ error: "Failed to process message via transport" });
    }
  }
});


const PORT = process.env.PORT || 3663;

expressServer.listen(PORT, () => {
  console.log(`SSE Server is running on http://localhost:${PORT}`);
  if (enableAdminUI) {
      console.log(`Admin UI available at http://localhost:${PORT}/admin`);
  }
});

const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  try {
    console.log("Closing MCP Server (disconnecting transports)...");
    await server.close();
    console.log("MCP Server closed.");

    console.log("Cleaning up backend clients...");
    await cleanup();
    console.log("Backend clients cleaned up.");

    // Kill any active terminal processes
    console.log("Killing active terminal sessions...");
    // Add type annotations for the forEach callback parameters
    activeTerminals.forEach((term: ActiveTerminal, id: string) => {
        console.log(`Killing terminal ${id} (PID: ${term.ptyProcess.pid})`);
        term.ptyProcess.kill();
    });
    activeTerminals.clear();
    TERMINAL_OUTPUT_SSE_CONNECTIONS.clear(); // Also clear SSE connections for terminals
    console.log("Active terminal sessions killed.");


    console.log("Closing HTTP server...");
    expressServer.close((err) => {
      if (err) {
        console.error("Error closing HTTP server:", err);
        process.exit(1);
      } else {
        console.log("HTTP server closed.");
        process.exit(0);
      }
    });

    setTimeout(() => {
      console.error("Graceful shutdown timed out. Forcing exit.");
      process.exit(1);
    }, 10000); // Increased timeout slightly

  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
