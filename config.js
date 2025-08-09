require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// --- Константы ---
const pieTypes = ['Мясо', 'Картошка', 'Сосиска в тесте'];
const currencySymbol = 'сум';

// --- Чтение из переменных окружения ---
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS || '';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const token = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY; // <-- ДОБАВЛЕНО

// --- Параметры для планировщика ---
const REPORT_SCHEDULE = process.env.REPORT_SCHEDULE || '0 20 * * *'; 
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Tashkent';

// Проверка, что все ключевые переменные загружены
if (!supabaseUrl || !supabaseKey || !token || !ALLOWED_CHAT_IDS || !geminiKey) {
    console.error("!!! КРИТИЧЕСКАЯ ОШИБКА: Не все переменные окружения (SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, GEMINI_API_KEY) заданы!");
    process.exit(1);
}

// --- Подключение к Supabase ---
const supabase = createClient(supabaseUrl, supabaseKey);
console.log('Supabase клиент создан (из config.js).');

module.exports = {
    pieTypes,
    currencySymbol,
    supabase,
    token,
    geminiKey, // <-- ДОБАВЛЕНО
    ALLOWED_CHAT_IDS,
    REPORT_SCHEDULE,
    REPORT_TIMEZONE
};