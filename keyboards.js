// keyboards.js
const { pieTypes, currencySymbol } = require('./config'); // Нужны константы
const { formatNumber } = require('./utils'); // Нужен форматер
const db = require('./db'); // Нужны функции БД для клавиатур

// Основная клавиатура
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['➕ Добавить изготовленные пирожки'],
            ['📦 Ввести остатки', '💰 Ввести расходы'],
            ['📊 Посмотреть статистику', '🛠 Настройки']
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

// Клавиатура Настроек (ЗАГРУЖАЕТ ЦЕНЫ ИЗ БД)
async function createSettingsKeyboard(chatId) {
    console.log(`[${chatId}] Создание клавиатуры настроек...`);
    const currentPrices = await db.getPricesFromDb(chatId); // Используем db.

    const buttons = pieTypes.map(type => {
        const priceText = currentPrices[type] > 0 ? `(${formatNumber(currentPrices[type])} ${currencySymbol})` : '(не задана)';
        return [{ text: `💲 ${type} ${priceText}`, callback_data: `set_price_${type}` }];
    });
    buttons.push([{ text: '🔙 Назад в гл. меню', callback_data: 'back_to_main_from_settings' }]);

    return {
        reply_markup: {
            inline_keyboard: buttons
        }
    };
}


// Клавиатура для Ввода Остатков
async function createRemainingKeyboard(chatId) {
    console.log(`[${chatId}] Создание клавиатуры ввода остатков...`);
    const logs = await db.getTodaysLogsGrouped(chatId); // Используем db.

    const buttons = pieTypes
        .filter(type => (logs[type]?.manufactured || 0) > 0)
        .map(type => {
            const log = logs[type];
            const manufactured = log?.manufactured || 0;
            const remainingText = (log?.remaining !== null && log?.remaining !== undefined) ? log.remaining : 'не введено';
            return [{ text: `📦 ${type} (${formatNumber(manufactured)} / ${remainingText})`, callback_data: `enter_remaining_${type}` }];
        });

    if (buttons.length > 0) {
         buttons.push([{ text: '🔙 Назад в гл. меню', callback_data: 'back_to_main_from_remaining' }]);
    } else {
         buttons.push([{ text: 'Сначала добавьте изготовленные пирожки', callback_data: 'no_pies_for_remaining'}])
         buttons.push([{ text: '🔙 Назад в гл. меню', callback_data: 'back_to_main_from_remaining' }]);
    }

    return {
        reply_markup: {
            inline_keyboard: buttons
        }
    };
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
                 { text: '🔙 Назад', callback_data: 'back_to_main_from_stats' }
            ]
        ]
    }
};

module.exports = {
    mainKeyboard,
    pieTypesKeyboard,
    statsPeriodKeyboard,
    createSettingsKeyboard,
    createRemainingKeyboard
};