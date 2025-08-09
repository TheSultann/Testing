const { supabase, pieTypes } = require('./config');
const { getCurrentDate } = require('./utils');

// --- Функции получения/сохранения цен ---
async function getPricesFromDb(chatId) {
    const { data, error } = await supabase.from('chat_settings').select('pie_type, price').eq('chat_id', chatId);
    if (error) {
        console.error(`[${chatId}] Ошибка получения цен:`, error.message);
        return pieTypes.reduce((acc, type) => { acc[type] = 0; return acc; }, {});
    }
    const prices = (data || []).reduce((acc, item) => { acc[item.pie_type] = parseFloat(item.price || 0); return acc; }, {});
    pieTypes.forEach(type => { if (!(type in prices)) { prices[type] = 0; } });
    return prices;
}
async function savePriceToDb(chatId, pieType, price) {
    const { error } = await supabase.from('chat_settings').upsert({ chat_id: chatId, pie_type: pieType, price: price }, { onConflict: 'chat_id, pie_type' });
    if (error) console.error(`[${chatId}] Ошибка сохранения цены:`, error.message);
    return !error;
}

// --- Функции для ежедневных логов ---
async function addManufacturedToDb(chatId, pieType, quantity) {
    // 1. Вызываем RPC для обновления данных в БД.
    const { data: rpcData, error: rpcError } = await supabase.rpc('upsert_daily_manufactured', {
        p_chat_id: chatId,
        p_pie_type: pieType,
        p_add_quantity: quantity
    });

    if (rpcError) {
        console.error(`[${chatId}] Ошибка RPC upsert_daily_manufactured:`, rpcError.message);
        return null;
    }

    // 2. Сразу после обновления принудительно запрашиваем свежие данные из таблицы,
    // чтобы гарантировать получение правильного итогового количества.
    const updatedLogEntry = await getDailyLogEntry(chatId, pieType);

    // 3. Формируем корректный объект для ответа, который ожидает bot.js
    return {
        new_total: updatedLogEntry.manufactured, // Используем свежеполученное значение
        remaining_reset: rpcData?.remaining_reset || false // Сохраняем флаг сброса остатков из ответа RPC
    };
}


async function getDailyLogEntry(chatId, pieType) {
    const { data, error } = await supabase.from('daily_log').select('manufactured, remaining, written_off').eq('chat_id', chatId).eq('log_date', getCurrentDate()).eq('pie_type', pieType).maybeSingle();
    if (error) {
        console.error(`[${chatId}] Ошибка получения daily_log:`, error.message);
        return { manufactured: 0, remaining: null, written_off: 0 };
    }
    return data || { manufactured: 0, remaining: null, written_off: 0 };
}

async function getTodaysLogsGrouped(chatId) {
    const { data, error } = await supabase.from('daily_log').select('pie_type, manufactured, remaining, written_off').eq('chat_id', chatId).eq('log_date', getCurrentDate());
    if (error) {
        console.error(`[${chatId}] Ошибка получения логов за сегодня:`, error.message);
        return {};
    }
    return (data || []).reduce((acc, log) => {
        acc[log.pie_type] = {
            manufactured: log.manufactured || 0,
            remaining: log.remaining,
            written_off: log.written_off || 0
        };
        return acc;
    }, {});
}

async function saveRemainingToDb(chatId, pieType, remainingQuantity) {
    const { data, error } = await supabase.rpc('upsert_daily_remaining', { p_chat_id: chatId, p_pie_type: pieType, p_remaining_quantity: remainingQuantity });
    if (error || data === null) {
        console.error(`[${chatId}] Ошибка RPC upsert_daily_remaining:`, error ? error.message : 'Запись не найдена');
        return false;
    }
    return true;
}

async function saveExpensesToDb(chatId, amountToAdd) {
    const { data, error } = await supabase.rpc('upsert_daily_expenses', { p_chat_id: chatId, p_add_amount: amountToAdd });
    if (error) { console.error(`[${chatId}] Ошибка RPC upsert_daily_expenses:`, error.message); return null; }
    return data;
}

async function processWriteOffInDb(chatId, pieType, quantity) {
    const { data, error } = await supabase.rpc('process_write_off', {
        p_chat_id: chatId,
        p_pie_type: pieType,
        p_quantity_to_write_off: quantity
    });
    if (error) {
        console.error(`[${chatId}] Ошибка RPC process_write_off:`, error.message);
        const userFriendlyMessage = error.message.includes('не может быть больше остатка') ?
            'Количество для списания превышает остаток.' :
            'Произошла ошибка в базе данных.';
        return { success: false, message: userFriendlyMessage };
    }
    console.log(`[${chatId}] RPC process_write_off успешно. Новое списано: ${data}`);
    return { success: true, newTotal: data };
}

// --- Функция для статистики ---
async function getStatsForPeriod(chatId, startDate, endDate) {
    const prices = await getPricesFromDb(chatId);
    const { data: aggregatedData, error } = await supabase.rpc('get_aggregated_stats', { p_chat_id: chatId, p_start_date: startDate, p_end_date: endDate });

    if (error) {
        console.error(`[${chatId}] Ошибка RPC get_aggregated_stats:`, error.message);
        return null;
    }

    const periodTotals = (aggregatedData.logs || []).reduce((acc, log) => {
        acc[log.pie_type] = {
            manufactured: log.total_manufactured || 0,
            sold: log.total_sold || 0,
            written_off: log.total_written_off || 0
        };
        return acc;
    }, {});

    const stats = {
        pies: {}, prices: prices, totalRevenue: 0,
        expenses: aggregatedData.expenses || 0,
        totalWrittenOff: 0,
        lossFromWriteOff: 0,
        profit: 0,
        period: { start: startDate, end: endDate }
    };

    for (const type of pieTypes) {
        const totals = periodTotals[type] || { manufactured: 0, sold: 0, written_off: 0 };
        const price = prices[type] || 0;
        
        const totalManufactured = totals.manufactured;
        const totalSold = totals.sold;
        const totalWrittenOffForType = totals.written_off;
        const revenueForType = totalSold > 0 ? totalSold * price : 0;
        const lossForType = totalWrittenOffForType > 0 ? totalWrittenOffForType * price : 0;
        
        stats.pies[type] = {
            manufactured: totalManufactured, sold: totalSold,
            written_off: totalWrittenOffForType, revenue: revenueForType,
            price: price, loss: lossForType
        };
        stats.totalRevenue += revenueForType;
        stats.totalWrittenOff += totalWrittenOffForType;
        stats.lossFromWriteOff += lossForType;
    }

    stats.profit = stats.totalRevenue - stats.expenses - stats.lossFromWriteOff;
    return stats;
}

// --- Функции для Аналитики ---
async function getProfitabilityAnalysis(chatId, startDate, endDate) {
    const { data, error } = await supabase.rpc('get_profitability_ranking', {
        p_chat_id: chatId,
        p_start_date: startDate.toISOString().split('T')[0],
        p_end_date: endDate.toISOString().split('T')[0]
    });
    if (error) {
        console.error(`[${chatId}] Ошибка RPC get_profitability_ranking:`, error.message);
        return null;
    }
    return data;
}

async function getSalesAnalysis(chatId, startDate, endDate) {
    const { data, error } = await supabase.rpc('get_sales_ranking', {
        p_chat_id: chatId,
        p_start_date: startDate.toISOString().split('T')[0],
        p_end_date: endDate.toISOString().split('T')[0]
    });
    if (error) {
        console.error(`[${chatId}] Ошибка RPC get_sales_ranking:`, error.message);
        return null;
    }
    return data;
}

async function getWeekdayAnalysis(chatId, startDate, endDate) {
    const { data, error } = await supabase.rpc('get_weekday_sales_analysis', {
        p_chat_id: chatId,
        p_start_date: startDate.toISOString().split('T')[0],
        p_end_date: endDate.toISOString().split('T')[0]
    });
    if (error) {
        console.error(`[${chatId}] Ошибка RPC get_weekday_sales_analysis:`, error.message);
        return null;
    }
    return data;
}

module.exports = {
    getPricesFromDb, savePriceToDb, addManufacturedToDb, getDailyLogEntry,
    getTodaysLogsGrouped, saveRemainingToDb, saveExpensesToDb, getStatsForPeriod,
    processWriteOffInDb,
    getProfitabilityAnalysis,
    getSalesAnalysis,
    getWeekdayAnalysis
};