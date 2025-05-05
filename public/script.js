document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const loginSection = document.getElementById('login-section');
    const mainContent = document.getElementById('main-content'); // Main area containing sections
    const mainNav = document.getElementById('main-nav');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');

    // Nav Buttons
    const navServersButton = document.getElementById('nav-servers');
    const navToolsButton = document.getElementById('nav-tools');
    const logoutButton = document.getElementById('logout-button'); // Now in nav

    // Server Section Elements
    const serversSection = document.getElementById('servers-section');
    const serverListDiv = document.getElementById('server-list');
    const addServerButton = document.getElementById('add-server-button');
    const saveConfigButton = document.getElementById('save-config-button');
    const saveStatus = document.getElementById('save-status');

    // Tool Section Elements
    const toolsSection = document.getElementById('tools-section');
    const toolListDiv = document.getElementById('tool-list');
    const saveToolConfigButton = document.getElementById('save-tool-config-button');
    const saveToolStatus = document.getElementById('save-tool-status');

    // --- State Variables ---
    let currentServerConfig = {}; // Holds loaded mcp_server.json
    let currentToolConfig = {};   // Holds loaded tool_config.json { tools: {...} }
    let discoveredTools = [];     // Holds list of all tools from /admin/tools/list
    let toolDataLoaded = false;   // Flag to prevent redundant tool data loading

    // --- Navigation ---
    const showSection = (sectionId) => {
        // Hide all admin sections
        document.querySelectorAll('.admin-section').forEach(section => {
            section.style.display = 'none';
        });
        // Show the target section
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.style.display = 'block';
        }
        // Update nav button active state
        document.querySelectorAll('.nav-button').forEach(button => {
            button.classList.remove('active');
        });
        const activeButton = document.getElementById(`nav-${sectionId.split('-')[0]}`); // e.g., nav-servers
        if (activeButton) {
            activeButton.classList.add('active');
        }
    };

    navServersButton.addEventListener('click', () => {
        showSection('servers-section');
        // Server config is loaded on login, no need to reload here unless desired
    });

    navToolsButton.addEventListener('click', () => {
        showSection('tools-section');
        // Load tool data only if it hasn't been loaded yet
        if (!toolDataLoaded) {
            loadToolData();
        }
    });

    // --- Authentication ---
    const checkLoginStatus = async () => {
        try {
            const response = await fetch('/admin/config'); // Check if logged in
            if (response.ok) {
                handleLoginSuccess();
            } else {
                handleLogoutSuccess(); // Show login if not authorized
            }
        } catch (error) {
            console.error("Error checking login status:", error);
            handleLogoutSuccess(); // Assume not logged in if check fails
        }
    };

    const handleLoginSuccess = () => {
        loginSection.style.display = 'none';
        mainNav.style.display = 'flex'; // Show navigation
        mainContent.style.display = 'block'; // Ensure main content area is visible
        showSection('servers-section'); // Show servers section by default
        loadServerConfig(); // Load initial server config
        toolDataLoaded = false; // Reset tool loaded flag
        loginError.textContent = '';
    };

    const handleLogoutSuccess = () => {
        loginSection.style.display = 'block';
        mainNav.style.display = 'none'; // Hide navigation
        // Hide all admin sections
        document.querySelectorAll('.admin-section').forEach(section => {
            section.style.display = 'none';
        });
        serverListDiv.innerHTML = ''; // Clear server config display
        toolListDiv.innerHTML = ''; // Clear tool config display
        currentServerConfig = {};
        currentToolConfig = {};
        discoveredTools = [];
        loginError.textContent = '';
    };

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const username = loginForm.username.value;
        const password = loginForm.password.value;

        try {
            const response = await fetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const result = await response.json();
            if (response.ok && result.success) {
                handleLoginSuccess();
            } else {
                loginError.textContent = result.error || 'Login failed.';
            }
        } catch (error) {
            console.error("Login error:", error);
            loginError.textContent = 'An error occurred during login.';
        }
    });

    logoutButton.addEventListener('click', async () => {
        try {
            const response = await fetch('/admin/logout', { method: 'POST' });
            if (response.ok) {
                handleLogoutSuccess();
            } else {
                alert('Logout failed.');
            }
        } catch (error) {
            console.error("Logout error:", error);
            alert('An error occurred during logout.');
        }
    });

    // --- Server Configuration Management ---
    const loadServerConfig = async () => {
        saveStatus.textContent = 'Loading server configuration...';
        try {
            const response = await fetch('/admin/config');
            if (!response.ok) throw new Error(`Failed to fetch server config: ${response.statusText}`);
            currentServerConfig = await response.json();
            renderServerConfig(currentServerConfig);
            saveStatus.textContent = 'Server configuration loaded.';
            setTimeout(() => saveStatus.textContent = '', 3000);
        } catch (error) {
            console.error("Error loading server config:", error);
            saveStatus.textContent = `Error loading server configuration: ${error.message}`;
            serverListDiv.innerHTML = '<p class="error-message">Could not load server configuration.</p>';
        }
    };

    const renderServerConfig = (config) => {
        serverListDiv.innerHTML = '';
        if (!config || typeof config !== 'object' || !config.mcpServers) {
             serverListDiv.innerHTML = '<p class="error-message">Invalid server configuration format received.</p>';
             return;
        }
        const servers = config.mcpServers;
        Object.entries(servers).forEach(([key, serverConf]) => {
            renderServerEntry(key, serverConf);
        });
    };

    const renderServerEntry = (key, serverConf) => {
        const entryDiv = document.createElement('div');
        entryDiv.classList.add('server-entry');
        entryDiv.dataset.serverKey = key;

        // Determine type based on presence of 'url' or 'command'
        const isSSE = serverConf && typeof serverConf.url === 'string';
        const isStdio = serverConf && typeof serverConf.command === 'string';
        const type = isSSE ? 'SSE' : (isStdio ? 'Stdio' : 'Unknown'); // Handle potential incomplete data

        // Basic server info (common to both)
        let serverHtml = `
            <h3>${serverConf.name || key} (<span class="server-type">${type}</span>)</h3>
            <button class="delete-button">Delete</button>
            <div><label>Server Key (Unique ID):</label><input type="text" class="server-key-input" value="${key}" required></div>
            <div><label>Display Name:</label><input type="text" class="server-name-input" value="${serverConf.name || ''}"></div>
            <div>
                <label>
                    <input type="checkbox" class="server-active-input" ${serverConf.active !== false ? 'checked' : ''}>
                    Active
                </label>
            </div>
        `;

        // Type-specific fields
        if (isSSE) {
            serverHtml += `
                <div><label>URL:</label><input type="url" class="server-url-input" value="${serverConf.url || ''}" required></div>
                <div><label>API Key (X-Api-Key Header):</label><input type="text" class="server-apikey-input" value="${serverConf.apiKey || ''}"></div>
                <div><label>Bearer Token (Authorization Header):</label><input type="text" class="server-bearertoken-input" value="${serverConf.bearerToken || ''}"></div>
            `;
        } else if (isStdio) {
            serverHtml += `
                <div><label>Command:</label><input type="text" class="server-command-input" value="${serverConf.command || ''}" required></div>
                <div><label>Arguments (comma-separated):</label><input type="text" class="server-args-input" value="${(serverConf.args || []).join(', ')}"></div>
                <div><label>Environment Variables (JSON format):</label><textarea class="server-env-input">${JSON.stringify(serverConf.env || {}, null, 2)}</textarea></div>
                <hr style="margin: 10px 0;">
                <div><label>Install Directory (optional, relative path):</label><input type="text" class="server-install-dir-input" value="${serverConf.installDirectory || ''}"></div>
                <div><label>Install Commands (optional, one per line):</label><textarea class="server-install-cmds-input">${(serverConf.installCommands || []).join('\n')}</textarea></div>
                <button class="install-button" ${!serverConf.installDirectory || !(serverConf.installCommands || []).length ? 'disabled title="Install directory and commands must be set"' : ''}>Check/Run Install</button>
                <span class="install-status" style="margin-left: 10px; font-style: italic;"></span>
            `;
        } else {
             serverHtml += `<p class="error-message">Warning: Unknown server type configuration.</p>`;
        }

        entryDiv.innerHTML = serverHtml;

        // Add event listeners
        entryDiv.querySelector('.delete-button').addEventListener('click', () => {
            if (confirm(`Are you sure you want to delete server "${serverConf.name || key}"?`)) {
                entryDiv.remove();
            }
        });
        const installButton = entryDiv.querySelector('.install-button');
        if (installButton) {
            installButton.addEventListener('click', () => handleInstallClick(key, entryDiv));
        }

        serverListDiv.appendChild(entryDiv);
    };

    // Remove single add button listener
    // addServerButton.addEventListener('click', () => { ... });

    // Add listeners for new buttons (assuming they exist in HTML now)
    document.getElementById('add-stdio-server-button')?.addEventListener('click', () => {
         const newKey = `new_stdio_server_${Date.now()}`;
         const newServerConf = { name: "New Stdio Server", active: true, command: "your_command_here", args: [], env: {} };
         renderServerEntry(newKey, newServerConf);
         serverListDiv.lastChild?.scrollIntoView();
    });
     document.getElementById('add-sse-server-button')?.addEventListener('click', () => {
         const newKey = `new_sse_server_${Date.now()}`;
         const newServerConf = { name: "New SSE Server", active: true, url: "http://localhost:8080/sse" };
         renderServerEntry(newKey, newServerConf);
         serverListDiv.lastChild?.scrollIntoView();
    });


    saveConfigButton.addEventListener('click', async () => {
        saveStatus.textContent = 'Saving server configuration...';
        saveStatus.style.color = 'orange';
        const newConfig = { mcpServers: {} };
        const entries = serverListDiv.querySelectorAll('.server-entry');
        let isValid = true;
        let errorMsg = '';

        entries.forEach(entryDiv => {
            if (!isValid) return; // Stop processing if already invalid

            const originalKey = entryDiv.dataset.serverKey;
            const newKeyInput = entryDiv.querySelector('.server-key-input');
            const newKey = newKeyInput.value.trim();

            if (!newKey) {
                isValid = false; errorMsg = 'Server Key cannot be empty.'; newKeyInput.style.border = '1px solid red'; return;
            } else { newKeyInput.style.border = ''; }

            if (newConfig.mcpServers[newKey]) {
                isValid = false; errorMsg = `Duplicate Server Key: "${newKey}".`; newKeyInput.style.border = '1px solid red'; return;
            }

            const nameInput = entryDiv.querySelector('.server-name-input');
            const activeInput = entryDiv.querySelector('.server-active-input');
            const urlInput = entryDiv.querySelector('.server-url-input'); // SSE specific
            const apiKeyInput = entryDiv.querySelector('.server-apikey-input'); // SSE specific
            const bearerTokenInput = entryDiv.querySelector('.server-bearertoken-input'); // SSE specific
            const commandInput = entryDiv.querySelector('.server-command-input'); // Stdio specific
            const argsInput = entryDiv.querySelector('.server-args-input'); // Stdio specific
            const envInput = entryDiv.querySelector('.server-env-input'); // Stdio specific
            const installDirInput = entryDiv.querySelector('.server-install-dir-input'); // Stdio specific
            const installCmdsInput = entryDiv.querySelector('.server-install-cmds-input'); // Stdio specific

            const serverData = {
                name: nameInput.value.trim() || undefined,
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

                try {
                    const envString = envInput.value.trim();
                    serverData.env = envString ? JSON.parse(envString) : {};
                    if (typeof serverData.env !== 'object' || serverData.env === null || Array.isArray(serverData.env)) throw new Error("Must be JSON object.");
                    envInput.style.border = '';
                } catch (e) { isValid = false; errorMsg = `Invalid JSON in Env Vars for "${newKey}": ${e.message}`; envInput.style.border = '1px solid red'; }

                if (installDirInput && installCmdsInput) {
                    const installDir = installDirInput.value.trim();
                    const installCmds = installCmdsInput.value.trim().split('\n').map(cmd => cmd.trim()).filter(cmd => cmd);
                    if (installDir && installCmds.length > 0) {
                        serverData.installDirectory = installDir;
                        serverData.installCommands = installCmds;
                    } else if (installDir || installCmds.length > 0) {
                        console.warn(`Incomplete install config for "${newKey}". Ignoring.`);
                    }
                }
            }

            if (isValid) newConfig.mcpServers[newKey] = serverData;
        });

        if (!isValid) {
            saveStatus.textContent = `Error: ${errorMsg}`; saveStatus.style.color = 'red'; alert(`Validation Error: ${errorMsg}`); return;
        }

        try {
            const response = await fetch('/admin/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newConfig)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                saveStatus.textContent = 'Server configuration saved successfully!'; saveStatus.style.color = 'green';
                currentServerConfig = newConfig; renderServerConfig(currentServerConfig); // Re-render
            } else {
                saveStatus.textContent = `Error saving server config: ${result.error || 'Unknown error'}`; saveStatus.style.color = 'red';
            }
        } catch (error) {
            console.error("Save server config error:", error); saveStatus.textContent = `Error saving server config: ${error.message}`; saveStatus.style.color = 'red';
        } finally {
            setTimeout(() => { saveStatus.textContent = ''; saveStatus.style.color = 'green'; }, 5000);
        }
    });

    // --- Installation Handling ---
    const handleInstallClick = async (serverKey, entryDiv) => {
        const installButton = entryDiv.querySelector('.install-button');
        const installStatusSpan = entryDiv.querySelector('.install-status');
        if (!serverKey || !installButton || !installStatusSpan) return;

        installButton.disabled = true; installStatusSpan.textContent = 'Checking/Installing...'; installStatusSpan.style.color = 'orange';
        try {
            const response = await fetch(`/admin/server/install/${serverKey}`, { method: 'POST' });
            const result = await response.json();
            if (response.ok && result.success) {
                installStatusSpan.textContent = result.message || 'Installation successful.'; installStatusSpan.style.color = 'green'; installButton.textContent = 'Installed';
            } else if (response.status === 409) {
                 installStatusSpan.textContent = result.message || 'Directory already exists.'; installStatusSpan.style.color = 'blue'; installButton.textContent = 'Installed';
            } else {
                installStatusSpan.textContent = `Error: ${result.error || response.statusText}`; installStatusSpan.style.color = 'red';
                if (result.details) installStatusSpan.textContent += ` Details: ${result.details}`;
                 installButton.disabled = false;
            }
        } catch (error) {
            console.error(`Install error for ${serverKey}:`, error); installStatusSpan.textContent = `Network/server error: ${error.message}`; installStatusSpan.style.color = 'red'; installButton.disabled = false;
        }
    };

    // --- Tool Configuration Management (Merged from tools.js) ---
    const loadToolData = async () => {
        if (toolDataLoaded) return; // Don't reload if already loaded
        saveToolStatus.textContent = 'Loading tool data...';
        saveToolStatus.style.color = 'orange';
        try {
            const [toolsResponse, configResponse] = await Promise.all([
                fetch('/admin/tools/list'), fetch('/admin/tools/config')
            ]);
            if (!toolsResponse.ok) throw new Error(`Failed to fetch tool list: ${toolsResponse.statusText}`);
            if (!configResponse.ok) throw new Error(`Failed to fetch tool config: ${configResponse.statusText}`);

            const toolsData = await toolsResponse.json();
            const configData = await configResponse.json();

            discoveredTools = toolsData.tools || [];
            currentToolConfig = configData.tools || {}; // Structure { tools: {...} }

            renderTools();
            saveToolStatus.textContent = 'Tool data loaded.'; saveToolStatus.style.color = 'green';
            toolDataLoaded = true; // Mark as loaded
            setTimeout(() => saveToolStatus.textContent = '', 3000);
        } catch (error) {
            console.error("Error loading tool data:", error);
            toolListDiv.innerHTML = `<p class="error-message">Error loading tool data: ${error.message}</p>`;
            saveToolStatus.textContent = `Error: ${error.message}`; saveToolStatus.style.color = 'red';
        }
    };

    const renderTools = () => {
        toolListDiv.innerHTML = '';
        if (discoveredTools.length === 0) {
            toolListDiv.innerHTML = '<p>No tools discovered from connected servers.</p>'; return;
        }
        const toolsByServer = discoveredTools.reduce((acc, tool) => {
            const serverName = tool.name.split('/')[0];
            if (!acc[serverName]) acc[serverName] = [];
            acc[serverName].push(tool);
            return acc;
        }, {});

        Object.entries(toolsByServer).forEach(([serverName, tools]) => {
            const serverGroupDiv = document.createElement('div');
            serverGroupDiv.classList.add('server-group');
            serverGroupDiv.innerHTML = `<h3>Server: ${serverName}</h3>`;
            tools.forEach(tool => {
                const toolDiv = document.createElement('div');
                toolDiv.classList.add('tool-entry');
                const qualifiedName = tool.name;
                const isEnabled = currentToolConfig[qualifiedName] === undefined || currentToolConfig[qualifiedName]?.enabled !== false;
                toolDiv.innerHTML = `
                    <label>
                        <input type="checkbox" data-tool-name="${qualifiedName}" ${isEnabled ? 'checked' : ''}>
                        <strong>${qualifiedName.split('/').slice(1).join('/')}</strong> <!-- Show only tool name -->
                        <span style="color: #6c757d; margin-left: 5px;">(${qualifiedName})</span> <!-- Show full name muted -->
                        ${tool.description ? `<p style="margin-left: 20px; font-size: 0.9em; color: #555;">${tool.description}</p>` : ''}
                    </label>
                `;
                serverGroupDiv.appendChild(toolDiv);
            });
            toolListDiv.appendChild(serverGroupDiv);
        });
    };

    saveToolConfigButton.addEventListener('click', async () => {
        saveToolStatus.textContent = 'Saving tool configuration...'; saveToolStatus.style.color = 'orange';
        const newToolConfigPayload = { tools: {} };
        const checkboxes = toolListDiv.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            const toolName = checkbox.dataset.toolName;
            if (toolName) newToolConfigPayload.tools[toolName] = { enabled: checkbox.checked };
        });

        try {
            const response = await fetch('/admin/tools/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newToolConfigPayload)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                saveToolStatus.textContent = result.message || 'Tool configuration saved! Restart server to apply.'; saveToolStatus.style.color = 'green';
                currentToolConfig = newToolConfigPayload.tools; // Update local state
            } else {
                saveToolStatus.textContent = `Error saving tool config: ${result.error || 'Unknown error'}`; saveToolStatus.style.color = 'red';
            }
        } catch (error) {
            console.error("Save tool config error:", error); saveToolStatus.textContent = `Error saving tool config: ${error.message}`; saveToolStatus.style.color = 'red';
        } finally {
            setTimeout(() => { saveToolStatus.textContent = ''; saveToolStatus.style.color = 'green'; }, 7000);
        }
    });

    // --- Initial Load ---
    checkLoginStatus(); // Check login and load initial data if successful
});