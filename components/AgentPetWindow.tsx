import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Sparkles, X, Activity, Loader2 } from 'lucide-react';
import BambookPandaAgent, { type BambookPandaState } from './mascot/BambookPandaAgent';

type AgentActivitySnapshot = BambookAgentActivitySnapshot;

const CHANNEL_NAME = 'bambook-agent-os';
const MENU_WIDTH = 196;
const MENU_HEIGHT = 152;
const MENU_PET_SIZE = 160;
const PET_RENDER_SIZE = 130;
const MENU_GAP = 12;
const PET_EDGE_MARGIN = 16;
const PET_PREVIEW_STATES: BambookPandaState[] = ['idle', 'working', 'success', 'thinking', 'warning', 'wave', 'speaking'];
const PET_PREVIEW_LABELS: Record<BambookPandaState, string> = {
  idle: '待命 / 专注',
  working: '工作中',
  success: '完成 / 开心',
  thinking: '思考 / 疑问',
  warning: '提示 / 确认',
  wave: '探索 / 发现',
  speaking: '说话中',
};

const isPetPreviewState = (value: string | null): value is BambookPandaState => (
  Boolean(value) && PET_PREVIEW_STATES.includes(value as BambookPandaState)
);

const readInitialPreviewState = (): BambookPandaState | null => {
  if (typeof window === 'undefined') return null;
  const state = new URLSearchParams(window.location.search).get('bambookAgentPetState');
  return isPetPreviewState(state) ? state : null;
};

type PetPosition = { x: number; y: number };
type Rect = PetPosition & { width: number; height: number };

const clampPetPosition = (position: PetPosition): PetPosition => {
  if (typeof window === 'undefined') return position;
  return {
    x: Math.max(PET_EDGE_MARGIN, Math.min(position.x, window.innerWidth - MENU_PET_SIZE - PET_EDGE_MARGIN)),
    y: Math.max(PET_EDGE_MARGIN, Math.min(position.y, window.innerHeight - MENU_PET_SIZE - PET_EDGE_MARGIN)),
  };
};

const getInitialPetPosition = (): PetPosition => {
  if (typeof window === 'undefined') return { x: PET_EDGE_MARGIN, y: PET_EDGE_MARGIN };
  return clampPetPosition({
    x: window.innerWidth - MENU_PET_SIZE - 96,
    y: window.innerHeight - MENU_PET_SIZE - 96,
  });
};

const pointInRect = (
  pointX: number,
  pointY: number,
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
) => (
  pointX >= rectX
  && pointX <= rectX + rectWidth
  && pointY >= rectY
  && pointY <= rectY + rectHeight
);

const getMenuPosition = (petRect: Rect): PetPosition => {
  const viewportHeight = window.innerHeight;
  const y = Math.max(12, Math.min(
    petRect.y + Math.round((petRect.height - MENU_HEIGHT) / 2),
    viewportHeight - MENU_HEIGHT - 12,
  ));

  return {
    x: petRect.x + petRect.width + MENU_GAP,
    y,
  };
};

const getPetPositionWithMenuRoom = (position: PetPosition): PetPosition => {
  if (typeof window === 'undefined') return position;
  return clampPetPosition({
    x: Math.min(position.x, window.innerWidth - MENU_PET_SIZE - MENU_GAP - MENU_WIDTH - 12),
    y: position.y,
  });
};

function publishBrowserActivity(snapshot: AgentActivitySnapshot) {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type: 'agent-activity', snapshot });
  channel.close();
}

const AgentPetWindow: React.FC = () => {
  const [activity, setActivity] = useState<AgentActivitySnapshot>({
    active: false,
    source: 'pet-preview',
    label: 'Agent OS 待命',
    detail: '熊猫浮窗已连接主程序',
  });
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [previewState, setPreviewState] = useState<BambookPandaState | null>(() => readInitialPreviewState());
  const [petPosition, setPetPosition] = useState<PetPosition>(() => getInitialPetPosition());
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    dragged: boolean;
  } | null>(null);
  const petPositionRef = useRef(petPosition);
  const menuPositionRef = useRef(menuPosition);
  const isDraggingRef = useRef(isDragging);
  const isHoveredRef = useRef(isHovered);
  const mousePassthroughRef = useRef<boolean | null>(null);

  const setMousePassthrough = useCallback((passthrough: boolean) => {
    if (passthrough && mousePassthroughRef.current === passthrough) return;
    mousePassthroughRef.current = passthrough;
    void window.bambookAgent?.setPetMousePassthrough?.(passthrough).catch(() => undefined);
  }, []);

  const setMouseCapture = useCallback((capture: boolean) => {
    void window.bambookAgent?.setPetMouseCapture?.(capture).catch(() => undefined);
  }, []);

  const setPetHovered = useCallback((nextHovered: boolean) => {
    if (isHoveredRef.current === nextHovered) return;
    isHoveredRef.current = nextHovered;
    setIsHovered(nextHovered);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('bambook-agent-pet-host');
    document.body.classList.add('bambook-agent-pet-host');
    return () => {
      document.documentElement.classList.remove('bambook-agent-pet-host');
      document.body.classList.remove('bambook-agent-pet-host');
      setMousePassthrough(true);
    };
  }, [setMousePassthrough]);

  useEffect(() => {
    petPositionRef.current = petPosition;
  }, [petPosition]);

  useEffect(() => {
    menuPositionRef.current = menuPosition;
  }, [menuPosition]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    const regions = [
      {
        x: petPosition.x,
        y: petPosition.y,
        width: MENU_PET_SIZE,
        height: MENU_PET_SIZE,
      },
    ];

    if (menuPosition) {
      regions.push({
        x: menuPosition.x,
        y: menuPosition.y,
        width: MENU_WIDTH,
        height: MENU_HEIGHT,
      });
    }

    void window.bambookAgent?.setPetHitRegions?.(regions).catch(() => undefined);
  }, [menuPosition, petPosition]);

  useEffect(() => {
    const handleResize = () => setPetPosition((current) => clampPetPosition(current));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const pet = petPositionRef.current;
      const menu = menuPositionRef.current;
      const insidePet = pointInRect(event.clientX, event.clientY, pet.x, pet.y, MENU_PET_SIZE, MENU_PET_SIZE);
      const insideMenu = Boolean(menu && pointInRect(event.clientX, event.clientY, menu.x, menu.y, MENU_WIDTH, MENU_HEIGHT));
      const interactive = insidePet || insideMenu || isDraggingRef.current;

      setPetHovered(!menu && (insidePet || isDraggingRef.current));
      if (interactive) setMousePassthrough(false);
      if (interactive) {
        setMouseCapture(true);
      } else if (!isDraggingRef.current) {
        setMouseCapture(false);
        setMousePassthrough(true);
      }
    };

    const handleMouseLeave = () => {
      if (!isDraggingRef.current && !menuPositionRef.current) setPetHovered(false);
      if (!menuPositionRef.current && !isDraggingRef.current) setMousePassthrough(true);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [setMouseCapture, setMousePassthrough, setPetHovered]);

  useEffect(() => {
    const ipc = window.bambookAgent;
    const unsubscribe = ipc?.onActivity((next) => {
      if (next.source === 'assistant') {
        setActivity(next);
      }
    });

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        const next = event.data?.snapshot as AgentActivitySnapshot | undefined;
        if (next?.source === 'assistant') setActivity(next);
      };
    }

    return () => {
      unsubscribe?.();
      channel?.close();
    };
  }, []);

  useEffect(() => {
    void window.bambookAgent?.publishActivity(activity).catch(() => undefined);
    publishBrowserActivity(activity);
  }, [activity]);

  useEffect(() => {
    if (!menuPosition) void window.bambookAgent?.setPetMenuOpen?.(false).catch(() => undefined);
  }, [menuPosition]);

  useEffect(() => {
    return () => {
      void window.bambookAgent?.setPetMenuOpen?.(false).catch(() => undefined);
    };
  }, []);

  const isAssistantRunning = activity.active && (activity.source === 'assistant' || activity.source === 'pet-preview');
  const automaticPandaState: BambookPandaState = isAssistantRunning && !reducedMotion ? 'working' : 'idle';
  const pandaState = previewState ?? automaticPandaState;
  const previewLabel = previewState ? PET_PREVIEW_LABELS[previewState] : null;
  const statusText = previewLabel ? `预览: ${previewLabel}` : (isAssistantRunning ? (activity.label || 'Bambook Agent 正在工作') : 'Agent 待命');
  const currentPreviewIndex = PET_PREVIEW_STATES.indexOf(previewState ?? pandaState);
  const nextPreviewState = PET_PREVIEW_STATES[(currentPreviewIndex + 1) % PET_PREVIEW_STATES.length];
  const runningActionLabel = isAssistantRunning ? '关闭' : '开启';

  const openAssistant = () => {
    setMenuPosition(null);
    setMousePassthrough(true);
    void window.bambookAgent?.focusView?.('assistant');
  };

  const switchPreviewState = () => {
    setPreviewState(nextPreviewState);
  };

  const toggleAgentRunning = () => {
    const nextActive = !isAssistantRunning;
    setPreviewState(null);
    if (nextActive) setReducedMotion(false);
    setActivity({
      active: nextActive,
      source: 'pet-preview',
      label: nextActive ? 'Agent Running' : 'Agent OS 待命',
      detail: nextActive ? '手动开启 Agent Running 状态' : '手动关闭 Agent Running 状态',
    });
  };

  const hidePetWindow = () => {
    setMenuPosition(null);
    window.close();
  };

  const movePetBy = useCallback((dx: number, dy: number) => {
    setPetPosition((current) => {
      const next = clampPetPosition({ x: current.x + dx, y: current.y + dy });
      petPositionRef.current = next;
      return next;
    });
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    if (event.button !== 0) return;
    if (dragRef.current) return;
    event.preventDefault();
    setMenuPosition(null);
    setIsDragging(true);
    setPetHovered(true);
    setMousePassthrough(false);
    setMouseCapture(true);
    setDragDelta({ x: 0, y: 0 });
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      dragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startMouseDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    setMenuPosition(null);
    setIsDragging(true);
    setPetHovered(true);
    setMousePassthrough(false);
    setMouseCapture(true);
    setDragDelta({ x: 0, y: 0 });
    dragRef.current = {
      pointerId: null,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      dragged: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.screenX - drag.lastX;
    const dy = event.screenY - drag.lastY;
    const totalX = event.screenX - drag.startX;
    const totalY = event.screenY - drag.startY;
    if (Math.abs(totalX) > 3 || Math.abs(totalY) > 3) drag.dragged = true;
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    setDragDelta({ x: totalX, y: totalY });
    if (dx !== 0 || dy !== 0) {
      movePetBy(dx, dy);
    }
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== null) return;
      const dx = event.screenX - drag.lastX;
      const dy = event.screenY - drag.lastY;
      const totalX = event.screenX - drag.startX;
      const totalY = event.screenY - drag.startY;
      if (Math.abs(totalX) > 3 || Math.abs(totalY) > 3) drag.dragged = true;
      drag.lastX = event.screenX;
      drag.lastY = event.screenY;
      setDragDelta({ x: totalX, y: totalY });
      if (dx !== 0 || dy !== 0) {
        movePetBy(dx, dy);
      }
    };

    const finishMouseDrag = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== null) return;
      dragRef.current = null;
      setIsDragging(false);
      setDragDelta({ x: 0, y: 0 });
      setMouseCapture(false);
      const pet = petPositionRef.current;
      const menu = menuPositionRef.current;
      const insidePet = pointInRect(event.clientX, event.clientY, pet.x, pet.y, MENU_PET_SIZE, MENU_PET_SIZE);
      const insideMenu = Boolean(menu && pointInRect(event.clientX, event.clientY, menu.x, menu.y, MENU_WIDTH, MENU_HEIGHT));
      setPetHovered(insidePet || insideMenu);
      setMouseCapture(false);
      setMousePassthrough(true);
      if (!drag.dragged) void window.bambookAgent?.focusView?.('assistant');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', finishMouseDrag);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', finishMouseDrag);
    };
  }, [movePetBy, setMouseCapture, setMousePassthrough, setPetHovered]);

  const finishPointerGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    setDragDelta({ x: 0, y: 0 });
    setMouseCapture(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    const pet = petPositionRef.current;
    const menu = menuPositionRef.current;
    const insidePet = pointInRect(event.clientX, event.clientY, pet.x, pet.y, MENU_PET_SIZE, MENU_PET_SIZE);
    const insideMenu = Boolean(menu && pointInRect(event.clientX, event.clientY, menu.x, menu.y, MENU_WIDTH, MENU_HEIGHT));
    setPetHovered(insidePet || insideMenu);
    setMouseCapture(false);
    setMousePassthrough(true);
    if (!drag.dragged) void window.bambookAgent?.focusView?.('assistant');
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPetHovered(false);
    setMouseCapture(true);
    setMousePassthrough(false);

    const positionMenu = (pet = petPositionRef.current) => {
      const visiblePet = getPetPositionWithMenuRoom(pet);
      if (visiblePet.x !== pet.x || visiblePet.y !== pet.y) {
        petPositionRef.current = visiblePet;
        setPetPosition(visiblePet);
      }
      setMenuPosition(getMenuPosition({
        x: visiblePet.x,
        y: visiblePet.y,
        width: MENU_PET_SIZE,
        height: MENU_PET_SIZE,
      }));
    };

    if (window.bambookAgent?.setPetMenuOpen) {
      void window.bambookAgent.setPetMenuOpen(true).finally(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => positionMenu()));
      });
      return;
    }

    positionMenu();
  };

  const windowClassName = [
    'bambook-agent-pet-window',
    isHovered ? 'bambook-agent-pet-window--hovered' : '',
    pandaState === 'working' && !reducedMotion ? 'bambook-agent-pet-window--running' : '',
    menuPosition ? 'bambook-agent-pet-window--menu-open' : '',
    reducedMotion ? 'bambook-agent-pet-window--reduced-motion' : '',
  ].filter(Boolean).join(' ');
  const popupX = petPosition.x + MENU_PET_SIZE / 2;
  const popupTop = Math.min(
    petPosition.y + MENU_PET_SIZE - 4,
    Math.max(12, window.innerHeight - 44),
  );
  const dragTilt = Math.max(-10, Math.min(10, dragDelta.x * 0.08));
  const dragLift = isDragging ? Math.max(-10, Math.min(0, -4 - Math.abs(dragDelta.y) * 0.015)) : 0;
  const dragScale = isDragging ? 0.985 : 1;
  const petVisualTransform = `translateY(${dragLift}px) rotate(${isDragging ? dragTilt : 0}deg) scale(${dragScale})`;

  return (
    <div className={windowClassName}>
      <div
        className="bambook-agent-pet-orb"
        style={{ left: petPosition.x, top: petPosition.y }}
        title={statusText}
        onMouseEnter={() => {
          setPetHovered(true);
          setMouseCapture(true);
          setMousePassthrough(false);
        }}
        onMouseLeave={() => {
          if (!isDraggingRef.current && !menuPositionRef.current) setPetHovered(false);
          if (!isDraggingRef.current && !menuPositionRef.current) {
            setMouseCapture(false);
            setMousePassthrough(true);
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={finishPointerGesture}
        onMouseDown={startMouseDrag}
        onContextMenu={handleContextMenu}
      >
        <div
          className="bambook-agent-pet-visual"
          style={{ transform: petVisualTransform }}
        >
          <BambookPandaAgent
            size={PET_RENDER_SIZE}
            skin="bare"
            state={pandaState}
            isDarkMode
            title="Bambook Panda (V2 Enhanced)"
            isHovered={isHovered}
            isDragging={false}
            dragDeltaX={0}
            dragDeltaY={0}
          />
        </div>
      </div>

      {isAssistantRunning && !menuPosition && (
        <div className="bambook-agent-pet-task-popup no-drag" style={{ left: popupX, top: popupTop }}>
          <Loader2 size={14} className="animate-spin" />
          <span>{activity.detail || activity.label || 'Agent 正在运行任务...'}</span>
        </div>
      )}

      {isHovered && !menuPosition && !isAssistantRunning && (
        <div className="bambook-agent-pet-hint no-drag" style={{ left: popupX, top: popupTop }}>{statusText}</div>
      )}

      {menuPosition && (
        <div
          className="bambook-agent-pet-menu no-drag"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseEnter={() => {
            setPetHovered(false);
            setMouseCapture(true);
            setMousePassthrough(false);
          }}
          onMouseLeave={(event) => {
            const pet = petPositionRef.current;
            const insidePet = pointInRect(event.clientX, event.clientY, pet.x, pet.y, MENU_PET_SIZE, MENU_PET_SIZE);
            setPetHovered(menuPositionRef.current ? false : insidePet);
            if (!insidePet) {
              setMouseCapture(false);
              setMousePassthrough(true);
            }
          }}
        >
          <button type="button" onClick={openAssistant}>
            <Bot size={14} />
            <span>打开 AI 助手</span>
          </button>
          <button type="button" onClick={switchPreviewState}>
            <Sparkles size={14} />
            <span>状态切换: {PET_PREVIEW_LABELS[nextPreviewState]}</span>
          </button>
          <button type="button" onClick={toggleAgentRunning} data-active={isAssistantRunning ? 'true' : undefined}>
            <Activity size={14} />
            <span>Agent Running: {runningActionLabel}</span>
          </button>
          <button type="button" onClick={hidePetWindow}>
            <X size={14} />
            <span>隐藏浮窗</span>
          </button>
        </div>
      )}

    </div>
  );
};

export default AgentPetWindow;
