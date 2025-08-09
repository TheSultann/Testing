-- ===================================================================
-- ШАГ 1: ИЗМЕНЕНИЕ СТРУКТУРЫ ТАБЛИЦЫ
-- ===================================================================
ALTER TABLE public.daily_log ADD COLUMN IF NOT EXISTS last_known_sold INT NOT NULL DEFAULT 0;
ALTER TABLE public.daily_log ADD COLUMN IF NOT EXISTS written_off INT NOT NULL DEFAULT 0;

-- ===================================================================
-- ШАГ 2: СОЗДАНИЕ И ОБНОВЛЕНИЕ ФУНКЦИЙ
-- ===================================================================

CREATE OR REPLACE FUNCTION public.upsert_daily_manufactured(p_chat_id BIGINT, p_pie_type TEXT, p_add_quantity INT)
RETURNS table(new_total int, remaining_reset boolean) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.daily_log (chat_id, log_date, pie_type, manufactured, remaining, last_known_sold, written_off, updated_at)
    VALUES (p_chat_id, CURRENT_DATE, p_pie_type, p_add_quantity, NULL, 0, 0, NOW())
    ON CONFLICT (chat_id, log_date, pie_type) DO UPDATE
    SET manufactured = daily_log.manufactured + EXCLUDED.manufactured,
        remaining = NULL,
        updated_at = NOW();

    RETURN QUERY
    SELECT dl.manufactured, true as remaining_reset
    FROM public.daily_log dl
    WHERE dl.chat_id = p_chat_id AND dl.log_date = CURRENT_DATE AND dl.pie_type = p_pie_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_daily_remaining(p_chat_id BIGINT, p_pie_type TEXT, p_remaining_quantity INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_updated_remaining INT;
    v_manufactured_total INT;
BEGIN
    SELECT manufactured INTO v_manufactured_total
    FROM public.daily_log
    WHERE chat_id = p_chat_id AND log_date = CURRENT_DATE AND pie_type = p_pie_type;

    UPDATE public.daily_log
    SET 
        remaining = p_remaining_quantity,
        last_known_sold = GREATEST(0, COALESCE(v_manufactured_total, 0) - p_remaining_quantity - COALESCE(written_off, 0)),
        updated_at = NOW()
    WHERE 
        chat_id = p_chat_id AND log_date = CURRENT_DATE AND pie_type = p_pie_type
    RETURNING remaining INTO v_updated_remaining;
    RETURN v_updated_remaining;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_aggregated_stats(p_chat_id bigint, p_start_date date, p_end_date date)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_result json;
BEGIN
    WITH logs AS (
        SELECT
            dl.pie_type,
            SUM(COALESCE(dl.manufactured, 0)) AS total_manufactured,
            SUM(
                CASE 
                    WHEN dl.remaining IS NOT NULL THEN GREATEST(0, COALESCE(dl.manufactured, 0) - COALESCE(dl.remaining, 0) - COALESCE(dl.written_off, 0)) 
                    ELSE COALESCE(dl.last_known_sold, 0) 
                END
            ) AS total_sold,
            SUM(COALESCE(dl.written_off, 0)) AS total_written_off
        FROM public.daily_log dl
        WHERE dl.chat_id = p_chat_id AND dl.log_date BETWEEN p_start_date AND p_end_date
        GROUP BY dl.pie_type
    ), expenses AS (
        SELECT SUM(COALESCE(de.expenses, 0)) AS total 
        FROM public.daily_expenses de 
        WHERE de.chat_id = p_chat_id AND de.log_date BETWEEN p_start_date AND p_end_date
    )
    SELECT json_build_object(
        'logs', (SELECT COALESCE(json_agg(logs), '[]'::json) FROM logs), 
        'expenses', (SELECT COALESCE(total, 0) FROM expenses)
    ) INTO v_result;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_daily_expenses(p_chat_id BIGINT, p_add_amount NUMERIC) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_new_total NUMERIC; BEGIN INSERT INTO public.daily_expenses (chat_id, log_date, expenses, updated_at) VALUES (p_chat_id, CURRENT_DATE, p_add_amount, NOW()) ON CONFLICT (chat_id, log_date) DO UPDATE SET expenses = daily_expenses.expenses + EXCLUDED.expenses, updated_at = NOW() RETURNING expenses INTO v_new_total; RETURN v_new_total; END; $$;

CREATE OR REPLACE FUNCTION public.process_write_off(p_chat_id BIGINT, p_pie_type TEXT, p_quantity_to_write_off INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_current_remaining INT;
    v_new_written_off_total INT;
BEGIN
    SELECT COALESCE(remaining, 0) INTO v_current_remaining FROM public.daily_log WHERE chat_id = p_chat_id AND log_date = CURRENT_DATE AND pie_type = p_pie_type;
    IF v_current_remaining IS NULL THEN RAISE EXCEPTION 'Запись для списания не найдена. Сначала введите данные об остатках.'; END IF;
    IF p_quantity_to_write_off > v_current_remaining THEN RAISE EXCEPTION 'Количество для списания (%) не может быть больше остатка (%)', p_quantity_to_write_off, v_current_remaining; END IF;
    UPDATE public.daily_log SET remaining = remaining - p_quantity_to_write_off, written_off = written_off + p_quantity_to_write_off, updated_at = NOW() WHERE chat_id = p_chat_id AND log_date = CURRENT_DATE AND pie_type = p_pie_type RETURNING written_off INTO v_new_written_off_total;
    RETURN v_new_written_off_total;
END;
$$;

CREATE OR REPLACE FUNCTION get_profitability_ranking(p_chat_id bigint, p_start_date date, p_end_date date)
RETURNS TABLE(pie_type text, total_revenue numeric) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    WITH sales_data AS (
        SELECT dl.pie_type, GREATEST(0, COALESCE(dl.manufactured, 0) - COALESCE(dl.remaining, 0) - COALESCE(dl.written_off, 0)) AS sold_units, cs.price
        FROM daily_log dl LEFT JOIN chat_settings cs ON dl.chat_id = cs.chat_id AND dl.pie_type = cs.pie_type
        WHERE dl.chat_id = p_chat_id AND dl.log_date BETWEEN p_start_date AND p_end_date AND dl.remaining IS NOT NULL
    )
    SELECT sd.pie_type, SUM(sd.sold_units * COALESCE(sd.price, 0)) AS total_revenue
    FROM sales_data sd GROUP BY sd.pie_type ORDER BY total_revenue DESC;
END; $$;

CREATE OR REPLACE FUNCTION get_sales_ranking(p_chat_id bigint, p_start_date date, p_end_date date)
RETURNS TABLE(pie_type text, total_sold_quantity bigint) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT dl.pie_type, SUM(GREATEST(0, COALESCE(dl.manufactured, 0) - COALESCE(dl.remaining, 0) - COALESCE(dl.written_off, 0)))::bigint AS total_sold_quantity
    FROM daily_log dl WHERE dl.chat_id = p_chat_id AND dl.log_date BETWEEN p_start_date AND p_end_date AND dl.remaining IS NOT NULL
    GROUP BY dl.pie_type ORDER BY total_sold_quantity DESC;
END; $$;

-- ========= ИЗМЕНЕННАЯ ФУНКЦИЯ =========
-- Старая get_weekday_sales_analysis удалена и заменена на эту.
CREATE OR REPLACE FUNCTION get_average_weekday_sales(p_chat_id bigint, p_start_date date, p_end_date date)
RETURNS TABLE(day_of_week_iso int, pie_type text, avg_sold_quantity bigint)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH daily_sales AS (
        -- Шаг 1: Рассчитываем фактические продажи за каждый день
        SELECT
            EXTRACT(ISODOW FROM dl.log_date)::int AS day_of_week_iso,
            dl.pie_type,
            dl.log_date,
            GREATEST(0, COALESCE(dl.manufactured, 0) - COALESCE(dl.remaining, 0) - COALESCE(dl.written_off, 0)) AS sold_quantity
        FROM
            daily_log dl
        WHERE
            dl.chat_id = p_chat_id
            AND dl.log_date BETWEEN p_start_date AND p_end_date
            AND dl.remaining IS NOT NULL
    ),
    weekday_counts AS (
        -- Шаг 2: Считаем, сколько раз каждый день недели встречался в данных (например, 4 понедельника)
        SELECT
            ds.day_of_week_iso,
            COUNT(DISTINCT ds.log_date) as day_count
        FROM
            daily_sales ds
        GROUP BY
            ds.day_of_week_iso
    )
    -- Шаг 3: Считаем среднее, разделив общие продажи на количество дней
    SELECT
        ds.day_of_week_iso,
        ds.pie_type,
        ROUND(SUM(ds.sold_quantity)::decimal / wc.day_count, 0)::bigint as avg_sold_quantity
    FROM
        daily_sales ds
    JOIN
        weekday_counts wc ON ds.day_of_week_iso = wc.day_of_week_iso
    GROUP BY
        ds.day_of_week_iso,
        ds.pie_type,
        wc.day_count
    ORDER BY
        ds.day_of_week_iso,
        avg_sold_quantity DESC;
END;
$$;


CREATE OR REPLACE FUNCTION public.get_sales_data_for_ai(p_chat_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN (
        SELECT COALESCE(json_agg(t), '[]'::json)
        FROM (
            SELECT
                dl.log_date,
                dl.pie_type,
                GREATEST(0, COALESCE(dl.manufactured, 0) - COALESCE(dl.remaining, 0) - COALESCE(dl.written_off, 0)) AS sold_quantity
            FROM public.daily_log dl
            WHERE dl.chat_id = p_chat_id AND dl.log_date >= (CURRENT_DATE - INTERVAL '30 days') AND dl.remaining IS NOT NULL
            ORDER BY dl.log_date
        ) t
    );
END;
$$;

-- ===================================================================
-- ШАГ 3: НАСТРОЙКА ПОЛИТИК БЕЗОПАСНОСТИ
-- ===================================================================
ALTER TABLE public.chat_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon full access to chat_settings" ON public.chat_settings;
CREATE POLICY "Allow anon full access to chat_settings" ON public.chat_settings FOR ALL TO anon USING (true) WITH CHECK (true);