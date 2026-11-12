/**
 * @module Select
 * @description Single-value select: a trigger showing the current value and a
 * listbox menu with optional group headings. Opt into `searchable` and the menu
 * grows a search row that filters the options by a substring and highlights the
 * match — the same picking model, just findable in a long list. Opt into
 * `onClear` and the trigger grows a reset button. Opt into `portal` and the
 * menu is drawn on the document's top layer instead of inside the field.
 */
import React, {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn, cssStyleClass, type Size } from '../utils';

type Tone = 'default' | 'error';

export interface SelectOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  /**
   * Optional group heading. Consecutive options sharing the same `group` render
   * under one non-selectable header inside the menu. Options without `group`
   * render flat (no header), so this is fully backward compatible.
   */
  group?: string;
  /**
   * Text the `searchable` filter matches against, and the one it highlights.
   * Defaults to `label` when the label is a plain string; a rich label with no
   * `searchText` is simply not searchable.
   */
  searchText?: string;
}

export interface SelectProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  size?: Size;
  tone?: Tone;
  options: SelectOption<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Adds a search row to the menu that filters the options by a substring. */
  searchable?: boolean;
  /** Placeholder of that search row. */
  searchPlaceholder?: string;
  /** Shown instead of the list when the query matches nothing. */
  emptyMessage?: React.ReactNode;
  /**
   * Adds a reset button to the trigger, shown once a value is picked. The
   * component never invents an «empty value» of its own — clearing is whatever
   * the owner of the value does here.
   */
  onClear?: () => void;
  /** Accessible name of that reset button. */
  clearLabel?: string;
  /**
   * Draws the menu in a portal on `document.body`, positioned against the
   * trigger, instead of inside the field. An in-place menu is clipped by any
   * scrolling ancestor; a portalled one is not, and it opens upwards when there
   * is no room below. The markup of the menu is the same either way.
   */
  portal?: boolean;
  /**
   * Whether picking an option or pressing Escape returns the focus to the
   * trigger. Default `true`. A host that keeps its own focus target — a text
   * editor whose toolbar this Select sits in — turns it off and focuses itself.
   */
  returnFocus?: boolean;
  id?: string;
  name?: string;
}

const ChevronIcon = () => (
  <svg className="ou-select__chev" viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// The lucide «x» glyph, inlined: the kit has no icon dependency and must not
// grow one, so the path is carried here rather than imported.
const ClearIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

const SearchIcon = () => (
  <svg className="ou-select__search-ico" viewBox="0 0 24 24" width="16" height="16" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);

/** Wrap the first case-insensitive occurrence of `q` in `<mark>`. */
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

/** Text a `searchable` Select matches and highlights for one option. */
function searchTextOf<T extends string>(o: SelectOption<T>): string {
  return o.searchText ?? (typeof o.label === 'string' ? o.label : '');
}

function SelectInner<T extends string = string>(
  {
    label, hint, error, size = 'm', tone, options, value, defaultValue, onChange,
    placeholder = 'Выберите…', disabled, fullWidth,
    searchable, searchPlaceholder = 'Поиск…', emptyMessage = 'Ничего не найдено',
    onClear, clearLabel = 'Очистить', portal = false, returnFocus = true, id, name, className,
    ...rest
  }: SelectProps<T>,
  ref: React.Ref<HTMLButtonElement>,
) {
  const autoId = useId();
  const fieldId = id || `ou-select-${autoId}`;
  const menuId = `${fieldId}-menu`;
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState<T | undefined>(defaultValue);
  const current = value !== undefined ? value : internal;

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight?: number } | null>(null);
  useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

  const [query, setQuery] = useState('');
  // Keyboard cursor inside the filtered list. Only a searchable Select has one:
  // there the focus sits in the search input, so the list needs a cursor of its
  // own; a plain Select is navigated by the browser's own listbox behaviour.
  const [activeIdx, setActiveIdx] = useState(-1);

  const t: Tone = error ? 'error' : (tone ?? 'default');
  const selected = options.find(o => o.value === current);
  const showClear = Boolean(onClear) && !!selected && !disabled;

  const shown = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => searchTextOf(o).toLowerCase().includes(q));
  }, [options, query, searchable]);

  // A fresh query makes the previous cursor meaningless.
  useEffect(() => { setActiveIdx(shown.length ? 0 : -1); }, [query, shown.length]);

  // The query belongs to one visit of the menu, not to the field.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      // A portalled menu is not inside the wrapper: without the second check a
      // press on an option would close the menu before the option is picked.
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); if (returnFocus) triggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, returnFocus]);

  // Portal placement: under the trigger at its width, flipped above it when the
  // menu does not fit below but does fit above — the same rule Popover follows.
  // When it fits on neither side it takes the roomier one and its list scrolls
  // inside the room left, so no option ends up beyond the window edge.
  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const a = trigger.getBoundingClientRect();
    const natural = menu.scrollHeight;
    const gap = 4;
    const margin = 8;
    const viewH = document.documentElement.clientHeight || window.innerHeight;
    const below = viewH - a.bottom - gap - margin;
    const above = a.top - gap - margin;
    const fitsBelow = natural <= below;
    const up = !fitsBelow && (natural <= above || above > below);
    const room = up ? above : below;
    const height = Math.min(natural, Math.max(room, 0));
    setMenuPos({
      top: (up ? a.top - height - gap : a.bottom + gap) + window.scrollY,
      left: a.left + window.scrollX,
      width: a.width,
      maxHeight: natural > room ? Math.max(room, 0) : undefined,
    });
  }, []);

  useLayoutEffect(() => {
    if (!portal || !open) { setMenuPos(null); return; }
    placeMenu();
  }, [portal, open, placeMenu]);

  useEffect(() => {
    if (!portal || !open) return;
    window.addEventListener('scroll', placeMenu, true);
    window.addEventListener('resize', placeMenu);
    return () => {
      window.removeEventListener('scroll', placeMenu, true);
      window.removeEventListener('resize', placeMenu);
    };
  }, [portal, open, placeMenu]);

  const handleSelect = (opt: SelectOption<T>) => {
    if (opt.disabled) return;
    if (value === undefined) setInternal(opt.value);
    onChange?.(opt.value);
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onSearchKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (shown.length ? (i + 1) % shown.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (shown.length ? (i - 1 + shown.length) % shown.length : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = shown[activeIdx];
      if (opt) handleSelect(opt);
    }
  };

  const menu = (
    <div
      ref={menuRef}
      className={cn(
        'ou-select__menu',
        portal && cssStyleClass(
          menuPos
            ? {
              position: 'absolute', top: menuPos.top, left: menuPos.left, right: 'auto', width: menuPos.width,
              maxHeight: menuPos.maxHeight, zIndex: 1000,
            }
            // First frame: measured before it is placed, so it must not flash at 0,0.
            : { position: 'absolute', top: 0, left: 0, right: 'auto', visibility: 'hidden', zIndex: 1000 },
          'ou-select-pos',
        ),
      )}
    >
      {searchable && (
        <div className="ou-select__search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="text"
            className="ou-select__search-input"
            value={query}
            placeholder={searchPlaceholder}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls={menuId}
            aria-autocomplete="list"
            aria-label={searchPlaceholder}
            aria-activedescendant={
              activeIdx >= 0 && shown[activeIdx] ? `${fieldId}-opt-${shown[activeIdx].value}` : undefined
            }
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
      )}
      {searchable && shown.length === 0 ? (
        <div className="ou-select__empty" aria-live="polite">{emptyMessage}</div>
      ) : (
        <ul
          className={cn(
            'ou-select__list',
            // A capped menu must let its list shrink, or the list keeps its own height
            // and the overflow is cut off instead of scrolled.
            portal && menuPos?.maxHeight !== undefined && cssStyleClass({ minHeight: 0, maxHeight: 'none', flex: '1 1 auto' }, 'ou-select-list'),
          )}
          id={menuId}
          role="listbox"
          aria-labelledby={fieldId}
        >
          {shown.map((o, i) => {
            const showHeader = !!o.group && o.group !== (i > 0 ? shown[i - 1].group : undefined);
            const labelStr = searchable && typeof o.label === 'string' ? o.label : '';
            return (
              <React.Fragment key={o.value}>
                {showHeader && (
                  <li role="presentation" className="ou-select__optgroup">{o.group}</li>
                )}
                <li
                  id={`${fieldId}-opt-${o.value}`}
                  role="option"
                  aria-selected={o.value === current ? 'true' : 'false'}
                  aria-disabled={o.disabled || undefined}
                  className={cn(
                    'ou-select__opt',
                    o.value === current && 'is-selected',
                    searchable && i === activeIdx && 'is-active',
                    o.disabled && 'is-disabled',
                  )}
                  onMouseEnter={() => { if (searchable) setActiveIdx(i); }}
                  onClick={() => handleSelect(o)}
                >
                  {labelStr ? highlight(labelStr, query.trim()) : o.label}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className={cn(
        'ou-select',
        `ou-field--${size}`,
        `ou-field--${t}`,
        fullWidth && 'ou-field--full',
        disabled && 'is-disabled',
        open && 'is-open',
        className,
      )}
      {...rest}
    >
      {label && <label htmlFor={fieldId} className="ou-field__lbl">{label}</label>}
      {/*
        The reset button cannot live inside the trigger — a button inside a button
        is invalid HTML and swallows the inner click. With `onClear` the trigger
        therefore gets a positioned wrapper as its sibling host; without it the
        structure stays exactly as it always was.
      */}
      {(() => {
        const trigger = (
          <button
            ref={triggerRef}
            id={fieldId}
            type="button"
            className={cn('ou-field__box ou-select__trigger', showClear && 'ou-select__trigger--clearable')}
            disabled={disabled}
            onClick={() => setOpen(o => !o)}
            aria-haspopup="listbox"
            aria-expanded={open ? 'true' : 'false'}
            aria-invalid={t === 'error' || undefined}
          >
            <span className={cn('ou-select__value', !selected && 'is-placeholder')}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronIcon />
          </button>
        );
        if (!onClear) return trigger;
        return (
          <div className="ou-select__control">
            {trigger}
            {showClear && (
              <button
                type="button"
                className="ou-select__clear"
                aria-label={clearLabel}
                onClick={(e) => { e.stopPropagation(); onClear(); triggerRef.current?.focus(); }}
              >
                <ClearIcon />
              </button>
            )}
          </div>
        );
      })()}
      {name !== undefined && (
        <input type="hidden" name={name} value={current ?? ''} />
      )}
      {open && !disabled && (portal
        ? createPortal(menu, document.body)
        : menu)}
      {(error || hint) && (
        <div className={`ou-field__msg ou-field__msg--${t}`}>{error || hint}</div>
      )}
    </div>
  );
}

/** Skillum · Select (single value). */
export const Select = forwardRef(SelectInner) as <T extends string = string>(
  p: SelectProps<T> & { ref?: React.Ref<HTMLButtonElement> },
) => React.ReactElement;
(Select as unknown as { displayName: string }).displayName = 'Select';
