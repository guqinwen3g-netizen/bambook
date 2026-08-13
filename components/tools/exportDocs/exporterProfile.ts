/**
 * 出口方（我司）档案 — 出运制单引擎共用
 *
 * 默认值保留为常量 EXPORTER_PROFILE，运行时通过 getExporterProfile()
 * 从 SystemConfig（localStorage）读取用户配置的值，回退到默认值。
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

/** 默认出口方档案（硬编码回退值） */
export const EXPORTER_PROFILE: ExporterProfile = {
  nameEn: 'JIANGSU PANDA CLOTHING CO.,LTD.',
  addressEn: 'ROOM A1028 WUYUE PLAZA,\nZHANGJIAGANG CITY, 215600 PR\nCHINA',
  beneficiary: 'JIANGSU PANDA CLOTHING CO.,LTD.',
  bankName: 'BANK OF CHINA ZHANGJIAGANG SUB-BRANCH',
  swiftCode: 'BKCHCNBJ95L',
  bankAddress: '111 MIDDLE RENMIN ROAD, ZHANGJIAGANG CITY, SUZHOU, JIANGSU PROV., P.R.CHINA.',
  usdAccountNumber: '467668133096',
};

/**
 * 从 SystemConfig（localStorage）读取出口方档案，合并默认值。
 *
 * 用户在设置页编辑公司抬头后，值会存入 `panda_system_config` JSON
 * 的 `exporterProfile` 字段。此函数读取并合并，确保新增字段有默认回退。
 */
export function getExporterProfile(): ExporterProfile {
  try {
    const raw = localStorage.getItem('panda_system_config');
    if (!raw) return EXPORTER_PROFILE;
    const parsed = JSON.parse(raw);
    const stored = parsed?.exporterProfile;
    if (!stored || typeof stored !== 'object') return EXPORTER_PROFILE;
    return { ...EXPORTER_PROFILE, ...stored };
  } catch {
    return EXPORTER_PROFILE;
  }
}
