// gemini_service.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');

// Проверяем наличие ключа API
if (!config.geminiKey) {
    throw new Error("GEMINI_API_KEY не найден в .env файле. AI-функции не будут работать.");
}

const genAI = new GoogleGenerativeAI(config.geminiKey);

/**
 * Получает прогноз по производству от AI на основе данных о продажах.
 * @param {Array<Object>} salesData - Массив с данными о продажах, например [{ log_date, pie_type, sold_quantity }]
 * @returns {Promise<string>} - Текстовый ответ от AI.
 */
async function getProductionForecast(salesData) {
    if (!salesData || salesData.length < 5) { // Требуем минимум 5 записей для анализа
        return 'Недостаточно данных для построения прогноза. Пожалуйста, соберите статистику хотя бы за несколько дней.';
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // --- ИЗМЕНЕННЫЙ ПРОМПТ ---
    const prompt = `
        Ты — умный помощник-аналитик для владельца пекарни.
        Вот данные о продажах пирожков за последние дни.

        Данные:
        ${JSON.stringify(salesData, null, 2)}

        Твоя задача — проанализировать эти данные и дать **сразу** четкую и короткую рекомендацию по производству на завтра.
        **Не объясняй свой метод анализа и не делай длинных вступлений.** Просто дай итоговый результат.

        Твой ответ должен выглядеть строго так:
        "Прогноз на завтра:"
        Затем сразу предоставь маркированный список.

        Пример:
        * Мясо: 35 штук
        * Картошка: 40 штук
        * Сосиска в тесте: 38 штук

        Не используй Markdown-форматирование в ответе.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Ошибка при обращении к Gemini API:", error);
        return "Произошла ошибка при генерации прогноза. Попробуйте позже.";
    }
}

module.exports = {
    getProductionForecast
};