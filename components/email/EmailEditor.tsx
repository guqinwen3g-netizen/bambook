import React from 'react';

interface EmailEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDarkMode?: boolean;
}

/**
 * 邮件正文编辑器 — 纯文本通道（发送管道 bodyText，无 HTML 路径）。
 * 历史遗留的 react-quill 富文本接线已移除：发送链路不消费 HTML，
 * 且 quill.snow.css 与 flat 设计系统冲突。
 */
export const EmailEditor: React.FC<EmailEditorProps> = ({ value, onChange, placeholder, isDarkMode = false }) => {
  return (
    <div className="h-full flex flex-col">
      <textarea
        className={`w-full h-full p-6 border rounded-full outline-none transition-all resize-none text-sm leading-relaxed placeholder:text-slate-400 ${isDarkMode
          ? 'bg-slate-800 border-white/10 text-slate-200 focus:bg-slate-700/80 focus:ring-4 focus:ring-white/5'
          : 'bg-white/40 border-white/50 text-slate-800 focus:bg-white/60 focus:ring-4 focus:ring-[rgb(var(--os-vnext-brand-blue-rgb)/0.2)]'}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Write something...'}
      />
    </div>
  );
};
