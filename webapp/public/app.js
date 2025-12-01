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
    savedAddress: null,
    currentSchedule: null,
    tomorrowSchedule: null,
    currentPowerStatus: null
};

// DOM Elements
const elements = {
    savedView: document.getElementById('saved-view'),
    selectView: document.getElementById('select-view'),
    footerSelect: document.getElementById('footer-select'),
    
    savedAddressText: document.getElementById('saved-address-text'),
    savedGroupText: document.getElementById('saved-group-text'),
    changeAddressBtn: document.getElementById('change-address-btn'),
    
    // Power Status elements
    powerStatusSection: document.getElementById('power-status-section'),
    powerStatusCard: document.getElementById('power-status-card'),
    powerStatusIndicator: document.getElementById('power-status-indicator'),
    powerIcon: document.getElementById('power-icon'),
    powerStatusText: document.getElementById('power-status-text'),
    powerTimer: document.getElementById('power-timer'),
    timerLabel: document.getElementById('timer-label'),
    timerValue: document.getElementById('timer-value'),
    scheduleInfo: document.getElementById('schedule-info'),
    scheduleUpdateTime: document.getElementById('schedule-update-time'),
    tomorrowSchedule: document.getElementById('tomorrow-schedule'),
    tomorrowInfo: document.getElementById('tomorrow-info'),
    
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
    // Ця функція тепер завантажує текстові дані графіка замість картинки
    await loadPowerSchedule();
}

// Timer interval reference
let timerInterval = null;

// Parse schedule text to extract outage times for a specific group
function parseScheduleForGroup(rawHtml, groupNumber) {
    // Decode HTML entities
    const decoded = rawHtml
        .replace(/\\u003C/g, '<')
        .replace(/\\u003E/g, '>')
        .replace(/\\\//g, '/')
        .replace(/\\n/g, '\n');
    
    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(decoded, 'text/html');
    
    // Find schedule date
    const boldElements = doc.querySelectorAll('b');
    let scheduleDate = '';
    let updateTime = '';
    
    for (const b of boldElements) {
        const text = b.textContent;
        if (text.includes('Графік погодинних відключень на')) {
            const match = text.match(/(\d{2}\.\d{2}\.\d{4})/);
            if (match) scheduleDate = match[1];
        }
        if (text.includes('Інформація станом на')) {
            updateTime = text;
        }
    }
    
    // Format group number to match text format (e.g., "12" -> "6.2")
    const formattedGroup = formatGroup(groupNumber);
    
    // Find the paragraph for this group
    const paragraphs = doc.querySelectorAll('p');
    let groupSchedule = null;
    
    for (const p of paragraphs) {
        const text = p.textContent;
        if (text.includes(`Група ${formattedGroup}.`)) {
            groupSchedule = text;
            break;
        }
    }
    
    // Parse outage times from the group schedule
    const outages = [];
    if (groupSchedule) {
        // Check if power is on (no outages)
        if (groupSchedule.includes('Електроенергія є')) {
            // No outages for this group
        } else {
            // Parse time ranges like "з 09:00 до 12:30"
            const timePattern = /з (\d{2}:\d{2}) до (\d{2}:\d{2})/g;
            let match;
            while ((match = timePattern.exec(groupSchedule)) !== null) {
                outages.push({
                    start: match[1],
                    end: match[2]
                });
            }
        }
    }
    
    return {
        date: scheduleDate,
        updateTime: updateTime,
        group: formattedGroup,
        outages: outages,
        rawText: groupSchedule || `Група ${formattedGroup}: дані відсутні`
    };
}

// Get today's date in DD.MM.YYYY format
function getTodayDate() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}.${month}.${year}`;
}

// Get tomorrow's date in DD.MM.YYYY format
function getTomorrowDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const day = String(tomorrow.getDate()).padStart(2, '0');
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const year = tomorrow.getFullYear();
    return `${day}.${month}.${year}`;
}

// Check if current time is within an outage period
function getCurrentPowerStatus(outages) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    for (const outage of outages) {
        const [startH, startM] = outage.start.split(':').map(Number);
        const [endH, endM] = outage.end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
            return {
                hasPower: false,
                currentOutage: outage,
                nextChange: outage.end,
                nextChangeMinutes: endMinutes - currentMinutes
            };
        }
    }
    
    // Find next outage
    let nextOutage = null;
    let minDiff = Infinity;
    
    for (const outage of outages) {
        const [startH, startM] = outage.start.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const diff = startMinutes - currentMinutes;
        
        if (diff > 0 && diff < minDiff) {
            minDiff = diff;
            nextOutage = outage;
        }
    }
    
    return {
        hasPower: true,
        nextOutage: nextOutage,
        nextChange: nextOutage ? nextOutage.start : null,
        nextChangeMinutes: nextOutage ? minDiff : null
    };
}

// Format minutes to HH:MM
function formatMinutesToTime(minutes) {
    if (minutes === null) return '--:--';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Update timer display
function updateTimer() {
    if (!state.currentPowerStatus || !state.currentSchedule) return;
    
    const status = getCurrentPowerStatus(state.currentSchedule.outages);
    state.currentPowerStatus = status;
    
    // Update UI
    updatePowerStatusUI(status, state.currentSchedule);
}

// Update power status UI
function updatePowerStatusUI(status, schedule) {
    const card = elements.powerStatusCard;
    
    if (status.hasPower) {
        card.className = 'power-status-card power-on';
        elements.powerIcon.textContent = '💡';
        elements.powerStatusText.textContent = 'Світло є';
        elements.timerLabel.textContent = 'До відключення:';
    } else {
        card.className = 'power-status-card power-off';
        elements.powerIcon.textContent = '🔌';
        elements.powerStatusText.textContent = 'Світла немає';
        elements.timerLabel.textContent = 'До увімкнення:';
    }
    
    // Update timer
    if (status.nextChangeMinutes !== null) {
        elements.timerValue.textContent = formatMinutesToTime(status.nextChangeMinutes);
    } else {
        elements.timerValue.textContent = '∞';
        elements.timerLabel.textContent = status.hasPower ? 'Відключень немає' : '';
    }
    
    // Update schedule info
    if (schedule.outages.length === 0) {
        elements.scheduleInfo.innerHTML = '<span class="has-power">✅ На сьогодні відключень для вашої групи не заплановано</span>';
    } else {
        const timesHtml = schedule.outages.map(o => 
            `<span class="outage-time">${o.start} - ${o.end}</span>`
        ).join(' ');
        elements.scheduleInfo.innerHTML = `<strong>Група ${schedule.group}:</strong> Відключення: ${timesHtml}`;
    }
    
    elements.scheduleUpdateTime.textContent = schedule.updateTime || '';
}

// Main function to load power schedule
async function loadPowerSchedule() {
    if (!state.savedAddress || !state.savedAddress.cherg_gpv) {
        console.error('No saved address or group');
        return;
    }
    
    elements.scheduleLoading.style.display = 'block';
    elements.scheduleError.style.display = 'none';
    elements.powerStatusCard.style.display = 'none';
    
    try {
        const menuData = await fetchData('/menus?page=1&type=photo-grafic', true);
        
        if (!Array.isArray(menuData) || menuData.length === 0) {
            throw new Error('No menu data');
        }
        
        const menu = menuData[0];
        const menuItems = menu.menuItems || [];
        
        const todayDate = getTodayDate();
        const tomorrowDate = getTomorrowDate();
        
        let todaySchedule = null;
        let tomorrowSchedule = null;
        
        // Find today's and tomorrow's schedule
        for (const item of menuItems) {
            if (item.rawHtml) {
                const decoded = item.rawHtml.replace(/\\u003C/g, '<').replace(/\\u003E/g, '>');
                
                if (decoded.includes(`на ${todayDate}`)) {
                    todaySchedule = parseScheduleForGroup(item.rawHtml, state.savedAddress.cherg_gpv);
                }
                if (decoded.includes(`на ${tomorrowDate}`)) {
                    tomorrowSchedule = parseScheduleForGroup(item.rawHtml, state.savedAddress.cherg_gpv);
                }
            }
        }
        
        // If no today schedule found, try the first menu item with orders=0 (Today)
        if (!todaySchedule) {
            const todayItem = menuItems.find(item => item.orders === 0 || item.name === 'Today');
            if (todayItem && todayItem.rawHtml) {
                todaySchedule = parseScheduleForGroup(todayItem.rawHtml, state.savedAddress.cherg_gpv);
            }
        }
        
        elements.scheduleLoading.style.display = 'none';
        
        if (todaySchedule) {
            state.currentSchedule = todaySchedule;
            state.currentPowerStatus = getCurrentPowerStatus(todaySchedule.outages);
            
            elements.powerStatusCard.style.display = 'block';
            updatePowerStatusUI(state.currentPowerStatus, todaySchedule);
            
            // Start timer
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimer, 60000); // Update every minute
        } else {
            elements.scheduleError.style.display = 'block';
        }
        
        // Show tomorrow's schedule if available
        if (tomorrowSchedule) {
            state.tomorrowSchedule = tomorrowSchedule;
            elements.tomorrowSchedule.style.display = 'block';
            
            if (tomorrowSchedule.outages.length === 0) {
                elements.tomorrowInfo.innerHTML = '<span class="has-power">✅ Відключень не заплановано</span>';
            } else {
                const timesHtml = tomorrowSchedule.outages.map(o => 
                    `<span class="outage-time">${o.start} - ${o.end}</span>`
                ).join(' ');
                elements.tomorrowInfo.innerHTML = `Відключення: ${timesHtml}`;
            }
        } else {
            elements.tomorrowSchedule.style.display = 'none';
        }
        
    } catch (e) {
        console.error('Error loading power schedule:', e);
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
        const accounts = await fetchData(`/pw_accounts?pagination=false&city.id=${cityId}&street.id=${streetId}`);
        
        // Виділяємо унікальні будинки за buildingName
        const uniqueBuildings = [];
        const seenNames = new Set();
        
        for (const account of accounts) {
            const name = account.buildingName || account.name || '';
            if (name && !seenNames.has(name)) {
                seenNames.add(name);
                uniqueBuildings.push({
                    id: account.id,
                    buildingName: name,
                    name: name,
                    chergGpv: account.chergGpv || '',
                    chergGav: account.chergGav || '',
                    chergSgav: account.chergSgav || ''
                });
            }
        }
        
        // Сортуємо будинки природнім чином (1, 2, 10, а не 1, 10, 2)
        uniqueBuildings.sort((a, b) => {
            const nameA = a.buildingName || '';
            const nameB = b.buildingName || '';
            return nameA.localeCompare(nameB, 'uk', { numeric: true });
        });
        
        state.buildings = uniqueBuildings;
        hideLoading();
        enableStep('building');
        elements.buildingSearch.focus();
        console.log(`Loaded ${uniqueBuildings.length} unique buildings`);
    } catch (error) {
        console.error('Error loading buildings:', error);
        showError('Не вдалося завантажити будинки');
    }
}

// ============ UI ============
function hideInitialLoading() {
    const initialLoading = document.getElementById('initial-loading');
    if (initialLoading) {
        initialLoading.style.display = 'none';
    }
}

function showSavedView() {
    hideInitialLoading();
    elements.savedView.style.display = 'block';
    elements.selectView.style.display = 'none';
    elements.footerSelect.style.display = 'none';
}

function showSelectView() {
    hideInitialLoading();
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
    
    showSavedView();
    loadPowerSchedule();
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
    // Для будинків показуємо всі якщо нічого не введено
    if (type === 'building') {
        if (!searchTerm || searchTerm.length < 1) {
            return items.slice(0, 30); // Показати перші 30 будинків
        }
    } else {
        if (!searchTerm || searchTerm.length < 1) {
            return [];
        }
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
        // Для будинків
        filtered = items.filter(item => {
            const bName = (item.buildingName || item.name || '').toLowerCase();
            return bName.includes(term);
        });
    }
    
    return filtered.slice(0, 30);
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
        loadPowerSchedule();
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
        // Показуємо усі будинки при фокусі
        const term = elements.buildingSearch.value.trim();
        const filtered = filterItems(state.buildings, term, 'building');
        renderDropdown(elements.buildingDropdown, filtered, 'building');
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
