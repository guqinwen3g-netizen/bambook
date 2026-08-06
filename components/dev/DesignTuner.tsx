import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, Move, RotateCcw, SlidersHorizontal } from 'lucide-react';

export const DESIGN_TUNER_POSITION_KEY = 'bambook_design_tuner_position_v1';
export const DESIGN_TUNER_EXPORT_PREFIX = 'BAMBOOK_DESIGN_TUNER_SIDEBAR_BUTTONS_V1=';
export const DESIGN_TUNER_TOGGLE_HINT = '⌘/Ctrl Shift T';

type TunerValue = Record<string, number>;
type TunerPosition = { x: number; y: number };

export type DesignTunerControl = {
  key: string;
  label: string;
  variable: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  group: 'Light' | 'Dark' | 'Motion';
};

export const SIDEBAR_BUTTON_TUNER_CONTROLS: DesignTunerControl[] = [
  { key: 'lightHoverA1', label: 'Hover A', variable: '--bambook-sidebar-hover-light-a1', min: 0, max: 1, step: 0.01, defaultValue: 0.26, group: 'Light' },
  { key: 'lightHoverA2', label: 'Hover B', variable: '--bambook-sidebar-hover-light-a2', min: 0, max: 1, step: 0.01, defaultValue: 0.26, group: 'Light' },
  { key: 'lightPressA1', label: 'Press A', variable: '--bambook-sidebar-press-light-a1', min: 0, max: 1, step: 0.01, defaultValue: 0.44, group: 'Light' },
  { key: 'lightPressA2', label: 'Press B', variable: '--bambook-sidebar-press-light-a2', min: 0, max: 1, step: 0.01, defaultValue: 0.44, group: 'Light' },
  { key: 'lightActiveA1', label: 'Active A', variable: '--bambook-sidebar-active-light-a1', min: 0, max: 1, step: 0.01, defaultValue: 0.54, group: 'Light' },
  { key: 'lightActiveA2', label: 'Active B', variable: '--bambook-sidebar-active-light-a2', min: 0, max: 1, step: 0.01, defaultValue: 0.58, group: 'Light' },
  { key: 'darkHoverA1', label: 'Hover A', variable: '--bambook-sidebar-hover-dark-a1', min: 0, max: 1, step: 0.01, defaultValue: 0.08, group: 'Dark' },
  { key: 'darkHoverA2', label: 'Hover B', variable: '--bambook-sidebar-hover-dark-a2', min: 0, max: 1, step: 0.01, defaultValue: 0.08, group: 'Dark' },
  { key: 'darkPressA1', label: 'Press A', variable: '--bambook-sidebar-press-dark-a1', min: 0, max: 1, step: 0.01, defaultValue: 0.43, group: 'Dark' },
  { key: 'darkPressA2', label: 'Press B', variable: '--bambook-sidebar-press-dark-a2', min: 0, max: 1, step: 0.01, defaultValue: 0.43, group: 'Dark' },
  { key: 'darkActiveA1', label: 'Active A', variable: '--bambook-sidebar-active-dark-a1', min: 0, max: 1, step: 0.01, defaultValue: 0.58, group: 'Dark' },
  { key: 'darkActiveA2', label: 'Active B', variable: '--bambook-sidebar-active-dark-a2', min: 0, max: 1, step: 0.01, defaultValue: 0.54, group: 'Dark' },
  { key: 'pressScale', label: 'Press Scale', variable: '--bambook-sidebar-press-scale', min: 0.96, max: 1, step: 0.001, defaultValue: 0.995, group: 'Motion' },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const readJson = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};

export const createDefaultDesignTunerValues = () =>
  SIDEBAR_BUTTON_TUNER_CONTROLS.reduce<TunerValue>((acc, control) => {
    acc[control.key] = control.defaultValue;
    return acc;
  }, {});

export const createDesignTunerExportText = (values: TunerValue) =>
  `${DESIGN_TUNER_EXPORT_PREFIX}${JSON.stringify({
    target: 'sidebar-button-states',
    values,
  })}`;

const getInitialPosition = (): TunerPosition => {
  const defaultPosition = typeof window === 'undefined'
    ? { x: 420, y: 88 }
    : { x: Math.max(24, window.innerWidth - 390), y: 88 };
  return readJson(DESIGN_TUNER_POSITION_KEY, defaultPosition);
};

const constrainPosition = (position: TunerPosition): TunerPosition => {
  if (typeof window === 'undefined') return position;
  return {
    x: clamp(position.x, 8, Math.max(8, window.innerWidth - 120)),
    y: clamp(position.y, 8, Math.max(8, window.innerHeight - 64)),
  };
};

const persistPosition = (position: TunerPosition) => {
  try {
    window.localStorage.setItem(DESIGN_TUNER_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Dev-only helper; ignore storage failures.
  }
};

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.setAttribute('readonly', 'true');
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

const groupedControls = SIDEBAR_BUTTON_TUNER_CONTROLS.reduce<Record<string, DesignTunerControl[]>>((acc, control) => {
  acc[control.group] = [...(acc[control.group] || []), control];
  return acc;
}, {});

interface DesignTunerProps {
  isDarkMode: boolean;
}

const DesignTuner: React.FC<DesignTunerProps> = ({ isDarkMode }) => {
  const defaults = useMemo(createDefaultDesignTunerValues, []);
  const [values, setValues] = useState<TunerValue>(() => defaults);
  const [position, setPosition] = useState<TunerPosition>(() => constrainPosition(getInitialPosition()));
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [status, setStatus] = useState('Preview only');
  const dragOffsetRef = useRef<TunerPosition | null>(null);

  useEffect(() => {
    SIDEBAR_BUTTON_TUNER_CONTROLS.forEach((control) => {
      document.documentElement.style.setProperty(control.variable, String(values[control.key] ?? control.defaultValue));
    });
  }, [values]);

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => {
        const next = constrainPosition(current);
        persistPosition(next);
        return next;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragOffsetRef.current) return;
      const next = constrainPosition({
        x: event.clientX - dragOffsetRef.current.x,
        y: event.clientY - dragOffsetRef.current.y,
      });
      setPosition(next);
      persistPosition(next);
    };
    const handlePointerUp = () => {
      dragOffsetRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const handleDragStart = (event: React.PointerEvent) => {
    dragOffsetRef.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateValue = (key: string, value: number) => {
    setStatus('Preview changed');
    setValues((current) => ({ ...current, [key]: value }));
  };

  const resetValues = () => {
    setValues(defaults);
    setStatus('Reset to code defaults');
  };

  const exportValues = async () => {
    try {
      await copyTextToClipboard(createDesignTunerExportText(values));
      setStatus('Copied export text');
    } catch {
      setStatus('Copy failed');
    }
  };

  const panelClass = isDarkMode
    ? 'bambook-dashboard-glass-color bambook-blue-white-light text-slate-200'
    : 'bambook-dashboard-glass-color bambook-blue-white-light text-slate-700';

  return (
    <div
      data-design-tuner
      className={`fixed w-[350px] rounded-inset border z-[9999] overflow-hidden select-none ${panelClass}`}
      style={{ left: position.x, top: position.y }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="移动 Design Tuner"
        onPointerDown={handleDragStart}
        className="h-11 px-4 flex items-center justify-between gap-3 cursor-grab active:cursor-grabbing bg-transparent"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Move size={15} strokeWidth={1.6} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
          <SlidersHorizontal size={15} strokeWidth={1.6} className="text-[var(--os-vnext-brand-blue)]" />
          <div className="min-w-0">
            <div className="text-[11px] font-light tracking-wide truncate">Design Tuner</div>
            <div className={`text-[9px] truncate ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>Sidebar Button States · {DESIGN_TUNER_TOGGLE_HINT}</div>
          </div>
        </div>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setIsCollapsed((current) => !current)}
          className={`h-8 w-7 rounded-control flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.075)] text-slate-400' : 'hover:bg-white/70 text-slate-500'}`}
          aria-label={isCollapsed ? '展开调参面板' : '折叠调参面板'}
        >
          <ChevronDown size={15} strokeWidth={1.6} className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
        </button>
      </div>

      {!isCollapsed && (
        <div className="p-4 space-y-4">
          {Object.entries(groupedControls).map(([group, controls]) => (
            <section key={group} className="space-y-2">
              <div className={`text-[10px] font-light tracking-[0.18em] uppercase ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>{group}</div>
              <div className="grid grid-cols-2 gap-2">
                {controls.map((control) => {
                  const value = values[control.key] ?? control.defaultValue;
                  return (
                    <label key={control.key} className={`rounded-inset border p-2 ${isDarkMode ? 'border-white/[0.06] bg-white/[0.035]' : 'border-white/50 bg-white/45'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-light truncate">{control.label}</span>
                        <input
                          type="number"
                          value={Number(value.toFixed(control.step < 0.01 ? 3 : 2))}
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          onChange={(event) => updateValue(control.key, clamp(Number(event.target.value), control.min, control.max))}
                          className={`w-16 h-8 rounded-control border px-1.5 text-[10px] outline-none ${isDarkMode ? 'border-white/10 bg-black/20 text-slate-200' : 'border-white/60 bg-white/70 text-slate-700'}`}
                        />
                      </div>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={value}
                        onChange={(event) => updateValue(control.key, Number(event.target.value))}
                        className="mt-2 w-full accent-[var(--os-vnext-brand-blue)]"
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          ))}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className={`text-[10px] ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>{status}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetValues}
                className={`h-8 px-3 rounded-full border flex items-center gap-1.5 text-[10px] transition-colors ${isDarkMode ? 'border-white/10 hover:bg-white/10' : 'border-white/55 hover:bg-white/70'}`}
              >
                <RotateCcw size={13} strokeWidth={1.6} />
                Reset
              </button>
              <button
                type="button"
                onClick={exportValues}
                className="h-8 px-3 rounded-full border border-[var(--os-vnext-brand-blue)]/30 bg-[var(--os-vnext-brand-blue)]/12 text-[var(--os-vnext-brand-blue)] flex items-center gap-1.5 text-[10px] transition-colors hover:bg-[var(--os-vnext-brand-blue)]/18"
              >
                <Copy size={13} strokeWidth={1.6} />
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DesignTuner;
