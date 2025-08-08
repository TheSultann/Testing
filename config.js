// config.js
require('dotenv').config(); // Добавь эту строку для чтения .env ЛОКАЛЬНО (если нужно)
const { createClient } = require('@supabase/supabase-js');

// --- Константы ---
const pieTypes = ['Мясо', 'Картошка', 'Сосиска в тесте']; // Изменено
const currencySymbol = 'сум';

// --- Чтение из переменных окружения ---
// Render автоматически предоставит эти переменные
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS || '64501841'; // Обязательно установи на Render!
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Это anon public ключ
const token = process.env.TELEGRAM_BOT_TOKEN;

// Проверка, что переменные загружены
if (!supabaseUrl || !supabaseKey || !token || !ALLOWED_CHAT_IDS) {
    console.error("!!! КРИТИЧЕСКАЯ ОШИБКА: Не все переменные окружения (SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS) заданы!");
    process.exit(1); // Завершаем работу, если нет ключей
}

// --- Подключение к Supabase ---
const supabase = createClient(supabaseUrl, supabaseKey);
console.log('Supabase клиент создан (из config.js).');

module.exports = {
    pieTypes,
    currencySymbol,
    supabase,
    token, // Экспортируем токен, прочитанный из окружения
    ALLOWED_CHAT_IDS // Экспортируем ID, прочитанные из окружения
};