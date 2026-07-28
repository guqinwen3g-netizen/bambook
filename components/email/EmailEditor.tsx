import React, { useRef, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

// Polyfill for react-quill in Vite
if (typeof window !== 'undefined' && !(window as any).global) {
  (window as any).global = window;
}

interface EmailEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDarkMode?: boolean;
}

export const EmailEditor: React.FC<EmailEditorProps> = ({ value, onChange, placeholder, isDarkMode = false }) => {
  // Custom toolbar options
  const modules = {
    toolbar: [
      [{ 'header': [1, 2, false] }],
      ['bold', 'italic', 'underline', 'strike', 'blockquote'],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
      ['link', 'image'],
      ['clean']
    ],
  };

  const formats = [
    'header',
    'bold', 'italic', 'underline', 'strike', 'blockquote',
    'list', 'bullet', 'indent',
    'link', 'image'
  ];

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
