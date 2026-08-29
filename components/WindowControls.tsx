// Frameless-window control affordance.
//
// The Electron BrowserWindow is fully chromeless (no title bar, no native
// min/max/close buttons by default). This component renders an invisible
// hot-zone in the top-left corner of the window that reveals the controls
// only when the cursor enters it:
//
//   • macOS  — the OS-native traffic-light circles (red/yellow/green) are
//     toggled via `setWindowButtonVisibility` over IPC. They render at the
//     OS level, not in the DOM, so no custom HTML is required and they
//     keep their native click / hover behavior, accessibility, and exact
//     OS styling.
//
//   • Windows / Linux — there are no native buttons in our frameless
//     config, so we render three custom HTML buttons (minimize, toggle
//     maximize, close) inside the same hot-zone. They fade in on hover
//     and dispatch via the same IPC bridge.
//
// In a regular browser tab `window.bambook` is undefined and this whole
// component renders nothing.
//
// The hot-zone has `-webkit-app-region: no-drag` so cursor events fire
// normally (the rest of <body> is `drag` to enable click-and-drag window
// movement).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Above any in-app overlay (z-[200] etc.) but below the traffic-light hot zone. */
const TOP_DRAG_STRIP_Z = 300_000;
/** Must sit above the strip so the top-left corner still receives hover for native controls. */
const TRAFFIC_LIGHT_HOT_ZONE_Z = 300_001;

/** Enough hit area to drag without aiming at the 1px window edge; kept small so headers stay usable. */
const TOP_DRAG_STRIP_HEIGHT_PX = 14;

declare global {
    interface Window {
        bambook?: { platform: NodeJS.Platform; versions: Record<string, string> };
        bambookWindow?: {
            setTrafficLights: (visible: boolean) => Promise<void>;
            minimize: () => Promise<void>;
            toggleMaximize: () => Promise<void>;
            close: () => Promise<void>;
            isFullScreen: () => Promise<boolean>;
            onFullScreenChange: (cb: (fs: boolean) => void) => () => void;
        };
    }
}

const WindowControls: React.FC = () => {
    const platform = typeof window !== 'undefined' ? window.bambook?.platform : undefined;
    const ipc = typeof window !== 'undefined' ? window.bambookWindow : undefined;

    const [hovered, setHovered] = useState(false);
    // Track the OS fullscreen state. In fullscreen the main process keeps
    // macOS native traffic lights visible so the OS can reveal/hide them with
    // the menu bar; the renderer should not add its own hover zone there.
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [isAgentFullscreen, setIsAgentFullscreen] = useState(false);

    useEffect(() => {
        const checkAgentFullscreen = () => {
            const el = document.querySelector('[data-agent-fullscreen="true"]');
            setIsAgentFullscreen(!!el);
        };
        checkAgentFullscreen();

        const observer = new MutationObserver(checkAgentFullscreen);
        observer.observe(document.body, { attributes: true, childList: true, subtree: true });

        return () => observer.disconnect();
    }, []);

    // Brief leave delay so the controls don't flicker out if the cursor
    // grazes the edge between the zone and the buttons themselves (mostly
    // matters for the tiny native traffic lights on macOS).
    const leaveTimer = useRef<number | null>(null);

    const handleEnter = useCallback(() => {
        if (leaveTimer.current !== null) {
            window.clearTimeout(leaveTimer.current);
            leaveTimer.current = null;
        }
        setHovered(true);
    }, []);

    const handleLeave = useCallback(() => {
        if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
        leaveTimer.current = window.setTimeout(() => {
            setHovered(false);
            leaveTimer.current = null;
        }, 220);
    }, []);

    // Drive the macOS native traffic lights via IPC whenever `hovered`
    // changes. Skipped while fullscreen because main owns visibility there.
    // On Windows/Linux setTrafficLights is a no-op in main.
    useEffect(() => {
        if (isFullScreen) return;
        ipc?.setTrafficLights(hovered).catch(() => {
            /* IPC may not be wired in browser preview — silently ignore. */
        });
    }, [hovered, ipc, isFullScreen]);

    // Subscribe to fullscreen changes from main. Pull the initial value
    // once (covers the case where the window starts in fullscreen).
    useEffect(() => {
        if (!ipc) return;
        let cancelled = false;
        ipc.isFullScreen().then(v => {
            if (!cancelled) setIsFullScreen(v);
        });
        const off = ipc.onFullScreenChange(setIsFullScreen);
        return () => {
            cancelled = true;
            off();
        };
    }, [ipc]);

    useEffect(
        () => () => {
            if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
        },
        []
    );

    // Outside Electron entirely → render nothing. Keeps the browser-served
    // version of the app pristine.
    if (!platform || !ipc) return null;

    const isMac = platform === 'darwin';

    // Mount on document.body so #root stacking contexts / transforms cannot
    // bury this layer — otherwise only the physical window edge receives drags.
    const topDragStrip =
        !isAgentFullscreen ? (
            <div
                className="electron-top-drag-strip"
                aria-hidden
                style={
                    {
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: TOP_DRAG_STRIP_HEIGHT_PX,
                        zIndex: TOP_DRAG_STRIP_Z,
                        WebkitAppRegion: 'drag',
                        pointerEvents: 'auto',
                    } as React.CSSProperties
                }
            />
        ) : null;

    const trafficLightHotZone =
        !isFullScreen ? (
            <div
                onMouseEnter={handleEnter}
                onMouseLeave={handleLeave}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: isAgentFullscreen ? 80 : 140,
                    height: 44,
                    zIndex: TRAFFIC_LIGHT_HOT_ZONE_Z,
                    WebkitAppRegion: 'no-drag',
                    pointerEvents: 'auto',
                } as React.CSSProperties}
                aria-label="Window controls"
            >
                {!isMac && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            height: '100%',
                            paddingLeft: 14,
                            opacity: hovered ? 1 : 0,
                            transition: 'opacity 160ms ease-out',
                            pointerEvents: hovered ? 'auto' : 'none',
                        }}
                    >
                        <CtrlButton kind="minimize" onClick={() => ipc.minimize()} />
                        <CtrlButton kind="maximize" onClick={() => ipc.toggleMaximize()} />
                        <CtrlButton kind="close" onClick={() => ipc.close()} />
                    </div>
                )}
            </div>
        ) : null;

    return createPortal(
        <>
            {topDragStrip}
            {trafficLightHotZone}
        </>,
        document.body,
    );
};

// ─── Custom buttons (Windows / Linux) ───────────────────────────────────
// Minimal flat circles tinted to match the macOS traffic light palette so
// the visual language is consistent across platforms. Designed to read
// well on both the light glass and the dark cosmic backgrounds the app
// switches between.

type CtrlKind = 'minimize' | 'maximize' | 'close';

// bds-ok: 以下九枚 hex 是 macOS 原生交通灯（红/黄/绿窗口按钮）的精确拟态色，
// 属于「操作系统级语义色」而非应用设计 token 体系——跨平台一致性要求
// Windows/Linux 的自定义按钮与 macOS 原生按钮逐色一致，故不做 token 化。
const CTRL_COLOR: Record<CtrlKind, { bg: string; hover: string; glyph: string }> = {
    minimize: { bg: '#FEBC2E', hover: '#FFD25C', glyph: '#7A4B00' },
    maximize: { bg: '#27C93F', hover: '#54E16C', glyph: '#0E5A1C' },
    close: { bg: '#FF5F57', hover: '#FF8278', glyph: '#7A0F0A' },
};

const CtrlButton: React.FC<{ kind: CtrlKind; onClick: () => void }> = ({ kind, onClick }) => {
    const [hover, setHover] = useState(false);
    const palette = CTRL_COLOR[kind];

    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            aria-label={kind}
            title={kind}
            style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '1px solid rgba(0,0,0,0.12)',
                background: hover ? palette.hover : palette.bg,
                padding: 0,
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: palette.glyph,
                fontSize: 9,
                lineHeight: 1,
                fontWeight: 300,
                fontFamily: 'var(--font-primary)',
                WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
        >
            {hover ? GLYPH[kind] : ''}
        </button>
    );
};

const GLYPH: Record<CtrlKind, string> = {
    minimize: '–',
    maximize: '+',
    close: '×',
};

export default WindowControls;
