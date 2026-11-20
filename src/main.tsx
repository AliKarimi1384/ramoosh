import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { decryptMessage, encryptMessage, generateEncryptionKeyPair, encryptWithPublicKey, decryptWithPrivateKey, hashText } from '../lib/crypto.js';
import { readChatStream } from '../lib/chat-stream.js';
import logoMark from './ramoosh-mark.svg';
import { translations, type Language } from './i18n';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatAvatar } from './ChatAvatar';
import '../style.css';
import './chat-markdown.css';

type Mode = 'encrypt' | 'decrypt' | 'hash';
type Protocol = 'aes' | 'rsa';
type HashAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512';
type Theme = 'light' | 'dark';
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Entry = { id: number; kind: 'message'; message: ChatMessage; streaming?: boolean } | { id: number; kind: 'tool' };

function Mark() {
  return <img className="logo-mark" src={logoMark} alt="" />;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => document.documentElement.lang === 'en' ? 'en' : 'fa');
  const t = translations[language];
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const themeChosen = useRef(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setModeState] = useState<Mode>('encrypt');
  const [protocol, setProtocolState] = useState<Protocol>('aes');
  const [hashAlgorithm, setHashAlgorithm] = useState<HashAlgorithm>('SHA-256');
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [generatingKeys, setGeneratingKeys] = useState(false);
  const [source, setSource] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<'encryptError' | 'decryptError' | 'rsaEncryptError' | 'rsaDecryptError' | 'keyGenerationError' | 'hashError' | null>(null);
  const [working, setWorking] = useState(false);
  const [copyLabel, setCopyLabel] = useState<'copy' | 'copied' | 'copyManually'>('copy');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const controller = useRef<AbortController | null>(null);
  const conversationVersion = useRef(0);
  const cryptoVersion = useRef(0);
  const nextId = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const languageAnimation = useRef<Animation | null>(null);
  const languageSwitching = useRef(false);
  const previousLanguage = useRef(language);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const encrypting = mode === 'encrypt';
  const hashing = mode === 'hash';

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    document.title = t.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
    try { localStorage.setItem('ramoosh-language', language); } catch { /* The language still works for this session. */ }

    const changed = previousLanguage.current !== language;
    previousLanguage.current = language;
    if (!changed || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    languageAnimation.current?.cancel();
    const animation = shellRef.current?.animate(
      [{ opacity: 0.55 }, { opacity: 1 }],
      { duration: 240, easing: 'ease-out' },
    );
    languageAnimation.current = animation ?? null;
    if (animation) animation.onfinish = () => { if (languageAnimation.current === animation) languageAnimation.current = null; };
  }, [language, t]);

  useEffect(() => () => { languageAnimation.current?.cancel(); }, []);

  function toggleLanguage() {
    if (languageSwitching.current) return;
    const shell = shellRef.current;
    if (!shell || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLanguage(current => current === 'fa' ? 'en' : 'fa');
      return;
    }
    const opacity = getComputedStyle(shell).opacity;
    languageAnimation.current?.cancel();
    languageSwitching.current = true;
    const animation = shell.animate([{ opacity }, { opacity: 0.55 }], { duration: 120, easing: 'ease-in', fill: 'forwards' });
    languageAnimation.current = animation;
    animation.onfinish = () => {
      languageSwitching.current = false;
      setLanguage(current => current === 'fa' ? 'en' : 'fa');
    };
  }

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
    setGeneratingKeys(false);
    setCopyLabel('copy');
    setEntries(current => [...current.filter(entry => entry.kind !== 'tool'), { id: ++nextId.current, kind: 'tool' }]);
  }

  function setProtocol(next: Protocol) {
    cryptoVersion.current++;
    setProtocolState(next);
    setResult(null); setError(null); setWorking(false); setGeneratingKeys(false); setCopyLabel('copy');
  }

  function changeHashAlgorithm(next: HashAlgorithm) {
    cryptoVersion.current++;
    setHashAlgorithm(next);
    setResult(null); setError(null); setWorking(false); setCopyLabel('copy');
  }

  function changeSource(next: string) {
    if (working) { cryptoVersion.current++; setWorking(false); }
    setSource(next); setResult(null); setError(null); setCopyLabel('copy');
  }

  async function generateKeys() {
    if ((publicKey || privateKey) && !window.confirm(t.replaceKeysConfirm)) return;
    const version = ++cryptoVersion.current;
    setGeneratingKeys(true); setWorking(false); setError(null); setResult(null);
    try {
      const keys = await generateEncryptionKeyPair();
      if (version === cryptoVersion.current) {
        setPublicKey(JSON.stringify(keys.publicKey, null, 2));
        setPrivateKey(JSON.stringify(keys.privateKey, null, 2));
      }
    } catch (err) {
      console.error('Key generation failed:', err);
      if (version === cryptoVersion.current) setError('keyGenerationError');
    } finally {
      if (version === cryptoVersion.current) setGeneratingKeys(false);
    }
  }

  function addMessage(message: ChatMessage) {
    setEntries(current => [...current, { id: ++nextId.current, kind: 'message', message }]);
  }

  async function handleCrypto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hashing && (!source || (protocol === 'aes' ? !passphrase : !(mode === 'encrypt' ? publicKey : privateKey)))) return;
    const version = ++cryptoVersion.current;
    const operation = mode;
    setError(null); setResult(null); setWorking(true);
    try {
      const value = operation === 'hash' ? await hashText(source, { algorithm: hashAlgorithm, format: 'hex' }) : protocol === 'aes'
        ? await (operation === 'encrypt' ? encryptMessage(source, passphrase) : decryptMessage(source, passphrase))
        : await (operation === 'encrypt' ? encryptWithPublicKey(source, JSON.parse(publicKey)) : decryptWithPrivateKey(source, JSON.parse(privateKey)));
      if (version === cryptoVersion.current) setResult(value);
    } catch (err) {
      console.error('Local cryptography failed:', err);
      if (version === cryptoVersion.current) setError(operation === 'hash' ? 'hashError' : protocol === 'rsa' ? (operation === 'decrypt' ? 'rsaDecryptError' : 'rsaEncryptError') : (operation === 'decrypt' ? 'decryptError' : 'encryptError'));
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
      if (data.action === 'encrypt' || data.action === 'decrypt' || data.action === 'hash') setMode(data.action);
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
    history.current = []; busyRef.current = false; setBusy(false); setEntries([]); setModeState('encrypt'); setProtocolState('aes'); setHashAlgorithm('SHA-256'); setPublicKey(''); setPrivateKey(''); setGeneratingKeys(false);
    setInput(''); setSource(''); setPassphrase(''); setShowPassword(false); setResult(null); setError(null); setWorking(false); setCopyLabel('copy'); inputRef.current?.focus();
  }

  return <div className="app-shell" ref={shellRef}>
    <header className="topbar">
      <a className="brand" href="/" aria-label={t.home}><span className="brand-mark" aria-hidden="true"><Mark /></span><span className="brand-name">{t.brand}<small>{t.brandSecondary}</small></span></a>
      <div className="header-actions">
        <span className="header-caption">{t.caption}</span><span className="header-divider"/>
        <button className="language-toggle" type="button" aria-label={t.switchLanguage} title={t.switchLanguage} onClick={toggleLanguage}>{t.languageButton}</button>
        <button className="theme-toggle" type="button" aria-label={theme === 'dark' ? t.lightTheme : t.darkTheme} title={theme === 'dark' ? t.light : t.dark} onClick={toggleTheme}>{theme === 'dark' ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg> : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.3 15.5A8.5 8.5 0 0 1 8.5 3.7 8.5 8.5 0 1 0 20.3 15.5Z"/></svg>}</button>
        <button className="new-chat" type="button" aria-label={t.newChatLabel} onClick={newChat}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>{t.newChat}</span></button>
      </div>
    </header>
    <main className={`chat-layout${entries.length === 0 ? ' chat-layout-empty' : ''}`} aria-label={t.chatLabel}>
      <div className="messages" role="log" aria-live="polite" ref={scrollRef}>
        {entries.length === 0 && <div className="welcome"><div className="welcome-emblem"><Mark /></div><h1>{t.welcomeTitle}</h1></div>}
        {entries.map(entry => entry.kind === 'message' ? <div className={`message ${entry.message.role}`} key={entry.id}><ChatAvatar role={entry.message.role} /><div><div className="message-meta">{entry.message.role === 'assistant' ? t.brand : t.you}</div><div className={`bubble${entry.message.role === 'assistant' ? ' markdown' : ''}`} dir="auto" aria-live={entry.streaming ? 'off' : undefined}>{entry.message.role === 'assistant' && entry.message.content ? <ChatMarkdown content={entry.message.content} /> : entry.message.content || (entry.streaming ? t.thinking : '')}</div></div></div> : <section className="crypto-card" aria-labelledby="tool-heading" key={entry.id}>
          <div className="crypto-card-head"><div><span className="local-label"><span/> {t.local}</span><h2 id="tool-heading">{hashing ? t.hashMessage : encrypting ? t.encryptMessage : t.decryptMessage}</h2><p>{hashing ? t.hashDescription : protocol === 'aes' ? (encrypting ? t.encryptDescription : t.decryptDescription) : (encrypting ? t.rsaEncryptDescription : t.rsaDecryptDescription)}</p></div><span className="card-lock" aria-hidden="true">⌁</span></div>
          <div className="mode-switch" role="group" aria-label={t.operation}>{(['encrypt', 'decrypt', 'hash'] as const).map(item => <button key={item} type="button" className={mode === item ? 'active' : ''} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === 'encrypt' ? t.encrypt : item === 'decrypt' ? t.decrypt : t.hash}</button>)}</div>
          <form onSubmit={handleCrypto}>
            {hashing ? <><label htmlFor="hash-algorithm">{t.hashAlgorithm}</label><select id="hash-algorithm" className="protocol-select" value={hashAlgorithm} onChange={event => changeHashAlgorithm(event.target.value as HashAlgorithm)}>{(['SHA-256', 'SHA-384', 'SHA-512'] as const).map(algorithm => <option key={algorithm} value={algorithm}>{algorithm}</option>)}</select><p className="field-hint">{t.hashHint}</p></> : <>
            <label htmlFor="protocol">{t.protocol}</label>
            <select id="protocol" className="protocol-select" value={protocol} onChange={event => setProtocol(event.target.value as Protocol)}>
              <option value="aes">{t.aesProtocol}</option><option value="rsa">{t.rsaProtocol}</option>
            </select>
            <p className="field-hint">{protocol === 'aes' ? t.aesHint : t.rsaHint}</p></>}
            <label htmlFor="source">{hashing ? t.hashInput : encrypting ? t.originalMessage : t.encryptedMessage}</label><textarea id="source" dir="auto" value={source} onChange={event => changeSource(event.target.value)} placeholder={hashing ? t.hashPlaceholder : encrypting ? t.encryptPlaceholder : t.decryptPlaceholder} required={!hashing}/>
            {!hashing && (protocol === 'aes' ? <><div className="field-title"><label htmlFor="passphrase">{t.passphrase}</label><span>{t.browserOnly}</span></div><div className="password-field"><input id="passphrase" type={showPassword ? 'text' : 'password'} value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder={encrypting ? t.choosePassphrase : t.enterPassphrase} autoComplete="new-password" required/><button type="button" aria-label={showPassword ? t.hidePassphrase : t.showPassphrase} onClick={() => setShowPassword(!showPassword)}>{showPassword ? t.hide : t.show}</button></div><p className="field-hint">{t.passphraseHint}</p></> : <>
              <div className="field-title"><label htmlFor="rsa-key">{encrypting ? t.publicKey : t.privateKey}</label><span>{t.browserOnly}</span></div>
              <textarea id="rsa-key" className="key-field" dir="ltr" value={encrypting ? publicKey : privateKey} onChange={event => encrypting ? setPublicKey(event.target.value) : setPrivateKey(event.target.value)} placeholder={encrypting ? t.publicKeyPlaceholder : t.privateKeyPlaceholder} spellCheck={false} disabled={generatingKeys} required/>
              <p className="field-hint">{encrypting ? t.publicKeyHint : t.privateKeyHint}</p>
              <button type="button" className="secondary-button" disabled={generatingKeys || working} onClick={generateKeys}>{generatingKeys ? t.generatingKeys : t.generateKeys}</button>
              {publicKey && privateKey && <details className="generated-keys"><summary>{t.viewKeys}</summary><label htmlFor="generated-public-key">{t.publicKey}</label><textarea id="generated-public-key" dir="ltr" readOnly value={publicKey}/><label htmlFor="generated-private-key">{t.privateKey}</label><textarea id="generated-private-key" dir="ltr" readOnly value={privateKey}/><p className="field-hint">{t.keySafetyHint}</p></details>}
            </>)}
            <button type="submit" className="primary-button" disabled={working || generatingKeys}>{hashing ? t.hashMessage : encrypting ? t.encryptMessage : t.decryptMessage}</button>
          </form>
          {result !== null && <div className="result-area"><div className="result-head"><label htmlFor="result">{hashing ? t.hashResult : encrypting ? t.encryptedMessage : t.originalMessage}</label><button type="button" onClick={copyResult}>{t[copyLabel]}</button></div><textarea id="result" dir={hashing || encrypting ? "ltr" : "auto"} ref={resultRef} readOnly value={result}/><p>{hashing ? t.hashResultHint : encrypting ? (protocol === 'aes' ? t.encryptedHint : t.rsaEncryptedHint) : t.decryptedHint}</p></div>}<p className="error" role="alert">{error && t[error]}</p>
        </section>)}
      </div>
      <div className="composer-wrap"><div className="composer-inner"><form className="chat-form" onSubmit={sendMessage}><label className="sr-only" htmlFor="chat-input">{t.chatInput}</label><input id="chat-input" dir={input ? "auto" : language === "fa" ? "rtl" : "ltr"} ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder={t.chatPlaceholder} maxLength={2000} autoComplete="off"/><button type="submit" disabled={busy} aria-label={t.send}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button></form><p className="chat-warning"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.2 3.1 7.5 7.5 9.5 4.4-2 7.5-5.3 7.5-9.5V6L12 3Z"/><path d="M12 8v4M12 16h.01"/></svg> {t.warning}</p></div></div>
    </main>
    <footer className="site-credit"><a href="https://github.com/AliKarimi1384" target="_blank" rel="noopener noreferrer">{language === 'fa' ? 'توسعه یافته توسط علی کریمی' : 'Developed by Ali Karimi'}</a></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
