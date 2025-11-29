const API_BASE = '/api';

// Debug logging flag - set to false in production
const DEBUG = false;

function debugLog(message, ...args) {
    if (DEBUG) {
        console.log(`[WebConsole] ${message}`, ...args);
    }
}

function errorLog(message, error) {
    console.error(`[WebConsole Error] ${message}`, error);
}

// DOM Elements
const scanForm = document.getElementById('scan-form');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const configPanel = document.getElementById('config-panel');
const dashboardView = document.getElementById('dashboard-view');
const settingsView = document.getElementById('settings-view');
const historyView = document.getElementById('history-view');
const terminalOutput = document.getElementById('terminal-output');
const agentsList = document.getElementById('agents-list');
const vulnsList = document.getElementById('vulns-list');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const historyList = document.getElementById('history-list');
const settingsForm = document.getElementById('settings-form');
const refreshHistoryBtn = document.getElementById('refresh-history-btn');
const targetTypeSelect = document.getElementById('target-type');
const targetInput = document.getElementById('target-input');

// Nav Links
const navDashboard = document.getElementById('nav-dashboard');
const navHistory = document.getElementById('nav-history');
const navSettings = document.getElementById('nav-settings');

let pollInterval = null;
let lastLogId = 0;
let currentView = 'dashboard'; // dashboard, history, settings
let isLoadingHistory = false;
let isSavingSettings = false;
let isViewingHistory = false; // Track if we're viewing historical data

const newScanBtn = document.getElementById('new-scan-btn');

// Event Listeners
scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const target = document.getElementById('target-input').value;
    const targetType = document.getElementById('target-type').value;
    const instruction = document.getElementById('instruction-input').value;

    startScan(target, targetType, instruction);
});

stopBtn.addEventListener('click', async () => {
    if (stopBtn.disabled) return; // Prevent double clicks

    try {
        stopBtn.disabled = true;
        stopBtn.innerHTML = `
            <svg class="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            Stopping...
        `;

        const response = await fetch(`${API_BASE}/stop`, { method: 'POST' });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Stop polling
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        updateStatusUI(false);
        stopBtn.classList.add('hidden');

        // Reset button state
        stopBtn.disabled = false;
        stopBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
            Stop Scan
        `;

        if (data.status === 'stopped') {
            showNotification('Scan stopped successfully', 'success');
        } else {
            showNotification('Stop request sent', 'info');
        }
    } catch (error) {
        errorLog('Failed to stop scan', error);
        showNotification(`Failed to stop scan: ${error.message}. Please try again.`, 'error');
        stopBtn.disabled = false;
        stopBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
            Stop Scan
        `;
    }
});

newScanBtn.addEventListener('click', () => {
    resetToNewScan();
});

settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveSettings();
});

refreshHistoryBtn.addEventListener('click', () => {
    if (!isLoadingHistory) {
        loadHistory();
    }
});

// Target type selector handler
targetTypeSelect.addEventListener('change', (e) => {
    const targetType = e.target.value;
    updateTargetInputPlaceholder(targetType);
});

// Navigation
navDashboard.addEventListener('click', (e) => { e.preventDefault(); navigateTo('dashboard'); });
navHistory.addEventListener('click', (e) => { e.preventDefault(); navigateTo('history'); });
navSettings.addEventListener('click', (e) => { e.preventDefault(); navigateTo('settings'); });

// Initialization
loadSettings(); // Load settings on startup
updateTargetInputPlaceholder(targetTypeSelect.value); // Set initial placeholder

// Functions

function navigateTo(view) {
    const previousView = currentView;
    currentView = view;

    // Stop polling if switching away from dashboard
    if (previousView === 'dashboard' && view !== 'dashboard') {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    // Clear history viewing state when switching away
    if (view !== 'dashboard') {
        isViewingHistory = false;
    }

    // Update Nav Styles
    [navDashboard, navHistory, navSettings].forEach(el => {
        el.classList.remove('bg-gray-800/40', 'text-white', 'border', 'border-gray-700/50', 'shadow-sm');
        el.classList.add('text-gray-400', 'hover:bg-gray-800/30', 'hover:text-white');
        const svg = el.querySelector('svg');
        if (svg) svg.classList.remove('text-green-400');
    });

    const activeNav = view === 'dashboard' ? navDashboard : view === 'history' ? navHistory : navSettings;
    if (activeNav) {
        activeNav.classList.remove('text-gray-400', 'hover:bg-gray-800/30', 'hover:text-white');
        activeNav.classList.add('bg-gray-800/40', 'text-white', 'border', 'border-gray-700/50', 'shadow-sm');
        const svg = activeNav.querySelector('svg');
        if (svg) svg.classList.add('text-green-400');
    }

    // Hide all views
    configPanel.classList.add('hidden');
    dashboardView.classList.add('hidden');
    settingsView.classList.add('hidden');
    historyView.classList.add('hidden');
    newScanBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');

    // Show active view
    if (view === 'dashboard') {
        // Check if we have scan data or if viewing history
        const hasLogs = terminalOutput && terminalOutput.innerHTML.trim() !== '' && terminalOutput.innerHTML.trim() !== '<div class="text-gray-500 italic flex items-center gap-2"><span class="w-2 h-2 bg-gray-600 rounded-full animate-pulse"></span>Waiting for scan initialization...</div>';
        const hasActiveScan = statusText && statusText.textContent !== 'System Idle' && statusText.textContent !== 'Idle' && statusText.textContent !== 'Viewing History';

        if (hasLogs || hasActiveScan || isViewingHistory) {
            dashboardView.classList.remove('hidden');
            // Show new scan button if not running and not viewing history
            if (!hasActiveScan && !isViewingHistory) {
                newScanBtn.classList.remove('hidden');
            }
            // Show stop button only if scan is actively running
            if (hasActiveScan && statusText.textContent === 'Scan in Progress') {
                stopBtn.classList.remove('hidden');
            }
        } else {
            configPanel.classList.remove('hidden');
        }

        // Resume polling if scan is running
        if (hasActiveScan) {
            startPolling();
        }
    } else if (view === 'history') {
        historyView.classList.remove('hidden');
        loadHistory();
    } else if (view === 'settings') {
        settingsView.classList.remove('hidden');
        loadSettings();
    }
}

function resetToNewScan() {
    // Stop any ongoing polling
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }

    // Clear logs and reset state
    if (terminalOutput) {
        terminalOutput.innerHTML = '<div class="text-gray-500 italic flex items-center gap-2"><span class="w-2 h-2 bg-gray-600 rounded-full animate-pulse"></span>Waiting for scan initialization...</div>';
    }
    lastLogId = 0;

    // Reset UI elements
    if (agentsList) agentsList.innerHTML = '';
    if (vulnsList) vulnsList.innerHTML = '';

    // Reset status
    isViewingHistory = false;
    updateStatusUI(false);

    // Reset form
    if (scanForm) scanForm.reset();
    updateTargetInputPlaceholder(targetTypeSelect.value);

    // Show config panel
    configPanel.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    stopBtn.classList.add('hidden');
    newScanBtn.classList.add('hidden');
}

async function startScan(target, targetType, instruction) {
    setLoading(true);

    try {
        const response = await fetch(`${API_BASE}/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target, targetType, instruction })
        });

        if (!response.ok) {
            let errorMsg = `Server error: ${response.status}`;
            try {
                const errorData = await response.json();
                console.error('Full error response:', errorData); // Debug log

                if (Array.isArray(errorData.detail)) {
                    // Handle FastAPI validation errors
                    errorMsg = errorData.detail.map(err => {
                        const field = err.loc ? err.loc[err.loc.length - 1] : 'Unknown field';
                        return `${field}: ${err.msg}`;
                    }).join('; ');
                } else if (typeof errorData.detail === 'string') {
                    errorMsg = errorData.detail;
                } else if (errorData.message) {
                    errorMsg = typeof errorData.message === 'object' ? JSON.stringify(errorData.message) : errorData.message;
                } else if (errorData.detail) {
                    errorMsg = JSON.stringify(errorData.detail);
                }
            } catch (e) {
                // If JSON parsing fails, use status text
                errorMsg = response.statusText || errorMsg;
            }
            showNotification(`Error starting scan: ${errorMsg}`, 'error');
            setLoading(false);
            return;
        }

        const data = await response.json();

        if (data.status === 'started') {
            switchToDashboard();
            startPolling();
            showNotification('Scan started successfully', 'success');
        } else {
            const errorMsg = data.message || 'Unknown error occurred';
            showNotification(`Error starting scan: ${errorMsg}`, 'error');
            setLoading(false);
        }
    } catch (error) {
        errorLog('Error starting scan', error);
        const errorMsg = error.message || 'Network error occurred';
        showNotification(`Failed to start scan: ${errorMsg}. Please check your connection and try again.`, 'error');
        setLoading(false);
    }
}

function setLoading(isLoading) {
    startBtn.disabled = isLoading;
    if (isLoading) {
        startBtn.innerHTML = `
            <svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            Initializing Agent...
        `;
        startBtn.classList.add('opacity-75', 'cursor-not-allowed');
    } else {
        startBtn.innerHTML = `
            <div class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
            <span class="relative flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                Start Security Scan
            </span>
        `;
        startBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
}

function switchToDashboard() {
    navigateTo('dashboard');
    configPanel.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
    if (terminalOutput) {
        terminalOutput.innerHTML = '<div class="text-gray-500 italic flex items-center gap-2"><span class="w-2 h-2 bg-gray-600 rounded-full animate-pulse"></span>Waiting for scan initialization...</div>';
    }
    lastLogId = 0;
    isViewingHistory = false;
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollStatus, 2000);
    pollStatus(); // Immediate call
}

async function pollStatus() {
    // Only poll if on dashboard
    if (currentView !== 'dashboard') {
        return null;
    }

    try {
        const response = await fetch(`${API_BASE}/status`);

        if (!response.ok) {
            throw new Error(`Status check failed: ${response.status}`);
        }

        const data = await response.json();

        updateStatusUI(data.is_running);
        if (data.logs) renderLogs(data.logs);
        if (data.agents) renderAgents(data.agents);
        if (data.vulnerabilities) renderVulns(data.vulnerabilities);

        if (!data.is_running && pollInterval) {
            // Scan finished or stopped
            clearInterval(pollInterval);
            pollInterval = null;
            if (stopBtn) stopBtn.classList.add('hidden');
            if (startBtn) {
                startBtn.disabled = false;
                setLoading(false); // Reset button state
            }
            // Show new scan button if on dashboard
            if (currentView === 'dashboard' && !isViewingHistory) {
                if (newScanBtn) newScanBtn.classList.remove('hidden');
            }
            // Show notification if scan completed (only if it had logs)
            if (data.logs && data.logs.length > 0) {
                showNotification('Scan completed successfully', 'success');
            }
        }

        return data;
    } catch (error) {
        errorLog('Polling error (non-critical, will retry)', error);
        // Don't show error notification for polling failures to avoid spam
        return null;
    }
}

function updateStatusUI(isRunning) {
    const indicator = document.getElementById('status-indicator');
    const newScanBtn = document.getElementById('new-scan-btn');

    if (isRunning) {
        statusDot.className = 'w-2 h-2 rounded-full bg-green-500 status-ring relative z-10';
        statusText.textContent = 'Scan in Progress';
        statusText.className = 'text-sm font-bold text-green-400 tracking-wide';
        indicator.className = 'flex items-center gap-3 px-4 py-3 rounded-xl bg-green-900/20 border border-green-500/30 transition-all duration-500';
        if (newScanBtn) newScanBtn.classList.add('hidden');
    } else {
        statusDot.className = 'w-2 h-2 rounded-full bg-gray-500 relative z-10';
        statusText.textContent = 'System Idle';
        statusText.className = 'text-sm font-medium text-gray-400';
        indicator.className = 'flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900/50 border border-gray-800/50 transition-all duration-500';

        // Show new scan button if we are on dashboard view
        if (currentView === 'dashboard' && document.getElementById('dashboard-view').classList.contains('hidden') === false) {
            if (newScanBtn) newScanBtn.classList.remove('hidden');
        }
    }
}

function renderLogs(logs, renderAll = false) {
    if (!logs || logs.length === 0) return;
    if (!terminalOutput) return;

    // Filter new logs unless we're rendering all (e.g., for history view)
    let logsToRender;
    if (renderAll) {
        logsToRender = logs;
        // Clear terminal first when rendering all
        terminalOutput.innerHTML = '';
    } else {
        logsToRender = logs.filter(log => (log.message_id || 0) > lastLogId);
        if (logsToRender.length === 0) return;
    }

    // Remove the initial "waiting" message if present
    const waitingMsg = terminalOutput.querySelector('.text-gray-500.italic');
    if (waitingMsg) {
        waitingMsg.remove();
    }

    const fragment = document.createDocumentFragment();

    logsToRender.forEach(log => {
        const div = document.createElement('div');
        div.className = 'terminal-line font-mono text-xs py-1 break-words border-l-2 border-transparent pl-2 hover:bg-white/5 transition-colors';

        let time = '--:--:--';
        try {
            if (log.timestamp) {
                time = new Date(log.timestamp).toLocaleTimeString([], { hour12: false });
            }
        } catch (e) {
            debugLog('Failed to parse log timestamp', log.timestamp);
        }

        const role = (log.role || 'unknown').toLowerCase();
        let roleColor = 'text-gray-400';
        let roleLabel = role.toUpperCase();

        if (role === 'user') {
            roleColor = 'text-blue-400';
            div.classList.add('border-l-blue-500/30');
        } else if (role === 'assistant' || role === 'agent') {
            roleColor = 'text-green-400';
            div.classList.add('border-l-green-500/30');
            roleLabel = 'STRIX';
        } else if (role === 'system') {
            roleColor = 'text-purple-400';
            div.classList.add('border-l-purple-500/30');
        }

        const content = escapeHtml(log.content || '');

        div.innerHTML = `
            <span class="text-gray-600 mr-2">[${time}]</span>
            <span class="${roleColor} font-bold mr-2">${roleLabel}:</span>
            <span class="text-gray-300">${content}</span>
        `;

        fragment.appendChild(div);
        lastLogId = Math.max(lastLogId, log.message_id || 0);
    });

    terminalOutput.appendChild(fragment);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function renderAgents(agents) {
    if (!agentsList) return;

    agentsList.innerHTML = '';

    if (!agents || typeof agents !== 'object') {
        agentsList.innerHTML = '<div class="text-xs text-gray-500 text-center py-4 italic">No active agents</div>';
        return;
    }

    const agentsArray = Object.values(agents);

    if (agentsArray.length === 0) {
        agentsList.innerHTML = '<div class="text-xs text-gray-500 text-center py-4 italic">No active agents</div>';
        return;
    }

    agentsArray.forEach(agent => {
        const div = document.createElement('div');
        const isRunning = agent.status === 'running';
        const statusColor = isRunning ? 'bg-green-500' : 'bg-gray-500';
        const statusGlow = isRunning ? 'shadow-[0_0_10px_rgba(34,197,94,0.4)]' : '';

        div.className = 'glass-card rounded-lg p-3 flex items-center justify-between group';
        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <div class="relative">
                    <div class="w-2.5 h-2.5 rounded-full ${statusColor} ${statusGlow} ${isRunning ? 'animate-pulse' : ''}"></div>
                    ${isRunning ? '<div class="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75"></div>' : ''}
                </div>
                <div class="min-w-0">
                    <div class="text-sm font-bold text-gray-200 truncate group-hover:text-white transition-colors">${agent.name}</div>
                    <div class="text-xs text-gray-500 truncate max-w-[120px]">${agent.task || 'Initializing...'}</div>
                </div>
            </div>
            <div class="text-[10px] font-mono uppercase tracking-wider ${isRunning ? 'text-green-400' : 'text-gray-500'} bg-black/20 px-2 py-1 rounded">
                ${agent.status}
            </div>
        `;
        agentsList.appendChild(div);
    });
}

function renderVulns(vulns) {
    if (!vulnsList) return;

    if (!vulns || !Array.isArray(vulns) || vulns.length === 0) {
        vulnsList.innerHTML = `
            <div class="flex flex-col items-center justify-center h-32 text-gray-600 gap-2">
                <svg class="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span class="text-xs">No vulnerabilities found yet</span>
            </div>
        `;
        return;
    }

    vulnsList.innerHTML = '';
    vulns.forEach(vuln => {
        if (!vuln) return;

        const div = document.createElement('div');

        const severityConfig = {
            'critical': { color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/50', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
            'high': { color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/50', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
            'medium': { color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/50', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
            'low': { color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/50', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' }
        };

        const severity = (vuln.severity || 'low').toLowerCase();
        const config = severityConfig[severity] || severityConfig['low'];

        div.className = `glass-card rounded-lg p-4 border-l-4 ${config.border} hover:bg-white/5 transition-colors cursor-default`;
        div.style.borderLeftColor = ''; // Reset inline style if any

        // We use tailwind classes for border color, but need to ensure specificity
        if (severity === 'critical') div.classList.add('border-l-red-500');
        else if (severity === 'high') div.classList.add('border-l-orange-500');
        else if (severity === 'medium') div.classList.add('border-l-yellow-500');
        else div.classList.add('border-l-blue-500');

        const title = escapeHtml(vuln.title || 'Untitled Vulnerability');
        const content = escapeHtml(vuln.content || 'No description available');
        const severityLabel = escapeHtml(severity);

        // Build border class based on severity
        const borderClasses = {
            'critical': 'border-red-500/20',
            'high': 'border-orange-500/20',
            'medium': 'border-yellow-500/20',
            'low': 'border-blue-500/20'
        };
        const borderClass = borderClasses[severity] || 'border-blue-500/20';

        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h4 class="text-sm font-bold text-white leading-tight">${title}</h4>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${config.bg} ${config.color} border ${borderClass}">${severityLabel}</span>
            </div>
            <p class="text-xs text-gray-400 line-clamp-2 leading-relaxed">${content}</p>
        `;
        vulnsList.appendChild(div);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Helper Functions ---

function updateTargetInputPlaceholder(targetType) {
    if (!targetInput) return;

    const placeholders = {
        'url': 'https://example.com',
        'repo': 'https://github.com/user/repo.git or /path/to/repo',
        'local': '/path/to/local/directory'
    };

    targetInput.placeholder = placeholders[targetType] || 'Enter target...';
}

function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existing = document.querySelector('.notification-toast');
    if (existing) {
        existing.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'notification-toast fixed top-4 right-4 z-50 px-6 py-4 rounded-xl shadow-2xl backdrop-blur-md border animate-fade-in max-w-md';

    const colors = {
        'success': 'bg-green-900/80 border-green-500/50 text-green-100',
        'error': 'bg-red-900/80 border-red-500/50 text-red-100',
        'warning': 'bg-yellow-900/80 border-yellow-500/50 text-yellow-100',
        'info': 'bg-blue-900/80 border-blue-500/50 text-blue-100'
    };

    notification.className += ' ' + (colors[type] || colors.info);

    const icons = {
        'success': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        'error': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        'warning': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
        'info': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    notification.innerHTML = `
        <div class="flex items-center gap-3">
            ${icons[type] || icons.info}
            <span class="font-medium">${escapeHtml(message)}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-auto text-current opacity-70 hover:opacity-100 transition-opacity">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// --- Settings Functions ---

async function loadSettings() {
    const modelInput = document.getElementById('setting-model');
    const apiBaseInput = document.getElementById('setting-api-base');
    const timeoutInput = document.getElementById('setting-timeout');
    const instructionInput = document.getElementById('setting-instruction');

    if (!modelInput || !apiBaseInput || !timeoutInput || !instructionInput) {
        console.error('Settings form elements not found');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/config`);

        if (!response.ok) {
            throw new Error(`Failed to load settings: ${response.status} ${response.statusText}`);
        }

        const settings = await response.json();

        modelInput.value = settings.model_name || '';
        apiBaseInput.value = settings.api_base || '';
        timeoutInput.value = settings.timeout || 600;
        instructionInput.value = settings.default_instruction || '';

        console.log('Settings loaded successfully');
    } catch (error) {
        errorLog('Failed to load settings', error);
        showNotification('Failed to load settings. Using defaults.', 'warning');
        // Set defaults if loading fails
        modelInput.value = 'openai/gpt-4';
        timeoutInput.value = 600;
    }
}

async function saveSettings() {
    if (isSavingSettings) {
        return; // Prevent duplicate saves
    }

    const modelInput = document.getElementById('setting-model');
    const apiBaseInput = document.getElementById('setting-api-base');
    const timeoutInput = document.getElementById('setting-timeout');
    const instructionInput = document.getElementById('setting-instruction');
    const submitBtn = settingsForm.querySelector('button[type="submit"]');

    if (!modelInput || !apiBaseInput || !timeoutInput || !instructionInput) {
        showNotification('Settings form elements not found', 'error');
        return;
    }

    const settings = {
        model_name: modelInput.value.trim() || 'openai/gpt-4',
        api_base: apiBaseInput.value.trim() || null,
        timeout: parseInt(timeoutInput.value) || 600,
        default_instruction: instructionInput.value.trim() || null
    };

    // Validate timeout
    if (settings.timeout < 1 || settings.timeout > 3600) {
        showNotification('Timeout must be between 1 and 3600 seconds', 'error');
        return;
    }

    isSavingSettings = true;
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
        <svg class="animate-spin h-4 w-4 mr-2 inline" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        Saving...
    `;

    try {
        const response = await fetch(`${API_BASE}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `Server error: ${response.status}`);
        }

        const result = await response.json();
        showNotification('Settings saved successfully!', 'success');
        debugLog('Settings saved successfully', result);
    } catch (error) {
        errorLog('Failed to save settings', error);
        showNotification(`Error saving settings: ${error.message}`, 'error');
    } finally {
        isSavingSettings = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
}

// --- History Functions ---

async function loadHistory() {
    if (isLoadingHistory || !historyList) {
        return;
    }

    isLoadingHistory = true;
    const originalBtnHTML = refreshHistoryBtn.innerHTML;
    refreshHistoryBtn.disabled = true;
    refreshHistoryBtn.innerHTML = `
        <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
    `;

    historyList.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">Loading history...</td></tr>';

    try {
        const response = await fetch(`${API_BASE}/runs`);

        if (!response.ok) {
            throw new Error(`Failed to load history: ${response.status} ${response.statusText}`);
        }

        const runs = await response.json();

        historyList.innerHTML = '';

        if (!runs || runs.length === 0) {
            historyList.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">No scan history available</td></tr>';
            return;
        }

        runs.forEach(run => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-white/5 transition-colors';

            let date = 'Unknown';
            try {
                date = new Date(run.start_time).toLocaleString();
            } catch (e) {
                debugLog('Failed to parse date', run.start_time);
            }

            const vulnCount = run.vuln_count || 0;
            const runId = escapeHtml(run.run_id || '');
            const runName = escapeHtml(run.run_name || run.run_id || 'Unnamed Run');

            tr.innerHTML = `
                <td class="px-6 py-4 font-medium text-white">${runName}</td>
                <td class="px-6 py-4 text-gray-400">${date}</td>
                <td class="px-6 py-4"><span class="px-2 py-1 rounded text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20 uppercase">Completed</span></td>
                <td class="px-6 py-4 text-center font-mono text-gray-300">${vulnCount}</td>
                <td class="px-6 py-4 text-right">
                    <button onclick="viewRun('${runId}')" class="text-blue-400 hover:text-blue-300 font-medium text-xs uppercase tracking-wider hover:underline transition-colors">View Report</button>
                </td>
            `;
            historyList.appendChild(tr);
        });
    } catch (error) {
        errorLog('Failed to load history', error);
        historyList.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-red-400">Error loading history: ${escapeHtml(error.message)}</td></tr>`;
        showNotification('Failed to load scan history', 'error');
    } finally {
        isLoadingHistory = false;
        refreshHistoryBtn.disabled = false;
        refreshHistoryBtn.innerHTML = originalBtnHTML;
    }
}

async function viewRun(runId) {
    try {
        showNotification('Loading run details...', 'info');

        const response = await fetch(`${API_BASE}/runs/${runId}`);

        if (!response.ok) {
            throw new Error(`Failed to load run: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Reset state
        lastLogId = 0;
        isViewingHistory = true;

        // Clear existing data
        if (terminalOutput) terminalOutput.innerHTML = '';
        if (agentsList) agentsList.innerHTML = '';
        if (vulnsList) vulnsList.innerHTML = '';

        // Switch to dashboard view
        navigateTo('dashboard');

        // Populate dashboard with historical data
        updateStatusUI(false);

        // Render all logs (don't filter by lastLogId since we're loading from scratch)
        if (data.logs && data.logs.length > 0) {
            lastLogId = 0; // Reset to show all logs
            renderLogs(data.logs, true); // Render all logs
        } else {
            if (terminalOutput) {
                terminalOutput.innerHTML = '<div class="text-gray-500 italic">No logs available for this run</div>';
            }
        }

        renderAgents(data.agents || {});
        renderVulns(data.vulnerabilities || []);

        // Hide config panel, show dashboard
        configPanel.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        stopBtn.classList.add('hidden'); // Hide stop button for history
        newScanBtn.classList.remove('hidden'); // Show new scan button

        // Indicate we are viewing history
        if (statusText) {
            statusText.textContent = 'Viewing History';
            statusText.className = 'text-sm font-medium text-blue-400';
        }
        if (statusDot) {
            statusDot.className = 'w-2 h-2 rounded-full bg-blue-500';
        }

        showNotification('Run details loaded successfully', 'success');
    } catch (error) {
        errorLog('Failed to load run details', error);
        showNotification(`Failed to load run details: ${error.message}`, 'error');
    }
}

// Expose viewRun to global scope for onclick handler
window.viewRun = viewRun;

// Initialize on page load
function initializeApp() {
    // Ensure initial state is correct
    navigateTo('dashboard');

    // Check if there's an active scan on load (but don't start polling if nothing is running)
    pollStatus().then(data => {
        if (data && data.is_running) {
            startPolling();
        }
    }).catch(err => {
        debugLog('Initial status check failed (this is normal if no scan is running)', err);
        // Don't show error to user on initial load failure - might just be no active scan
    });
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM is already ready
    initializeApp();
}

