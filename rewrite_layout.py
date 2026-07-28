with open('components/Assistant.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    "import { OS_MATERIAL } from './ui/osMaterial';",
    "import { OS_MATERIAL } from './ui/osMaterial';\nimport { CompiledInteractiveCard } from './ui/osCompiler/compiledPrimitives';"
)

content = content.replace(
    "{/* Center Column (when open): Workspace */}\n          <div className={`order-2 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${isWorkspaceOpen ? 'flex-1 min-w-0 opacity-100' : 'w-0 opacity-0'}`}>",
    "{/* Right Column (when open): Workspace */}\n          <div className={`order-3 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${isWorkspaceOpen ? 'w-[380px] shrink-0 border-l ' + panelDividerClass + ' opacity-100' : 'w-0 opacity-0 border-none'}`}>"
)

content = content.replace(
    "{/* Right Column (or Center if Workspace is closed): Dialogue */}\n          <div className={`order-3 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${isWorkspaceOpen ? `w-[380px] shrink-0 border-l ${panelDividerClass}` : 'flex-1 min-w-0'}`}",
    "{/* Center Column: Dialogue */}\n          <div className={`order-2 flex flex-col transition-all duration-300 ease-in-out overflow-hidden flex-1 min-w-0`}"
)

# Replace the "New Chat" button to remove container
new_chat_target = """              <button
                type="button"
                onClick={resetSession}
                className={`h-8 px-2.5 shrink-0 rounded-[14px] border flex items-center justify-center gap-1.5 transition-all ${actionControlClass}`}
                title="新对话"
                aria-label="新对话"
              >
                <Plus size={14} strokeWidth={1.5} />
                <span>新对话</span>
              </button>"""

new_chat_replacement = """              <button
                type="button"
                onClick={resetSession}
                className={`shrink-0 flex items-center justify-center gap-1 text-[12px] font-light transition-colors ${isDarkMode ? 'text-white/80 hover:text-white' : 'text-slate-700 hover:text-slate-900'}`}
                title="新对话"
                aria-label="新对话"
              >
                <Plus size={14} strokeWidth={1.5} />
                <span>新对话</span>
              </button>"""
content = content.replace(new_chat_target, new_chat_replacement)

# Ensure "ChevronRight" is imported from lucide-react if not already
if 'ChevronRight' not in content:
    content = content.replace('ChevronLeft', 'ChevronLeft, ChevronRight')

with open('components/Assistant.tsx', 'w') as f:
    f.write(content)
print("done")
