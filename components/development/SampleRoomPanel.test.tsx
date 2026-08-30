import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SampleRoomPanel.tsx', import.meta.url), 'utf8');
const devSource = readFileSync(new URL('../DevelopmentManager.tsx', import.meta.url), 'utf8');
const invSource = readFileSync(new URL('../InventoryManager.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const crossNavSource = readFileSync(new URL('../../services/crossModuleNav.ts', import.meta.url), 'utf8');
const frontSampleServiceSource = readFileSync(new URL('../../services/sampleRoomService.ts', import.meta.url), 'utf8');
const devSvcSource = readFileSync(new URL('../../services/developmentService.ts', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('../../server/src/development/route.ts', import.meta.url), 'utf8');

describe('SampleRoomPanel REQ2-16（DR-057）', () => {
  it('可折叠区块 + 状态统计（在库/在借/逾期）', () => {
    expect(source).toContain('样品间 SAMPLE ROOM');
    expect(source).toContain('setExpanded');
    expect(source).toContain('在借 {stats.borrowed}');
    // v2：逾期改为 JSX 条件渲染（原三元模板字符串已重构）
    expect(source).toContain('stats.overdue > 0');
    expect(source).toContain('逾期 {stats.overdue}');
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

  it('联动（DR-057 v2.1）：开发单「样品库存」按钮跳转库存管理·样品 Tab + devCaseId 预过滤（不再底部内嵌）', () => {
    // 按钮簇「样品库存」：prime tab='samples' + focusEntityId=devCaseId，再 onNavigate(View.Inventory)
    expect(devSource).toContain("primeCrossModuleNav({ view: View.Inventory, tab: 'samples', focusEntityId: selectedCase.id })");
    expect(devSource).toContain('onNavigate(View.Inventory)');
    expect(devSource).toContain('title="跳转到库存管理·样品间，并按本开发单预过滤"');
    // 本页不再底部内嵌 SampleRoomPanel（用户验收口径：内嵌展开视觉混乱，改为整页跳转）
    expect(devSource).not.toContain("import SampleRoomPanel from './development/SampleRoomPanel'");
    expect(devSource).not.toContain('<SampleRoomPanel');
  });

  it('联动（DR-057 v2.1）：开发单「样品发票」按钮跳转财务·发票管理', () => {
    expect(devSource).toContain('样品发票');
    expect(devSource).toContain('onNavigate(View.Invoices)');
    expect(devSource).toContain("'跳转到财务·发票管理，并直达关联的样品发票详情'");
    expect(devSource).toContain("'跳转到财务·发票管理，登记或查看本开发单的样品发票（编辑表单可关联发票 ID 直达）'");
  });

  it('寄样信息（DR-057 v2.1）：表单区块 + Inspector 全量留痕', () => {
    // 表单「寄样信息」区块：数量/单位/寄出日期/快递公司/单号/邮寄费
    expect(devSource).toContain('title="寄样信息"');
    expect(devSource).toContain('COURIER_OPTIONS');
    expect(devSource).toContain('SAMPLE_UNIT_OPTIONS');
    expect(devSource).toContain("updateField('sampleShippingFee', e.target.value)");
    expect(devSource).toContain("updateField('sampleTrackingNumber', e.target.value)");
    expect(devSource).toContain("updateField('sampleCourier', e.target.value)");
    // 提交链路：数量/邮寄费数值校验 + 条件提交
    expect(devSource).toContain('邮寄费必须是有效的非负数值');
    expect(devSource).toContain('...(parsedFee != null ? { sampleShippingFee: parsedFee } : {})');
    // 寄样收件信息（DR-057 v2.1 扩展）：表单 4 字段 + 条件提交
    expect(devSource).toContain("updateField('sampleRecipientName', e.target.value)");
    expect(devSource).toContain("updateField('sampleRecipientCompany', e.target.value)");
    expect(devSource).toContain("updateField('sampleRecipientAddress', e.target.value)");
    expect(devSource).toContain("updateField('sampleRecipientPhone', e.target.value)");
    expect(devSource).toContain('...(form.sampleRecipientName.trim() ? { sampleRecipientName: form.sampleRecipientName.trim() } : {})');
    // Inspector 行补全
    expect(devSource).toContain("label: '寄出日期'");
    expect(devSource).toContain("label: '快递公司'");
    expect(devSource).toContain("label: '邮寄费'");
    expect(devSource).toContain("label: '样品数量'");
    expect(devSource).toContain("label: '收件人'");
    expect(devSource).toContain("label: '收件地址'");
    expect(devSource).toContain("label: '联系电话'");
  });

  it('样品发票直达（DR-057 v2.1 扩展）：关联 sampleInvoiceId 后 primeFinanceInvoiceFocus 直达发票详情', () => {
    expect(devSource).toContain("import { primeFinanceInvoiceFocus } from './FinanceManager'");
    expect(devSource).toContain('if (selectedCase.sampleInvoiceId) {');
    expect(devSource).toContain('primeFinanceInvoiceFocus(selectedCase.sampleInvoiceId);');
    // R678：发票 ID 手输 → finance 列表接口搜索下拉（300ms 防抖，选中快照发票号）
    expect(devSource).toContain("apiService.listInvoicesPage(undefined, { search: invQuery.trim(), limit: 6 })");
    expect(devSource).toContain("updateField('sampleInvoiceId', inv.id)");
  });

  it('发票↔开发单双向闭环（DR-057 v2.1 扩展）：发票详情反查引用开发单 + 可点击直达', () => {
    const finSource = readFileSync(new URL('../FinanceManager.tsx', import.meta.url), 'utf8');
    // FinanceManager：反查 + 直达跳转
    expect(finSource).toContain("developmentService.listDevelopmentCases(undefined, { sampleInvoiceId: selectedItem.id, limit: 5 })");
    expect(finSource).toContain('关联开发单（{linkedDevCases.length}）');
    expect(finSource).toContain('primeCrossModuleNav({ view: View.Development, focusEntityId: dc.id })');
    // 前端 service：sampleInvoiceId 过滤参数
    expect(devSvcSource).toContain("query.set('sampleInvoiceId', params.sampleInvoiceId)");
    // 后端 route：where 过滤
    expect(routeSource).toContain('{ sampleInvoiceId: String(sampleInvoiceId) }');
  });

  it('寄样成本统计（DR-057 v2.1 扩展）：筛选行展示当前范围邮寄费合计', () => {
    expect(devSource).toContain('filteredCases.reduce((sum, c) => sum + (Number(c.sampleShippingFee) || 0), 0)');
    expect(devSource).toContain('寄样支出');
  });

  it('大货订单直达（DR-057 v2.1 扩展）：已转订单按钮 → onOpenOrder 直达订单详情', () => {
    expect(devSource).toContain('onOpenOrder(selectedCase.linkedOrderId!)');
    expect(appSource).toContain('<DevelopmentManager isDarkMode={isDarkMode} cases={developmentCases} setCases={setDevelopmentCases} onNavigate={handleViewChange} onOpenOrder={handleOpenOrderById} />');
  });

  it('v2 库存联动：数量/仓库/盘点/借出多数量/低库存预警', () => {
    // 样卡登记表单扩展：quantity/minStock/maxStock/unit/warehouseId/devCaseId/orderId
    expect(source).toContain('quantity: Number(itemForm.quantity)');
    expect(source).toContain('minStock: minNum');
    expect(source).toContain('maxStock: maxNum');
    expect(source).toContain('warehouseId: itemForm.warehouseId');
    expect(source).toContain('devCaseId: itemForm.devCaseId');
    expect(source).toContain('orderId: itemForm.orderId');
    // 借出 loanQuantity（部分借出：availableQty>0 仍 in_stock）
    expect(source).toContain('loanQuantity: qty');
    expect(source).toContain('借出数量不可超过可用库存');
    expect(source).toContain('部分借出（仍有余量）保持「在库」状态');
    // 盘点 adjustQuantity（保留在借数量）
    expect(source).toContain('sampleRoomService.adjustQuantity(adjustTarget.id');
    expect(source).toContain('盘点只改总量；在借数量自动保留');
    // 列表显示数量 + 关联单据摘要
    expect(source).toContain('可用');
    expect(source).toContain('总');
    expect(source).toContain('item.devCaseCode');
    expect(source).toContain('item.orderPoNumber');
    expect(source).toContain('item.warehouseName');
    // 仓库选择器 + 低库存筛选
    expect(source).toContain('全部仓库');
    expect(source).toContain('仅低库存');
    expect(source).toContain('lowStock: lowStockOnly');
    // collapsible prop（InventoryManager Tab 用 collapsible={false}，由该测试用例覆盖）
    expect(source).toContain('collapsible');
  });

  it('InventoryManager 第 4 Tab「样品」挂载 + 跨模块导航消费（开发单跳转预过滤）', () => {
    expect(invSource).toContain("import SampleRoomPanel from './development/SampleRoomPanel'");
    expect(invSource).toContain("'items' | 'warehouses' | 'alerts' | 'samples'");
    expect(invSource).toContain("activeTab === 'samples'");
    expect(invSource).toContain('<SampleRoomPanel');
    // 跨模块导航消费：开发单详情「样品库存」跳转过来 → tab='samples' 直达 + focusEntityId=devCaseId 预过滤
    expect(invSource).toContain('consumeCrossModuleNav');
    expect(invSource).toContain("navCtx?.view === View.Inventory && navCtx?.tab === 'samples'");
    expect(invSource).toContain('(navToSamples ? \'samples\' : \'items\')');
    expect(invSource).toContain('devCaseId={sampleFilterDevCaseId || undefined}');
    expect(invSource).toContain('onClearFilter={() => { setSampleFilterDevCaseId(null); setSampleFilterProductAssetId(null); }}');
  });
});

describe('SampleRoomPanel 跨模块联动跳转（DR-057 v2.1：样品间↔档案/开发单/订单）', () => {
  it('props 接口声明 onNavigate / onOpenOrder（用于跨模块跳转）', () => {
    expect(source).toContain('onNavigate?: (view: View) => void');
    expect(source).toContain('onOpenOrder?: (orderId: string) => void');
    expect(source).toContain('import { primeCrossModuleNav }');
    expect(source).toContain("import { View } from '../../types';");
  });

  it('chips 可点击：开发单/订单/产品档案 chip 渲染为 button 元素并绑定 onClick', () => {
    // 关联单据 chips 整体容器存在
    expect(source).toContain('关联单据 chips');
    // 开发单 chip → 调用 openDevCaseDetail(item.devCaseId)
    expect(source).toContain('openDevCaseDetail(item.devCaseId');
    expect(source).toContain('title="跳转到开发单详情"');
    // 订单 chip → 调用 openOrderDetail(item.orderId)
    expect(source).toContain('openOrderDetail(item.orderId');
    expect(source).toContain('title="跳转到订单详情"');
    // 产品档案 chip → 调用 openProductDetail(item.productAssetId, item.productAssetName)
    expect(source).toContain('openProductDetail(item.productAssetId');
    expect(source).toContain('title="跳转到产品档案详情"');
  });

  it('跨模块跳转 handler：primeCrossModuleNav 写入导航上下文 + onNavigate 切 View', () => {
    // 开发单：focusEntityId 直达详情
    expect(source).toContain('primeCrossModuleNav({ view: View.Development, focusEntityId: devCaseId })');
    expect(source).toContain('onNavigate(View.Development)');
    // 产品档案：product 锚 + focusEntityId 双携带
    expect(source).toContain("filter: { anchor: 'product', productId, productName: productName || undefined }");
    expect(source).toContain('focusEntityId: productId');
    expect(source).toContain('onNavigate(View.Products)');
    // 订单：直接调 onOpenOrder
    expect(source).toContain('onOpenOrder?.(oid)');
  });

  it('降级：onNavigate 未提供时 chip 退化为 span（不可点击，不报错）', () => {
    // 三元降级 span 渲染（devCaseId / orderId / productAssetId 都有降级 span）
    expect(source).toMatch(/onNavigate && item\.devCaseId \? \(\s*<button/);
    expect(source).toMatch(/onOpenOrder && item\.orderId \? \(\s*<button/);
    expect(source).toMatch(/onNavigate && item\.productAssetId \? \(\s*<button/);
  });

  it('登记表单扩展 productAssetId 字段（关联产品档案搜索选择，DR-057 v2.1 升级）', () => {
    expect(source).toContain("productAssetId: ''");
    expect(source).toContain('productAssetId: itemForm.productAssetId.trim()');
    // 搜索选择化：产品档案 + 开发单搜索下拉（替代手输 ID）
    expect(source).toContain('apiService.listProductAssets(undefined, { search: paQuery.trim(), limit: 5 })');
    expect(source).toContain('developmentService.listDevelopmentCases(undefined, { search: devQuery.trim(), limit: 5 })');
    expect(source).toContain('关联产品档案（可选）');
    expect(source).toContain('关联开发单（可选）');
  });

  it('档案反查联动（DR-057 v2.1 扩展）：SampleRoomPanel 产品锚预过滤 + InventoryManager 消费 + 档案详情反查区块', () => {
    // SampleRoomPanel：productAssetId 预过滤 prop（listItems 传参 + 预过滤 chip）
    expect(source).toContain('productAssetId?: string;');
    expect(source).toContain('productAssetId: productAssetId || undefined');
    expect(source).toContain('预过滤：产品档案');
    // InventoryManager：product 锚消费（filter.anchor === 'product' → productAssetId 预过滤）
    expect(invSource).toContain("navCtx?.filter?.anchor === 'product'");
    expect(invSource).toContain('productAssetId={sampleFilterProductAssetId || undefined}');
    // ProductsManager：档案详情反查区块（实物样卡 + 开发单，含跳转）
    const productsSource = readFileSync(new URL('../ProductsManager.tsx', import.meta.url), 'utf8');
    expect(productsSource).toContain('const LinkedSampleRoomSection');
    expect(productsSource).toContain('sampleRoomService.listItems({ productAssetId: productId, limit: 6 })');
    expect(productsSource).toContain('developmentService.listDevelopmentCases(undefined, { productAssetId: productId, limit: 6 })');
    expect(productsSource).toContain('primeCrossModuleNav({ view: View.Development, focusEntityId: dc.id })');
    // developmentService + 后端 route：productAssetId 反查过滤
    expect(devSvcSource).toContain("query.set('productAssetId', params.productAssetId)");
    expect(routeSource).toContain('{ productAssetId: String(productAssetId) }');
  });

  it('紧凑行（xl+）展示档案摘要（productAssetSku/Name）', () => {
    expect(source).toContain('item.productAssetSku || item.productAssetName');
    expect(source).toContain('`档案 ${item.productAssetSku || item.productAssetName}`');
  });

  it('前端 sampleRoomService 类型扩展：SampleCardItemView 加 productAssetId + 档案摘要字段', () => {
    expect(frontSampleServiceSource).toContain('productAssetId?: string | null;');
    expect(frontSampleServiceSource).toContain('productAssetSku?: string | null;');
    expect(frontSampleServiceSource).toContain('productAssetName?: string | null;');
    expect(frontSampleServiceSource).toContain('productAssetCategory?: string | null;');
    // createItem + listItems 入参支持 productAssetId
    expect(frontSampleServiceSource).toContain('productAssetId?: string;\n  }, endpoint?: string): Promise<SampleCardItemView>');
    expect(frontSampleServiceSource).toContain("params.productAssetId) query.set('productAssetId', params.productAssetId)");
  });

  it('crossModuleNav.ts 扩展 focusEntityId 字段（顶层直达锚）', () => {
    expect(crossNavSource).toContain('focusEntityId?: string;');
    expect(crossNavSource).toContain('typeof parsed.focusEntityId === \'string\'');
  });

  it('InventoryManager 透传 onNavigate/onOpenOrder 给 SampleRoomPanel', () => {
    expect(invSource).toContain('onNavigate?: (view: View) => void;');
    expect(invSource).toContain('onOpenOrder?: (orderId: string) => void;');
    expect(invSource).toContain('onNavigate={onNavigate}');
    expect(invSource).toContain('onOpenOrder={onOpenOrder}');
    expect(invSource).toContain('View,');
  });

  it('App.tsx 给 InventoryManager 传入 onNavigate + onOpenOrder（最小改动 2 个 prop）', () => {
    expect(appSource).toContain('<InventoryManager isDarkMode={isDarkMode} onNavigate={handleViewChange} onOpenOrder={handleOpenOrderById} />');
  });

  it('ProductsManager 挂载时消费 focusEntityId 打开档案详情', () => {
    const productsSource = readFileSync(new URL('../ProductsManager.tsx', import.meta.url), 'utf8');
    expect(productsSource).toContain("import { consumeCrossModuleNav, peekCrossModuleNav, primeCrossModuleNav } from '../services/crossModuleNav'");
    expect(productsSource).toContain("const [navFocusEntityId] = useState(() => consumeCrossModuleNav()?.focusEntityId ?? null);");
    expect(productsSource).toContain('setSelectedProduct(matched)');
    expect(productsSource).toContain("setNavLevel('detail')");
  });

  it('DevelopmentManager 挂载时消费 focusEntityId 定位开发单详情', () => {
    expect(devSource).toContain('const [navCtx, setNavCtx] = useState(() => consumeCrossModuleNav());');
    expect(devSource).toContain('const navFocusEntityId = navCtx?.focusEntityId ?? null;');
    expect(devSource).toContain('if (matched) setSelectedCaseId(matched.id);');
  });
});
