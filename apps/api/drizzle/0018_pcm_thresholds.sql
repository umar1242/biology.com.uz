-- Пороги частично-кредитной модели: у задания на 30 баллов трудность — это не
-- одно число, а ступени перехода между категориями. У дихотомических заданий
-- колонка остаётся NULL: там переход один и он же difficulty.
ALTER TABLE "cert_item_calibrations" ADD COLUMN "thresholds" double precision[];
