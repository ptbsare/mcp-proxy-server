document.addEventListener('DOMContentLoaded', () => {
    const toolListDiv = document.getElementById('tool-list');
    const saveButton = document.getElementById('save-tool-config-button');
    const saveStatus = document.getElementById('save-tool-status');
    const logoutButton = document.getElementById('logout-button-tools');

    let discoveredTools = []; // Array of { name: "server/tool", ... }
    let currentToolConfig = {}; // { tools: { "server/tool": { enabled: true/false } } }

    // --- Authentication & Logout ---

    // Very basic check - assumes if we can load this page, we are logged in.
    // A more robust check would involve an API call.
    const checkLogin = async () => {
        // Try fetching config as a proxy for login status check
        try {
            const response = await fetch('/admin/config'); // Use existing endpoint
            if (!response.ok) {
                // If fetching server config fails (e.g., 401), redirect to login
                window.location.href = 'index.html';
            } else {
                // If logged in, load tool data
                loadData();
            }
        } catch (error) {
            console.error("Error checking login status:", error);
            window.location.href = 'index.html'; // Redirect on error
        }
    };

    logoutButton.addEventListener('click', async () => {
        try {
            const response = await fetch('/admin/logout', { method: 'POST' });
            if (response.ok) {
                window.location.href = 'index.html'; // Redirect to login page
            } else {
                alert('Logout failed.');
            }
        } catch (error) {
            console.error("Logout error:", error);
            alert('An error occurred during logout.');
        }
    });

    // --- Data Loading and Rendering ---

    const loadData = async () => {
        saveStatus.textContent = 'Loading...';
        try {
            // Fetch both discovered tools and current config in parallel
            const [toolsResponse, configResponse] = await Promise.all([
                fetch('/admin/tools/list'),
                fetch('/admin/tools/config')
            ]);

            if (!toolsResponse.ok) throw new Error(`Failed to fetch tool list: ${toolsResponse.statusText}`);
            if (!configResponse.ok) throw new Error(`Failed to fetch tool config: ${configResponse.statusText}`);

            const toolsData = await toolsResponse.json();
            const configData = await configResponse.json();

            discoveredTools = toolsData.tools || [];
            currentToolConfig = configData.tools || {}; // Ensure structure { tools: {...} }

            renderTools();
            saveStatus.textContent = 'Data loaded.';
            setTimeout(() => saveStatus.textContent = '', 3000);

        } catch (error) {
            console.error("Error loading tool data:", error);
            toolListDiv.innerHTML = `<p class="error-message">Error loading tool data: ${error.message}</p>`;
            saveStatus.textContent = `Error: ${error.message}`;
        }
    };

    const renderTools = () => {
        toolListDiv.innerHTML = ''; // Clear loading message or previous list

        if (discoveredTools.length === 0) {
            toolListDiv.innerHTML = '<p>No tools discovered from connected servers.</p>';
            return;
        }

        // Group tools by server for better readability
        const toolsByServer = discoveredTools.reduce((acc, tool) => {
            const serverName = tool.name.split('/')[0];
            if (!acc[serverName]) {
                acc[serverName] = [];
            }
            acc[serverName].push(tool);
            return acc;
        }, {});

        Object.entries(toolsByServer).forEach(([serverName, tools]) => {
            const serverGroupDiv = document.createElement('div');
            serverGroupDiv.classList.add('server-group'); // Add class for potential styling
            serverGroupDiv.innerHTML = `<h3>Server: ${serverName}</h3>`;

            tools.forEach(tool => {
                const toolDiv = document.createElement('div');
                toolDiv.classList.add('tool-entry'); // Add class for potential styling
                const qualifiedName = tool.name; // Already qualified from API
                const isEnabled = currentToolConfig[qualifiedName] === undefined || currentToolConfig[qualifiedName]?.enabled !== false;

                toolDiv.innerHTML = `
                    <label>
                        <input type="checkbox" data-tool-name="${qualifiedName}" ${isEnabled ? 'checked' : ''}>
                        <strong>${qualifiedName}</strong>
                        ${tool.description ? `<p style="margin-left: 20px; font-size: 0.9em; color: #555;">${tool.description}</p>` : ''}
                    </label>
                `;
                serverGroupDiv.appendChild(toolDiv);
            });
            toolListDiv.appendChild(serverGroupDiv);
        });
    };

    // --- Saving Configuration ---

    saveButton.addEventListener('click', async () => {
        saveStatus.textContent = 'Saving...';
        saveStatus.style.color = 'orange';

        const newToolConfigPayload = { tools: {} };
        const checkboxes = toolListDiv.querySelectorAll('input[type="checkbox"]');

        checkboxes.forEach(checkbox => {
            const toolName = checkbox.dataset.toolName;
            if (toolName) {
                // Only store entries for tools where the state is explicitly set (or differs from default enabled)
                // For simplicity here, we store all states. Could optimize to only store 'false'.
                newToolConfigPayload.tools[toolName] = { enabled: checkbox.checked };
            }
        });

        try {
            const response = await fetch('/admin/tools/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newToolConfigPayload)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                saveStatus.textContent = result.message || 'Tool configuration saved successfully! Restart server to apply.';
                saveStatus.style.color = 'green';
                currentToolConfig = newToolConfigPayload.tools; // Update local state
            } else {
                saveStatus.textContent = `Error saving tool configuration: ${result.error || 'Unknown error'}`;
                saveStatus.style.color = 'red';
            }

        } catch (error) {
            console.error("Save tool config error:", error);
            saveStatus.textContent = `An error occurred while saving: ${error.message}`;
            saveStatus.style.color = 'red';
        } finally {
             setTimeout(() => {
                saveStatus.textContent = '';
                saveStatus.style.color = 'green'; // Reset color
            }, 7000); // Longer timeout to read restart message
        }
    });


    // --- Initial Load ---
    checkLogin(); // Check login and load data if successful
});