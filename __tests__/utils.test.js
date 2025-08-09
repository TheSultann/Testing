// __tests__/utils.test.js

describe('utils.js tests', () => {

    beforeEach(() => {
        jest.resetModules();
        // "Заглушим" console.log, чтобы он не мешал выводу тестов
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Восстанавливаем оригинальные функции console после каждого теста
        jest.restoreAllMocks();
    });

    test('formatNumber should use a non-breaking space for thousands', () => {
        const utils = require('../utils');
        const formattedNumber = utils.formatNumber(1000);
        
        // ИСПРАВЛЕНИЕ: Проверяем, что результат содержит правильный символ
        // charCode 160 - это код неразрывного пробела.
        expect(formattedNumber).toContain(String.fromCharCode(160));
        // Дополнительно проверяем, что обычного пробела (код 32) там нет.
        expect(formattedNumber).not.toContain(String.fromCharCode(32));
        
        // Проверяем остальные случаи как и раньше
        expect(utils.formatNumber(12345.67)).toContain(String.fromCharCode(160));
        expect(utils.formatNumber(500)).toBe('500');
        expect(utils.formatNumber(0)).toBe('0');
    });

    test('isValidDate should validate YYYY-MM-DD format', () => {
        const utils = require('../utils');
        expect(utils.isValidDate('2024-08-09')).toBe(true);
        expect(utils.isValidDate('2025-01-01')).toBe(true);
        expect(utils.isValidDate('2024-8-9')).toBe(false);
        expect(utils.isValidDate('09-08-2024')).toBe(false);
        expect(utils.isValidDate('some text')).toBe(false);
    });

    test('checkAccess should grant or deny access based on a mocked ALLOWED_CHAT_IDS', () => {
        process.env.ALLOWED_CHAT_IDS = '123,456,789';
        const utils = require('../utils');

        expect(utils.checkAccess(123)).toBe(true);
        expect(utils.checkAccess(456)).toBe(true);
        expect(utils.checkAccess(999)).toBe(false);
        expect(utils.checkAccess('123')).toBe(true);
    });

});