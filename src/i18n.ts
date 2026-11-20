export type Language = 'fa' | 'en';

export const translations = {
  fa: {
    home: 'رموش، صفحه اصلی', brand: 'رموش', brandSecondary: 'RAMOOSH', caption: 'دستیار رمزنگاری شما',
    switchLanguage: 'Switch to English', languageButton: 'EN', lightTheme: 'تغییر به حالت روشن', darkTheme: 'تغییر به حالت تیره', light: 'حالت روشن', dark: 'حالت تیره',
    newChat: 'گفت‌وگوی تازه', newChatLabel: 'شروع گفت‌وگوی تازه', chatLabel: 'گفت‌وگو با رموش',
    kicker: 'فضای امن، فکر روشن', welcome: 'سلام، من رموشم', welcomeLine1: 'کنارتم تا دنیای رمزنگاری رو ساده‌تر کنی.', welcomeLine2: 'از کجا شروع کنیم؟', quickStart: 'شروع سریع',
    encryptMessage: 'رمزگذاری پیام', decryptMessage: 'رمزگشایی پیام', encryptSuggestion: 'یک پیام امن بساز', decryptSuggestion: 'یک پیام را باز کن',
    you: 'شما', userAvatar: 'ش', local: 'پردازش در مرورگر شما', encryptDescription: 'پیام و عبارت عبور را وارد کن. این اطلاعات در مرورگر خودت می‌مانند.', decryptDescription: 'پیام رمزگذاری‌شده و عبارت عبور آن را وارد کن.',
    operation: 'نوع عملیات', encrypt: 'رمزگذاری', decrypt: 'رمزگشایی', originalMessage: 'پیام اصلی', encryptedMessage: 'پیام رمزگذاری‌شده',
    encryptPlaceholder: 'پیامی که می‌خواهی رمزگذاری کنی...', decryptPlaceholder: 'پیام رمزگذاری‌شده را اینجا وارد کن...', passphrase: 'عبارت عبور', browserOnly: 'فقط در مرورگر شما',
    choosePassphrase: 'یک عبارت عبور انتخاب کن', enterPassphrase: 'عبارت عبور پیام را وارد کن', hidePassphrase: 'پنهان کردن عبارت عبور', showPassphrase: 'نمایش عبارت عبور', hide: 'پنهان', show: 'نمایش',
    passphraseHint: 'برای رمزگشایی به همین عبارت نیاز داری؛ آن را در جایی امن نگه دار.', copy: 'کپی کردن', copied: 'کپی شد ✓', copyManually: 'متن را کپی کن',
    encryptedHint: 'پیام رمزگذاری‌شده و عبارت عبور را جداگانه و از راهی امن به گیرنده برسان.', decryptedHint: 'پیام بازشده تنها در همین مرورگر نمایش داده می‌شود.',
    decryptError: 'رمزگشایی انجام نشد. پیام و عبارت عبور را بررسی کن.', encryptError: 'رمزگذاری انجام نشد. لطفاً مرورگر و ورودی‌ها را بررسی کن.',
    chatError: 'اتصال به دستیار برقرار نشد. دوباره تلاش کن؛ ابزار رمزنگاری محلی همچنان در دسترس است.', chatInput: 'پیام به دستیار', chatPlaceholder: 'از رموش بپرس...', yourMessage: 'پیام شما', send: 'ارسال پیام',
    warning: 'متن گفت‌وگو به هوش مصنوعی ارسال می‌شود؛ اطلاعات محرمانه را اینجا ننویسید.', title: 'رموش | دستیار رمزنگاری', description: 'رموش، فضای ساده‌ای برای گفت‌وگو درباره رمزنگاری و پردازش محلی پیام‌ها',
  },
  en: {
    home: 'Ramoosh, home', brand: 'Ramoosh', brandSecondary: 'رموش', caption: 'Your cryptography assistant',
    switchLanguage: 'تغییر زبان به فارسی', languageButton: 'فارسی', lightTheme: 'Switch to light mode', darkTheme: 'Switch to dark mode', light: 'Light mode', dark: 'Dark mode',
    newChat: 'New chat', newChatLabel: 'Start a new chat', chatLabel: 'Chat with Ramoosh',
    kicker: 'A safe space for clear thinking', welcome: 'Hello, I’m Ramoosh', welcomeLine1: 'I’m here to make cryptography simpler.', welcomeLine2: 'Where shall we start?', quickStart: 'Quick start',
    encryptMessage: 'Encrypt a message', decryptMessage: 'Decrypt a message', encryptSuggestion: 'Create a secure message', decryptSuggestion: 'Open a message',
    you: 'You', userAvatar: 'Y', local: 'Processed in your browser', encryptDescription: 'Enter your message and passphrase. They stay in your browser.', decryptDescription: 'Enter the encrypted message and its passphrase.',
    operation: 'Operation', encrypt: 'Encrypt', decrypt: 'Decrypt', originalMessage: 'Original message', encryptedMessage: 'Encrypted message',
    encryptPlaceholder: 'Enter the message you want to encrypt...', decryptPlaceholder: 'Enter the encrypted message here...', passphrase: 'Passphrase', browserOnly: 'Only in your browser',
    choosePassphrase: 'Choose a passphrase', enterPassphrase: 'Enter the message passphrase', hidePassphrase: 'Hide passphrase', showPassphrase: 'Show passphrase', hide: 'Hide', show: 'Show',
    passphraseHint: 'You will need this passphrase to decrypt the message; keep it somewhere safe.', copy: 'Copy', copied: 'Copied ✓', copyManually: 'Copy the text',
    encryptedHint: 'Send the encrypted message and passphrase to the recipient separately and securely.', decryptedHint: 'The decrypted message is shown only in this browser.',
    decryptError: 'Decryption failed. Check the message and passphrase.', encryptError: 'Encryption failed. Check your browser and inputs.',
    chatError: 'Could not connect to the assistant. Try again; the local encryption tool is still available.', chatInput: 'Message to the assistant', chatPlaceholder: 'Ask Ramoosh...', yourMessage: 'Your message', send: 'Send message',
    warning: 'Chat messages are sent to AI; do not enter confidential information here.', title: 'Ramoosh | Cryptography assistant', description: 'Ramoosh is a simple space to discuss cryptography and process messages locally.',
  },
} satisfies Record<Language, Record<string, string>>;

