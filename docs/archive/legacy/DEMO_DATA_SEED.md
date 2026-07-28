# Bambook DEMO 案例数据清单

本文档说明 `server/scripts/seed-demo-data.ts` 写入的正式库演示数据。所有数据均带显式 `DEMO` 标记，用于甲方验收、演示和质询，不代表真实业务。

## 标记规则

- 关系数据：`Relation.tags` 包含 `DEMO`，名称包含 `【演示】`。
- 面料档案：`ProductAsset.id` 以 `DEMO-PROD-` 开头，`sku` 以 `DEMO-FAB-` 开头。
- 订单数据：`Order.id` / `poNumber` 以 `DEMO-PO-` 开头，`source = demo`。
- 所有 ID 固定，脚本可幂等重跑，可通过 `--rollback` 删除本批数据。

## 数据规模

- 客户组织：2 个
- 面料供应商 / 工厂：4 个
- 联系人：7 个
- 面料档案：6 个
- 成分明细：13 行
- 客户品号：6 条
- 价格记录：24 条
- 认证记录：9 条
- 订单：6 个
- 订单明细：9 行

## 客户

| ID | 名称 | 场景 |
|:---|:---|:---|
| `DEMO-CUST-ATLAS` | 【演示】Atlas Outfitters Ltd. | 美国男装与户外休闲客户，偏好棉弹力、尼龙棉和再生功能面料 |
| `DEMO-CUST-NORDEN` | 【演示】Norden Studio AB | 北欧高端休闲客户，重视环保认证和秋冬毛感面料 |

## 供应商 / 面料工厂

| ID | 名称 | 擅长品类 |
|:---|:---|:---|
| `DEMO-MILL-JINHUA` | 【演示】Jinhua Evergreen Textile Mill | 棉弹力斜纹、府绸、帆布 |
| `DEMO-MILL-SUZHOU` | 【演示】Suzhou BlueRiver Dyeing & Weaving | 涤粘混纺、毛感针织 |
| `DEMO-MILL-NANTONG` | 【演示】Nantong NorthStar Knitting | 双面布、抓毛布、罗纹和功能针织 |
| `DEMO-MILL-SHAOXING` | 【演示】Shaoxing GreenLoop Recycled Textiles | 再生涤纶、环保混纺、功能涂层 |

## 面料档案

| SKU | 名称 | 供应商 | 关键点 |
|:---|:---|:---|:---|
| `DEMO-FAB-CST-240-OLIVE` | Cotton Stretch Twill 240gsm - Olive | Jinhua Evergreen | 97% 棉 + 3% 氨纶，常规稳定品 |
| `DEMO-FAB-CPP-115-WHITE` | Cotton Poplin 115gsm - Optical White | Jinhua Evergreen | 100% 棉府绸，需关注白度和缩水 |
| `DEMO-FAB-PV-310-GREY` | Poly Viscose Melange 310gsm - Grey | Suzhou BlueRiver | 涤粘氨毛感针织，需复测起毛起球 |
| `DEMO-FAB-RPET-RIP-145-NAVY` | Recycled Polyester Ripstop 145gsm - Navy | Shaoxing GreenLoop | 100% 再生涤纶，GRS 资料必备 |
| `DEMO-FAB-WLK-360-CAMEL` | Wool-like Brushed Knit 360gsm - Camel | Nantong NorthStar | 秋冬毛感抓毛针织，交期长 |
| `DEMO-FAB-NC-190-KHAKI` | Nylon Cotton Stretch 190gsm - Khaki | Shaoxing GreenLoop | 尼龙棉弹力，坯布库存风险 |

## 订单

| PO | 客户 | 供应商 | 状态 | 用途 |
|:---|:---|:---|:---|:---|
| `DEMO-PO-2601001` | Atlas | Jinhua Evergreen | Production | 常规棉弹力订单，验证生产中状态 |
| `DEMO-PO-2601002` | Norden | Nantong NorthStar | Pending | 秋冬毛感针织订单，验证长交期和未确认状态 |
| `DEMO-PO-2601003` | Atlas | Shaoxing GreenLoop | Shipping | 再生涤纶出货中，验证出货字段 |
| `DEMO-PO-2601004` | Norden | Suzhou BlueRiver | Delivered | 已交付订单，验证开票、收款和统计 |
| `DEMO-PO-2601005` | Atlas | Shaoxing GreenLoop | Alert | 风险订单，验证预警和风险描述 |
| `DEMO-PO-2601006` | Atlas | Jinhua Evergreen | Pending | 追加/补单，验证多订单同供应商链路 |

## 推荐演示路径

1. 在关系智库搜索 `DEMO`，展示 2 个客户、4 个供应商和联系人归属。
2. 在产品档案搜索 `DEMO-FAB`，展示 6 个面料档案的规格、成分、认证、价格、客户编码。
3. 打开 `DEMO-FAB-CST-240-OLIVE`，说明客户品号、供应商、成分、价格和风险备注。
4. 在订单列表搜索 `DEMO-PO`，展示 6 个订单覆盖 Pending / Production / Shipping / Delivered / Alert。
5. 打开 `DEMO-PO-2601005`，说明为什么这是风险订单：坯布库存不足、交期紧、样品确认不完整。
6. 打开 `DEMO-PO-2601004`，说明已交付订单有发票、收款、供应商发票等字段。
7. 按供应商或客户维度解释业务闭环：客户 → 面料档案 → 订单 → 出货/金额/风险。

## 不包含内容

本批 seed 不上传真实图片文件。图片功能已经有独立数据库模型和上传 API，但正式演示图片应通过 UI 或上传 API 上传真实文件后生成 `ProductImage` 记录，避免脚本伪造不存在的图片路径。
