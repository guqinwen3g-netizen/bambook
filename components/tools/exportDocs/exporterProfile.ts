/**
 * 出口方（我司）档案 — 出运制单引擎共用
 *
 * 取值与样品发票模板 DEFAULT_SAMPLE_INVOICE_TEMPLATE 保持一致。
 * 单据打印窗口为独立 document 上下文，此处仅承载文本数据，不含样式。
 */

export interface ExporterProfile {
  /** 公司英文名（单据抬头） */
  nameEn: string;
  /** 公司英文地址（多行用 \n 分隔） */
  addressEn: string;
  /** 受益人名（银行/保险单据） */
  beneficiary: string;
  /** 银行信息（CI 付款条款引用） */
  bankName: string;
  swiftCode: string;
  bankAddress: string;
  usdAccountNumber: string;
}

export const EXPORTER_PROFILE: ExporterProfile = {
  nameEn: 'JIANGSU PANDA CLOTHING CO.,LTD.',
  addressEn: 'ROOM A1028 WUYUE PLAZA,\nZHANGJIAGANG CITY, 215600 PR\nCHINA',
  beneficiary: 'JIANGSU PANDA CLOTHING CO.,LTD.',
  bankName: 'BANK OF CHINA ZHANGJIAGANG SUB-BRANCH',
  swiftCode: 'BKCHCNBJ95L',
  bankAddress: '111 MIDDLE RENMIN ROAD, ZHANGJIAGANG CITY, SUZHOU, JIANGSU PROV., P.R.CHINA.',
  usdAccountNumber: '467668133096',
};
