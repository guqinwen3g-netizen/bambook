import React, { useEffect, useRef, useState } from 'react';
import { login, mapAuthErrorMessage, AuthUser } from '../services/authService';
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
  // 429 限流冷却倒计时（对齐 Register 发送验证码冷却模式）
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
  }, []);

  const startCooldown = (ms: number) => {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    setCooldown(seconds);
    if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    cooldownTimer.current = window.setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

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
      // 错误文案走 authService 统一映射层，不直渲 err.message 原文
      setError(mapAuthErrorMessage(err, '登录失败，请稍后重试'));
      // 登录失败立即清掉口令残留，避免明文长时间停留在受控状态里
      setPassword('');
      if (typeof err?.retryAfterMs === 'number' && err.retryAfterMs > 0) {
        startCooldown(err.retryAfterMs);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls = `bds-input w-full`;

  return (
    <div className={`bambook-mobile-auth-page w-full h-screen flex items-center justify-center overflow-y-auto bg-[var(--bg-page)]`}>
      <div className={`w-full max-w-sm my-auto p-8 rounded-card-lg border bg-[var(--bg-card)] border-[var(--border-c-default)] shadow-none`}>
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
            <label className="block text-xs font-light mb-1.5 text-[var(--text-tertiary)]">
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
            <label className="block text-xs font-light mb-1.5 text-[var(--text-tertiary)]">
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
            disabled={isLoading || cooldown > 0 || !email || !password}
            className="bds-btn bds-btn-primary w-full"
          >
            {isLoading ? '登录中…' : cooldown > 0 ? `重试冷却 ${cooldown}s` : '登录'}
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
