with open('components/Assistant.tsx', 'r') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if "const isActive = session.id === activeSessionId;" in line:
        if start_idx == -1:
            start_idx = i - 1  # include "return (" or similar? No, the line before is "sessions.map(session => {"
            
for i in range(start_idx, len(lines)):
    if "</div>" in lines[i] and "{" not in lines[i]:
        # we need to find the end of the map: "})}"
        pass
    if "                  })" in lines[i]:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_lines = lines[:start_idx+2] # keep session.map and const isActive...
    
    # Actually let's just find the exact line for "return ("
    for i in range(start_idx, end_idx):
        if "return (" in lines[i]:
            ret_start = i
            break
            
    new_block = """                    return (
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
"""
    with open('components/Assistant.tsx', 'w') as f:
        f.writelines(lines[:ret_start])
        f.write(new_block)
        f.writelines(lines[end_idx:])
    print("Replaced by lines!")
else:
    print("Could not find start_idx or end_idx", start_idx, end_idx)
