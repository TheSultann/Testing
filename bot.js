const TelegramBot = require('node-telegram-bot-api');
const express =require('express');
const cron = require('node-cron');
const config = require('./config');
const utils = require('./utils');
const db = require('./db');
const keyboards = require('./keyboards');

// --- Инициализация ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(port, () => console.log(`Server running on port ${port}`));

const bot = new TelegramBot(config.token, { polling: true });
console.log('Бот запущен...');

let userState = {};
function initializeUserState(chatId) {
    if (!userState[chatId]) {
        userState[chatId] = { action: null, data: {} };
    }
}

// --- ОБНОВЛЕННАЯ ФУНКЦИЯ ГЕНЕРАЦИИ ОТЧЕТА ---
async function generateAndSendReport(chatId, startDate, endDate, messageId = null, isScheduled = false) {
    const periodTitle = startDate === endDate ? `за ${startDate}` : `за период с ${startDate} по ${endDate}`;
    const reportHeader = isScheduled ? `Автоматический отчет ${periodTitle}` : `Статистика ${periodTitle}`;
    
    console.log(`[${chatId}] Запрос статистики ${periodTitle}`);
    if (messageId) {
        await bot.editMessageText(`⏳ Загружаю статистику ${periodTitle}...`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(e => console.warn(e.message));
    } else {
        bot.sendChatAction(chatId, 'typing');
    }

    const stats = await db.getStatsForPeriod(chatId, startDate, endDate);
    if (!stats) {
        bot.sendMessage(chatId, `❌ Не удалось получить статистику ${periodTitle}.`, keyboards.mainKeyboard);
        return;
    }

    let report = `📊 ${reportHeader}:\n\n`;
    config.pieTypes.forEach(type => {
        const pieStat = stats.pies[type] || { manufactured: 0, sold: 0, revenue: 0, price: stats.prices[type] || 0, written_off: 0, loss: 0 };
        report += `"${type}" (цена: ${utils.formatNumber(pieStat.price)} ${config.currencySymbol}):\n`;
        report += `- Изготовлено: ${utils.formatNumber(pieStat.manufactured)}\n`;
        report += `- Продано: ${utils.formatNumber(pieStat.sold)} шт.\n`;
        if (pieStat.written_off > 0) {
            report += `- Списано: ${utils.formatNumber(pieStat.written_off)} шт. (потеря: ${utils.formatNumber(pieStat.loss)} ${config.currencySymbol})\n`;
        }
        report += `- Выручка (${type}): ${utils.formatNumber(pieStat.revenue)} ${config.currencySymbol}.\n\n`;
    });
    report += `Общая выручка: ${utils.formatNumber(stats.totalRevenue)} ${config.currencySymbol}.\n`;
    if (stats.lossFromWriteOff > 0) {
        report += `🗑️ Потери от списаний: ${utils.formatNumber(stats.lossFromWriteOff)} ${config.currencySymbol}.\n`;
    }
    report += `💸 Расходы за период: ${utils.formatNumber(stats.expenses)} ${config.currencySymbol}.\n`;
    report += `📈 Чистая прибыль: ${utils.formatNumber(stats.profit)} ${config.currencySymbol}.\n`;

    await bot.sendMessage(chatId, report, keyboards.mainKeyboard);
}

// --- Обработчики команд и сообщений ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    if (!utils.checkAccess(chatId)) {
        bot.sendMessage(chatId, '⛔ У вас нет доступа к этому боту.');
        return;
    }
    initializeUserState(chatId);
    bot.sendMessage(chatId, 'Привет! Я помогу тебе вести учет пирожков. Выбери действие:', keyboards.mainKeyboard);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!utils.checkAccess(chatId) || !text || text.startsWith('/')) return;

    initializeUserState(chatId);
    const state = userState[chatId];
    console.log(`[${chatId}] Текст: "${text}" | Состояние: ${state?.action || 'нет'}`);

    // 1. Обработка состояний ввода
    if (state && state.action) {
        // ... (существующие case'ы без изменений)
        switch (state.action) {
            case 'awaiting_pie_quantity': {
                const quantity = parseInt(text, 10);
                if (isNaN(quantity) || quantity <= 0) { bot.sendMessage(chatId, '❌ Введите корректное число (больше нуля).'); return; }
                const pieType = state.data.type;
                const newTotal = await db.addManufacturedToDb(chatId, pieType, quantity);
                bot.sendMessage(chatId, newTotal !== null ? `✅ Добавлено: ${utils.formatNumber(quantity)} "${pieType}".\nВсего сегодня: ${utils.formatNumber(newTotal)}.` : `❌ Ошибка сохранения.`, keyboards.mainKeyboard);
                userState[chatId] = { action: null, data: {} };
                return;
            }
            case 'awaiting_remaining_input': {
                const quantity = parseInt(text, 10);
                const { pieType, manufactured } = state.data;
                if (isNaN(quantity) || quantity < 0) { bot.sendMessage(chatId, `❌ Введите корректное число (0 или больше).`); return; }
                if (quantity > manufactured) { bot.sendMessage(chatId, `❌ Остаток (${quantity}) не может быть больше изготовленного (${manufactured}).`); return; }
                const success = await db.saveRemainingToDb(chatId, pieType, quantity);
                if (success) {
                    bot.sendMessage(chatId, `👍 Записан остаток для "${pieType}": ${utils.formatNumber(quantity)}.`);
                    userState[chatId] = { action: null, data: {} };
                    await bot.sendMessage(chatId, 'Выбери следующий пирожок или вернись назад:', await keyboards.createRemainingKeyboard(chatId));
                } else {
                    bot.sendMessage(chatId, `❌ Ошибка сохранения остатка.`, keyboards.mainKeyboard);
                    userState[chatId] = { action: null, data: {} };
                }
                return;
            }
            // --- НОВЫЙ CASE ДЛЯ СПИСАНИЙ ---
            case 'awaiting_write_off_quantity': {
                const quantity = parseInt(text, 10);
                const { pieType, remaining } = state.data;
                if (isNaN(quantity) || quantity <= 0) {
                    bot.sendMessage(chatId, '❌ Введите корректное число (больше нуля).'); return;
                }
                if (quantity > remaining) {
                    bot.sendMessage(chatId, `❌ Количество для списания (${quantity}) не может быть больше остатка (${remaining}). Попробуйте еще раз.`); return;
                }
                const result = await db.processWriteOffInDb(chatId, pieType, quantity);
                if (result.success) {
                    bot.sendMessage(chatId, `✅ Успешно списано ${quantity} шт. "${pieType}".`);
                    userState[chatId] = { action: null, data: {} };
                    await bot.sendMessage(chatId, 'Выберите следующую продукцию для списания:', await keyboards.createWriteOffKeyboard(chatId));
                } else {
                    bot.sendMessage(chatId, `❌ Ошибка при списании: ${result.message}`, keyboards.mainKeyboard);
                    userState[chatId] = { action: null, data: {} };
                }
                return;
            }
            // ... (остальные case'ы без изменений)
            case 'awaiting_expenses_input': {
                const amount = parseFloat(text.replace(',', '.'));
                if (isNaN(amount) || amount < 0) { bot.sendMessage(chatId, '❌ Введите корректную сумму.'); return; }
                const newTotal = await db.saveExpensesToDb(chatId, amount);
                bot.sendMessage(chatId, newTotal !== null ? `✅ Расходы (${utils.formatNumber(amount)}) добавлены. Общие за сегодня: ${utils.formatNumber(newTotal)} ${config.currencySymbol}.` : `❌ Ошибка сохранения.`, keyboards.mainKeyboard);
                userState[chatId] = { action: null, data: {} };
                return;
            }
            case 'awaiting_price_input': {
                const price = parseFloat(text.replace(',', '.'));
                const { type } = state.data;
                if (isNaN(price) || price < 0) { bot.sendMessage(chatId, '❌ Введите корректную цену.'); return; }
                const success = await db.savePriceToDb(chatId, type, price);
                bot.sendMessage(chatId, success ? `✅ Цена для "${type}" установлена: ${utils.formatNumber(price)} ${config.currencySymbol}.` : `❌ Ошибка сохранения.`);
                userState[chatId] = { action: null, data: {} };
                await bot.sendMessage(chatId, 'Текущие настройки цен:', await keyboards.createSettingsKeyboard(chatId));
                return;
            }
            case 'awaiting_custom_start_date': {
                if (!utils.isValidDate(text)) { bot.sendMessage(chatId, '❌ Неверный формат. Введите ГГГГ-ММ-ДД:'); return; }
                userState[chatId] = { action: 'awaiting_custom_end_date', data: { startDate: text } };
                bot.sendMessage(chatId, '✅ Отлично. Теперь введите дату конца (ГГГГ-ММ-ДД):');
                return;
            }
            case 'awaiting_custom_end_date': {
                if (!utils.isValidDate(text)) { bot.sendMessage(chatId, '❌ Неверный формат. Введите ГГГГ-ММ-ДД:'); return; }
                const { startDate } = state.data;
                if (new Date(text) < new Date(startDate)) { bot.sendMessage(chatId, '❌ Дата конца не может быть раньше даты начала.'); return; }
                userState[chatId] = { action: null, data: {} };
                await generateAndSendReport(chatId, startDate, text);
                return;
            }
        }
    }

    // 2. Обработка кнопок главного меню
    switch (text) {
        case '➕ Добавить изготовленные пирожки':
            bot.sendMessage(chatId, 'Какой тип пирожков изготовили?', keyboards.pieTypesKeyboard);
            break;
        case '📦 Ввести остатки':
            bot.sendMessage(chatId, 'Для какого пирожка ввести/изменить остаток?', await keyboards.createRemainingKeyboard(chatId));
            break;
        // --- НОВАЯ КНОПКА ---
        case '🗑️ Списать продукцию':
            bot.sendMessage(chatId, 'Выберите продукцию для списания (с остатком > 0):', await keyboards.createWriteOffKeyboard(chatId));
            break;
        case '💰 Ввести расходы':
            userState[chatId] = { action: 'awaiting_expenses_input', data: {} };
            bot.sendMessage(chatId, `Введите сумму расходов в ${config.currencySymbol}:`);
            break;
        case '📊 Посмотреть статистику':
            bot.sendMessage(chatId, 'Выберите период для статистики:', keyboards.statsPeriodKeyboard);
            break;
        case '🛠 Настройки':
            bot.sendMessage(chatId, '⚙️ Настройки цен на пирожки:', await keyboards.createSettingsKeyboard(chatId));
            break;
        default:
            console.log(`[${chatId}] Неизвестный текст/команда: "${text}"`);
            break;
    }
});

// Обработка инлайн-кнопок
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    if (!utils.checkAccess(chatId)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ У вас нет доступа.', show_alert: true });
        return;
    }

    initializeUserState(chatId);
    console.log(`[${chatId}] Callback: ${data}`);
    
    const hideKeyboard = async () => {
        try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }); }
        catch (e) { await bot.deleteMessage(chatId, msg.message_id).catch(err => console.warn(err.message)); }
    };

    // --- Обработка списаний ---
    if (data.startsWith('write_off_')) {
        const pieType = data.substring('write_off_'.length);
        const logEntry = await db.getDailyLogEntry(chatId, pieType);
        const remainingCount = logEntry.remaining || 0;

        if (remainingCount <= 0) {
            bot.answerCallbackQuery(callbackQuery.id, { text: `У "${pieType}" нет остатка для списания.`, show_alert: true });
            await bot.editMessageReplyMarkup((await keyboards.createWriteOffKeyboard(chatId)).reply_markup, { chat_id: chatId, message_id: msg.message_id });
            return;
        }
        userState[chatId] = { action: 'awaiting_write_off_quantity', data: { pieType, remaining: remainingCount } };
        await hideKeyboard();
        bot.sendMessage(chatId, `Сколько списать пирожков "${pieType}"? (В остатке: ${remainingCount}) Введите число:`);
        return bot.answerCallbackQuery(callbackQuery.id);
    }
    
    // ... (существующие обработчики callback'ов)
    if (data.startsWith('stats_period_')) {
        const periodType = data.substring('stats_period_'.length);
        if (periodType === 'custom') {
            userState[chatId] = { action: 'awaiting_custom_start_date', data: {} };
            await hideKeyboard();
            bot.sendMessage(chatId, '✍️ Введите дату начала периода (ГГГГ-ММ-ДД):');
        } else {
            let startDate, endDate = utils.getCurrentDate();
            if (periodType === 'today') startDate = endDate;
            else if (periodType === 'week') { const d = new Date(); d.setDate(d.getDate() - 6); startDate = d.toISOString().split('T')[0]; }
            else if (periodType === 'month') { const d = new Date(); startDate = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]; }
            else { return bot.answerCallbackQuery(callbackQuery.id, { text: 'Неизвестный период' }); }
            await generateAndSendReport(chatId, startDate, endDate, msg.message_id);
        }
        return bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith('add_pie_')) {
        const pieType = data.substring('add_pie_'.length);
        userState[chatId] = { action: 'awaiting_pie_quantity', data: { type: pieType } };
        await hideKeyboard();
        bot.sendMessage(chatId, `Сколько пирожков "${pieType}" изготовили?`);
        return bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith('enter_remaining_')) {
        const pieType = data.substring('enter_remaining_'.length);
        const logEntry = await db.getDailyLogEntry(chatId, pieType);
        const manufacturedCount = logEntry.manufactured || 0;
        if (manufacturedCount <= 0) {
            bot.answerCallbackQuery(callbackQuery.id, { text: `"${pieType}" сегодня не изготовлены.` });
            await bot.editMessageReplyMarkup((await keyboards.createRemainingKeyboard(chatId)).reply_markup, { chat_id: chatId, message_id: msg.message_id });
            return;
        }
        userState[chatId] = { action: 'awaiting_remaining_input', data: { pieType, manufactured: manufacturedCount } };
        const prevRem = (logEntry.remaining !== null) ? ` (ранее: ${logEntry.remaining})` : '';
        await hideKeyboard();
        bot.sendMessage(chatId, `Сколько осталось "${pieType}"? (Изготовлено: ${manufacturedCount}${prevRem})`);
        return bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith('set_price_')) {
        const pieType = data.substring('set_price_'.length);
        userState[chatId] = { action: 'awaiting_price_input', data: { type: pieType } };
        await hideKeyboard();
        bot.sendMessage(chatId, `Введите новую цену для "${pieType}" в ${config.currencySymbol}:`);
        return bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith('back_to_main_') || data.startsWith('no_pies_for_')) {
        await bot.deleteMessage(chatId, msg.message_id).catch(e => console.warn(e.message));
        bot.sendMessage(chatId, 'Выбери действие:', keyboards.mainKeyboard);
        return bot.answerCallbackQuery(callbackQuery.id);
    } else {
        console.warn(`[${chatId}] Неизвестный callback: ${data}`);
        return bot.answerCallbackQuery(callbackQuery.id, { text: 'Неизвестное действие' });
    }
});

// --- ПЛАНИРОВЩИК И ОБРАБОТКА ОШИБОК ---
if (cron.validate(config.REPORT_SCHEDULE)) {
    cron.schedule(config.REPORT_SCHEDULE, async () => {
        console.log(`[CRON] Запуск ежедневного отчета...`);
        const today = utils.getCurrentDate();
        const chatIds = config.ALLOWED_CHAT_IDS.split(',').map(id => id.trim());
        for (const chatId of chatIds) {
            try {
                console.log(`[CRON] Отправка отчета пользователю ${chatId}`);
                await generateAndSendReport(chatId, today, today, null, true);
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`[CRON] Не удалось отправить отчет ${chatId}:`, error.message);
            }
        }
        console.log(`[CRON] Отправка завершена.`);
    }, { scheduled: true, timezone: config.REPORT_TIMEZONE });
    console.log(`Авто-отчет запланирован на ${config.REPORT_SCHEDULE} (Timezone: ${config.REPORT_TIMEZONE})`);
} else {
    console.error(`!!! ОШИБКА: Неверный формат cron-строки: "${config.REPORT_SCHEDULE}"`);
}

bot.on('polling_error', (e) => console.error(`[Polling Error] ${e.message}`));
process.on('uncaughtException', (e, o) => console.error(`Неперехваченное исключение: ${e}`, o));
process.on('unhandledRejection', (r, p) => console.error('Необработанный reject:', p, `Причина: ${r}`));