import { useEffect, useRef, useState, type FormEvent } from 'react';
import { VaultKeystore } from '../lib/vault/keystore.js';
import { MAX_VAULT_JSON_LENGTH } from '../lib/vault/package.js';
import { MAX_VAULT_ALIAS_LENGTH, MAX_VAULT_INTENT_LENGTH } from '../lib/vault/protocol.js';
import { CryptoToolExecutor } from '../lib/vault/session.js';
import type { Language } from './i18n';
import { vaultTranslations } from './vault-i18n';

type Copy = (typeof vaultTranslations)[Language];
type KeyAlgorithm = 'RSA-OAEP-256' | 'X25519' | 'ECDSA-P256' | 'Ed25519';
type KeyLabel = { id: string; alias: string; algo: KeyAlgorithm; owned: boolean };
type VaultPlan = {
  recipient_ids: string[];
  signer_id: string | null;
  cipher: string;
  key_wrap: string;
  expires_in_minutes: number | null;
  max_views: number | null;
};
type Opened = { signature: 'verified' | 'untrusted' | 'unsigned' } &
  ({ kind: 'text' } | { kind: 'file'; name: string; url: string });
type ErrorCode = keyof Copy['errors'];
type Panel = 'create' | 'open' | 'keys';
type Operation = 'payload' | 'plan' | 'seal' | 'open';
const KEY_ALGORITHMS: KeyAlgorithm[] = ['RSA-OAEP-256', 'X25519', 'ECDSA-P256', 'Ed25519'];

function errorCode(error: unknown, copy: Copy, fallback: ErrorCode): ErrorCode | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'cancelled') return null;
  return typeof code === 'string' && Object.hasOwn(copy.errors, code) ? code as ErrorCode : fallback;
}

function saveJson(json: string, name: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function policyDuration(minutes: number | null, language: Language, t: Copy) {
  if (minutes === null) return t.none;
  const units = minutes % 1440 === 0 ? [1440, t.days] as const : minutes % 60 === 0 ? [60, t.hours] as const : [1, t.minutes] as const;
  return `${new Intl.NumberFormat(language).format(minutes / units[0])} ${units[1]}`;
}

function PlanSummary({ plan, keys, language, copy }: { plan: VaultPlan; keys: KeyLabel[]; language: Language; copy: Copy }) {
  function renderKey(id: string) {
    const key = keys.find(item => item.id === id);
    return key ? <span title={id}><bdi>{key.alias}</bdi> <small><bdi>{key.algo}</bdi></small></span> : <code dir="ltr">{id}</code>;
  }

  return <dl className="vault-plan">
    <div><dt>{copy.recipients}</dt><dd><ul>{plan.recipient_ids.map(id => <li key={id}>{renderKey(id)}</li>)}</ul></dd></div>
    <div><dt>{copy.cipher}</dt><dd><bdi>{plan.cipher}</bdi></dd></div>
    <div><dt>{copy.wrap}</dt><dd><bdi>{plan.key_wrap}</bdi></dd></div>
    <div><dt>{copy.signer}</dt><dd>{plan.signer_id ? renderKey(plan.signer_id) : copy.none}</dd></div>
    <div><dt>{copy.expiry}</dt><dd>{policyDuration(plan.expires_in_minutes, language, copy)}</dd></div>
    <div><dt>{copy.views}</dt><dd>{plan.max_views === null ? copy.unlimited : new Intl.NumberFormat(language).format(plan.max_views)}</dd></div>
  </dl>;
}

export function VaultWorkspace({ language }: { language: Language }) {
  const t = vaultTranslations[language];
  const [{ keystore, executor }] = useState(() => {
    const keystore = new VaultKeystore();
    return { keystore, executor: new CryptoToolExecutor(keystore) };
  });
  const [panel, setPanel] = useState<Panel>('create');
  const [payloadKind, setPayloadKind] = useState<'text' | 'file'>('text');
  const [hasPayload, setHasPayload] = useState(false);
  const [intent, setIntent] = useState('');
  const [plan, setPlan] = useState<VaultPlan | null>(null);
  const [intents, setIntents] = useState<string[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ json: string; name: string } | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [hasVaultFile, setHasVaultFile] = useState(false);
  const [keys, setKeys] = useState<KeyLabel[]>([]);
  const [pending, setPending] = useState<Operation | null>(null);
  const [keyAction, setKeyAction] = useState<'generate' | 'import' | 'export' | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Panel, ErrorCode | null>>>({});
  const [cleared, setCleared] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const revision = useRef(0);
  const sessionBusy = useRef(false);
  const secretText = useRef<HTMLTextAreaElement>(null);
  const secretFile = useRef<HTMLInputElement>(null);
  const vaultFile = useRef<HTMLInputElement>(null);
  const openedText = useRef<HTMLTextAreaElement>(null);
  const openedUrl = useRef<string | null>(null);
  const generationForm = useRef<HTMLFormElement>(null);
  const importForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const version = revision.current;
    keystore.list().then(records => {
      if (version === revision.current) setKeys(records.map(key => ({ id: key.id, alias: key.alias, algo: key.algo, owned: Boolean(key.privateKey) })));
    }).catch(() => {
      if (version === revision.current) setErrors(current => ({ ...current, keys: 'keystore-unavailable' }));
    });
    return () => {
      revision.current++;
      executor.clear();
      if (openedUrl.current) URL.revokeObjectURL(openedUrl.current);
    };
  }, [executor, keystore]);

  function discardOpened() {
    if (openedUrl.current) URL.revokeObjectURL(openedUrl.current);
    openedUrl.current = null;
    if (openedText.current) openedText.current.value = '';
    setOpened(null);
  }

  function clearSession() {
    revision.current++;
    sessionBusy.current = false;
    executor.clear();
    if (secretText.current) secretText.current.value = '';
    if (secretFile.current) secretFile.current.value = '';
    if (vaultFile.current) vaultFile.current.value = '';
    generationForm.current?.reset();
    importForm.current?.reset();
    discardOpened();
    setPending(null);
    setHasPayload(false);
    setHasVaultFile(false);
    setIntent('');
    setPlan(null);
    setIntents([]);
    setReply(null);
    setSealed(null);
    setErrors({});
    setKeySaved(false);
    setCleared(true);
  }

  function showError(target: Panel, code: ErrorCode | null) {
    setErrors(current => ({ ...current, [target]: code }));
  }

  async function run(operation: Operation, target: Panel, task: (active: () => boolean) => Promise<void>) {
    if (sessionBusy.current) return;
    const version = revision.current;
    const active = () => version === revision.current;
    sessionBusy.current = true;
    setPending(operation);
    setCleared(false);
    showError(target, null);
    try {
      await task(active);
    } catch (error) {
      if (active()) showError(target, errorCode(error, t, operation === 'plan' ? 'planner' : 'fallback'));
    } finally {
      if (active()) {
        sessionBusy.current = false;
        setPending(null);
      }
    }
  }

  function changePayloadKind(kind: 'text' | 'file') {
    executor.clearPayload();
    setHasPayload(false);
    setPayloadKind(kind);
    setSealed(null);
    setCleared(false);
    showError('create', null);
  }

  function changeText(value: string) {
    setSealed(null);
    setCleared(false);
    try {
      if (value) executor.setText(value);
      else executor.clearPayload();
      setHasPayload(executor.hasPayload());
      showError('create', null);
    } catch (error) {
      executor.clearPayload();
      setHasPayload(false);
      showError('create', errorCode(error, t, 'invalid-payload'));
    }
  }

  function changeFile(file?: File) {
    executor.clearPayload();
    setHasPayload(false);
    setSealed(null);
    if (file) void run('payload', 'create', async active => {
      await executor.setFile(file);
      if (active()) setHasPayload(executor.hasPayload());
    });
  }

  function draftPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intent.trim() || sessionBusy.current) return;
    setPlan(null);
    setReply(null);
    setSealed(null);
    void run('plan', 'create', async active => {
      const result = await executor.ask(intent, language);
      if (!active()) return;
      setIntent('');
      setPlan(result.plan);
      setReply(result.reply);
      setIntents(executor.messages.filter(message => message.role === 'user').map(message => message.content));
    });
  }

  function sealVault() {
    void run('seal', 'create', async active => {
      const vault = await executor.seal();
      if (active()) setSealed({ json: JSON.stringify(vault, null, 2), name: `${vault.package_id}.vault` });
    });
  }

  function openVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = vaultFile.current?.files?.[0];
    if (!file || sessionBusy.current) return;
    discardOpened();
    if (file.size > MAX_VAULT_JSON_LENGTH) {
      showError('open', 'invalid-package');
      return;
    }
    void run('open', 'open', async active => {
      const json = await file.text();
      if (!active()) return;
      const { bytes, payload, signature } = await executor.open(json);
      try {
        if (!active()) return;
        if (payload.kind === 'text') {
          if (openedText.current) openedText.current.value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
          setOpened({ kind: 'text', signature });
        } else {
          const copy = new Uint8Array(bytes);
          try {
            const url = URL.createObjectURL(new Blob([copy], { type: 'application/octet-stream' }));
            openedUrl.current = url;
            const name = payload.name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_');
            setOpened({ kind: 'file', signature, url, name });
          } finally {
            copy.fill(0);
          }
        }
      } finally {
        bytes.fill(0);
      }
    });
  }

  async function runKeyAction(action: NonNullable<typeof keyAction>, task: () => Promise<void>) {
    setKeyAction(action);
    setKeySaved(false);
    setCleared(false);
    showError('keys', null);
    try {
      await task();
      if (action !== 'export') {
        const records = await keystore.list();
        setKeys(records.map(key => ({ id: key.id, alias: key.alias, algo: key.algo, owned: Boolean(key.privateKey) })));
        setKeySaved(true);
      }
    } catch (error) {
      showError('keys', errorCode(error, t, 'fallback'));
    } finally {
      setKeyAction(null);
    }
  }

  function generateKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void runKeyAction('generate', async () => {
      await keystore.generate(String(fields.get('alias')), fields.get('algo') as KeyAlgorithm);
      form.reset();
    });
  }

  function importKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get('public-key');
    if (!(file instanceof File) || !file.size || file.size > 16_384) {
      showError('keys', 'invalid-contact');
      return;
    }
    void runKeyAction('import', async () => {
      await keystore.importContact(await file.text(), String(fields.get('alias')), String(fields.get('fingerprint')).trim());
      form.reset();
    });
  }

  const busy = pending !== null;
  const keyBusy = keyAction !== null;
  const hasReceivingKey = keys.some(key => key.algo === 'RSA-OAEP-256' || key.algo === 'X25519');
  const error = errors[panel];

  return <main className="vault-shell" aria-labelledby="vault-title">
    <div className="vault-workspace">
      <header className="vault-header">
        <div><span className="local-label"><span />{t.browser}</span><h1 id="vault-title">{t.title}</h1><p>{t.intro}</p></div>
        <button type="button" className="vault-button" onClick={clearSession}>{t.clear}</button>
      </header>
      <nav className="mode-switch vault-tabs" aria-label={t.title}>
        {(['create', 'open', 'keys'] as const).map(item => <button key={item} type="button" aria-pressed={panel === item} className={panel === item ? 'active' : ''} onClick={() => setPanel(item)}>{t[item]}</button>)}
      </nav>
      {cleared && <p className="vault-status" role="status">{t.cleared}</p>}
      {error && <p className="vault-alert error" role="alert">{t.errors[error]}</p>}

      <section className="vault-grid" hidden={panel !== 'create'} aria-label={t.create}>
        <div className="vault-stack">
          <section className="crypto-card vault-card">
            <h2>{t.payload}</h2><p className="field-hint">{t.payloadHint}</p>
            <div className="mode-switch vault-input-mode" role="group" aria-label={t.payload}>
              {(['text', 'file'] as const).map(kind => <button key={kind} type="button" aria-pressed={payloadKind === kind} className={payloadKind === kind ? 'active' : ''} disabled={busy} onClick={() => { if (kind !== payloadKind) changePayloadKind(kind); }}>{t[kind]}</button>)}
            </div>
            {payloadKind === 'text'
              ? <><label className="sr-only" htmlFor="vault-private-text">{t.payload}</label><textarea id="vault-private-text" ref={secretText} disabled={busy} dir="auto" autoComplete="off" spellCheck={false} autoCorrect="off" placeholder={t.textPlaceholder} onChange={event => changeText(event.target.value)} /></>
              : <><label className="sr-only" htmlFor="vault-private-file">{t.payload}</label><input className="vault-field" id="vault-private-file" ref={secretFile} disabled={busy} type="file" onChange={event => changeFile(event.target.files?.[0])} /></>}
            <p className="field-hint vault-limit">{t.payloadLimit}</p>
          </section>
          <section className="crypto-card vault-card">
            <form onSubmit={draftPolicy}>
              <h2><label htmlFor="vault-policy">{t.policy}</label></h2>
              <p className="field-hint" id="vault-policy-hint">{t.policyHint}</p>
              <textarea id="vault-policy" className="vault-policy-input" dir="auto" required maxLength={MAX_VAULT_INTENT_LENGTH} autoComplete="off" spellCheck={false} aria-describedby="vault-policy-hint" value={intent} disabled={busy} placeholder={intents.length ? t.editPlaceholder : t.policyPlaceholder} onChange={event => setIntent(event.target.value)} />
              <button type="submit" className="vault-button" disabled={busy || !intent.trim()}>{pending === 'plan' ? t.planning : intents.length ? t.reviseButton : t.planButton}</button>
            </form>
            {reply && <p className="vault-reply" role="status" dir="auto">{reply}</p>}
            {intents.length > 0 && <details className="vault-intents"><summary>{t.recentIntents}</summary><ol>{intents.map((item, index) => <li dir="auto" key={index}>{item}</li>)}</ol></details>}
          </section>
        </div>
        <aside className="crypto-card vault-card vault-review" aria-labelledby="vault-review-title">
          <h2 id="vault-review-title">{t.planTitle}</h2>
          {plan ? <PlanSummary plan={plan} keys={keys} copy={t} language={language} /> : <p className="field-hint">{t.planPrompt}</p>}
          {!hasReceivingKey && <p className="field-hint">{t.planNoKeys} <button type="button" className="vault-text-button" onClick={() => setPanel('keys')}>{t.keys}</button></p>}
          {plan && (plan.expires_in_minutes !== null || plan.max_views !== null) && <p className="vault-note">{t.policyLimit}</p>}
          <button type="button" className="primary-button" disabled={!plan || !hasPayload || busy || Boolean(intent.trim())} onClick={sealVault}>{pending === 'seal' ? t.sealing : t.seal}</button>
          {sealed && <div className="vault-result"><p role="status">{t.sealed}</p><button type="button" className="vault-button" onClick={() => saveJson(sealed.json, sealed.name)}>{t.saveVault}</button></div>}
        </aside>
      </section>

      <section className="crypto-card vault-card vault-open" hidden={panel !== 'open'}>
        <h2>{t.openTitle}</h2><p className="field-hint">{t.openHint}</p>
        <form onSubmit={openVault}>
          <label htmlFor="vault-package-file">{t.chooseVault}</label><input className="vault-field" id="vault-package-file" ref={vaultFile} type="file" accept=".vault,application/json" required disabled={busy} onChange={event => { setHasVaultFile(Boolean(event.target.files?.length)); discardOpened(); showError('open', null); setCleared(false); }} />
          <button type="submit" className="primary-button" disabled={busy || !hasVaultFile}>{pending === 'open' ? t.opening : t.unlock}</button>
        </form>
        <div className="vault-result" hidden={!opened}>
          <h3>{t.opened}</h3>
          {opened && <p role="status" className={opened.signature === 'untrusted' ? 'vault-note' : ''}>{t[opened.signature]}</p>}
          <div hidden={opened?.kind !== 'text'}><label htmlFor="vault-opened-text">{t.openedText}</label><textarea id="vault-opened-text" dir="auto" ref={openedText} readOnly spellCheck={false} /></div>
          {opened?.kind === 'file' && <div className="vault-opened-file"><bdi>{opened.name}</bdi><a className="vault-button" href={opened.url} download={opened.name}>{t.savePayload}</a></div>}
        </div>
      </section>

      <section className="vault-grid vault-keyring" hidden={panel !== 'keys'} aria-label={t.keys}>
        <section className="crypto-card vault-card">
          <h2>{t.keyring}</h2><p className="field-hint">{t.keyringHint}</p>
          {keySaved && <p role="status" className="vault-status">{t.keySaved}</p>}
          {keys.length === 0 ? <p className="vault-empty">{t.noKeys}</p> : <ul className="vault-keys">
            {keys.map(key => <li key={key.id}>
              <div className="vault-key-head"><strong><bdi>{key.alias}</bdi></strong><span>{key.owned ? t.ownKey : t.contact} · <bdi>{key.algo}</bdi></span></div>
              <div className="vault-key-id"><span>{t.keyId}</span><code dir="ltr">{key.id}</code></div>
              <button type="button" className="vault-button" disabled={keyBusy} onClick={() => { void runKeyAction('export', async () => saveJson(await keystore.exportContact(key.id), `${key.id}.json`)); }}>{t.export}</button>
            </li>)}
          </ul>}
        </section>
        <div className="vault-stack">
          <section className="crypto-card vault-card">
            <h2>{t.generate}</h2>
            <form ref={generationForm} onSubmit={generateKey}>
              <label htmlFor="vault-key-alias">{t.keyAlias}</label><input className="vault-field" id="vault-key-alias" name="alias" dir="auto" required maxLength={MAX_VAULT_ALIAS_LENGTH} autoComplete="off" />
              <label htmlFor="vault-key-algorithm">{t.keyPurpose}</label><select className="vault-field" id="vault-key-algorithm" name="algo">
                {KEY_ALGORITHMS.map(algo => <option key={algo} value={algo}>{algo} · {algo === 'RSA-OAEP-256' || algo === 'X25519' ? t.receiving : t.signing}</option>)}
              </select>
              <button className="vault-button" type="submit" disabled={keyBusy}>{keyAction === 'generate' ? t.generating : t.generate}</button>
            </form>
          </section>
          <section className="crypto-card vault-card">
            <h2>{t.import}</h2><p className="field-hint" id="vault-import-hint">{t.importHint}</p>
            <form ref={importForm} onSubmit={importKey}>
              <label htmlFor="vault-contact-file">{t.contactFile}</label><input className="vault-field" id="vault-contact-file" name="public-key" type="file" accept=".json,application/json" required />
              <label htmlFor="vault-contact-alias">{t.contactAlias}</label><input className="vault-field" id="vault-contact-alias" name="alias" dir="auto" required maxLength={MAX_VAULT_ALIAS_LENGTH} autoComplete="off" />
              <label htmlFor="vault-contact-fingerprint">{t.contactFingerprint}</label><input className="vault-field" id="vault-contact-fingerprint" name="fingerprint" dir="ltr" maxLength={64} required autoComplete="off" spellCheck={false} aria-describedby="vault-import-hint" />
              <button className="vault-button" type="submit" disabled={keyBusy}>{keyAction === 'import' ? t.importing : t.import}</button>
            </form>
          </section>
        </div>
      </section>
    </div>
  </main>;
}
