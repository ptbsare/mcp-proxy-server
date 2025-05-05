import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response, NextFunction } from "express";
import session from 'express-session';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { createServer } from "./mcp-proxy.js";
import http from 'http';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const expressServer = http.createServer(app);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'mcp_server.json');

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

declare module 'express-session' {
  interface SessionData {
    user?: { username: string };
  }
}

app.use(session({
    secret: SESSION_SECRET,
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
  let sessionId: string | undefined;

  try {
    console.log(`[${clientId}] Creating SSEServerTransport...`);
    clientTransport = new SSEServerTransport("/message", res);

    sessionId = clientTransport.sessionId;
    console.log(`[${clientId}] SSEServerTransport created with Session ID: ${sessionId}`);

    if (!sessionId) {
      throw new Error("Failed to generate session ID for SSE transport.");
    }

    sseTransports.set(sessionId, clientTransport);
    console.log(`[${clientId}] Transport stored for session ${sessionId}. Active sessions: ${sseTransports.size}`);

    clientTransport.onerror = (err: any) => {
      console.error(`[${clientId}] SSE transport error for session ${sessionId}: ${err?.stack || err?.message || err}`);
      if (sessionId) {
        sseTransports.delete(sessionId);
        console.log(`[${clientId}] Transport removed for session ${sessionId} due to error. Active sessions: ${sseTransports.size}`);
      }
    };

    clientTransport.onclose = () => {
      console.log(`[${clientId}] SSE client disconnected for session ${sessionId}.`);
      if (sessionId) {
        sseTransports.delete(sessionId);
        console.log(`[${clientId}] Transport removed for session ${sessionId} on close. Active sessions: ${sseTransports.size}`);
      }
    };

    console.log(`[${clientId}] Attempting server.connect for session ${sessionId}...`);
    await server.connect(clientTransport);
    console.log(`[${clientId}] SSE client connected successfully via server.connect for session ${sessionId}.`);


  } catch (error: any) {
    console.error(`[${clientId}] Failed during SSE setup or connection:`, error);
    if (sessionId) {
       sseTransports.delete(sessionId);
       console.log(`[${clientId}] Transport removed for session ${sessionId} due to setup error. Active sessions: ${sseTransports.size}`);
    }
    if (clientTransport) {
      clientTransport.close().catch((e: any) => console.error(`[${clientId}] Error closing transport after connection failure:`, e));
    }
    if (!res.headersSent) {
      res.status(500).send('Failed to establish SSE connection');
    }
  }
});

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
