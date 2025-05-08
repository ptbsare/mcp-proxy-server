document.addEventListener('DOMContentLoaded', () => {
    const termContainer = document.getElementById('terminal-container');
    const termElement = document.getElementById('terminal');
    const statusElement = document.getElementById('terminal-status');

    if (!termElement || !termContainer || !statusElement) {
        console.error('Terminal container, element, or status element not found!');
        return;
    }

    let termId = null;
    let termSSE = null;
    let term = null; // xterm instance
    let fitAddon = null; // xterm fit addon
    let resizeTimeout = null;
    let lastCols = 0;
    let lastRows = 0;

    function updateStatus(message, state = 'disconnected') {
        statusElement.textContent = message;
        statusElement.className = `terminal-status ${state}`;
    }

    function fitTerminal() {
        if (!fitAddon || !term) return;
        try {
            fitAddon.fit();
            const newCols = term.cols;
            const newRows = term.rows;

            // Send resize event to backend only if size changed and termId exists
            if (termId && (newCols !== lastCols || newRows !== lastRows)) {
                console.log(`Resizing terminal ${termId} to ${newCols}x${newRows}`);
                fetch(`/admin/terminal/${termId}/resize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cols: newCols, rows: newRows })
                }).catch(err => console.error('Error sending resize:', err));
                lastCols = newCols;
                lastRows = newRows;
            }
        } catch (e) {
            console.error("Error fitting terminal:", e);
        }
    }

    function connectTerminalSSE(currentTermId) {
        if (termSSE) {
            termSSE.close();
            console.log(`Closed previous SSE connection for terminal ${termId}`);
        }
        if (!currentTermId) {
            console.error("Cannot connect SSE: termId is null");
            updateStatus('Error: No Term ID', 'error');
            return;
        }

        console.log(`Connecting SSE for terminal output: ${currentTermId}`);
        updateStatus('Connecting Output Stream...', 'disconnected');
        termSSE = new EventSource(`/admin/terminal/${currentTermId}/output`);

        termSSE.onopen = () => {
            console.log(`SSE connection opened for terminal ${currentTermId}`);
            // Status updated by 'connected' event from server
        };

        termSSE.onerror = (err) => {
            console.error(`SSE connection error for terminal ${currentTermId}:`, err);
            updateStatus('Output Stream Error', 'error');
            if (termSSE) termSSE.close();
            termSSE = null;
            // Maybe attempt to reconnect or notify user
        };

        termSSE.addEventListener('connected', (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('SSE connected event:', data);
                updateStatus('Connected', 'connected');
            } catch (e) {
                console.error('Error parsing SSE connected event:', e);
                updateStatus('Connected (parse error)', 'connected');
            }
        });

        termSSE.addEventListener('output', (event) => {
            try {
                const data = JSON.parse(event.data);
                if (term && typeof data === 'string') {
                    term.write(data);
                }
            } catch (e) {
                console.error('Error parsing SSE output event:', e, event.data);
            }
        });

        termSSE.addEventListener('exit', (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log(`Terminal ${currentTermId} exited:`, data);
                updateStatus(`Exited (Code: ${data.exitCode}, Signal: ${data.signal})`, 'disconnected');
                term?.writeln(`\r\n\r\n[Process exited with code ${data.exitCode}]`);
                term?.dispose(); // Dispose xterm instance
                term = null;
                if (termSSE) termSSE.close();
                termSSE = null;
                termId = null; // Reset termId as the session is gone
                // Maybe disable input or show a reconnect button
            } catch (e) {
                console.error('Error parsing SSE exit event:', e, event.data);
                updateStatus('Exited (parse error)', 'disconnected');
            }
        });
    }

    async function startTerminalSession() {
        if (termId) {
            console.log("Terminal session already started:", termId);
            return;
        }
        updateStatus('Starting Session...', 'disconnected');
        try {
            console.log("Requesting new terminal session...");
            const response = await fetch('/admin/terminal/start', { method: 'POST' });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
                throw new Error(`Failed to start terminal: ${response.status} ${response.statusText} - ${errorData.error}`);
            }
            const data = await response.json();
            if (!data.termId) {
                throw new Error("No termId received from server");
            }
            termId = data.termId;
            console.log("Terminal session started successfully, ID:", termId);

            // Initialize xterm.js only after getting termId
            if (!term) {
                term = new Terminal({
                    cursorBlink: true,
                    convertEol: true, // Convert \n to \r\n for PTY
                    theme: { // Basic dark theme
                        background: '#1e1e1e',
                        foreground: '#cccccc',
                        cursor: '#cccccc',
                        selectionBackground: '#555555',
                    }
                });
                fitAddon = new FitAddon.FitAddon();
                term.loadAddon(fitAddon);
                term.open(termElement);

                // Setup input listener
                term.onData(data => {
                    if (termId && termSSE && termSSE.readyState === EventSource.OPEN) {
                        fetch(`/admin/terminal/${termId}/input`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ input: data })
                        }).catch(err => console.error('Error sending input:', err));
                    } else {
                        console.warn("Cannot send input: Terminal ID or SSE connection not available.");
                    }
                });

                 // Initial fit and setup resize listener
                 fitTerminal(); // Initial fit
                 window.addEventListener('resize', () => {
                     clearTimeout(resizeTimeout);
                     resizeTimeout = setTimeout(fitTerminal, 250); // Debounce resize events
                 });

                 // Focus the terminal
                 term.focus();
            }

            // Connect SSE for output
            connectTerminalSSE(termId);

        } catch (error) {
            console.error("Error starting terminal session:", error);
            updateStatus(`Error: ${error.message}`, 'error');
            termId = null; // Reset termId on failure
        }
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (termId) {
            // Send DELETE request - use sendBeacon if possible for reliability on unload
            if (navigator.sendBeacon) {
                 const data = new Blob([JSON.stringify({})], { type: 'application/json' }); // Beacon needs data
                 navigator.sendBeacon(`/admin/terminal/${termId}`, data); // Beacon uses POST implicitly for data
                 console.log(`Sent beacon to kill terminal ${termId}`);
            } else {
                // Fallback for older browsers (less reliable on unload)
                fetch(`/admin/terminal/${termId}`, { method: 'DELETE', keepalive: true }).catch(()=>{});
                 console.log(`Sent DELETE request to kill terminal ${termId}`);
            }
        }
        if (termSSE) {
            termSSE.close();
        }
    });

    // --- Initial Load ---
    startTerminalSession();

});