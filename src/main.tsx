import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { decryptMessage, encryptMessage, generateEncryptionKeyPair, encryptWithPublicKey, decryptWithPrivateKey, hashText } from '../lib/crypto.js';
import { compressText, decompressText } from '../lib/compression.js';
import { readChatStream } from '../lib/chat-stream.js';
import logoMark from './ramoosh-mark.svg';
import { translations, type Language } from './i18n';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatAvatar } from './ChatAvatar';
import '../style.css';
import './chat-markdown.css';

type Mode = 'encrypt' | 'decrypt' | 'hash' | 'compress' | 'decompress';
type CompressionAlgorithm = 'gzip' | 'deflate';
type Protocol = 'aes' | 'rsa';
type HashAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512';
type Theme = 'light' | 'dark';
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Entry = { id: number; kind: 'message'; message: ChatMessage; streaming?: boolean } | { id: number; kind: 'tool'; mode: Mode };

// SpeechRecognition is not yet part of TypeScript's standard DOM declarations.
type SpeechResult = { isFinal: boolean; [index: number]: { transcript: string } };
type SpeechResultEvent = { resultIndex: number; results: { length: number; [index: number]: SpeechResult } };
type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognizer; webkitSpeechRecognition?: new () => SpeechRecognizer };

function Mark() {
  return <img className="logo-mark" src={logoMark} alt="" />;
}

function CryptoTool({ t, initialMode = 'encrypt', idPrefix, requestId, onResult, animateModeSwitch = false }: { t: typeof translations[Language]; initialMode?: Mode; idPrefix: string; requestId?: number; onResult?: () => void; animateModeSwitch?: boolean }) {
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [protocol, setProtocolState] = useState<Protocol>('aes');
  const [hashAlgorithm, setHashAlgorithm] = useState<HashAlgorithm>('SHA-256');
  const [compressionAlgorithm, setCompressionAlgorithm] = useState<CompressionAlgorithm>('gzip');
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [generatingKeys, setGeneratingKeys] = useState(false);
  const [source, setSource] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<'encryptError' | 'decryptError' | 'rsaEncryptError' | 'rsaDecryptError' | 'keyGenerationError' | 'hashError' | 'compressionError' | 'decompressionError' | null>(null);
  const [working, setWorking] = useState(false);
  const [copyLabel, setCopyLabel] = useState<'copy' | 'copied' | 'copyManually'>('copy');
  const cryptoVersion = useRef(0);
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const modeContentRef = useRef<HTMLDivElement>(null);
  const modeAnimation = useRef<Animation | null>(null);
  const animateModeIncoming = useRef(false);
  const encrypting = mode === 'encrypt';
  const hashing = mode === 'hash';
  const compressing = mode === 'compress';
  const decompressing = mode === 'decompress';
  const compression = compressing || decompressing;

  useEffect(() => () => { cryptoVersion.current++; modeAnimation.current?.cancel(); }, []);
  useEffect(() => { if (result !== null) onResult?.(); }, [result]);
  useEffect(() => { if (requestId !== undefined) setMode(initialMode); }, [requestId]);

  useLayoutEffect(() => {
    if (!animateModeIncoming.current) return;
    animateModeIncoming.current = false;
    modeAnimation.current?.cancel();
    const content = modeContentRef.current;
    if (!content) return;
    const animation = content.animate(
      [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
    modeAnimation.current = animation;
    animation.onfinish = () => { modeAnimation.current = null; };
  }, [mode]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    modeAnimation.current?.cancel();
    animateModeIncoming.current = animateModeSwitch && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setMode(next);
  }

  function setMode(next: Mode) {
    cryptoVersion.current++;
    setModeState(next);
    setResult(null);
    setError(null);
    setWorking(false);
    setGeneratingKeys(false);
    setCopyLabel('copy');
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

  function changeCompressionAlgorithm(next: CompressionAlgorithm) {
    cryptoVersion.current++;
    setCompressionAlgorithm(next);
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

  async function handleCrypto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (decompressing && !source) return;
    if (!hashing && !compression && (!source || (protocol === 'aes' ? !passphrase : !(mode === 'encrypt' ? publicKey : privateKey)))) return;
    const version = ++cryptoVersion.current;
    const operation = mode;
    setError(null); setResult(null); setWorking(true);
    try {
      const value = operation === 'hash' ? await hashText(source, { algorithm: hashAlgorithm, format: 'hex' }) : operation === 'compress' ? await compressText(source, { algorithm: compressionAlgorithm }) : operation === 'decompress' ? await decompressText(source, { algorithm: compressionAlgorithm }) : protocol === 'aes'
        ? await (operation === 'encrypt' ? encryptMessage(source, passphrase) : decryptMessage(source, passphrase))
        : await (operation === 'encrypt' ? encryptWithPublicKey(source, JSON.parse(publicKey)) : decryptWithPrivateKey(source, JSON.parse(privateKey)));
      if (version === cryptoVersion.current) setResult(value);
    } catch (err) {
      console.error('Local cryptography failed:', err);
      if (version === cryptoVersion.current) setError(operation === 'hash' ? 'hashError' : operation === 'compress' ? 'compressionError' : operation === 'decompress' ? 'decompressionError' : protocol === 'rsa' ? (operation === 'decrypt' ? 'rsaDecryptError' : 'rsaEncryptError') : (operation === 'decrypt' ? 'decryptError' : 'encryptError'));
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

  return <section className="crypto-card" aria-labelledby={`${idPrefix}-tool-heading`}>
          <div className="crypto-card-head"><div><span className="local-label"><span/> {t.local}</span><h2 id={`${idPrefix}-tool-heading`}>{hashing ? t.hashMessage : compressing ? t.compressMessage : decompressing ? t.decompressMessage : encrypting ? t.encryptMessage : t.decryptMessage}</h2><p>{hashing ? t.hashDescription : compressing ? t.compressDescription : decompressing ? t.decompressDescription : protocol === 'aes' ? (encrypting ? t.encryptDescription : t.decryptDescription) : (encrypting ? t.rsaEncryptDescription : t.rsaDecryptDescription)}</p></div><span className="card-lock" aria-hidden="true">⌁</span></div>
          <div className="mode-switch" role="group" aria-label={t.operation}>{(['encrypt', 'decrypt', 'hash', 'compress', 'decompress'] as const).map(item => <button key={item} type="button" className={mode === item ? 'active' : ''} aria-pressed={mode === item} onClick={() => switchMode(item)}>{t[item]}</button>)}</div>
          <div ref={modeContentRef}>
          <form onSubmit={handleCrypto}>
            {hashing ? <><label htmlFor={`${idPrefix}-hash-algorithm`}>{t.hashAlgorithm}</label><select id={`${idPrefix}-hash-algorithm`} className="protocol-select" value={hashAlgorithm} onChange={event => changeHashAlgorithm(event.target.value as HashAlgorithm)}>{(['SHA-256', 'SHA-384', 'SHA-512'] as const).map(algorithm => <option key={algorithm} value={algorithm}>{algorithm}</option>)}</select><p className="field-hint">{t.hashHint}</p></> : compression ? <><label htmlFor={`${idPrefix}-compression-algorithm`}>{t.compressionAlgorithm}</label><select id={`${idPrefix}-compression-algorithm`} className="protocol-select" value={compressionAlgorithm} onChange={event => changeCompressionAlgorithm(event.target.value as CompressionAlgorithm)}><option value="gzip">GZIP</option><option value="deflate">DEFLATE</option></select><p className="field-hint">{t.compressionHint}</p></> : <>
            <label htmlFor={`${idPrefix}-protocol`}>{t.protocol}</label>
            <select id={`${idPrefix}-protocol`} className="protocol-select" value={protocol} onChange={event => setProtocol(event.target.value as Protocol)}>
              <option value="aes">{t.aesProtocol}</option><option value="rsa">{t.rsaProtocol}</option>
            </select>
            <p className="field-hint">{protocol === 'aes' ? t.aesHint : t.rsaHint}</p></>}
            <label htmlFor={`${idPrefix}-source`}>{hashing || compressing ? t.hashInput : decompressing ? t.compressedText : encrypting ? t.originalMessage : t.encryptedMessage}</label><textarea id={`${idPrefix}-source`} dir="auto" value={source} onChange={event => changeSource(event.target.value)} placeholder={hashing ? t.hashPlaceholder : compressing ? t.compressPlaceholder : decompressing ? t.compressedPlaceholder : encrypting ? t.encryptPlaceholder : t.decryptPlaceholder} required={!hashing && !compressing}/>
            {!hashing && !compression && (protocol === 'aes' ? <><div className="field-title"><label htmlFor={`${idPrefix}-passphrase`}>{t.passphrase}</label><span>{t.browserOnly}</span></div><div className="password-field"><input id={`${idPrefix}-passphrase`} type={showPassword ? 'text' : 'password'} value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder={encrypting ? t.choosePassphrase : t.enterPassphrase} autoComplete="new-password" required/><button type="button" aria-label={showPassword ? t.hidePassphrase : t.showPassphrase} onClick={() => setShowPassword(!showPassword)}>{showPassword ? t.hide : t.show}</button></div><p className="field-hint">{t.passphraseHint}</p></> : <>
              <div className="field-title"><label htmlFor={`${idPrefix}-rsa-key`}>{encrypting ? t.publicKey : t.privateKey}</label><span>{t.browserOnly}</span></div>
              <textarea id={`${idPrefix}-rsa-key`} className="key-field" dir="ltr" value={encrypting ? publicKey : privateKey} onChange={event => encrypting ? setPublicKey(event.target.value) : setPrivateKey(event.target.value)} placeholder={encrypting ? t.publicKeyPlaceholder : t.privateKeyPlaceholder} spellCheck={false} disabled={generatingKeys} required/>
              <p className="field-hint">{encrypting ? t.publicKeyHint : t.privateKeyHint}</p>
              <button type="button" className="secondary-button" disabled={generatingKeys || working} onClick={generateKeys}>{generatingKeys ? t.generatingKeys : t.generateKeys}</button>
              {publicKey && privateKey && <details className="generated-keys"><summary>{t.viewKeys}</summary><label htmlFor={`${idPrefix}-generated-public-key`}>{t.publicKey}</label><textarea id={`${idPrefix}-generated-public-key`} dir="ltr" readOnly value={publicKey}/><label htmlFor={`${idPrefix}-generated-private-key`}>{t.privateKey}</label><textarea id={`${idPrefix}-generated-private-key`} dir="ltr" readOnly value={privateKey}/><p className="field-hint">{t.keySafetyHint}</p></details>}
            </>)}
            <button type="submit" className="primary-button" disabled={working || generatingKeys}>{hashing ? t.hashMessage : compressing ? t.compressMessage : decompressing ? t.decompressMessage : encrypting ? t.encryptMessage : t.decryptMessage}</button>
          </form>
          {result !== null && <div className="result-area"><div className="result-head"><label htmlFor={`${idPrefix}-result`}>{hashing ? t.hashResult : compressing ? t.compressedText : decompressing ? t.hashInput : encrypting ? t.encryptedMessage : t.originalMessage}</label><button type="button" onClick={copyResult}>{t[copyLabel]}</button></div><textarea id={`${idPrefix}-result`} dir={hashing || compressing || encrypting ? "ltr" : "auto"} ref={resultRef} readOnly value={result}/><p>{hashing ? t.hashResultHint : compressing ? t.compressedResultHint : decompressing ? t.decompressedResultHint : encrypting ? (protocol === 'aes' ? t.encryptedHint : t.rsaEncryptedHint) : t.decryptedHint}</p></div>}<p className="error" role="alert">{error && t[error]}</p>
          </div>
        </section>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => document.documentElement.lang === 'en' ? 'en' : 'fa');
  const t = translations[language];
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const themeChosen = useRef(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [view, setView] = useState<'chat' | 'manual'>('chat');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const recognition = useRef<SpeechRecognizer | null>(null);
  const SpeechRecognition = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  const history = useRef<ChatMessage[]>([]);
  const controller = useRef<AbortController | null>(null);
  const conversationVersion = useRef(0);
  const nextId = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const languageAnimation = useRef<Animation | null>(null);
  const languageSwitching = useRef(false);
  const previousLanguage = useRef(language);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const chatViewRef = useRef<HTMLElement>(null);
  const manualViewRef = useRef<HTMLElement>(null);
  const viewAnimation = useRef<Animation | null>(null);
  const viewSwitching = useRef(false);
  const animateIncoming = useRef(false);

  function cancelRecognition() {
    const active = recognition.current;
    recognition.current = null;
    if (active) {
      active.onresult = null; active.onerror = null; active.onend = null;
      active.abort();
    }
    setListening(false);
  }

  function toggleVoice() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    if (!SpeechRecognition) return;
    setVoiceError(false);
    try {
      const active = new SpeechRecognition();
      recognition.current = active;
      active.lang = language === 'fa' ? 'fa-IR' : 'en-US';
      active.continuous = true;
      active.interimResults = false;
      let nextResult = 0;
      active.onresult = event => {
        if (recognition.current !== active) return;
        let transcript = '';
        for (let index = Math.max(event.resultIndex, nextResult); index < event.results.length; index++) {
          const result = event.results[index];
          if (!result.isFinal) break;
          transcript += result[0].transcript;
          nextResult = index + 1;
        }
        const text = transcript.trim();
        if (text) setInput(current => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${text}`.slice(0, 2000));
      };
      active.onerror = () => { if (recognition.current === active) setVoiceError(true); };
      active.onend = () => { if (recognition.current === active) { recognition.current = null; setListening(false); } };
      active.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setVoiceError(true);
    }
  }

  useEffect(() => () => {
    const active = recognition.current;
    recognition.current = null;
    if (active) { active.onresult = null; active.onerror = null; active.onend = null; active.abort(); }
  }, []);

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
    cancelRecognition();
    setVoiceError(false);
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

  function switchView(next: 'chat' | 'manual') {
    if (next === view || viewSwitching.current) return;
    cancelRecognition();
    setVoiceError(false);
    const current = view === 'chat' ? chatViewRef.current : manualViewRef.current;
    if (!current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setView(next);
      return;
    }
    viewSwitching.current = true;
    const animation = current.animate(
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-24px)' }],
      { duration: 200, easing: 'ease-in', fill: 'forwards' },
    );
    viewAnimation.current = animation;
    animation.onfinish = () => {
      animateIncoming.current = true;
      setView(next);
    };
  }

  useLayoutEffect(() => {
    if (!animateIncoming.current) return;
    animateIncoming.current = false;
    viewAnimation.current?.cancel();
    const incoming = view === 'chat' ? chatViewRef.current : manualViewRef.current;
    if (!incoming) { viewSwitching.current = false; return; }
    const animation = incoming.animate(
      [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 260, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
    viewAnimation.current = animation;
    animation.onfinish = () => { viewAnimation.current = null; viewSwitching.current = false; };
  }, [view]);

  useEffect(() => () => { viewAnimation.current?.cancel(); }, []);

  function scrollToLatest() { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }
  useEffect(() => { if (view === 'chat') scrollToLatest(); }, [entries, view]);
  useEffect(() => () => { conversationVersion.current++; controller.current?.abort(); }, []);

  function addMessage(message: ChatMessage) {
    setEntries(current => [...current, { id: ++nextId.current, kind: 'message', message }]);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busyRef.current) return;
    cancelRecognition();
    setVoiceError(false);
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
      if (data.action === 'encrypt' || data.action === 'decrypt' || data.action === 'hash' || data.action === 'compress' || data.action === 'decompress') {
        const mode = data.action;
        setEntries(current => [...current.filter(entry => entry.kind !== 'tool'), { id: ++nextId.current, kind: 'tool', mode }]);
      }
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
    cancelRecognition(); setVoiceError(false);
    conversationVersion.current++; controller.current?.abort(); controller.current = null;
    viewAnimation.current?.cancel(); viewAnimation.current = null; viewSwitching.current = false; animateIncoming.current = false;
    history.current = []; busyRef.current = false; setBusy(false); setEntries([]); setInput(''); setView('chat'); inputRef.current?.focus();
  }

  return <div className="app-shell" ref={shellRef}>
    <header className="topbar">
      <a className="brand" href="/" aria-label={t.home}><span className="brand-mark" aria-hidden="true"><Mark /></span><span className="brand-name">{t.brand}<small>{t.brandSecondary}</small></span></a>
      <div className="header-actions">
        <span className="header-caption">{t.caption}</span><span className="header-divider"/>
        <button className="manual-tools-toggle" type="button" aria-label={view === 'chat' ? t.manualTools : t.backToChat} title={view === 'chat' ? t.manualTools : t.backToChat} onClick={() => switchView(view === 'chat' ? 'manual' : 'chat')}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{view === 'chat' ? <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></> : <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z"/>}</svg><span>{view === 'chat' ? t.manualTools : t.backToChat}</span></button>
        <button className="language-toggle" type="button" aria-label={t.switchLanguage} title={t.switchLanguage} onClick={toggleLanguage}>{t.languageButton}</button>
        <button className="theme-toggle" type="button" aria-label={theme === 'dark' ? t.lightTheme : t.darkTheme} title={theme === 'dark' ? t.light : t.dark} onClick={toggleTheme}>{theme === 'dark' ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg> : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.3 15.5A8.5 8.5 0 0 1 8.5 3.7 8.5 8.5 0 1 0 20.3 15.5Z"/></svg>}</button>
        <button className="new-chat" type="button" aria-label={t.newChatLabel} onClick={newChat}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>{t.newChat}</span></button>
      </div>
    </header>
    <main ref={chatViewRef} className={`chat-layout${entries.length === 0 ? ' chat-layout-empty' : ''}`} aria-label={t.chatLabel} hidden={view !== 'chat'}>
      <div className="messages" role="log" aria-live="polite" ref={scrollRef}>
        {entries.length === 0 && <div className="welcome"><div className="welcome-emblem"><Mark /></div><h1>{t.welcomeTitle}</h1></div>}
        {entries.map(entry => entry.kind === 'message' ? <div className={`message ${entry.message.role}`} key={entry.id}><ChatAvatar role={entry.message.role} /><div><div className="message-meta">{entry.message.role === 'assistant' ? t.brand : t.you}</div><div className={`bubble${entry.message.role === 'assistant' ? ' markdown' : ''}`} dir="auto" aria-live={entry.streaming ? 'off' : undefined}>{entry.message.role === 'assistant' && entry.message.content ? <ChatMarkdown content={entry.message.content} /> : entry.message.content || (entry.streaming ? t.thinking : '')}</div></div></div> : <CryptoTool key="chat-tool" t={t} initialMode={entry.mode} requestId={entry.id} idPrefix="chat" onResult={scrollToLatest} />)}
      </div>
      <div className="composer-wrap"><div className="composer-inner"><form className="chat-form" onSubmit={sendMessage}><label className="sr-only" htmlFor="chat-input">{t.chatInput}</label><input id="chat-input" dir={input ? "auto" : language === "fa" ? "rtl" : "ltr"} ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder={t.chatPlaceholder} maxLength={2000} autoComplete="off"/>{SpeechRecognition && <button className="voice-button" type="button" onClick={toggleVoice} aria-label={listening ? t.stopVoice : t.startVoice} title={listening ? t.stopVoice : t.startVoice} aria-pressed={listening}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg></button>}<button type="submit" disabled={busy} aria-label={t.send}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button></form>{voiceError && <p className="voice-error" role="alert">{t.voiceError}</p>}<p className="chat-warning"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.2 3.1 7.5 7.5 9.5 4.4-2 7.5-5.3 7.5-9.5V6L12 3Z"/><path d="M12 8v4M12 16h.01"/></svg> {t.warning}</p></div></div>
    </main>
    <main ref={manualViewRef} className="manual-layout" hidden={view !== 'manual'}>
      <div className="manual-intro"><h1>{t.manualToolsTitle}</h1><p>{t.manualToolsDescription}</p></div>
      <CryptoTool t={t} idPrefix="manual" animateModeSwitch />
    </main>
    <footer className="site-credit"><a href="https://github.com/AliKarimi1384" target="_blank" rel="noopener noreferrer">{language === 'fa' ? 'توسعه یافته توسط علی کریمی' : 'Developed by Ali Karimi'}</a></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
