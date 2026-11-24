import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { clock24, clockLabel, clockOptions, parseClock, timeMatchesTyped } from '../../lib/matchTiming';
import { Clock } from './Icons';

const INVALID = 'Use a time such as 7:30 PM or 19:30.';

/**
 * A time box people can type into ("8pm", "8:30 pm", "20:30") or pick from a list.
 * `value` and `onChange` use the stored 24-hour form ("20:30"); '' means no valid time yet.
 */
export function TimeField({ value, onChange, required, step = 30, placeholder = 'Type or pick a time' }: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  step?: number;
  placeholder?: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const all = useMemo(() => clockOptions(step), [step]);
  const current = value ? parseClock(value) : null;
  const [text, setText] = useState(() => current === null ? '' : clockLabel(current));
  const [open, setOpen] = useState(false);
  // What was typed since the list opened. Empty means show every time.
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [touched, setTouched] = useState(false);
  const [upward, setUpward] = useState(false);
  const typed = parseClock(text);
  const invalid = text.trim() !== '' && typed === null;
  const options = useMemo(() => query ? all.filter(minutes => timeMatchesTyped(minutes, query)) : all, [all, query]);
  const showList = open && options.length > 0;

  // A value set from outside (choosing a match fills in its saved time) replaces what the box shows.
  useEffect(() => {
    if (typed !== current) setText(current === null ? '' : clockLabel(current));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { input.current?.setCustomValidity(invalid ? INVALID : ''); }, [invalid]);

  // Keep the highlighted time, or the one nearest the current value, in view.
  useEffect(() => {
    if (!showList || !list.current) return;
    const index = active >= 0 ? active : nearest(options, current);
    list.current.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: active >= 0 ? 'nearest' : 'center' });
  }, [showList, active, options]); // eslint-disable-line react-hooks/exhaustive-deps

  // On a phone the field can sit near the bottom of the screen; then the list opens upward.
  function placeList() {
    const box = input.current?.getBoundingClientRect();
    if (box) setUpward(window.innerHeight - box.bottom < 250 && box.top > 250);
  }
  function openList() { placeList(); setQuery(''); setActive(-1); setOpen(true); }
  function close() { setOpen(false); setActive(-1); setQuery(''); }

  function choose(minutes: number) {
    onChange(clock24(minutes));
    setText(clockLabel(minutes));
    close();
  }

  function type(next: string) {
    setText(next);
    setQuery(next);
    if (!open) placeList();
    setOpen(true);
    const minutes = parseClock(next);
    onChange(minutes === null ? '' : clock24(minutes));
    setActive(-1);
  }

  function move(delta: number) {
    if (!open) { placeList(); setQuery(''); setOpen(true); }
    const list = open ? options : all;
    setActive(index => {
      const from = index >= 0 ? index : nearest(list, current) - (delta > 0 ? 1 : 0);
      return Math.min(list.length - 1, Math.max(0, from + delta));
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
    else if (event.key === 'Enter' && showList) { event.preventDefault(); if (active >= 0) choose(options[active]); else close(); }
    // Escape closes the list only; the dialog around it stays open.
    else if (event.key === 'Escape' && showList) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') close();
  }

  function onBlur() {
    close();
    setTouched(true);
    if (typed !== null) setText(clockLabel(typed));
  }

  return <span className="time-field" data-open={showList || undefined}>
    <input ref={input} type="text" role="combobox" inputMode="text" autoComplete="off" spellCheck={false}
      aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
      aria-invalid={touched && invalid ? true : undefined}
      placeholder={placeholder} required={required} value={text}
      onChange={event => type(event.target.value)} onKeyDown={onKeyDown} onBlur={onBlur}
      onClick={() => { if (!open) openList(); }} />
    {/* Mouse shortcut only: keyboard users open the list with the arrow keys. */}
    <span className="time-field-toggle" aria-hidden="true" onClick={event => event.preventDefault()}
      onMouseDown={event => { event.preventDefault(); if (showList) close(); else openList(); input.current?.focus(); }}><Clock size={17} /></span>
    {showList && <ul ref={list} id={listId} role="listbox" aria-label="Times" className="time-field-list" data-upward={upward || undefined}>
      {options.map((minutes, index) => <li key={minutes} id={`${listId}-${index}`} data-index={index} role="option"
        aria-selected={minutes === current} data-active={index === active || undefined}
        // preventDefault on click too: the field sits inside a <label>, whose click would reopen the list.
        onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); choose(minutes); }}>{clockLabel(minutes)}</li>)}
    </ul>}
    {touched && invalid && <small className="time-field-error" role="alert">{INVALID}</small>}
  </span>;
}

function nearest(options: number[], minutes: number | null) {
  if (!options.length) return 0;
  const target = minutes ?? 19 * 60;
  let best = 0;
  options.forEach((option, index) => { if (Math.abs(option - target) < Math.abs(options[best] - target)) best = index; });
  return best;
}
