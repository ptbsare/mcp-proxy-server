// --- Global State Variables ---
var currentServerConfig = {};
var currentToolConfig = { tools: {} };
var discoveredTools = [];
var toolDataLoaded = false;
var adminEventSource = null; // This is the local variable
var effectiveToolsFolder = 'tools'; // Default value if not fetched or empty
window.effectiveToolsFolder = effectiveToolsFolder; // Expose globally
window.adminEventSource = null; // Expose adminEventSource globally from the start

// --- DOM Elements (Commonly used) ---
const loginSection = document.getElementById('login-section');
const mainContent = document.getElementById('main-content');
const mainNav = document.getElementById('main-nav');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const navServersButton = document.getElementById('nav-servers');
const navToolsButton = document.getElementById('nav-tools');
const navTerminalButton = document.getElementById('nav-terminal');
const logoutButton = document.getElementById('logout-button');
const serversSection = document.getElementById('servers-section');
const toolsSection = document.getElementById('tools-section');
const saveStatus = document.getElementById('save-status');
const saveToolStatus = document.getElementById('save-tool-status');
const addStdioButton = document.getElementById('add-stdio-server-button');
const addSseButton = document.getElementById('add-sse-server-button');

// Elements for Parse Config Modal
const parseServerConfigButton = document.getElementById('parse-server-config-button');
const parseConfigModal = document.getElementById('parse-config-modal');
const closeParseModalButton = document.getElementById('close-parse-modal');
const jsonConfigInput = document.getElementById('json-config-input');
const executeParseConfigButton = document.getElementById('execute-parse-config-button');
const cancelParseConfigButton = document.getElementById('cancel-parse-config-button');
const parseConfigError = document.getElementById('parse-config-error');


// --- Admin SSE Connection & Handlers (Common) ---
function connectAdminSSE() {
    if (adminEventSource && adminEventSource.readyState !== EventSource.CLOSED) {
        console.log("Admin SSE connection already open or connecting.");
        return;
    }
    console.log("Attempting to connect Admin SSE...");
    adminEventSource = new EventSource('/admin/sse/updates');
    window.adminEventSource = adminEventSource; // Update global reference

    adminEventSource.onopen = function() { console.log("Admin SSE connection opened successfully."); };
    adminEventSource.onerror = function(err) {
        console.error("Admin SSE error:", err);
        if (adminEventSource) adminEventSource.close();
        adminEventSource = null;
        window.adminEventSource = null; // Update global reference
        console.log("Admin SSE connection closed due to error.");
    };
    adminEventSource.addEventListener('connected', function(event) {
        try {
            const data = JSON.parse(event.data);
            console.log("Admin SSE connected message:", data.message);
        } catch (e) {
            console.error("Error parsing 'connected' event data:", e, event.data);
        }
    });
    adminEventSource.addEventListener('install_info', handleInstallUpdate);
    adminEventSource.addEventListener('install_stdout', handleInstallUpdate);
    adminEventSource.addEventListener('install_stderr', handleInstallUpdate);
    adminEventSource.addEventListener('install_error', handleInstallError);
    adminEventSource.addEventListener('install_complete', handleInstallComplete);
    console.log("Admin SSE event listeners added.");
}

function getInstallOutputElement(serverKey) {
     return document.getElementById(`install-output-${serverKey}`);
}

function appendToInstallOutput(serverKey, text, isError = false) {
    const outputElement = getInstallOutputElement(serverKey);
    if (outputElement) {
        const span = document.createElement('span');
        const formattedText = text.replace(/\\n/g, '\n');
        span.textContent = formattedText.endsWith('\n') ? formattedText : formattedText + '\n';
        if (isError) {
            span.style.color = '#ff6b6b'; span.style.fontWeight = 'bold';
        } else if (event && event.type === 'install_stderr') { 
             span.style.color = '#ffa07a';
        } else if (event && event.type === 'install_info') { 
             span.style.color = '#87cefa';
        }
        outputElement.appendChild(span);
        requestAnimationFrame(() => { outputElement.scrollTop = outputElement.scrollHeight; });
    }
}

function handleInstallUpdate(event) { 
    try {
        const data = JSON.parse(event.data);
        const textToAdd = data.output || data.message || '';
        const isStdErr = event.type === 'install_stderr';
        appendToInstallOutput(data.serverKey, textToAdd, isStdErr);
    } catch (e) { console.error("Error parsing install update event data:", e, event.data); }
}

function handleInstallError(event) {
    try {
        const data = JSON.parse(event.data);
        const errorText = `\n--- ERROR ---\n${data.error}\n-------------\n`;
        appendToInstallOutput(data.serverKey, errorText, true);
        const installButton = document.querySelector(`.install-button[data-server-key="${data.serverKey}"]`);
        if (installButton) { installButton.textContent = 'Install Failed'; installButton.disabled = false; }
    } catch (e) { console.error("Error parsing install error event data:", e, event.data); }
}

function handleInstallComplete(event) {
     try {
        const data = JSON.parse(event.data);
        const completeText = `\n--- Installation Complete (Exit Code: ${data.code}) ---\n${data.message}\n-------------\n`;
        appendToInstallOutput(data.serverKey, completeText, data.code !== 0);
        const installButton = document.querySelector(`.install-button[data-server-key="${data.serverKey}"]`);
        if (installButton) { installButton.textContent = data.code === 0 ? 'Install Complete' : 'Install Failed'; installButton.disabled = false; }
    } catch (e) { console.error("Error parsing install complete event data:", e, event.data); }
}

// --- Trigger Reload Function (Common) ---
async function triggerReload(statusElement) {
    if (!statusElement) return;
    statusElement.textContent += ' Reloading configuration...';
    statusElement.style.color = 'orange';
    try {
        const reloadResponse = await fetch('/admin/server/reload', { method: 'POST' });
        const reloadResult = await reloadResponse.json();
        if (reloadResponse.ok && reloadResult.success) {
            statusElement.textContent = 'Configuration Saved & Reloaded Successfully!';
            statusElement.style.color = 'green';
             if (toolsSection && toolsSection.style.display === 'block' && typeof loadToolData === 'function') {
                toolDataLoaded = false; loadToolData();
            }
        } else {
             statusElement.textContent = `Save successful, but failed to reload: ${reloadResult.error || reloadResponse.statusText}`;
             statusElement.style.color = 'red';
        }
    } catch (reloadError) {
        const errorMessage = (reloadError instanceof Error) ? reloadError.message : String(reloadError);
        statusElement.textContent = `Save successful, but network error during reload: ${errorMessage}`;
        statusElement.style.color = 'red';
    } finally {
         setTimeout(() => { if(statusElement) { statusElement.textContent = ''; statusElement.style.color = 'green'; } }, 7000);
    }
}
window.triggerReload = triggerReload;
window.connectAdminSSE = connectAdminSSE;
// Removed Object.defineProperty for adminEventSource
window.appendToInstallOutput = appendToInstallOutput;
window.getInstallOutputElement = getInstallOutputElement;


// --- Navigation (Common) ---
const showSection = (sectionId) => {
    document.querySelectorAll('.admin-section').forEach(section => {
        section.style.display = 'none';
    });
    document.querySelectorAll('#main-nav .nav-button').forEach(button => {
        button.classList.remove('active');
    });
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.style.display = 'block';
        const sectionPrefix = sectionId.split('-')[0];
        const activeButton = document.getElementById(`nav-${sectionPrefix}`);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    } else {
        console.warn(`Section with ID "${sectionId}" not found.`);
    }
};

// --- Authentication (Common) ---
const checkLoginStatus = async () => {
    try {
        const response = await fetch('/admin/config');
        if (response.ok) {
            handleLoginSuccess();
        } else if (response.status === 401) {
            handleLogoutSuccess();
        } else {
             loginError.textContent = `Error connecting (${response.status}). Server running?`;
             handleLogoutSuccess();
        }
    } catch (error) {
        loginError.textContent = 'Network error connecting to server.';
        handleLogoutSuccess();
    }
};

const handleLoginSuccess = async () => { 
    loginSection.style.display = 'none';
    mainNav.style.display = 'flex';
    mainContent.style.display = 'block';
    
    try {
        const envResponse = await fetch('/admin/environment');
        if (envResponse.ok) {
            const envData = await envResponse.json();
            window.effectiveToolsFolder = (envData.toolsFolder && envData.toolsFolder.trim() !== '') ? envData.toolsFolder.trim() : 'tools';
            console.log("Effective TOOLS_FOLDER set to:", window.effectiveToolsFolder);
        } else {
            console.warn("Failed to fetch environment info, defaulting effectiveToolsFolder to 'tools'.");
            window.effectiveToolsFolder = 'tools';
        }
    } catch (err) {
        console.error("Error fetching environment info (TOOLS_FOLDER):", err);
        window.effectiveToolsFolder = 'tools'; // Fallback
    }

    showSection('servers-section');
    if (typeof loadServerConfig === 'function') {
        loadServerConfig();
    } else { console.error("loadServerConfig function not found."); }
    toolDataLoaded = false;
    loginError.textContent = '';
    connectAdminSSE();

    if (typeof initializeServerSaveListener === 'function') {
        initializeServerSaveListener();
    } else { console.error("initializeServerSaveListener function not found."); }
     if (typeof initializeToolSaveListener === 'function') {
        initializeToolSaveListener();
    } else { console.error("initializeToolSaveListener function not found."); }
};

const handleLogoutSuccess = () => {
    loginSection.style.display = 'block';
    mainNav.style.display = 'none';
    document.querySelectorAll('.admin-section').forEach(section => { section.style.display = 'none'; });
    const serverList = document.getElementById('server-list'); if (serverList) serverList.innerHTML = '';
    const toolList = document.getElementById('tool-list'); if (toolList) toolList.innerHTML = '';
    currentServerConfig = {}; currentToolConfig = { tools: {} }; discoveredTools = []; toolDataLoaded = false;
    loginError.textContent = '';
    if (adminEventSource) { 
        adminEventSource.close(); 
        adminEventSource = null; 
        window.adminEventSource = null; // Update global reference
        console.log("Admin SSE closed on logout."); 
    }
};

// --- Config Parsing Modal Logic ---
function handleParseConfigExecute() {
    if (!jsonConfigInput || !parseConfigError) return;
    const jsonString = jsonConfigInput.value;
    parseConfigError.textContent = '';

    try {
        const parsed = JSON.parse(jsonString);
        let serversToAdd = {};

        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
            serversToAdd = parsed.mcpServers;
        } else if (typeof parsed === 'object' && (parsed.command || parsed.url)) {
            const newKey = `parsed_server_${Date.now()}`;
            serversToAdd[newKey] = parsed;
        } else {
            throw new Error("Invalid JSON structure. Expected 'mcpServers' object or a single server config object.");
        }

        let serversAddedCount = 0;
        for (const key in serversToAdd) {
            if (Object.prototype.hasOwnProperty.call(serversToAdd, key)) {
                const serverConf = serversToAdd[key];
                if (typeof serverConf !== 'object' || serverConf === null) {
                    console.warn(`Skipping invalid server entry for key ${key} in parsed JSON.`);
                    continue;
                }
                const isStdio = serverConf && typeof serverConf.command === 'string';
                if (isStdio && !serverConf.installDirectory) {
                    serverConf.installDirectory = `${window.effectiveToolsFolder || 'tools'}/${key}`;
                     console.log(`Auto-filled installDirectory for ${key}: ${serverConf.installDirectory}`);
                }
                if (typeof window.renderServerEntry === 'function') {
                    window.renderServerEntry(key, serverConf, true); 
                    serversAddedCount++;
                } else {
                    console.error("renderServerEntry function not found.");
                    parseConfigError.textContent = "Error: UI function to add server not found.";
                    return;
                }
            }
        }

        if (serversAddedCount > 0 && typeof window.addInstallButtonListeners === 'function') {
            window.addInstallButtonListeners();
        }
        
        if (serversAddedCount === 0 && Object.keys(serversToAdd).length > 0) {
             parseConfigError.textContent = "No valid server entries found in the provided JSON.";
             return;
        }
        if (serversAddedCount > 0) {
            jsonConfigInput.value = ''; 
            parseConfigModal.style.display = 'none'; 
            alert(`${serversAddedCount} server(s) parsed and added to the UI. Remember to save the configuration.`);
        }
    } catch (error) {
        console.error("Error parsing JSON config:", error);
        parseConfigError.textContent = `Error parsing JSON: ${error.message}`;
    }
}


// --- Event Listeners (Initialization) ---
document.addEventListener('DOMContentLoaded', () => {
    // --- Navigation Button Listeners ---
    if (navServersButton) navServersButton.addEventListener('click', () => showSection('servers-section'));
    if (navToolsButton) {
        navToolsButton.addEventListener('click', () => {
            showSection('tools-section');
            if (!toolDataLoaded && typeof loadToolData === 'function') loadToolData();
            else if (typeof loadToolData !== 'function') console.error("loadToolData not found.");
        });
    }
    if (navTerminalButton) navTerminalButton.addEventListener('click', () => window.location.href = 'terminal.html');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                const response = await fetch('/admin/logout', { method: 'POST' });
                if (response.ok) handleLogoutSuccess(); else alert('Logout failed.');
            } catch (error) { console.error("Logout error:", error); alert('An error occurred during logout.'); }
        });
    }

    // --- Login Form Listener ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault(); loginError.textContent = '';
            const username = loginForm.username.value; const password = loginForm.password.value;
            try {
                const response = await fetch('/admin/login', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const result = await response.json();
                if (response.ok && result.success) handleLoginSuccess();
                else loginError.textContent = result.error || 'Login failed.';
            } catch (error) { loginError.textContent = 'An error occurred during login.'; }
        });
    }

    // --- Add Server Button Listeners ---
    if (addStdioButton) {
        addStdioButton.addEventListener('click', () => {
             if (typeof window.renderServerEntry !== 'function' || typeof window.addInstallButtonListeners !== 'function') {
                 console.error("renderServerEntry or addInstallButtonListeners not found."); return;
             }
             const newKey = `new_stdio_server_${Date.now()}`;
             const newServerConf = {
                 name: "New Stdio Server", active: true, command: "your_command_here", args: [], env: {},
                 installDirectory: `${window.effectiveToolsFolder || 'tools'}/${newKey}` 
             };
             window.renderServerEntry(newKey, newServerConf, true);
             window.addInstallButtonListeners();
             const serverList = document.getElementById('server-list');
             serverList?.lastChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
    if (addSseButton) {
        addSseButton.addEventListener('click', () => {
             if (typeof window.renderServerEntry !== 'function' || typeof window.addInstallButtonListeners !== 'function') {
                 console.error("renderServerEntry or addInstallButtonListeners not found."); return;
             }
             const newKey = `new_sse_server_${Date.now()}`;
             const newServerConf = { name: "New SSE Server", active: true, url: "http://localhost:3663/sse" };
             window.renderServerEntry(newKey, newServerConf, true);
             window.addInstallButtonListeners();
             const serverList = document.getElementById('server-list');
             serverList?.lastChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // --- Parse Config Modal Listeners ---
    if (parseServerConfigButton) parseServerConfigButton.addEventListener('click', () => {
        if(parseConfigModal) parseConfigModal.style.display = 'block';
        if(parseConfigError) parseConfigError.textContent = '';
    });
    if (closeParseModalButton) closeParseModalButton.addEventListener('click', () => {
        if(parseConfigModal) parseConfigModal.style.display = 'none';
        if(parseConfigError) parseConfigError.textContent = '';
        if(jsonConfigInput) jsonConfigInput.value = '';
    });
    if (cancelParseConfigButton) cancelParseConfigButton.addEventListener('click', () => {
        if(parseConfigModal) parseConfigModal.style.display = 'none';
        if(parseConfigError) parseConfigError.textContent = '';
        if(jsonConfigInput) jsonConfigInput.value = '';
    });
    if (executeParseConfigButton) executeParseConfigButton.addEventListener('click', handleParseConfigExecute);

    // Initial check
    checkLoginStatus();

}); // End DOMContentLoaded

console.log("script.js loaded and initialized.");