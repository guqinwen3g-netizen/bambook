/**
 * AutomationRulesSection — 自动化规则配置区段
 *
 * 功能：
 *   1. 拉取后端 /api/v1/automation/rules 列表
 *   2. 每条规则以卡片展示：图标 + 名称 + 事件类型徽章 + 描述 + 启停开关
 *   3. 乐观更新（toggle 即刻反映 UI，失败回滚）
 *   4. 加载骨架 / 错误重试 / 空态
 *
 * 设计：flat 无阴影、大圆角（rounded-control/card）、半透明膜色（backdrop-blur）
 * 与 Settings.tsx 其余 tab 共用 BAMBOOK_OS 设计 token，保证视觉一致。
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Workflow, PackageCheck, Factory, Truck, Receipt,
  RefreshCw, AlertTriangle, Zap,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { AutomationRule } from '../types';
import { BAMBOOK_OS } from './ui/bambookOsTokens';

// ── 事件类型 → 显示信息映射 ──
interface EventMeta {
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

const EVENT_META: Record<string, EventMeta> = {
  OrderConfirmed: { label: '订单已确认', Icon: PackageCheck },
  ProductionCompleted: { label: '生产已完成', Icon: Factory },
  ShipmentCompleted: { label: '发货已完成', Icon: Truck },
  PaymentVoucherCreated: { label: '收款凭证已创建', Icon: Receipt },
};

const getEventMeta = (eventType: string): EventMeta => EVENT_META[eventType] || { label: eventType, Icon: Zap };

interface AutomationRulesSectionProps {
  isDarkMode: boolean;
}

export function AutomationRulesSection({ isDarkMode }: AutomationRulesSectionProps) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 正在更新中的规则 id 集合 — 防止重复点击
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // ── 设计 token（与 Settings.tsx 一致）──
  const card = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-settings-nested-panel bambook-outer-panel transition-[background,border-color,box-shadow] duration-300`;
  const primaryTextCls = 'text-[var(--text-primary)]';
  const weakTextCls = 'text-[var(--text-tertiary)]';
  const brandIconCls = BAMBOOK_OS.tone.text.brandEmphasis;
  const sectionDividerCls = BAMBOOK_OS.tone.divider.section;

  const switchControlCls = (checked: boolean) => `group relative inline-flex h-8 w-[58px] shrink-0 items-center rounded-full border p-[3px] transition-[background,border-color,box-shadow] duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${checked
    ? BAMBOOK_OS.controls.selectedSurface.base
    : 'border-transparent bg-[var(--recessed-bg-strong)] shadow-none'}`;
  const switchSliderCls = (checked: boolean) => `h-[26px] w-[34px] rounded-full transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${checked ? 'translate-x-[18px]' : 'translate-x-0'} bg-[var(--bg-card)] shadow-none`;

  const iconWellCls = `flex h-9 w-9 shrink-0 items-center justify-center rounded-field border ${BAMBOOK_OS.tone.surface.quietIcon} border-[var(--border-c-default)] ${BAMBOOK_OS.tone.text.brandEmphasis}`;

  // ── 拉取规则列表 ──
  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiService.listAutomationRules();
      setRules(list);
    } catch (e: any) {
      setError(String(e?.message || e || '加载自动化规则失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // ── 切换规则启停（乐观更新 + 失败回滚）──
  const handleToggle = useCallback(async (ruleId: string, nextEnabled: boolean) => {
    const prev = rules;
    // 乐观更新
    setRules(rs => rs.map(r => r.id === ruleId ? { ...r, enabled: nextEnabled } : r));
    setUpdatingIds(s => new Set(s).add(ruleId));
    try {
      await apiService.updateAutomationRule(ruleId, nextEnabled);
    } catch (e: any) {
      // 回滚
      setRules(prev);
      setError(`规则「${prev.find(r => r.id === ruleId)?.name ?? ruleId}」更新失败：${e?.message || e}`);
    } finally {
      setUpdatingIds(s => {
        const next = new Set(s);
        next.delete(ruleId);
        return next;
      });
    }
  }, [rules]);

  const enabledCount = rules.filter(r => r.enabled).length;

  return (
    <div className="space-y-6">
      {/* ── 说明卡片 ── */}
      <div className={card + ' p-5 space-y-4'}>
        <div className="flex items-center gap-2">
          <Workflow size={18} strokeWidth={1.5} className={brandIconCls} />
          <span className={`text-sm font-light ${primaryTextCls}`}>业务流程自动化</span>
          {!loading && rules.length > 0 && (
            <span className={`ml-auto text-xs font-light ${weakTextCls}`}>
              {enabledCount} / {rules.length} 已启用
            </span>
          )}
        </div>
        <p className={`text-xs leading-relaxed ${weakTextCls}`}>
          自动化规则在业务事件触发时自动执行跨模块联动（如订单确认后自动初始化生产管线）。关闭某条规则后，对应事件将不再自动触发联动，但仍可手动操作。规则状态持久化存储于数据中心。
        </p>
      </div>

      {/* ── 规则列表 ── */}
      {loading ? (
        <div className={card + ' p-8'}>
          <div className="flex flex-col items-center justify-center gap-3">
            <RefreshCw size={20} strokeWidth={1.5} className={`animate-spin ${brandIconCls}`} />
            <div className={`text-xs font-light ${weakTextCls}`}>加载自动化规则...</div>
          </div>
        </div>
      ) : error && rules.length === 0 ? (
        <div className={card + ' p-8'}>
          <div className="flex flex-col items-center justify-center gap-3">
            <AlertTriangle size={20} strokeWidth={1.5} className="text-[var(--warning-text)] opacity-70" />
            <div className={`text-xs font-light ${weakTextCls}`}>{error}</div>
            <button
              type="button"
              onClick={fetchRules}
              className={`mt-1 rounded-control px-3 py-1.5 text-xs font-light ${brandIconCls} hover:bg-[var(--active-darken)] transition-colors`}
            >
              重试
            </button>
          </div>
        </div>
      ) : rules.length === 0 ? (
        <div className={card + ' p-8'}>
          <div className="flex flex-col items-center justify-center gap-3">
            <Workflow size={24} strokeWidth={1.25} className="text-[var(--text-quaternary)]" />
            <div className={`text-xs font-light ${weakTextCls}`}>暂无可用自动化规则</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {error && (
            <div className={`rounded-control px-4 py-2 text-xs bg-[var(--warning-tint)] text-[var(--warning-text)]`}>
              {error}
            </div>
          )}
          {rules.map(rule => {
            const meta = getEventMeta(rule.eventType);
            const Icon = meta.Icon;
            const isUpdating = updatingIds.has(rule.id);
            return (
              <div key={rule.id} className={card + ' p-4'}>
                <div className="flex items-start gap-3">
                  {/* 图标井 */}
                  <div className={iconWellCls}>
                    <Icon size={16} strokeWidth={1.5} />
                  </div>

                  {/* 内容 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-light ${primaryTextCls}`}>{rule.name}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]`}>
                        {meta.label}
                      </span>
                      {isUpdating && (
                        <RefreshCw size={14} strokeWidth={1.5} className={`animate-spin ${weakTextCls}`} />
                      )}
                    </div>
                    <p className={`mt-1 text-xs leading-relaxed ${weakTextCls}`}>{rule.description}</p>
                  </div>

                  {/* 开关 */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.enabled}
                    disabled={isUpdating}
                    onClick={() => handleToggle(rule.id, !rule.enabled)}
                    className={`${switchControlCls(rule.enabled)} ${isUpdating ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    <span className={switchSliderCls(rule.enabled)} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* 底部分隔提示 */}
          <div className={`pt-4 border-t ${sectionDividerCls}`}>
            <p className={`text-[11px] font-light leading-relaxed ${weakTextCls}`}>
              所有自动联动创建的业务单据均以「草稿」状态生成，需人工审核后生效。这是 ERP 的标准设计——自动化加速流程流转，但保留人工把关节点。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutomationRulesSection;
