import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { decryptMessage, encryptMessage } from '../lib/crypto.js';
import logoMark from './ramoosh-mark.svg';
import '../style.css';

type Mode = 'encrypt' | 'decrypt';
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Entry = { id: number; kind: 'message'; message: ChatMessage } | { id: number; kind: 'tool' };

function Mark() {
  return <img className="logo-mark" src={logoMark} alt="" />;
}

function LockIcon({ open = false }: { open?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d={open ? 'M8 10V7a4 4 0 0 1 7.5-2M12 14v2' : 'M8 10V7a4 4 0 0 1 8 0v3M12 14v2'}/></svg>;
}

function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setModeState] = useState<Mode>('encrypt');
  const [source, setSource] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [copyLabel, setCopyLabel] = useState('کپی کردن');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const controller = useRef<AbortController | null>(null);
  const conversationVersion = useRef(0);
  const cryptoVersion = useRef(0);
  const nextId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const encrypting = mode === 'encrypt';

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [entries, result]);
  useEffect(() => () => { conversationVersion.current++; cryptoVersion.current++; controller.current?.abort(); }, []);

  function setMode(next: Mode) {
    cryptoVersion.current++;
    setModeState(next);
    setResult(null);
    setError('');
    setWorking(false);
    setCopyLabel('کپی کردن');
    setEntries(current => [...current.filter(entry => entry.kind !== 'tool'), { id: ++nextId.current, kind: 'tool' }]);
  }

  function addMessage(message: ChatMessage) {
    setEntries(current => [...current, { id: ++nextId.current, kind: 'message', message }]);
  }

  async function handleCrypto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || !passphrase) return;
    const version = ++cryptoVersion.current;
    const operation = mode;
    setError(''); setResult(null); setWorking(true);
    try {
      const value = await (operation === 'encrypt' ? encryptMessage(source, passphrase) : decryptMessage(source, passphrase));
      if (version === cryptoVersion.current) setResult(value);
    } catch (err) {
      console.error('Local cryptography failed:', err);
      if (version === cryptoVersion.current) setError(operation === 'decrypt' ? 'رمزگشایی انجام نشد. پیام و عبارت عبور را بررسی کن.' : 'رمزگذاری انجام نشد. لطفاً مرورگر و ورودی‌ها را بررسی کن.');
    } finally {
      if (version === cryptoVersion.current) setWorking(false);
    }
  }

  async function copyResult() {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopyLabel('کپی شد ✓');
      window.setTimeout(() => setCopyLabel('کپی کردن'), 2000);
    } catch {
      resultRef.current?.focus(); resultRef.current?.select(); setCopyLabel('متن را کپی کن');
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busyRef.current) return;
    const version = conversationVersion.current;
    busyRef.current = true; setBusy(true); setInput('');
    const userMessage: ChatMessage = { role: 'user', content: text };
    history.current.push(userMessage); addMessage(userMessage);
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.current.slice(-20) }), signal: request.signal });
      const data = await response.json();
      if (version !== conversationVersion.current) return;
      if (!response.ok || typeof data.reply !== 'string') throw new Error(data.error || 'خطا در ارتباط با دستیار');
      const reply: ChatMessage = { role: 'assistant', content: data.reply };
      history.current.push(reply); addMessage(reply);
      if (data.action === 'encrypt' || data.action === 'decrypt') setMode(data.action);
    } catch (err) {
      if (version !== conversationVersion.current) return;
      history.current.pop();
      addMessage({ role: 'assistant', content: 'اتصال به دستیار برقرار نشد. دوباره تلاش کن؛ ابزار رمزنگاری محلی همچنان در دسترس است.' });
      console.error('Chat request failed:', err);
    } finally {
      if (version === conversationVersion.current) { busyRef.current = false; setBusy(false); controller.current = null; inputRef.current?.focus(); }
    }
  }

  function newChat() {
    conversationVersion.current++; cryptoVersion.current++; controller.current?.abort(); controller.current = null;
    history.current = []; busyRef.current = false; setBusy(false); setEntries([]); setModeState('encrypt');
    setInput(''); setSource(''); setPassphrase(''); setShowPassword(false); setResult(null); setError(''); setWorking(false); setCopyLabel('کپی کردن'); inputRef.current?.focus();
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="رموش، صفحه اصلی"><span className="brand-mark" aria-hidden="true"><Mark /></span><span className="brand-name">رموش <small>RAMOOSH</small></span></a>
      <div className="header-actions"><span className="header-caption">دستیار رمزنگاری شما</span><span className="header-divider"/><button className="new-chat" type="button" aria-label="شروع گفت‌وگوی تازه" onClick={newChat}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>گفت‌وگوی تازه</span></button></div>
    </header>
    <main className="chat-layout" aria-label="گفت‌وگو با رموش">
      <div className="messages" role="log" aria-live="polite" ref={scrollRef}>
        {entries.length === 0 && <section className="welcome" aria-labelledby="welcome-title">
          <div className="welcome-emblem" aria-hidden="true"><span className="emblem-orbit orbit-one"/><span className="emblem-orbit orbit-two"/><Mark /></div>
          <div className="welcome-kicker"><span/> فضای امن، فکر روشن</div><h1 id="welcome-title">سلام، من رموشم<span>.</span></h1><p>کنارتم تا دنیای رمزنگاری رو ساده‌تر کنی.<br/>از کجا شروع کنیم؟</p>
          <div className="suggestions" aria-label="شروع سریع">{(['encrypt', 'decrypt'] as const).map(item => <button type="button" key={item} onClick={() => setMode(item)}><span className="suggestion-icon"><LockIcon open={item === 'decrypt'}/></span><span><strong>{item === 'encrypt' ? 'رمزگذاری پیام' : 'رمزگشایی پیام'}</strong><small>{item === 'encrypt' ? 'یک پیام امن بساز' : 'یک پیام را باز کن'}</small></span><span className="suggestion-plus">+</span></button>)}</div>
        </section>}
        {entries.map(entry => entry.kind === 'message' ? <div className={`message ${entry.message.role}`} key={entry.id}><span className="avatar" aria-hidden="true">{entry.message.role === 'assistant' ? '✳' : 'ش'}</span><div><div className="message-meta">{entry.message.role === 'assistant' ? 'رموش' : 'شما'}</div><div className="bubble">{entry.message.content}</div></div></div> : <section className="crypto-card" aria-labelledby="tool-heading" key={entry.id}>
          <div className="crypto-card-head"><div><span className="local-label"><span/> پردازش در مرورگر شما</span><h2 id="tool-heading">{encrypting ? 'رمزگذاری پیام' : 'رمزگشایی پیام'}</h2><p>{encrypting ? 'پیام و عبارت عبور را وارد کن. این اطلاعات در مرورگر خودت می‌مانند.' : 'پیام رمزگذاری‌شده و عبارت عبور آن را وارد کن.'}</p></div><span className="card-lock" aria-hidden="true">⌁</span></div>
          <div className="mode-switch" role="group" aria-label="نوع عملیات">{(['encrypt', 'decrypt'] as const).map(item => <button key={item} type="button" className={mode === item ? 'active' : ''} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === 'encrypt' ? 'رمزگذاری' : 'رمزگشایی'}</button>)}</div>
          <form onSubmit={handleCrypto}><label htmlFor="source">{encrypting ? 'پیام اصلی' : 'پیام رمزگذاری‌شده'}</label><textarea id="source" value={source} onChange={event => setSource(event.target.value)} placeholder={encrypting ? 'پیامی که می‌خواهی رمزگذاری کنی...' : 'پیام رمزگذاری‌شده را اینجا وارد کن...'} required/><div className="field-title"><label htmlFor="passphrase">عبارت عبور</label><span>فقط در مرورگر شما</span></div><div className="password-field"><input id="passphrase" type={showPassword ? 'text' : 'password'} value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder={encrypting ? 'یک عبارت عبور انتخاب کن' : 'عبارت عبور پیام را وارد کن'} autoComplete="new-password" required/><button type="button" aria-label={showPassword ? 'پنهان کردن عبارت عبور' : 'نمایش عبارت عبور'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'پنهان' : 'نمایش'}</button></div><p className="field-hint">برای رمزگشایی به همین عبارت نیاز داری؛ آن را در جایی امن نگه دار.</p><button type="submit" className="primary-button" disabled={working}>{encrypting ? 'رمزگذاری پیام' : 'رمزگشایی پیام'}</button></form>
          {result !== null && <div className="result-area"><div className="result-head"><label htmlFor="result">{encrypting ? 'پیام رمزگذاری‌شده' : 'پیام اصلی'}</label><button type="button" onClick={copyResult}>{copyLabel}</button></div><textarea id="result" ref={resultRef} readOnly value={result}/><p>{encrypting ? 'پیام رمزگذاری‌شده و عبارت عبور را جداگانه و از راهی امن به گیرنده برسان.' : 'پیام بازشده تنها در همین مرورگر نمایش داده می‌شود.'}</p></div>}<p className="error" role="alert">{error}</p>
        </section>)}
      </div>
      <div className="composer-wrap"><div className="composer-inner"><form className="chat-form" onSubmit={sendMessage}><label className="sr-only" htmlFor="chat-input">پیام به دستیار</label><input id="chat-input" ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder="از رموش بپرس..." maxLength={2000} autoComplete="off"/><span className="composer-hint">پیام شما</span><button type="submit" disabled={busy} aria-label="ارسال پیام"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button></form><p className="chat-warning"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.2 3.1 7.5 7.5 9.5 4.4-2 7.5-5.3 7.5-9.5V6L12 3Z"/><path d="M12 8v4M12 16h.01"/></svg> متن گفت‌وگو به هوش مصنوعی ارسال می‌شود؛ اطلاعات محرمانه را اینجا ننویسید.</p></div></div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
