import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createServer } from "./mcp-proxy.js";
import http from 'http';

const app = express();
app.use(express.json());
const expressServer = http.createServer(app);

const { server, cleanup } = await createServer();

const allowedKeysRaw = process.env.MCP_PROXY_SSE_ALLOWED_KEYS || "";
const allowedKeys = new Set(allowedKeysRaw.split(',').map(k => k.trim()).filter(k => k.length > 0));
console.log(`SSE Authentication: ${allowedKeys.size > 0 ? `${allowedKeys.size} key(s) configured.` : 'No keys configured (disabled).'}`);

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
