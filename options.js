// Initialize page text
function initializeText() {
    document.title = chrome.i18n.getMessage('optionsTitle');
    document.querySelector('h1').textContent = chrome.i18n.getMessage('optionsTitle');
    document.querySelector('label[for="apiBaseUrl"]').textContent = chrome.i18n.getMessage('apiBaseUrlLabel');
    document.querySelector('#apiBaseUrl').placeholder = chrome.i18n.getMessage('apiBaseUrlPlaceholder');
    document.querySelector('label[for="apiKey"]').textContent = chrome.i18n.getMessage('apiKeyLabel');
    document.querySelector('button[type="submit"]').textContent = chrome.i18n.getMessage('saveButton');
}

// Save settings
async function saveSettings() {
    const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    
    try {
        // Validate URL format
        try {
            new URL(apiBaseUrl);
        } catch (error) {
            throw new Error(chrome.i18n.getMessage('invalidApiUrl'));
        }
        
        // Validate API Key
        if (!apiKey) {
            throw new Error(chrome.i18n.getMessage('invalidApiKey'));
        }
        
        await chrome.storage.sync.set({
            apiBaseUrl,
            apiKey
        });
        showStatus(chrome.i18n.getMessage('settingsSaved'), 'success');
    } catch (error) {
        showStatus(chrome.i18n.getMessage('settingsSaveError', error.message), 'error');
    }
}

// Load settings
async function loadSettings() {
    try {
        const settings = await chrome.storage.sync.get(['apiBaseUrl', 'apiKey']);
        if (settings.apiBaseUrl) {
            document.getElementById('apiBaseUrl').value = settings.apiBaseUrl;
        }
        if (settings.apiKey) {
            document.getElementById('apiKey').value = settings.apiKey;
        }
    } catch (error) {
        showStatus(chrome.i18n.getMessage('settingsLoadError', error.message), 'error');
    }
}

// Show status message
function showStatus(message, type = 'success') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status ' + type;
    status.style.display = 'block';
    
    setTimeout(() => {
        status.style.display = 'none';
    }, 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeText();
    loadSettings();
    
    document.getElementById('settingsForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveSettings();
    });
});
