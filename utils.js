// utils.js
const config = require('./config'); // Нужен доступ к ALLOWED_CHAT_IDS

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

// --- НОВАЯ Функция проверки доступа ---
function checkAccess(chatId) {
    if (!config.ALLOWED_CHAT_IDS || config.ALLOWED_CHAT_IDS === 'ВАШ_ID_1,ВАШ_ID_2') { // Добавлена проверка на placeholder
        console.warn("!!! Список разрешенных ID (ALLOWED_CHAT_IDS) не задан или содержит placeholder в config.js! Доступ будет заблокирован.");
        return false; // Блокируем доступ, если список не задан или не изменен
    }
    // Преобразуем строку ID в массив строк, убираем пробелы, если есть
    const allowedIds = config.ALLOWED_CHAT_IDS.split(',').map(id => id.trim());
    // Проверяем, есть ли chatId (он числовой) в массиве строк allowedIds
    const hasAccess = allowedIds.includes(String(chatId));
    if (!hasAccess) {
        console.log(`[${chatId}] Отказ в доступе. ID нет в списке разрешенных.`);
    }
    return hasAccess;
}

module.exports = {
    getCurrentDate,
    formatNumber,
    checkAccess // Экспортируем новую функцию
};