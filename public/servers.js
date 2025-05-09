// --- DOM Elements (Assumed to be globally accessible or passed) ---
const serverListDiv = document.getElementById('server-list');
const saveConfigButton = document.getElementById('save-config-button');
// const saveStatus = document.getElementById('save-status'); // Declared in script.js
// Note: Assumes elements like add-stdio-server-button, add-sse-server-button are handled in script.js.
// Note: Assumes triggerReload, currentServerConfig, connectAdminSSE, appendToInstallOutput, getInstallOutputElement, effectiveToolsFolder are globally accessible from script.js

// --- Server Configuration Management ---
async function loadServerConfig() {
    const localSaveStatus = document.getElementById('save-status');
    if (!localSaveStatus || !serverListDiv) return; 
    localSaveStatus.textContent = 'Loading server configuration...';
    try {
        const response = await fetch('/admin/config');
        if (!response.ok) throw new Error(`Failed to fetch server config: ${response.statusText}`);
        window.currentServerConfig = await response.json(); 
        renderServerConfig(window.currentServerConfig);
        addInstallButtonListeners(); 
        localSaveStatus.textContent = 'Server configuration loaded.';
        setTimeout(() => { if(localSaveStatus) localSaveStatus.textContent = ''; }, 3000);
    } catch (error) {
        console.error("Error loading server config:", error);
        if(localSaveStatus) localSaveStatus.textContent = `Error loading server configuration: ${error.message}`;
        if(serverListDiv) serverListDiv.innerHTML = '<p class="error-message">Could not load server configuration.</p>';
    }
}

function renderServerConfig(config) {
    if (!serverListDiv) return; 
    serverListDiv.innerHTML = '';
    if (!config || typeof config !== 'object' || !config.mcpServers) {
         serverListDiv.innerHTML = '<p class="error-message">Invalid server configuration format received.</p>';
         return;
    }
    const servers = config.mcpServers;
    Object.keys(servers).sort().forEach(key => {
         renderServerEntry(key, servers[key]);
    });
     addInstallButtonListeners();
}

function renderServerEntry(key, serverConf, startExpanded = false) {
    if (!serverListDiv) return; 
    const entryDiv = document.createElement('div');
    entryDiv.classList.add('server-entry');
    if (!startExpanded) {
        entryDiv.classList.add('collapsed');
    }
    entryDiv.dataset.serverKey = key; 

    const isSSE = serverConf && typeof serverConf.url === 'string';
    const isStdio = serverConf && typeof serverConf.command === 'string';
    const type = isSSE ? 'SSE' : (isStdio ? 'Stdio' : 'Unknown');

    const headerDiv = document.createElement('div');
    headerDiv.classList.add('server-header');
    headerDiv.innerHTML = `
        <h3>${serverConf.name || key} (<span class="server-type">${type}</span>)</h3>
        <button class="delete-button">Delete</button>
    `;
    entryDiv.appendChild(headerDiv);

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

    let initialDefaultInstallDirForThisKey = ''; // For Stdio key-dir联动

    if (isSSE) {
        detailsHtml += `
            <div><label>URL:</label><input type="url" class="server-url-input" value="${serverConf.url || ''}" required></div>
            <div><label>API Key (X-Api-Key Header):</label><input type="text" class="server-apikey-input" value="${serverConf.apiKey || ''}"></div>
            <div><label>Bearer Token (Authorization Header):</label><input type="text" class="server-bearertoken-input" value="${serverConf.bearerToken || ''}"></div>
        `;
    } else if (isStdio) {
        const baseInstallPath = (typeof window.effectiveToolsFolder === 'string' && window.effectiveToolsFolder.trim() !== '') ? window.effectiveToolsFolder.trim() : 'tools';
        initialDefaultInstallDirForThisKey = `${baseInstallPath}/${key}`;
        const installDirValue = serverConf.installDirectory !== undefined ? serverConf.installDirectory : initialDefaultInstallDirForThisKey;
        
        detailsHtml += `
            <div><label>Command:</label><input type="text" class="server-command-input" value="${serverConf.command || ''}" required></div>
            <div><label>Arguments (comma-separated):</label><input type="text" class="server-args-input" value="${(serverConf.args || []).join(', ')}"></div>
            <div>
                <label>Environment Variables:</label>
                <div class="env-vars-container"></div>
                <button type="button" class="add-env-var-button">+ Add Variable</button>
            </div>
            <hr style="margin: 10px 0;">
            <div><label>Install Directory (optional):</label><input type="text" class="server-install-dir-input" value="${installDirValue}"></div>
            <div><label>Install Commands (optional, one per line):</label><textarea class="server-install-cmds-input">${(serverConf.installCommands || []).join('\n')}</textarea></div>
            <button class="install-button" data-server-key="${key}" ${!installDirValue.trim() ? 'disabled title="Install directory must be set to enable install button"' : ''}>Check/Run Install</button>
            <div class="install-output" id="install-output-${key}" style="display: none; white-space: pre-wrap; background-color: #222; color: #eee; padding: 10px; margin-top: 10px; max-height: 300px; overflow-y: auto; font-family: monospace;"></div>
        `;
    } else {
         detailsHtml += `<p class="error-message">Warning: Unknown server type configuration.</p>`;
    }

    detailsDiv.innerHTML = detailsHtml;
    entryDiv.appendChild(detailsDiv);

    const envVarsContainer = detailsDiv.querySelector('.env-vars-container');
    if (envVarsContainer && serverConf.env && typeof serverConf.env === 'object') {
        Object.entries(serverConf.env).forEach(([envKey, envValue]) => {
            addEnvVarRow(envVarsContainer, envKey, String(envValue));
        });
    }

    const addEnvVarButton = detailsDiv.querySelector('.add-env-var-button');
    if (addEnvVarButton) {
        addEnvVarButton.addEventListener('click', () => addEnvVarRow(envVarsContainer));
    }

    headerDiv.querySelector('h3').addEventListener('click', () => entryDiv.classList.toggle('collapsed'));
    headerDiv.querySelector('h3').style.cursor = 'pointer';

    headerDiv.querySelector('.delete-button').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete server "${serverConf.name || key}"?`)) {
            entryDiv.remove();
        }
    });

    const installButton = detailsDiv.querySelector('.install-button');
    if (installButton) {
        const installDirInputForButton = detailsDiv.querySelector('.server-install-dir-input');
        if (installDirInputForButton) {
             installDirInputForButton.addEventListener('input', () => {
                 const hasDir = !!installDirInputForButton.value.trim();
                 installButton.disabled = !hasDir;
                 installButton.title = installButton.disabled ? 'Install directory must be set to enable install button' : '';
             });
        }
    }

    const keyInput = detailsDiv.querySelector('.server-key-input');
    const installDirInput = detailsDiv.querySelector('.server-install-dir-input');
    if (isStdio && keyInput && installDirInput) {
        keyInput.addEventListener('input', () => {
            const currentKey = keyInput.value.trim();
            const currentInstallDir = installDirInput.value.trim();
            
            // Update if install dir is empty OR if it was the initial default for the *original* key
            if (currentKey && (!currentInstallDir || currentInstallDir === initialDefaultInstallDirForThisKey)) {
                const currentBaseInstallPath = (typeof window.effectiveToolsFolder === 'string' && window.effectiveToolsFolder.trim() !== '') ? window.effectiveToolsFolder.trim() : 'tools';
                const newDynamicDefaultInstallDir = `${currentBaseInstallPath}/${currentKey}`;
                installDirInput.value = newDynamicDefaultInstallDir;
                if (installButton) {
                     installButton.disabled = !newDynamicDefaultInstallDir.trim();
                     installButton.title = installButton.disabled ? 'Install directory must be set to enable install button' : '';
               }
           }
        });
    }

    serverListDiv.appendChild(entryDiv);
}

function addInstallButtonListeners() {
    document.querySelectorAll('.install-button').forEach(button => {
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        newButton.addEventListener('click', () => {
            const serverKey = newButton.dataset.serverKey;
            if (serverKey && typeof window.handleInstallClick === 'function') {
                window.handleInstallClick(serverKey);
            } else if (!serverKey) {
                console.error("Install button clicked but serverKey is missing.");
            } else {
                console.error("handleInstallClick function not found on window.");
            }
        });
    });
}

function addEnvVarRow(container, key = '', value = '') {
    if (!container) return;
    const rowDiv = document.createElement('div');
    rowDiv.classList.add('env-var-row');
    rowDiv.innerHTML = `
        <input type="text" class="env-key-input" placeholder="Key" value="${key}">
        <span>=</span>
        <input type="text" class="env-value-input" placeholder="Value" value="${value}">
        <button type="button" class="delete-env-var-button">X</button>
    `;
    rowDiv.querySelector('.delete-env-var-button').addEventListener('click', () => rowDiv.remove());
    container.appendChild(rowDiv);
}

// handleInstallClick is now expected to be on window from script.js


function initializeServerSaveListener() {
    const localSaveConfigButton = document.getElementById('save-config-button');
    const localServerListDiv = document.getElementById('server-list');
    const localSaveStatus = document.getElementById('save-status');

    if (!localSaveConfigButton || !localServerListDiv || !localSaveStatus) {
        console.error("Save listener setup failed: Missing crucial DOM elements for servers section.");
        return;
    }

    localSaveConfigButton.addEventListener('click', async () => {
        localSaveStatus.textContent = 'Saving server configuration...';
        localSaveStatus.style.color = 'orange';
        const newConfig = { mcpServers: {} };
        const entries = localServerListDiv.querySelectorAll('.server-entry');
        let isValid = true;
        let errorMsg = '';

        entries.forEach(entryDiv => {
            if (!isValid) return;

            const newKeyInput = entryDiv.querySelector('.server-key-input');
            const newKey = newKeyInput.value.trim();

            if (!newKey) {
                isValid = false; errorMsg = 'Server Key cannot be empty.'; newKeyInput.style.border = '1px solid red'; return;
            } else { newKeyInput.style.border = ''; }

            if (newConfig.mcpServers.hasOwnProperty(newKey)) {
                 isValid = false; errorMsg = `Duplicate Server Key: "${newKey}".`; newKeyInput.style.border = '1px solid red'; return;
            }

            const nameInput = entryDiv.querySelector('.server-name-input');
            const activeInput = entryDiv.querySelector('.server-active-input');
            const urlInput = entryDiv.querySelector('.server-url-input');
            const apiKeyInput = entryDiv.querySelector('.server-apikey-input');
            const bearerTokenInput = entryDiv.querySelector('.server-bearertoken-input');
            const commandInput = entryDiv.querySelector('.server-command-input');
            const argsInput = entryDiv.querySelector('.server-args-input');
            const envVarsContainer = entryDiv.querySelector('.env-vars-container');
            const installDirInput = entryDiv.querySelector('.server-install-dir-input');
            const installCmdsInput = entryDiv.querySelector('.server-install-cmds-input');

            const serverData = {
                name: nameInput.value.trim() || undefined,
                active: activeInput.checked
            };

            if (urlInput) { // SSE Server
                serverData.url = urlInput.value.trim();
                if (!serverData.url) { isValid = false; errorMsg = `URL required for SSE server "${newKey}".`; urlInput.style.border = '1px solid red'; }
                else { urlInput.style.border = ''; }
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
                serverData.env = {};
                if (envVarsContainer) {
                    envVarsContainer.querySelectorAll('.env-var-row').forEach(row => {
                        const key = row.querySelector('.env-key-input').value.trim();
                        const value = row.querySelector('.env-value-input').value;
                        if (key) {
                            if (serverData.env.hasOwnProperty(key)) {
                                isValid = false; errorMsg = `Duplicate env key "${key}" for server "${newKey}".`;
                                row.querySelector('.env-key-input').style.border = '1px solid red';
                            } else { serverData.env[key] = value; row.querySelector('.env-key-input').style.border = '';}
                        } else if (value) {
                             isValid = false; errorMsg = `Env key cannot be empty if value is set for server "${newKey}".`;
                             row.querySelector('.env-key-input').style.border = '1px solid red';
                        }
                    });
                }
                if (!isValid) return;
                if (installDirInput && installCmdsInput) {
                    const installDir = installDirInput.value.trim();
                    const installCmds = installCmdsInput.value.trim().split('\n').map(cmd => cmd.trim()).filter(cmd => cmd);
                    if (installDir) {
                         serverData.installDirectory = installDir;
                         serverData.installCommands = installCmds;
                    } else if (installCmds.length > 0) {
                         isValid = false; errorMsg = `Install Directory required if Install Commands provided for "${newKey}".`;
                         installDirInput.style.border = '1px solid red';
                    }
                }
            } else {
                 isValid = false; errorMsg = `Server "${newKey}" needs URL (SSE) or Command (Stdio).`;
                 entryDiv.querySelector('.server-header').style.border = '1px solid red';
            }
            if (isValid) {
                 newConfig.mcpServers[newKey] = serverData;
                 const header = entryDiv.querySelector('.server-header');
                 if(header) header.style.border = '';
            }
        });

        if (!isValid) {
            localSaveStatus.textContent = `Error: ${errorMsg}`;
            localSaveStatus.style.color = 'red';
            setTimeout(() => { if(localSaveStatus) localSaveStatus.textContent = ''; localSaveStatus.style.color = 'green'; }, 5000);
            return;
        }

        try {
            const response = await fetch('/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                localSaveStatus.textContent = 'Server configuration saved successfully.';
                localSaveStatus.style.color = 'green';
                window.currentServerConfig = newConfig;
                renderServerConfig(window.currentServerConfig); 
                if (typeof window.triggerReload === 'function') {
                    await window.triggerReload(localSaveStatus);
                } else {
                     console.error("triggerReload function not found.");
                     localSaveStatus.textContent += ' Reload trigger function not found!';
                     localSaveStatus.style.color = 'red';
                     setTimeout(() => { if(localSaveStatus) localSaveStatus.textContent = ''; localSaveStatus.style.color = 'green'; }, 7000);
                }
            } else {
                localSaveStatus.textContent = `Error saving: ${result.error || response.statusText}`;
                localSaveStatus.style.color = 'red';
                 setTimeout(() => { if(localSaveStatus) localSaveStatus.textContent = ''; localSaveStatus.style.color = 'green'; }, 5000);
            }
        } catch (error) {
            localSaveStatus.textContent = `Network error saving: ${error.message}`;
            localSaveStatus.style.color = 'red';
             setTimeout(() => { if(localSaveStatus) localSaveStatus.textContent = ''; localSaveStatus.style.color = 'green'; }, 5000);
        }
    });
}

// Expose functions to be called from script.js
window.loadServerConfig = loadServerConfig;
window.renderServerEntry = renderServerEntry;
window.addInstallButtonListeners = addInstallButtonListeners;
// addEnvVarRow is locally used by renderServerEntry
window.initializeServerSaveListener = initializeServerSaveListener;

console.log("servers.js loaded");