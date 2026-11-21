import { resilientFetch } from '../lib/http-client.js';
import { actionFor, algorithmFor, streamChat } from '../lib/llm-stream.js';

const INSTRUCTIONS_FA = `تو دستیار فارسی «رموش» هستی. در مورد رمزگذاری، رمزگشایی، هش، فشرده‌سازی و بازکردن فشرده‌سازی پیام به اختصار راهنمایی کن.
وقتی کاربر می‌خواهد پیامی را رمزگذاری، رمزگشایی، هش، فشرده یا از حالت فشرده خارج کند ابزار مربوط را فراخوانی کن.
ابزار هیچ ورودی محرمانه‌ای ندارد؛ متن، رمز پیام و کلیدها بعداً فقط در مرورگر دریافت می‌شوند.
در فرم می‌توان بین AES با رمز پیام و RSA-OAEP با کلید عمومی و خصوصی انتخاب کرد. اگر کاربر روش یا الگوریتم پشتیبانی‌شده‌ای را مشخص کرد، آن را در آرگومان algorithm ابزار بفرست؛ در غیر این صورت null بفرست. روش پشتیبانی‌نشده را با روش دیگری جایگزین نکن و در عوض توضیح بده.
هرگز از کاربر نخواه متن، رمز پیام یا کلید خصوصی را در چت وارد کند. اگر درخواست مبهم بود، سؤال کوتاهی بپرس.`;

const INSTRUCTIONS_EN = `You are Ramoosh, an English-speaking assistant. Give brief guidance about encrypting, decrypting, hashing, compressing, and decompressing messages.
When the user wants to encrypt, decrypt, hash, compress, or decompress a message, call the corresponding tool.
The tool takes no confidential input; the message, passphrase, and keys are collected later only in the browser.
The form offers AES with a passphrase and RSA-OAEP with public and private keys. Pass the explicitly requested supported method or algorithm in the tool’s algorithm argument; use null when none is specified. Do not substitute a supported algorithm for an unsupported request; explain the limitation instead.
Never ask the user to enter a message, passphrase, or private key in the chat. If the request is ambiguous, ask a short question. Respond in English.`;

const translations = {
  fa: {
    instructions: INSTRUCTIONS_FA,
    method: 'روش درخواست پشتیبانی نمی‌شود.',
    invalid: 'پیام‌های ارسالی معتبر نیستند.',
    missingKey: 'کلید سرویس هوش مصنوعی تنظیم نشده است.',
    connection: 'ارتباط با سرویس هوش مصنوعی برقرار نشد. دوباره تلاش کنید.',
    invalidReply: 'پاسخ معتبری از سرویس دریافت نشد. دوباره تلاش کنید.',
    encrypt: 'ابزار رمزگذاری آماده است. اطلاعات را در فرم وارد کنید.',
    decrypt: 'ابزار رمزگشایی آماده است. اطلاعات را در فرم وارد کنید.',
    hash: 'ابزار هش آماده است. متن را در فرم وارد کنید.',
    compress: 'ابزار فشرده‌سازی آماده است. متن را در فرم وارد کنید.',
    decompress: 'ابزار بازکردن فشرده‌سازی آماده است. دادهٔ فشرده را در فرم وارد کنید.',
  },
  en: {
    instructions: INSTRUCTIONS_EN,
    method: 'Request method not supported.',
    invalid: 'The submitted messages are invalid.',
    missingKey: 'The AI service key is not configured.',
    connection: 'Could not connect to the AI service. Please try again.',
    invalidReply: 'The service returned an invalid response. Please try again.',
    encrypt: 'The encryption tool is ready. Enter the details in the form.',
    decrypt: 'The decryption tool is ready. Enter the details in the form.',
    hash: 'The hashing tool is ready. Enter the text in the form.',
    compress: 'The compression tool is ready. Enter the text in the form.',
    decompress: 'The decompression tool is ready. Enter the compressed data in the form.',
  },
};

const toolDefinitions = [
  ['encrypt_message', 'Open the local message encryption tool.', ['aes', 'rsa']],
  ['decrypt_message', 'Open the local message decryption tool.', ['aes', 'rsa']],
  ['open_hash_tool', 'Open the local text hashing tool without sending the text to the server.', ['SHA-256', 'SHA-384', 'SHA-512']],
  ['open_compress_tool', 'Open the local text compression tool without sending the text to the server.', ['gzip', 'deflate']],
  ['open_decompress_tool', 'Open the local text decompression tool without sending the data to the server.', ['gzip', 'deflate']],
];
const tools = toolDefinitions.map(([name, description, algorithms]) => ({
  type: 'function', name, description,
  parameters: { type: 'object', properties: { algorithm: { type: ['string', 'null'], enum: [...algorithms, null], description: 'The explicitly requested algorithm, or null if unspecified.' } }, required: ['algorithm'], additionalProperties: false },
  strict: true,
}));

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
  const groqKey = process.env.GROQ_API_KEY || (process.env.OPENAI_API_KEY?.startsWith('gsk_') ? process.env.OPENAI_API_KEY : null);
  const openAiKey = process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('gsk_') ? process.env.OPENAI_API_KEY : null;

  if (!groqKey && !openAiKey) {
    return res.status(503).json({ error: t.missingKey });
  }

  const streaming = req.body?.stream === true;
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on?.('close', onClose);
  const signal = AbortSignal.any([AbortSignal.timeout(25000), controller.signal]);

  const useGroq = Boolean(groqKey && (process.env.LLM_PROVIDER === 'groq' || !openAiKey || process.env.GROQ_API_KEY));

  if (useGroq) {
    const groqModel = process.env.GROQ_MODEL || (process.env.OPENAI_API_KEY?.startsWith('gsk_') && process.env.OPENAI_MODEL ? process.env.OPENAI_MODEL : 'qwen/qwen3.8-27b');
    const groqBaseUrl = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
    const groqTools = tools.map(({ name, description, parameters }) => ({
      type: 'function', function: { name, description, parameters },
    }));

    try {
      const response = await resilientFetch(`${groqBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            { role: 'system', content: t.instructions },
            ...messages,
          ],
          tools: groqTools,
          tool_choice: 'auto',
          max_tokens: 300,
          temperature: 0.1,
          ...(streaming ? { stream: true } : {}),
        }),
        signal,
      });

      if (!response.ok) return res.status(502).json({ error: t.connection });
      if (streaming) return await streamChat(response, res, 'groq', t);
      const data = await response.json();
      const choice = data.choices?.[0];
      const toolCall = choice?.message?.tool_calls?.find(c =>
        actionFor(c.function?.name)
      );
      const action = actionFor(toolCall?.function?.name);
      const algorithm = algorithmFor(action, toolCall?.function?.arguments);
      const text = choice?.message?.content?.trim();
      const reply = action ? t[action] : text;
      if (!reply) return res.status(502).json({ error: t.invalidReply });
      return res.status(200).json({ reply, action, algorithm });
    } catch {
      return res.status(502).json({ error: t.connection });
    }
  }

  try {
    const response = await resilientFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: t.instructions, input: messages, tools, parallel_tool_calls: false, max_output_tokens: 300, store: false, ...(streaming ? { stream: true } : {}) }),
      signal,
    });
    if (!response.ok) return res.status(502).json({ error: t.connection });
    if (streaming) return await streamChat(response, res, 'openai', t);
    const data = await response.json();
    const call = data.output?.find(item => item.type === 'function_call' && actionFor(item.name));
    const action = actionFor(call?.name);
    const algorithm = algorithmFor(action, call?.arguments);
    const text = data.output?.flatMap(item => item.type === 'message' ? item.content || [] : []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
    const reply = action ? t[action] : text;
    if (!reply) return res.status(502).json({ error: t.invalidReply });
    return res.status(200).json({ reply, action, algorithm });
  } catch {
    return res.status(502).json({ error: t.connection });
  }
}


