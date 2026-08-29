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

  const inputCls = `bds-input w-full`;

  return (
    <div className={`bambook-mobile-auth-page w-full h-screen flex items-center justify-center bg-[var(--bg-page)]`}>
      <div className={`w-full max-w-sm p-8 rounded-card-lg border bg-[var(--bg-card)] border-[var(--border-c-default)] shadow-none`}>
        <div className="flex flex-col items-center mb-8">
          {/* bds-ok: 品牌 logo SVG（非 lucide 功能图标），装饰性 hero 位，size 不套 icon 刻度 */}
          <BambookIcon size={40} strokeWidth={1.25} className="text-[var(--os-vnext-brand-blue)] drop-shadow-none" />
          <h1 className="mt-4 text-xl font-light tracking-tight text-[var(--text-primary)]">
            Bambook Neural
          </h1>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Enterprise Agent OS
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-light mb-1.5 text-[var(--text-tertiary)]">
              姓名或邮箱
            </label>
            <input
              type="text"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputCls}
              placeholder="请输入姓名或邮箱"
              inputMode="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] font-light mb-1.5 text-[var(--text-tertiary)]">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={inputCls}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-xs text-[var(--text-tertiary)] bg-[var(--recessed-bg-strong)] border border-[var(--border-c-default)] rounded-inset px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !email || !password}
            className="bds-btn bds-btn-primary w-full"
          >
            {isLoading ? '登录中…' : '登录'}
          </button>
        </form>

        {onGoRegister && (
          <button
            type="button"
            onClick={onGoRegister}
            className="mt-5 w-full text-center text-xs transition text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            还没有账号？<span className="text-[var(--os-vnext-brand-blue)]">申请注册</span>
          </button>
        )}

        <p className="mt-3 text-center text-[10px] text-[var(--text-tertiary)]">
          登录会话保持 7 天，期间无需重复验证。
        </p>
      </div>
    </div>
  );
};

export default Login;
