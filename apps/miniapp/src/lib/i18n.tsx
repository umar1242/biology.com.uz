import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "./api";

export type Language = "ru" | "uz";

const STORAGE_KEY = "language";

/**
 * One typed table instead of an i18n library: the string set is small, every
 * key is checked at compile time, and it keeps the Mini App bundle lean —
 * which matters on a phone opening it inside Telegram.
 *
 * Uzbek is Latin script (the state standard).
 */
const STRINGS = {
  loading: { ru: "Загрузка…", uz: "Yuklanmoqda…" },
  back: { ru: "Назад", uz: "Orqaga" },
  all: { ru: "Все", uz: "Barchasi" },
  search: { ru: "Поиск", uz: "Qidiruv" },
  notifications: { ru: "Уведомления", uz: "Bildirishnomalar" },

  // auth
  loginFailed: { ru: "Не удалось войти", uz: "Kirib bo'lmadi" },
  openFromBot: {
    ru: "Откройте это приложение через кнопку в Telegram-боте",
    uz: "Bu ilovani Telegram botdagi tugma orqali oching",
  },

  // tabs
  tabHome: { ru: "Главная", uz: "Bosh sahifa" },
  tabCourses: { ru: "Курсы", uz: "Kurslar" },
  tabHomework: { ru: "Задания", uz: "Vazifalar" },
  tabCert: { ru: "Сертификат", uz: "Sertifikat" },
  certListTitle: { ru: "Сертификатный экзамен", uz: "Sertifikat imtihoni" },
  certNone: { ru: "Пока нет доступных вариантов.", uz: "Hozircha mavjud variantlar yo'q." },
  certDeadline: { ru: "До", uz: "Muddat" },
  certOpenVariant: { ru: "Открыть вариант", uz: "Variantni ochish" },
  certSendFile: { ru: "Прислать файл варианта в чат", uz: "Variant faylini chatga yuborish" },
  certFileSent: {
    ru: "Файл отправлен в чат с ботом ✅",
    uz: "Fayl bot bilan chatga yuborildi ✅",
  },
  certOpenChat: { ru: "Открыть чат", uz: "Chatni ochish" },
  certStart: { ru: "Начать решение", uz: "Yechishni boshlash" },
  certContinue: { ru: "Продолжить", uz: "Davom ettirish" },
  certViewResult: { ru: "Посмотреть результат", uz: "Natijani ko'rish" },
  certWaitingReview: { ru: "Сдано, ждёт проверки", uz: "Topshirilgan, tekshiruv kutilmoqda" },
  certClosedPart: { ru: "Тесты 1–35", uz: "Testlar 1–35" },
  certOpenPart: { ru: "Задания 36–43", uz: "36–43 topshiriqlar" },
  certAnswered: { ru: "Отвечено {n} из 35", uz: "35 dan {n} javob berildi" },
  certSendPhoto: { ru: "Отправить фото решения", uz: "Yechim rasmini yuborish" },
  certPhotoSent: { ru: "Фото отправлено: {n}", uz: "Yuborilgan rasmlar: {n}" },
  certPhotoNone: { ru: "Фото пока нет", uz: "Hozircha rasm yo'q" },
  certSubmit: { ru: "Сдать работу", uz: "Ishni topshirish" },
  certSubmitConfirm: {
    ru: "После сдачи изменить ответы будет нельзя. Сдать?",
    uz: "Topshirgandan keyin javoblarni o'zgartirib bo'lmaydi. Topshirilsinmi?",
  },
  certSubmitted: { ru: "Работа сдана ✅", uz: "Ish topshirildi ✅" },
  certResultTitle: { ru: "Результат", uz: "Natija" },
  certAutoScore: { ru: "Тесты 1–35", uz: "Testlar 1–35" },
  certManualScore: { ru: "Задания 36–43", uz: "36–43 topshiriqlar" },
  certTotalScore: { ru: "Итого", uz: "Jami" },
  certTeacherComment: { ru: "Комментарий учителя", uz: "O'qituvchi izohi" },
  certMaxPoints: { ru: "макс. {n}", uz: "maks. {n}" },
  certTaskShort: { ru: "№{n}", uz: "№{n}" },
  certSaving: { ru: "Сохранение…", uz: "Saqlanmoqda…" },
  certSavedOk: { ru: "Сохранено", uz: "Saqlandi" },
  certLate: { ru: "Просрочено", uz: "Kechikkan" },
  tabProfile: { ru: "Профиль", uz: "Profil" },

  // home
  myCourses: { ru: "Мои курсы", uz: "Mening kurslarim" },
  totalCount: { ru: "{count} всего", uz: "jami {count}" },
  toSubmit: { ru: "Нужно сдать", uz: "Topshirish kerak" },
  onReview: { ru: "На проверке", uz: "Tekshiruvda" },
  recentHomework: { ru: "Недавние задания", uz: "So'nggi vazifalar" },
  oneUnsubmitted: { ru: "Есть несданное задание", uz: "Topshirilmagan vazifa bor" },
  manyUnsubmitted: { ru: "Заданий к сдаче: {count}", uz: "Topshirish kerak: {count}" },
  openToSubmit: { ru: "Откройте, чтобы отправить решение", uz: "Yechim yuborish uchun oching" },
  noHomeworkYet: { ru: "Заданий пока нет.", uz: "Hozircha vazifalar yo'q." },

  // courses / modules / lessons
  noCoursesAvailable: { ru: "Пока нет доступных курсов.", uz: "Hozircha mavjud kurslar yo'q." },
  subjectBiology: { ru: "Биология", uz: "Biologiya" },
  subjectChemistry: { ru: "Химия", uz: "Kimyo" },
  modules: { ru: "Модули", uz: "Modullar" },
  noModulesYet: { ru: "Модулей пока нет.", uz: "Hozircha modullar yo'q." },
  lessons: { ru: "Уроки", uz: "Darslar" },
  noLessonsYet: { ru: "Уроков пока нет.", uz: "Hozircha darslar yo'q." },
  lessonNotFound: { ru: "Урок не найден", uz: "Dars topilmadi" },
  lessonLive: { ru: "Live-урок", uz: "Jonli dars" },
  lessonRecorded: { ru: "Запись", uz: "Yozuv" },
  materials: { ru: "Материалы", uz: "Materiallar" },
  noRecordingYet: { ru: "Записи пока нет", uz: "Hozircha yozuv yo'q" },
  getVideoInChat: { ru: "Получить видео в чат", uz: "Videoni chatda olish" },
  joinCall: { ru: "Перейти к звонку", uz: "Qo'ng'iroqqa o'tish" },
  dueBy: { ru: "до {date}", uz: "{date} gacha" },
  videoSentToChat: {
    ru: "Видео отправлено вам в чат с ботом",
    uz: "Video bot bilan chatingizga yuborildi",
  },
  videoSendFailed: { ru: "Не удалось отправить видео", uz: "Videoni yuborib bo'lmadi" },

  // homework
  homework: { ru: "Задания", uz: "Vazifalar" },
  homeworkOne: { ru: "Задание", uz: "Vazifa" },
  homeworkNotFound: { ru: "Задание не найдено", uz: "Vazifa topilmadi" },
  notFoundHint: {
    ru: "Возможно, преподаватель удалил его или доступ к курсу закрыт.",
    uz: "Ehtimol, o'qituvchi uni o'chirgan yoki kursga ruxsat yopilgan.",
  },
  homeworkDetails: { ru: "Детали задания", uz: "Vazifa tafsilotlari" },
  deadline: { ru: "Дедлайн", uz: "Muddat" },
  task: { ru: "Задание", uz: "Topshiriq" },
  submitViaBot: { ru: "Сдать в чате с ботом", uz: "Bot orqali topshirish" },
  submitStarted: {
    ru: "Открыт чат с ботом — отправьте туда фото решения.",
    uz: "Bot bilan chat ochildi — yechim rasmini o'sha yerga yuboring.",
  },
  submitFailed: { ru: "Не удалось начать сдачу", uz: "Topshirishni boshlab bo'lmadi" },
  submissionHistory: { ru: "История сдач", uz: "Topshiriqlar tarixi" },
  attemptN: { ru: "Попытка {n}", uz: "{n}-urinish" },
  wasLate: { ru: " · с опозданием", uz: " · kechikib" },
  teacherComment: { ru: "Комментарий учителя", uz: "O'qituvchi izohi" },
  teacherVoiceComment: {
    ru: "Учитель оставил голосовой комментарий",
    uz: "O'qituvchi ovozli izoh qoldirdi",
  },
  voiceArrivesInChat: { ru: "Он придёт вам в чат с ботом", uz: "U bot bilan chatingizga keladi" },

  // timeline
  stepSubmitted: { ru: "Сдано", uz: "Topshirildi" },
  stepOnReview: { ru: "На проверке", uz: "Tekshiruvda" },
  stepReviewed: { ru: "Проверено", uz: "Tekshirildi" },

  // statuses
  statusNotSubmitted: { ru: "Не сдано", uz: "Topshirilmagan" },
  statusPending: { ru: "На проверке", uz: "Tekshiruvda" },
  statusPassed: { ru: "Принято", uz: "Qabul qilindi" },
  statusNeedsResubmission: { ru: "На пересдачу", uz: "Qayta topshirishga" },
  accessActive: { ru: "Активен", uz: "Faol" },
  accessPending: { ru: "Ожидает выдачи", uz: "Ruxsat kutilmoqda" },
  accessExpired: { ru: "Истёк", uz: "Muddati tugagan" },
  accessRevoked: { ru: "Отозван", uz: "Bekor qilingan" },

  // profile
  profile: { ru: "Профиль", uz: "Profil" },
  noCoursesYet: { ru: "Пока нет курсов.", uz: "Hozircha kurslar yo'q." },
  penaltyPoints: { ru: "Штрафные баллы: {count}", uz: "Jarima ballari: {count}" },
  blacklisted: { ru: "Заблокирован", uz: "Bloklangan" },
  appearance: { ru: "Оформление", uz: "Ko'rinish" },
  themeSystem: { ru: "Как в Telegram", uz: "Telegramdagidek" },
  themeLight: { ru: "Светлая", uz: "Yorug'" },
  themeDark: { ru: "Тёмная", uz: "Tungi" },
  language: { ru: "Язык", uz: "Til" },
  languageHint: {
    ru: "Бот тоже будет писать вам на выбранном языке.",
    uz: "Bot ham sizga tanlangan tilda yozadi.",
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
  // Falls back to the Telegram client's own language before Russian, so an
  // Uzbek-speaking student sees Uzbek on first open without touching settings.
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
    // Mirror it onto the student row: the bot has no access to this browser,
    // and reminders/verdicts must arrive in the same language as the app.
    void apiFetch("/app/profile/language", {
      method: "PATCH",
      body: JSON.stringify({ language: next }),
    }).catch(() => {
      // A failed sync only affects bot messages; the UI already switched.
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
