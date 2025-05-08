import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response, NextFunction } from "express";
import session from 'express-session';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
// Import the necessary functions from mcp-proxy and config
import { createServer, updateBackendConnections, getCurrentProxyState } from "./mcp-proxy.js"; // Added getCurrentProxyState
import http from 'http';
import { fileURLToPath } from 'url';
import { Tool, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
// Import loadToolConfig as well
import { Config, loadConfig, isStdioConfig, loadToolConfig } from './config.js';

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


if (enableAdminUI) {
    console.log("Admin UI is ENABLED.");
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

    if (ADMIN_PASSWORD === 'password') {
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


app.post('/admin/server/install/:serverKey', isAuthenticated, async (req, res) => {
    const serverKey = req.params.serverKey;
    console.log(`Admin request: POST /admin/server/install/${serverKey}`);

    console.warn(`SECURITY WARNING: Attempting to execute installation commands for server '${serverKey}'. This is inherently insecure.`);

    try {
        const config = await loadConfig();
        const serverConfig = config.mcpServers[serverKey];

        if (!serverConfig) {
            return res.status(404).json({ error: `Server configuration not found for key: ${serverKey}` });
        }

        if (!isStdioConfig(serverConfig)) {
             return res.status(400).json({ error: `Installation commands only supported for stdio servers. Server '${serverKey}' is not stdio.` });
        }

        const { installDirectory, installCommands } = serverConfig;

        let absoluteInstallDir: string;
        if (installDirectory) {
             absoluteInstallDir = path.resolve(installDirectory);
             console.log(`Using provided install directory: ${absoluteInstallDir}`);
        } else {
            absoluteInstallDir = path.resolve('/tools', serverKey);
            console.log(`Using default install directory: ${absoluteInstallDir}`);
        }

        // 1. Check if directory already exists
        try {
            await access(absoluteInstallDir);
            console.log(`Installation directory '${absoluteInstallDir}' already exists. Installation not needed.`);
            // Return a specific message indicating it already exists, maybe 200 OK or 409 Conflict? Let's use 200 for simplicity in UI.
            return res.json({ success: true, message: `Directory '${absoluteInstallDir}' already exists. Installation skipped.` });
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                // Rethrow unexpected errors during access check
                throw error;
            }
            // ENOENT is expected, means directory doesn't exist, proceed.
            console.log(`Directory '${absoluteInstallDir}' does not exist. Proceeding...`);
        }

        // 2. Execute install commands if they exist
        const commandsToRun = installCommands && Array.isArray(installCommands) ? installCommands : [];
        if (commandsToRun.length > 0) {
            console.log(`Proceeding with ${commandsToRun.length} installation command(s) for '${serverKey}'...`);
            for (const command of commandsToRun) {
                console.log(`Executing command: ${command}`);
                try {
                    const { stdout, stderr } = await exec(command, { cwd: process.cwd() }); // Execute from project root
                    if (stdout) console.log(`Command stdout:\n${stdout}`);
                    if (stderr) console.warn(`Command stderr:\n${stderr}`);
                } catch (execError: any) {
                    console.error(`Failed to execute command "${command}":`, execError);
                    return res.status(500).json({
                        error: `Installation failed during command: "${command}"`,
                        details: execError.message,
                        stderr: execError.stderr,
                        stdout: execError.stdout
                    });
                }
            }
            console.log(`Successfully executed all installation commands for server '${serverKey}'.`);
        } else {
            console.log(`No installation commands provided for '${serverKey}'. Skipping command execution.`);
        }

        // 3. Create the installation directory to mark as installed
        try {
            console.log(`Creating installation directory: ${absoluteInstallDir}`);
            await mkdir(absoluteInstallDir, { recursive: true });
            console.log(`Successfully created directory ${absoluteInstallDir}.`);
        } catch (mkdirError: any) {
            console.error(`Failed to create installation directory "${absoluteInstallDir}":`, mkdirError);
            return res.status(500).json({
                error: `Failed to create installation directory after command execution (if any).`,
                details: mkdirError.message
            });
        }

        // 4. Return success
        const message = commandsToRun.length > 0
            ? `Installation commands executed and directory '${absoluteInstallDir}' created successfully.`
            : `Directory '${absoluteInstallDir}' created successfully (no commands to run).`;
        res.json({ success: true, message: message });

    } catch (error: any) {
        console.error(`Error during server installation process for '${serverKey}':`, error);
        res.status(500).json({ error: 'Failed to process server installation request.', details: error.message });
    }
});


    console.log(`Serving static admin files from: ${publicPath}`);
    app.use('/admin', express.static(publicPath));

    app.get('/admin', (req, res) => {
        res.redirect('/admin/index.html');
    });
    app.get('/admin/', (req, res) => {
        res.redirect('/admin/index.html');
    });

} else {
    console.log("Admin UI is DISABLED. Set ENABLE_ADMIN_UI=true to enable.");
}


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
    }, 10000);

  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
