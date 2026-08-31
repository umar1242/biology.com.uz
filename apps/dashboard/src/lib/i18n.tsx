import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "./api";

export type Language = "ru" | "uz";

const STORAGE_KEY = "language";

/**
 * Mirrors apps/miniapp/src/lib/i18n.tsx — one typed table, no library. Uzbek is
 * Latin script (the state standard). Course titles, student names and other
 * teacher-entered content are data, not UI, and stay as typed.
 */
const STRINGS = {
  loading: { ru: "Загрузка…", uz: "Yuklanmoqda…" },
  save: { ru: "Сохранить", uz: "Saqlash" },
  cancel: { ru: "Отмена", uz: "Bekor qilish" },
  back: { ru: "Назад", uz: "Orqaga" },
  all: { ru: "Все", uz: "Barchasi" },
  close: { ru: "Закрыть", uz: "Yopish" },
  search: { ru: "Поиск…", uz: "Qidiruv…" },
  notifications: { ru: "Уведомления", uz: "Bildirishnomalar" },
  openMenu: { ru: "Открыть меню", uz: "Menyuni ochish" },
  closeMenu: { ru: "Закрыть меню", uz: "Menyuni yopish" },
  savedOk: { ru: "Сохранено", uz: "Saqlandi" },

  // nav
  navDashboard: { ru: "Дашборд", uz: "Boshqaruv paneli" },
  navCourses: { ru: "Курсы", uz: "Kurslar" },
  navReview: { ru: "Проверка ДЗ", uz: "Vazifalarni tekshirish" },
  navCert: { ru: "Сертификат", uz: "Sertifikat" },
  navBank: { ru: "Банк заданий", uz: "Topshiriqlar banki" },
  navStudents: { ru: "Ученики", uz: "O'quvchilar" },
  navRemoval: { ru: "Отчисление", uz: "Chiqarish" },
  navAssistants: { ru: "Помощники", uz: "Yordamchilar" },
  navSettings: { ru: "Настройки", uz: "Sozlamalar" },
  // --- certificate exam ---
  certTitle: { ru: "Сертификатный экзамен", uz: "Sertifikat imtihoni" },
  certSubtitle: {
    ru: "Варианты Milliy Sertifikat: 43 задания, 115 баллов",
    uz: "Milliy Sertifikat variantlari: 43 topshiriq, 115 ball",
  },
  certPickCourse: { ru: "Курс", uz: "Kurs" },
  certNewVariant: { ru: "Новый вариант", uz: "Yangi variant" },
  certVariantName: { ru: "Название варианта", uz: "Variant nomi" },
  certDeadline: { ru: "Дедлайн", uz: "Muddat" },
  certCreate: { ru: "Создать", uz: "Yaratish" },
  certNoVariants: { ru: "Вариантов пока нет.", uz: "Hozircha variantlar yo'q." },
  certDraft: { ru: "Черновик", uz: "Qoralama" },
  certPublished: { ru: "Опубликован", uz: "Chop etilgan" },
  certFileAttached: { ru: "Файл прикреплён", uz: "Fayl biriktirilgan" },
  certFileMissing: { ru: "Файл не прикреплён", uz: "Fayl biriktirilmagan" },
  certAttachFile: { ru: "Прикрепить файл через бота", uz: "Bot orqali fayl biriktirish" },
  certAttachHint: {
    ru: "Откройте бота и отправьте файл варианта — PDF или фото.",
    uz: "Botni oching va variant faylini yuboring — PDF yoki rasm.",
  },
  certKeyProgress: { ru: "Ключ: {filled} из {required}", uz: "Kalit: {required} dan {filled}" },
  certKeyTitle: { ru: "Ключ ответов 1–35", uz: "1–35 javoblar kaliti" },
  certKeyHint: {
    ru: "Задания 1–32 — варианты A–D. Задания 33–35 — общее условие, варианты A–F.",
    uz: "1–32 topshiriqlar — A–D. 33–35 topshiriqlar — umumiy shart, A–F.",
  },
  certKeySave: { ru: "Сохранить ключ", uz: "Kalitni saqlash" },
  certKeySaved: { ru: "Ключ сохранён", uz: "Kalit saqlandi" },
  certPublish: { ru: "Опубликовать", uz: "Chop etish" },
  certUnpublish: { ru: "Снять с публикации", uz: "Chop etishni bekor qilish" },
  certPublishBlocked: {
    ru: "Опубликовать можно после прикрепления файла и заполнения всех 35 ответов.",
    uz: "Fayl biriktirilgach va 35 ta javob to'ldirilgach chop etish mumkin.",
  },
  certAttempts: { ru: "Работы учеников", uz: "O'quvchilar ishlari" },
  certNoAttempts: { ru: "Никто ещё не сдал.", uz: "Hali hech kim topshirmagan." },
  certStatusInProgress: { ru: "Решает", uz: "Yechyapti" },
  certStatusSubmitted: { ru: "Ждёт проверки", uz: "Tekshiruvni kutmoqda" },
  certStatusReviewed: { ru: "Проверено", uz: "Tekshirilgan" },
  certOpenWork: { ru: "Открыть работу", uz: "Ishni ochish" },
  certAutoPart: { ru: "Тесты 1–35", uz: "Testlar 1–35" },
  certManualPart: { ru: "Задания 36–43", uz: "36–43 topshiriqlar" },
  certScaleTitle: { ru: "По шкале сертификата (ориентировочно)", uz: "Sertifikat shkalasi bo'yicha (taxminan)" },
  certHalfTest: { ru: "Тест (1–40)", uz: "Test (1–40)" },
  certHalfWritten: { ru: "Письменная (41–43)", uz: "Yozma ish (41–43)" },
  certScaleTotal: { ru: "Итог", uz: "Jami" },
  certNoGrade: { ru: "без сертификата", uz: "sertifikatsiz" },
  certScaleHint: {
    ru: "Половины весят поровну, как на реальном экзамене. Тестовая часть здесь — доля верных ответов, а не модель Раша, поэтому балл приблизительный и A+ недостижим.",
    uz: "Yarmlar teng vaznga ega, xuddi haqiqiy imtihondagidek. Test qismi bu yerda to'g'ri javoblar ulushi, Rash modeli emas — shuning uchun ball taxminiy va A+ erishib bo'lmaydi.",
  },
  certTotal: { ru: "Итого", uz: "Jami" },
  certTaskN: { ru: "Задание {n}", uz: "{n}-topshiriq" },
  certChosen: { ru: "Ответ ученика", uz: "O'quvchi javobi" },
  certCorrect: { ru: "Верный", uz: "To'g'ri" },
  certNoAnswer: { ru: "нет ответа", uz: "javob yo'q" },
  certPointsOf: { ru: "из {max}", uz: "{max} dan" },
  certSaveReview: { ru: "Сохранить оценку", uz: "Bahoni saqlash" },
  certReviewSaved: { ru: "Оценка сохранена", uz: "Baho saqlandi" },
  certReviewComment: { ru: "Комментарий ученику", uz: "O'quvchiga izoh" },
  certPhotosNone: { ru: "Ученик не прикрепил решение", uz: "O'quvchi yechim biriktirmagan" },
  certReviewQueue: { ru: "Ждут проверки", uz: "Tekshiruvni kutmoqda" },
  certLate: { ru: "Просрочено", uz: "Kechikkan" },
  certDeleteVariant: { ru: "Удалить вариант", uz: "Variantni o'chirish" },
  // --- item bank ---
  bankTitle: { ru: "Банк заданий", uz: "Topshiriqlar banki" },
  bankSubtitle: {
    ru: "Статистика по каждому заданию копится между вариантами и потоками",
    uz: "Har bir topshiriq statistikasi variantlar va oqimlar bo'ylab to'planadi",
  },
  bankEmpty: {
    ru: "Банк пуст. Задания появятся, когда вы заполните ключ варианта.",
    uz: "Bank bo'sh. Variant kalitini to'ldirganingizda topshiriqlar paydo bo'ladi.",
  },
  bankTask: { ru: "Задание", uz: "Topshiriq" },
  bankTopic: { ru: "Тема", uz: "Mavzu" },
  bankKey: { ru: "Ключ", uz: "Kalit" },
  bankResponses: { ru: "Ответов", uz: "Javoblar" },
  bankDifficulty: { ru: "Верных", uz: "To'g'ri" },
  bankUsedIn: { ru: "В вариантах", uz: "Variantlarda" },
  bankSource: { ru: "Источник", uz: "Manba" },
  bankSourceHint: {
    ru: "Например: Spectrum 2026, вариант 1, №5. Одинаковый источник = одно задание.",
    uz: "Masalan: Spectrum 2026, 1-variant, №5. Bir xil manba = bitta topshiriq.",
  },
  bankNoData: { ru: "нет данных", uz: "ma'lumot yo'q" },
  bankSuspectKey: { ru: "Проверьте ключ", uz: "Kalitni tekshiring" },
  bankSuspectHint: {
    ru: "Большинство выбрало «{opt}», а в ключе «{key}». Похоже на опечатку.",
    uz: "Ko'pchilik «{opt}» ni tanladi, kalitda esa «{key}». Xatoga o'xshaydi.",
  },
  bankTooEasy: { ru: "Слишком лёгкое", uz: "Juda oson" },
  bankTooHard: { ru: "Слишком трудное", uz: "Juda qiyin" },
  bankFilterAll: { ru: "Все", uz: "Barchasi" },
  bankFilterProblem: { ru: "Проблемные", uz: "Muammoli" },
  bankSaved: { ru: "Сохранено", uz: "Saqlandi" },
  bankVariantsSubtitle: {
    ru: "Выберите вариант, чтобы увидеть его задания",
    uz: "Topshiriqlarini ko'rish uchun variantni tanlang",
  },
  bankAllItems: { ru: "Все задания банка", uz: "Bankdagi barcha topshiriqlar" },
  bankAllItemsHint: {
    ru: "Один список без разбивки по вариантам",
    uz: "Variantlarga bo'linmagan yagona ro'yxat",
  },
  bankItemsCount: { ru: "Заданий: {n}", uz: "Topshiriqlar: {n}" },
  bankProblemsCount: { ru: "Проблемных: {n}", uz: "Muammoli: {n}" },
  bankNoVariants: {
    ru: "Вариантов пока нет. Создайте вариант в разделе «Сертификат».",
    uz: "Hozircha variant yo'q. «Sertifikat» bo'limida variant yarating.",
  },
  bankVariantEmpty: {
    ru: "В этом варианте пока нет заданий: заполните ключ варианта.",
    uz: "Bu variantda hali topshiriq yo'q: variant kalitini to'ldiring.",
  },
  bankUnusedItems: { ru: "Вне вариантов", uz: "Variantlardan tashqarida" },
  bankUnusedHint: {
    ru: "Задания банка, которые пока не входят ни в один вариант",
    uz: "Hech bir variantga kirmagan bank topshiriqlari",
  },

  // --- полоса соответствия ---
  fitEnvelope: { ru: "полоса {low}–{high}", uz: "yo'lak {low}–{high}" },
  fitEnvelopeHint: {
    ru: "Полоса измерена симуляцией на этих же данных: столько даёт исправное задание при таком числе ответов. Постоянный порог здесь не годится — разброс среднего квадрата зависит от объёма, и на тридцати ответах книжные 0.5–1.5 лежат внутри разброса нормальных заданий.",
    uz: "Yo'lak shu ma'lumotlar bo'yicha simulyatsiya bilan o'lchangan: shuncha javob bo'lganda soz topshiriq shuncha beradi. Doimiy chegara bu yerda yaramaydi.",
  },

  // --- дрейф якорей ---
  raschDriftTitle: { ru: "Дрейф общих заданий", uz: "Umumiy topshiriqlar siljishi" },
  raschDriftHint: {
    ru: "Общее задание держит шкалу двух вариантов, пока остаётся тем же вопросом. Если оно утекло в чаты или тему стали проходить иначе, оно ведёт себя в новом варианте не так — и тянет за собой всю связь. Здесь показано расхождение задания с самим собой после совмещения шкал.",
    uz: "Umumiy topshiriq bir xil savol bo'lib qolgunicha ikki variant shkalasini ushlab turadi. Agar u chatlarga oqib ketgan yoki mavzu boshqacha o'tila boshlagan bo'lsa, u yangi variantda boshqacha ishlaydi — va butun bog'lanishni tortadi.",
  },
  raschDriftNone: { ru: "Все общие задания ведут себя одинаково в своих вариантах.", uz: "Barcha umumiy topshiriqlar o'z variantlarida bir xil ishlaydi." },
  raschDriftAction: {
    ru: "Такое задание надо вывести из банка, а не подгонять под него шкалу: изменилось задание, а не измерение. Уже выставленные баллы не пересчитываются — как и при правке ключа.",
    uz: "Bunday topshiriqni bankdan chiqarish kerak, shkalani unga moslashtirmaslik: o'zgargani — topshiriq, o'lchov emas. Qo'yilgan ballar qayta hisoblanmaydi.",
  },
  raschDriftValue: { ru: "разошлось на {value} логита", uz: "{value} logitga ajraldi" },
  raschStableOf: { ru: "устойчивых {n} из {total}", uz: "{total} dan {n} barqaror" },
  raschTooFewStable: {
    ru: "устойчивых меньше {need} — связывать не на чем",
    uz: "barqarorlari {need} dan kam — bog'lashga asos yo'q",
  },
  cardDisplacement: { ru: "Дрейф между вариантами", uz: "Variantlar orasidagi siljish" },
  cardDisplacementHint: {
    ru: "Задание стоит в нескольких вариантах и ведёт себя в них по-разному. Как якорь оно больше не годится.",
    uz: "Topshiriq bir nechta variantda turibdi va ularda turlicha ishlaydi. Langar sifatida u endi yaramaydi.",
  },

  // --- связность матрицы ---
  raschDisconnectedTitle: { ru: "Варианты вне общей шкалы", uz: "Umumiy shkaladan tashqaridagi variantlar" },
  raschDisconnectedHint: {
    ru: "У этих вариантов нет с остальными ни одного общего задания и ни одного ученика, писавшего оба. Их шкала — своя, и сравнивать их трудности с остальным банком нельзя. Поэтому платформа их не считает вовсе: чисел нет, а не «примерные». Добавьте якорные задания из банка — и следующий пересчёт свяжет их.",
    uz: "Bu variantlarning boshqalar bilan birorta umumiy topshirig'i ham, ikkalasini yozgan o'quvchisi ham yo'q. Ularning shkalasi — o'ziniki, qiyinliklarini bank bilan solishtirib bo'lmaydi. Shuning uchun platforma ularni umuman hisoblamaydi. Bankdan langar topshiriqlar qo'shing — keyingi hisoblash ularni bog'laydi.",
  },
  raschDisconnectedItems: { ru: "заданий без оценки: {n}", uz: "bahosiz topshiriqlar: {n}" },

  // --- частично-кредитная модель и одномерность ---
  calibThresholds: { ru: "Ступени письменной работы", uz: "Yozma ish bosqichlari" },
  calibThresholdsDisordered: {
    ru: "Ступени идут не по возрастанию: средней ступенью почти никто не заканчивает — работа либо не сдвигается, либо делается почти целиком. Шкалу оценивания стоит огрубить.",
    uz: "Bosqichlar o'sish tartibida emas: o'rta bosqichda deyarli hech kim to'xtamaydi — ish yo siljimaydi, yo deyarli to'liq bajariladi. Baholash shkalasini yiriklashtirish kerak.",
  },
  calibThresholdsHint: {
    ru: "Баллы сведены в пять ступеней. Порог — подготовка, при которой ученик с равной вероятностью остаётся на ступени или переходит на следующую.",
    uz: "Ballar besh bosqichga keltirilgan. Bo'sag'a — o'quvchi bosqichda qolishi yoki keyingisiga o'tishi teng ehtimolli bo'lgan tayyorgarlik.",
  },
  raschDimensionTitle: { ru: "Одномерность вариантов", uz: "Variantlarning bir o'lchovliligi" },
  raschDimensionHint: {
    ru: "Модель Раша верна, только если вариант меряет одну величину. Первый контраст — насколько сильно задания расходятся на две группы после того, как подготовка уже учтена. Сравнивается не с общим порогом, а с потолком шума: столько даёт заведомо одномерный тест такого же размера.",
    uz: "Rasch modeli variant bitta kattalikni o'lchagandagina to'g'ri. Birinchi kontrast — tayyorgarlik hisobga olingandan keyin topshiriqlar ikki guruhga qanchalik ajralishi. Umumiy chegara bilan emas, shovqin shifti bilan solishtiriladi: shuncha xuddi shu o'lchamdagi bir o'lchovli test beradi.",
  },
  raschNoiseCeiling: { ru: "шум даёт до {value}", uz: "shovqin {value} gacha beradi" },
  raschContrast: { ru: "Первый контраст", uz: "Birinchi kontrast" },
  raschDimensionOk: { ru: "одно измерение", uz: "bitta o'lchov" },
  raschDimensionSuspect: { ru: "похоже на второе измерение", uz: "ikkinchi o'lchovga o'xshaydi" },
  raschPoleTop: { ru: "Один полюс", uz: "Bir qutb" },
  raschPoleBottom: { ru: "Другой полюс", uz: "Boshqa qutb" },
  raschPoleHint: {
    ru: "Если задания на полюсах явно про разное — вариант меряет две вещи сразу, и общая шкала складывает несравнимое.",
    uz: "Agar qutblardagi topshiriqlar aniq turli narsa haqida bo'lsa — variant bir vaqtda ikki narsani o'lchaydi.",
  },
  raschDependentTitle: { ru: "Зависимые пары заданий", uz: "Bog'liq topshiriq juftlari" },
  raschDependentHint: {
    ru: "Модель требует, чтобы после учёта подготовки ответы на разные задания были независимы. Задания на общем тексте это нарушают: кто понял текст — решит все, кто не понял — провалит все. Такая пара считается за два измерения, и тест выглядит надёжнее, чем он есть.",
    uz: "Model tayyorgarlik hisobga olingandan keyin javoblar mustaqil bo'lishini talab qiladi. Umumiy matndagi topshiriqlar buni buzadi: matnni tushungan hammasini ishlaydi.",
  },
  raschDependentPair: { ru: "остатки ходят вместе: {value}", uz: "qoldiqlar birga yuradi: {value}" },
  raschDimensionNone: {
    ru: "Пока не на чем считать: нужен вариант, где не меньше 20 учеников ответили на 5 и более откалиброванных заданий.",
    uz: "Hozircha hisoblashga asos yo'q: kamida 20 o'quvchi 5 va undan ortiq kalibrlangan topshiriqqa javob bergan variant kerak.",
  },

  // --- поправка на трудность варианта ---
  equatedTitle: { ru: "С поправкой на трудность варианта", uz: "Variant qiyinligiga tuzatish bilan" },
  equatedHint: {
    ru: "Сумма верных переведена в уровень по трудностям этого варианта, а уровень — в эквивалент на эталонном. Письменная половина не меняется.",
    uz: "To'g'ri javoblar soni shu variant qiyinligi bo'yicha darajaga, daraja esa etalon variantdagi ekvivalentga o'tkazildi. Yozma yarmi o'zgarmaydi.",
  },
  equatedMeasure: { ru: "Уровень подготовки", uz: "Tayyorgarlik darajasi" },
  equatedSolved: { ru: "Решено", uz: "Ishlangan" },
  equatedOnReference: { ru: "На эталонном варианте", uz: "Etalon variantda" },
  equatedOutOf: { ru: "{n} из {total}", uz: "{total} dan {n}" },
  equatedDelta: { ru: "поправка {value}", uz: "tuzatish {value}" },
  equatedShared: { ru: "Общих заданий с эталоном: {n}", uz: "Etalon bilan umumiy topshiriqlar: {n}" },
  equatedIsReference: { ru: "Это и есть эталонный вариант", uz: "Bu — etalon variantning o'zi" },
  equatedNotCalibrated: {
    ru: "Недоступно: задания варианта ещё не откалиброваны. Нужно {min} ответов на задание.",
    uz: "Mavjud emas: variant topshiriqlari hali kalibrlanmagan. Har topshiriqqa {min} javob kerak.",
  },
  equatedNotLinked: {
    ru: "Недоступно: у варианта нет общих заданий с остальными. Добавьте якорные задания — тогда результаты станут сравнимы.",
    uz: "Mavjud emas: variantning boshqalar bilan umumiy topshirig'i yo'q. Langar topshiriqlar qo'shing — shunda natijalar solishtiriladi.",
  },
  equatedBelowRange: {
    ru: "Уровень ниже того, что этот вариант способен измерить: ни одного верного ответа.",
    uz: "Daraja bu variant o'lchay oladiganidan past: bitta ham to'g'ri javob yo'q.",
  },
  equatedAboveRange: {
    ru: "Уровень выше измеримого этим вариантом: решено всё.",
    uz: "Daraja bu variant o'lchaganidan yuqori: hammasi ishlangan.",
  },
  equatedColumn: { ru: "с поправкой", uz: "tuzatish bilan" },
  equatedReference: { ru: "Эталонный вариант", uz: "Etalon variant" },
  equatedReferenceHint: {
    ru: "К его шкале приводятся результаты остальных вариантов. По умолчанию — вариант с наибольшим числом откалиброванных заданий.",
    uz: "Qolgan variantlar natijalari uning shkalasiga keltiriladi. Sukut bo'yicha — eng ko'p kalibrlangan topshiriqli variant.",
  },

  // --- шкала Раша ---
  navRasch: { ru: "Шкала Раша", uz: "Rasch shkalasi" },
  raschTitle: { ru: "Шкала Раша", uz: "Rasch shkalasi" },
  raschSubtitle: {
    ru: "Что модель говорит о банке целиком, а не об отдельном задании",
    uz: "Model alohida topshiriq haqida emas, butun bank haqida nima deydi",
  },
  raschEmpty: {
    ru: "Калибровки ещё не было или данных не хватило. Нажмите «Пересчитать»: трудность появляется у задания с {min} ответов.",
    uz: "Kalibrlash hali bo'lmagan yoki ma'lumot yetmagan. «Qayta hisoblash»ni bosing: qiyinlik {min} javobdan boshlab paydo bo'ladi.",
  },
  raschSeparationTitle: { ru: "Разделяющая способность", uz: "Ajratish qobiliyati" },
  raschStrata: { ru: "Различимых уровней", uz: "Ajratiladigan darajalar" },
  raschReliability: { ru: "Надёжность", uz: "Ishonchlilik" },
  raschIndex: { ru: "Индекс разделения", uz: "Ajratish indeksi" },
  raschSeparationHint: {
    ru: "Сколько групп подготовки этот банк реально различает на этих учениках. Меньше двух — тест делит только на «сильных и слабых».",
    uz: "Bu bank shu o'quvchilarda nechta tayyorgarlik guruhini ajrata oladi. Ikkitadan kam bo'lsa — test faqat «kuchli va kuchsiz»ga bo'ladi.",
  },
  raschMapTitle: { ru: "Карта: ученики и задания на одной шкале", uz: "Xarita: o'quvchilar va topshiriqlar bir shkalada" },
  raschMapHint: {
    ru: "Вверх — сколько учеников с такой подготовкой, вниз — сколько заданий такой трудности. Задание работает там, где над ним стоят ученики. Половины масштабированы отдельно, пик каждой подписан.",
    uz: "Yuqoriga — shunday tayyorgarlikdagi o'quvchilar soni, pastga — shunday qiyinlikdagi topshiriqlar soni. Topshiriq ustida o'quvchilar turgan joyda ishlaydi. Yarimlar alohida masshtablangan, har birining cho'qqisi imzolangan.",
  },
  raschAxisHint: {
    ru: "Процент под логитом — какую долю банка решает ученик такого уровня. Это подпись для чтения: складывать и усреднять проценты нельзя, шкала неравномерна.",
    uz: "Logit ostidagi foiz — shu darajadagi o'quvchi bankning qancha qismini ishlaydi. Bu faqat o'qish uchun izoh: foizlarni qo'shib, o'rtachasini olib bo'lmaydi, shkala notekis.",
  },
  raschSolvedShare: { ru: "решают {n}%", uz: "{n}% ishlaydi" },
  raschMapPersons: { ru: "Ученики", uz: "O'quvchilar" },
  raschMapItems: { ru: "Задания", uz: "Topshiriqlar" },
  raschMeanLine: { ru: "среднее {value}", uz: "o'rtacha {value}" },
  raschPeak: { ru: "пик {n}", uz: "cho'qqi {n}" },
  raschBandsTitle: { ru: "Покрытие: где банку не хватает заданий", uz: "Qamrov: bankka topshiriq yetishmaydigan joylar" },
  raschBandsHint: {
    ru: "Полосы по полулогита в том диапазоне, где стоят ученики.",
    uz: "O'quvchilar turgan oraliqda yarim logitlik yo'laklar.",
  },
  raschBandGap: { ru: "нет заданий", uz: "topshiriq yo'q" },
  raschBandThin: { ru: "мало заданий", uz: "topshiriq kam" },
  raschMisfitTitle: { ru: "Задания вне полосы соответствия", uz: "Moslik yo'lagidan tashqaridagi topshiriqlar" },
  raschUnderfit: { ru: "Ведут себя непредсказуемо (outfit выше 1.5)", uz: "Oldindan aytib bo'lmaydi (outfit 1.5 dan yuqori)" },
  raschUnderfitHint: {
    ru: "Подготовленные ученики их проваливают. Обычно это ошибка в ключе или двусмысленная формулировка.",
    uz: "Tayyor o'quvchilar ularni ishlay olmaydi. Odatda bu kalitdagi xato yoki noaniq ifoda.",
  },
  raschOverfit: { ru: "Слишком предсказуемы (outfit ниже 0.5)", uz: "Juda oldindan aytiladi (outfit 0.5 dan past)" },
  raschOverfitHint: {
    ru: "Повторяют то, что уже меряют соседние задания. Место в варианте тратится зря.",
    uz: "Qo'shni topshiriqlar o'lchaganini takrorlaydi. Variantdagi joy behuda ketadi.",
  },
  raschMisfitNone: { ru: "Все задания в рабочей полосе.", uz: "Barcha topshiriqlar ishchi yo'lakda." },
  raschLinksTitle: { ru: "Связанность вариантов", uz: "Variantlar bog'liqligi" },
  raschLinksHint: {
    ru: "Общие задания — единственное, что связывает шкалы двух вариантов. Без них результаты сравнивать нельзя.",
    uz: "Umumiy topshiriqlar — ikki variant shkalasini bog'laydigan yagona narsa. Ularsiz natijalarni solishtirib bo'lmaydi.",
  },
  raschLinkShared: { ru: "общих: {n}", uz: "umumiy: {n}" },
  raschLinkAlone: { ru: "нет общих заданий ни с одним вариантом", uz: "hech bir variant bilan umumiy topshiriq yo'q" },
  raschLinkWeak: { ru: "меньше {need} — шкалы разъезжаются", uz: "{need} dan kam — shkalalar ajralib ketadi" },
  raschCalibratedOf: { ru: "откалибровано {n} из {total}", uz: "{total} dan {n} kalibrlangan" },
  raschScoreTitle: { ru: "Перевод: сумма верных → шкала", uz: "O'tkazish: to'g'ri javoblar → shkala" },
  raschScoreHint: {
    ru: "Здесь трудность заданий и входит в оценку ученика. Одна и та же сумма на трудном и лёгком вариантах даёт разный уровень.",
    uz: "Topshiriq qiyinligi o'quvchi bahosiga aynan shu yerda kiradi. Bir xil yig'indi qiyin va oson variantda turli daraja beradi.",
  },
  raschScoreRaw: { ru: "Верных", uz: "To'g'ri" },
  raschScoreLogit: { ru: "Уровень", uz: "Daraja" },
  raschHistoryTitle: { ru: "История прогонов", uz: "Hisoblashlar tarixi" },
  raschHistoryRow: {
    ru: "учеников: {persons}, заданий: {items}",
    uz: "o'quvchilar: {persons}, topshiriqlar: {items}",
  },
  raschHistoryHint: {
    ru: "Трудность уточняется с накоплением ответов. Если она гуляет от прогона к прогону — дело в задании или в потоке, а не в модели.",
    uz: "Qiyinlik javoblar to'planishi bilan aniqlashadi. Agar u hisoblashdan hisoblashga sakrasa — gap topshiriqda yoki oqimda.",
  },

  // --- anchors ---
  anchorsLabel: { ru: "Якорей: {n} из {need}", uz: "Langarlar: {need} dan {n}" },
  anchorsTitle: { ru: "Якорные задания", uz: "Langar topshiriqlar" },
  anchorsHint: {
    ru: "Задания, повторяющиеся из прошлых вариантов. Они связывают варианты в одну шкалу — без них результаты разных вариантов несопоставимы.",
    uz: "Oldingi variantlardan takrorlanadigan topshiriqlar. Ular variantlarni yagona shkalaga bog'laydi — ularsiz natijalarni taqqoslab bo'lmaydi.",
  },
  anchorsPick: { ru: "Подобрать якори", uz: "Langarlarni tanlash" },
  anchorsNone: {
    ru: "Нет подходящих заданий: в этом курсе пока нет других вариантов с заполненным ключом.",
    uz: "Mos topshiriq yo'q: bu kursda kaliti to'ldirilgan boshqa variant hali yo'q.",
  },
  anchorsNeedSource: {
    ru: "Чтобы задание стало якорем, у него должен быть указан источник — заполните его в банке заданий.",
    uz: "Topshiriq langar bo'lishi uchun manbasi ko'rsatilgan bo'lishi kerak — uni topshiriqlar bankida to'ldiring.",
  },
  anchorsUse: { ru: "Взять", uz: "Olish" },
  anchorsTaken: { ru: "Уже в варианте", uz: "Variantda bor" },
  anchorsSpread: {
    ru: "Берите и лёгкие, и трудные — якори должны покрывать весь диапазон.",
    uz: "Oson va qiyinlarini ham oling — langarlar butun diapazonni qamrashi kerak.",
  },
  anchorsWarnPublish: {
    ru: "Якорей всего {n} (рекомендуется {need}). Результаты этого варианта нельзя будет сравнить с другими. Всё равно опубликовать?",
    uz: "Langarlar {n} ta (tavsiya: {need}). Bu variant natijalarini boshqalari bilan solishtirib bo'lmaydi. Baribir chop etilsinmi?",
  },
  anchorsOk: { ru: "Якорей достаточно", uz: "Langarlar yetarli" },

  // --- discrimination & scales ---
  discTitle: { ru: "Различает", uz: "Ajratadi" },
  discGood: { ru: "Хорошо различает", uz: "Yaxshi ajratadi" },
  discOk: { ru: "Различает", uz: "Ajratadi" },
  discWeak: { ru: "Почти не различает", uz: "Deyarli ajratmaydi" },
  discBroken: { ru: "Слабые решают чаще", uz: "Kuchsizlar ko'proq yechadi" },
  discNoData: { ru: "Мало сдач", uz: "Topshiriqlar kam" },
  discExplain: {
    ru: "Насколько чаще сильные ученики решают это задание, чем слабые. Ниже 0 — почти всегда ошибка в ключе.",
    uz: "Kuchli o'quvchilar bu topshiriqni kuchsizlarga qaraganda qancha ko'p yechadi. 0 dan past — deyarli har doim kalitdagi xato.",
  },
  diffTitle: { ru: "Доля верных", uz: "To'g'ri javoblar" },
  diffExplain: {
    ru: "Хорошая зона — 30–85%. Выше — задание слишком лёгкое, ниже — слишком трудное или сломанное.",
    uz: "Yaxshi oraliq — 30–85%. Yuqorisi — juda oson, pasti — juda qiyin yoki nosoz.",
  },
  diffTooEasySoft: { ru: "лёгкое", uz: "oson" },
  diffTooHardSoft: { ru: "трудное", uz: "qiyin" },
  calibTitle: { ru: "Калибровка банка (модель Раша)", uz: "Bank kalibrovkasi (Rash modeli)" },
  calibNever: { ru: "Ещё не запускалась", uz: "Hali ishga tushirilmagan" },
  calibLastRun: {
    ru: "{date} · учеников: {persons}, заданий: {items}",
    uz: "{date} · o'quvchilar: {persons}, topshiriqlar: {items}",
  },
  calibRun: { ru: "Пересчитать", uz: "Qayta hisoblash" },
  calibRunning: { ru: "Считаем…", uz: "Hisoblanmoqda…" },
  calibExplain: {
    ru: "Кладёт задания всех вариантов на одну шкалу трудности — в отличие от доли верных ответов, которая сравнима только внутри одного варианта. Показывается с {min} ответов на задание: ниже этого оценка неотличима от шума.",
    uz: "Barcha variantlardagi topshiriqlarni bitta qiyinlik shkalasiga qo'yadi — to'g'ri javoblar ulushidan farqli, u faqat bitta variant ichida taqqoslanadi. Topshiriqqa {min} javobdan boshlab ko'rsatiladi: undan kam bo'lsa baho shovqindan farq qilmaydi.",
  },
  calibDifficulty: { ru: "Трудность", uz: "Qiyinlik" },
  calibFit: { ru: "Соответствие", uz: "Moslik" },
  calibNoData: {
    ru: "Данных пока недостаточно: {have} ответов из {need}",
    uz: "Ma'lumot yetarli emas: {need} dan {have} javob",
  },
  calibProvisional: { ru: "предварительно", uz: "dastlabki" },
  fitProductive: { ru: "работает как ожидается", uz: "kutilganidek ishlaydi" },
  fitUnderfit: {
    ru: "ведёт себя непредсказуемо — вероятна двусмысленность или неверный ключ",
    uz: "kutilmagan tarzda ishlaydi — noaniqlik yoki noto'g'ri kalit ehtimoli bor",
  },
  fitDegrading: {
    ru: "разрушает измерение — задание стоит переписать или снять",
    uz: "o'lchovni buzadi — topshiriqni qayta yozish yoki olib tashlash kerak",
  },
  fitOverfit: {
    ru: "слишком предсказуемо — дублирует другие задания",
    uz: "juda oldindan aytib bo'ladigan — boshqa topshiriqlarni takrorlaydi",
  },
  scaleLegend: { ru: "Как читать", uz: "Qanday o'qish kerak" },
  statTotal: { ru: "Всего заданий", uz: "Jami topshiriq" },
  statNeedKey: { ru: "Проверить ключ", uz: "Kalitni tekshirish" },
  statNoDiscriminate: { ru: "Не различают", uz: "Ajratmaydi" },
  statNoData: { ru: "Без статистики", uz: "Statistikasiz" },
  sortBy: { ru: "Сортировка", uz: "Saralash" },
  sortByTask: { ru: "По номеру", uz: "Raqami bo'yicha" },
  sortByDifficulty: { ru: "По трудности", uz: "Qiyinligi bo'yicha" },
  sortByDiscrimination: { ru: "Сначала худшие", uz: "Avval yomonlari" },
  responsesShort: { ru: "{n} ответов", uz: "{n} javob" },
  lowConfidence: { ru: "мало данных", uz: "kam ma'lumot" },

  // --- item card ---
  cardTitle: { ru: "Карточка задания", uz: "Topshiriq kartasi" },
  cardId: { ru: "Код", uz: "Kod" },
  cardType: { ru: "Тип по спецификации", uz: "Spetsifikatsiya bo'yicha turi" },
  cardTypeY1: { ru: "Y1 — закрытое, один ответ", uz: "Y1 — yopiq, bitta javob" },
  cardTypeY2: { ru: "Y2 — закрытое, на соответствие", uz: "Y2 — yopiq, moslashtirish" },
  cardTypeO1: { ru: "O1 — открытое, краткий ответ", uz: "O1 — ochiq, qisqa javob" },
  cardTypeO2: { ru: "O2 — письменная работа", uz: "O2 — yozma ish" },
  cardCognitive: { ru: "Когнитивный уровень", uz: "Kognitiv daraja" },
  cardCogI: { ru: "I — знание и понимание", uz: "I — bilish va tushunish" },
  cardCogII: { ru: "II — анализ и применение", uz: "II — tahlil va qo'llash" },
  cardCogUnset: { ru: "не задан", uz: "belgilanmagan" },
  cardAuthor: { ru: "Автор задания", uz: "Topshiriq muallifi" },
  cardEnteredBy: { ru: "Завёл в систему", uz: "Tizimga kiritdi" },
  cardStem: { ru: "Текст задания", uz: "Topshiriq matni" },
  cardStemHint: {
    ru: "Необязательно. Заполните, если хотите искать задания по тексту и собирать варианты прямо в системе.",
    uz: "Ixtiyoriy. Matn bo'yicha qidirish va variantlarni tizimda yig'ish uchun to'ldiring.",
  },
  cardNotes: { ru: "Заметки", uz: "Eslatmalar" },
  cardStatus: { ru: "Статус", uz: "Holat" },
  cardActive: { ru: "В обороте", uz: "Faol" },
  cardRetired: { ru: "Выведено", uz: "Chiqarilgan" },
  cardRetire: { ru: "Вывести из оборота", uz: "Chiqarish" },
  cardRestore: { ru: "Вернуть в оборот", uz: "Qaytarish" },
  cardRetireHint: {
    ru: "Задание перестаёт предлагаться в якори, но история его ответов сохраняется.",
    uz: "Topshiriq langar sifatida taklif qilinmaydi, lekin javoblar tarixi saqlanadi.",
  },
  cardOptions: { ru: "Разбор вариантов ответа", uz: "Javob variantlari tahlili" },
  cardOptionsHint: {
    ru: "Хороший неверный вариант притягивает слабых и не притягивает сильных. Вариант, который не выбирает никто, работу не делает.",
    uz: "Yaxshi noto'g'ri variant kuchsizlarni jalb qiladi, kuchlilarni yo'q. Hech kim tanlamaydigan variant foydasiz.",
  },
  cardOptionKey: { ru: "ключ", uz: "kalit" },
  cardOptionStrong: { ru: "сильные", uz: "kuchlilar" },
  cardOptionWeak: { ru: "слабые", uz: "kuchsizlar" },
  cardOptionDead: { ru: "не выбирают", uz: "tanlanmaydi" },
  cardBlank: { ru: "Без ответа", uz: "Javobsiz" },
  cardUsage: { ru: "В каких вариантах использовалось", uz: "Qaysi variantlarda ishlatilgan" },
  cardUsageEmpty: { ru: "Пока ни в одном варианте.", uz: "Hali hech qanday variantda yo'q." },
  cardFlags: { ru: "На что обратить внимание", uz: "Nimaga e'tibor berish kerak" },
  flagSuspectKey: { ru: "Похоже на опечатку в ключе", uz: "Kalitda xatoga o'xshaydi" },
  flagNegativeDisc: { ru: "Слабые решают чаще сильных", uz: "Kuchsizlar kuchlilardan ko'p yechadi" },
  flagTooEasy: { ru: "Слишком лёгкое — не различает", uz: "Juda oson — ajratmaydi" },
  flagTooHard: { ru: "Слишком трудное", uz: "Juda qiyin" },
  flagDeadDistractor: { ru: "Есть вариант, который никто не выбирает", uz: "Hech kim tanlamaydigan variant bor" },
  flagKeyRevised: {
    ru: "Ключ правили после того, как появились ответы — статистика до и после несопоставима",
    uz: "Javoblar paydo bo'lgach kalit o'zgartirilgan — undan oldingi va keyingi statistika taqqoslanmaydi",
  },
  cardSave: { ru: "Сохранить", uz: "Saqlash" },
  cardSaved: { ru: "Сохранено", uz: "Saqlandi" },
  cardNoStats: {
    ru: "Статистики пока нет — она появится после того, как вариант напишет группа.",
    uz: "Statistika hali yo'q — guruh variantni yozgach paydo bo'ladi.",
  },

  // --- topics from the spec ---
  topicLifeScience: { ru: "Биология как наука", uz: "Biologiya fan sifatida" },
  topicCell: { ru: "Клетка, обмен веществ, генетика", uz: "Hujayra, moddalar almashinuvi, genetika" },
  topicSystematics: { ru: "Систематика", uz: "Sistematika" },
  topicPlantsAnimals: { ru: "Растения и животные", uz: "O'simlik va hayvonot dunyosi" },
  topicHuman: { ru: "Организм человека", uz: "Odam organizmi" },
  topicSpeciesPopulation: { ru: "Вид и популяция", uz: "Tur va populyatsiya" },
  topicEcosystem: { ru: "Экосистема и биосфера", uz: "Ekosistema va biosfera" },
  topicLogic: { ru: "Логические задания", uz: "Mantiqiy topshiriqlar" },
  topicGeneralBio: { ru: "Общебиологические задачи", uz: "Umumbiologik masalalar" },


  navSupport: { ru: "Поддержка", uz: "Yordam" },
  navLogout: { ru: "Выйти", uz: "Chiqish" },

  // login
  loginTitle: { ru: "Вход в панель", uz: "Panelga kirish" },
  loginSubtitle: { ru: "Для учителей и помощников", uz: "O'qituvchilar va yordamchilar uchun" },
  username: { ru: "Логин", uz: "Login" },
  password: { ru: "Пароль", uz: "Parol" },
  signIn: { ru: "Войти", uz: "Kirish" },
  signingIn: { ru: "Входим…", uz: "Kirilmoqda…" },
  loginFailed: { ru: "Не удалось войти", uz: "Kirib bo'lmadi" },

  // deep links
  openInTelegram: { ru: "Открыть в Telegram", uz: "Telegramda ochish" },
  copy: { ru: "Скопировать", uz: "Nusxalash" },
  copied: { ru: "Скопировано", uz: "Nusxalandi" },

  // dashboard
  welcomeBack: { ru: "С возвращением, {name}", uz: "Xush kelibsiz, {name}" },
  colleague: { ru: "коллега", uz: "hamkasb" },
  dashboardIntro: {
    ru: "Здесь — сводка по курсам, ученикам и домашним заданиям, ожидающим проверки.",
    uz: "Bu yerda kurslar, o'quvchilar va tekshirish kutayotgan uy vazifalari bo'yicha xulosa.",
  },
  statActiveStudents: { ru: "Активных учеников", uz: "Faol o'quvchilar" },
  statUnreviewed: { ru: "Непроверенных ДЗ", uz: "Tekshirilmagan vazifalar" },
  statLiveLessons: { ru: "Live-уроков за 7 дней", uz: "7 kundagi jonli darslar" },
  statAccessAttention: { ru: "Доступ требует внимания", uz: "Ruxsat e'tibor talab qiladi" },
  statNearBlacklist: { ru: "На грани блокировки", uz: "Bloklanish arafasida" },
  myCourses: { ru: "Мои курсы", uz: "Mening kurslarim" },
  allCourses: { ru: "Все курсы", uz: "Barcha kurslar" },
  noCoursesYet: { ru: "Курсов пока нет.", uz: "Hozircha kurslar yo'q." },
  accessNeedingAttention: { ru: "Доступ, требующий внимания", uz: "E'tibor talab qiladigan ruxsat" },
  allGood: { ru: "Всё в порядке — ничего не истекает.", uz: "Hammasi joyida — muddati tugayotgani yo'q." },
  noUnreviewed: { ru: "Непроверенных сдач нет.", uz: "Tekshirilmagan topshiriqlar yo'q." },
  studentNo: { ru: "Ученик №{id}", uz: "O'quvchi №{id}" },
  expiringSoon: { ru: "Скоро истечёт", uz: "Tez orada tugaydi" },
  onReview: { ru: "На проверке", uz: "Tekshiruvda" },
  wholeQueue: { ru: "Вся очередь", uz: "Butun navbat" },
  attemptHomework: { ru: "Попытка {n} · ДЗ #{id}", uz: "{n}-urinish · Vazifa #{id}" },
  expired: { ru: "Истёк", uz: "Muddati tugagan" },
  nearThresholdNote: {
    ru: "учеников в одном шаге от штрафного порога",
    uz: "o'quvchi jarima chegarasidan bir qadam narida",
  },
  archivedSuffix: { ru: " · в архиве", uz: " · arxivda" },

  // courses
  courses: { ru: "Курсы", uz: "Kurslar" },
  course: { ru: "Курс", uz: "Kurs" },
  courseTitle: { ru: "Название курса", uz: "Kurs nomi" },
  subject: { ru: "Предмет", uz: "Fan" },
  subjectBiology: { ru: "Биология", uz: "Biologiya" },
  subjectChemistry: { ru: "Химия", uz: "Kimyo" },
  create: { ru: "Создать", uz: "Yaratish" },
  createCourseFailed: { ru: "Не удалось создать курс", uz: "Kurs yaratib bo'lmadi" },
  noCoursesCreateFirst: {
    ru: "Курсов пока нет — создайте первый выше.",
    uz: "Hozircha kurslar yo'q — yuqorida birinchisini yarating.",
  },

  // course detail
  studentInviteLink: { ru: "Ссылка для учеников", uz: "O'quvchilar uchun havola" },
  studentInviteHint: {
    ru: "Отправьте её ученикам. Перешедший по ссылке появится в разделе «Ученики» со статусом «Ожидает выдачи» — доступ вы открываете сами.",
    uz: "Uni o'quvchilarga yuboring. Havolaga o'tgan kishi «O'quvchilar» bo'limida «Ruxsat kutilmoqda» holatida paydo bo'ladi — ruxsatni o'zingiz ochasiz.",
  },
  studentInviteNote: {
    ru: "Ссылка постоянная — одна на весь курс, срок действия не истекает.",
    uz: "Havola doimiy — butun kurs uchun bitta, muddati tugamaydi.",
  },
  courseGroup: { ru: "Telegram-группа курса", uz: "Kursning Telegram guruhi" },
  groupLinked: { ru: "Привязана", uz: "Bog'langan" },
  groupNotLinked: { ru: "Не привязана", uz: "Bog'lanmagan" },
  linkGroup: { ru: "Привязать группу", uz: "Guruhni bog'lash" },
  linkGroupHint: {
    ru: "Откройте ссылку, затем добавьте бота в группу курса и отправьте там показанную команду.",
    uz: "Havolani oching, so'ng botni kurs guruhiga qo'shing va u yerda ko'rsatilgan buyruqni yuboring.",
  },
  linkStartFailed: { ru: "Не удалось начать привязку", uz: "Bog'lashni boshlab bo'lmadi" },
  moduleTitle: { ru: "Название модуля", uz: "Modul nomi" },
  addModule: { ru: "Добавить модуль", uz: "Modul qo'shish" },
  createModuleFailed: { ru: "Не удалось создать модуль", uz: "Modul yaratib bo'lmadi" },
  noModulesCreateFirst: {
    ru: "Модулей пока нет — добавьте первый выше.",
    uz: "Hozircha modullar yo'q — yuqorida birinchisini qo'shing.",
  },

  // module detail
  lessons: { ru: "Уроки", uz: "Darslar" },
  lessonTitle: { ru: "Название урока", uz: "Dars nomi" },
  lessonType: { ru: "Тип", uz: "Turi" },
  lessonRecorded: { ru: "Запись", uz: "Yozuv" },
  lessonLive: { ru: "Live", uz: "Jonli" },
  airTime: { ru: "Время эфира", uz: "Efir vaqti" },
  plannedPublish: { ru: "Плановая публикация", uz: "Rejalashtirilgan chiqish" },
  callLinkOptional: { ru: "Ссылка на звонок (необязательно сейчас)", uz: "Qo'ng'iroq havolasi (hozir shart emas)" },
  addLesson: { ru: "Добавить урок", uz: "Dars qo'shish" },
  createLessonFailed: { ru: "Не удалось создать урок", uz: "Dars yaratib bo'lmadi" },
  noLessonsCreateFirst: {
    ru: "Уроков пока нет — добавьте первый выше.",
    uz: "Hozircha darslar yo'q — yuqorida birinchisini qo'shing.",
  },
  draftSuffix: { ru: " · черновик", uz: " · qoralama" },

  // lesson detail
  lessonLiveFull: { ru: "Live-урок", uz: "Jonli dars" },
  draft: { ru: "Черновик", uz: "Qoralama" },
  publish: { ru: "Опубликовать", uz: "Chop etish" },
  uploaded: { ru: "Загружено", uz: "Yuklangan" },
  published: { ru: "Опубликован", uz: "Chop etilgan" },
  publishFailed: { ru: "Не удалось опубликовать", uz: "Chop etib bo'lmadi" },
  schedule: { ru: "Расписание", uz: "Jadval" },
  callLink: { ru: "Ссылка на звонок", uz: "Qo'ng'iroq havolasi" },
  notUploaded: { ru: "Не загружено", uz: "Yuklanmagan" },
  noRecording: { ru: "Запись не оставлена", uz: "Yozuv qoldirilmagan" },
  video: { ru: "Видео", uz: "Video" },
  attachVideo: { ru: "Прикрепить видео", uz: "Video biriktirish" },
  replaceVideo: { ru: "Загрузить другое видео", uz: "Boshqa video yuklash" },
  attachVideoHint: {
    ru: "Откройте ссылку и отправьте видео файлом — оно прикрепится к уроку.",
    uz: "Havolani oching va videoni fayl sifatida yuboring — u darsga biriktiriladi.",
  },
  attachVideoFailed: { ru: "Не удалось начать загрузку видео", uz: "Video yuklashni boshlab bo'lmadi" },
  homework: { ru: "Домашнее задание", uz: "Uy vazifasi" },
  task: { ru: "Задание", uz: "Topshiriq" },
  deadline: { ru: "Дедлайн", uz: "Muddat" },
  createHomework: { ru: "Создать ДЗ", uz: "Vazifa yaratish" },
  saveHomeworkFailed: { ru: "Не удалось сохранить ДЗ", uz: "Vazifani saqlab bo'lmadi" },
  saveFailed: { ru: "Не удалось сохранить", uz: "Saqlab bo'lmadi" },

  // review
  review: { ru: "Проверка ДЗ", uz: "Vazifalarni tekshirish" },
  filterPending: { ru: "Ожидают", uz: "Kutilmoqda" },
  queueEmpty: { ru: "Ничего нет — очередь пуста.", uz: "Hech nima yo'q — navbat bo'sh." },
  homeworkAttempt: { ru: "ДЗ #{id} · попытка {n}", uz: "Vazifa #{id} · {n}-urinish" },
  photosCount: { ru: "фото: {count}", uz: "rasmlar: {count}" },
  late: { ru: "Опоздание", uz: "Kechikish" },
  statusPending: { ru: "Ожидает", uz: "Kutilmoqda" },
  statusPassed: { ru: "Принято", uz: "Qabul qilindi" },
  statusRejected: { ru: "На пересдачу", uz: "Qayta topshirishga" },
  loadingPhotos: { ru: "Загрузка фото…", uz: "Rasmlar yuklanmoqda…" },
  photosFailed: { ru: "Не удалось загрузить фото сдачи.", uz: "Topshiriq rasmlarini yuklab bo'lmadi." },
  photoN: { ru: "Фото {n}", uz: "{n}-rasm" },
  photoZoomHint: { ru: "Фото {n} — нажмите, чтобы увеличить", uz: "{n}-rasm — kattalashtirish uchun bosing" },
  submissionPhoto: { ru: "Фото сдачи", uz: "Topshiriq rasmi" },
  commentOptional: { ru: "Комментарий текстом (необязательно)", uz: "Matnli izoh (shart emas)" },
  voiceComment: { ru: "Голосовой", uz: "Ovozli" },
  accept: { ru: "Принять", uz: "Qabul qilish" },
  reject: { ru: "На пересдачу", uz: "Qayta topshirishga" },
  reviewSaveFailed: { ru: "Не удалось сохранить проверку", uz: "Tekshiruvni saqlab bo'lmadi" },
  voiceStartFailed: { ru: "Не удалось начать запись", uz: "Yozishni boshlab bo'lmadi" },
  voiceHint: {
    ru: "Откройте ссылку и запишите голосовое — оно прикрепится к сдаче и уйдёт ученику.",
    uz: "Havolani oching va ovozli xabar yozing — u topshiriqqa biriktiriladi va o'quvchiga yuboriladi.",
  },
  voiceLeft: {
    ru: "Оставлен голосовой комментарий (доставлен ученику в чат с ботом)",
    uz: "Ovozli izoh qoldirilgan (o'quvchiga bot chatiga yetkazilgan)",
  },

  // students
  students: { ru: "Ученики", uz: "O'quvchilar" },
  noStudentsOnCourse: {
    ru: "На этом курсе пока нет учеников.",
    uz: "Bu kursda hozircha o'quvchilar yo'q.",
  },
  progress: { ru: "Прогресс", uz: "Muvaffaqiyat" },
  points: { ru: "Баллы", uz: "Ballar" },
  accessUntil: { ru: "Доступ до", uz: "Ruxsat muddati" },
  accessActive: { ru: "Активен", uz: "Faol" },
  accessPending: { ru: "Ожидает выдачи", uz: "Ruxsat kutilmoqda" },
  accessExpired: { ru: "Истёк", uz: "Muddati tugagan" },
  accessRevoked: { ru: "Отозван", uz: "Bekor qilingan" },
  blacklisted: { ru: "Заблокирован", uz: "Bloklangan" },
  badgeTrial: { ru: "Пробный", uz: "Sinov" },
  badgeFrozen: { ru: "Заморожен", uz: "Muzlatilgan" },

  // enrolment questionnaire
  application: { ru: "Анкета", uz: "Anketa" },
  applicationNone: { ru: "Анкета не заполнялась", uz: "Anketa to'ldirilmagan" },
  applicationFullName: { ru: "ФИО", uz: "F.I.Sh." },
  applicationPhone: { ru: "Телефон ученика", uz: "O'quvchi telefoni" },
  applicationParentPhone: { ru: "Телефон родителя", uz: "Ota-ona telefoni" },
  applicationParentPhone2: { ru: "Второй телефон родителя", uz: "Ikkinchi ota-ona telefoni" },
  applicationAbout: { ru: "О себе", uz: "O'zi haqida" },
  applicationSubmitted: { ru: "Подана", uz: "Topshirilgan" },
  applicationShow: { ru: "Показать анкету", uz: "Anketani ko'rsatish" },
  applicationHide: { ru: "Скрыть анкету", uz: "Anketani yashirish" },

  // removal queue
  removalTitle: { ru: "Отчисление", uz: "Chiqarish" },
  removalIntro: {
    ru: "Ученики, у которых закончился пробный период без оплаты. Из группы никто не удалён автоматически — решаете вы.",
    uz: "Sinov muddati to'lovsiz tugagan o'quvchilar. Hech kim guruhdan avtomatik o'chirilmagan — qaror sizniki.",
  },
  removalEmpty: { ru: "Никого отчислять не нужно.", uz: "Hech kimni chiqarish kerak emas." },
  removalFrozenAt: { ru: "Заморожен", uz: "Muzlatilgan" },
  removalSelectAll: { ru: "Выбрать всех", uz: "Hammasini tanlash" },
  removalClearAll: { ru: "Снять выделение", uz: "Belgilashni olib tashlash" },
  removalSelected: { ru: "Выбрано: {count}", uz: "Tanlangan: {count}" },
  removalButton: { ru: "Удалить из группы", uz: "Guruhdan o'chirish" },
  removalConfirm: {
    ru: "Удалить выбранных учеников из группы курса? Вернуть их можно будет только новым приглашением.",
    uz: "Tanlangan o'quvchilar kurs guruhidan o'chirilsinmi? Ularni faqat yangi taklif bilan qaytarish mumkin.",
  },
  removalDone: { ru: "Удалено: {ok} из {total}", uz: "O'chirildi: {total} dan {ok}" },
  removalFailedRow: { ru: "не удалось", uz: "bo'lmadi" },
  removalPending: { ru: "Удаляем…", uz: "O'chirilmoqda…" },
  grantAccess: { ru: "Выдать доступ", uz: "Ruxsat berish" },
  extendAccess: { ru: "Продлить", uz: "Uzaytirish" },
  revokeAccess: { ru: "Отозвать", uz: "Bekor qilish" },
  resetPoints: { ru: "Сбросить баллы", uz: "Ballarni tozalash" },
  blockStudent: { ru: "Заблокировать", uz: "Bloklash" },
  unblockStudent: { ru: "Разблокировать", uz: "Blokdan chiqarish" },
  reasonOptional: { ru: "Причина (необязательно)", uz: "Sabab (shart emas)" },
  grantFailed: { ru: "Не удалось выдать/продлить доступ", uz: "Ruxsat berib/uzaytirib bo'lmadi" },
  revokeFailed: { ru: "Не удалось отозвать доступ", uz: "Ruxsatni bekor qilib bo'lmadi" },
  resetPointsFailed: { ru: "Не удалось сбросить баллы", uz: "Ballarni tozalab bo'lmadi" },
  blockFailed: { ru: "Не удалось заблокировать", uz: "Bloklab bo'lmadi" },
  unblockFailed: { ru: "Не удалось снять блокировку", uz: "Blokdan chiqarib bo'lmadi" },

  // assistants
  assistants: { ru: "Помощники", uz: "Yordamchilar" },
  noAssistantsYet: { ru: "Помощников пока нет.", uz: "Hozircha yordamchilar yo'q." },
  createCourseFirst: { ru: "Сначала создайте курс.", uz: "Avval kurs yarating." },
  displayName: { ru: "Имя", uz: "Ism" },
  add: { ru: "Добавить", uz: "Qo'shish" },
  remove: { ru: "Убрать", uz: "Olib tashlash" },
  disabled: { ru: "Отключён", uz: "O'chirilgan" },
  createAssistantFailed: { ru: "Не удалось создать помощника", uz: "Yordamchi yaratib bo'lmadi" },
  coursePermissions: { ru: "Права по курсам", uz: "Kurslar bo'yicha huquqlar" },
  capReview: { ru: "Проверка ДЗ", uz: "Vazifalarni tekshirish" },
  capAccess: { ru: "Доступ/оплата", uz: "Ruxsat/to'lov" },
  capBlacklist: { ru: "Блокировка", uz: "Bloklash" },

  // settings
  settings: { ru: "Настройки", uz: "Sozlamalar" },
  appearance: { ru: "Оформление", uz: "Ko'rinish" },
  appearanceHint: {
    ru: "«Как в системе» следует за настройкой светлой/тёмной темы вашего компьютера.",
    uz: "«Tizimdagidek» kompyuteringizning yorug'/tungi rejim sozlamasiga ergashadi.",
  },
  themeSystem: { ru: "Как в системе", uz: "Tizimdagidek" },
  themeLight: { ru: "Светлая", uz: "Yorug'" },
  themeDark: { ru: "Тёмная", uz: "Tungi" },
  language: { ru: "Язык", uz: "Til" },
  languageHint: {
    ru: "Уведомления от бота тоже будут приходить на выбранном языке.",
    uz: "Botdan keladigan bildirishnomalar ham tanlangan tilda bo'ladi.",
  },
  telegramNotifications: { ru: "Уведомления в Telegram", uz: "Telegram bildirishnomalari" },
  connected: { ru: "Подключены", uz: "Ulangan" },
  notConnected: { ru: "Не подключены", uz: "Ulanmagan" },
  notificationsDescription: {
    ru: "Запасной канал: если группа не подключена, уведомления придут вам в личные сообщения.",
    uz: "Zaxira kanal: guruh ulanmagan bo'lsa, bildirishnomalar shaxsiy xabarlaringizga keladi.",
  },
  notificationGroup: { ru: "Группа уведомлений", uz: "Bildirishnomalar guruhi" },
  notificationGroupDescription: {
    ru:
      "Все события платформы — новые анкеты, конец пробного периода, истечение доступа, сданные работы — " +
      "приходят в общую группу, а не в личку. Так их видят и помощники.",
    uz:
      "Platformaning barcha voqealari — yangi anketalar, sinov muddati tugashi, ruxsat tugashi, topshirilgan ishlar — " +
      "shaxsiy xabarga emas, umumiy guruhga keladi. Shunda yordamchilar ham ko'radi.",
  },
  notificationGroupHint: {
    ru: "Откройте ссылку в Telegram, добавьте бота в группу администраторов и отправьте там команду /link_…",
    uz: "Havolani Telegramda oching, botni adminlar guruhiga qo'shing va u yerda /link_… buyrug'ini yuboring.",
  },
  notificationGroupTeacherOnly: {
    ru: "Подключить группу может только преподаватель — она общая для всех помощников.",
    uz: "Guruhni faqat o'qituvchi ulay oladi — u barcha yordamchilar uchun umumiy.",
  },
  notificationGroupTags: {
    ru: "Поиск внутри группы: #student_12 — история ученика, #course_3 — курс, #biolog_admin — вся лента.",
    uz: "Guruh ichida qidiruv: #student_12 — o'quvchi tarixi, #course_3 — kurs, #biolog_admin — butun lenta.",
  },
  disconnect: { ru: "Отключить", uz: "Uzish" },
  notificationLanguage: { ru: "Язык уведомлений", uz: "Bildirishnomalar tili" },
  notificationLanguageHint: {
    ru: "На каком языке бот пишет в группу. Язык панели при этом не меняется — группу читают и помощники.",
    uz: "Bot guruhga qaysi tilda yozadi. Panel tili o'zgarmaydi — guruhni yordamchilar ham o'qiydi.",
  },
  notificationLanguageTeacherOnly: {
    ru: "Язык уведомлений меняет только преподаватель — он общий для всей группы.",
    uz: "Bildirishnomalar tilini faqat o'qituvchi o'zgartiradi — u butun guruh uchun umumiy.",
  },
  connect: { ru: "Подключить", uz: "Ulash" },
  notificationsLinkHint: {
    ru: "Откройте ссылку в Telegram и нажмите «Запустить» — уведомления подключатся сразу.",
    uz: "Havolani Telegramda oching va «Ishga tushirish» ni bosing — bildirishnomalar darhol ulanadi.",
  },
  penaltyPoints: { ru: "Штрафные баллы", uz: "Jarima ballari" },
  penaltyDescription: {
    ru: "Порог, при котором ученик автоматически блокируется на курсе.",
    uz: "O'quvchi kursda avtomatik bloklanadigan chegara.",
  },
  penaltyThreshold: { ru: "Порог баллов", uz: "Ballar chegarasi" },
  gradingTitle: { ru: "Как проверяется", uz: "Qanday tekshiriladi" },
  gradingHint: {
    ru: "Ручная проверка: ученик присылает фотографию решения. Ввод ответа: платформа сверяет набранное с ключом сразу при сдаче.",
    uz: "Qo'lda tekshirish: o'quvchi yechim suratini yuboradi. Javob kiritish: platforma topshirilganda darrov kalit bilan solishtiradi.",
  },
  gradingManual: { ru: "Вручную", uz: "Qo'lda" },
  gradingTyped: { ru: "Ввод ответа", uz: "Javob kiritish" },
  gradingPts: { ru: "б.", uz: "b." },
  gradingAddPart: { ru: "Добавить часть ответа", uz: "Javob qismini qo'shish" },
  gradingKeyPlaceholder: { ru: "митохондрия | митохондрии", uz: "mitoxondriya | mitoxondriyalar" },
  gradingSynonymHint: {
    ru: "Через «|» перечислите допустимые написания. Регистр, лишние пробелы, ё/е и запятая в числе не влияют.",
    uz: "«|» orqali ruxsat etilgan yozilishlarni sanang. Registr, ortiqcha bo'shliq va sondagi vergul ta'sir qilmaydi.",
  },
} satisfies Record<string, { ru: string; uz: string }>;

export type StringKey = keyof typeof STRINGS;

const LOCALES: Record<Language, string> = { ru: "ru-RU", uz: "uz-UZ" };

function readStored(): Language | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "ru" || raw === "uz" ? raw : null;
  } catch {
    return null;
  }
}

type Ctx = {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  formatDateTime: (value: string | Date) => string;
  formatDate: (value: string | Date) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const stored = readStored();
    if (stored) return stored;
    return navigator.language?.toLowerCase().startsWith("uz") ? "uz" : "ru";
  });

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is survivable — the session still switches.
    }
    // Also stored on the staff row: the jobs that DM a teacher about expiring
    // access or unreviewed homework run on the server and never see this tab.
    void apiFetch("/settings", {
      method: "PATCH",
      body: JSON.stringify({ language: next }),
    }).catch(() => {
      // Only affects bot notifications; the panel already switched.
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => {
        let out: string = STRINGS[key][lang];
        if (vars) {
          for (const [name, v] of Object.entries(vars)) out = out.replaceAll(`{${name}}`, String(v));
        }
        return out;
      },
      formatDateTime: (value) => new Date(value).toLocaleString(LOCALES[lang]),
      formatDate: (value) => new Date(value).toLocaleDateString(LOCALES[lang]),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
