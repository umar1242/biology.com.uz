-- Дрейф общего задания между вариантами: насколько оно выбивается из общей
-- картины после совмещения шкал. NULL — задание стоит в одном варианте, и
-- сравнивать не с чем.
ALTER TABLE "cert_item_calibrations" ADD COLUMN "displacement" double precision;
ALTER TABLE "cert_item_calibrations" ADD COLUMN "displacement_error" double precision;
