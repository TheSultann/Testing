// __tests__/db.test.js

// Имитируем (мокаем) весь модуль config
jest.mock('../config', () => {
    // Создаем "умный" мок для цепочки вызовов Supabase
    const mockSupabase = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn(), // .eq будет последним в цепочке, его мы и будем настраивать
        rpc: jest.fn(),
    };
    return {
        supabase: mockSupabase,
        pieTypes: ['Мясо', 'Картошка'],
        currencySymbol: 'руб'
    };
});

const db = require('../db');
const { supabase } = require('../config'); // Импортируем наш мок-объект

describe('db.js tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // "Заглушим" console.error, чтобы он не мешал выводу тестов
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('getStatsForPeriod should correctly calculate stats', async () => {
        // 1. Мокаем ответ для getPricesFromDb (цепочка .from().select().eq())
        const mockPrices = [
            { pie_type: 'Мясо', price: 100 },
            { pie_type: 'Картошка', price: 80 }
        ];
        // Настраиваем .eq(), чтобы он возвращал нужные данные
        supabase.eq.mockResolvedValueOnce({ data: mockPrices, error: null });

        // 2. Мокаем ответ для get_aggregated_stats
        const mockAggregatedData = {
            logs: [
                { pie_type: 'Мясо', total_manufactured: 25, total_sold: 20, total_written_off: 0 },
                { pie_type: 'Картошка', total_manufactured: 15, total_sold: 11, total_written_off: 1 }
            ],
            expenses: 5000
        };
        supabase.rpc.mockResolvedValueOnce({ data: mockAggregatedData, error: null });

        // --- Вызов тестируемой функции ---
        const stats = await db.getStatsForPeriod('test_chat_id', '2024-01-01', '2024-01-01');

        // --- Проверка результатов ---
        expect(stats.totalRevenue).toBe(2880); // 2000 + 880
        expect(stats.expenses).toBe(5000);
        expect(stats.lossFromWriteOff).toBe(80); // 1 * 80
        expect(stats.profit).toBe(-2200); // 2880 - 5000 - 80

        expect(stats.pies['Мясо'].sold).toBe(20);
        expect(stats.pies['Картошка'].sold).toBe(11);
        
        // Проверяем, что наши моки были вызваны
        expect(supabase.from).toHaveBeenCalledWith('chat_settings');
        expect(supabase.rpc).toHaveBeenCalledWith('get_aggregated_stats', expect.any(Object));
    });

    test('getStatsForPeriod should return null on RPC error', async () => {
        // Мокаем успешный ответ для цен, так как он идет первым
        supabase.eq.mockResolvedValueOnce({ data: [], error: null });
        // Мокаем ответ с ошибкой для RPC
        supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('RPC Error') });

        const stats = await db.getStatsForPeriod('test_chat_id', '2024-01-01', '2024-01-01');

        expect(stats).toBeNull();
    });
});