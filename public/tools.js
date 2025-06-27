// --- DOM Elements (Assumed to be globally accessible or passed) ---
const toolListDiv = document.getElementById('tool-list');
const saveToolConfigButton = document.getElementById('save-tool-config-button');
// const saveToolStatus = document.getElementById('save-tool-status'); // Removed: Declared in script.js
// Note: Assumes currentToolConfig and discoveredTools variables are globally accessible from script.js or passed.
// Note: Assumes triggerReload function is globally accessible from script.js or passed.
let serverToolnameSeparator = '__'; // Default separator

// --- Tool Configuration Management ---
async function loadToolData() {
    if (!saveToolStatus || !toolListDiv) return; // Guard
    saveToolStatus.textContent = 'Loading tool data...';
    window.toolDataLoaded = false; // Reset flag during load attempt (use global flag)
    try {
        // Fetch discovered tools, tool config, and environment info concurrently
        const [toolsResponse, configResponse, envResponse] = await Promise.all([
            fetch('/admin/tools/list'),
            fetch('/admin/tools/config'),
            fetch('/admin/environment') // Fetch environment info
        ]);

        if (!toolsResponse.ok) throw new Error(`Failed to fetch discovered tools: ${toolsResponse.statusText}`);
        if (!configResponse.ok) throw new Error(`Failed to fetch tool config: ${configResponse.statusText}`);
        if (!envResponse.ok) throw new Error(`Failed to fetch environment info: ${envResponse.statusText}`); // Check env response

        const toolsResult = await toolsResponse.json();
        window.discoveredTools = toolsResult.tools || []; // Expecting { tools: [...] } (use global var)

        window.currentToolConfig = await configResponse.json(); // Use global var
        if (!window.currentToolConfig || typeof window.currentToolConfig !== 'object' || !window.currentToolConfig.tools) {
             console.warn("Received invalid tool configuration format, initializing empty.", window.currentToolConfig);
         window.currentToolConfig = { tools: {} }; // Initialize if invalid or empty
        }

        const envResult = await envResponse.json(); // Parse environment info
        serverToolnameSeparator = envResult.serverToolnameSeparator || '__'; // Update separator
        console.log(`Using server toolname separator from backend: "${serverToolnameSeparator}"`);

        renderTools(); // Render using both discovered and configured data
        window.toolDataLoaded = true; // Set global flag only after successful load and render
        saveToolStatus.textContent = 'Tool data loaded.';
        setTimeout(() => saveToolStatus.textContent = '', 3000);

    } catch (error) {
        console.error("Error loading tool data:", error);
        saveToolStatus.textContent = `Error loading tool data: ${error.message}`;
        toolListDiv.innerHTML = '<p class="error-message">Could not load tool data.</p>';
    }
}

function renderTools() {
    if (!toolListDiv) return; // Guard
    toolListDiv.innerHTML = ''; // Clear previous list

    // Use global variables
    const discoveredTools = window.discoveredTools || [];
    const currentToolConfig = window.currentToolConfig || { tools: {} };


    if (!Array.isArray(discoveredTools)) {
         toolListDiv.innerHTML = '<p class="error-message">Error: Discovered tools data is not an array.</p>';
         return;
    }
     if (!currentToolConfig || typeof currentToolConfig.tools !== 'object') {
         toolListDiv.innerHTML = '<p class="error-message">Error: Tool configuration data is invalid.</p>';
         return;
    }


    // Create a set of configured tool keys for quick lookup
    const configuredToolKeys = new Set(Object.keys(currentToolConfig.tools));

    // Render discovered tools first, merging with config
    discoveredTools.forEach(tool => {
        const toolKey = `${tool.serverName}${serverToolnameSeparator}${tool.name}`; // Use the fetched separator
        const config = currentToolConfig.tools[toolKey] || {}; // Get config or empty object
        // For discovered tools, their server is considered active by the proxy at connection time
        renderToolEntry(toolKey, tool, config, false, true); // isConfigOnly = false, isServerActive = true
        configuredToolKeys.delete(toolKey); // Remove from set as it's handled
    });

    // Render any remaining configured tools that were not discovered
    configuredToolKeys.forEach(toolKey => {
         const config = currentToolConfig.tools[toolKey];
         // Use the fetched separator for splitting
         const serverKeyForConfigOnlyTool = toolKey.split(serverToolnameSeparator)[0];
         let isServerActiveForConfigOnlyTool = true; // Default to true if server config not found or active flag is missing/true

         if (window.currentServerConfig && window.currentServerConfig.mcpServers && window.currentServerConfig.mcpServers[serverKeyForConfigOnlyTool]) {
             const serverConf = window.currentServerConfig.mcpServers[serverKeyForConfigOnlyTool];
             if (serverConf.active === false || String(serverConf.active).toLowerCase() === 'false') {
                 isServerActiveForConfigOnlyTool = false;
             }
         }
         console.warn(`Rendering configured tool "${toolKey}" which was not discovered. Associated server active status: ${isServerActiveForConfigOnlyTool}`);
         // We don't have the full tool definition here, just render based on config
         renderToolEntry(toolKey, null, config, true, isServerActiveForConfigOnlyTool); // Pass isConfigOnly and determined server active status
    });

     if (toolListDiv.innerHTML === '') {
         toolListDiv.innerHTML = '<p>No tools discovered or configured.</p>';
     }
}

function renderToolEntry(toolKey, toolDefinition, toolConfig, isConfigOnly = false, isServerActive = true) { // Added isServerActive
    if (!toolListDiv) return; // Guard
    const entryDiv = document.createElement('div');
    entryDiv.classList.add('tool-entry');
    entryDiv.classList.add('collapsed'); // Add collapsed class by default
    if (!isServerActive) {
        entryDiv.classList.add('tool-server-inactive');
        entryDiv.title = 'This tool belongs to an inactive server. Enabling it will have no effect.';
    }
    entryDiv.dataset.toolKey = toolKey; // Store the original key

    // Determine the name and description exposed to the model
    const exposedName = toolConfig.exposedName || toolKey;
    const exposedDescription = toolConfig.exposedDescription || toolDefinition?.description || ''; // Use override, fallback to original, then empty string

    // Get potential overrides from config for UI input fields
    const exposedNameOverride = toolConfig.exposedName || '';
    const exposedDescriptionOverride = toolConfig.exposedDescription || '';

    const isEnabled = toolConfig.enabled !== false; // Enabled by default
    const originalDescription = toolDefinition?.description || 'N/A'; // Original description for display

    entryDiv.innerHTML = `
        <div class="tool-header">
            <label class="inline-label tool-enable-label" title="Enable/Disable Tool">
                <input type="checkbox" class="tool-enabled-input" ${isEnabled ? 'checked' : ''} ${!isServerActive ? 'disabled' : ''}>
            </label>
            <h3 title="${!isServerActive ? 'Server is inactive' : ''}">${toolKey}</h3>
            <span class="tool-exposed-name">Exposed As: ${exposedName}</span>
            <button class="reset-tool-overrides-button" title="Reset all overrides for this tool to defaults">Reset</button>
        </div>
        <div class="tool-details">
            <div>
                <label>Exposed Tool Name Override (Optional):</label>
                <input type="text" class="tool-exposedname-input" value="${exposedNameOverride}" placeholder="Default: ${toolKey}">
                <small>Overrides the name exposed to AI models. Must be unique and contain only letters, numbers, _, - (not starting with a number).</small>
            </div>
            <div>
                <label>Exposed Description Override (Optional):</label>
                <textarea class="tool-exposeddescription-input" placeholder="Default: (Original Description below)">${exposedDescriptionOverride}</textarea>
            </div>
            <p class="tool-original-description">Original Description: ${originalDescription}</p>
            ${isConfigOnly ? '<p class="warning-message">This tool was configured but not discovered by any active server.</p>' : ''}
        </div>
    `;

    toolListDiv.appendChild(entryDiv); // Append first, then query elements within it

    // Add click listener to the new Reset button
    const resetButton = entryDiv.querySelector('.reset-tool-overrides-button');
    if (resetButton) {
        resetButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent a click on the button from also toggling collapse if it's in the header
            if (confirm(`Are you sure you want to reset all overrides for tool "${toolKey}"?\nThis will remove any custom settings for its name, description, and enabled state from the configuration. You will need to save the tool configuration to make this permanent.`)) {
                if (window.currentToolConfig && window.currentToolConfig.tools && window.currentToolConfig.tools[toolKey]) {
                    delete window.currentToolConfig.tools[toolKey];
                    console.log(`Overrides for tool ${toolKey} marked for deletion.`);
                    // Mark main tool config as dirty (if such a flag exists, or rely on main save button's behavior)
                    // To reflect changes immediately, re-render the tools list
                    // This will pick up the deleted config for this toolKey and render it with defaults
                    renderTools();
                    // Optionally, provide a status message or highlight the main save button
                    if (window.saveToolStatus) { // Ensure saveToolStatus is accessed via window or defined in this scope
                        window.saveToolStatus.textContent = `Overrides for '${toolKey}' reset. Click "Save & Reload" to apply.`;
                        window.saveToolStatus.style.color = 'orange';
                        setTimeout(() => { if (window.saveToolStatus) window.saveToolStatus.textContent = ''; }, 5000);
                    }
                } else {
                    // If the toolKey wasn't in currentToolConfig.tools, it means it was already using defaults.
                    // However, the UI might show input values if the user typed them without saving.
                    // Re-rendering will clear these UI-only changes.
                    renderTools(); // Call renderTools to refresh the UI for this entry too
                    alert(`Tool "${toolKey}" is already using default settings or has no saved overrides.`);
                }
            }
        });
    }

    // Add click listener to the header (h3) to toggle collapse
    const headerH3 = entryDiv.querySelector('.tool-header h3');
    if (headerH3) {
        headerH3.style.cursor = 'pointer'; // Indicate it's clickable
        headerH3.addEventListener('click', () => {
            entryDiv.classList.toggle('collapsed');
        });
    }
}

function initializeToolSaveListener() {
    if (!saveToolConfigButton || !toolListDiv || !saveToolStatus) return; // Guard

    // Regex for validating exposed tool name override
    const validToolNameRegex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

    saveToolConfigButton.addEventListener('click', async () => {
        saveToolStatus.textContent = 'Validating and saving tool configuration...';
        saveToolStatus.style.color = 'orange';
        const newToolConfig = { tools: {} };
        const entries = toolListDiv.querySelectorAll('.tool-entry');
        let isValid = true;
        let errorMsg = '';
        const exposedNames = new Set(); // To check for duplicates

        entries.forEach(entryDiv => {
            if (!isValid) return; // Stop processing if an error occurred

            const toolKey = entryDiv.dataset.toolKey; // Original key
            const enabledInput = entryDiv.querySelector('.tool-enabled-input');
            const exposedNameInput = entryDiv.querySelector('.tool-exposedname-input');
            const exposedDescriptionInput = entryDiv.querySelector('.tool-exposeddescription-input');

            const exposedNameOverride = exposedNameInput.value.trim();
            const exposedDescriptionOverride = exposedDescriptionInput.value.trim();
            const isEnabled = enabledInput.checked;

            const finalExposedName = exposedNameOverride || toolKey; // Use override or fallback to original key

            // --- Validation ---
            // 1. Validate format of the override (if provided)
            if (exposedNameOverride && !validToolNameRegex.test(exposedNameOverride)) {
                isValid = false;
                errorMsg = `Invalid format for Exposed Tool Name Override "${exposedNameOverride}" for tool "${toolKey}". Use letters, numbers, _, - (cannot start with number).`;
                exposedNameInput.style.border = '1px solid red';
                return;
            } else {
                 exposedNameInput.style.border = ''; // Reset border on valid or empty
            }

            // 2. Check for duplicate exposed names (considering overrides)
            if (exposedNames.has(finalExposedName)) {
                isValid = false;
                errorMsg = `Duplicate Exposed Tool Name: "${finalExposedName}". Please ensure all exposed names (including overrides) are unique.`;
                // Highlight the input that caused the duplicate
                exposedNameInput.style.border = '1px solid red';
                // Optionally, find and highlight the previous entry with the same name
                return;
            }
            exposedNames.add(finalExposedName);
            // --- End Validation ---


            const configData = {
                enabled: isEnabled,
                // Only store overrides if they are actually set
                exposedName: exposedNameOverride || undefined,
                exposedDescription: exposedDescriptionOverride || undefined,
            };

            // Only store config if it differs from default (enabled=true, no overrides)
            // Or if it's explicitly disabled, or if overrides are set
            if (configData.enabled === false || configData.exposedName || configData.exposedDescription) {
                 newToolConfig.tools[toolKey] = configData;
            }
        });

        // If validation failed, show error and stop
        if (!isValid) {
            saveToolStatus.textContent = `Error: ${errorMsg}`;
            saveToolStatus.style.color = 'red';
            setTimeout(() => { if(saveToolStatus) saveToolStatus.textContent = ''; saveToolStatus.style.color = 'green'; }, 7000);
            return;
        }

        // Proceed to save if valid
        try {
            saveToolStatus.textContent = 'Saving tool configuration...'; // Update status after validation
            const response = await fetch('/admin/tools/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newToolConfig)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                saveToolStatus.textContent = 'Tool configuration saved successfully.';
                saveToolStatus.style.color = 'green';
                window.currentToolConfig = newToolConfig; // Update global state

                // Trigger reload after successful save (assumes triggerReload is global)
                 if (typeof window.triggerReload === 'function') {
                    await window.triggerReload(saveToolStatus); // Pass the correct status element
                 } else {
                     console.error("triggerReload function not found.");
                     saveToolStatus.textContent += ' Reload trigger function not found!';
                     saveToolStatus.style.color = 'red';
                     setTimeout(() => { saveToolStatus.textContent = ''; saveToolStatus.style.color = 'green'; }, 7000);
                 }

            } else {
                saveToolStatus.textContent = `Error saving tool configuration: ${result.error || response.statusText}`;
                saveToolStatus.style.color = 'red';
                 setTimeout(() => { saveToolStatus.textContent = ''; saveToolStatus.style.color = 'green'; }, 5000);
            }
        } catch (error) {
            console.error("Error saving tool config:", error);
            saveToolStatus.textContent = `Network error saving tool configuration: ${error.message}`;
            saveToolStatus.style.color = 'red';
             setTimeout(() => { saveToolStatus.textContent = ''; saveToolStatus.style.color = 'green'; }, 5000);
        }
    });
}

// Expose functions needed by other modules or main script
window.loadToolData = loadToolData;
window.renderTools = renderTools; // Might not be needed globally
window.renderToolEntry = renderToolEntry; // Might not be needed globally
window.initializeToolSaveListener = initializeToolSaveListener; // To be called from main script

console.log("tools.js loaded");
// --- Logic for Reset All Tool Overrides button ---
function initializeResetAllToolOverridesListener() {
    const resetButton = document.getElementById('reset-all-tool-overrides-button');
    // Ensure saveToolStatus is available, it's declared in script.js and expected to be global or on window
    const localSaveToolStatus = window.saveToolStatus || document.getElementById('save-tool-status'); 

    if (!resetButton) {
        console.warn("Reset All Tool Overrides button not found in DOM.");
        return;
    }

    resetButton.addEventListener('click', async () => {
        if (confirm("Are you sure you want to reset ALL tool overrides?\nThis will clear any custom names, descriptions, and enabled/disabled states for all tools, reverting them to their defaults. You will need to click 'Save & Reload Tool Configuration' to make this permanent.")) {
            if (window.currentToolConfig) {
                window.currentToolConfig.tools = {}; // Clear all tool-specific configurations
                console.log("All tool overrides marked for deletion.");
                
                renderTools(); // Re-render the tools list to reflect the reset state

                if (localSaveToolStatus) {
                    localSaveToolStatus.textContent = 'All tool overrides have been reset. Click "Save & Reload" to apply.';
                    localSaveToolStatus.style.color = 'orange';
                    setTimeout(() => { if (localSaveToolStatus) localSaveToolStatus.textContent = ''; }, 7000);
                }
                // Consider adding a global dirty flag if not already handled by the main save logic
                // e.g., window.isToolConfigDirty = true; 
            } else {
                alert("Tool configuration not loaded yet. Please wait or try reloading.");
            }
        }
    });
}

// Expose the new initializer to be called from script.js
window.initializeResetAllToolOverridesListener = initializeResetAllToolOverridesListener;