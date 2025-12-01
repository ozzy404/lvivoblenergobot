// Telegram Web App initialization
const tg = window.Telegram.WebApp;
tg.expand();
try { tg.enableClosingConfirmation(); } catch(e) {}

// Version
const VERSION = 'v2.0';
console.log('LOE WebApp ' + VERSION);

// API Configuration
const API_BASE = 'https://power-api.loe.lviv.ua/api';
const MAIN_API_BASE = 'https://api.loe.lviv.ua/api';
const CORS_PROXY = 'https://corsproxy.io/?';

// Storage key
const STORAGE_KEY = 'loe_saved_address';

// State
const state = {
    cities: [],
    streets: [],
    buildings: [],
    selected: {
        city: null,
        street: null,
        building: null
    },
    savedAddress: null
};

// DOM Elements
const elements = {
    savedView: document.getElementById('saved-view'),
    selectView: document.getElementById('select-view'),
    footerSelect: document.getElementById('footer-select'),
    
    savedAddressText: document.getElementById('saved-address-text'),
    savedGroupText: document.getElementById('saved-group-text'),
    hintGroup: document.getElementById('hint-group'),
    changeAddressBtn: document.getElementById('change-address-btn'),
    
    scheduleImage: document.getElementById('schedule-image'),
    scheduleLoading: document.getElementById('schedule-loading'),
    scheduleError: document.getElementById('schedule-error'),
    retryScheduleBtn: document.getElementById('retry-schedule-btn'),
    
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

// ============ STORAGE ============
function saveAddress(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch(e) {
        console.error('Cannot save to localStorage:', e);
        return false;
    }
}

function loadSavedAddress() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : null;
    } catch(e) {
        console.error('Cannot load from localStorage:', e);
        return null;
    }
}

// ============ API ============
async function fetchData(endpoint, useMainApi = false) {
    const base = useMainApi ? MAIN_API_BASE : API_BASE;
    const url = `${base}${endpoint}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();
        return data['hydra:member'] || data.member || data;
    } catch (e) {
        console.log('Using CORS proxy for:', endpoint);
        const proxyResponse = await fetch(CORS_PROXY + encodeURIComponent(url));
        if (!proxyResponse.ok) throw new Error('Proxy error');
        const data = await proxyResponse.json();
        return data['hydra:member'] || data.member || data;
    }
}

async function loadScheduleImage() {
    elements.scheduleLoading.style.display = 'block';
    elements.scheduleImage.style.display = 'none';
    elements.scheduleError.style.display = 'none';
    
    try {
        const data = await fetchData('/pages?synonym=power-top', true);
        
        let imageUrl = null;
        if (Array.isArray(data) && data.length > 0) {
            const page = data[0];
            if (page.image) {
                imageUrl = `https://api.loe.lviv.ua${page.image}`;
            }
        }
        
        if (!imageUrl) {
            const grafics = await fetchData('/pages?synonym=grafics', true);
            if (Array.isArray(grafics) && grafics.length > 0 && grafics[0].image) {
                imageUrl = `https://api.loe.lviv.ua${grafics[0].image}`;
            }
        }
        
        if (imageUrl) {
            elements.scheduleImage.src = imageUrl;
            elements.scheduleImage.onload = () => {
                elements.scheduleLoading.style.display = 'none';
                elements.scheduleImage.style.display = 'block';
            };
            elements.scheduleImage.onerror = () => {
                elements.scheduleLoading.style.display = 'none';
                elements.scheduleError.style.display = 'block';
            };
        } else {
            elements.scheduleLoading.style.display = 'none';
            elements.scheduleError.style.display = 'block';
        }
    } catch (e) {
        console.error('Error loading schedule:', e);
        elements.scheduleLoading.style.display = 'none';
        elements.scheduleError.style.display = 'block';
    }
}

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

// ============ UI ============
function showSavedView() {
    elements.savedView.style.display = 'block';
    elements.selectView.style.display = 'none';
    elements.footerSelect.style.display = 'none';
}

function showSelectView() {
    elements.savedView.style.display = 'none';
    elements.selectView.style.display = 'block';
    elements.footerSelect.style.display = 'block';
    
    if (state.cities.length === 0) {
        loadCities();
    }
}

function displaySavedAddress(addr) {
    elements.savedAddressText.textContent = `${addr.city_name}, ${addr.street_name}, ${addr.building_name}`;
    const group = formatGroup(addr.cherg_gpv);
    elements.savedGroupText.textContent = group;
    elements.hintGroup.textContent = group;
    
    showSavedView();
    loadScheduleImage();
}

function formatGroup(gpv) {
    if (!gpv) return 'Невідома';
    const str = String(gpv);
    if (str.length === 2) {
        return `${str[0]}.${str[1]}`;
    }
    return str;
}

// ============ DROPDOWN ============
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
        filtered = items.filter(item => {
            const bName = (item.buildingName || item.name || '').toLowerCase();
            return bName.includes(term);
        });
    }
    
    return filtered.slice(0, 20);
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
            name = item.buildingName || item.name || '';
            const gpv = item.chergGpv || '';
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
        displayName = item.buildingName || item.name || '';
    }
    
    searchInput.value = displayName;
    dropdown.classList.remove('active');
    selectedDiv.innerHTML = `<span class="check">✓</span> ${escapeHtml(displayName)}`;
    selectedDiv.classList.add('active');
    
    state.selected[type] = item;
    
    try { tg.HapticFeedback.selectionChanged(); } catch(e) {}
    
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

// ============ STEP MANAGEMENT ============
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

// ============ RESULT ============
function showResult() {
    const city = state.selected.city;
    const street = state.selected.street;
    const building = state.selected.building;
    
    const streetName = street.streetType?.shortName 
        ? `${street.streetType.shortName} ${street.name}` 
        : street.name;
    
    const buildingName = building.buildingName || building.name || '';
    elements.resultAddress.textContent = `${city.name}, ${streetName}, ${buildingName}`;
    
    const gpv = building.chergGpv || '';
    elements.resultGroup.textContent = gpv ? formatGroup(gpv) : 'Невідома';
    
    elements.result.style.display = 'block';
}

function hideResult() {
    elements.result.style.display = 'none';
}

function enableSubmit() {
    elements.submitBtn.disabled = false;
}

function disableSubmit() {
    elements.submitBtn.disabled = true;
}

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

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ SUBMIT ============
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
        building_name: building.buildingName || building.name || '',
        cherg_gpv: building.chergGpv || ''
    };
    
    // Save locally
    saveAddress(data);
    state.savedAddress = data;
    
    // Send to Telegram bot
    try { 
        tg.HapticFeedback.notificationOccurred('success'); 
        tg.sendData(JSON.stringify(data));
    } catch(e) {
        console.log('Not in Telegram WebApp context');
    }
    
    // Show saved view with schedule
    displaySavedAddress(data);
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    // Change address button
    elements.changeAddressBtn.addEventListener('click', () => {
        showSelectView();
    });
    
    // Retry schedule button
    elements.retryScheduleBtn.addEventListener('click', () => {
        loadScheduleImage();
    });
    
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
    
    // Retry button for loading errors
    const retryBtn = document.querySelector('.retry-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', () => {
            location.reload();
        });
    }
}

// ============ INIT ============
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
    
    // Check for saved address
    const saved = loadSavedAddress();
    if (saved && saved.city_name && saved.cherg_gpv) {
        state.savedAddress = saved;
        displaySavedAddress(saved);
    } else {
        showSelectView();
    }
});
