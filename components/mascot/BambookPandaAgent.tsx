import React from 'react';
import { motion } from 'framer-motion';
import pandaWorkingSvgUrl from './assets/panda-working.svg';

export type BambookPandaSkin = 'bare' | 'tech' | 'polo';
export type BambookPandaState = 'idle' | 'thinking' | 'wave' | 'speaking' | 'working' | 'success' | 'warning';

export type BambookPandaAgentProps = {
  className?: string;
  size?: number;
  skin?: BambookPandaSkin;
  state?: BambookPandaState;
  isDarkMode?: boolean;
  title?: string;
  isHovered?: boolean;
  isDragging?: boolean;
  dragDeltaX?: number;
  dragDeltaY?: number;
};

export const BAMBOOK_PANDA_RIG = {
  root: { x: 64, y: 64 },
  torso: { x: 64, y: 82 },
  head: { x: 64, y: 43 },
  leftEar: { x: 39, y: 26 },
  rightEar: { x: 89, y: 26 },
  leftEye: { x: 48, y: 45 },
  rightEye: { x: 80, y: 45 },
  leftUpperArm: { x: 36, y: 75 },
  rightUpperArm: { x: 92, y: 75 },
  leftForearm: { x: 32, y: 91 },
  rightForearm: { x: 96, y: 91 },
  leftLeg: { x: 52, y: 101 },
  rightLeg: { x: 76, y: 101 },
} as const;

export const BAMBOOK_PANDA_SKINS = {
  bare: {
    collar: 'transparent',
    collarStroke: 'transparent',
    collarGlow: 'transparent',
    shirt: 'transparent',
    badge: 'var(--os-vnext-brand-blue)',
    sleeve: '#0b1728',
  },
  tech: {
    collar: '#dcecff',
    collarStroke: 'var(--os-vnext-brand-blue-soft)',
    collarGlow: 'rgb(var(--os-vnext-brand-blue-soft-rgb) / 0.74)',
    shirt: 'transparent',
    badge: 'var(--os-vnext-brand-blue)',
    sleeve: '#0b1728',
  },
  polo: {
    collar: '#e9f7ff',
    collarStroke: '#9cc9ef',
    collarGlow: 'rgb(var(--os-vnext-brand-blue-soft-rgb) / 0.40)',
    shirt: '#a9d0ec',
    badge: 'var(--os-vnext-brand-blue-strong)',
    sleeve: '#8fbfdf',
  },
} as const;

export const BAMBOOK_PANDA_MOTIONS = {
  idle: {
    root: { y: [0, -0.45, 0], transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 1] } },
    head: { y: [0, 0.22, 0], rotate: [0, -0.55, 0.45, 0], transition: { duration: 5.2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.34, 0.68, 1] } },
    leftArm: { rotate: [0, 1.8, 0], transition: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } },
    rightArm: { rotate: [0, -1.8, 0], transition: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } },
  },
  thinking: {
    root: { y: [0, -2, 0], scaleY: [1, 0.96, 1], scaleX: [1, 1.02, 1], transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } },
    head: { y: [0, 1, 0], rotate: [-2, 3.4, -1.2], transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } },
    leftArm: { rotate: [0, -4, 0], transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } },
    rightArm: { rotate: [0, 4, 0], transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } },
  },
  wave: {
    root: { y: [0, -1.5, 0], scaleY: [1, 0.94, 1], scaleX: [1, 1.03, 1], transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } },
    head: { rotate: [0, -2, 2, 0], transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } },
    leftArm: { rotate: [0, 3, 0], transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } },
    rightArm: { rotate: [-12, -54, -12], transition: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } },
  },
} as const;

const stateToMotionKey = (state: BambookPandaState): keyof typeof BAMBOOK_PANDA_MOTIONS => {
  if (state === 'thinking' || state === 'working') return 'thinking';
  if (state === 'wave' || state === 'success') return 'wave';
  return 'idle';
};

const WORKING_RIGHT_HAND_PATH = 'M176.603 168.917C180.334 179.876 181.869 196.91 169.676 209.021C160.108 218.545 133 224 130.352 209.021C127.691 193.965 141.659 196.997 151.566 189C161.346 181.161 163.495 163.597 176.603 168.917Z';

const BambookPandaAgent: React.FC<BambookPandaAgentProps> = ({
  className = '',
  size = 64,
  skin = 'tech',
  state = 'idle',
  isDarkMode = false,
  title = 'Bambook Panda Agent',
  isHovered = false,
  isDragging = false,
  dragDeltaX = 0,
  dragDeltaY = 0,
}) => {
  const palette = BAMBOOK_PANDA_SKINS[skin];
  const motionSet = BAMBOOK_PANDA_MOTIONS[stateToMotionKey(state)];
  const warning = state === 'warning';
  const reactId = React.useId().replace(/:/g, '');
  const id = (name: string) => `${reactId}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const isWorking = state === 'working';
  const isThinking = state === 'thinking';
  const isSuccess = state === 'success';
  const isWarning = state === 'warning';
  const isExploring = state === 'wave';
  const isSpeaking = state === 'speaking';
  const rootAnimate = isDragging
    ? {
        scale: 0.94,
        rotate: Math.max(-25, Math.min(25, dragDeltaX * 0.3)),
        y: Math.max(-20, Math.min(5, dragDeltaY * 0.3 - 10)),
      }
    : isHovered
      ? { scale: 1.04, rotate: 0, y: 0 }
      : { ...(motionSet.root as any), rotate: 0 };
  const rootTransition = isDragging || isHovered
    ? { type: 'spring' as const, stiffness: 300, damping: 20 }
    : undefined;
  const headAnimate = isDragging
    ? {
        x: Math.max(-12, Math.min(12, -dragDeltaX * 0.15)),
        y: Math.max(-10, Math.min(10, -dragDeltaY * 0.15)),
        rotate: Math.max(-15, Math.min(15, -dragDeltaX * 0.2)),
      }
    : isHovered
      ? { x: 0, y: 0, rotate: 0 }
      : motionSet.head;

  if (isWorking) {
    const workingAnimate = isDragging
      ? {
          scale: 0.94,
          rotate: dragDeltaX * 0.5,
          y: dragDeltaY * 0.5 - 10,
        }
      : {
          scale: isHovered ? [1.04, 1.055, 1.04] : [1, 1.015, 1],
          rotate: isHovered ? [-1.2, 0.8, -1.2] : [-0.6, 0.4, -0.6],
          y: isHovered ? [-3, -5, -3] : [0, -2, 0],
        };

    return (
      <motion.span
        className={className}
        role="img"
        aria-label={title}
        initial={false}
        animate={workingAnimate}
        transition={isDragging
          ? { type: 'spring', stiffness: 300, damping: 20 }
          : { duration: 1.35, repeat: Infinity, ease: 'easeInOut' }
        }
        style={{
          display: 'block',
          position: 'relative',
          width: size,
          height: size,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <img
          src={pandaWorkingSvgUrl}
          width={size}
          height={size}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
        <motion.svg
          viewBox="0 0 256 256"
          aria-hidden="true"
          initial={false}
          style={{
            position: 'absolute',
            top: 2,
            left: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
          }}
        >
          <defs>
            <radialGradient
              id={id('workingRightHand')}
              cx="0"
              cy="0"
              r="1"
              gradientUnits="userSpaceOnUse"
              gradientTransform="translate(172.562 185.852) rotate(25.1381) scale(21.2044 45.4869)"
            >
              <stop stopColor="#27364B" />
              <stop offset="0.58" stopColor="#0D1727" />
              <stop offset="1" stopColor="#030914" />
            </radialGradient>
            <clipPath id={id('workingRightShoulderClip')}>
              <rect x="126" y="150" width="78" height="32" rx="0" />
            </clipPath>
            <clipPath id={id('workingRightHandTipClip')}>
              <rect x="126" y="178" width="78" height="72" rx="0" />
            </clipPath>
          </defs>
          <g clipPath={url('workingRightShoulderClip')}>
            <path d={WORKING_RIGHT_HAND_PATH} fill={url('workingRightHand')} />
          </g>
          <motion.g
            clipPath={url('workingRightHandTipClip')}
            animate={{
              y: [0, 3.5, 0, 1.6, 0],
              rotate: [0, 1.8, 0, 0.8, 0],
            }}
            transition={{
              duration: 0.72,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{ originX: 0.56, originY: 0.82 }}
          >
            <path d={WORKING_RIGHT_HAND_PATH} fill={url('workingRightHand')} />
          </motion.g>
        </motion.svg>
      </motion.span>
    );
  }

  return (
    <motion.svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      style={{ overflow: 'visible' }}
      role="img"
      aria-label={title}
      initial={false}
    >
      <title>{title}</title>
      <defs>
        <radialGradient id={id('furWhite')} cx="38%" cy="20%" r="76%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="52%" stopColor="#edf6ff" />
          <stop offset="100%" stopColor="#c7d9e8" />
        </radialGradient>
        <radialGradient id={id('furWhiteEdge')} cx="45%" cy="18%" r="82%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.82" />
          <stop offset="62%" stopColor="#eff8ff" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#7db7ff" stopOpacity="0.22" />
        </radialGradient>
        <radialGradient id={id('furBlack')} cx="36%" cy="18%" r="78%">
          <stop offset="0%" stopColor="#27364b" />
          <stop offset="58%" stopColor="#0d1727" />
          <stop offset="100%" stopColor="#030914" />
        </radialGradient>
        <linearGradient id={id('bellyShade')} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.86" />
          <stop offset="100%" stopColor="#c9ddec" stopOpacity="0.78" />
        </linearGradient>
        <radialGradient id={id('convexHighlight')} cx="42%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.58" />
          <stop offset="58%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('poloCloth')} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#d8efff" />
          <stop offset="45%" stopColor={palette.shirt} />
          <stop offset="100%" stopColor="#6ea9d4" />
        </linearGradient>
        <linearGradient id={id('techGlass')} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.86" />
          <stop offset="48%" stopColor={palette.collar} stopOpacity="0.50" />
          <stop offset="100%" stopColor="var(--os-vnext-brand-blue-soft)" stopOpacity="0.24" />
        </linearGradient>
        <linearGradient id={id('blackFurHighlight')} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#52647e" stopOpacity="0.38" />
          <stop offset="45%" stopColor="#1c2a3d" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#030914" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id('pawPad')} cx="42%" cy="34%" r="68%">
          <stop offset="0%" stopColor="#7b6258" />
          <stop offset="100%" stopColor="#2a1c1f" />
        </radialGradient>
        <radialGradient id={id('jointGlow')} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={warning ? '#f59e0b' : '#dff0ff'} />
          <stop offset="48%" stopColor={warning ? '#f59e0b' : palette.badge} />
          <stop offset="100%" stopColor={warning ? '#fb923c' : 'var(--os-vnext-brand-blue-strong)'} />
        </radialGradient>
        <radialGradient id={id('figmaBlackLeftLeg')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(318.475 507.837) rotate(180) scale(56.8591 64.7593)">
          <stop stopColor="#27364B" />
          <stop offset="0.58" stopColor="#0D1727" />
          <stop offset="1" stopColor="#030914" />
        </radialGradient>
        <radialGradient id={id('figmaBlackRightLeg')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(396.687 507.944) scale(56.8591 64.7593)">
          <stop stopColor="#27364B" />
          <stop offset="0.58" stopColor="#0D1727" />
          <stop offset="1" stopColor="#030914" />
        </radialGradient>
        <radialGradient id={id('figmaBlackLeftArm')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(247.926 430.629) rotate(-160) scale(42.4087 90.9737)">
          <stop stopColor="#27364B" />
          <stop offset="0.58" stopColor="#0D1727" />
          <stop offset="1" stopColor="#030914" />
        </radialGradient>
        <radialGradient id={id('figmaBlackRightArm')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(468.573 430.629) rotate(-20) scale(42.4087 90.9737)">
          <stop stopColor="#27364B" />
          <stop offset="0.58" stopColor="#0D1727" />
          <stop offset="1" stopColor="#030914" />
        </radialGradient>
        <radialGradient id={id('figmaBlackBody')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(331.186 401.161) scale(164.738 145.874)">
          <stop stopColor="#27364B" />
          <stop offset="0.58" stopColor="#0D1727" />
          <stop offset="1" stopColor="#030914" />
        </radialGradient>
        <radialGradient id={id('figmaBelly')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(333.512 475.613) scale(152.771 81.9667)">
          <stop stopColor="white" />
          <stop offset="0.52" stopColor="#EDF6FF" />
          <stop offset="1" stopColor="#C7D9E8" />
        </radialGradient>
        <radialGradient id={id('figmaBlackLeftEar')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(247.449 171.605) scale(78.9719 71.717)">
          <stop stopColor="#27364B" />
          <stop offset="0.58" stopColor="#0D1727" />
          <stop offset="1" stopColor="#030914" />
        </radialGradient>
        <radialGradient id={id('figmaBlackRightEar')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(439.203 171.605) scale(78.9719 71.717)">
          <stop stopColor="#27364B" />
          <stop offset="0.58" stopColor="#0D1727" />
          <stop offset="1" stopColor="#030914" />
        </radialGradient>
        <radialGradient id={id('figmaHead')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(319.523 215.2) scale(256.353 209.76)">
          <stop stopColor="white" />
          <stop offset="0.52" stopColor="#EDF6FF" />
          <stop offset="1" stopColor="#C7D9E8" />
        </radialGradient>
        <linearGradient id={id('laptopLid')} x1="36" x2="91" y1="78" y2="111" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eef3fb" />
          <stop offset="0.56" stopColor="#c5cede" />
          <stop offset="1" stopColor="#8e9aae" />
        </linearGradient>
        <linearGradient id={id('laptopBase')} x1="32" x2="96" y1="107" y2="116" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d9e1ee" />
          <stop offset="1" stopColor="#7f8da2" />
        </linearGradient>
        <radialGradient id={id('propGlass')} cx="36%" cy="24%" r="70%">
          <stop stopColor="#f8fbff" />
          <stop offset="0.62" stopColor="#b9c8df" />
          <stop offset="1" stopColor="#7587a4" />
        </radialGradient>
        <filter id={id('softShadow')} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor={isDarkMode ? '#000814' : '#6aa5d8'} floodOpacity="0.25" />
        </filter>
      </defs>

      <g opacity={isDarkMode ? 0.42 : 0.30} transform="matrix(0.25 0 0 0.25 -26 -26)">
        <path opacity="0.28" d="M360 599.2C441.738 599.2 508 586.306 508 570.4C508 554.494 441.738 541.6 360 541.6C278.262 541.6 212 554.494 212 570.4C212 586.306 278.262 599.2 360 599.2Z" fill={isDarkMode ? '#020814' : '#5F7388'} />
        <path opacity="0.24" d="M360 581.6C415.228 581.6 460 573.362 460 563.2C460 553.038 415.228 544.8 360 544.8C304.772 544.8 260 553.038 260 563.2C260 573.362 304.772 581.6 360 581.6Z" fill={isDarkMode ? '#06101d' : '#8395A8'} />
        <path opacity="0.2" d="M328 572.8C346.115 572.8 360.8 567.069 360.8 560C360.8 552.931 346.115 547.2 328 547.2C309.885 547.2 295.2 552.931 295.2 560C295.2 567.069 309.885 572.8 328 572.8Z" fill={isDarkMode ? '#020814' : '#475569'} />
        <path opacity="0.2" d="M392 572.8C410.115 572.8 424.8 567.069 424.8 560C424.8 552.931 410.115 547.2 392 547.2C373.885 547.2 359.2 552.931 359.2 560C359.2 567.069 373.885 572.8 392 572.8Z" fill={isDarkMode ? '#020814' : '#475569'} />
      </g>

      <motion.g 
      style={{ originX: 0.5, originY: 0.58 }} 
      filter={url('softShadow')}
      animate={rootAnimate as any}
      transition={rootTransition}
    >
        <g transform="matrix(0.25 0 0 0.25 -26 -26)">
          <path d="M266.163 499.254C250.904 514.405 267.827 556.106 275.658 570.753C276.812 572.912 278.828 574.433 281.206 575.011C297.477 578.967 313.562 577.89 321.93 575.365C324.217 574.675 325.893 572.822 326.699 570.573C339.678 534.37 320.817 507.88 306.066 499.254C295.129 492.899 273.771 491.627 266.163 499.254Z" fill={url('figmaBlackLeftLeg')} />
          <path d="M449 499.362C464.259 514.513 447.336 556.214 439.504 570.86C438.35 573.019 436.335 574.54 433.956 575.119C417.685 579.075 401.601 577.997 393.233 575.473C390.946 574.783 389.27 572.93 388.464 570.681C375.485 534.478 394.345 507.988 409.096 499.362C420.033 493.006 441.392 491.735 449 499.362Z" fill={url('figmaBlackRightLeg')} />
          <path d="M275.068 407.616C252.648 413.077 231.608 443.741 223.499 476.546C217.101 502.312 228.592 520.104 248.071 520.383C265.021 520.593 275.04 501.253 278.499 476.546C281.821 452.215 297.488 423.5 275.068 407.616Z" fill={url('figmaBlackLeftArm')} />
          <path d="M441.431 407.616C463.851 413.077 484.891 443.741 493 476.546C499.398 502.312 487.907 520.104 468.428 520.383C451.478 520.593 441.459 501.253 438 476.546C434.678 452.215 419.011 423.5 441.431 407.616Z" fill={url('figmaBlackRightArm')} />
          <path d="M285.188 395.619C305.089 375.745 326.747 367 358.588 367C390.43 367 408.838 375.745 428.739 395.619C452.62 425.033 476.121 491.811 443.483 530.765C417.214 561.769 300.236 561.769 273.967 530.765C241.329 491.811 261.307 425.033 285.188 395.619Z" fill={url('figmaBlackBody')} />
          <path d="M358.345 454.543C378.904 454.543 399.456 456.139 417.283 459.328C435.016 462.501 450.001 467.243 459.62 473.521C465.415 503.575 462.787 524.332 447.427 537.634C439.708 544.319 428.729 549.165 413.866 552.337C399.005 555.509 380.293 557 357.139 557C336.902 557 319.368 555.881 304.741 553.173C290.111 550.464 278.421 546.172 269.845 539.848C261.282 533.534 255.802 525.18 253.601 514.29C251.404 503.423 252.467 490.003 257.048 473.533C266.667 467.249 281.66 462.503 299.405 459.328C317.232 456.139 337.786 454.543 358.345 454.543Z" fill={url('figmaBelly')} />
        </g>

        <motion.g 
          animate={headAnimate as any}
          style={{ originX: 0.5, originY: 0.34 }}
        >
          <g transform="matrix(0.25 0 0 0.25 -26 -26)">
            <path d="M261.623 247C289.581 247 312.246 226.417 312.246 201.028C312.246 175.638 289.581 155.055 261.623 155.055C233.665 155.055 211 175.638 211 201.028C211 226.417 233.665 247 261.623 247Z" fill={url('figmaBlackLeftEar')} />
            <path d="M453.377 247C481.335 247 504 226.417 504 201.028C504 175.638 481.335 155.055 453.377 155.055C425.419 155.055 402.754 175.638 402.754 201.028C402.754 226.417 425.419 247 453.377 247Z" fill={url('figmaBlackRightEar')} />
            <path opacity="0.08" d="M265.458 207.297C284.097 207.297 299.207 193.575 299.207 176.648C299.207 159.722 284.097 146 265.458 146C246.819 146 231.709 159.722 231.709 176.648C231.709 193.575 246.819 207.297 265.458 207.297Z" fill="white" />
            <path opacity="0.08" d="M449.542 207.297C468.181 207.297 483.291 193.575 483.291 176.648C483.291 159.722 468.181 146 449.542 146C430.903 146 415.793 159.722 415.793 176.648C415.793 193.575 430.903 207.297 449.542 207.297Z" fill="white" />
            <path opacity="0.74" d="M336 168C348 144 368 140 388 156C368 152 352 156 336 168Z" fill="white" />
            <path d="M360 160C460 160 524.5 229.5 528.5 305.5C536.5 391.5 470 431 360 431C250 431 182.5 391.5 190.5 305.5C194.5 229.5 260 160 360 160Z" fill={url('figmaHead')} />
            <path d="M310.056 272.512C344.02 295.152 293.832 373.336 262.512 351.756C231.188 330.18 276.096 249.872 310.056 272.512Z" fill="#111A28" />
            <path d="M409.68 274.02C375.716 296.664 425.904 374.844 457.224 353.268C488.548 331.688 443.64 251.38 409.68 274.02Z" fill="#111A28" />
            <motion.g
              initial={false}
              animate={isSpeaking || isSuccess ? undefined : { scaleY: [1, 1, 0.08, 1, 1] }}
              transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.86, 0.895, 0.93, 1] }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              <path d="M289.236 330.912C301.165 330.912 310.836 319.45 310.836 305.312C310.836 291.174 301.165 279.712 289.236 279.712C277.307 279.712 267.636 291.174 267.636 305.312C267.636 319.45 277.307 330.912 289.236 330.912Z" fill="#07101D" />
              <path d="M425.328 331.84C437.257 331.84 446.928 320.379 446.928 306.24C446.928 292.102 437.257 280.64 425.328 280.64C413.399 280.64 403.728 292.102 403.728 306.24C403.728 320.379 413.399 331.84 425.328 331.84Z" fill="#07101D" />
              <path opacity="0.82" d="M288.436 321.312C295.505 321.312 301.236 314.507 301.236 306.112C301.236 297.717 295.505 290.912 288.436 290.912C281.367 290.912 275.636 297.717 275.636 306.112C275.636 314.507 281.367 321.312 288.436 321.312Z" fill="#203653" />
              <path opacity="0.82" d="M424.528 322.24C431.597 322.24 437.328 315.435 437.328 307.04C437.328 298.645 431.597 291.84 424.528 291.84C417.459 291.84 411.728 298.645 411.728 307.04C411.728 315.435 417.459 322.24 424.528 322.24Z" fill="#203653" />
              <path d="M294.036 303.312C298.896 303.312 302.836 299.372 302.836 294.512C302.836 289.652 298.896 285.712 294.036 285.712C289.176 285.712 285.236 289.652 285.236 294.512C285.236 299.372 289.176 303.312 294.036 303.312Z" fill="#EFF8FF" />
              <path d="M430.128 304.24C434.988 304.24 438.928 300.3 438.928 295.44C438.928 290.58 434.988 286.64 430.128 286.64C425.268 286.64 421.328 290.58 421.328 295.44C421.328 300.3 425.268 304.24 430.128 304.24Z" fill="#EFF8FF" />
              <path opacity="0.65" d="M280.8 318C283.009 318 284.8 316.209 284.8 314C284.8 311.791 283.009 310 280.8 310C278.591 310 276.8 311.791 276.8 314C276.8 316.209 278.591 318 280.8 318Z" fill="#EFF8FF" />
              <path opacity="0.65" d="M416.8 318C419.009 318 420.8 316.209 420.8 314C420.8 311.791 419.009 310 416.8 310C414.591 310 412.8 311.791 412.8 314C412.8 316.209 414.591 318 416.8 318Z" fill="#EFF8FF" />
            </motion.g>
            <motion.g
              initial={false}
              animate={isSpeaking || isSuccess ? { opacity: 0 } : { opacity: [0, 0, 0.9, 0, 0] }}
              transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.86, 0.895, 0.93, 1] }}
            >
              <path d="M269 306C279 312 300 312 309 306" stroke="#101827" strokeWidth="6" strokeLinecap="round" fill="none" />
              <path d="M405 307C415 313 436 313 445 307" stroke="#101827" strokeWidth="6" strokeLinecap="round" fill="none" />
            </motion.g>
            <path opacity="0.74" d="M316.576 331.858C321.936 310.714 399.22 310.714 404.576 331.858C409.936 353.002 376.576 370.258 360.576 370.258C344.576 370.258 311.22 353.002 316.576 331.858Z" fill="#F5F9FC" />
            <path d="M337.836 333.47C340.252 322.266 379.42 322.266 381.836 333.47C384.252 344.678 369.036 351.47 359.836 351.47C350.636 351.47 335.42 344.678 337.836 333.47Z" fill="#101827" />
            <path d="M358.712 351.8V370.35" stroke="#26364B" strokeWidth="4" strokeLinecap="round" />
            <path d="M337.58 362.802C348.38 373.202 370.78 373.202 381.58 362.802" stroke="#52637A" strokeWidth="5.2" strokeLinecap="round" fill="none" />
          </g>
        </motion.g>

        {isThinking && (
          <motion.g
            initial={false}
            animate={{ rotate: [-4, 2, -4], y: [0, -0.8, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{ originX: 0.42, originY: 0.64 }}
          >
            <path d="M50.2 72.2C43.6 73 39.8 78.1 41.2 84.3C42.8 91.2 52.6 92.8 57 86.6C60.8 81.2 57.4 71.4 50.2 72.2Z" fill={url('figmaBlackLeftArm')} />
            <ellipse cx="50.7" cy="78.8" rx="6.1" ry="5.2" fill="#111A28" />
            <circle cx="47.8" cy="77.2" r="1.1" fill="#27364B" opacity="0.82" />
          </motion.g>
        )}

        {isThinking && (
          <motion.g
            initial={false}
            animate={{ opacity: [0.35, 0.9, 0.35], y: [1.5, -1.5, 1.5] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <circle cx="85" cy="50" r="2.4" fill="#6F7C97" opacity="0.75" />
            <circle cx="91" cy="43" r="1.8" fill="#6F7C97" opacity="0.55" />
            <circle cx="95" cy="35.5" r="1.25" fill="#6F7C97" opacity="0.42" />
          </motion.g>
        )}

        {isSuccess && (
          <motion.g
            initial={false}
            animate={{ rotate: [-8, -24, -8], y: [0, -2, 0] }}
            transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            style={{ originX: 0.35, originY: 0.62 }}
          >
            <path d="M41.5 73.5C35.7 70.6 32.2 65 34.6 60.4C37 55.9 43.9 56.3 48.8 61.4C53 65.8 53.4 72.6 49.5 76.3C47.2 78.5 44.3 76.8 41.5 73.5Z" fill={url('figmaBlackLeftArm')} />
            <circle cx="42.8" cy="60.7" r="5.6" fill="#111A28" />
            <path d="M41.4 56.2C39.7 53.8 38.4 51.6 37.2 49.8" stroke="#111A28" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          </motion.g>
        )}

        {isSuccess && (
          <motion.g
            initial={false}
            animate={{ scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ originX: 0.5, originY: 0.53 }}
          >
            <path d="M58.6 64.7C61.5 70.9 67 70.9 69.8 64.7C68.7 73.5 59.8 73.5 58.6 64.7Z" fill="#E97870" stroke="#7D2E39" strokeWidth="0.9" strokeLinejoin="round" />
            <path d="M60 64.5C62.4 66.2 66 66.2 68.3 64.5" stroke="#FFF2F1" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.8" />
            <path d="M46.3 47.5C48.4 51 51.6 51 53.8 47.5" stroke="#EAF5FF" strokeWidth="2.3" strokeLinecap="round" fill="none" opacity="0.9" />
            <path d="M74.6 47.5C76.8 51 80 51 82.2 47.5" stroke="#EAF5FF" strokeWidth="2.3" strokeLinecap="round" fill="none" opacity="0.9" />
          </motion.g>
        )}

        {isWarning && (
          <motion.g
            initial={false}
            animate={{ y: [0, -1.2, 0] }}
            transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
          >
            <path d="M37.5 84.8C33 79 31.5 71.7 35.3 68.4C39 65.1 46.8 68.1 50.4 74.7C54 81.2 51.4 88 45.4 89.2C42.3 89.8 39.7 87.7 37.5 84.8Z" fill={url('figmaBlackLeftArm')} />
            <path d="M90.5 84.8C95 79 96.5 71.7 92.7 68.4C89 65.1 81.2 68.1 77.6 74.7C74 81.2 76.6 88 82.6 89.2C85.7 89.8 88.3 87.7 90.5 84.8Z" fill={url('figmaBlackRightArm')} />
            <circle cx="43.2" cy="75.5" r="5" fill="#111A28" />
            <circle cx="84.8" cy="75.5" r="5" fill="#111A28" />
            <path d="M76.7 47.8C79.2 50.4 82.2 50.4 84.6 47.8" stroke="#EAF5FF" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.94" />
            <path d="M91.2 35.8L93.4 41.4L99 43.6L93.4 45.8L91.2 51.4L89 45.8L83.4 43.6L89 41.4Z" fill="#F4C55D" />
          </motion.g>
        )}

        {isExploring && (
          <motion.g
            initial={false}
            animate={{ rotate: [-3, 4, -3], x: [0, 1, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ originX: 0.37, originY: 0.47 }}
          >
            <circle cx="45" cy="48.8" r="12.3" fill="none" stroke={url('propGlass')} strokeWidth="3.8" />
            <circle cx="45" cy="48.8" r="9.3" fill="#EAF5FF" opacity="0.12" />
            <path d="M36.7 59.2L29.3 68.5" stroke="#7587A4" strokeWidth="4.2" strokeLinecap="round" fill="none" />
            <path d="M36 60.2L29.2 68.8" stroke="#F7FAFF" strokeWidth="1.15" strokeLinecap="round" fill="none" opacity="0.52" />
          </motion.g>
        )}

        {isSpeaking && (
          <motion.g initial={false}>
            <motion.ellipse
              cx="64.2"
              cy="66.2"
              rx="4.9"
              ry="3.9"
              fill="#43202A"
              animate={{ scaleY: [0.35, 1, 0.45, 0.9] }}
              transition={{ duration: 0.95, repeat: Infinity, ease: 'easeInOut' }}
              style={{ originX: 0.5, originY: 0.52 }}
            />
            <motion.path
              d="M87.4 51.5C91.8 55 91.8 60.6 87.4 64.1"
              stroke="#7E8DA8"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
              animate={{ opacity: [0.25, 0.78, 0.25] }}
              transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.path
              d="M93.2 47.4C100.1 53.7 100.1 62 93.2 68.3"
              stroke="#AAB7CB"
              strokeWidth="1.7"
              strokeLinecap="round"
              fill="none"
              animate={{ opacity: [0.18, 0.62, 0.18] }}
              transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut', delay: 0.12 }}
            />
          </motion.g>
        )}
      </motion.g>
    </motion.svg>
  );
};

export default BambookPandaAgent;
