// Telegram Web App initialization
const tg = window.Telegram.WebApp;
tg.expand();
try { tg.enableClosingConfirmation(); } catch(e) {}

// Прапорець чи дані вже синхронізовані з ботом
let dataSentToBot = false;

// Version
const VERSION = 'v2.5';

// Вимикаємо console.log в продакшені (економія квоти)
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};

// ============ FIREBASE INIT ============
// Конфіг читається з firebase-config.js (окремий файл, не в git)
let firebaseApp = null;
let firebaseDb = null;

try {
    if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY") {
        firebaseApp = firebase.initializeApp(window.FIREBASE_CONFIG);
        firebaseDb = firebase.database();
        log('Firebase initialized successfully');
    } else {
        console.warn('Firebase config not set! Edit firebase-config.js');
    }
} catch(e) {
    console.error('Firebase init error:', e);
}

// Отримати Telegram user ID
function getTelegramUserId() {
    try {
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            return tg.initDataUnsafe.user.id;
        }
    } catch(e) {}
    return null;
}

// API Configuration - завжди використовуємо CORS proxy для швидкості
const API_BASE = 'https://power-api.loe.lviv.ua/api';
const MAIN_API_BASE = 'https://api.loe.lviv.ua/api';
const CORS_PROXY = 'https://corsproxy.io/?';

// Cache for API responses
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 хвилин

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
    // Зберігаємо локально
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) {
        console.error('Cannot save to localStorage:', e);
    }
    
    // Зберігаємо в Firebase
    saveAddressToFirebase(data);
    
    return true;
}

// Зберегти адресу в Firebase
async function saveAddressToFirebase(data) {
    const userId = getTelegramUserId();
    if (!userId || !firebaseDb) {
        log('Cannot save to Firebase: no userId or db');
        return false;
    }
    
    try {
        const userRef = firebaseDb.ref('users/' + userId);
        await userRef.set({
            city_id: data.city_id || null,
            city_name: data.city_name || '',
            street_id: data.street_id || null,
            street_name: data.street_name || '',
            building_name: data.building_name || '',
            cherg_gpv: data.cherg_gpv || '',
            updated_at: Date.now()
        });
        log('Saved to Firebase for user:', userId);
        return true;
    } catch(e) {
        console.error('Firebase save error:', e);
        return false;
    }
}

// Завантажити адресу з Firebase
async function loadAddressFromFirebase() {
    const userId = getTelegramUserId();
    if (!userId || !firebaseDb) {
        return null;
    }
    
    try {
        const snapshot = await firebaseDb.ref('users/' + userId).once('value');
        const data = snapshot.val();
        if (data && data.cherg_gpv) {
            log('Loaded from Firebase:', data);
            return data;
        }
    } catch(e) {
        console.error('Firebase load error:', e);
    }
    return null;
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
    const cacheKey = url;
    
    // Перевірити кеш
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.data;
    }
    
    // Завжди використовуємо CORS proxy для швидкості (без спроби прямого запиту)
    const proxyUrl = CORS_PROXY + encodeURIComponent(url);
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const result = data['hydra:member'] || data.member || data;
    
    // Зберегти в кеш
    apiCache.set(cacheKey, { data: result, time: Date.now() });
    
    return result;
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
// Враховує графік на завтра для відліку через північ (22-24 + 00-05)
function getCurrentPowerStatus(todayOutages, tomorrowOutages = []) {
    const now = new Date();
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const SECONDS_IN_DAY = 24 * 3600;
    
    // Перевіряємо чи зараз відключення (сьогодні)
    for (const outage of todayOutages) {
        const [startH, startM] = outage.start.split(':').map(Number);
        const [endH, endM] = outage.end.split(':').map(Number);
        const startSeconds = startH * 3600 + startM * 60;
        const endSeconds = endH * 3600 + endM * 60;
        
        if (currentSeconds >= startSeconds && currentSeconds < endSeconds) {
            // Зараз відключення - шукаємо коли буде світло
            let nextPowerOnSeconds = endSeconds - currentSeconds;
            
            // Перевіряємо чи відключення продовжується завтра з 00:00
            if (endH === 24 || endH === 0) {
                // Кінець в 24:00 - перевіряємо чи завтра з 00:00 продовжується
                const tomorrowContinues = tomorrowOutages.find(o => {
                    const [h, m] = o.start.split(':').map(Number);
                    return h === 0 && m === 0;
                });
                
                if (tomorrowContinues) {
                    // Завтра продовжується з 00:00 - шукаємо коли закінчиться
                    const [endTomorrowH, endTomorrowM] = tomorrowContinues.end.split(':').map(Number);
                    const endTomorrowSeconds = endTomorrowH * 3600 + endTomorrowM * 60;
                    // Час до кінця сьогодні + час відключення завтра
                    nextPowerOnSeconds = (SECONDS_IN_DAY - currentSeconds) + endTomorrowSeconds;
                }
            }
            
            return {
                hasPower: false,
                currentOutage: outage,
                nextChange: null, // Буде обчислено з секунд
                nextChangeSeconds: nextPowerOnSeconds
            };
        }
    }
    
    // Зараз світло є - шукаємо наступне відключення
    let nextOutage = null;
    let minDiff = Infinity;
    
    for (const outage of todayOutages) {
        const [startH, startM] = outage.start.split(':').map(Number);
        const startSeconds = startH * 3600 + startM * 60;
        const diff = startSeconds - currentSeconds;
        
        if (diff > 0 && diff < minDiff) {
            minDiff = diff;
            nextOutage = outage;
        }
    }
    
    // Якщо немає відключень сьогодні - перевіряємо завтра
    if (!nextOutage && tomorrowOutages.length > 0) {
        // Перше відключення завтра
        const firstTomorrow = tomorrowOutages[0];
        if (firstTomorrow) {
            const [startH, startM] = firstTomorrow.start.split(':').map(Number);
            const startSeconds = startH * 3600 + startM * 60;
            // Час до кінця сьогодні + час до першого відключення завтра
            minDiff = (SECONDS_IN_DAY - currentSeconds) + startSeconds;
            nextOutage = firstTomorrow;
        }
    }
    
    return {
        hasPower: true,
        nextOutage: nextOutage,
        nextChange: nextOutage ? nextOutage.start : null,
        nextChangeSeconds: nextOutage ? minDiff : null
    };
}

// Format seconds to HH:MM:SS
function formatSecondsToTime(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined) return '--:--:--';
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Update timer display - викликається кожну секунду
function updateTimer() {
    if (!state.currentSchedule) return;
    
    // Передаємо графік на завтра для коректного відліку через північ
    const tomorrowOutages = state.tomorrowSchedule?.outages || [];
    const status = getCurrentPowerStatus(state.currentSchedule.outages, tomorrowOutages);
    const prevStatus = state.currentPowerStatus;
    state.currentPowerStatus = status;
    
    // Перевірка зміни статусу (перезавантажити дані)
    if (prevStatus && prevStatus.hasPower !== status.hasPower) {
        loadPowerSchedule();
        return;
    }
    
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
    
    // Update timer with seconds
    if (status.nextChangeSeconds !== null && status.nextChangeSeconds !== undefined) {
        elements.timerValue.textContent = formatSecondsToTime(status.nextChangeSeconds);
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
            
            // Start timer - оновлення кожну секунду для realtime
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimer, 1000); // Update every second
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
    // Не показуємо loading якщо вже є міста (фонове завантаження)
    const isBackground = state.cities.length > 0;
    if (!isBackground) showLoading();
    
    try {
        state.cities = await fetchData('/pw_cities?pagination=false');
        if (!isBackground) hideLoading();
        log(`Loaded ${state.cities.length} cities`);
    } catch (error) {
        if (!isBackground) showError('Не вдалося завантажити населені пункти');
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
        log(`Loaded ${uniqueBuildings.length} unique buildings`);
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
    
    // Налаштувати SettingsButton для скидання даних
    setupSettingsButton();
}

// Налаштувати Telegram SettingsButton для скидання даних
function setupSettingsButton() {
    try {
        if (tg.SettingsButton) {
            tg.SettingsButton.show();
            tg.SettingsButton.onClick(() => {
                showResetConfirmation();
            });
        }
    } catch(e) {
        log('SettingsButton not available:', e);
    }
}

// Показати підтвердження скидання
function showResetConfirmation() {
    try {
        tg.showConfirm(
            'Скинути всі дані?\n\nБуде видалено збережену адресу та налаштування.',
            (confirmed) => {
                if (confirmed) {
                    resetAllData();
                }
            }
        );
    } catch(e) {
        // Fallback для старих версій
        if (confirm('Скинути всі дані?\n\nБуде видалено збережену адресу та налаштування.')) {
            resetAllData();
        }
    }
}

// Скинути всі дані
async function resetAllData() {
    try {
        // Видаляємо з localStorage
        localStorage.removeItem(STORAGE_KEY);
        
        // Видаляємо з Firebase
        const userId = getTelegramUserId();
        if (userId && firebaseDb) {
            await firebaseDb.ref('users/' + userId).remove();
            log('Deleted from Firebase');
        }
        
        // Скидаємо стан
        state.savedAddress = null;
        state.currentSchedule = null;
        state.tomorrowSchedule = null;
        state.currentPowerStatus = null;
        dataSentToBot = false;
        
        // Показуємо повідомлення
        try {
            tg.showAlert('✅ Дані успішно скинуто!');
            tg.HapticFeedback.notificationOccurred('success');
        } catch(e) {
            alert('✅ Дані успішно скинуто!');
        }
        
        // Показуємо вибір адреси
        showSelectView();
        
    } catch(e) {
        console.error('Error resetting data:', e);
        try {
            tg.showAlert('❌ Помилка при скиданні даних');
        } catch(ex) {
            alert('❌ Помилка при скиданні даних');
        }
    }
}

// Синхронізувати збережену адресу з ботом (викликається автоматично при збереженні)
function syncAddressWithBot() {
    if (!state.savedAddress || dataSentToBot) return;
    
    const data = {
        city_id: state.savedAddress.city_id,
        city_name: state.savedAddress.city_name,
        street_id: state.savedAddress.street_id,
        street_name: state.savedAddress.street_name,
        building_name: state.savedAddress.building_name,
        cherg_gpv: state.savedAddress.cherg_gpv
    };
    
    try {
        tg.HapticFeedback.notificationOccurred('success');
        tg.sendData(JSON.stringify(data));
        dataSentToBot = true;
        log('Address synced with bot');
    } catch(e) {
        log('Cannot sync with bot:', e);
    }
}

// Сховати MainButton
function hideMainButton() {
    try {
        tg.MainButton.hide();
        tg.MainButton.offClick();
    } catch(e) {}
}

function showSelectView() {
    hideInitialLoading();
    elements.savedView.style.display = 'none';
    elements.selectView.style.display = 'block';
    elements.footerSelect.style.display = 'block';
    
    // Сховати MainButton коли вибираємо нову адресу
    hideMainButton();
    
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
        dataSentToBot = true;
    } catch(e) {
        log('Not in Telegram WebApp context');
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
        // Скролимо до поля вводу щоб було видно з клавіатурою
        setTimeout(() => {
            elements.stepStreet.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
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
        // Скролимо до поля вводу щоб було видно з клавіатурою
        setTimeout(() => {
            elements.stepBuilding.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
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
    
    // Обробник BackButton - при закритті синхронізуємо дані
    try {
        tg.BackButton.onClick(() => {
            if (state.savedAddress && state.savedAddress.cherg_gpv && !dataSentToBot) {
                syncAddressWithBot();
            } else {
                tg.close();
            }
        });
    } catch(e) {
        log('BackButton handler not available:', e);
    }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
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
    
    // Почати завантаження міст паралельно (для швидкості)
    loadCities().catch(() => {});
    
    // Спочатку спробуємо завантажити з Firebase, потім з localStorage
    let saved = null;
    
    // Завантажити з Firebase (пріоритет)
    const firebaseSaved = await loadAddressFromFirebase();
    if (firebaseSaved && firebaseSaved.cherg_gpv) {
        saved = firebaseSaved;
        // Синхронізувати з localStorage
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(firebaseSaved));
        } catch(e) {}
        log('Using Firebase data');
    } else {
        // Якщо в Firebase немає, беремо з localStorage
        saved = loadSavedAddress();
        log('Using localStorage data');
    }
    
    if (saved && saved.city_name && saved.cherg_gpv) {
        state.savedAddress = saved;
        displaySavedAddress(saved);
    } else {
        showSelectView();
    }
});
