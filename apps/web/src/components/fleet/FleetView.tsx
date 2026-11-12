'use client';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { FleetScene, FleetScreen, FleetShip } from '@protarget/shared';
import { SALOON, detectQuality, resolutionLabel, resolveQuality, type Quality, type QualityChoice } from '@/lib/fleet-sim';
import { useLocale, useText } from '../Locale';
import type { FleetMode, MoveInput } from './Scene';

function SceneLoading() { const text = useText(); return <p className="fleet-loading" role="status">{text('fleet.loading3d')}</p>; }
const FleetCanvas = dynamic(() => import('./Scene'), { ssr: false, loading: () => <SceneLoading /> });

class SceneBoundary extends Component<{ fallback: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.fallback(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function probeWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch { return false; }
}

function ScreenDetail({ screen, onClose }: { screen: FleetScreen; onClose: () => void }) {
  const text = useText();
  const locale = useLocale();
  const unknown = text('fleet.unknown');
  const when = (iso: string) => {
    try { return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: screen.timezone }).format(new Date(iso)); }
    catch { return iso; }
  };
  return <section className="card fleet-detail" aria-labelledby="fleet-screen-title" data-testid="fleet-screen-detail">
    <div className="section-heading"><h2 id="fleet-screen-title">{text('fleet.screenDetail')}</h2>
      <button type="button" className="button quiet" onClick={onClose}>{text('fleet.close')}</button></div>
    <dl className="identity-grid">
      <dt>{text('fleet.field.code')}</dt><dd><code>{screen.screenId}</code> {!screen.active && <span className="badge">{text('fleet.inactive')}</span>}</dd>
      <dt>{text('fleet.field.name')}</dt><dd>{screen.name}</dd>
      <dt>{text('fleet.field.resolution')}</dt><dd>{resolutionLabel(screen.resolutionWidth, screen.resolutionHeight) ?? unknown}</dd>
      <dt>{text('fleet.field.orientation')}</dt><dd>{screen.orientation ? text(`fleet.orientation.${screen.orientation}`) : unknown}</dd>
      <dt>{text('fleet.field.size')}</dt><dd>{screen.physicalSize ?? unknown}</dd>
      <dt>{text('fleet.field.hours')}</dt><dd>{screen.operatingStart && screen.operatingEnd ? `${screen.operatingStart}–${screen.operatingEnd} (${screen.timezone})` : unknown}</dd>
      <dt>{text('fleet.field.location')}</dt><dd>{screen.locationLabel ?? unknown}</dd>
    </dl>
    <h3>{text('fleet.campaigns')}</h3>
    {screen.declarations.length === 0 ? <p className="hint">{text('fleet.noDeclarations')}</p> : <ul className="fleet-declarations">
      {screen.declarations.map(d => <li key={d.campaignId}>
        <Link href={`/admin/campaigns/${d.campaignId}`}><strong>{d.code}</strong> · {d.name}</Link>{' '}
        <span className={`badge status-${d.status.toLowerCase()}`}>{text(`booking.status.${d.status as 'READY' | 'LIVE' | 'PAUSED'}`)}</span>
        <small>{text('fleet.creatives')}: {Object.keys(d.creativeStatusCounts).length === 0 ? text('fleet.noCreatives')
          : Object.entries(d.creativeStatusCounts).map(([status, n]) => `${text(`creative.status.${status as 'APPROVED'}`)} ${n}`).join(', ')}</small>
        <small>{text('fleet.lastCms')}: {d.lastCmsOperation ? `${text(`cms.type.${d.lastCmsOperation.type}`)} · ${when(d.lastCmsOperation.performedAt)}` : text('fleet.noCms')}</small>
      </li>)}
    </ul>}
    <p className="hint fleet-note">{text('fleet.declNote')}</p>
    <Link className="button" href={`/admin/inventory/screens/${screen.id}`}>{text('fleet.openScreen')}</Link>
  </section>;
}

export function FleetView({ scene, includeInactive }: { scene: FleetScene; includeInactive: boolean }) {
  const text = useText();
  const locale = useLocale();
  const [mode, setMode] = useState<FleetMode>('overview');
  const [shipId, setShipId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [goto, setGoto] = useState<{ screenId: string; nonce: number } | null>(null);
  const [choice, setChoice] = useState<QualityChoice>('auto');
  const [detected, setDetected] = useState<Quality | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [touch, setTouch] = useState(false);
  const input = useRef<MoveInput>({ forward: false, back: false, left: false, right: false });
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ok = probeWebgl();
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const nav = navigator as Navigator & { deviceMemory?: number };
    setWebgl(ok); setTouch(coarse);
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setDetected(detectQuality({ width: window.innerWidth, coarsePointer: coarse, cores: nav.hardwareConcurrency, memoryGb: nav.deviceMemory, webgl: ok }));
  }, []);
  const quality = detected ? resolveQuality(choice, detected) : null;

  const ship = scene.ships.find(s => s.id === shipId) ?? null;
  const screen = useMemo(() => scene.ships.flatMap(s => s.screens).find(s => s.id === selectedScreenId) ?? null, [scene, selectedScreenId]);

  const enter = useCallback((id: string) => {
    if (mode !== 'overview') return;
    setShipId(id); setSelectedScreenId(null); setMode('entering');
    stage.current?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [mode, reducedMotion]);
  const exit = useCallback(() => { if (mode === 'interior') { setMode('leaving'); setSelectedScreenId(null); } }, [mode]);
  const flightDone = useCallback((kind: 'entered' | 'left') => {
    if (kind === 'entered') setMode('interior'); else { setMode('overview'); setShipId(null); }
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exit(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [exit]);
  const selectScreen = useCallback((id: string) => {
    setSelectedScreenId(id);
    if (mode === 'interior') setGoto(g => ({ screenId: id, nonce: (g?.nonce ?? 0) + 1 }));
  }, [mode]);
  const labelFor = useCallback((s: FleetShip) => s.active ? s.name : `${s.name} · ${text('fleet.inactive')}`, [text]);
  const press = (key: keyof MoveInput, value: boolean) => { input.current[key] = value; };

  const hint = mode === 'interior' ? (touch ? 'fleet.controls.touch' : 'fleet.controls.desktop')
    : mode === 'overview' ? 'fleet.controls.overview' : null;
  const stageStatus = mode === 'entering' && ship ? text('fleet.flying', { name: ship.name })
    : mode === 'interior' && ship ? text('fleet.inside', { name: ship.name }) : null;

  return <div className="fleet" data-mode={mode} data-quality={quality ?? 'pending'} data-testid="fleet-root">
    <div className="fleet-stage" ref={stage} role="group" aria-label={text('fleet.canvasLabel')}>
      {webgl && quality && <SceneBoundary fallback={() => setWebgl(false)}>
        <FleetCanvas ships={scene.ships} quality={quality} mode={mode} shipId={shipId} highlightedShipId={hovered}
          selectedScreenId={selectedScreenId} goto={goto} input={input} reducedMotion={reducedMotion}
          onEnter={enter} onFlightDone={flightDone} onSelectScreen={selectScreen} onContextLost={() => setWebgl(false)} labelFor={labelFor} />
      </SceneBoundary>}
      {!webgl && <p className="fleet-fallback" role="status">{text('fleet.noWebgl')}</p>}
      <div className="fleet-overlay top-left">
        <span className="fleet-badge" data-testid="fleet-sim-badge">{text('fleet.simBadge')}</span>
        <span className="fleet-subnote">{text('fleet.scaleNote')}</span>
      </div>
      <div className="fleet-overlay top-right">
        <label className="fleet-quality">{text('fleet.quality')}
          <select value={choice} onChange={e => setChoice(e.target.value as QualityChoice)}>
            <option value="auto">{text('fleet.quality.auto')}</option>
            <option value="high">{text('fleet.quality.high')}</option>
            <option value="low">{text('fleet.quality.low')}</option>
          </select></label>
        {(mode === 'interior' || mode === 'leaving') && <button type="button" className="button primary" disabled={mode !== 'interior'} onClick={exit}>{text('fleet.exit')}</button>}
      </div>
      {stageStatus && <div className="fleet-overlay top-center" role="status" aria-live="polite">{stageStatus}</div>}
      {hint && <div className="fleet-overlay bottom-left">{text(hint)}</div>}
      {mode === 'interior' && <div className="fleet-overlay bottom-pad" aria-label={text('fleet.controls.touch')}>
        {([['forward', 'fleet.move.forward'], ['left', 'fleet.move.left'], ['back', 'fleet.move.back'], ['right', 'fleet.move.right']] as const).map(([key, label]) =>
          <button key={key} type="button" className={`pad pad-${key}`} aria-label={text(label)} title={text(label)}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); press(key, true); }}
            onPointerUp={() => press(key, false)} onPointerCancel={() => press(key, false)} onLostPointerCapture={() => press(key, false)}>
            {key === 'forward' ? '▲' : key === 'back' ? '▼' : key === 'left' ? '◀' : '▶'}</button>)}
      </div>}
      {mode === 'interior' && ship && screen && ship.screens.some(s => s.id === screen.id) &&
        <div className="fleet-overlay bottom-right" data-testid="fleet-hud-screen"><strong>{screen.screenId}</strong> {screen.name}</div>}
    </div>
    <p className="hint fleet-note" data-testid="fleet-notes">{text('fleet.declNote')} {text('fleet.layoutNote')}</p>

    <div className="fleet-panels">
      <section className="card fleet-ships" aria-labelledby="fleet-ships-title">
        <div className="section-heading"><h2 id="fleet-ships-title">{text('fleet.ships')} <small className="muted">({text('fleet.shipCount', { count: scene.ships.length })})</small></h2>
          <Link className="button quiet" href={includeInactive ? '/admin/fleet' : '/admin/fleet?inactive=true'} prefetch={false}>
            {text(includeInactive ? 'fleet.hideInactive' : 'fleet.showInactive')}</Link></div>
        {scene.shipsTruncated && <p className="error" role="status">{text('fleet.truncatedShips', { count: scene.ships.length })}</p>}
        <p className="hint" suppressHydrationWarning>{text('fleet.asOf', { time: new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scene.asOf)) })}</p>
        {scene.ships.length === 0 ? <p className="empty-inline" data-testid="fleet-empty">{text('fleet.empty')}</p> : <ul className="fleet-ship-list">
          {scene.ships.map(s => <li key={s.id} data-testid="fleet-ship-item" data-ship-id={s.id} className={s.id === shipId ? 'current' : undefined}
            onMouseEnter={() => setHovered(s.id)} onMouseLeave={() => setHovered(null)}>
            <div className="fleet-ship-head">
              <div><strong>{s.name}</strong>{!s.active && <span className="badge">{text('fleet.inactive')}</span>}
                <small>{s.city} · {text('fleet.screenCount', { count: s.screens.length })}</small></div>
              <button type="button" className="button primary" disabled={mode !== 'overview'} onClick={() => enter(s.id)}
                aria-label={`${text('fleet.enter')}: ${s.name}`}>{text('fleet.enter')}</button>
            </div>
            {s.screens.length > 0 && <details><summary>{text('fleet.screens')} ({s.screens.length})</summary>
              {s.screensTruncated && <p className="hint">{text('fleet.truncatedScreens', { count: s.screens.length })}</p>}
              {s.screens.length > SALOON.maxScreens && <p className="hint">{text('fleet.notPlaced', { count: s.screens.length - SALOON.maxScreens, max: SALOON.maxScreens })}</p>}
              <ul>{s.screens.map((sc, i) => <li key={sc.id}>
                <button type="button" className="link-button" data-testid="fleet-screen-item" aria-pressed={sc.id === selectedScreenId}
                  onClick={() => selectScreen(sc.id)}>
                  <code>{sc.screenId}</code> {sc.name}{!sc.active ? ` · ${text('fleet.inactive')}` : ''}
                  {mode === 'interior' && s.id === shipId && i < SALOON.maxScreens && <span className="muted"> — {text('fleet.goToScreen')}</span>}
                </button></li>)}</ul>
            </details>}
          </li>)}
        </ul>}
      </section>
      {screen ? <ScreenDetail key={screen.id} screen={screen} onClose={() => setSelectedScreenId(null)} />
        : <section className="card fleet-detail"><h2>{text('fleet.screenDetail')}</h2><p className="hint">{text('fleet.selectScreenHint')}</p></section>}
    </div>
  </div>;
}
