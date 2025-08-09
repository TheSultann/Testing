// __tests__/gemini_service.test.js

// Мокаем библиотеку Google AI. Теперь все ее вызовы будут под нашим контролем.
const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
            generateContent: mockGenerateContent,
        }),
    })),
}));

// Мокаем config, чтобы предоставить фейковый ключ API
jest.mock('../config', () => ({
    geminiKey: 'fake-api-key'
}));


const gemini = require('../gemini_service');

describe('gemini_service.js tests', () => {

    beforeEach(() => {
        // Очищаем историю вызовов перед каждым тестом
        mockGenerateContent.mockClear();
    });

    // Тест 1: Проверяем случай с недостаточным количеством данных
    test('should return "not enough data" message if sales data is insufficient', async () => {
        const insufficientData = [{ day: 1, sold: 10 }]; // Данных слишком мало
        const result = await gemini.getProductionForecast(insufficientData);
        
        expect(result).toBe('Недостаточно данных для построения прогноза. Пожалуйста, соберите статистику хотя бы за несколько дней.');
        // Убеждаемся, что мы даже не пытались вызвать AI
        expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    // Тест 2: Проверяем, что AI вызывается с правильным промптом
    test('should call Gemini API with a correctly formatted prompt', async () => {
        // Подготовим достаточно данных для вызова AI
        const sufficientData = [
            { log_date: '2024-08-08', pie_type: 'Мясо', sold_quantity: 10 },
            { log_date: '2024-08-08', pie_type: 'Картошка', sold_quantity: 15 },
            { log_date: '2024-08-09', pie_type: 'Мясо', sold_quantity: 12 },
            { log_date: '2024-08-09', pie_type: 'Картошка', sold_quantity: 18 },
            { log_date: '2024-08-10', pie_type: 'Мясо', sold_quantity: 11 },
        ];
        
        // Настроим мок, чтобы он возвращал простой текстовый ответ
        const mockApiResponse = {
            response: {
                text: () => 'Прогноз на завтра:\n* Мясо: 11 штук\n* Картошка: 17 штук',
            },
        };
        mockGenerateContent.mockResolvedValue(mockApiResponse);

        await gemini.getProductionForecast(sufficientData);
        
        // Главная проверка: убеждаемся, что AI был вызван
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        
        // Получаем промпт, с которым был вызван AI
        const actualPrompt = mockGenerateContent.mock.calls[0][0];

        // Проверяем, что промпт содержит ключевые фразы и наши данные
        expect(actualPrompt).toContain('Ты — умный помощник-аналитик');
        expect(actualPrompt).toContain('"pie_type": "Картошка"');
        // ИСПРАВЛЕНИЕ ОПЕЧАТКИ
        expect(actualPrompt).toContain('"sold_quantity": 18');
    });

});