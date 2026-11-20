const INSTRUCTIONS_FA = `تو دستیار فارسی «رموش» هستی. در مورد رمزگذاری و رمزگشایی پیام به اختصار راهنمایی کن.
وقتی کاربر می‌خواهد پیامی را رمزگذاری یا رمزگشایی کند ابزار مربوط را فراخوانی کن.
ابزار هیچ ورودی محرمانه‌ای ندارد؛ متن و گذرواژه بعداً فقط در مرورگر دریافت می‌شوند.
هرگز از کاربر نخواه متن یا گذرواژه را در چت وارد کند. اگر درخواست مبهم بود، سؤال کوتاهی بپرس.`;

const INSTRUCTIONS_EN = `You are Ramoosh, an English-speaking assistant. Give brief guidance about encrypting and decrypting messages.
When the user wants to encrypt or decrypt a message, call the corresponding tool.
The tool takes no confidential input; the message and passphrase are collected later only in the browser.
Never ask the user to enter a message or passphrase in the chat. If the request is ambiguous, ask a short question. Respond in English.`;

const translations = {
  fa: {
    instructions: INSTRUCTIONS_FA,
    method: 'روش درخواست پشتیبانی نمی‌شود.',
    invalid: 'پیام‌های ارسالی معتبر نیستند.',
    missingKey: 'کلید سرویس هوش مصنوعی تنظیم نشده است.',
    connection: 'ارتباط با سرویس هوش مصنوعی برقرار نشد. دوباره تلاش کنید.',
    invalidReply: 'پاسخ معتبری از سرویس دریافت نشد. دوباره تلاش کنید.',
    encrypt: 'ابزار رمزگذاری آماده است. متن و گذرواژه را در بخش امن وارد کنید.',
    decrypt: 'ابزار رمزگشایی آماده است. پیام رمزگذاری‌شده و گذرواژه را در بخش امن وارد کنید.',
  },
  en: {
    instructions: INSTRUCTIONS_EN,
    method: 'Request method not supported.',
    invalid: 'The submitted messages are invalid.',
    missingKey: 'The AI service key is not configured.',
    connection: 'Could not connect to the AI service. Please try again.',
    invalidReply: 'The service returned an invalid response. Please try again.',
    encrypt: 'The encryption tool is ready. Enter your message and passphrase in the secure form.',
    decrypt: 'The decryption tool is ready. Enter the encrypted message and passphrase in the secure form.',
  },
};

const tools = [
  { type: 'function', name: 'encrypt_message', description: 'Open the local message encryption tool.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
  { type: 'function', name: 'decrypt_message', description: 'Open the local message decryption tool.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
];

export default async function handler(req, res) {
  const t = translations[req.body?.language === 'en' ? 'en' : 'fa'];
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: t.method });
  }
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20 ||
      messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 2000) ||
      messages.at(-1).role !== 'user') {
    return res.status(400).json({ error: t.invalid });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: t.missingKey });
  }
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: t.instructions, input: messages, tools, parallel_tool_calls: false, max_output_tokens: 300, store: false }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return res.status(502).json({ error: t.connection });
    const data = await response.json();
    const call = data.output?.find(item => item.type === 'function_call' && ['encrypt_message', 'decrypt_message'].includes(item.name));
    const action = call ? (call.name === 'encrypt_message' ? 'encrypt' : 'decrypt') : null;
    const text = data.output?.flatMap(item => item.type === 'message' ? item.content || [] : []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
    const reply = action ? t[action] : text;
    if (!reply) return res.status(502).json({ error: t.invalidReply });
    return res.status(200).json({ reply, action });
  } catch {
    return res.status(502).json({ error: t.connection });
  }
}
