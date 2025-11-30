// Telegram Web App initialization
const tg = window.Telegram.WebApp;
tg.expand();
try { tg.enableClosingConfirmation(); } catch(e) {}

// API Configuration - use CORS proxy
const API_BASE = 'https://power-api.loe.lviv.ua/api';
const CORS_PROXY = 'https://corsproxy.io/?';

// Version
const VERSION = 'v1.3';
console.log('LOE WebApp ' + VERSION);

// State management
const state = {
    cities: [],
    streets: [],
    buildings: [],
    selected: {
        city: null,
        street: null,
        building: null
    },
    loading: false
};

// DOM Elements
const elements = {
    citySearch: document.getElementById('city-search'),
    cityDropdown: document.getElementById('city-dropdown'),
    citySelected: document.getElementById('city-selected'),
    cityClear: document.getElementById('city-clear'),
    
    streetSearch: document.getElementById('street-search'),
    streetDropdown: document.getElementById('street-dropdown'),
    streetSelected: document.getElementById('street-selected'),
    streetClear: document.getElementById('street-clear'),
    
    buildingSearch: document.getElementById('building-search'),
    buildingDropdown: document.getElementById('building-dropdown'),
    buildingSelected: document.getElementById('building-selected'),
    buildingClear: document.getElementById('building-clear'),
    
    stepCity: document.getElementById('step-city'),
    stepStreet: document.getElementById('step-street'),
    stepBuilding: document.getElementById('step-building'),
    
    result: document.getElementById('result'),
    resultAddress: document.getElementById('result-address'),
    resultGroup: document.getElementById('result-group'),
    
    submitBtn: document.getElementById('submit-btn'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    errorMessage: document.getElementById('error-message')
};

// API Functions
async function fetchData(endpoint) {
    const url = `${API_BASE}${endpoint}`;
    // Try direct first, then proxy
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();
        return data['hydra:member'] || data.member || data;
    } catch (e) {
        // Use CORS proxy as fallback
        console.log('Using CORS proxy...');
        const proxyResponse = await fetch(CORS_PROXY + encodeURIComponent(url));
        if (!proxyResponse.ok) throw new Error('Proxy error');
        const data = await proxyResponse.json();
        return data['hydra:member'] || data.member || data;
    }
}

// Load all cities on start
async function loadCities() {
    showLoading();
    try {
        state.cities = await fetchData('/pw_cities?pagination=false');
        hideLoading();
        console.log(`Loaded ${state.cities.length} cities`);
    } catch (error) {
        showError('Не вдалося завантажити населені пункти');
    }
}

// Load streets for selected city
async function loadStreets(cityId) {
    showLoading();
    try {
        state.streets = await fetchData(`/pw_streets?pagination=false&city.id=${cityId}`);
        hideLoading();
        enableStep('street');
        elements.streetSearch.focus();
    } catch (error) {
        showError('Не вдалося завантажити вулиці');
    }
}

// Load buildings for selected city and street
async function loadBuildings(cityId, streetId) {
    showLoading();
    try {
        state.buildings = await fetchData(`/pw_accounts?pagination=false&city.id=${cityId}&street.id=${streetId}`);
        hideLoading();
        enableStep('building');
        elements.buildingSearch.focus();
    } catch (error) {
        showError('Не вдалося завантажити будинки');
    }
}

// Filter and render dropdown items
function filterItems(items, searchTerm, type) {
    if (!searchTerm || searchTerm.length < 1) {
        return [];
    }
    
    const term = searchTerm.toLowerCase();
    let filtered;
    
    if (type === 'city') {
        filtered = items.filter(item => 
            item.name.toLowerCase().startsWith(term)
        );
        // Also include items that contain the term but don't start with it
        const containsItems = items.filter(item => 
            !item.name.toLowerCase().startsWith(term) && 
            item.name.toLowerCase().includes(term)
        );
        filtered = [...filtered, ...containsItems];
    } else if (type === 'street') {
        filtered = items.filter(item => {
            const name = item.name.toLowerCase();
            const fullName = `${item.streetType?.shortName || ''} ${item.name}`.toLowerCase();
            return name.includes(term) || fullName.includes(term);
        });
    } else {
        filtered = items.filter(item => 
            item.name.toLowerCase().includes(term)
        );
    }
    
    return filtered.slice(0, 20); // Limit to 20 results
}

function renderDropdown(dropdown, items, type) {
    if (items.length === 0) {
        dropdown.classList.remove('active');
        return;
    }
    
    dropdown.innerHTML = items.map(item => {
        let name, info;
        
        if (type === 'city') {
            name = item.name;
            info = item.otg?.name || '';
        } else if (type === 'street') {
            name = item.streetType?.shortName 
                ? `${item.streetType.shortName} ${item.name}` 
                : item.name;
            info = '';
        } else {
            name = item.name;
            const gpv = item.chergGpv || item.gpv || '';
            info = gpv ? `Черга: ${formatGroup(gpv)}` : '';
        }
        
        return `
            <div class="dropdown-item" data-id="${item.id}">
                <div class="item-name">${escapeHtml(name)}</div>
                ${info ? `<div class="item-info">${escapeHtml(info)}</div>` : ''}
            </div>
        `;
    }).join('');
    
    dropdown.classList.add('active');
    
    // Add click handlers
    dropdown.querySelectorAll('.dropdown-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = parseInt(el.dataset.id);
            const item = items.find(i => i.id === id);
            if (item) selectItem(type, item);
        });
    });
}

function selectItem(type, item) {
    const searchInput = elements[`${type}Search`];
    const dropdown = elements[`${type}Dropdown`];
    const selectedDiv = elements[`${type}Selected`];
    
    let displayName;
    if (type === 'city') {
        displayName = item.name;
    } else if (type === 'street') {
        displayName = item.streetType?.shortName 
            ? `${item.streetType.shortName} ${item.name}` 
            : item.name;
    } else {
        displayName = item.name;
    }
    
    searchInput.value = displayName;
    dropdown.classList.remove('active');
    selectedDiv.innerHTML = `<span class="check">✓</span> ${escapeHtml(displayName)}`;
    selectedDiv.classList.add('active');
    
    state.selected[type] = item;
    
    // Haptic feedback
    try { tg.HapticFeedback.selectionChanged(); } catch(e) {}
    
    // Handle next step
    if (type === 'city') {
        resetStep('street');
        resetStep('building');
        hideResult();
        loadStreets(item.id);
    } else if (type === 'street') {
        resetStep('building');
        hideResult();
        loadBuildings(state.selected.city.id, item.id);
    } else if (type === 'building') {
        showResult();
        enableSubmit();
    }
}

// Step management
function enableStep(step) {
    const stepEl = elements[`step${step.charAt(0).toUpperCase() + step.slice(1)}`];
    const searchInput = elements[`${step}Search`];
    
    stepEl.classList.remove('disabled');
    searchInput.disabled = false;
}

function resetStep(step) {
    const stepEl = elements[`step${step.charAt(0).toUpperCase() + step.slice(1)}`];
    const searchInput = elements[`${step}Search`];
    const dropdown = elements[`${step}Dropdown`];
    const selectedDiv = elements[`${step}Selected`];
    
    stepEl.classList.add('disabled');
    searchInput.value = '';
    searchInput.disabled = true;
    dropdown.innerHTML = '';
    dropdown.classList.remove('active');
    selectedDiv.innerHTML = '';
    selectedDiv.classList.remove('active');
    state.selected[step] = null;
    
    if (step === 'building') {
        disableSubmit();
    }
}

// Result display
function showResult() {
    const city = state.selected.city;
    const street = state.selected.street;
    const building = state.selected.building;
    
    const streetName = street.streetType?.shortName 
        ? `${street.streetType.shortName} ${street.name}` 
        : street.name;
    
    elements.resultAddress.textContent = `${city.name}, ${streetName}, ${building.name}`;
    
    const gpv = building.chergGpv || building.gpv || '';
    elements.resultGroup.textContent = gpv ? formatGroup(gpv) : 'Невідома';
    
    elements.result.style.display = 'block';
}

function hideResult() {
    elements.result.style.display = 'none';
}

// Submit button
function enableSubmit() {
    elements.submitBtn.disabled = false;
}

function disableSubmit() {
    elements.submitBtn.disabled = true;
}

// Loading and error
function showLoading() {
    elements.loading.style.display = 'block';
    elements.error.style.display = 'none';
}

function hideLoading() {
    elements.loading.style.display = 'none';
}

function showError(message) {
    elements.loading.style.display = 'none';
    elements.error.style.display = 'block';
    elements.errorMessage.textContent = message;
}

// Utility
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatGroup(gpv) {
    if (!gpv) return '';
    const str = String(gpv);
    if (str.length === 2) {
        return `${str[0]}.${str[1]}`;
    }
    return str;
}

// Submit to Telegram
function submitSelection() {
    const building = state.selected.building;
    if (!building) return;
    
    const street = state.selected.street;
    const streetName = street.streetType?.shortName 
        ? `${street.streetType.shortName} ${street.name}` 
        : street.name;
    
    const data = {
        city_id: state.selected.city.id,
        city_name: state.selected.city.name,
        street_id: street.id,
        street_name: streetName,
        building_name: building.name,
        cherg_gpv: building.chergGpv || building.gpv || ''
    };
    
    try { tg.HapticFeedback.notificationOccurred('success'); } catch(e) {}
    tg.sendData(JSON.stringify(data));
}

// Event listeners
function setupEventListeners() {
    // City search
    elements.citySearch.addEventListener('input', (e) => {
        const term = e.target.value.trim();
        const filtered = filterItems(state.cities, term, 'city');
        renderDropdown(elements.cityDropdown, filtered, 'city');
    });
    
    elements.citySearch.addEventListener('focus', () => {
        const term = elements.citySearch.value.trim();
        if (term.length >= 1) {
            const filtered = filterItems(state.cities, term, 'city');
            renderDropdown(elements.cityDropdown, filtered, 'city');
        }
    });
    
    // Street search
    elements.streetSearch.addEventListener('input', (e) => {
        const term = e.target.value.trim();
        const filtered = filterItems(state.streets, term, 'street');
        renderDropdown(elements.streetDropdown, filtered, 'street');
    });
    
    elements.streetSearch.addEventListener('focus', () => {
        const term = elements.streetSearch.value.trim();
        if (term.length >= 1) {
            const filtered = filterItems(state.streets, term, 'street');
            renderDropdown(elements.streetDropdown, filtered, 'street');
        }
    });
    
    // Building search
    elements.buildingSearch.addEventListener('input', (e) => {
        const term = e.target.value.trim();
        const filtered = filterItems(state.buildings, term, 'building');
        renderDropdown(elements.buildingDropdown, filtered, 'building');
    });
    
    elements.buildingSearch.addEventListener('focus', () => {
        const term = elements.buildingSearch.value.trim();
        if (term.length >= 1) {
            const filtered = filterItems(state.buildings, term, 'building');
            renderDropdown(elements.buildingDropdown, filtered, 'building');
        }
    });
    
    // Clear buttons
    elements.cityClear.addEventListener('click', () => {
        elements.citySearch.value = '';
        elements.cityDropdown.classList.remove('active');
        elements.citySelected.classList.remove('active');
        elements.citySelected.innerHTML = '';
        state.selected.city = null;
        resetStep('street');
        resetStep('building');
        hideResult();
        elements.citySearch.focus();
    });
    
    elements.streetClear.addEventListener('click', () => {
        elements.streetSearch.value = '';
        elements.streetDropdown.classList.remove('active');
        elements.streetSelected.classList.remove('active');
        elements.streetSelected.innerHTML = '';
        state.selected.street = null;
        resetStep('building');
        hideResult();
        elements.streetSearch.focus();
    });
    
    elements.buildingClear.addEventListener('click', () => {
        elements.buildingSearch.value = '';
        elements.buildingDropdown.classList.remove('active');
        elements.buildingSelected.classList.remove('active');
        elements.buildingSelected.innerHTML = '';
        state.selected.building = null;
        hideResult();
        disableSubmit();
        elements.buildingSearch.focus();
    });
    
    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#step-city')) {
            elements.cityDropdown.classList.remove('active');
        }
        if (!e.target.closest('#step-street')) {
            elements.streetDropdown.classList.remove('active');
        }
        if (!e.target.closest('#step-building')) {
            elements.buildingDropdown.classList.remove('active');
        }
    });
    
    // Submit button
    elements.submitBtn.addEventListener('click', submitSelection);
    
    // Retry button
    document.querySelector('.retry-btn').addEventListener('click', () => {
        location.reload();
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    tg.ready();
    
    // Apply Telegram theme
    if (tg.themeParams) {
        const root = document.documentElement;
        if (tg.themeParams.bg_color) root.style.setProperty('--bg-primary', tg.themeParams.bg_color);
        if (tg.themeParams.secondary_bg_color) root.style.setProperty('--bg-secondary', tg.themeParams.secondary_bg_color);
        if (tg.themeParams.text_color) root.style.setProperty('--text-primary', tg.themeParams.text_color);
        if (tg.themeParams.button_color) root.style.setProperty('--accent-color', tg.themeParams.button_color);
    }
    
    setupEventListeners();
    loadCities();
});
