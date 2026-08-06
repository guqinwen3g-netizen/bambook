import React, { useState } from 'react';
import { login, AuthUser } from '../services/authService';
import BambookIcon from './BambookIcon';

interface LoginProps {
  onLogin: (user?: AuthUser) => void;
  onGoRegister?: () => void;
  isDarkMode: boolean;
}

export function isAllowedLoginIdentifier(value: string): boolean {
  const identifier = value.trim();
  return identifier.length > 0 && !/\s{2,}/.test(identifier);
}

const Login: React.FC<LoginProps> = ({ onLogin, onGoRegister, isDarkMode }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const loginIdentifier = email.trim();
    if (!isAllowedLoginIdentifier(loginIdentifier)) {
      setError('请输入姓名或邮箱地址');
      return;
    }
    setIsLoading(true);
    try {
      const user = await login(loginIdentifier, password);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls = `w-full px-4 py-3 rounded-control border outline-none text-sm transition-all ${
    isDarkMode
      ? 'bg-deep/40 border-white/10 text-white placeholder-slate-500 focus:border-[var(--os-vnext-brand-blue)]/60'
      : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-slate-400'
  }`;

  return (
    <div className={`bambook-mobile-auth-page w-full h-screen flex items-center justify-center ${isDarkMode ? 'bg-app-dark' : 'bg-gradient-to-br from-slate-50 to-slate-100'}`}>
      <div className={`w-full max-w-sm p-8 rounded-card-lg border ${
        isDarkMode ? 'bg-white/[0.04] border-white/10' : 'bg-white/80 border-white/40 shadow-none'
      }`}>
        <div className="flex flex-col items-center mb-8">
          <BambookIcon size={40} strokeWidth={1} className="text-[var(--os-vnext-brand-blue)] drop-shadow-none" />
          <h1 className={`mt-4 text-xl font-light tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            Bambook Neural
          </h1>
          <p className={`mt-1 text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
            Enterprise Agent OS
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`block text-[11px] font-light mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              姓名或邮箱
            </label>
            <input
              type="text"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputCls}
              placeholder="张三 / you@company.com"
              inputMode="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
            />
          </div>

          <div>
            <label className={`block text-[11px] font-light mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={inputCls}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-xs text-slate-500 bg-slate-500/10 border border-slate-500/20 rounded-inset px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !email || !password}
            className={`w-full py-3 rounded-full text-sm font-light transition-all ${
              isLoading || !email || !password
                ? 'bg-slate-500/30 text-slate-400 cursor-not-allowed'
                : 'bg-[var(--os-vnext-brand-blue)] text-white hover:bg-[var(--os-vnext-brand-blue)] active:scale-[0.98]'
            }`}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {onGoRegister && (
          <button
            type="button"
            onClick={onGoRegister}
            className={`mt-5 w-full text-center text-xs transition ${
              isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            还没有账号？<span className="text-[var(--os-vnext-brand-blue)]">申请注册</span>
          </button>
        )}

        <p className={`mt-3 text-center text-[10px] ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
          Cookie-based persistent login. 7-day session.
        </p>
      </div>
    </div>
  );
};

export default Login;
