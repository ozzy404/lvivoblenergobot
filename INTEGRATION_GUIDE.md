# 🎨 Як правильно додати статус світла та таймер

## 📝 План інтеграції

### Крок 1: Залишити робочий код вибору адреси

Стара версія має:
- ✅ Робочий CORS proxy
- ✅ Перевірений код вибору адреси
- ✅ Правильну обробку API відповідей

### Крок 2: Додати новий UI тільки для saved-view

Коли адреса вже збережена, показувати розширену інформацію.

## 🔨 Реалізація

### 1. Додати HTML для статусу світла в saved-view

В `index.html` додати перед `schedule-section`:

```html
<!-- Power Status Card (тільки коли є адреса) -->
<div class="power-status-card" id="power-status-card">
    <div class="status-indicator">
        <div class="status-icon" id="status-icon">🔌</div>
        <div class="status-text">
            <h2 id="status-title">Перевірка статусу...</h2>
            <p id="status-subtitle">Завантаження даних</p>
        </div>
    </div>
    
    <!-- Timer (показується тільки коли є дані) -->
    <div class="countdown-section" id="countdown-section" style="display: none;">
        <div class="countdown-label" id="countdown-label">До відключення:</div>
        <div class="countdown-timer">
            <div class="time-unit">
                <span class="time-value" id="hours">00</span>
                <span class="time-label">год</span>
            </div>
            <div class="time-separator">:</div>
            <div class="time-unit">
                <span class="time-value" id="minutes">00</span>
                <span class="time-label">хв</span>
            </div>
            <div class="time-separator">:</div>
            <div class="time-unit">
                <span class="time-value" id="seconds">00</span>
                <span class="time-label">сек</span>
            </div>
        </div>
    </div>
</div>
```

### 2. Додати CSS стилі

В `styles.css` додати в кінець файлу:

```css
/* ========== POWER STATUS CARD ========== */
.power-status-card {
    background: var(--bg-secondary);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 20px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border);
}

.status-indicator {
    display: flex;
    align-items: center;
    gap: 16px;
}

.status-icon {
    font-size: 3rem;
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--bg-input);
    animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.05); opacity: 0.9; }
}

.status-text h2 {
    font-size: 1.35rem;
    margin-bottom: 4px;
}

.status-text p {
    font-size: 0.95rem;
    color: var(--text-secondary);
}

/* Power on/off states */
.power-status-card.power-on {
    background: linear-gradient(135deg, #064e3b 0%, var(--bg-secondary) 100%);
}

.power-status-card.power-on .status-icon {
    background: #10b981;
    box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
}

.power-status-card.power-off {
    background: linear-gradient(135deg, #7f1d1d 0%, var(--bg-secondary) 100%);
}

.power-status-card.power-off .status-icon {
    background: #ef4444;
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.4);
}

/* ========== COUNTDOWN TIMER ========== */
.countdown-section {
    margin-top: 24px;
    text-align: center;
}

.countdown-label {
    font-size: 0.95rem;
    color: var(--text-secondary);
    margin-bottom: 12px;
}

.countdown-timer {
    display: flex;
    justify-content: center;
    gap: 12px;
    align-items: center;
}

.time-unit {
    background: var(--bg-input);
    border-radius: 12px;
    padding: 12px 16px;
    min-width: 70px;
}

.time-value {
    font-size: 2rem;
    font-weight: 700;
    display: block;
}

.time-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-transform: uppercase;
}

.time-separator {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-secondary);
}
```

### 3. Додати JavaScript логіку

В `app.js` додати після функції `displaySavedAddress`:

```javascript
// ============ POWER STATUS ============
function initPowerStatus(chergGpv) {
    const powerCard = document.getElementById('power-status-card');
    const statusIcon = document.getElementById('status-icon');
    const statusTitle = document.getElementById('status-title');
    const statusSubtitle = document.getElementById('status-subtitle');
    const countdownSection = document.getElementById('countdown-section');
    
    if (!powerCard) return;
    
    // Визначити статус (спрощена логіка)
    const currentHour = new Date().getHours();
    const isPowerOn = currentHour % 2 === 0; // Приклад
    
    // Оновити UI
    powerCard.classList.remove('power-on', 'power-off');
    powerCard.classList.add(isPowerOn ? 'power-on' : 'power-off');
    
    if (isPowerOn) {
        statusIcon.textContent = '✅';
        statusTitle.textContent = 'Світло Є';
        statusSubtitle.textContent = 'Живлення активне';
    } else {
        statusIcon.textContent = '❌';
        statusTitle.textContent = 'Світло Немає';
        statusSubtitle.textContent = 'Планове відключення';
    }
    
    // Запустити таймер (опціонально)
    // startCountdown(nextChangeTime, isPowerOn);
}

function startCountdown(targetTime, isPowerOn) {
    const hoursEl = document.getElementById('hours');
    const minutesEl = document.getElementById('minutes');
    const secondsEl = document.getElementById('seconds');
    const countdownSection = document.getElementById('countdown-section');
    const countdownLabel = document.getElementById('countdown-label');
    
    if (!hoursEl) return;
    
    countdownSection.style.display = 'block';
    countdownLabel.textContent = isPowerOn ? 'До відключення:' : 'До включення:';
    
    const interval = setInterval(() => {
        const now = new Date();
        const target = new Date(targetTime);
        const diff = target - now;
        
        if (diff <= 0) {
            clearInterval(interval);
            // Оновити статус
            initPowerStatus();
            return;
        }
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        hoursEl.textContent = String(hours).padStart(2, '0');
        minutesEl.textContent = String(minutes).padStart(2, '0');
        secondsEl.textContent = String(seconds).padStart(2, '0');
    }, 1000);
}
```

### 4. Викликати функцію після завантаження адреси

В функції `displaySavedAddress` додати:

```javascript
async function displaySavedAddress() {
    const saved = loadSavedAddress();
    
    if (!saved) {
        showView('select');
        await initializeCitySearch();
        return;
    }
    
    // ... існуючий код ...
    
    // ДОДАТИ В КІНЦІ:
    initPowerStatus(saved.cherg_gpv);
    
    showView('saved');
}
```

## 🎯 Результат

✅ Робоча система вибору адреси (залишається без змін)
✅ Новий дизайн статусу світла (додається тільки на saved-view)
✅ Таймер зворотного відліку (опціонально)
✅ Всі CORS проблеми вирішені (використовується старий код)

## ⚠️ Важливо

Для точного визначення статусу світла потрібно:
1. Парсити реальні графіки
2. Або отримати API з детальними даними
3. Або дозволити користувачам вводити розклад вручну

Поточна реалізація - це **демонстраційна**. Функція `initPowerStatus` використовує шаблонну логіку.

---

**Такий підхід дозволить додати новий дизайн без поломки існуючого функціоналу!** 🚀
