document.addEventListener('DOMContentLoaded', () => {
    const loginSection = document.getElementById('login-section');
    const configSection = document.getElementById('config-section');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutButton = document.getElementById('logout-button');
    const serverListDiv = document.getElementById('server-list');
    const addServerButton = document.getElementById('add-server-button');
    const saveConfigButton = document.getElementById('save-config-button');
    const saveStatus = document.getElementById('save-status');

    let currentConfig = {}; // To hold the loaded config

    // --- Authentication ---

    const checkLoginStatus = async () => {
        // A simple way to check is to try fetching the config
        try {
            const response = await fetch('/admin/config');
            if (response.ok) {
                showConfigSection();
                loadConfig();
            } else {
                showLoginSection();
            }
        } catch (error) {
            console.error("Error checking login status:", error);
            showLoginSection(); // Assume not logged in if check fails
        }
    };

    const showLoginSection = () => {
        loginSection.style.display = 'block';
        configSection.style.display = 'none';
        loginError.textContent = ''; // Clear previous errors
    };

    const showConfigSection = () => {
        loginSection.style.display = 'none';
        configSection.style.display = 'block';
        saveStatus.textContent = ''; // Clear previous status
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
                showConfigSection();
                loadConfig();
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
                showLoginSection();
                serverListDiv.innerHTML = ''; // Clear config display
                currentConfig = {};
            } else {
                alert('Logout failed.');
            }
        } catch (error) {
            console.error("Logout error:", error);
            alert('An error occurred during logout.');
        }
    });

    // --- Configuration Management ---

    const loadConfig = async () => {
        saveStatus.textContent = 'Loading configuration...';
        try {
            const response = await fetch('/admin/config');
            if (!response.ok) {
                throw new Error(`Failed to fetch config: ${response.statusText}`);
            }
            currentConfig = await response.json();
            renderConfig(currentConfig);
            saveStatus.textContent = 'Configuration loaded.';
            setTimeout(() => saveStatus.textContent = '', 3000);
        } catch (error) {
            console.error("Error loading config:", error);
            saveStatus.textContent = `Error loading configuration: ${error.message}`;
            serverListDiv.innerHTML = '<p class="error-message">Could not load configuration.</p>';
        }
    };

    const renderConfig = (config) => {
        serverListDiv.innerHTML = ''; // Clear previous entries
        if (!config || typeof config !== 'object') {
             serverListDiv.innerHTML = '<p class="error-message">Invalid configuration format received.</p>';
             return;
        }
        // The config is expected to be { mcpServers: { serverKey: {...} } }
        const servers = config.mcpServers || {};
        Object.entries(servers).forEach(([key, serverConf]) => {
            renderServerEntry(key, serverConf);
        });
    };

    const renderServerEntry = (key, serverConf) => {
        const entryDiv = document.createElement('div');
        entryDiv.classList.add('server-entry');
        entryDiv.dataset.serverKey = key; // Store the original key

        const isSSE = !!serverConf.url;
        const type = isSSE ? 'SSE' : 'Stdio';

        entryDiv.innerHTML = `
            <h3>${serverConf.name || key} (${type})</h3>
            <button class="delete-button">Delete</button>
            <div><label>Server Key (Unique ID):</label><input type="text" class="server-key-input" value="${key}" required></div>
            <div><label>Display Name:</label><input type="text" class="server-name-input" value="${serverConf.name || ''}"></div>
            <div>
                <label>
                    <input type="checkbox" class="server-active-input" ${serverConf.active !== false ? 'checked' : ''}>
                    Active
                </label>
            </div>
            ${isSSE ? `
                <div><label>URL:</label><input type="url" class="server-url-input" value="${serverConf.url || ''}" required></div>
            ` : `
                <div><label>Command:</label><input type="text" class="server-command-input" value="${serverConf.command || ''}" required></div>
                <div><label>Arguments (comma-separated):</label><input type="text" class="server-args-input" value="${(serverConf.args || []).join(', ')}"></div>
                <div><label>Environment Variables (JSON format, e.g., {"KEY":"VALUE"}):</label><textarea class="server-env-input">${JSON.stringify(serverConf.env || {}, null, 2)}</textarea></div>
            `}
        `;

        entryDiv.querySelector('.delete-button').addEventListener('click', () => {
            if (confirm(`Are you sure you want to delete server "${serverConf.name || key}"?`)) {
                entryDiv.remove();
            }
        });

        serverListDiv.appendChild(entryDiv);
    };

    addServerButton.addEventListener('click', () => {
        const newKey = `new_server_${Date.now()}`;
        const newServerConf = {
            name: "New Server",
            active: true,
            // Default to Stdio, user can change
            command: "your_command_here",
            args: [],
            env: {}
            // Or default to SSE: url: "http://example.com"
        };
        renderServerEntry(newKey, newServerConf);
        // Scroll to the new entry maybe?
        serverListDiv.lastChild?.scrollIntoView();
    });

    saveConfigButton.addEventListener('click', async () => {
        saveStatus.textContent = 'Saving configuration...';
        const newConfig = { mcpServers: {} };
        const entries = serverListDiv.querySelectorAll('.server-entry');
        let isValid = true;
        let errorMsg = '';

        entries.forEach(entryDiv => {
            const originalKey = entryDiv.dataset.serverKey;
            const newKeyInput = entryDiv.querySelector('.server-key-input');
            const newKey = newKeyInput.value.trim();

            if (!newKey) {
                isValid = false;
                errorMsg = 'Server Key cannot be empty.';
                newKeyInput.style.border = '1px solid red';
                return; // Stop processing this entry
            } else {
                 newKeyInput.style.border = ''; // Reset border
            }

            if (newConfig.mcpServers[newKey]) {
                isValid = false;
                errorMsg = `Duplicate Server Key found: "${newKey}". Keys must be unique.`;
                newKeyInput.style.border = '1px solid red';
                return;
            }

            const nameInput = entryDiv.querySelector('.server-name-input');
            const activeInput = entryDiv.querySelector('.server-active-input');
            const urlInput = entryDiv.querySelector('.server-url-input');
            const commandInput = entryDiv.querySelector('.server-command-input');
            const argsInput = entryDiv.querySelector('.server-args-input');
            const envInput = entryDiv.querySelector('.server-env-input');

            const serverData = {
                name: nameInput.value.trim() || undefined, // Store as undefined if empty
                active: activeInput.checked
            };

            if (urlInput) { // SSE Server
                serverData.url = urlInput.value.trim();
                if (!serverData.url) {
                    isValid = false;
                    errorMsg = `URL is required for SSE server "${newKey}".`;
                    urlInput.style.border = '1px solid red';
                } else {
                    urlInput.style.border = '';
                }
            } else if (commandInput) { // Stdio Server
                serverData.command = commandInput.value.trim();
                 if (!serverData.command) {
                    isValid = false;
                    errorMsg = `Command is required for Stdio server "${newKey}".`;
                    commandInput.style.border = '1px solid red';
                } else {
                     commandInput.style.border = '';
                }

                const argsString = argsInput.value.trim();
                serverData.args = argsString ? argsString.split(',').map(arg => arg.trim()).filter(arg => arg) : [];

                try {
                    const envString = envInput.value.trim();
                    serverData.env = envString ? JSON.parse(envString) : {};
                    if (typeof serverData.env !== 'object' || serverData.env === null || Array.isArray(serverData.env)) {
                        throw new Error("Environment variables must be a JSON object.");
                    }
                     envInput.style.border = '';
                } catch (e) {
                    isValid = false;
                    errorMsg = `Invalid JSON in Environment Variables for server "${newKey}": ${e.message}`;
                    envInput.style.border = '1px solid red';
                }
            }

            if (isValid) {
                newConfig.mcpServers[newKey] = serverData;
            }
        });

        if (!isValid) {
            saveStatus.textContent = `Error: ${errorMsg}`;
            saveStatus.style.color = 'red';
            alert(`Validation Error: ${errorMsg}`);
            return;
        }

        // Proceed to save if valid
        try {
            const response = await fetch('/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig) // Send the reconstructed config
            });

            const result = await response.json();

            if (response.ok && result.success) {
                saveStatus.textContent = 'Configuration saved successfully!';
                saveStatus.style.color = 'green';
                currentConfig = newConfig; // Update local copy
                // Re-render to reflect any key changes etc.
                renderConfig(currentConfig);
            } else {
                saveStatus.textContent = `Error saving configuration: ${result.error || 'Unknown error'}`;
                saveStatus.style.color = 'red';
            }
        } catch (error) {
            console.error("Save error:", error);
            saveStatus.textContent = `An error occurred while saving: ${error.message}`;
            saveStatus.style.color = 'red';
        } finally {
            setTimeout(() => {
                saveStatus.textContent = '';
                saveStatus.style.color = 'green'; // Reset color
            }, 5000);
        }
    });

    // --- Initial Load ---
    checkLoginStatus();
});