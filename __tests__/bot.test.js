// __tests__/bot.test.js

// --- ШАГ 1: ПОЛНОЕ И "УМНОЕ" МОКИРОВАНИЕ ЗАВИСИМОСТЕЙ ---

jest.mock('express', () => jest.fn(() => ({ listen: jest.fn(), get: jest.fn() })));
jest.mock('node-cron', () => ({ validate: jest.fn(() => true), schedule: jest.fn() }));

// ИСПРАВЛЕНИЕ: Создаем "умный" мок для utils.js
// Он сохранит все реальные функции, но позволит нам подменить checkAccess
jest.mock('../utils', () => {
    const originalUtils = jest.requireActual('../utils'); // Загружаем реальный модуль
    return {
        ...originalUtils, // Копируем все его реальные функции (formatNumber, isValidDate и т.д.)
        checkAccess: jest.fn(), // А эту функцию делаем моком, чтобы контролировать ее в тестах
    };
});

const eventHandlers = {};
const mockSendMessage = jest.fn();
const mockEditMessageText = jest.fn();
const mockAnswerCallbackQuery = jest.fn();
const mockDeleteMessage = jest.fn().mockResolvedValue(true); 

jest.mock('node-telegram-bot-api', () => {
    return jest.fn().mockImplementation(() => ({
        on: (event, handler) => { eventHandlers[event] = handler; },
        onText: (regexp, handler) => { eventHandlers[regexp] = handler; },
        sendMessage: mockSendMessage,
        editMessageText: mockEditMessageText,
        answerCallbackQuery: mockAnswerCallbackQuery,
        deleteMessage: mockDeleteMessage,
    }));
});

jest.mock('../db');
jest.mock('../gemini_service');

// --- ШАГ 2: ИМПОРТ МОДУЛЕЙ И ПОДГОТОВКА ---
const db = require('../db');
const utils = require('../utils'); // Теперь это наш "умный" мок
require('../bot');

describe('bot.js integration tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        utils.checkAccess.mockReturnValue(true); // Управляем только мокированной функцией
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // --- ШАГ 3: ИНТЕГРАЦИОННЫЙ ТЕСТ ---
    test('should handle the "add manufactured pie" flow correctly', async () => {
        db.addManufacturedToDb.mockResolvedValue({ new_total: 10, remaining_reset: false });
        const chatId = 12345;
        const messageId = 67890;

        await eventHandlers['callback_query']({
            message: { chat: { id: chatId }, message_id: messageId },
            data: 'add_pie_Мясо'
        });

        await eventHandlers['message']({
            chat: { id: chatId },
            text: '10'
        });

        expect(db.addManufacturedToDb).toHaveBeenCalledWith(chatId, 'Мясо', 10);
        
        expect(mockSendMessage).toHaveBeenCalledTimes(2);

        // Теперь этот тест будет работать, так как utils.formatNumber - реальная функция
        const secondCallArgs = mockSendMessage.mock.calls[1];
        expect(secondCallArgs[1]).toContain('✅ Добавлено: 10 "Мясо"');
        expect(secondCallArgs[1]).toContain('Всего сегодня: 10');
    });
});