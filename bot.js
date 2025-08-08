const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const config = require('./config');
const utils = require('./utils'); // Теперь импортируем checkAccess
const db = require('./db');
const keyboards = require('./keyboards');

// --- Инициализация HTTP-сервера ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(port, () => console.log(`Server running on port ${port}`));

// --- Инициализация бота ---
const bot = new TelegramBot(config.token, { polling: true });
console.log('Бот запущен (из bot.js)...');

// --- Хранилище состояния диалога ---
let userState = {};

// --- Инициализация состояния пользователя ---
function initializeUserState(chatId) {
    if (!userState[chatId]) {
        userState[chatId] = { action: null, data: {} };
    }
}

// --- Обработчики команд и сообщений ---

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    // --- Проверка доступа для /start ---
    if (!utils.checkAccess(chatId)) {
        // console.log(`[${chatId}] Отказ в доступе (команда /start).`); // Лог уже есть в checkAccess
        bot.sendMessage(chatId, '⛔ У вас нет доступа к этому боту.');
        return; // Прекращаем обработку
    }
    // --- КОНЕЦ Проверки ---

    initializeUserState(chatId);
    console.log(`[${chatId}] Получена команда /start`);
    bot.sendMessage(chatId, 'Привет! Я помогу тебе вести учет пирожков. Выбери действие:', keyboards.mainKeyboard);
});

// Обработка текстовых сообщений (кнопки и ввод данных)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // --- Проверка доступа для ВСЕХ сообщений (кроме /start) ---
    if (!utils.checkAccess(chatId)) {
        // console.log(`[${chatId}] Отказ в доступе (сообщение: "${text}").`); // Лог уже есть в checkAccess
        // Не отвечаем ничего, чтобы не спамить неавторизованным
        return; // Прекращаем обработку
    }
    // --- КОНЕЦ Проверки ---

    if (!text) { console.log(`[${chatId}] Получено нетекстовое сообщение.`); return; }

    initializeUserState(chatId);
    const state = userState[chatId];
    console.log(`[${chatId}] Текст: "${text}" | Состояние: ${state?.action || 'нет'}`);

    // 1. Обработка состояний ввода
    if (state && state.action === 'awaiting_pie_quantity') {
        const quantity = parseInt(text, 10);
        if (isNaN(quantity) || quantity <= 0) {
            bot.sendMessage(chatId, '❌ Пожалуйста, введи корректное число (больше нуля).'); return;
        }
        const pieType = state.data.type;
        console.log(`[${chatId}] Введено количество ${quantity} для "${pieType}". Вызов RPC...`);
        bot.sendChatAction(chatId, 'typing');
        const newTotal = await db.addManufacturedToDb(chatId, pieType, quantity);
        if (newTotal !== null) {
            bot.sendMessage(chatId, `✅ Добавлено: ${utils.formatNumber(quantity)} "${pieType}".\nВсего изготовлено "${pieType}" сегодня: ${utils.formatNumber(newTotal)}.`, keyboards.mainKeyboard);
        } else {
            bot.sendMessage(chatId, `❌ Ошибка при сохранении данных об изготовленных "${pieType}". Попробуйте позже.`, keyboards.mainKeyboard);
        }
        userState[chatId] = { action: null, data: {} };
        return;

    } else if (state && state.action === 'awaiting_remaining_input') {
        const quantity = parseInt(text, 10);
        const pieType = state.data.pieType;
        const manufacturedCount = state.data.manufactured;
        if (isNaN(quantity) || quantity < 0) {
            bot.sendMessage(chatId, `❌ Введи корректное число (0 или больше) для остатка "${pieType}".`); return;
        }
        if (quantity > manufacturedCount) {
             bot.sendMessage(chatId, `❌ Ошибка: остаток (${utils.formatNumber(quantity)}) не может быть больше, чем изготовлено (${utils.formatNumber(manufacturedCount)}) для "${pieType}".\nПопробуй ввести остаток еще раз:`); return;
        }
        console.log(`[${chatId}] Введен остаток ${quantity} для "${pieType}". Сохранение в БД...`);
        bot.sendChatAction(chatId, 'typing');
        const success = await db.saveRemainingToDb(chatId, pieType, quantity);
        if (success) {
            bot.sendMessage(chatId, `👍 Записан остаток для "${pieType}": ${utils.formatNumber(quantity)}.`);
            userState[chatId] = { action: null, data: {} };
            try {
                const remainingKeyboard = await keyboards.createRemainingKeyboard(chatId);
                await bot.sendMessage(chatId, 'Выбери следующий пирожок или вернись назад:', remainingKeyboard);
            } catch(e) {
                 console.error(`[${chatId}] Ошибка при показе клавиатуры остатков после ввода:`, e);
                 bot.sendMessage(chatId, 'Не удалось обновить меню ввода остатков.', keyboards.mainKeyboard);
            }
        } else {
             bot.sendMessage(chatId, `❌ Ошибка при сохранении остатка "${pieType}". Попробуйте позже.`, keyboards.mainKeyboard);
             userState[chatId] = { action: null, data: {} };
        }
        return;

    } else if (state && state.action === 'awaiting_expenses_input') {
        const amount = parseFloat(text.replace(',', '.'));
        if (isNaN(amount) || amount < 0) {
            bot.sendMessage(chatId, '❌ Введи корректную сумму расходов (число, 0 или больше).'); return;
        }
        console.log(`[${chatId}] Введены расходы ${amount}. Вызов RPC...`);
        bot.sendChatAction(chatId, 'typing');
        const newTotalExpenses = await db.saveExpensesToDb(chatId, amount);
        if (newTotalExpenses !== null) {
            bot.sendMessage(chatId, `✅ Расходы (${utils.formatNumber(amount)}) добавлены. Общие расходы за сегодня: ${utils.formatNumber(newTotalExpenses)} ${config.currencySymbol}.`, keyboards.mainKeyboard);
        } else {
            bot.sendMessage(chatId, `❌ Ошибка при сохранении расходов. Попробуйте позже.`, keyboards.mainKeyboard);
        }
        userState[chatId] = { action: null, data: {} };
        return;

    } else if (state && state.action === 'awaiting_price_input') {
        const price = parseFloat(text.replace(',', '.'));
        const pieType = state.data.type;
        if (isNaN(price) || price < 0) {
             bot.sendMessage(chatId, '❌ Введи корректную цену (число, 0 или больше).'); return;
        }
        console.log(`[${chatId}] Введена цена ${price} для "${pieType}". Сохранение в БД...`);
        bot.sendChatAction(chatId, 'typing');
        const success = await db.savePriceToDb(chatId, pieType, price);
        if (success) {
            bot.sendMessage(chatId, `✅ Цена для пирожков "${pieType}" установлена: ${utils.formatNumber(price)} ${config.currencySymbol}.`);
        } else {
            bot.sendMessage(chatId, `❌ Ошибка при сохранении цены для "${pieType}". Попробуйте позже.`);
        }
        userState[chatId] = { action: null, data: {} };
        try {
            const settingsKeyboard = await keyboards.createSettingsKeyboard(chatId);
            bot.sendMessage(chatId, 'Текущие настройки цен:', settingsKeyboard);
        } catch (e) {
            console.error(`[${chatId}] Ошибка при показе клавиатуры настроек после ввода цены:`, e);
            bot.sendMessage(chatId, 'Не удалось обновить меню настроек.', keyboards.mainKeyboard);
        }
        return;
    }

    // 2. Обработка кнопок главного меню (если не активно состояние ввода)
    console.log(`[${chatId}] Обработка кнопки главного меню: "${text}"`);
    switch (text) {
        case '➕ Добавить изготовленные пирожки':
            bot.sendMessage(chatId, 'Какой тип пирожков изготовили?', keyboards.pieTypesKeyboard);
            break;
        case '📦 Ввести остатки':
            bot.sendChatAction(chatId, 'typing');
            try {
                const remainingKeyboard = await keyboards.createRemainingKeyboard(chatId);
                await bot.sendMessage(chatId, 'Для какого пирожка ввести/изменить остаток?', remainingKeyboard);
            } catch (e) {
                 console.error(`[${chatId}] Ошибка при показе клавиатуры ввода остатков:`, e);
                 bot.sendMessage(chatId, '❌ Не удалось загрузить меню ввода остатков.', keyboards.mainKeyboard);
            }
            break;
        case '💰 Ввести расходы':
            userState[chatId] = { action: 'awaiting_expenses_input', data: {} };
            bot.sendMessage(chatId, `Введи сумму расходов в ${config.currencySymbol}, которую нужно ДОБАВИТЬ к сегодняшним (например, 50000 или 12500.50):`);
            break;
        case '📊 Посмотреть статистику':
            console.log(`[${chatId}] Нажата кнопка Статистика, показываем выбор периода.`);
            try {
                 await bot.sendMessage(chatId, 'Выберите период для статистики:', keyboards.statsPeriodKeyboard);
            } catch (e) {
                 console.error(`[${chatId}] Ошибка при показе клавиатуры выбора периода статистики:`, e);
                 bot.sendMessage(chatId, '❌ Не удалось показать выбор периода.', keyboards.mainKeyboard);
            }
            break;
        case '🛠 Настройки':
            bot.sendChatAction(chatId, 'typing');
             try {
                const settingsKeyboard = await keyboards.createSettingsKeyboard(chatId);
                await bot.sendMessage(chatId, '⚙️ Настройки цен на пирожки:', settingsKeyboard);
            } catch (e) {
                console.error(`[${chatId}] Ошибка при показе клавиатуры настроек:`, e);
                bot.sendMessage(chatId, '❌ Не удалось загрузить меню настроек.', keyboards.mainKeyboard);
            }
            break;
        default:
             console.log(`[${chatId}] Неизвестный текст/команда: "${text}"`);
             break;
    }
});

// Обработка нажатий инлайн-кнопок
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    // --- Проверка доступа для ВСЕХ callback'ов ---
    if (!utils.checkAccess(chatId)) {
        // console.log(`[${chatId}] Отказ в доступе (callback: ${data}).`); // Лог уже есть в checkAccess
        bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ У вас нет доступа.', show_alert: true });
        return; // Прекращаем обработку
    }
    // --- КОНЕЦ Проверки ---

    initializeUserState(chatId);
    console.log(`[${chatId}] Callback: ${data}`);

    // Обработка выбора периода статистики
    if (data.startsWith('stats_period_')) {
        const periodType = data.substring('stats_period_'.length);
        let startDate, endDate;
        let periodTitle = '';
        const today = new Date();
        endDate = utils.getCurrentDate();

        if (periodType === 'today') {
            startDate = endDate;
            periodTitle = 'за сегодня';
        } else if (periodType === 'week') {
            const weekAgo = new Date();
            weekAgo.setDate(today.getDate() - 6);
            startDate = weekAgo.toISOString().split('T')[0];
            periodTitle = 'за неделю';
        } else if (periodType === 'month') {
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            startDate = firstDayOfMonth.toISOString().split('T')[0];
            periodTitle = 'за этот месяц';
        } else {
            console.warn(`[${chatId}] Неизвестный тип периода статистики: ${periodType}`);
            bot.answerCallbackQuery(callbackQuery.id, { text: 'Неизвестный период' }); return;
        }

        console.log(`[${chatId}] Запрос статистики ${periodTitle} (${startDate} - ${endDate})`);
        bot.sendChatAction(chatId, 'typing');
        try {
             await bot.editMessageText(`⏳ Загружаю статистику ${periodTitle}...`, { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
        } catch (e) { console.warn(`[${chatId}] Не удалось изменить сообщение выбора периода: ${e.message}`); }

        const stats = await db.getStatsForPeriod(chatId, startDate, endDate);

        if (!stats) {
             bot.sendMessage(chatId, `❌ Не удалось получить статистику ${periodTitle}. Проверьте логи.`, keyboards.mainKeyboard); return;
        }

        let report = `📊 Статистика ${periodTitle} (${startDate} - ${endDate}):\n\n`;
        config.pieTypes.forEach(type => {
                const pieStat = stats.pies[type] || { manufactured: 0, sold: 0, revenue: 0, price: stats.prices[type] || 0 };
                report += `"${type}" (цена: ${utils.formatNumber(pieStat.price)} ${config.currencySymbol}):\n`;
                report += `- Изготовлено: ${utils.formatNumber(pieStat.manufactured)}\n`;
                report += `- Продано: ${utils.formatNumber(pieStat.sold)} шт.\n`;
                report += `- Выручка (${type}): ${utils.formatNumber(pieStat.revenue)} ${config.currencySymbol}.\n\n`;
            });
        report += `Общая выручка: ${utils.formatNumber(stats.totalRevenue)} ${config.currencySymbol}.\n`;
        report += `💸 Расходы за период: ${utils.formatNumber(stats.expenses)} ${config.currencySymbol}.\n`;
        report += `📈 Чистая прибыль: ${utils.formatNumber(stats.profit)} ${config.currencySymbol}.\n`;

        bot.sendMessage(chatId, report, keyboards.mainKeyboard);
        bot.answerCallbackQuery(callbackQuery.id);

    } else if (data === 'back_to_main_from_stats') {
         console.log(`[${chatId}] Нажата кнопка Назад из меню статистики`);
         try {
             await bot.deleteMessage(chatId, msg.message_id);
         } catch (e) { console.warn(`[${chatId}] Не удалось удалить/изменить сообщение при возврате из статистики: ${e.message}`); }
         bot.sendMessage(chatId, 'Выбери действие:', keyboards.mainKeyboard);
         bot.answerCallbackQuery(callbackQuery.id);

    // Обработка ввода остатков
    } else if (data.startsWith('enter_remaining_')) {
        const pieType = data.substring('enter_remaining_'.length);
        console.log(`[${chatId}] Нажата кнопка ввода остатка для "${pieType}"`);
        bot.sendChatAction(chatId, 'typing');
        const logEntry = await db.getDailyLogEntry(chatId, pieType);
        const manufacturedCount = logEntry.manufactured;

        if (manufacturedCount <= 0) {
            console.warn(`[${chatId}] Попытка ввести остаток для "${pieType}", но manufactured=0`);
            bot.answerCallbackQuery(callbackQuery.id, { text: `Пирожки "${pieType}" сегодня не изготовлены.` });
            try {
                const kbd = await keyboards.createRemainingKeyboard(chatId);
                await bot.editMessageReplyMarkup(kbd.reply_markup, { chat_id: chatId, message_id: msg.message_id });
            } catch (e) { console.error("Ошибка обновления KBD после 'не изготовлено'", e); }
            return;
        }
        userState[chatId] = { action: 'awaiting_remaining_input', data: { pieType: pieType, manufactured: manufacturedCount } };
        const previousRemaining = (logEntry.remaining !== null && logEntry.remaining !== undefined) ? ` (ранее введено: ${utils.formatNumber(logEntry.remaining)})` : '';
        try {
             await bot.editMessageText(
                 `Сколько осталось пирожков "${pieType}"? (Изготовлено: ${utils.formatNumber(manufacturedCount)}${previousRemaining}) Введи число:`,
                 { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }
             );
        } catch (e) {
            console.warn(`[${chatId}] Не удалось изменить сообщение для ввода остатка ${pieType}: ${e.message}. Отправляю новое.`);
            bot.sendMessage(chatId, `Сколько осталось пирожков "${pieType}"? (Изготовлено: ${utils.formatNumber(manufacturedCount)}${previousRemaining}) Введи число:`);
        }
        bot.answerCallbackQuery(callbackQuery.id);

    } else if (data === 'back_to_main_from_remaining' || data === 'no_pies_for_remaining') {
         console.log(`[${chatId}] Нажата кнопка Назад из меню остатков`);
         try {
             await bot.editMessageText('Возвращаемся в главное меню...', { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
         } catch (e) { console.warn(`[${chatId}] Не удалось изменить сообщение при возврате из остатков: ${e.message}`); }
         bot.sendMessage(chatId, 'Выбери действие:', keyboards.mainKeyboard);
         bot.answerCallbackQuery(callbackQuery.id);

    // Обработка добавления изготовленных
    } else if (data.startsWith('add_pie_')) {
        const pieType = data.substring('add_pie_'.length);
        console.log(`[${chatId}] Нажата кнопка добавления "${pieType}"`);
        userState[chatId] = { action: 'awaiting_pie_quantity', data: { type: pieType } };
        try {
            await bot.editMessageText(`Сколько пирожков "${pieType}" изготовили? Введи число:`, { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
        } catch (e) {
             console.warn(`[${chatId}] Не удалось изменить сообщение для ввода кол-ва ${pieType}: ${e.message}. Отправляю новое.`);
             bot.sendMessage(chatId, `Сколько пирожков "${pieType}" изготовили? Введи число:`);
        }
        bot.answerCallbackQuery(callbackQuery.id);

    } else if (data === 'back_to_main_from_add') {
         console.log(`[${chatId}] Нажата кнопка Назад из меню добавления`);
         try {
             await bot.editMessageText('Возвращаемся в главное меню...', { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
         } catch (e) { console.warn(`[${chatId}] Не удалось изменить сообщение при возврате из добавления: ${e.message}`); }
         bot.sendMessage(chatId, 'Выбери действие:', keyboards.mainKeyboard);
         bot.answerCallbackQuery(callbackQuery.id);

    // Обработка настроек
    } else if (data.startsWith('set_price_')) {
        const pieType = data.substring('set_price_'.length);
        console.log(`[${chatId}] Нажата кнопка установки цены для "${pieType}"`);
        userState[chatId] = { action: 'awaiting_price_input', data: { type: pieType } };
        try {
            await bot.editMessageText(`Введи новую цену для пирожков "${pieType}" в ${config.currencySymbol} (например, 15000 или 8500.50):`, { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
        } catch (e) {
             console.warn(`[${chatId}] Не удалось изменить сообщение для ввода цены ${pieType}: ${e.message}. Отправляю новое.`);
             bot.sendMessage(chatId, `Введи новую цену для пирожков "${pieType}" в ${config.currencySymbol} (например, 15000 или 8500.50):`);
        }
        bot.answerCallbackQuery(callbackQuery.id);

    } else if (data === 'back_to_main_from_settings') {
         console.log(`[${chatId}] Нажата кнопка Назад из меню настроек`);
         try {
             await bot.editMessageText('Возвращаемся в главное меню...', { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
         } catch (e) { console.warn(`[${chatId}] Не удалось изменить сообщение при возврате из настроек: ${e.message}`); }
         bot.sendMessage(chatId, 'Выбери действие:', keyboards.mainKeyboard);
         bot.answerCallbackQuery(callbackQuery.id);

    // Неизвестный callback
    } else {
        console.warn(`[${chatId}] Получен неизвестный callback_data: ${data}`);
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Неизвестное действие' });
    }
});


// --- Обработка ошибок ---
bot.on('polling_error', (error) => { console.error(`[Polling Error] ${error.code}: ${error.message}`); });
bot.on('webhook_error', (error) => { console.error(`[Webhook Error] ${error.code}: ${error.message}`); });
bot.on("error", (err) => { console.error("[General Bot Error]", err); });
process.on('uncaughtException', (error, origin) => { console.error(`\nНеперехваченное исключение: ${error}`, `Источник: ${origin}`); });
process.on('unhandledRejection', (reason, promise) => { console.error('Необработанный reject:', promise, `Причина: ${reason}`); });