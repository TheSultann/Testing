require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// --- Константы ---
const pieTypes = ['Мясо', 'Картошка', 'Сосиска в тесте'];
const currencySymbol = 'сум';

// --- Чтение из переменных окружения ---
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS || 'ВАШ_ID';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const token = process.env.TELEGRAM_BOT_TOKEN;

// --- НОВЫЕ ПАРАМЕТРЫ ДЛЯ ПЛАНИРОВЩИКА ---
// Cron-строка для ежедневного отчета. '0 22 * * *' = каждый день в 22:00.
const REPORT_SCHEDULE = process.env.REPORT_SCHEDULE || '0 20 * * *'; 
// Часовой пояс для планировщика. Важно для хостингов в других странах.
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Tashkent';

// Проверка, что переменные загружены
if (!supabaseUrl || !supabaseKey || !token || !ALLOWED_CHAT_IDS) {
    console.error("!!! КРИТИЧЕСКАЯ ОШИБКА: Не все переменные окружения (SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS) заданы!");
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
    ALLOWED_CHAT_IDS,
    REPORT_SCHEDULE,  // Экспортируем новую переменную
    REPORT_TIMEZONE   // Экспортируем новую переменную
};