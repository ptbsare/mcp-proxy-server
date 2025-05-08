// --- DOM Elements (Assumed to be globally accessible or passed) ---
const toolListDiv = document.getElementById('tool-list');
const saveToolConfigButton = document.getElementById('save-tool-config-button');
// const saveToolStatus = document.getElementById('save-tool-status'); // Removed: Declared in script.js
// Note: Assumes currentToolConfig and discoveredTools variables are globally accessible from script.js or passed.
// Note: Assumes triggerReload function is globally accessible from script.js or passed.

// --- Tool Configuration Management ---
async function loadToolData() {
    if (!saveToolStatus || !toolListDiv) return; // Guard
    saveToolStatus.textContent = 'Loading tool data...';
    window.toolDataLoaded = false; // Reset flag during load attempt (use global flag)
    try {
        // Fetch both discovered tools and tool config concurrently
        const [toolsResponse, configResponse] = await Promise.all([
            fetch('/admin/tools/list'),
            fetch('/admin/tools/config')
        ]);

        if (!toolsResponse.ok) throw new Error(`Failed to fetch discovered tools: ${toolsResponse.statusText}`);
        if (!configResponse.ok) throw new Error(`Failed to fetch tool config: ${configResponse.statusText}`);

        const toolsResult = await toolsResponse.json();
        window.discoveredTools = toolsResult.tools || []; // Expecting { tools: [...] } (use global var)

        window.currentToolConfig = await configResponse.json(); // Use global var
        if (!window.currentToolConfig || typeof window.currentToolConfig !== 'object' || !window.currentToolConfig.tools) {
             console.warn("Received invalid tool configuration format, initializing empty.", window.currentToolConfig);
             window.currentToolConfig = { tools: {} }; // Initialize if invalid or empty
        }


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
        const toolKey = `${tool.server_name}--${tool.name}`; // Unique key
        const config = currentToolConfig.tools[toolKey] || {}; // Get config or empty object
        renderToolEntry(toolKey, tool, config);
        configuredToolKeys.delete(toolKey); // Remove from set as it's handled
    });

    // Render any remaining configured tools that were not discovered (maybe disabled server?)
    configuredToolKeys.forEach(toolKey => {
         console.warn(`Rendering configured tool "${toolKey}" which was not discovered (server might be inactive).`);
         const config = currentToolConfig.tools[toolKey];
         // We don't have the full tool definition here, just render based on config
         renderToolEntry(toolKey, null, config, true); // Pass flag indicating it's config-only
    });

     if (toolListDiv.innerHTML === '') {
         toolListDiv.innerHTML = '<p>No tools discovered or configured.</p>';
     }
}

function renderToolEntry(toolKey, toolDefinition, toolConfig, isConfigOnly = false) {
    if (!toolListDiv) return; // Guard
    const entryDiv = document.createElement('div');
    entryDiv.classList.add('tool-entry');
    entryDiv.dataset.toolKey = toolKey;

    const displayName = toolConfig.displayName || (toolDefinition ? `${toolDefinition.server_name} / ${toolDefinition.name}` : toolKey);
    const description = toolConfig.description || toolDefinition?.description || (isConfigOnly ? 'Description not available (tool not discovered)' : 'No description provided.');
    const isEnabled = toolConfig.enabled !== false; // Enabled by default

    entryDiv.innerHTML = `
        <div class="tool-header">
            <h3>${displayName}</h3>
            <span class="tool-key">(${toolKey})</span>
            <label class="inline-label tool-enable-toggle">
                <input type="checkbox" class="tool-enabled-input" ${isEnabled ? 'checked' : ''}>
                Enabled
            </label>
        </div>
        <div class="tool-details">
            <div><label>Display Name Override:</label><input type="text" class="tool-displayname-input" value="${toolConfig.displayName || ''}" placeholder="Optional: Override default name"></div>
            <div><label>Description Override:</label><textarea class="tool-description-input" placeholder="Optional: Override default description">${toolConfig.description || ''}</textarea></div>
            <p class="tool-original-description">Original Description: ${toolDefinition?.description || 'N/A'}</p>
            ${isConfigOnly ? '<p class="warning-message">This tool was configured but not discovered by any active server.</p>' : ''}
        </div>
    `;

    toolListDiv.appendChild(entryDiv);
}

function initializeToolSaveListener() {
    if (!saveToolConfigButton || !toolListDiv || !saveToolStatus) return; // Guard

    saveToolConfigButton.addEventListener('click', async () => {
        saveToolStatus.textContent = 'Saving tool configuration...';
        saveToolStatus.style.color = 'orange';
        const newToolConfig = { tools: {} };
        const entries = toolListDiv.querySelectorAll('.tool-entry');

        entries.forEach(entryDiv => {
            const toolKey = entryDiv.dataset.toolKey;
            const enabledInput = entryDiv.querySelector('.tool-enabled-input');
            const displayNameInput = entryDiv.querySelector('.tool-displayname-input');
            const descriptionInput = entryDiv.querySelector('.tool-description-input');

            const configData = {
                enabled: enabledInput.checked,
                displayName: displayNameInput.value.trim() || undefined, // Store undefined if empty
                description: descriptionInput.value.trim() || undefined, // Store undefined if empty
            };

            // Only store config if it differs from default (enabled=true, no overrides)
            // Or if it's explicitly disabled
            if (configData.enabled === false || configData.displayName || configData.description) {
                 newToolConfig.tools[toolKey] = configData;
            }
        });

        try {
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