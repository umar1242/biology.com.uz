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
  sendCertVariant: {
    ru: "Отправьте файл варианта (PDF или фото) — он будет прикреплён к сертификатному экзамену.",
    uz: "Variant faylini (PDF yoki rasm) yuboring — u sertifikat imtihoniga biriktiriladi.",
  },
  sendCertTaskPhotos: {
    ru: "Отправьте фото решения задания №{task} — можно несколько одним альбомом.",
    uz: "№{task} topshiriq yechimining rasmini yuboring — bir nechta albom qilib ham bo'ladi.",
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
  certVariantSaved: {
    ru: "Файл варианта сохранён ✅ Теперь заполните ключ ответов 1–35 в дашборде.",
    uz: "Variant fayli saqlandi ✅ Endi boshqaruv panelida 1–35 javoblar kalitini to'ldiring.",
  },
  certTaskAccepted: {
    ru: "Принято! Задание №{task}, фото: {count}. Можно отправлять следующее задание.",
    uz: "Qabul qilindi! №{task} topshiriq, rasmlar: {count}. Keyingi topshiriqni yuborishingiz mumkin.",
  },
  noCertAccess: {
    ru: "У вас нет доступа к этому варианту.",
    uz: "Sizda bu variantga ruxsat yo'q.",
  },
  certAlreadySubmitted: {
    ru: "Этот вариант уже сдан — изменить ответы нельзя.",
    uz: "Bu variant allaqachon topshirilgan — javoblarni o'zgartirib bo'lmaydi.",
  },

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

  // --- notifications to students ---
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
  notifyCourseInvite: {
    ru: "Вам открыт доступ к курсу. Присоединяйтесь к группе курса: {link}",
    uz: "Sizga kursga ruxsat berildi. Kurs guruhiga qo'shiling: {link}",
  },

  // --- enrolment: phone, application form, trial ---
  applyAskPhone: {
    ru:
      "Чтобы записаться на курс «{course}», подтвердите номер телефона.\n\n" +
      "Нажмите кнопку ниже — Telegram отправит номер, на который зарегистрирован ваш аккаунт.",
    uz:
      "«{course}» kursiga yozilish uchun telefon raqamingizni tasdiqlang.\n\n" +
      "Quyidagi tugmani bosing — Telegram akkauntingiz ro'yxatdan o'tgan raqamni yuboradi.",
  },
  applySharePhoneButton: { ru: "📱 Отправить мой номер", uz: "📱 Raqamimni yuborish" },
  applyPhoneNotOwn: {
    ru: "Это чужой контакт. Нажмите кнопку «Отправить мой номер» — нужен номер вашего аккаунта.",
    uz: "Bu boshqa odamning kontakti. «Raqamimni yuborish» tugmasini bosing — o'z raqamingiz kerak.",
  },
  applyPhoneSaved: {
    ru: "Номер сохранён ✅\n\nТеперь заполните короткую анкету — нажмите кнопку ниже.",
    uz: "Raqam saqlandi ✅\n\nEndi qisqa anketani to'ldiring — quyidagi tugmani bosing.",
  },
  applyOpenFormButton: { ru: "📝 Заполнить анкету", uz: "📝 Anketani to'ldirish" },
  applyNoPendingCourse: {
    ru: "Спасибо! Но я не знаю, на какой курс вы записываетесь — откройте ссылку курса ещё раз.",
    uz: "Rahmat! Lekin qaysi kursga yozilayotganingizni bilmayman — kurs havolasini qayta oching.",
  },
  applyBlacklisted: {
    ru: "Запись на курс «{course}» для вас закрыта. Обратитесь к преподавателю.",
    uz: "«{course}» kursiga yozilish siz uchun yopiq. O'qituvchi bilan bog'laning.",
  },
  applyAlreadySubmitted: {
    ru: "Вы уже подали анкету на курс «{course}».",
    uz: "Siz «{course}» kursiga allaqachon anketa topshirgansiz.",
  },
  // --- staff notification group linking ---
  linkStaffGroupInstructions: {
    ru:
      "Готово. Теперь добавьте бота в группу администраторов и отправьте там команду:\n/link_{token}\n\n" +
      "После этого все уведомления платформы будут приходить в эту группу, а не в личные сообщения.",
    uz:
      "Tayyor. Endi botni adminlar guruhiga qo'shing va u yerda buyruqni yuboring:\n/link_{token}\n\n" +
      "Shundan so'ng platformaning barcha bildirishnomalari shaxsiy xabarlarga emas, shu guruhga keladi.",
  },
  staffGroupLinked: {
    ru:
      "✅ <b>Группа уведомлений подключена</b>\n" +
      "Сюда будут приходить все уведомления платформы.\n\n" +
      "Поиск по хештегам: #student_12 — история одного ученика, #course_3 — один курс, " +
      "{umbrella} — вся лента.",
    uz:
      "✅ <b>Bildirishnoma guruhi ulandi</b>\n" +
      "Platformaning barcha bildirishnomalari shu yerga keladi.\n\n" +
      "Xeshteg bo'yicha qidiruv: #student_12 — bitta o'quvchi tarixi, #course_3 — bitta kurs, " +
      "{umbrella} — butun lenta.",
  },
  staffGroupOnlyTeacher: {
    ru: "Подключить группу уведомлений может только преподаватель — владелец курсов.",
    uz: "Bildirishnoma guruhini faqat kurslar egasi — o'qituvchi ulay oladi.",
  },

  // --- staff alerts: headlines ---
  alertTitleApplication: { ru: "Новая анкета на курс", uz: "Kursga yangi anketa" },
  alertTitleInviteFailed: { ru: "Не удалось пригласить в группу", uz: "Guruhga taklif yuborilmadi" },
  alertTitleTrialExpired: { ru: "Пробный период закончился", uz: "Sinov muddati tugadi" },
  alertTitleAccessExpiring: { ru: "Доступ скоро истекает", uz: "Ruxsat muddati tugayapti" },
  alertTitleAccessExpired: { ru: "Доступ истёк", uz: "Ruxsat muddati tugadi" },
  alertTitleCertAttempt: { ru: "Сертификатная работа сдана", uz: "Sertifikat ishi topshirildi" },
  alertTitleUnreviewed: { ru: "Непроверенные домашние работы", uz: "Tekshirilmagan uy ishlari" },
  alertTitleBlacklisted: { ru: "Ученик заблокирован", uz: "O'quvchi bloklandi" },
  alertTitleRemoved: { ru: "Отчисление из группы", uz: "Guruhdan chiqarish" },

  // --- staff alerts: row labels ---
  alertRowStudent: { ru: "Ученик", uz: "O'quvchi" },
  alertRowCourse: { ru: "Курс", uz: "Kurs" },
  alertRowPhone: { ru: "Телефон", uz: "Telefon" },
  alertRowParentPhone: { ru: "Родители", uz: "Ota-ona" },
  alertRowAbout: { ru: "О себе", uz: "O'zi haqida" },
  alertRowInvite: { ru: "Приглашение", uz: "Taklif" },
  alertRowContext: { ru: "Момент", uz: "Holat" },
  alertRowLessons: { ru: "Уроки", uz: "Darslar" },
  alertRowState: { ru: "Состояние", uz: "Holati" },
  alertRowExpiresAt: { ru: "Истекает", uz: "Tugaydi" },
  alertRowExpiredAt: { ru: "Истёк", uz: "Tugagan" },
  alertRowExam: { ru: "Экзамен", uz: "Imtihon" },
  alertRowStatus: { ru: "Отметка", uz: "Belgi" },
  alertRowPending: { ru: "Ждут проверки", uz: "Tekshiruv kutmoqda" },
  alertRowSource: { ru: "Источник", uz: "Manba" },
  alertRowReason: { ru: "Причина", uz: "Sabab" },
  alertRowActor: { ru: "Кто нажал", uz: "Kim bosdi" },
  alertRowResult: { ru: "Результат", uz: "Natija" },

  // --- staff alerts: row values ---
  alertInviteSent: { ru: "ссылка на группу отправлена", uz: "guruh havolasi yuborildi" },
  alertInviteNotSent: { ru: "ссылку отправить не удалось", uz: "havola yuborilmadi" },
  alertContextApplication: { ru: "сразу после анкеты", uz: "anketadan keyin darhol" },
  alertContextAccessGranted: { ru: "при выдаче доступа", uz: "ruxsat berilganda" },
  alertLessonsOfFree: { ru: "{used} пройдено, бесплатных {free}", uz: "{used} o'tildi, bepul {free}" },
  alertStateFrozen: {
    ru: "доступ в приложении приостановлен, из группы не удалён",
    uz: "ilovadagi ruxsat to'xtatildi, guruhdan o'chirilmadi",
  },
  alertLate: { ru: "сдано после дедлайна", uz: "muddatdan keyin topshirilgan" },
  alertSourceAuto: { ru: "автоматически, по штрафным баллам", uz: "avtomatik, jarima ballari bo'yicha" },
  alertSourceManual: { ru: "вручную из дашборда", uz: "dashboarddan qo'lda" },
  alertRemovedOk: { ru: "удалён из группы", uz: "guruhdan o'chirildi" },
  alertRemovedFailed: { ru: "удалить не удалось ({reason})", uz: "o'chirib bo'lmadi ({reason})" },

  // --- staff alerts: what to do next ---
  alertActionApplication: {
    ru: "Проверьте анкету в разделе «Ученики». Пробный период уже идёт.",
    uz: "Anketani «O'quvchilar» bo'limida ko'ring. Sinov muddati boshlandi.",
  },
  alertActionInviteFailed: {
    ru: "Проверьте, что бот добавлен в группу курса и может создавать ссылки-приглашения.",
    uz: "Bot kurs guruhiga qo'shilganini va taklif havolasi yarata olishini tekshiring.",
  },
  alertActionTrialExpired: {
    ru: "Дождитесь оплаты или отчислите из группы в разделе «Отчисление».",
    uz: "To'lovni kuting yoki «Chiqarish» bo'limida guruhdan chiqaring.",
  },
  alertActionAccessExpiring: {
    ru: "Продлите доступ в карточке ученика, если оплата продолжается.",
    uz: "To'lov davom etsa, o'quvchi kartasida ruxsatni uzaytiring.",
  },
  alertActionAccessExpired: {
    ru: "Доступ сам не отзывается — продлите или отзовите его вручную.",
    uz: "Ruxsat o'zi bekor bo'lmaydi — uzaytiring yoki qo'lda bekor qiling.",
  },
  alertActionCertAttempt: {
    ru: "Откройте работу в разделе «Сертификат» и проверьте открытые задания.",
    uz: "Ishni «Sertifikat» bo'limida oching va ochiq topshiriqlarni tekshiring.",
  },
  alertActionUnreviewed: {
    ru: "Проверьте работы в разделе «Домашние задания».",
    uz: "Ishlarni «Uy vazifalari» bo'limida tekshiring.",
  },
  alertActionBlacklisted: {
    ru: "Ученик удалён из группы курса и потерял доступ к материалам.",
    uz: "O'quvchi kurs guruhidan o'chirildi va materiallarga ruxsatini yo'qotdi.",
  },
  alertActionRemoveFailed: {
    ru: "Удалите ученика из группы вручную — боту не хватает прав или ученик уже вышел.",
    uz: "O'quvchini guruhdan qo'lda o'chiring — bot huquqi yetmadi yoki o'quvchi allaqachon chiqib ketgan.",
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
