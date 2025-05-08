// --- DOM Elements (Assumed to be globally accessible or passed) ---
const serverListDiv = document.getElementById('server-list');
const saveConfigButton = document.getElementById('save-config-button');
// const saveStatus = document.getElementById('save-status'); // Removed: Declared in script.js
// Note: Assumes elements like add-stdio-server-button, add-sse-server-button are handled elsewhere or passed if needed.
// Note: Assumes triggerReload function is globally accessible from script.js or passed.
// Note: Assumes currentServerConfig variable is globally accessible from script.js or passed.
// Note: Assumes connectAdminSSE, appendToInstallOutput functions are globally accessible from script.js

// --- Server Configuration Management ---
async function loadServerConfig() {
    if (!saveStatus || !serverListDiv) return; // Guard
    saveStatus.textContent = 'Loading server configuration...';
    try {
        const response = await fetch('/admin/config');
        if (!response.ok) throw new Error(`Failed to fetch server config: ${response.statusText}`);
        // Assume currentServerConfig is updated in the main script's scope
        window.currentServerConfig = await response.json(); // Use window scope for simplicity, or pass/return value
        renderServerConfig(window.currentServerConfig);
        addInstallButtonListeners(); // Re-attach listeners after rendering
        saveStatus.textContent = 'Server configuration loaded.';
        setTimeout(() => saveStatus.textContent = '', 3000);
    } catch (error) {
        console.error("Error loading server config:", error);
        saveStatus.textContent = `Error loading server configuration: ${error.message}`;
        serverListDiv.innerHTML = '<p class="error-message">Could not load server configuration.</p>';
    }
}

function renderServerConfig(config) {
    if (!serverListDiv) return; // Guard
    serverListDiv.innerHTML = '';
    if (!config || typeof config !== 'object' || !config.mcpServers) {
         serverListDiv.innerHTML = '<p class="error-message">Invalid server configuration format received.</p>';
         return;
    }
    const servers = config.mcpServers;
    // Sort servers by key for consistent order
    Object.keys(servers).sort().forEach(key => {
         renderServerEntry(key, servers[key]);
    });
     // Add install button listeners after all entries are rendered
     addInstallButtonListeners();
}

function renderServerEntry(key, serverConf, startExpanded = false) {
    if (!serverListDiv) return; // Guard
    const entryDiv = document.createElement('div');
    entryDiv.classList.add('server-entry');
    if (!startExpanded) {
        entryDiv.classList.add('collapsed');
    }
    entryDiv.dataset.serverKey = key; // Store the key

    // Determine type based on presence of 'url' or 'command'
    const isSSE = serverConf && typeof serverConf.url === 'string';
    const isStdio = serverConf && typeof serverConf.command === 'string';
    const type = isSSE ? 'SSE' : (isStdio ? 'Stdio' : 'Unknown');

    // Header part (always visible)
    const headerDiv = document.createElement('div');
    headerDiv.classList.add('server-header');
    headerDiv.innerHTML = `
        <h3>${serverConf.name || key} (<span class="server-type">${type}</span>)</h3>
        <button class="delete-button">Delete</button>
    `;
    entryDiv.appendChild(headerDiv);

    // Details part (collapsible)
    const detailsDiv = document.createElement('div');
    detailsDiv.classList.add('server-details');

    let detailsHtml = `
        <div><label>Server Key (Unique ID):</label><input type="text" class="server-key-input" value="${key}" required></div>
        <div><label>Display Name:</label><input type="text" class="server-name-input" value="${serverConf.name || ''}"></div>
        <div>
            <label class="inline-label">
                <input type="checkbox" class="server-active-input" ${serverConf.active !== false ? 'checked' : ''}>
                Active
            </label>
        </div>
    `;

    // Type-specific fields
    if (isSSE) {
        detailsHtml += `
            <div><label>URL:</label><input type="url" class="server-url-input" value="${serverConf.url || ''}" required></div>
            <div><label>API Key (X-Api-Key Header):</label><input type="text" class="server-apikey-input" value="${serverConf.apiKey || ''}"></div>
            <div><label>Bearer Token (Authorization Header):</label><input type="text" class="server-bearertoken-input" value="${serverConf.bearerToken || ''}"></div>
        `;
    } else if (isStdio) {
        // Default install dir based on key if not provided
        const defaultInstallDir = `/tools/${key}`;
        const installDirValue = serverConf.installDirectory !== undefined ? serverConf.installDirectory : defaultInstallDir;
        detailsHtml += `
            <div><label>Command:</label><input type="text" class="server-command-input" value="${serverConf.command || ''}" required></div>
            <div><label>Arguments (comma-separated):</label><input type="text" class="server-args-input" value="${(serverConf.args || []).join(', ')}"></div>
            <div>
                <label>Environment Variables:</label>
                <div class="env-vars-container">
                    <!-- Env vars will be added here -->
                </div>
                <button type="button" class="add-env-var-button">+ Add Variable</button>
            </div>
            <hr style="margin: 10px 0;">
            <div><label>Install Directory (optional, absolute path):</label><input type="text" class="server-install-dir-input" value="${installDirValue}"></div>
            <div><label>Install Commands (optional, one per line):</label><textarea class="server-install-cmds-input">${(serverConf.installCommands || []).join('\n')}</textarea></div>
            <button class="install-button" data-server-key="${key}" ${!installDirValue ? 'disabled title="Install directory must be set to enable install button (commands optional)"' : ''}>Check/Run Install</button>
            <div class="install-output" id="install-output-${key}" style="display: none; white-space: pre-wrap; background-color: #222; color: #eee; padding: 10px; margin-top: 10px; max-height: 300px; overflow-y: auto; font-family: monospace;"></div> <!-- Added output area -->
        `;
    } else {
         detailsHtml += `<p class="error-message">Warning: Unknown server type configuration.</p>`;
    }

    detailsDiv.innerHTML = detailsHtml;
    entryDiv.appendChild(detailsDiv);

    // --- Event Listeners ---

    // Render initial Env Vars for Stdio
    const envVarsContainer = detailsDiv.querySelector('.env-vars-container');
    if (envVarsContainer && serverConf.env && typeof serverConf.env === 'object') {
        Object.entries(serverConf.env).forEach(([envKey, envValue]) => {
            addEnvVarRow(envVarsContainer, envKey, envValue);
        });
    }

    // Add Env Var button listener
    const addEnvVarButton = detailsDiv.querySelector('.add-env-var-button');
    if (addEnvVarButton) {
        addEnvVarButton.addEventListener('click', () => {
            addEnvVarRow(envVarsContainer); // Add empty row
        });
    }

    // Toggle collapse/expand
    headerDiv.querySelector('h3').addEventListener('click', () => {
        entryDiv.classList.toggle('collapsed');
    });
    headerDiv.querySelector('h3').style.cursor = 'pointer'; // Indicate clickable header

    // Delete button
    headerDiv.querySelector('.delete-button').addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent toggle when clicking delete
        if (confirm(`Are you sure you want to delete server "${serverConf.name || key}"?`)) {
            entryDiv.remove();
        }
    });

    // Install button listener is added globally after rendering all entries

    // Enable/disable install button based on install dir presence initially and on input
    const installButton = detailsDiv.querySelector('.install-button');
    if (installButton) {
        const installDirInput = detailsDiv.querySelector('.server-install-dir-input');
        if (installDirInput) {
             installDirInput.addEventListener('input', () => {
                 const hasDir = !!installDirInput.value.trim();
                 installButton.disabled = !hasDir;
                 installButton.title = installButton.disabled ? 'Install directory must be set to enable install button' : '';
             });
        }
    }

    // Server Key -> Install Directory Sync (for Stdio)
    const keyInput = detailsDiv.querySelector('.server-key-input');
    const installDirInput = detailsDiv.querySelector('.server-install-dir-input');
    if (keyInput && installDirInput) { // Only if both exist (Stdio)
        keyInput.addEventListener('input', () => {
            const currentKey = keyInput.value.trim();
            const currentInstallDir = installDirInput.value.trim();
            const oldDefaultPattern = /^\/tools\/.*$/; // Matches /tools/<anything>

            // Update only if install dir is empty or matches the default pattern for *some* key
            if (currentKey && (!currentInstallDir || oldDefaultPattern.test(currentInstallDir))) {
                const newDefaultInstallDir = `/tools/${currentKey}`;
                installDirInput.value = newDefaultInstallDir;
                // Also update install button state if needed
                if (installButton) {
                     installButton.disabled = !newDefaultInstallDir;
                     installButton.title = installButton.disabled ? 'Install directory must be set to enable install button' : '';
               }
           }
        });
    }

    serverListDiv.appendChild(entryDiv);
}

// Add install button listeners after all entries are rendered
function addInstallButtonListeners() {
    document.querySelectorAll('.install-button').forEach(button => {
        // Remove existing listener to prevent duplicates if re-rendered
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        // Add new listener
        newButton.addEventListener('click', () => {
            const serverKey = newButton.dataset.serverKey;
            if (serverKey) {
                handleInstallClick(serverKey); // Assumes handleInstallClick is global
            }
        });
    });
}

// --- Helper function to add an environment variable row ---
function addEnvVarRow(container, key = '', value = '') {
    if (!container) return; // Guard against null container
    const rowDiv = document.createElement('div');
    rowDiv.classList.add('env-var-row');
    rowDiv.innerHTML = `
        <input type="text" class="env-key-input" placeholder="Key" value="${key}">
        <span>=</span>
        <input type="text" class="env-value-input" placeholder="Value" value="${value}">
        <button type="button" class="delete-env-var-button">X</button>
    `;
    // Add listener to the delete button for this specific row
    rowDiv.querySelector('.delete-env-var-button').addEventListener('click', () => {
        rowDiv.remove();
    });
    container.appendChild(rowDiv);
}

// --- Tool Installation Handling ---
async function handleInstallClick(serverKey) {
    const installButton = document.querySelector(`.install-button[data-server-key="${serverKey}"]`);
    // Assumes getInstallOutputElement is global or defined here
    const outputElement = window.getInstallOutputElement ? window.getInstallOutputElement(serverKey) : document.getElementById(`install-output-${serverKey}`);

    if (!outputElement || !installButton) {
        console.error(`Could not find install button or output area for ${serverKey}`);
        return;
    }

    // Ensure SSE connection is ready before starting install
    // Assumes adminEventSource and connectAdminSSE are global
    if (!window.adminEventSource || window.adminEventSource.readyState !== EventSource.OPEN) {
         console.log("Admin SSE not connected, attempting to connect before install...");
         if (typeof window.connectAdminSSE === 'function') {
            window.connectAdminSSE(); // Attempt connection
         } else {
             console.error("connectAdminSSE function not found.");
             appendToInstallOutput(serverKey, "Error: Cannot establish connection for live updates.\n", true);
             return;
         }
    }


    outputElement.innerHTML = ''; // Clear previous output
    outputElement.style.display = 'block'; // Show output area
    // Assumes appendToInstallOutput is global
    window.appendToInstallOutput(serverKey, `Starting installation check for ${serverKey}...\n`);
    installButton.disabled = true;
    installButton.textContent = 'Installing...';

    try {
        const response = await fetch(`/admin/server/install/${serverKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add authentication headers if needed
            },
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            const errorMsg = `Error starting installation process: ${result.error || response.statusText}\n`;
            window.appendToInstallOutput(serverKey, errorMsg, true);
            installButton.disabled = false; // Re-enable on initial failure
            installButton.textContent = 'Install Failed';
            return;
        }
        // Backend confirmed start, now wait for SSE events for detailed status
        window.appendToInstallOutput(serverKey, `Installation process initiated. Waiting for live output via SSE...\n`);
        // Button state will be updated by SSE 'install_complete' or 'install_error' events

    } catch (error) {
        console.error(`Error initiating installation for ${serverKey}:`, error);
        const errorMsg = `Network error initiating installation: ${error.message}\n`;
        window.appendToInstallOutput(serverKey, errorMsg, true);
        installButton.disabled = false; // Re-enable on network failure
        installButton.textContent = 'Install Failed';
    }
}


// --- Save Button Listener ---
function initializeServerSaveListener() {
    if (!saveConfigButton || !serverListDiv || !saveStatus) return; // Guard

    saveConfigButton.addEventListener('click', async () => {
        saveStatus.textContent = 'Saving server configuration...';
        saveStatus.style.color = 'orange';
        const newConfig = { mcpServers: {} };
        const entries = serverListDiv.querySelectorAll('.server-entry');
        let isValid = true;
        let errorMsg = '';

        entries.forEach(entryDiv => {
            if (!isValid) return; // Stop processing if already invalid

            const originalKey = entryDiv.dataset.serverKey; // Use original key for context if needed
            const newKeyInput = entryDiv.querySelector('.server-key-input');
            const newKey = newKeyInput.value.trim();

            if (!newKey) {
                isValid = false; errorMsg = 'Server Key cannot be empty.'; newKeyInput.style.border = '1px solid red'; return;
            } else { newKeyInput.style.border = ''; }

            // Check for duplicate key *before* trying to access newConfig.mcpServers[newKey]
            if (newConfig.mcpServers.hasOwnProperty(newKey)) {
                 isValid = false; errorMsg = `Duplicate Server Key: "${newKey}".`; newKeyInput.style.border = '1px solid red'; return;
            }


            const nameInput = entryDiv.querySelector('.server-name-input');
            const activeInput = entryDiv.querySelector('.server-active-input');
            const urlInput = entryDiv.querySelector('.server-url-input'); // SSE specific
            const apiKeyInput = entryDiv.querySelector('.server-apikey-input'); // SSE specific
            const bearerTokenInput = entryDiv.querySelector('.server-bearertoken-input'); // SSE specific
            const commandInput = entryDiv.querySelector('.server-command-input'); // Stdio specific
            const argsInput = entryDiv.querySelector('.server-args-input'); // Stdio specific
            const envVarsContainer = entryDiv.querySelector('.env-vars-container'); // Stdio specific - NEW
            const installDirInput = entryDiv.querySelector('.server-install-dir-input'); // Stdio specific
            const installCmdsInput = entryDiv.querySelector('.server-install-cmds-input'); // Stdio specific

            const serverData = { // Define a proper type if needed later
                name: nameInput.value.trim() || undefined, // Use undefined if empty for cleaner JSON
                active: activeInput.checked
            };

            // Determine type based on which fields are present in the form
            if (urlInput) { // SSE Server
                serverData.url = urlInput.value.trim();
                if (!serverData.url) { isValid = false; errorMsg = `URL required for SSE server "${newKey}".`; urlInput.style.border = '1px solid red'; }
                else { urlInput.style.border = ''; }

                // Add optional SSE auth fields if they have values
                const apiKey = apiKeyInput.value.trim();
                const bearerToken = bearerTokenInput.value.trim();
                if (apiKey) serverData.apiKey = apiKey;
                if (bearerToken) serverData.bearerToken = bearerToken;

            } else if (commandInput) { // Stdio Server
                serverData.command = commandInput.value.trim();
                if (!serverData.command) { isValid = false; errorMsg = `Command required for Stdio server "${newKey}".`; commandInput.style.border = '1px solid red'; }
                else { commandInput.style.border = ''; }

                const argsString = argsInput.value.trim();
                serverData.args = argsString ? argsString.split(',').map(arg => arg.trim()).filter(arg => arg) : [];

                // Collect Env Vars from dynamic rows
                serverData.env = {};
                if (envVarsContainer) {
                    const rows = envVarsContainer.querySelectorAll('.env-var-row');
                    rows.forEach(row => {
                        const keyInput = row.querySelector('.env-key-input');
                        const valueInput = row.querySelector('.env-value-input');
                        const key = keyInput.value.trim();
                        const value = valueInput.value; // Keep value as is (don't trim)
                        if (key) { // Only add if key is not empty
                            if (serverData.env.hasOwnProperty(key)) {
                                isValid = false;
                                errorMsg = `Duplicate environment variable key "${key}" for server "${newKey}".`;
                                keyInput.style.border = '1px solid red';
                                valueInput.style.border = '1px solid red';
                            } else {
                                serverData.env[key] = value;
                                keyInput.style.border = ''; // Reset border on valid
                                valueInput.style.border = '';
                            }
                        } else if (value) {
                            // Key is empty but value is not - treat as error
                             isValid = false; errorMsg = `Environment variable key cannot be empty if value is set for server "${newKey}".`;
                             keyInput.style.border = '1px solid red';
                        } else {
                             keyInput.style.border = ''; // Reset border if both empty
                             valueInput.style.border = '';
                        }
                    });
                }
                 if (!isValid) return; // Stop if duplicate env key found


                if (installDirInput && installCmdsInput) {
                    const installDir = installDirInput.value.trim();
                    const installCmds = installCmdsInput.value.trim().split('\n').map(cmd => cmd.trim()).filter(cmd => cmd);
                    // Store install config only if directory is set
                    if (installDir) {
                         serverData.installDirectory = installDir;
                         serverData.installCommands = installCmds; // Store empty array if no commands
                    } else if (installCmds.length > 0) {
                         // If commands exist but dir doesn't, it's an incomplete config - treat as error
                         isValid = false; errorMsg = `Install Directory is required if Install Commands are provided for server "${newKey}".`;
                         installDirInput.style.border = '1px solid red';
                    }
                }
            } else {
                 // Neither URL nor Command found - invalid state
                 isValid = false; errorMsg = `Server "${newKey}" must have either a URL (for SSE) or a Command (for Stdio).`;
                 // Highlight the entry somehow? Maybe the header?
                 entryDiv.querySelector('.server-header').style.border = '1px solid red';
            }

            if (isValid) {
                 newConfig.mcpServers[newKey] = serverData;
                 // Reset potential error highlight on header
                 const header = entryDiv.querySelector('.server-header');
                 if(header) header.style.border = '';
            }
        });

        if (!isValid) {
            saveStatus.textContent = `Error: ${errorMsg}`;
            saveStatus.style.color = 'red';
            setTimeout(() => { saveStatus.textContent = ''; saveStatus.style.color = 'green'; }, 5000);
            return;
        }

        // Proceed to save if valid
        try {
            const response = await fetch('/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                saveStatus.textContent = 'Server configuration saved successfully.';
                saveStatus.style.color = 'green';
                window.currentServerConfig = newConfig; // Update global state
                // Re-render to reflect potential key changes and clean up UI state
                renderServerConfig(window.currentServerConfig);
                // Trigger reload after successful save (assumes triggerReload is global)
                if (typeof window.triggerReload === 'function') {
                    await window.triggerReload(saveStatus);
                } else {
                     console.error("triggerReload function not found.");
                     saveStatus.textContent += ' Reload trigger function not found!';
                     saveStatus.style.color = 'red';
                     setTimeout(() => { saveStatus.textContent = ''; saveStatus.style.color = 'green'; }, 7000);
                }
            } else {
                saveStatus.textContent = `Error saving server configuration: ${result.error || response.statusText}`;
                saveStatus.style.color = 'red';
                 setTimeout(() => { saveStatus.textContent = ''; saveStatus.style.color = 'green'; }, 5000);
            }
        } catch (error) {
            console.error("Error saving server config:", error);
            saveStatus.textContent = `Network error saving server configuration: ${error.message}`;
            saveStatus.style.color = 'red';
             setTimeout(() => { saveStatus.textContent = ''; saveStatus.style.color = 'green'; }, 5000);
        }
    });
}

// Expose functions needed by other modules or main script
window.loadServerConfig = loadServerConfig;
window.renderServerConfig = renderServerConfig; // Might not be needed globally if only called by loadServerConfig
window.renderServerEntry = renderServerEntry; // Needed by add server buttons in main script
window.addInstallButtonListeners = addInstallButtonListeners; // Needed after rendering
window.handleInstallClick = handleInstallClick; // Needed by install buttons
window.addEnvVarRow = addEnvVarRow; // Needed by renderServerEntry
window.initializeServerSaveListener = initializeServerSaveListener; // To be called from main script

console.log("servers.js loaded");