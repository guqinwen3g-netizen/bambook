import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
    content: string;
    isDarkMode?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isDarkMode }) => {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                // 1. Code Blocks (Safe Mode)
                code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline && match ? (
                        <div className="relative rounded-inset overflow-hidden my-3 border border-white/10 shadow-none bg-deep">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">{match[1]}</span>
                                <div className="flex gap-1.5 opacity-50">
                                    <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                                </div>
                            </div>
                            <div className="overflow-x-auto p-4">
                                <code {...props} className="font-mono text-[13px] leading-relaxed text-slate-300">
                                    {String(children).replace(/\n$/, '')}
                                </code>
                            </div>
                        </div>
                    ) : (
                        <code {...props} className={`px-1.5 py-0.5 rounded text-[13px] font-mono ${isDarkMode ? 'bg-slate-700/50 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                            {children}
                        </code>
                    );
                },
                // 2. Tables
                table({ children }) {
                    return (
                        <div className="overflow-x-auto my-4 rounded-inset border border-white/10 shadow-none">
                            <table className={`w-full text-sm text-left ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{children}</table>
                        </div>
                    );
                },
                thead({ children }) {
                    return <thead className={`text-[11px] uppercase tracking-wider font-light ${isDarkMode ? 'bg-deep/80 text-slate-400 border-b border-white/5' : 'bg-slate-50 text-slate-500'}`}>{children}</thead>;
                },
                th({ children }) {
                    return <th className="px-4 py-3 border-b border-white/5 font-light">{children}</th>;
                },
                tr({ children }) {
                    return <tr className={`border-b border-white/5 last:border-0 ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}>{children}</tr>;
                },
                td({ children }) {
                    return <td className="px-4 py-3 whitespace-nowrap">{children}</td>;
                },
                // 3. Links
                a({ children, href }) {
                    return (
                        <a href={href} target="_blank" rel="noopener noreferrer" className={`font-normal underline underline-offset-2 transition-colors ${isDarkMode ? 'text-slate-300 hover:text-slate-100' : 'text-slate-600 hover:text-slate-800'}`}>
                            {children}
                        </a>
                    );
                },
                // 4. Headings
                h1({ children }) { return <h1 className="text-2xl font-light mt-6 mb-4 tracking-tight">{children}</h1> },
                h2({ children }) { return <h2 className="text-xl font-light mt-5 mb-3 tracking-tight">{children}</h2> },
                h3({ children }) { return <h3 className="text-lg font-light mt-4 mb-2">{children}</h3> },
                strong({ children }) { return <strong className="font-normal">{children}</strong> },
                // 5. Lists
                ul({ children }) { return <ul className="list-disc pl-5 my-3 space-y-1">{children}</ul> },
                ol({ children }) { return <ol className="list-decimal pl-5 my-3 space-y-1">{children}</ol> },
                li({ children }) { return <li className="pl-1">{children}</li> },
                // 6. Paragraphs
                p({ children }) { return <p className="mb-3 leading-7 last:mb-0">{children}</p> },
                // 7. Blockquote
                blockquote({ children }) {
                    return <blockquote className={`border-l-4 pl-4 py-1 my-4 italic ${isDarkMode ? 'border-slate-500/50 bg-slate-500/10 text-slate-200/80 rounded-r-lg' : 'border-slate-400/50 bg-slate-50 text-slate-600 rounded-r-lg'}`}>{children}</blockquote>
                }
            }}
        >
            {content}
        </ReactMarkdown>
    );
};
