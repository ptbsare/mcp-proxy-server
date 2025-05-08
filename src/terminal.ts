import os from 'os';
// Ensure 'node-pty' is installed by running 'npm install node-pty' or 'yarn add node-pty'
import pty, { IPty } from 'node-pty';
import { Request, Response, Router } from 'express';
import { ServerResponse } from 'node:http'; // For SSE Response type hint
import crypto from 'crypto'; // Import crypto for UUID generation

// Export interface for use in sse.ts shutdown
export interface ActiveTerminal {
    ptyProcess: IPty;
    sseResponse?: ServerResponse; // For streaming output via SSE
    id: string;
    lastActivity: number; // Timestamp for potential cleanup
}

// Store active terminals, keyed by a unique ID
// Export Map for use in sse.ts shutdown
export const activeTerminals = new Map<string, ActiveTerminal>();
export const TERMINAL_OUTPUT_SSE_CONNECTIONS = new Map<string, ServerResponse>(); // Separate map for SSE connections

// Determine shell based on OS
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
const PTY_PROCESS_TIMEOUT_MS = 1000 * 60 * 60; // 1 hour inactivity timeout

// --- PTY Management Functions ---

function startPtyProcess(): ActiveTerminal {
    const termId = crypto.randomUUID();
    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80, // Default size
        rows: 30,
        // Ensure cwd is appropriate for the environment, process.cwd() might be safer
        cwd: process.env.HOME || process.cwd(), // Start in user's home directory or workspace root
        env: process.env as { [key: string]: string } // Pass environment variables
    });

    const terminal: ActiveTerminal = {
        ptyProcess,
        id: termId,
        lastActivity: Date.now()
    };

    activeTerminals.set(termId, terminal);
    console.log(`[Terminal] PTY process created with ID: ${termId}, PID: ${ptyProcess.pid}`);

    // Handle PTY output - Forward to connected SSE client if any
    ptyProcess.onData((data: string) => {
        terminal.lastActivity = Date.now(); // Update activity timestamp
        const sseRes = TERMINAL_OUTPUT_SSE_CONNECTIONS.get(termId);
        if (sseRes && !sseRes.writableEnded) {
            try {
                // Send data using 'output' event type
                sseRes.write(`event: output\ndata: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
                console.error(`[Terminal ${termId}] Error writing to SSE stream:`, e);
                // Optionally close SSE connection here if write fails repeatedly
            }
        }
    });

    // Handle PTY exit - Add explicit types for callback parameters
    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number, signal?: number }) => {
        console.log(`[Terminal ${termId}] PTY process exited with code ${exitCode}, signal ${signal}`);
        const sseRes = TERMINAL_OUTPUT_SSE_CONNECTIONS.get(termId);
        if (sseRes && !sseRes.writableEnded) {
            try {
                // Notify client about exit
                sseRes.write(`event: exit\ndata: ${JSON.stringify({ exitCode, signal })}\n\n`);
                sseRes.end(); // Close the SSE connection
            } catch (e) {
                 console.error(`[Terminal ${termId}] Error writing exit event to SSE stream:`, e);
            }
        }
        TERMINAL_OUTPUT_SSE_CONNECTIONS.delete(termId); // Clean up SSE map
        activeTerminals.delete(termId); // Clean up terminal map
    });

    return terminal;
}

function writeToPty(termId: string, data: string): boolean {
    const terminal = activeTerminals.get(termId);
    if (terminal) {
        terminal.ptyProcess.write(data);
        terminal.lastActivity = Date.now();
        return true;
    }
    return false;
}

function resizePty(termId: string, cols: number, rows: number): boolean {
    const terminal = activeTerminals.get(termId);
    if (terminal) {
        try {
             // Ensure cols and rows are integers
             const safeCols = Math.max(1, Math.floor(cols));
             const safeRows = Math.max(1, Math.floor(rows));
             terminal.ptyProcess.resize(safeCols, safeRows);
             terminal.lastActivity = Date.now();
             console.log(`[Terminal ${termId}] Resized to ${safeCols}x${safeRows}`);
             return true;
        } catch (e) {
             console.error(`[Terminal ${termId}] Error resizing PTY:`, e);
             return false;
        }
    }
    return false;
}

function killPty(termId: string): boolean {
    const terminal = activeTerminals.get(termId);
    if (terminal) {
        console.log(`[Terminal ${termId}] Killing PTY process (PID: ${terminal.ptyProcess.pid})`);
        terminal.ptyProcess.kill(); // This will trigger the 'onExit' handler for cleanup
        // Maps are cleaned up in onExit handler
        return true;
    }
    return false;
}

// --- Cleanup Inactive Terminals ---
setInterval(() => {
    const now = Date.now();
    activeTerminals.forEach((terminal, termId) => {
        if (now - terminal.lastActivity > PTY_PROCESS_TIMEOUT_MS) {
            console.log(`[Terminal ${termId}] PTY process timed out due to inactivity. Killing.`);
            killPty(termId);
        }
    });
}, 1000 * 60 * 5); // Check every 5 minutes

// --- Express Router ---
export const terminalRouter = Router();

// POST /admin/terminal/start - Start a new terminal session
terminalRouter.post('/start', (req, res) => {
    try {
        const terminal = startPtyProcess();
        res.status(200).json({ termId: terminal.id });
    } catch (e) {
        console.error("[Terminal] Error starting PTY process:", e);
        res.status(500).json({ error: 'Failed to start terminal session.' });
    }
});

// POST /admin/terminal/:termId/input - Send input to the terminal
terminalRouter.post('/:termId/input', (req, res) => {
    const termId = req.params.termId;
    const input = req.body?.input; // Expecting { "input": "user command" }

    if (typeof input !== 'string') {
        return res.status(400).json({ error: 'Invalid input data. Expecting { "input": "string" }.' });
    }

    if (writeToPty(termId, input)) {
        res.status(200).send(); // OK, input written
    } else {
        res.status(404).json({ error: `Terminal session not found: ${termId}` });
    }
});

// POST /admin/terminal/:termId/resize - Resize the terminal
terminalRouter.post('/:termId/resize', (req, res) => {
    const termId = req.params.termId;
    const { cols, rows } = req.body;

    if (typeof cols !== 'number' || typeof rows !== 'number' || cols <= 0 || rows <= 0) {
        return res.status(400).json({ error: 'Invalid size data. Expecting { "cols": number, "rows": number }.' });
    }

    if (resizePty(termId, Math.floor(cols), Math.floor(rows))) {
        res.status(200).send(); // OK, resized
    } else {
        res.status(404).json({ error: `Terminal session not found: ${termId}` });
    }
});

// DELETE /admin/terminal/:termId - Kill the terminal session
terminalRouter.delete('/:termId', (req, res) => {
    const termId = req.params.termId;
    if (killPty(termId)) {
        res.status(200).json({ message: `Terminal session ${termId} killed.` });
    } else {
        res.status(404).json({ error: `Terminal session not found: ${termId}` });
    }
});

// GET /admin/terminal/:termId/output - Stream terminal output via SSE
terminalRouter.get('/:termId/output', (req, res) => {
    const termId = req.params.termId;
    const terminal = activeTerminals.get(termId);

    if (!terminal) {
        return res.status(404).json({ error: `Terminal session not found: ${termId}` });
    }

    // Check if another SSE connection already exists for this terminal
    if (TERMINAL_OUTPUT_SSE_CONNECTIONS.has(termId)) {
         console.warn(`[Terminal ${termId}] Attempted to establish duplicate SSE output stream.`);
         // Option 2: Close old connection and allow new one (better for reconnections)
         const oldRes = TERMINAL_OUTPUT_SSE_CONNECTIONS.get(termId);
         try { oldRes?.end(); } catch(e){} // Attempt to close gracefully
         TERMINAL_OUTPUT_SSE_CONNECTIONS.delete(termId);
         console.log(`[Terminal ${termId}] Closed existing SSE output stream to allow new connection.`);
    }


    console.log(`[Terminal ${termId}] SSE output stream connection received.`);
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
    });

    // Send connection confirmation (optional)
    res.write(`event: connected\ndata: ${JSON.stringify({ message: `Connected to terminal ${termId} output` })}\n\n`);

    // Store the response object for this terminal's output stream
    TERMINAL_OUTPUT_SSE_CONNECTIONS.set(termId, res);

    // When the SSE connection closes (client disconnects), remove it from the map
    req.on('close', () => {
        console.log(`[Terminal ${termId}] SSE output stream connection closed by client.`);
        TERMINAL_OUTPUT_SSE_CONNECTIONS.delete(termId);
        // Note: We don't kill the PTY process here, only the output stream connection.
        // The PTY process continues until explicitly killed or timed out.
    });

    // Note: Actual PTY data is sent via the ptyProcess.onData handler established in startPtyProcess
});

// Optional: Add a route to list active terminals?
terminalRouter.get('/list', (req, res) => {
    const terms = Array.from(activeTerminals.keys()).map(id => ({
        id,
        pid: activeTerminals.get(id)?.ptyProcess.pid,
        lastActivity: activeTerminals.get(id)?.lastActivity
    }));
    res.json({ terminals: terms });
});