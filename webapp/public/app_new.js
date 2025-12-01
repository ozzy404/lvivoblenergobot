// Telegram Web App initialization
const tg = window.Telegram.WebApp;
tg.expand();
try { tg.enableClosingConfirmation(); } catch(e) {}

console.log('⚡ LOE WebApp v3.0 - Power Status Edition');

// API Configuration
const API_BASE = 'https://power-api.loe.lviv.ua/api';
const MAIN_API_BASE = 'https://api.loe.lviv.ua/api';

// Storage
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
    savedAddress: null,
    powerStatus: null,
    countdownInterval: null
};

// DOM Elements
const elements = {
    dashboardView: document.getElementById('dashboard-view'),
    selectView: document.getElementById('select-view'),
    
    powerStatusCard: document.getElementById('power-status-card'),
    statusIcon: document.getElementById('status-icon'),
    statusTitle: document.getElementById('status-title'),
    statusSubtitle: document.getElementById('status-subtitle'),
    
    countdownSection: document.getElementById('countdown-section'),
    countdownLabel: document.getElementById('countdown-label'),
    hours: document.getElementById('hours'),
    minutes: document.getElementById('minutes'),
    seconds: document.getElementById('seconds'),
    
    savedAddressText: document.getElementById('saved-address-text'),
    savedGroupText: document.getElementById('saved-group-text'),
    changeAddressBtn: document.getElementById('change-address-btn'),
    
    scheduleImage: document.getElementById('schedule-image'),
    scheduleLoading: document.getElementById('schedule-loading'),
    scheduleError: document.getElementById('schedule-error'),
    retryScheduleBtn: document.getElementById('retry-schedule-btn'),
    viewFullScheduleBtn: document.getElementById('view-full-schedule-btn'),
    
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
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function loadCities() {
    const data = await fetchData('/pw_cities?pagination=false');
    state.cities = data['hydra:member'] || [];
    return state.cities;
}

async function loadStreets(cityId) {
    const data = await fetchData(`/pw_streets?pagination=false&city.id=${cityId}`);
    state.streets = data['hydra:member'] || [];
    return state.streets;
}

async function loadBuildings(cityId, streetId) {
    const data = await fetchData(`/pw_accounts?pagination=false&city.id=${cityId}&street.id=${streetId}`);
    state.buildings = data['hydra:member'] || [];
    return state.buildings;
}

async function loadSchedule() {
    try {
        const data = await fetchData('/pages?page=1&synonym=power-top', true);
        if (data && data['hydra:member'] && data['hydra:member'].length > 0) {
            const page = data['hydra:member'][0];
            if (page.imageUrl) {
                return `https://api.loe.lviv.ua${page.imageUrl}`;
            }
        }
        return null;
    } catch(e) {
        console.error('Schedule load error:', e);
        return null;
    }
}

// ============ POWER STATUS ============
function updatePowerStatus(isPowerOn, nextChangeTime = null) {
    state.powerStatus = { isPowerOn, nextChangeTime };
    
    if (elements.powerStatusCard) {
        elements.powerStatusCard.classList.remove('power-on', 'power-off');
        elements.powerStatusCard.classList.add(isPowerOn ? 'power-on' : 'power-off');
    }
    
    if (isPowerOn) {
        elements.statusIcon.textContent = '✅';
        elements.statusTitle.textContent = 'Світло Є';
        elements.statusSubtitle.textContent = 'Живлення активне';
    } else {
        elements.statusIcon.textContent = '❌';
        elements.statusTitle.textContent = 'Світло Немає';
        elements.statusSubtitle.textContent = 'Плановое відключення';
    }
    
    // Start countdown if we have next change time
    if (nextChangeTime) {
        startCountdown(nextChangeTime, isPowerOn);
    } else {
        hideCountdown();
    }
}

function startCountdown(targetTime, isPowerOn) {
    if (state.countdownInterval) {
        clearInterval(state.countdownInterval);
    }
    
    elements.countdownSection.style.display = 'block';
    elements.countdownLabel.textContent = isPowerOn ? 'До відключення:' : 'До включення:';
    
    state.countdownInterval = setInterval(() => {
        const now = new Date();
        const target = new Date(targetTime);
        const diff = target - now;
        
        if (diff <= 0) {
            clearInterval(state.countdownInterval);
            // Flip the status
            updatePowerStatus(!isPowerOn);
            return;
        }
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        elements.hours.textContent = String(hours).padStart(2, '0');
        elements.minutes.textContent = String(minutes).padStart(2, '0');
        elements.seconds.textContent = String(seconds).padStart(2, '0');
    }, 1000);
}

function hideCountdown() {
    if (state.countdownInterval) {
        clearInterval(state.countdownInterval);
    }
    elements.countdownSection.style.display = 'none';
}

// Mock function - would need real schedule parsing
function determinePowerStatus(chergGpv) {
    // This is a placeholder - in real app you'd parse the schedule image
    // or use API data to determine current status
    const currentHour = new Date().getHours();
    
    // Example logic - customize based on actual schedule data
    const isEvenHour = currentHour % 2 === 0;
    const isPowerOn = isEvenHour;
    
    // Calculate next change (simplified)
    const nextHour = isPowerOn ? currentHour + 2 : currentHour + 1;
    const nextChange = new Date();
    nextChange.setHours(nextHour, 0, 0, 0);
    
    return { isPowerOn, nextChangeTime: nextChange.toISOString() };
}

// ============ DISPLAY ============
async function displaySavedAddress() {
    const saved = loadSavedAddress();
    
    if (!saved) {
        showView('select');
        await initializeAddressSelection();
        return;
    }
    
    state.savedAddress = saved;
    
    // Display address info
    const addressText = `${saved.city_name}, ${saved.street_name}, ${saved.building_name}`;
    elements.savedAddressText.textContent = addressText;
    
    const groupText = formatGroup(saved.cherg_gpv);
    elements.savedGroupText.textContent = groupText;
    
    // Update power status
    const status = determinePowerStatus(saved.cherg_gpv);
    updatePowerStatus(status.isPowerOn, status.nextChangeTime);
    
    // Load schedule
    try {
        const scheduleUrl = await loadSchedule();
        if (scheduleUrl) {
            elements.scheduleImage.src = scheduleUrl;
            elements.scheduleImage.onload = () => {
                elements.scheduleLoading.style.display = 'none';
                elements.scheduleError.style.display = 'none';
            };
            elements.scheduleImage.onerror = () => {
                elements.scheduleLoading.style.display = 'none';
                elements.scheduleError.style.display = 'block';
            };
        } else {
            elements.scheduleLoading.style.display = 'none';
            elements.scheduleError.style.display = 'block';
        }
    } catch(e) {
        elements.scheduleLoading.style.display = 'none';
        elements.scheduleError.style.display = 'block';
    }
    
    showView('dashboard');
}

function showView(view) {
    if (view === 'dashboard') {
        elements.dashboardView.style.display = 'block';
        elements.selectView.style.display = 'none';
    } else {
        elements.dashboardView.style.display = 'none';
        elements.selectView.style.display = 'block';
    }
}

function formatGroup(chergGpv) {
    if (!chergGpv || chergGpv === '0') return 'Не входить';
    return chergGpv.split('').join('.');
}

// ============ ADDRESS SELECTION ============
async function initializeAddressSelection() {
    showLoading(true);
    try {
        await loadCities();
        showLoading(false);
    } catch(e) {
        showLoading(false);
        showError('Помилка завантаження міст');
    }
}

function setupSearch(inputEl, dropdownEl, clearEl, items, onSelect, formatItem = item => item.name) {
    let filteredItems = items;
    
    const updateDropdown = () => {
        dropdownEl.innerHTML = '';
        
        if (filteredItems.length === 0) {
            dropdownEl.innerHTML = '<div class="dropdown-item disabled">Нічого не знайдено</div>';
        } else {
            filteredItems.forEach(item => {
                const div = document.createElement('div');
                div.className = 'dropdown-item';
                div.textContent = formatItem(item);
                div.onclick = () => {
                    onSelect(item);
                    dropdownEl.classList.remove('show');
                    inputEl.value = formatItem(item);
                };
                dropdownEl.appendChild(div);
            });
        }
        
        dropdownEl.classList.add('show');
    };
    
    inputEl.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        filteredItems = items.filter(item => 
            formatItem(item).toLowerCase().includes(query)
        );
        updateDropdown();
    };
    
    inputEl.onfocus = () => {
        filteredItems = items;
        updateDropdown();
    };
    
    inputEl.onblur = () => {
        setTimeout(() => dropdownEl.classList.remove('show'), 200);
    };
    
    clearEl.onclick = () => {
        inputEl.value = '';
        inputEl.focus();
        filteredItems = items;
        updateDropdown();
    };
}

function onCitySelect(city) {
    state.selected.city = city;
    elements.citySelected.textContent = `✓ Обрано: ${city.name}`;
    elements.citySelected.classList.add('show');
    
    elements.stepStreet.classList.remove('disabled');
    elements.streetSearch.disabled = false;
    
    showLoading(true);
    loadStreets(city.id).then(() => {
        setupSearch(
            elements.streetSearch,
            elements.streetDropdown,
            elements.streetClear,
            state.streets,
            onStreetSelect
        );
        showLoading(false);
    });
}

function onStreetSelect(street) {
    state.selected.street = street;
    elements.streetSelected.textContent = `✓ Обрано: ${street.name}`;
    elements.streetSelected.classList.add('show');
    
    elements.stepBuilding.classList.remove('disabled');
    elements.buildingSearch.disabled = false;
    
    showLoading(true);
    loadBuildings(state.selected.city.id, street.id).then(() => {
        setupSearch(
            elements.buildingSearch,
            elements.buildingDropdown,
            elements.buildingClear,
            state.buildings,
            onBuildingSelect,
            item => item.buildingName
        );
        showLoading(false);
    });
}

function onBuildingSelect(building) {
    state.selected.building = building;
    elements.buildingSelected.textContent = `✓ Обрано: ${building.buildingName}`;
    elements.buildingSelected.classList.add('show');
    
    const address = `${state.selected.city.name}, ${state.selected.street.name}, ${building.buildingName}`;
    const group = formatGroup(building.chergGpv);
    
    elements.resultAddress.textContent = address;
    elements.resultGroup.textContent = group;
    elements.result.style.display = 'block';
    
    elements.submitBtn.disabled = false;
}

async function submitAddress() {
    const building = state.selected.building;
    const city = state.selected.city;
    const street = state.selected.street;
    
    const data = {
        city_id: city.id,
        city_name: city.name,
        street_id: street.id,
        street_name: street.name,
        building_name: building.buildingName,
        cherg_gpv: building.chergGpv || '0'
    };
    
    // Save to localStorage
    saveAddress(data);
    
    // Send to Telegram bot
    try {
        tg.sendData(JSON.stringify(data));
    } catch(e) {
        console.error('Cannot send to Telegram:', e);
        // Still show dashboard even if send fails
        await displaySavedAddress();
    }
}

// ============ UI HELPERS ============
function showLoading(show) {
    if (elements.loading) {
        elements.loading.style.display = show ? 'block' : 'none';
    }
}

function showError(message) {
    if (elements.error && elements.errorMessage) {
        elements.errorMessage.textContent = message;
        elements.error.style.display = 'block';
        setTimeout(() => {
            elements.error.style.display = 'none';
        }, 5000);
    }
}

// ============ EVENT LISTENERS ============
elements.changeAddressBtn?.addEventListener('click', async () => {
    showView('select');
    if (state.cities.length === 0) {
        await initializeAddressSelection();
    }
});

elements.retryScheduleBtn?.addEventListener('click', async () => {
    elements.scheduleError.style.display = 'none';
    elements.scheduleLoading.style.display = 'flex';
    
    const scheduleUrl = await loadSchedule();
    if (scheduleUrl) {
        elements.scheduleImage.src = scheduleUrl;
    } else {
        elements.scheduleLoading.style.display = 'none';
        elements.scheduleError.style.display = 'block';
    }
});

elements.viewFullScheduleBtn?.addEventListener('click', () => {
    if (elements.scheduleImage.src) {
        window.open(elements.scheduleImage.src, '_blank');
    }
});

elements.submitBtn?.addEventListener('click', submitAddress);

// Setup city search
if (elements.citySearch) {
    setupSearch(
        elements.citySearch,
        elements.cityDropdown,
        elements.cityClear,
        state.cities,
        onCitySelect
    );
}

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    console.log('App initialized');
    await displaySavedAddress();
});

// Refresh power status every minute
setInterval(() => {
    if (state.savedAddress && elements.dashboardView.style.display !== 'none') {
        const status = determinePowerStatus(state.savedAddress.cherg_gpv);
        if (state.powerStatus && state.powerStatus.isPowerOn !== status.isPowerOn) {
            updatePowerStatus(status.isPowerOn, status.nextChangeTime);
        }
    }
}, 60000);
