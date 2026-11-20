const INSTRUCTIONS = `تو دستیار فارسی «رموش» هستی. در مورد رمزگذاری و رمزگشایی پیام به اختصار راهنمایی کن.
وقتی کاربر می‌خواهد پیامی را رمزگذاری یا رمزگشایی کند ابزار مربوط را فراخوانی کن.
ابزار هیچ ورودی محرمانه‌ای ندارد؛ متن و گذرواژه بعداً فقط در مرورگر دریافت می‌شوند.
هرگز از کاربر نخواه متن یا گذرواژه را در چت وارد کند. اگر درخواست مبهم بود، سؤال کوتاهی بپرس.`;

const tools = [
  { type: 'function', name: 'encrypt_message', description: 'Open the local message encryption tool.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
  { type: 'function', name: 'decrypt_message', description: 'Open the local message decryption tool.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'روش درخواست پشتیبانی نمی‌شود.' });
  }
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20 ||
      messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 2000) ||
      messages.at(-1).role !== 'user') {
    return res.status(400).json({ error: 'پیام‌های ارسالی معتبر نیستند.' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'کلید سرویس هوش مصنوعی تنظیم نشده است.' });
  }
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: INSTRUCTIONS, input: messages, tools, parallel_tool_calls: false, max_output_tokens: 300, store: false }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return res.status(502).json({ error: 'ارتباط با سرویس هوش مصنوعی برقرار نشد. دوباره تلاش کنید.' });
    const data = await response.json();
    const call = data.output?.find(item => item.type === 'function_call' && ['encrypt_message', 'decrypt_message'].includes(item.name));
    const action = call ? (call.name === 'encrypt_message' ? 'encrypt' : 'decrypt') : null;
    const text = data.output?.flatMap(item => item.type === 'message' ? item.content || [] : []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
    const reply = action === 'encrypt' ? 'ابزار رمزگذاری آماده است. متن و گذرواژه را در بخش امن وارد کنید.' : action === 'decrypt' ? 'ابزار رمزگشایی آماده است. پیام رمزگذاری‌شده و گذرواژه را در بخش امن وارد کنید.' : text;
    if (!reply) return res.status(502).json({ error: 'پاسخ معتبری از سرویس دریافت نشد. دوباره تلاش کنید.' });
    return res.status(200).json({ reply, action });
  } catch {
    return res.status(502).json({ error: 'ارتباط با سرویس هوش مصنوعی برقرار نشد. دوباره تلاش کنید.' });
  }
}
