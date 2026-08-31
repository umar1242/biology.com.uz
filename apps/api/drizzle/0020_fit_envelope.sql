-- Полоса соответствия, посчитанная симуляцией по этой самой матрице: столько
-- даёт исправное задание при таком числе ответов и такой нацеленности.
-- Постоянный порог 0.5–1.5 на тридцати ответах лежит внутри разброса
-- исправных заданий, а на пятистах не ловит уже ничего.
ALTER TABLE "cert_item_calibrations" ADD COLUMN "outfit_low" double precision;
ALTER TABLE "cert_item_calibrations" ADD COLUMN "outfit_high" double precision;
ALTER TABLE "cert_item_calibrations" ADD COLUMN "infit_low" double precision;
ALTER TABLE "cert_item_calibrations" ADD COLUMN "infit_high" double precision;
