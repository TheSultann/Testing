const { pieTypes, currencySymbol } = require('./config');
const { formatNumber } = require('./utils');
const db = require('./db');

// Основная клавиатура
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['➕ Добавить изготовленные пирожки'],
            ['📦 Ввести остатки', '🗑️ Списать продукцию'],
            ['💰 Ввести расходы', '📊 Посмотреть статистику'],
            ['🛠 Настройки']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// Клавиатура выбора типа пирожка (для добавления изготовленных)
const pieTypesKeyboard = {
    reply_markup: {
        inline_keyboard: [
            ...pieTypes.map(type => ([{ text: type, callback_data: `add_pie_${type}` }])),
            [{ text: '🔙 Назад', callback_data: 'back_to_main_from_add' }]
        ]
    }
};

// Клавиатура Настроек
async function createSettingsKeyboard(chatId) {
    const currentPrices = await db.getPricesFromDb(chatId);
    const buttons = pieTypes.map(type => {
        const priceText = currentPrices[type] > 0 ? `(${formatNumber(currentPrices[type])} ${currencySymbol})` : '(не задана)';
        return [{ text: `💲 ${type} ${priceText}`, callback_data: `set_price_${type}` }];
    });
    buttons.push([{ text: '🔙 Назад в гл. меню', callback_data: 'back_to_main_from_settings' }]);
    return { reply_markup: { inline_keyboard: buttons } };
}

// Клавиатура для Ввода Остатков
async function createRemainingKeyboard(chatId) {
    const logs = await db.getTodaysLogsGrouped(chatId);
    const buttons = pieTypes
        .filter(type => (logs[type]?.manufactured || 0) > 0)
        .map(type => {
            const log = logs[type];
            const manufactured = log?.manufactured || 0;
            const remainingText = (log?.remaining !== null && log?.remaining !== undefined) ? log.remaining : 'не введено';
            // Возвращаем текст кнопки к исходному, более чистому виду
            const buttonText = `📦 ${type} (${formatNumber(manufactured)} / ${remainingText})`;
            return [{ text: buttonText, callback_data: `enter_remaining_${type}` }];
        });

    if (buttons.length > 0) {
        buttons.push([{ text: '🔙 Назад в гл. меню', callback_data: 'back_to_main_from_remaining' }]);
    } else {
        buttons.push([{ text: 'Сначала добавьте изготовленные пирожки', callback_data: 'no_pies_for_remaining' }]);
        buttons.push([{ text: '🔙 Назад в гл. меню', callback_data: 'back_to_main_from_remaining' }]);
    }
    return { reply_markup: { inline_keyboard: buttons } };
}

// Клавиатура для Списаний
async function createWriteOffKeyboard(chatId) {
    const logs = await db.getTodaysLogsGrouped(chatId);
    const buttons = pieTypes
        .filter(type => (logs[type]?.remaining || 0) > 0)
        .map(type => {
            const log = logs[type];
            const remaining = log?.remaining || 0;
            const writtenOff = log?.written_off || 0;
            // Здесь информация о списанных товарах полезна и остается
            return [{ text: `🗑️ ${type} (остаток: ${remaining}, списано: ${writtenOff})`, callback_data: `write_off_${type}` }];
        });

    if (buttons.length > 0) {
        buttons.push([{ text: '🔙 Назад в гл. меню', callback_data: 'back_to_main_from_writeoff' }]);
    } else {
        buttons.push([{ text: 'Нет продукции с остатками для списания', callback_data: 'no_pies_for_writeoff' }]);
    }
    return { reply_markup: { inline_keyboard: buttons } };
}

// Клавиатура выбора периода статистики
const statsPeriodKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '📈 За сегодня', callback_data: 'stats_period_today' },
                { text: '📅 За неделю', callback_data: 'stats_period_week' }
            ],
            [
                { text: '🗓️ За месяц', callback_data: 'stats_period_month' },
                { text: '✍️ Выбрать даты', callback_data: 'stats_period_custom' }
            ],
            [
                { text: '🧠 Аналитика', callback_data: 'show_analytics_menu' }
            ],
            [
                { text: '🔙 Назад', callback_data: 'back_to_main_from_stats' }
            ]
        ]
    }
};

// Клавиатура для выбора типа аналитики
const analyticsTypeKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🏆 Самый прибыльный пирожок', callback_data: 'analytics_most_profitable' }],
            [{ text: '📈 Самый продаваемый пирожок', callback_data: 'analytics_most_sold' }],
            [{ text: '📅 Анализ по дням недели', callback_data: 'analytics_weekday' }],
            [{ text: '🔙 Назад в статистику', callback_data: 'back_to_stats_menu' }]
        ]
    }
};

module.exports = {
    mainKeyboard,
    pieTypesKeyboard,
    statsPeriodKeyboard,
    analyticsTypeKeyboard,
    createSettingsKeyboard,
    createRemainingKeyboard,
    createWriteOffKeyboard
};