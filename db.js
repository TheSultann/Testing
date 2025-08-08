const { supabase, pieTypes } = require('./config');
const { getCurrentDate } = require('./utils');

async function getPricesFromDb(chatId) {
    const { data, error } = await supabase
        .from('chat_settings').select('pie_type, price').eq('chat_id', chatId);
    if (error) {
        console.error(`[${chatId}] Ошибка получения цен:`, error.message);
        return pieTypes.reduce((acc, type) => { acc[type] = 0; return acc; }, {});
    }
    const prices = (data || []).reduce((acc, item) => {
        acc[item.pie_type] = parseFloat(item.price || 0); return acc;
    }, {});
    pieTypes.forEach(type => { if (!(type in prices)) { prices[type] = 0; } });
    return prices;
}

async function savePriceToDb(chatId, pieType, price) {
    const { error } = await supabase
        .from('chat_settings').upsert({ chat_id: chatId, pie_type: pieType, price: price }, { onConflict: 'chat_id, pie_type' });
    if (error) console.error(`[${chatId}] Ошибка сохранения цены:`, error.message);
    else console.log(`[${chatId}] Цена для "${pieType}" сохранена.`);
    return !error;
}

async function addManufacturedToDb(chatId, pieType, quantity) {
    const { data, error } = await supabase.rpc('upsert_daily_manufactured', {
        p_chat_id: chatId, p_pie_type: pieType, p_add_quantity: quantity
    });
    if (error) {
        console.error(`[${chatId}] Ошибка RPC upsert_daily_manufactured:`, error.message);
        return null;
    }
    console.log(`[${chatId}] RPC upsert_daily_manufactured успешно. Новое manufactured: ${data}`);
    return data;
}

async function getDailyLogEntry(chatId, pieType) {
    const { data, error } = await supabase
        .from('daily_log').select('manufactured, remaining').eq('chat_id', chatId)
        .eq('log_date', getCurrentDate()).eq('pie_type', pieType).maybeSingle();
    if (error) {
        console.error(`[${chatId}] Ошибка получения daily_log:`, error.message);
        return { manufactured: 0, remaining: null };
    }
    return data || { manufactured: 0, remaining: null };
}

async function getTodaysLogsGrouped(chatId) {
    const { data, error } = await supabase
        .from('daily_log').select('pie_type, manufactured, remaining')
        .eq('chat_id', chatId).eq('log_date', getCurrentDate());
    if (error) {
        console.error(`[${chatId}] Ошибка получения логов:`, error.message);
        return {};
    }
    return (data || []).reduce((acc, log) => {
        acc[log.pie_type] = { manufactured: log.manufactured || 0, remaining: log.remaining };
        return acc;
    }, {});
}

async function saveRemainingToDb(chatId, pieType, remainingQuantity) {
    const { data, error } = await supabase.rpc('upsert_daily_remaining', {
        p_chat_id: chatId, p_pie_type: pieType, p_remaining_quantity: remainingQuantity
    });
    if (error || data === null) {
        console.error(`[${chatId}] Ошибка RPC upsert_daily_remaining для "${pieType}":`, error ? error.message : 'Запись не найдена');
        return false;
    }
    console.log(`[${chatId}] Остаток ${data} для "${pieType}" успешно сохранен через RPC.`);
    return true;
}

async function saveExpensesToDb(chatId, amountToAdd) {
    const { data, error } = await supabase.rpc('upsert_daily_expenses', {
        p_chat_id: chatId, p_add_amount: amountToAdd
    });
    if (error) {
        console.error(`[${chatId}] Ошибка RPC upsert_daily_expenses:`, error.message);
        return null;
    }
    console.log(`[${chatId}] RPC upsert_daily_expenses успешно. Новые расходы: ${data}`);
    return data;
}

// =========================================================================
// ==           ИСПОЛЬЗУЕМ ИСПРАВЛЕННУЮ ФУНКЦИЮ СТАТИСТИКИ              ==
// =========================================================================
async function getStatsForPeriod(chatId, startDate, endDate) {
    console.log(`[${chatId}] Запрос статистики через RPC: ${startDate} - ${endDate}`);
    const prices = await getPricesFromDb(chatId);
    const { data: aggregatedData, error } = await supabase.rpc('get_aggregated_stats', {
        p_chat_id: chatId, p_start_date: startDate, p_end_date: endDate
    });

    if (error) {
        console.error(`[${chatId}] Ошибка RPC get_aggregated_stats:`, error.message);
        return null;
    }

    const periodTotals = (aggregatedData.logs || []).reduce((acc, log) => {
        acc[log.pie_type] = {
            manufactured: log.total_manufactured || 0,
            sold: log.total_sold || 0 // <-- Берем готовое значение
        };
        return acc;
    }, {});

    const stats = {
        pies: {}, prices: prices, totalRevenue: 0,
        expenses: aggregatedData.expenses || 0, profit: 0,
        period: { start: startDate, end: endDate }
    };

    for (const type of pieTypes) {
        const totals = periodTotals[type] || { manufactured: 0, sold: 0 };
        const price = prices[type] || 0;
        
        // Расчеты теперь намного проще, так как SQL сделал всю работу
        const totalManufactured = totals.manufactured;
        const totalSold = totals.sold;
        const revenueForType = totalSold > 0 ? totalSold * price : 0;
        
        stats.pies[type] = {
            manufactured: totalManufactured,
            sold: totalSold, // Просто присваиваем
            revenue: revenueForType,
            price: price
        };
        stats.totalRevenue += revenueForType;
    }

    stats.profit = stats.totalRevenue - stats.expenses;
    console.log(`[${chatId}] Статистика успешно подсчитана через RPC.`);
    return stats;
}

module.exports = {
    getPricesFromDb, savePriceToDb, addManufacturedToDb, getDailyLogEntry,
    getTodaysLogsGrouped, saveRemainingToDb, saveExpensesToDb, getStatsForPeriod
};