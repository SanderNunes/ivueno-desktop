import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import VoiceModelCard from './VoiceModelCard.jsx';
import { Banner, Button, Dialog, Field } from './ui.jsx';
import { call, on } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';
import { useApp } from '../lib/app-context.js';
import { pcm16ToWavBytes, webmToPcm16 } from '../lib/pcm.mjs';
import { splitForUpload } from '../lib/segment.mjs';

const MAX_BYTES = 1.5e9;
const MAX_MS = 4 * 3600 * 1000;
const DIRECT_BYTES = 24e6;                 // up to this size the file goes to the speech service exactly as it is (the server accepts 25 MB)
const DIRECT_MS = 7200 * 1000;
const PCM_PIECE = 16000 * 300;             // samples sent to the voice step at a time (5 minutes)
export const AUDIO_ACCEPT = 'audio/*,video/mp4,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm,.mp4';

// what the speech service reads without conversion; anything else (aac, opus in odd containers, ...) is decoded here and sent as WAV
const DIRECT = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', ogg: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm' };
const extension = (name) => (String(name).match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';

const sizeLabel = (bytes) => (bytes >= 1e6 ? `${Math.round(bytes / 1e5) / 10} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/**
 * Import an audio file as a meeting. The file is read and decoded here (the browser engine understands mp3, wav, m4a, ogg, flac, webm), sent to the speech
 * service in one piece if small enough (otherwise in pieces cut at its quietest moments), and the voices are told apart on this computer so the lines go to
 * "Orador 1, 2…". The audio is not kept by the server. At the end the notes are written like for a recording.
 */
export default function ImportDialog({ onClose, initialFile = null }) {
  const t = useT();
  const { nav, toast } = useApp();
  const [file, setFile] = useState(initialFile);
  const [title, setTitle] = useState('');
  const [rights, setRights] = useState(false);
  const [separate, setSeparate] = useState(true);
  const [people, setPeople] = useState(0);                 // 0 = find out
  const [avail, setAvail] = useState({ ready: true, voices: false });
  const [stage, setStage] = useState('pick');              // pick | reading | transcribing | voiceprep | voices | writing
  const [progress, setProgress] = useState(null);          // 0..1 or null (no way to know)
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const importId = useRef(null);
  const input = useRef(null);

  useEffect(() => { call('import:available').then(setAvail).catch(() => {}); }, []);
  useEffect(() => on('voices:progress', (s) => { if (s.state === 'ready') setAvail((a) => ({ ...a, voices: true })); }), []);
  useEffect(() => on('import:progress', (p) => {
    if (!importId.current || p.id !== importId.current) return;
    if (p.stage === 'voices') { setStage('voices'); setProgress(p.value ?? null); } else if (p.stage === 'notes') { setStage('writing'); setProgress(null); }
  }), []);
  useEffect(() => () => { if (importId.current) { cancelled.current = true; call('import:cancel', { id: importId.current }).catch(() => {}); } }, []);

  const busy = stage !== 'pick';
  function choose(f) {
    setError('');
    if (!f) return;
    if (f.size > MAX_BYTES) { setError(t('O ficheiro é grande demais (máximo 1,5 GB).')); return; }
    setFile(f);
  }

  async function run() {
    setError(''); cancelled.current = false;
    try {
      setStage('reading'); setProgress(null);
      const raw = await file.arrayBuffer();
      let pcm;
      try { pcm = new Int16Array(await webmToPcm16(raw.slice(0))); } catch { setError(t('Não foi possível ler este ficheiro. Experimenta MP3, WAV, M4A, OGG ou FLAC.')); setStage('pick'); return; }
      const durationMs = Math.round(pcm.length / 16);
      if (durationMs > MAX_MS) { setError(t('A gravação é longa demais (máximo 4 horas).')); setStage('pick'); return; }
      if (pcm.length < 16000) { setError(t('Este ficheiro é curto demais.')); setStage('pick'); return; }

      // what goes to the speech service: the file itself when it is small enough, else WAV pieces of at most 10 minutes
      const mime = DIRECT[extension(file.name)];
      const pieces = (mime && file.size <= DIRECT_BYTES && durationMs <= DIRECT_MS)
        ? [{ startMs: 0, durationMs, mime, data: raw }]
        : splitForUpload(pcm).map((p) => ({ startMs: p.startMs, durationMs: p.durationMs, mime: 'audio/wav', data: pcm16ToWavBytes(pcm.subarray(p.from, p.to)) }));

      const begun = await call('import:begin', { fileName: file.name, title: title.trim(), durationMs, rights: 'confirmed', separateVoices: separate, voiceCount: people });
      importId.current = begun.id; setStage('transcribing'); setProgress(pieces.length > 1 ? 0 : null);
      let done = 0;
      for (const p of pieces) {
        if (cancelled.current) return;
        await call('import:piece', { id: begun.id, startMs: p.startMs, durationMs: p.durationMs, mime: p.mime, data: p.data });
        done += p.durationMs; if (pieces.length > 1) setProgress(done / durationMs);
      }
      if (begun.voices === 'on') {
        setStage('voiceprep'); setProgress(0);
        for (let at = 0; at < pcm.length; at += PCM_PIECE) {
          if (cancelled.current) return;
          await call('import:pcm', { id: begun.id, data: pcm.slice(at, at + PCM_PIECE).buffer });
          setProgress(Math.min(1, (at + PCM_PIECE) / pcm.length));
        }
      }
      if (cancelled.current) return;
      setStage('writing'); setProgress(null);
      const r = await call('import:finish', { id: begun.id });
      importId.current = null;
      toast(r.voicesError ? t('Gravação importada, mas não foi possível separar as vozes.') : r.voices > 1 ? t('Gravação importada: {n} vozes encontradas.', { n: r.voices }) : t('Gravação importada.'));
      onClose();
      nav('detail', { id: r.meeting.id });
    } catch (e) {
      if (importId.current) { await call('import:cancel', { id: importId.current }).catch(() => {}); importId.current = null; }
      setError(friendly(e)); setStage('pick');
    }
  }

  async function cancel() {
    cancelled.current = true;
    if (importId.current) { await call('import:cancel', { id: importId.current }).catch(() => {}); importId.current = null; }
    onClose();
  }

  const label = { reading: t('A ler e a preparar o áudio…'), transcribing: t('A transcrever…'), voiceprep: t('A preparar as vozes…'), voices: t('A separar as vozes…'), writing: t('A escrever as notas…') }[stage];

  return (
    <Dialog title={t('Importar áudio')} onClose={busy ? cancel : onClose} wide>
      <div className="dialog-body col" style={{ gap: 14 }}>
        {!busy && (
          <>
            <div
              className="card col"
              style={{ padding: 20, alignItems: 'center', gap: 8, borderStyle: 'dashed', textAlign: 'center' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files && e.dataTransfer.files[0]); }}
            >
              <Icon name="arrowDown" size={22} stroke={1.8} />
              {file
                ? <span><strong>{file.name}</strong> · {sizeLabel(file.size)}</span>
                : <span>{t('Larga aqui um ficheiro de áudio, ou escolhe um.')}</span>}
              <input ref={input} type="file" accept={AUDIO_ACCEPT} style={{ display: 'none' }} data-testid="import-file" aria-label={t('Ficheiro de áudio')} onChange={(e) => choose(e.target.files && e.target.files[0])} />
              <Button onClick={() => input.current && input.current.click()}>{file ? t('Escolher outro') : t('Escolher ficheiro')}</Button>
              <span className="muted" style={{ fontSize: 12 }}>{t('MP3, WAV, M4A, OGG, FLAC ou WEBM · até 4 horas')}</span>
            </div>
            <Field label={t('Título')} htmlFor="imp-title" optional>
              <input id="imp-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file ? file.name.replace(/\.[^.]+$/, '') : ''} />
            </Field>

            <div className="col" style={{ gap: 8 }}>
              <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                <span><strong>{t('Separar as vozes')}</strong> <span className="muted">{t('(Orador 1, Orador 2…)')}</span></span>
              </label>
              {separate && (
                <div className="col" style={{ gap: 10, paddingLeft: 28 }}>
                  <label className="row wrap" style={{ gap: 8 }}>
                    <span className="muted" style={{ fontSize: 13 }}>{t('Quantas pessoas falam?')}</span>
                    <select className="select" style={{ height: 32 }} value={people} onChange={(e) => setPeople(Number(e.target.value))} aria-label={t('Quantas pessoas falam?')}>
                      <option value={0}>{t('Descobrir sozinha')}</option>
                      {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  {!avail.voices && <VoiceModelCard />}
                </div>
              )}
            </div>

            <label className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} style={{ accentColor: 'var(--accent)', marginTop: 4 }} />
              <span style={{ fontSize: 14 }}>{t('Tenho autorização para transcrever esta gravação (as pessoas que falam sabem, ou deram permissão).')}</span>
            </label>
            <span className="muted" style={{ fontSize: 12 }}>{t('O áudio é enviado ao serviço de transcrição da Ivuenu e apagado logo a seguir. A reunião fica guardada neste computador. Gasta minutos de transcrição do teu plano.')}</span>
            {error && <Banner tone="warn" role="alert">{error}</Banner>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={onClose}>{t('Cancelar')}</Button>
              <Button variant="primary" disabled={!file || !rights || !avail.ready} onClick={run}>{t('Importar e transcrever')}</Button>
            </div>
          </>
        )}
        {busy && (
          <>
            <strong>{file && file.name}</strong>
            {progress === null
              ? <div className="row" style={{ gap: 10 }} role="status"><span className="spinner" aria-hidden="true" /><span>{label}</span></div>
              : (
                <>
                  <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={label}><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                  <span style={{ fontSize: 13 }} aria-live="polite">{label} {Math.round(progress * 100)}%</span>
                </>
              )}
            <span className="muted" style={{ fontSize: 12 }}>{t('Podes fechar esta janela para cancelar.')}</span>
            <div className="row" style={{ justifyContent: 'flex-end' }}><Button onClick={cancel}>{t('Cancelar')}</Button></div>
          </>
        )}
      </div>
    </Dialog>
  );
}
