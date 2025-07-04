// Constants
const API_VERSION = 'v1';
const RULE_TYPE = {
    BLOCK: 'block',
    KEEP: 'keep'
};

// Check if current page is Miniflux
function isMiniflux() {
    const metaTag = document.querySelector('meta[name="apple-mobile-web-app-title"][content="Miniflux"]');
    return !!metaTag;
}

// Get Miniflux interface language
function getMinifluxLanguage() {
    const html = document.documentElement;
    const lang = html.getAttribute('lang');
    return lang ? lang.replace('-', '_') : 'en';
}

let messages = null;

async function loadLocale(language) {
    const url = chrome.runtime.getURL(`_locales/${language}/messages.json`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to load language file');
    }
    return await response.json();
}

// Get message based on Miniflux language
function getLocalizedMessage(messageKey, ...args) {
    if (!messages) {
        console.error('Messages not loaded');
        return messageKey;
    }
    let message = messages[messageKey].message || chrome.i18n.getMessage(messageKey);
    if (args.length > 0 && message) {
        // Handle both %s and $PLACEHOLDER$ format
        if (messages[messageKey].placeholders) {
            // Handle $PLACEHOLDER$ format
            Object.keys(messages[messageKey].placeholders).forEach((placeholder, index) => {
                const regex = new RegExp('\\$' + placeholder.toUpperCase() + '\\$', 'g');
                message = message.replace(regex, args[index] || '');
            });
        } else {
            // Handle %s format
            message = message.replace(/%s/g, () => args.shift());
        }
    }
    return message;
}

// Create update rule button
function createUpdateRuleButton() {
    const button = document.createElement('li');
    button.className = 'item-meta-icons-update-rule';
    button.innerHTML = `
        <button
            title="${getLocalizedMessage('updateButton')}"
            data-update-rule="true"
            data-label-loading="${getLocalizedMessage('saving')}"
        >
            <svg class="icon" aria-hidden="true">
                <use xlink:href="/icon/sprite.svg#icon-edit"/>
            </svg>
            <span class="icon-label">${getLocalizedMessage('updateButton')}</span>
        </button>
    `;
    return button;
}

// Create dialog
function createDialog(feedId) {
    const dialog = document.createElement('div');
    dialog.className = 'me-dialog';
    dialog.innerHTML = `
        <div class="me-dialog-content">
            <h3>${getLocalizedMessage('dialogTitle')}</h3>
            <div class="me-form-group">
                <label>${getLocalizedMessage('ruleLabel')}</label>
                <input type="text" id="ruleInput" placeholder="${getLocalizedMessage('rulePlaceholder')}">
            </div>
            <div class="me-form-group">
                <label>${getLocalizedMessage('typeLabel')}</label>
                <div class="me-radio-group">
                    <label>
                        <input type="radio" name="ruleType" value="${RULE_TYPE.BLOCK}" checked>
                        ${getLocalizedMessage('blockRule')}
                    </label>
                    <label>
                        <input type="radio" name="ruleType" value="${RULE_TYPE.KEEP}">
                        ${getLocalizedMessage('keepRule')}
                    </label>
                </div>
            </div>
            <div class="me-dialog-buttons">
                <button id="saveRule">${getLocalizedMessage('saveButton')}</button>
                <button id="cancelRule">${getLocalizedMessage('cancelButton')}</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Auto focus input field
    dialog.querySelector('#ruleInput').focus();
    
    // Handle save action
    const handleSave = async () => {
        const rule = dialog.querySelector('#ruleInput').value;
        if (!rule.trim()) {
            return;
        }
        const type = dialog.querySelector('input[name="ruleType"]:checked').value;
        try {
            await updateFeedRule(feedId, rule, type);
            dialog.remove();
            location.reload();
        } catch (error) {
            alert(error.message);
        }
    };
    
    // Bind events
    dialog.querySelector('#ruleInput').addEventListener('keypress', async (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await handleSave();
        }
    });
    
    dialog.querySelector('#saveRule').addEventListener('click', handleSave);
    
    dialog.querySelector('#cancelRule').addEventListener('click', () => {
        dialog.remove();
    });
}

// Get settings
async function getSettings() {
    try {
        const settings = await chrome.storage.sync.get(['apiBaseUrl', 'apiKey']);
        if (!settings.apiBaseUrl || !settings.apiKey) {
            throw new Error(getLocalizedMessage('configureFirst'));
        }
        return settings;
    } catch (error) {
        console.error(getLocalizedMessage('logGetSettingsFailed', error.message));
        throw error;
    }
}

// Validate settings
function validateSettings(settings) {
    if (!settings.apiBaseUrl || !settings.apiKey) {
        throw new Error(getLocalizedMessage('configureFirst'));
    }
    try {
        new URL(settings.apiBaseUrl);
    } catch (error) {
        throw new Error(getLocalizedMessage('invalidApiUrl'));
    }
}

// Build API URL
function buildApiUrl(baseUrl, path) {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/$/, ''); // Remove trailing slash
    return `${url.toString()}/${API_VERSION}${path}`;
}

// Mark entries as read based on rule
async function markEntriesAsReadByRule(feedId, rule, type, settings) {
    let pattern;
    try {
        // Check if the rule starts with (?i) and remove it if present
        const hasIgnoreCase = rule.startsWith('(?i)');
        const cleanRule = hasIgnoreCase ? rule.slice(4) : rule;
        // Add 'i' flag only if (?i) was present
        pattern = new RegExp(cleanRule, hasIgnoreCase ? 'i' : '');
    } catch (error) {
        // For complicated RE2 regular expressions, print the error message and do not mark entries as read
        console.error(getLocalizedMessage('invalidJsRegex', error.message));
        return;
    }

    // Get all unread entries
    const entriesToUpdate = [];
    const LIMIT = 100;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
        const entriesResponse = await fetch(
            buildApiUrl(settings.apiBaseUrl, `/feeds/${feedId}/entries?status=unread&limit=${LIMIT}&offset=${offset}`), {
                headers: {
                    'X-Auth-Token': settings.apiKey
                }
            }
        );
        
        if (!entriesResponse.ok) {
            throw new Error(getLocalizedMessage('getEntriesError', entriesResponse.statusText));
        }
        
        const entries = await entriesResponse.json();
        
        // Filter entries based on rule
        for (const entry of entries.entries || []) {
            const matchesContent = entry.content && pattern.test(entry.content);
            const matchesTitle = entry.title && pattern.test(entry.title);
            const matches = matchesContent || matchesTitle;
            
            if ((type === RULE_TYPE.BLOCK && matches) || (type === RULE_TYPE.KEEP && !matches)) {
                entriesToUpdate.push(entry.id);
            }
        }
        
        // Check if there are more entries
        hasMore = entries.entries && entries.entries.length === LIMIT;
        offset += LIMIT;
    }
    
    // Batch update entry status
    if (entriesToUpdate.length > 0) {
        const updateEntriesResponse = await fetch(
            buildApiUrl(settings.apiBaseUrl, '/entries'), {
                method: 'PUT',
                headers: {
                    'X-Auth-Token': settings.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    entry_ids: entriesToUpdate,
                    status: 'read'
                })
            }
        );
        
        if (!updateEntriesResponse.ok) {
            throw new Error(getLocalizedMessage('updateEntriesError', updateEntriesResponse.statusText));
        }
    }
}

// Update feed rule
async function updateFeedRule(feedId, rule, type) {
    try {
        const settings = await getSettings();
        validateSettings(settings);
        
        const response = await fetch(buildApiUrl(settings.apiBaseUrl, `/feeds/${feedId}`), {
            method: 'GET',
            headers: {
                'X-Auth-Token': settings.apiKey
            }
        });
        
        if (!response.ok) {
            throw new Error(getLocalizedMessage('getFeedError', response.statusText));
        }
        
        const feed = await response.json();
        
        // Prepare update data
        const updateData = {};
        
        if (type === RULE_TYPE.BLOCK) {
            const currentRules = feed.blocklist_rules ? feed.blocklist_rules.split('|') : [];
            currentRules.push(rule);
            updateData.blocklist_rules = [...new Set(currentRules)].join('|');
        } else {
            const currentRules = feed.keeplist_rules ? feed.keeplist_rules.split('|') : [];
            currentRules.push(rule);
            updateData.keeplist_rules = [...new Set(currentRules)].join('|');
        }
        
        // Update feed
        const updateResponse = await fetch(buildApiUrl(settings.apiBaseUrl, `/feeds/${feedId}`), {
            method: 'PUT',
            headers: {
                'X-Auth-Token': settings.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });
        
        if (!updateResponse.ok) {
            const responseData = await updateResponse.json();
            throw new Error(getLocalizedMessage('updateFeedError', updateResponse.statusText || responseData.error_message || 'Unknown error'));
        }
        
        // Mark matching entries as read
        await markEntriesAsReadByRule(feedId, rule, type, settings);
    } catch (error) {
        console.error(getLocalizedMessage('logUpdateRuleFailed', error.message));
        throw error;
    }
}

// Add button to entry
function addButtonToEntry(article) {
    const metaIcons = article.querySelector('.item-meta-icons');
    if (!metaIcons) return;
    
    const feedLink = article.querySelector('.item-meta-info-title a[data-feed-link]');
    if (!feedLink) return;
    
    const feedUrl = feedLink.getAttribute('href');
    const feedId = feedUrl.split('/')[2];
    
    const updateButton = createUpdateRuleButton();
    updateButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        createDialog(feedId);
    });
    
    metaIcons.appendChild(updateButton);
}

// --- Thumbnail Functions ---

// Fetch entry data using history route to avoid marking as read
async function getEntryData(entryId) {
    const entryUrl = new URL(`/history/entry/${entryId}`, window.location.origin);
    const response = await fetch(entryUrl, {
        headers: { 'Content-Type': 'text/html' }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch entry data for ${entryId}`);
    }
    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
}

// Extract thumbnail URL from the entry's DOM
function getThumbnailUrl(dom) {
    // Priority 1: Enclosure image
    const imageEnclosure = dom.querySelector('.enclosure-image img');
    if (imageEnclosure && imageEnclosure.src) {
        return imageEnclosure.src;
    }

    // Priority 2: First image in the content
    const img = dom.querySelector(".entry-content img");
    if (img && img.src) {
        return img.src;
    }
    return null;
}

// Create the thumbnail element with mouseover preview
function createThumbnailElement(thumbnailUrl) {
    const thumbnailElement = document.createElement("div");
    thumbnailElement.className = "entry-thumbnail";

    const thumbnailImage = document.createElement("img");
    thumbnailImage.src = thumbnailUrl;
    thumbnailImage.alt = "Thumbnail";

    const enlargedImageContainer = document.createElement("div");
    enlargedImageContainer.className = "enlarged-image";

    const enlargedImage = document.createElement("img");
    enlargedImage.src = thumbnailUrl;

    enlargedImageContainer.appendChild(enlargedImage);
    thumbnailElement.appendChild(thumbnailImage);
    thumbnailElement.appendChild(enlargedImageContainer);

    thumbnailElement.addEventListener("mouseenter", (event) => {
        const rect = thumbnailImage.getBoundingClientRect();
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;

        const viewportHeight = window.innerHeight;
        const isNearBottom = rect.bottom > viewportHeight / 2;

        enlargedImageContainer.style.display = "block";
        enlargedImageContainer.style.right = `${window.innerWidth - rect.left}px`;

        if (isNearBottom) {
            enlargedImageContainer.style.top = `${rect.bottom + scrollY - enlargedImageContainer.offsetHeight}px`;
        } else {
            enlargedImageContainer.style.top = `${rect.top + scrollY}px`;
        }
    });

    thumbnailElement.addEventListener("mouseleave", () => {
        enlargedImageContainer.style.display = "none";
    });

    return thumbnailElement;
}

// Add thumbnail to a single entry
async function addThumbnailToEntry(article) {
    // Check if thumbnail already exists
    if (article.querySelector('.entry-thumbnail')) {
        return;
    }

    const entryId = article.dataset.id;
    if (!entryId) return;

    try {
        const entryData = await getEntryData(entryId);
        const thumbnailUrl = getThumbnailUrl(entryData);

        if (thumbnailUrl) {
            const thumbnailElement = createThumbnailElement(thumbnailUrl);
            article.insertAdjacentElement("afterbegin", thumbnailElement);
        }
    } catch (error) {
        console.error(`Miniflux Enhancer: Failed to add thumbnail for entry ${entryId}`, error);
    }
}

// Initialize
async function init() {
    if (!isMiniflux()) {
        return;
    }

    // Add class to main element based on URL
    const path = window.location.pathname;
    const feedMatch = path.match(/^\/feed\/(\d+)/);
    const categoryMatch = path.match(/^\/category\/(\d+)/);
    const mainElement = document.querySelector('main');

    if (mainElement) {
        if (feedMatch) {
            const feedId = feedMatch[1];
            mainElement.classList.add(`feed-${feedId}`);
        } else if (categoryMatch) {
            const categoryId = categoryMatch[1];
            mainElement.classList.add(`category-${categoryId}`);
        }
    }

    // Load localized messages based on Miniflux language
    try {
        const minifluxLang = getMinifluxLanguage();
        messages = await loadLocale(minifluxLang);
    } catch (error) {
        console.error('Failed to load messages:', error);
        messages = {};
    }

    // Process each entry
    const articles = document.querySelectorAll('article.item');
    articles.forEach(article => {
        addButtonToEntry(article);
        addThumbnailToEntry(article);
    });
    
    // Watch for new entries
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.matches('article.item')) {
                    addButtonToEntry(node);
                    addThumbnailToEntry(node);
                }
            });
        });
    });
    
    const container = document.querySelector('.items');
    if (container) {
        observer.observe(container, { childList: true });
    }
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
