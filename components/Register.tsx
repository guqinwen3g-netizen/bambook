import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { register, sendVerificationCode } from '../services/authService';
import BambookIcon from './BambookIcon';

const SUBMITTED_REDIRECT_SECONDS = 5;

interface RegisterProps {
  onBackToLogin: () => void;
  onRegistered: () => void;
  isDarkMode: boolean;
}

const Register: React.FC<RegisterProps> = ({ onBackToLogin, onRegistered, isDarkMode }) => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<number | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState(SUBMITTED_REDIRECT_SECONDS);
  const redirectTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    if (redirectTimer.current) window.clearInterval(redirectTimer.current);
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

  const handleSendCode = async () => {
    setError('');
    setInfo('');
    if (!email) {
      setError('请先填写邮箱');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('邮箱格式不正确');
      return;
    }
    setIsSendingCode(true);
    try {
      const result = await sendVerificationCode(email, 'register');
      setInfo(result.message);
      startCooldown(result.cooldownMs);
    } catch (err: any) {
      setError(err.message || '验证码发送失败');
      if (err.retryAfterMs) startCooldown(err.retryAfterMs);
    } finally {
      setIsSendingCode(false);
    }
  };

  const startRedirectCountdown = () => {
    setRedirectCountdown(SUBMITTED_REDIRECT_SECONDS);
    if (redirectTimer.current) window.clearInterval(redirectTimer.current);
    redirectTimer.current = window.setInterval(() => {
      setRedirectCountdown(prev => {
        if (prev <= 1) {
          if (redirectTimer.current) window.clearInterval(redirectTimer.current);
          onRegistered();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleReturnNow = () => {
    if (redirectTimer.current) window.clearInterval(redirectTimer.current);
    onRegistered();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (password.length < 6) { setError('密码至少 6 位'); return; }
    if (password !== confirm) { setError('两次输入的密码不一致'); return; }
    if (!code || code.length < 4) { setError('请输入邮箱收到的验证码'); return; }
    setIsLoading(true);
    try {
      await register({
        email,
        password,
        displayName,
        code: code.trim(),
      });
      setSubmittedEmail(email);
      startRedirectCountdown();
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls = `w-full px-4 py-2.5 rounded-xl border outline-none text-sm transition-all ${
    isDarkMode
      ? 'bg-deep/40 border-white/10 text-white placeholder-slate-500 focus:border-[var(--os-vnext-brand-blue)]/60'
      : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-slate-400'
  }`;

  if (submittedEmail) {
    return (
      <div className={`bambook-mobile-auth-page w-full h-screen flex items-center justify-center overflow-y-auto ${isDarkMode ? 'bg-[#0a1628]' : 'bg-gradient-to-br from-slate-50 to-slate-100'}`}>
        <div className={`w-full max-w-md my-10 p-8 rounded-card-lg border ${
          isDarkMode ? 'bg-white/[0.04] border-white/10' : 'bg-white/80 border-white/40 shadow-none'
        }`}>
          <div className="flex flex-col items-center text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-white/10' : 'bg-slate-100'}`}>
              <CheckCircle2 size={32} strokeWidth={1.5} className={isDarkMode ? "text-white/70" : "text-slate-600"} />
            </div>
            <h1 className={`mt-5 text-lg font-light tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              申请已提交，等待管理员审批
            </h1>
            <p className={`mt-2 text-xs leading-5 px-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              管理员审核通过后会向 <span className={isDarkMode ? 'text-white' : 'text-slate-900'}>{submittedEmail}</span> 发送通知邮件，届时即可使用同一邮箱登录。
            </p>

            <div className={`mt-5 w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] ${isDarkMode ? 'border-white/10 bg-white/[0.03] text-slate-400' : 'border-slate-200 bg-white/70 text-slate-500'}`}>
              <MailCheck size={14} strokeWidth={1.5} className="text-[var(--os-vnext-brand-blue)] shrink-0" />
              <span>请留意邮箱（含垃圾邮件夹），如长时间未收到通知可联系您的管理员。</span>
            </div>

            <button
              type="button"
              onClick={handleReturnNow}
              className="mt-5 w-full py-2.5 rounded-xl text-sm font-light bg-[var(--os-vnext-brand-blue)] text-white hover:bg-[var(--os-vnext-brand-blue)] active:scale-[0.98] transition-all"
            >
              立即返回登录
            </button>
            <p className={`mt-3 text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              {redirectCountdown > 0 ? `${redirectCountdown} 秒后自动返回登录` : '正在返回登录…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bambook-mobile-auth-page w-full h-screen flex items-center justify-center overflow-y-auto ${isDarkMode ? 'bg-[#0a1628]' : 'bg-gradient-to-br from-slate-50 to-slate-100'}`}>
      <div className={`w-full max-w-md my-10 p-8 rounded-card-lg border ${
        isDarkMode ? 'bg-white/[0.04] border-white/10' : 'bg-white/80 border-white/40 shadow-none'
      }`}>
        <div className="flex flex-col items-center mb-6">
          <BambookIcon size={36} strokeWidth={1} className="text-[var(--os-vnext-brand-blue)] drop-shadow-none" />
          <h1 className={`mt-3 text-lg font-light tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            申请加入 Bambook Neural
          </h1>
          <p
            className={`mt-1 text-[11px] min-h-[16px] text-center px-2 leading-4 ${
              error ? (isDarkMode ? 'text-white/55' : 'text-slate-500') : success ? (isDarkMode ? 'text-white/70' : 'text-slate-600') : info ? (isDarkMode ? 'text-slate-400' : 'text-slate-500') : (isDarkMode ? 'text-slate-500' : 'text-slate-500')
            }`}
          >
            {error || success || info || '邮箱验证后提交审批，管理员通过即可登录'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className={`block text-[11px] font-light mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>姓名</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className={inputCls}
              placeholder="您的真实姓名"
              autoFocus
            />
          </div>

          <div>
            <label className={`block text-[11px] font-light mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>工作邮箱</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className={`block text-[11px] font-light mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>邮箱验证码</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputCls} tracking-[6px] text-center font-mono`}
                placeholder="6 位数字"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={isSendingCode || cooldown > 0 || !email}
                className={`shrink-0 px-3 rounded-xl text-xs font-light transition-all whitespace-nowrap ${
                  isSendingCode || cooldown > 0 || !email
                    ? (isDarkMode ? 'bg-white/5 text-slate-500 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed')
                    : (isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/15 text-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue)]/25 border border-[var(--os-vnext-brand-blue)]/30' : 'bg-slate-50 text-[var(--os-vnext-brand-blue)] hover:bg-slate-100 border border-slate-200')
                }`}
              >
                {isSendingCode ? '发送中...' : cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-[11px] font-light mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>密码</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputCls}
                placeholder="至少 6 位"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className={`block text-[11px] font-light mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>确认密码</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className={inputCls}
                placeholder="再次输入"
                autoComplete="new-password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !email || !password || !displayName || !confirm || !code}
            className={`w-full py-2.5 rounded-xl text-sm font-light transition-all ${
              isLoading || !email || !password || !displayName || !confirm || !code
                ? 'bg-slate-500/30 text-slate-400 cursor-not-allowed'
                : 'bg-[var(--os-vnext-brand-blue)] text-white hover:bg-[var(--os-vnext-brand-blue)] active:scale-[0.98]'
            }`}
          >
            {isLoading ? '提交中...' : '提交注册申请'}
          </button>
        </form>

        <button
          type="button"
          onClick={onBackToLogin}
          className={`mt-5 w-full text-center text-xs ${isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'} transition`}
        >
          已有账号？返回登录
        </button>
      </div>
    </div>
  );
};

export default Register;
