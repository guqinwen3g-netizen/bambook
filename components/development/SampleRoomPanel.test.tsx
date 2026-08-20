import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SampleRoomPanel.tsx', import.meta.url), 'utf8');
const devSource = readFileSync(new URL('../DevelopmentManager.tsx', import.meta.url), 'utf8');

describe('SampleRoomPanel REQ2-16（DR-057）', () => {
  it('可折叠区块 + 状态统计（在库/在借/逾期）', () => {
    expect(source).toContain('样品间 SAMPLE ROOM');
    expect(source).toContain('setExpanded');
    expect(source).toContain('在借 {stats.borrowed}');
    expect(source).toContain('stats.overdue > 0 ? ` · 逾期 ${stats.overdue}`');
  });

  it('登记表单（名称/类型/架位/Pantone 关联）+ 登记后直出二维码', () => {
    expect(source).toContain('登记样卡');
    expect(source).toContain("value={itemForm.name}");
    expect(source).toContain("value={itemForm.location}");
    expect(source).toContain('关联 Pantone 色号');
    expect(source).toContain('登记并出二维码');
    expect(source).toContain('openQr(item);');
  });

  it('二维码载荷 = 样卡编号（qrcode 库 toDataURL + 打印贴卡）', () => {
    expect(source).toContain("import * as QRCode from 'qrcode'");
    expect(source).toContain('QRCode.toDataURL(item.code');
    expect(source).toContain('打印贴卡');
    expect(source).toContain('扫码按编号直达样卡');
  });

  it('借出/看样双类型 BottomSheet（borrow 占状态 + viewing 挂客户即看即还）', () => {
    expect(source).toContain("['borrow', '内部借出'], ['viewing', '客户看样']");
    expect(source).toContain('loanType: type');
    expect(source).toContain('看样即看即还（不占借出状态），记录挂客户档案');
    expect(source).toContain('逾期（超过预计归还日未还）在列表标红提醒');
  });

  it('归还（bdsConfirm）+ 退役（danger 确认，终态警示）', () => {
    expect(source).toContain('handleReturn');
    expect(source).toContain('sampleRoomService.returnLoan(item.activeLoan.id)');
    expect(source).toContain('退役为终态，不可再借出/看样');
    expect(source).toContain('danger: true');
  });

  it('状态徽章 bds-badge 语义变体 + 状态筛选/搜索', () => {
    expect(source).toContain("STATUS_TONES[item.status] ?? 'neutral'");
    expect(source).toContain('value={statusFilter}');
    expect(source).toContain('placeholder="样卡名 / 编号 / 架位"');
  });

  it('挂载：DevelopmentManager 列表视图底部（App.tsx 冻结期不出新页）', () => {
    expect(devSource).toContain("import SampleRoomPanel from './development/SampleRoomPanel'");
    expect(devSource).toContain('<SampleRoomPanel isDarkMode={isDarkMode} />');
    expect(devSource).toContain('REQ2-16 样品间（DR-057）');
  });
});
