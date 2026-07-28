import React, { useState } from 'react';
import { motion } from 'framer-motion';

const PandaLab: React.FC<{ isDarkMode: boolean; onToggleTheme: () => void }> = ({ isDarkMode, onToggleTheme }) => {
  // State for all tweakable coordinates
  const [headY, setHeadY] = useState(2);
  const [bellyRx, setBellyRx] = useState(23);
  const [bellyRy, setBellyRy] = useState(14.5);
  const [bellyTopY, setBellyTopY] = useState(90);
  const [bellyTopCtrlY, setBellyTopCtrlY] = useState(87);
  const [armLeftX, setArmLeftX] = useState(35);
  const [armLeftY, setArmLeftY] = useState(74);
  const [armLeftRotate, setArmLeftRotate] = useState(14);
  const [armRightX, setArmRightX] = useState(82);
  const [armRightY, setArmRightY] = useState(74);
  const [armRightRotate, setArmRightRotate] = useState(-14);
  const [neckTopW, setNeckTopW] = useState(36); // from 46 to 82 (width 36)
  const [neckBottomW, setNeckBottomW] = useState(44); // from 42 to 86 (width 44)

  const url = (id: string) => `url(#${id})`;

  const generateJSX = () => {
    return `        {/* Neck & Shoulders */}
        <motion.g style={{ originX: 0.5, originY: 0.66 }}>
          <path d="M ${64 - neckTopW/2} 60 L ${64 - neckTopW/2} 76 L ${64 - neckBottomW/2 - 6} 96 L ${64 + neckBottomW/2 + 6} 96 L ${64 + neckTopW/2} 76 L ${64 + neckTopW/2} 60 Z" fill={url('furBlack')} />
        </motion.g>

        {/* Left Arm */}
        <motion.g animate={motionSet.leftArm} style={{ originX: 44/128, originY: 74/128 }}>
          <path d="M 44 74 C 32 78 28 92 34 100 C 38 104 46 100 46 95 C 48 88 48 80 44 74 Z" fill={url('furBlack')} />
        </motion.g>

        {/* Right Arm */}
        <motion.g animate={motionSet.rightArm} style={{ originX: 84/128, originY: 74/128 }}>
          <path d="M 84 74 C 96 78 100 92 94 100 C 90 104 82 100 82 95 C 80 88 80 80 84 74 Z" fill={url('furBlack')} />
        </motion.g>

        {/* Torso Belly */}
        <motion.g style={{ originX: 0.5, originY: 0.78 }}>
          <path d="M ${64 - bellyRx - 3} ${bellyTopY} C 50 ${bellyTopCtrlY - 3} 78 ${bellyTopCtrlY - 3} ${64 + bellyRx + 3} ${bellyTopY} C ${64 + bellyRx + 7} 104 ${64 + bellyRx - 3} 115 64 115 C ${64 - bellyRx + 3} 115 ${64 - bellyRx - 7} 104 ${64 - bellyRx - 3} ${bellyTopY} Z" fill={url('furWhite')} />
        </motion.g>

        {/* Head Inner Group */}
        <g transform="translate(0, ${headY})">...`;
  };

  return (
    <div className="flex h-screen w-full font-sans">
      {/* Sidebar Controls */}
      <div className="w-96 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 overflow-y-auto shrink-0 flex flex-col gap-6">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-light">Panda Sandbox</h1>
          <button onClick={onToggleTheme} className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded">
            {isDarkMode ? 'Light' : 'Dark'}
          </button>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-light text-slate-700 dark:text-slate-300">Head</h2>
          <label className="flex flex-col gap-1 text-sm">
            Head Y Offset: {headY}
            <input type="range" min="-10" max="10" value={headY} onChange={e => setHeadY(Number(e.target.value))} />
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-light text-slate-700 dark:text-slate-300">White Belly</h2>
          <label className="flex flex-col gap-1 text-sm">Width (Rx): {bellyRx} <input type="range" min="15" max="35" step="0.5" value={bellyRx} onChange={e => setBellyRx(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Height (Ry): {bellyRy} <input type="range" min="10" max="25" step="0.5" value={bellyRy} onChange={e => setBellyRy(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Top Y: {bellyTopY} <input type="range" min="80" max="100" value={bellyTopY} onChange={e => setBellyTopY(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Top Curve Control Y: {bellyTopCtrlY} <input type="range" min="70" max="95" value={bellyTopCtrlY} onChange={e => setBellyTopCtrlY(Number(e.target.value))} /></label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-light text-slate-700 dark:text-slate-300">Left Arm</h2>
          <label className="flex flex-col gap-1 text-sm">X: {armLeftX} <input type="range" min="20" max="50" step="0.5" value={armLeftX} onChange={e => setArmLeftX(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Y: {armLeftY} <input type="range" min="60" max="90" step="0.5" value={armLeftY} onChange={e => setArmLeftY(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Rotate: {armLeftRotate}° <input type="range" min="-45" max="45" value={armLeftRotate} onChange={e => setArmLeftRotate(Number(e.target.value))} /></label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-light text-slate-700 dark:text-slate-300">Right Arm</h2>
          <label className="flex flex-col gap-1 text-sm">X: {armRightX} <input type="range" min="70" max="100" step="0.5" value={armRightX} onChange={e => setArmRightX(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Y: {armRightY} <input type="range" min="60" max="90" step="0.5" value={armRightY} onChange={e => setArmRightY(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Rotate: {armRightRotate}° <input type="range" min="-45" max="45" value={armRightRotate} onChange={e => setArmRightRotate(Number(e.target.value))} /></label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-light text-slate-700 dark:text-slate-300">Black Neck</h2>
          <label className="flex flex-col gap-1 text-sm">Top Width: {neckTopW} <input type="range" min="10" max="60" value={neckTopW} onChange={e => setNeckTopW(Number(e.target.value))} /></label>
          <label className="flex flex-col gap-1 text-sm">Bottom Width: {neckBottomW} <input type="range" min="20" max="80" value={neckBottomW} onChange={e => setNeckBottomW(Number(e.target.value))} /></label>
        </section>

        <button 
          className="mt-4 px-4 py-2 bg-[var(--os-vnext-brand-blue)] text-white rounded font-light hover:bg-[var(--os-vnext-brand-blue-strong)]"
          onClick={() => navigator.clipboard.writeText(generateJSX())}
        >
          Copy SVG Code
        </button>
        <pre className="text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded overflow-x-auto mt-2 select-all">
          {generateJSX()}
        </pre>
      </div>

      {/* Main Preview */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#071321] relative">
        <div className="w-[300px] h-[300px] bg-white dark:bg-[#0F1C2E] shadow-none rounded-card-lg flex items-center justify-center">
          
          <svg viewBox="0 0 128 128" className="w-[200px] h-[200px] overflow-visible">
            <defs>
              <linearGradient id="furBlack" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1B2838" />
                <stop offset="100%" stopColor="#0B121A" />
              </linearGradient>
              <linearGradient id="furWhite" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#E2EAF1" />
              </linearGradient>
              <linearGradient id="blackFurHighlight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5B7693" />
                <stop offset="100%" stopColor="#253547" />
              </linearGradient>
              <radialGradient id="bellyShade" cx="0.5" cy="0" r="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="85%" stopColor="#9FBBD2" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--os-vnext-brand-blue-soft)" stopOpacity="0.8" />
              </radialGradient>
            </defs>

            {/* Legs */}
            <motion.g style={{ originX: 46/128, originY: 105/128 }}>
              <path d="M53.1 96.6 C49.6 99.6 48.5 108.8 51.1 113.8 C53.1 117.6 59.5 117.9 62.2 114.4 C65.2 110.4 63.4 100.8 60.2 97.5 C58.2 95.4 55.5 94.8 53.1 96.6 Z" fill={url('furBlack')} />
              <ellipse cx="56.1" cy="115.7" rx="5.8" ry="2.9" fill="#07101d" opacity="0.88" />
              <ellipse cx="56.1" cy="116" rx="2.8" ry="1" fill="#2a1c1f" opacity="0.22" />
            </motion.g>
            <motion.g style={{ originX: 72/128, originY: 105/128 }}>
              <path d="M74.9 96.6 C78.4 99.6 79.5 108.8 76.9 113.8 C74.9 117.6 68.5 117.9 65.8 114.4 C62.8 110.4 64.6 100.8 67.8 97.5 C69.8 95.4 72.5 94.8 74.9 96.6 Z" fill={url('furBlack')} />
              <ellipse cx="71.9" cy="115.7" rx="5.8" ry="2.9" fill="#07101d" opacity="0.88" />
              <ellipse cx="71.9" cy="116" rx="2.8" ry="1" fill="#2a1c1f" opacity="0.22" />
            </motion.g>

            {/* Neck & Shoulders */}
            <motion.g style={{ originX: 0.5, originY: 0.66 }}>
              <path d={`M ${64 - neckTopW/2} 60 L ${64 - neckTopW/2} 76 L ${64 - neckBottomW/2 - 6} 96 L ${64 + neckBottomW/2 + 6} 96 L ${64 + neckTopW/2} 76 L ${64 + neckTopW/2} 60 Z`} fill={url('furBlack')} />
            </motion.g>

            {/* Left Arm */}
            <motion.g style={{ originX: 44/128, originY: 74/128 }}>
              <path d={`M 44 74 C 32 78 28 92 34 100 C 38 104 46 100 46 95 C 48 88 48 80 44 74 Z`} fill={url('furBlack')} />
            </motion.g>

            {/* Right Arm */}
            <motion.g style={{ originX: 84/128, originY: 74/128 }}>
              <path d={`M 84 74 C 96 78 100 92 94 100 C 90 104 82 100 82 95 C 80 88 80 80 84 74 Z`} fill={url('furBlack')} />
            </motion.g>

            {/* Torso Belly */}
            <motion.g style={{ originX: 0.5, originY: 0.78 }}>
              <path d={`M ${64 - bellyRx - 3} ${bellyTopY} C 50 ${bellyTopCtrlY - 3} 78 ${bellyTopCtrlY - 3} ${64 + bellyRx + 3} ${bellyTopY} C ${64 + bellyRx + 7} 104 ${64 + bellyRx - 3} 115 64 115 C ${64 - bellyRx + 3} 115 ${64 - bellyRx - 7} 104 ${64 - bellyRx - 3} ${bellyTopY} Z`} fill={url('furWhite')} />
            </motion.g>

            <motion.g style={{ originX: 0.5, originY: 0.34 }}>
              <g transform={`translate(0, ${headY})`}>
                <circle cx="34" cy="34" r="12" fill={url('furBlack')} />
                <circle cx="94" cy="34" r="12" fill={url('furBlack')} />
                <circle cx="40" cy="24" r="8.8" fill="#ffffff" opacity="0.08" />
                <circle cx="88" cy="24" r="8.8" fill="#ffffff" opacity="0.08" />
                <path d="M58 16 C61 10 66 9 71 13 C66 12 62 13 58 16 Z" fill="#ffffff" opacity="0.74" />
                <path d="M64 15 C86 15 101 28 105 46 C110 68 91 81 64 81 C37 81 18 68 23 46 C27 28 42 15 64 15 Z" fill={url('furWhite')} />
                <path d="M27 50 C34 68 49 78 64 78 C79 78 94 68 101 50 C100 72 83 85 64 85 C45 85 28 72 27 50 Z" fill="#9FBBD2" fillOpacity="0.20" opacity="0.14" />
                <path d="M51.514 42.128 C60.005 47.788 47.458 67.334 39.628 61.939 C31.797 56.545 43.024 36.468 51.514 42.128 Z" fill="#111A28" />
                <path d="M76.42 42.505 C67.929 48.166 80.476 67.711 88.306 62.317 C96.137 56.922 84.91 36.845 76.42 42.505 Z" fill="#111A28" />
                {/* Left Eyeball */}
                <motion.g style={{ originX: 46.309 / 128, originY: 50.328 / 128 }}>
                  <ellipse cx="46.309" cy="50.328" rx="5.4" ry="6.4" fill="#07101d" />
                  <ellipse cx="46.109" cy="50.528" rx="3.2" ry="3.8" fill="#203653" opacity="0.82" />
                  <circle cx="47.509" cy="47.628" r="2.2" fill="#eff8ff" />
                  <circle cx="44.2" cy="52.5" r="1.0" fill="#eff8ff" opacity="0.65" />
                </motion.g>

                {/* Right Eyeball */}
                <motion.g style={{ originX: 80.332 / 128, originY: 50.56 / 128 }}>
                  <ellipse cx="80.332" cy="50.56" rx="5.4" ry="6.4" fill="#07101d" />
                  <ellipse cx="80.132" cy="50.76" rx="3.2" ry="3.8" fill="#203653" opacity="0.82" />
                  <circle cx="81.532" cy="47.86" r="2.2" fill="#eff8ff" />
                  <circle cx="78.2" cy="52.5" r="1.0" fill="#eff8ff" opacity="0.65" />
                </motion.g>
                <path d="M53.24 56.415 C54.58 51.129 73.901 51.129 75.24 56.415 C76.58 61.701 68.24 66.015 64.24 66.015 C60.24 66.015 51.901 61.701 53.24 56.415 Z" fill="#f5f9fc" opacity="0.74" />
                <path d="M58.555 56.818 C59.159 54.017 68.951 54.017 69.555 56.818 C70.159 59.62 66.355 61.318 64.055 61.318 C61.755 61.318 57.951 59.62 58.555 56.818 Z" fill="#101827" />
                <path d="M63.774 59.245 L63.774 66.038" stroke="#26364b" strokeWidth="1" strokeLinecap="round" />
                <path d="M58.981 64.906 C60.113 67.17 62.642 67.925 64.151 67.925 C65.66 67.925 68.189 67.17 69.321 64.906" fill="none" stroke="#26364b" strokeWidth="1" strokeLinecap="round" />
              </g>
            </motion.g>

          </svg>
        </div>
      </div>
    </div>
  );
};

export default PandaLab;
