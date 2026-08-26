/**
 * Server-side strings — everything the bot says and every notification a job
 * sends. Kept as one typed table rather than a library: the set is small, and
 * a missing key should be a compile error, not a silent fallback at runtime.
 *
 * Uzbek is Latin script (the state standard), matching the two frontends.
 */
export type Language = "ru" | "uz";

type Entry = { ru: string; uz: string };

const STRINGS = {
  // --- /start ---
  ownerMenu: {
    ru:
      "Админ-панель платформы.\n\n" +
      "/add_teacher логин пароль имя — создать учителя\n" +
      "/list_teachers — список учителей",
    uz:
      "Platforma boshqaruv paneli.\n\n" +
      "/add_teacher login parol ism — o'qituvchi yaratish\n" +
      "/list_teachers — o'qituvchilar ro'yxati",
  },
  studentWelcome: {
    ru: "Привет! Если у вас есть ссылка на курс от преподавателя — перейдите по ней, чтобы начать.",
    uz: "Salom! Agar o'qituvchidan kurs havolasi bo'lsa, boshlash uchun shu havolaga o'ting.",
  },
  courseNotFound: { ru: "Курс не найден.", uz: "Kurs topilmadi." },
  alreadyEnrolled: {
    ru: "Вы уже зарегистрированы на курс «{course}».",
    uz: "Siz «{course}» kursiga allaqachon yozilgansiz.",
  },
  enrolled: {
    ru: "Вы записались на курс «{course}». Доступ откроет преподаватель после оплаты.",
    uz: "Siz «{course}» kursiga yozildingiz. O'qituvchi to'lovdan so'ng ruxsat beradi.",
  },

  // --- pending actions ---
  linkInvalid: { ru: "Ссылка недействительна или устарела.", uz: "Havola yaroqsiz yoki eskirgan." },
  linkClaimedByOther: {
    ru: "Эта ссылка уже используется другим пользователем.",
    uz: "Bu havoladan boshqa foydalanuvchi foydalanmoqda.",
  },
  sendVideo: {
    ru: "Отправьте видео этим сообщением — оно будет прикреплено к уроку.",
    uz: "Videoni shu xabar bilan yuboring — u darsga biriktiriladi.",
  },
  sendPhotos: {
    ru: "Отправьте одно или несколько фото решения — можно одним альбомом.",
    uz: "Yechimning bir yoki bir nechta rasmini yuboring — albom qilib ham bo'ladi.",
  },
  sendVoice: {
    ru: "Отправьте голосовое сообщение — оно будет прикреплено как комментарий к сдаче.",
    uz: "Ovozli xabar yuboring — u topshiriqqa izoh sifatida biriktiriladi.",
  },
  linkGroupInstructions: {
    ru: "Готово. Теперь добавьте бота в Telegram-группу курса и отправьте там команду:\n/link_{token}",
    uz: "Tayyor. Endi botni kursning Telegram guruhiga qo'shing va u yerda buyruqni yuboring:\n/link_{token}",
  },
  notificationsLinked: {
    ru: "Уведомления подключены ✅ Теперь бот будет писать сюда о важных событиях.",
    uz: "Bildirishnomalar ulandi ✅ Endi bot muhim voqealar haqida shu yerga yozadi.",
  },
  noPendingAction: {
    ru:
      "Не вижу, к чему это прикрепить. Откройте нужное действие в приложении " +
      "или дашборде и перейдите по ссылке — после этого пришлите файл сюда.",
    uz:
      "Buni nimaga biriktirishni bilmayapman. Ilova yoki boshqaruv panelida kerakli " +
      "amalni oching va havolaga o'ting — shundan so'ng faylni shu yerga yuboring.",
  },

  // --- ingestion results ---
  videoSaved: { ru: "Видео сохранено и прикреплено к уроку ✅", uz: "Video saqlandi va darsga biriktirildi ✅" },
  voiceSaved: { ru: "Голосовой комментарий сохранён ✅", uz: "Ovozli izoh saqlandi ✅" },
  noHomeworkAccess: {
    ru: "У вас нет доступа к этому заданию.",
    uz: "Sizda bu vazifaga ruxsat yo'q.",
  },
  submissionAccepted: {
    ru: "Принято! Сдано фото: {count}. Ожидайте проверки учителем.",
    uz: "Qabul qilindi! Yuborilgan rasmlar: {count}. O'qituvchi tekshiruvini kuting.",
  },
  groupLinked: { ru: "Группа привязана к курсу ✅", uz: "Guruh kursga bog'landi ✅" },

  // --- review verdict to student ---
  verdictPassed: { ru: "✅ ДЗ принято", uz: "✅ Uy vazifasi qabul qilindi" },
  verdictRejected: { ru: "🔄 ДЗ нужно переделать", uz: "🔄 Uy vazifasini qayta ishlash kerak" },
  verdictComment: { ru: "\n\nКомментарий: {text}", uz: "\n\nIzoh: {text}" },
  teacherVoiceComment: {
    ru: "Комментарий преподавателя к вашему ДЗ:",
    uz: "O'qituvchining uy vazifangizga izohi:",
  },

  // --- owner commands ---
  addTeacherUsage: {
    ru:
      "Использование: /add_teacher логин пароль имя\n\n" +
      "Например:\n/add_teacher aziz Parol2024 Азиз\n\n" +
      "Пишите значения без угловых скобок.",
    uz:
      "Foydalanish: /add_teacher login parol ism\n\n" +
      "Masalan:\n/add_teacher aziz Parol2024 Aziz\n\n" +
      "Qiymatlarni burchakli qavslarsiz yozing.",
  },
  teacherCreated: {
    ru:
      "Учитель создан ✅\n\nЛогин: {username}\nИмя: {name}\n\n" +
      "Вход в панель: {url}\nПароль передайте лично — он больше нигде не хранится в открытом виде.",
    uz:
      "O'qituvchi yaratildi ✅\n\nLogin: {username}\nIsm: {name}\n\n" +
      "Panelga kirish: {url}\nParolni shaxsan yetkazing — u boshqa hech qayerda ochiq saqlanmaydi.",
  },
  teacherCreateFailed: {
    ru: "Не удалось создать — возможно, такой username уже занят.",
    uz: "Yaratib bo'lmadi — ehtimol, bunday login band.",
  },
  noTeachers: { ru: "Учителей пока нет.", uz: "Hozircha o'qituvchilar yo'q." },
  teacherInactive: { ru: " (неактивен)", uz: " (faol emas)" },

  // --- notifications from jobs ---
  notifyAccessExpired: {
    ru: "⏰ Доступ ученика #{student} к курсу «{course}» истёк {date} и ещё не отозван.",
    uz: "⏰ #{student} o'quvchining «{course}» kursiga ruxsati {date} da tugadi va hali bekor qilinmagan.",
  },
  notifyAccessExpiring: {
    ru: "⏳ Доступ ученика #{student} к курсу «{course}» истекает {date}.",
    uz: "⏳ #{student} o'quvchining «{course}» kursiga ruxsati {date} da tugaydi.",
  },
  notifyAutoBlacklist: {
    ru: "🚫 Ученик #{student} автоматически заблокирован на курсе «{course}» — достигнут порог штрафных баллов.",
    uz: "🚫 #{student} o'quvchi «{course}» kursida avtomatik bloklandi — jarima ballari chegarasiga yetdi.",
  },
  notifyLiveLesson: {
    ru: "🔴 Live-урок «{lesson}» начинается в {time}.",
    uz: "🔴 «{lesson}» jonli darsi {time} da boshlanadi.",
  },
  notifyLiveLessonWithLink: {
    ru: "🔴 Live-урок «{lesson}» начинается в {time}. Ссылка: {link}",
    uz: "🔴 «{lesson}» jonli darsi {time} da boshlanadi. Havola: {link}",
  },
  notifyHomeworkDeadline: {
    ru: "⏰ Напоминание: дедлайн по заданию «{lesson}» — {time}. Не забудьте сдать!",
    uz: "⏰ Eslatma: «{lesson}» vazifasi muddati — {time}. Topshirishni unutmang!",
  },
  notifyUnreviewedDigest: {
    ru: "📋 У вас {count} непроверенных домашних заданий.",
    uz: "📋 Sizda {count} ta tekshirilmagan uy vazifasi bor.",
  },
  notifyCourseInvite: {
    ru: "Вам открыт доступ к курсу. Присоединяйтесь к группе курса: {link}",
    uz: "Sizga kursga ruxsat berildi. Kurs guruhiga qo'shiling: {link}",
  },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

const LOCALES: Record<Language, string> = { ru: "ru-RU", uz: "uz-UZ" };

/** Dates in notifications must follow the recipient's language, not the server's. */
export function formatDateTime(lang: Language, date: Date): string {
  return date.toLocaleString(LOCALES[lang]);
}

export function formatDate(lang: Language, date: Date): string {
  return date.toLocaleDateString(LOCALES[lang]);
}

/**
 * `{placeholder}` substitution — values are inserted verbatim, so never pass
 * anything that must be escaped for a parse mode. All bot sends are plain text.
 */
export function t(
  lang: Language,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  let out: string = STRINGS[key][lang];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}
