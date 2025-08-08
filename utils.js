const config = require('./config');

// --- Вспомогательная функция для получения текущей даты в формате YYYY-MM-DD ---
function getCurrentDate() {
    return new Date().toISOString().split('T')[0];
}

// --- Вспомогательная функция для форматирования чисел с разделителями тысяч ---
function formatNumber(value) {
    if (typeof value !== 'number' || isNaN(value)) {
        return '0';
    }
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// --- Функция проверки доступа ---
function checkAccess(chatId) {
    if (!config.ALLOWED_CHAT_IDS || config.ALLOWED_CHAT_IDS === 'ВАШ_ID_1,ВАШ_ID_2') {
        console.warn("!!! Список разрешенных ID (ALLOWED_CHAT_IDS) не задан или содержит placeholder! Доступ будет заблокирован.");
        return false;
    }
    const allowedIds = config.ALLOWED_CHAT_IDS.split(',').map(id => id.trim());
    const hasAccess = allowedIds.includes(String(chatId));
    if (!hasAccess) {
        console.log(`[${chatId}] Отказ в доступе. ID нет в списке разрешенных.`);
    }
    return hasAccess;
}

/**
 * Проверяет, является ли строка валидной датой в формате YYYY-MM-DD.
 * @param {string} dateString - Строка для проверки.
 * @returns {boolean} - true, если дата валидна, иначе false.
 */
function isValidDate(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regex)) return false;

    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

module.exports = {
    getCurrentDate,
    formatNumber,
    checkAccess,
    isValidDate
};