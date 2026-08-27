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
  navStudents: { ru: "Ученики", uz: "O'quvchilar" },
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
    ru: "Бот будет присылать вам события: истечение доступа, блокировки учеников, сводку непроверенных ДЗ.",
    uz: "Bot sizga voqealarni yuboradi: ruxsat muddati tugashi, o'quvchilar bloklanishi, tekshirilmagan vazifalar xulosasi.",
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
