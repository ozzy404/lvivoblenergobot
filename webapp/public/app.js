// Telegram Web App initialization
const tg = window.Telegram.WebApp;
tg.expand();
tg.enableClosingConfirmation();

// API Configuration
const API_BASE = 'https://power-api.loe.lviv.ua/api';

// State management
const state = {
    otgs: [],
    cities: [],
    streets: [],
    accounts: [],
    selected: {
        otg: null,
        city: null,
        street: null,
        account: null
    },
    loading: false
};

// DOM Elements
const elements = {
    otgSearch: document.getElementById('otg-search'),
    otgDropdown: document.getElementById('otg-dropdown'),
    otgSelected: document.getElementById('otg-selected'),
    otgSelectedText: document.getElementById('otg-selected-text'),
    
    citySearch: document.getElementById('city-search'),
    cityDropdown: document.getElementById('city-dropdown'),
    citySelected: document.getElementById('city-selected'),
    citySelectedText: document.getElementById('city-selected-text'),
    
    streetSearch: document.getElementById('street-search'),
    streetDropdown: document.getElementById('street-dropdown'),
    streetSelected: document.getElementById('street-selected'),
    streetSelectedText: document.getElementById('street-selected-text'),
    
    accountSearch: document.getElementById('account-search'),
    accountDropdown: document.getElementById('account-dropdown'),
    accountSelected: document.getElementById('account-selected'),
    accountSelectedText: document.getElementById('account-selected-text'),
    
    cityStep: document.getElementById('city-step'),
    streetStep: document.getElementById('street-step'),
    accountStep: document.getElementById('account-step'),
    
    submitBtn: document.getElementById('submit-btn'),
    loadingIndicator: document.getElementById('loading'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn')
};

// API Functions
async function fetchData(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function loadOtgs() {
    showLoading();
    try {
        const data = await fetchData('/pw_otgs?pagination=false');
        state.otgs = data['hydra:member'] || data.member || data;
        hideLoading();
        initSearchableDropdown('otg', state.otgs, formatOtg);
    } catch (error) {
        showError('Не вдалося завантажити список громад');
    }
}

async function loadCities(otgId) {
    showLoading();
    try {
        const data = await fetchData(`/pw_cities?pagination=false&otg.id=${otgId}`);
        state.cities = data['hydra:member'] || data.member || data;
        hideLoading();
        enableStep('city');
        initSearchableDropdown('city', state.cities, formatCity);
    } catch (error) {
        showError('Не вдалося завантажити список міст');
    }
}

async function loadStreets(cityId) {
    showLoading();
    try {
        const data = await fetchData(`/pw_streets?pagination=false&city.id=${cityId}`);
        state.streets = data['hydra:member'] || data.member || data;
        hideLoading();
        enableStep('street');
        initSearchableDropdown('street', state.streets, formatStreet);
    } catch (error) {
        showError('Не вдалося завантажити список вулиць');
    }
}

async function loadAccounts(cityId, streetId) {
    showLoading();
    try {
        const data = await fetchData(`/pw_accounts?pagination=false&city.id=${cityId}&street.id=${streetId}`);
        state.accounts = data['hydra:member'] || data.member || data;
        hideLoading();
        enableStep('account');
        initSearchableDropdown('account', state.accounts, formatAccount);
    } catch (error) {
        showError('Не вдалося завантажити список будинків');
    }
}

// Formatters
function formatOtg(otg) {
    return {
        id: otg.id,
        name: otg.name || otg.title,
        info: ''
    };
}

function formatCity(city) {
    return {
        id: city.id,
        name: city.name || city.title,
        info: city.otg?.name || ''
    };
}

function formatStreet(street) {
    return {
        id: street.id,
        name: street.name || street.title,
        info: street.streetType?.name || ''
    };
}

function formatAccount(account) {
    const building = account.name || account.building || account.budynok || '';
    const group = account.chergGpv || account.gpv || '';
    return {
        id: account.id,
        name: building,
        info: group ? `Черга: ${formatGroup(group)}` : '',
        rawData: account
    };
}

function formatGroup(gpv) {
    if (!gpv) return '';
    const gpvStr = String(gpv);
    if (gpvStr.length === 2) {
        return `${gpvStr[0]}.${gpvStr[1]}`;
    }
    return gpvStr;
}

// Dropdown functionality
function initSearchableDropdown(type, items, formatter) {
    const searchInput = elements[`${type}Search`];
    const dropdown = elements[`${type}Dropdown`];
    
    // Clear previous
    dropdown.innerHTML = '';
    searchInput.value = '';
    
    // Format and render items
    const formattedItems = items.map(formatter);
    renderDropdownItems(dropdown, formattedItems, type);
    
    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const filtered = formattedItems.filter(item => 
            item.name.toLowerCase().includes(searchTerm)
        );
        renderDropdownItems(dropdown, filtered, type);
        dropdown.classList.add('active');
    });
    
    // Focus/blur handling
    searchInput.addEventListener('focus', () => {
        dropdown.classList.add('active');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest(`#${type}-step`)) {
            dropdown.classList.remove('active');
        }
    });
}

function renderDropdownItems(dropdown, items, type) {
    dropdown.innerHTML = items.map((item, index) => `
        <div class="dropdown-item" data-id="${item.id}" data-index="${index}">
            <div class="item-name">${escapeHtml(item.name)}</div>
            ${item.info ? `<div class="item-info">${escapeHtml(item.info)}</div>` : ''}
        </div>
    `).join('');
    
    // Add click handlers
    dropdown.querySelectorAll('.dropdown-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            const item = items.find(i => String(i.id) === id);
            selectItem(type, item);
        });
    });
}

function selectItem(type, item) {
    const dropdown = elements[`${type}Dropdown`];
    const searchInput = elements[`${type}Search`];
    const selectedDiv = elements[`${type}Selected`];
    const selectedText = elements[`${type}SelectedText`];
    
    // Update UI
    searchInput.value = item.name;
    dropdown.classList.remove('active');
    selectedDiv.classList.add('active');
    selectedText.textContent = item.name;
    
    // Update state
    state.selected[type] = item;
    
    // Handle dependent dropdowns
    switch(type) {
        case 'otg':
            resetStep('city');
            resetStep('street');
            resetStep('account');
            loadCities(item.id);
            break;
        case 'city':
            resetStep('street');
            resetStep('account');
            loadStreets(item.id);
            break;
        case 'street':
            resetStep('account');
            loadAccounts(state.selected.city.id, item.id);
            break;
        case 'account':
            enableSubmit();
            break;
    }
    
    // Haptic feedback
    tg.HapticFeedback.selectionChanged();
}

// Step management
function enableStep(step) {
    const stepEl = elements[`${step}Step`];
    stepEl.classList.remove('disabled');
    elements[`${step}Search`].disabled = false;
    stepEl.classList.add('fade-in');
}

function resetStep(step) {
    const stepEl = elements[`${step}Step`];
    stepEl.classList.add('disabled');
    elements[`${step}Search`].value = '';
    elements[`${step}Search`].disabled = true;
    elements[`${step}Dropdown`].innerHTML = '';
    elements[`${step}Dropdown`].classList.remove('active');
    elements[`${step}Selected`].classList.remove('active');
    state.selected[step] = null;
    
    if (step === 'account') {
        disableSubmit();
    }
}

// Submit button
function enableSubmit() {
    elements.submitBtn.disabled = false;
}

function disableSubmit() {
    elements.submitBtn.disabled = true;
}

// Loading and error states
function showLoading() {
    elements.loadingIndicator.style.display = 'block';
    elements.errorMessage.style.display = 'none';
    state.loading = true;
}

function hideLoading() {
    elements.loadingIndicator.style.display = 'none';
    state.loading = false;
}

function showError(message) {
    elements.loadingIndicator.style.display = 'none';
    elements.errorMessage.style.display = 'block';
    elements.errorMessage.querySelector('p').textContent = message;
    state.loading = false;
}

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Submit data to Telegram
function submitSelection() {
    const account = state.selected.account;
    if (!account) return;
    
    const data = {
        city_id: state.selected.city.id,
        city_name: state.selected.city.name,
        street_id: state.selected.street.id,
        street_name: state.selected.street.name,
        building_name: account.name,
        cherg_gpv: account.rawData?.chergGpv || account.rawData?.gpv || ''
    };
    
    tg.HapticFeedback.notificationOccurred('success');
    tg.sendData(JSON.stringify(data));
}

// Clear button handlers
document.querySelectorAll('.clear-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const input = e.target.previousElementSibling;
        input.value = '';
        input.dispatchEvent(new Event('input'));
        input.focus();
    });
});

// Retry button handler
elements.retryBtn.addEventListener('click', () => {
    loadOtgs();
});

// Submit button handler
elements.submitBtn.addEventListener('click', submitSelection);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    tg.ready();
    
    // Apply Telegram theme colors if available
    if (tg.themeParams) {
        document.documentElement.style.setProperty('--bg-primary', tg.themeParams.bg_color || '#1e1e2e');
        document.documentElement.style.setProperty('--bg-secondary', tg.themeParams.secondary_bg_color || '#2d2d44');
        document.documentElement.style.setProperty('--text-primary', tg.themeParams.text_color || '#ffffff');
        document.documentElement.style.setProperty('--accent-color', tg.themeParams.button_color || '#6c5ce7');
    }
    
    loadOtgs();
});
