/**
 * PlatformRulesSection — AdminPanel「平台规则」Tab。
 *
 * 2026-08-18 §1A 裁决：平台配置一律迁 AdminPanel（导航 adminOnly + 服务端真源）。
 *
 * 当前承载：
 *   ① MOQ 阈值（MoqThresholdsPanel）
 *   ② 自动化联动（AutomationRulesSection）
 *   ③ 对外 API 策略说明（只读信息卡）
 *
 * 未来承接：A1 审批超时策略表（《审批与human-in-the-loop》§16.2）、平台脱敏规则。
 */

import React from 'react';
import { Cable, ShieldCheck } from 'lucide-react';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { MoqThresholdsPanel } from './MoqThresholdsPanel';
import { AutomationRulesSection } from '../AutomationRulesSection';

export const PlatformRulesSection: React.FC = () => {
  const primaryTextCls = 'text-[var(--text-primary)]';
  const weakTextCls = 'text-[var(--text-tertiary)]';
  const card = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-settings-nested-panel bambook-outer-panel transition-[background,border-color,box-shadow] duration-300`;
  const iconWellCls = `flex h-9 w-9 shrink-0 items-center justify-center rounded-field border ${BAMBOOK_OS.tone.surface.quietIcon} border-[var(--border-c-subtle)] ${BAMBOOK_OS.tone.text.brandEmphasis}`;

  return (
    <div className="space-y-8">
      {/* 页面级标题 */}
      <div>
        <h3 className={`text-sm font-light ${primaryTextCls}`}>
          平台规则
          <span className={`ml-2 text-xs ${weakTextCls}`}>Platform Rules</span>
        </h3>
        <p className={`mt-1 text-xs leading-relaxed ${weakTextCls}`}>
          全公司生效的业务规则与对外访问策略。所有修改均记录审计历史，仅管理员可调整。
        </p>
      </div>

      {/* ① MOQ 阈值 */}
      <section>
        <MoqThresholdsPanel />
      </section>

      {/* ② 自动化联动 */}
      <section>
        <AutomationRulesSection />
      </section>

      {/* ③ 对外 API 策略说明（只读） */}
      <section>
        <div className={card + ' p-5'}>
          <div className="flex items-center gap-2 mb-3">
            <div className={iconWellCls}>
              <Cable size={16} strokeWidth={1.5} />
            </div>
            <span className={`text-sm font-light ${primaryTextCls}`}>对外 API 访问策略</span>
          </div>
          <p className={`text-xs leading-relaxed ${weakTextCls} mb-3`}>
            后端 <code className="font-mono">/api/v1/*</code> 的访问策略（订单、关系、产品、导入等）。
            生产环境请使用强密钥并限制网络访问；开发环境可使用默认 Key。
            认证模式与密钥由客户端在「设置 → 同步/连接」中配置，此处仅为策略说明。
          </p>
          <div className={`text-xs font-mono space-y-1 pt-2 ${weakTextCls}`}>
            <div>GET  /api/v1/orders</div>
            <div>POST /api/v1/orders/import</div>
            <div>POST /api/v1/import/order</div>
            <div>GET  /api/v1/relations</div>
            <div>GET  /api/v1/products</div>
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border-c-subtle)]">
            <div className={`inline-flex items-center gap-1.5 text-xs ${weakTextCls}`}>
              <ShieldCheck size={14} strokeWidth={1.5} />
              仅管理员可查看本策略说明；密钥变更请联系系统管理员在服务端配置。
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PlatformRulesSection;
