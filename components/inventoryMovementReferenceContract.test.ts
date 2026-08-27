/**
 * E6 采购手工变动挂单据 — InventoryManager 前端契约测试
 *
 * 背景：手工出入库此前只能写自由文本「原因」，不能填关联单据号，
 *      库存流水无法回溯到来源单据（S2 三击可追溯断点）。
 *
 * 契约：
 *   ① 手工变动表单有「关联单据号」字段（bds-input，绑定 movementForm.referenceId）
 *   ② 提交时 referenceId trim 后落库；有单据号时 referenceType 记 Manual 台账口径
 *      （后端 inventoryService 已持久化 referenceType/referenceId，白名单含此二字段）
 *   ③ 变动流水行展示关联单据号（可追溯）
 *   ④ 提交后表单重置清空 referenceId
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InventoryManager.tsx', import.meta.url), 'utf8');

describe('InventoryManager E6 手工变动挂单据号', () => {
  it('变动表单有「关联单据号」输入框（绑定 movementForm.referenceId，bds-input）', () => {
    expect(source).toContain('value={movementForm.referenceId || \'\'}');
    expect(source).toContain('setMovementForm({ ...movementForm, referenceId: e.target.value })');
    expect(source).toContain('placeholder="关联单据号"');
  });

  it('提交：referenceId trim 落库 + 有单据号时 referenceType=Manual', () => {
    expect(source).toContain('const referenceId = movementForm.referenceId?.trim() || undefined');
    expect(source).toContain('referenceId,');
    expect(source).toContain("referenceType: referenceId ? 'Manual' : movementForm.referenceType");
  });

  it('变动流水行展示关联单据号（bds-mono 可追溯）', () => {
    expect(source).toContain('{mv.referenceId && <span className="bds-mono"');
    expect(source).toContain('· 单 {mv.referenceId}');
  });

  it('提交后表单重置清空 referenceId', () => {
    expect(source).toContain("itemId: '', type: 'Inbound', quantity: 0, reason: '', referenceId: '',");
  });

  it('BDS 设计纪律：变动表单段无硬编码 hex/rounded-[Npx]', () => {
    const movementSection = source.slice(source.indexOf('库存变动'));
    expect(movementSection).not.toMatch(/rounded-\[\d+px\]/);
    expect(movementSection).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
