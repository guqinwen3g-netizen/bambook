/**
 * ERP-P1: 短期 server-side secret context（in-memory）。
 * SMTP 密码不持久化到 ApprovalRequest.payload（避免 admin /approvals 暴露明文）。
 * draft 阶段存 pass 到此 store（credentialRef 索引），payload 只存 credentialRef。
 * commit 阶段用 credentialRef 恢复 pass；取一次后销毁（one-shot）。
 * 进程重启 secret 丢失 → commit MISSING_CREDENTIALS fail closed（重新发起审批）。
 */

const store = new Map<string, { pass: string; expiresAt: number }>();
const TTL_MS = 30 * 60 * 1000; // 30 分钟

export function putEmailCredential(pass: string): string {
  const ref = `ecred_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  store.set(ref, { pass, expiresAt: Date.now() + TTL_MS });
  return ref;
}

export function takeEmailCredential(ref: string): string | null {
  const entry = store.get(ref);
  if (!entry) return null;
  store.delete(ref); // one-shot：取一次后销毁
  if (Date.now() > entry.expiresAt) return null; // 过期
  return entry.pass;
}

export function clearEmailCredentials(): void {
  store.clear();
}
