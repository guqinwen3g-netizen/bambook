import re

with open('components/Assistant.tsx', 'r') as f:
    content = f.read()

# 1. Swap Layout Order
content = content.replace(
    "{/* Center Column (when open): Workspace */}\n          <div className={`order-2 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${isWorkspaceOpen ? 'flex-1 min-w-0 opacity-100' : 'w-0 opacity-0'}`}",
    "{/* Right Column (when open): Workspace */}\n          <div className={`order-3 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${isWorkspaceOpen ? 'w-[480px] shrink-0 border-l ' + panelDividerClass + ' opacity-100' : 'w-0 opacity-0 border-none'}`}"
)

content = content.replace(
    "{/* Right Column (or Center if Workspace is closed): Dialogue */}\n          <div className={`order-3 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${isWorkspaceOpen ? `w-[380px] shrink-0 border-l ${panelDividerClass}` : 'flex-1 min-w-0'}`}",
    "{/* Center Column: Dialogue */}\n          <div className={`order-2 flex flex-col transition-all duration-300 ease-in-out overflow-hidden flex-1 min-w-0`}"
)

# 2. Add import for CompiledInteractiveCard
if 'CompiledInteractiveCard' not in content:
    content = content.replace(
        "import { OS_MATERIAL } from './ui/osMaterial';",
        "import { OS_MATERIAL } from './ui/osMaterial';\nimport { CompiledInteractiveCard } from './ui/osCompiler/compiledPrimitives';"
    )

# 3. History Item Replace
start_str = """                    return (
                      <div
                        key={session.id}
                        className={`w-full rounded-[12px] border text-left transition-all ${isActive ? (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light) : (isDarkMode ? 'border-transparent bg-transparent hover:border-white/[0.08] hover:bg-white/[0.045]' : 'border-transparent bg-transparent hover:border-slate-900/[0.08] hover:bg-slate-900/[0.035]')}`}"""

new_history_block = """                    return (
                      <CompiledInteractiveCard
                        key={session.id}
                        as="div"
                        compilerRole="history-item"
                        source="Assistant.history"
                        className="w-full rounded-[12px] text-left transition-all"
                        isActive={isActive}
                      >
                        {isEditing ? (
                          <div className="p-2">
                            <input
                              value={editingSessionTitle}
                              onChange={(event) => setEditingSessionTitle(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  submitRenameSession(session.id);
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelRenameSession();
                                }
                              }}
                              autoFocus
                              className={`h-7 w-full rounded-[12px] border bg-transparent px-2 text-[12px] font-light outline-none ${fieldClass}`}
                            />
                            <div className="mt-1.5 flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={cancelRenameSession}
                                className={`h-6 w-6 rounded-[10px] border flex items-center justify-center ${actionControlClass}`}
                                title="取消"
                              >
                                <X size={12} strokeWidth={1.4} />
                              </button>
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => submitRenameSession(session.id)}
                                className={`h-6 w-6 rounded-[10px] border flex items-center justify-center disabled:opacity-40 ${actionControlClass}`}
                                title="保存名称"
                              >
                                <Check size={12} strokeWidth={1.4} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="group relative">
                            <button
                              type="button"
                              onClick={() => loadSession(session.id)}
                              className="block min-h-10 w-full py-1.5 pl-2.5 pr-[32px] text-left"
                            >
                              <div className={`truncate text-[12px] font-light leading-4 ${isDarkMode ? 'text-white/[0.84]' : 'text-slate-800'}`}>{session.title}</div>
                              <div className={`mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10px] font-light leading-3 ${quietTextClass}`}>
                                <span>{formatSessionTime(session.updatedAt)}</span>
                                {typeof session.messageCount === 'number' && <span className="truncate">{session.messageCount} 条</span>}
                              </div>
                            </button>
                            <div className={`pointer-events-none absolute right-1.5 top-0 bottom-0 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${isActive ? 'opacity-100' : ''}`}>
                              <ChevronRight size={14} strokeWidth={1.25} className={isDarkMode ? 'text-white/[0.45]' : 'text-slate-400'} />
                            </div>
                          </div>
                        )}
                      </CompiledInteractiveCard>
                    );
                  })"""

pattern = re.compile(re.escape(start_str) + r'.*?                    \);\n                  \}\)', re.DOTALL)
match = pattern.search(content)
if match:
    content = content[:match.start()] + new_history_block + content[match.end():]
else:
    print("Could not match history block!")

with open('components/Assistant.tsx', 'w') as f:
    f.write(content)
print("done")
