import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { decryptMessage, encryptMessage } from '../lib/crypto.js';
import { readChatStream } from '../lib/chat-stream.js';
import logoMark from './ramoosh-mark.svg';
import { translations, type Language } from './i18n';
import { VaultWorkspace } from './VaultWorkspace';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatAvatar } from './ChatAvatar';
import { vaultTranslations } from './vault-i18n';
import '../style.css';
import './chat-markdown.css';

type Mode = 'encrypt' | 'decrypt';
type Theme = 'light' | 'dark';
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Entry = { id: number; kind: 'message'; message: ChatMessage; streaming?: boolean } | { id: number; kind: 'tool' };

function Mark() {
  return <img className="logo-mark" src={logoMark} alt="" />;
}

function LockIcon({ open = false }: { open?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d={open ? 'M8 10V7a4 4 0 0 1 7.5-2M12 14v2' : 'M8 10V7a4 4 0 0 1 8 0v3M12 14v2'}/></svg>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => document.documentElement.lang === 'en' ? 'en' : 'fa');
  const t = translations[language];
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const themeChosen = useRef(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showVault, setShowVault] = useState(false);
  const [mode, setModeState] = useState<Mode>('encrypt');
  const [source, setSource] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<'encryptError' | 'decryptError' | null>(null);
  const [working, setWorking] = useState(false);
  const [copyLabel, setCopyLabel] = useState<'copy' | 'copied' | 'copyManually'>('copy');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const controller = useRef<AbortController | null>(null);
  const conversationVersion = useRef(0);
  const cryptoVersion = useRef(0);
  const nextId = useRef(0);
  const layoutRef = useRef<HTMLElement>(null);
  const previousLanguage = useRef(language);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const encrypting = mode === 'encrypt';
  const vaultCopy = vaultTranslations[language];
  const workspaceLabel = showVault ? vaultCopy.chat : vaultCopy.title;

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    document.title = t.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
    try { localStorage.setItem('ramoosh-language', language); } catch { /* The language still works for this session. */ }

    const changed = previousLanguage.current !== language;
    previousLanguage.current = language;
    if (!changed || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = layoutRef.current?.animate(
      [{ opacity: 0.72, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 240, easing: 'ease-out' },
    );
    return () => animation?.cancel();
  }, [language, t]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f8f5' : '#0b1113');
  }, [theme]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: light)');
    function followSystem(event: MediaQueryListEvent) {
      if (themeChosen.current) return;
      try {
        const saved = localStorage.getItem('ramoosh-theme');
        if (saved === 'light' || saved === 'dark') return;
      } catch { /* Keep following the system when storage is unavailable. */ }
      setTheme(event.matches ? 'light' : 'dark');
    }
    preference.addEventListener('change', followSystem);
    return () => preference.removeEventListener('change', followSystem);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    themeChosen.current = true;
    setTheme(next);
    try { localStorage.setItem('ramoosh-theme', next); } catch { /* The theme still works for this session. */ }
  }

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [entries, result]);
  useEffect(() => () => { conversationVersion.current++; cryptoVersion.current++; controller.current?.abort(); }, []);

  function setMode(next: Mode) {
    cryptoVersion.current++;
    setModeState(next);
    setResult(null);
    setError(null);
    setWorking(false);
    setCopyLabel('copy');
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
    setError(null); setResult(null); setWorking(true);
    try {
      const value = await (operation === 'encrypt' ? encryptMessage(source, passphrase) : decryptMessage(source, passphrase));
      if (version === cryptoVersion.current) setResult(value);
    } catch (err) {
      console.error('Local cryptography failed:', err);
      if (version === cryptoVersion.current) setError(operation === 'decrypt' ? 'decryptError' : 'encryptError');
    } finally {
      if (version === cryptoVersion.current) setWorking(false);
    }
  }

  async function copyResult() {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopyLabel('copied');
      window.setTimeout(() => setCopyLabel('copy'), 2000);
    } catch {
      resultRef.current?.focus(); resultRef.current?.select(); setCopyLabel('copyManually');
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
    const replyId = ++nextId.current;
    setEntries(current => [...current, { id: replyId, kind: 'message', message: { role: 'assistant', content: '' }, streaming: true }]);
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.current.slice(-20), language, stream: true }), signal: request.signal });
      const data = await readChatStream(response, (delta: string) => {
        if (version !== conversationVersion.current) return;
        setEntries(current => current.map(entry => entry.id === replyId && entry.kind === 'message' ? { ...entry, message: { ...entry.message, content: entry.message.content + delta } } : entry));
      });
      if (version !== conversationVersion.current) return;
      const reply: ChatMessage = { role: 'assistant', content: data.reply };
      history.current.push(reply);
      setEntries(current => current.map(entry => entry.id === replyId && entry.kind === 'message' ? { ...entry, message: reply, streaming: false } : entry));
      if (data.action === 'encrypt' || data.action === 'decrypt') setMode(data.action);
    } catch (err) {
      if (version !== conversationVersion.current) return;
      history.current.pop();
      setEntries(current => current.map(entry => entry.id === replyId && entry.kind === 'message' ? { ...entry, message: { ...entry.message, content: entry.message.content ? `${entry.message.content}\n\n${t.chatError}` : t.chatError }, streaming: false } : entry));
      console.error('Chat request failed:', err);
    } finally {
      if (version === conversationVersion.current) { busyRef.current = false; setBusy(false); controller.current = null; inputRef.current?.focus(); }
    }
  }

  function newChat() {
    conversationVersion.current++; cryptoVersion.current++; controller.current?.abort(); controller.current = null;
    history.current = []; busyRef.current = false; setBusy(false); setEntries([]); setModeState('encrypt');
    setInput(''); setSource(''); setPassphrase(''); setShowPassword(false); setResult(null); setError(null); setWorking(false); setCopyLabel('copy'); inputRef.current?.focus();
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label={t.home}><span className="brand-mark" aria-hidden="true"><Mark /></span><span className="brand-name">{t.brand}<small>{t.brandSecondary}</small></span></a>
      <div className="header-actions">
        <span className="header-caption">{t.caption}</span><span className="header-divider"/>
        <button className="language-toggle" type="button" aria-label={t.switchLanguage} title={t.switchLanguage} onClick={() => setLanguage(language === 'fa' ? 'en' : 'fa')}>{t.languageButton}</button>
        <button className="theme-toggle" type="button" aria-label={theme === 'dark' ? t.lightTheme : t.darkTheme} title={theme === 'dark' ? t.light : t.dark} onClick={toggleTheme}>{theme === 'dark' ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg> : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.3 15.5A8.5 8.5 0 0 1 8.5 3.7 8.5 8.5 0 1 0 20.3 15.5Z"/></svg>}</button>
        <button className="new-chat workspace-switch" type="button" aria-label={workspaceLabel} title={workspaceLabel} onClick={() => setShowVault(!showVault)}>
          {showVault ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5h14v10H10l-5 4z"/><path d="M8 9h8m-8 3h5"/></svg> : <LockIcon/>}
          <span>{workspaceLabel}</span>
        </button>
        {!showVault && <button className="new-chat" type="button" aria-label={t.newChatLabel} onClick={newChat}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>{t.newChat}</span></button>}
      </div>
    </header>
    {showVault ? <VaultWorkspace language={language} /> : <main className="chat-layout" aria-label={t.chatLabel} ref={layoutRef}>
      <div className="messages" role="log" aria-live="polite" ref={scrollRef}>
        {entries.length === 0 && <section className="welcome" aria-labelledby="welcome-title">
          <div className="welcome-emblem" aria-hidden="true"><span className="emblem-orbit orbit-one"/><span className="emblem-orbit orbit-two"/><Mark /></div>
          <div className="welcome-kicker"><span/> {t.kicker}</div><h1 id="welcome-title">{t.welcome}<span>.</span></h1><p>{t.welcomeLine1}<br/>{t.welcomeLine2}</p>
          <div className="suggestions" aria-label={t.quickStart}>
            {(['encrypt', 'decrypt'] as const).map(item => <button type="button" key={item} onClick={() => setMode(item)}><span className="suggestion-icon"><LockIcon open={item === 'decrypt'}/></span><span><strong>{item === 'encrypt' ? t.encryptMessage : t.decryptMessage}</strong><small>{item === 'encrypt' ? t.encryptSuggestion : t.decryptSuggestion}</small></span><span className="suggestion-plus">+</span></button>)}
            <button type="button" className="vault-suggestion" onClick={() => setShowVault(true)}><span className="suggestion-icon"><LockIcon/></span><span><strong>{vaultCopy.title}</strong><small>{vaultCopy.intro}</small></span><span className="suggestion-plus">+</span></button>
          </div>
        </section>}
        {entries.map(entry => entry.kind === 'message' ? <div className={`message ${entry.message.role}`} key={entry.id}><ChatAvatar role={entry.message.role} /><div><div className="message-meta">{entry.message.role === 'assistant' ? t.brand : t.you}</div><div className={`bubble${entry.message.role === 'assistant' ? ' markdown' : ''}`} dir="auto" aria-live={entry.streaming ? 'off' : undefined}>{entry.message.role === 'assistant' && entry.message.content ? <ChatMarkdown content={entry.message.content} /> : entry.message.content || (entry.streaming ? t.thinking : '')}</div></div></div> : <section className="crypto-card" aria-labelledby="tool-heading" key={entry.id}>
          <div className="crypto-card-head"><div><span className="local-label"><span/> {t.local}</span><h2 id="tool-heading">{encrypting ? t.encryptMessage : t.decryptMessage}</h2><p>{encrypting ? t.encryptDescription : t.decryptDescription}</p></div><span className="card-lock" aria-hidden="true">⌁</span></div>
          <div className="mode-switch" role="group" aria-label={t.operation}>{(['encrypt', 'decrypt'] as const).map(item => <button key={item} type="button" className={mode === item ? 'active' : ''} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === 'encrypt' ? t.encrypt : t.decrypt}</button>)}</div>
          <form onSubmit={handleCrypto}><label htmlFor="source">{encrypting ? t.originalMessage : t.encryptedMessage}</label><textarea id="source" dir="auto" value={source} onChange={event => setSource(event.target.value)} placeholder={encrypting ? t.encryptPlaceholder : t.decryptPlaceholder} required/><div className="field-title"><label htmlFor="passphrase">{t.passphrase}</label><span>{t.browserOnly}</span></div><div className="password-field"><input id="passphrase" type={showPassword ? 'text' : 'password'} value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder={encrypting ? t.choosePassphrase : t.enterPassphrase} autoComplete="new-password" required/><button type="button" aria-label={showPassword ? t.hidePassphrase : t.showPassphrase} onClick={() => setShowPassword(!showPassword)}>{showPassword ? t.hide : t.show}</button></div><p className="field-hint">{t.passphraseHint}</p><button type="submit" className="primary-button" disabled={working}>{encrypting ? t.encryptMessage : t.decryptMessage}</button></form>
          {result !== null && <div className="result-area"><div className="result-head"><label htmlFor="result">{encrypting ? t.encryptedMessage : t.originalMessage}</label><button type="button" onClick={copyResult}>{t[copyLabel]}</button></div><textarea id="result" dir={encrypting ? "ltr" : "auto"} ref={resultRef} readOnly value={result}/><p>{encrypting ? t.encryptedHint : t.decryptedHint}</p></div>}<p className="error" role="alert">{error && t[error]}</p>
        </section>)}
      </div>
      <div className="composer-wrap"><div className="composer-inner"><form className="chat-form" onSubmit={sendMessage}><label className="sr-only" htmlFor="chat-input">{t.chatInput}</label><input id="chat-input" dir="auto" ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder={t.chatPlaceholder} maxLength={2000} autoComplete="off"/><span className="composer-hint">{t.yourMessage}</span><button type="submit" disabled={busy} aria-label={t.send}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button></form><p className="chat-warning"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.2 3.1 7.5 7.5 9.5 4.4-2 7.5-5.3 7.5-9.5V6L12 3Z"/><path d="M12 8v4M12 16h.01"/></svg> {t.warning}</p></div></div>
    </main>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
