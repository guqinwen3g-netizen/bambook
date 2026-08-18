/**
 * 出口方（我司）档案 — 出运制单引擎共用
 *
 * 真源（2026-08-18 §1A 裁决）：服务端 SystemConfig `global::company.exporterProfile`，
 * 写入口唯一 = AdminPanel「公司档案」Tab → PUT /api/v1/config/company.exporterProfile（仅 SUPER_ADMIN/ADMIN）。
 *
 * 三级回退：服务端值（经 refreshExporterProfile 写入本机只读缓存）→ 本机缓存 → 代码默认值。
 * 本机缓存仅作离线兜底，任何模块禁止把它当可写真源；历史 localStorage 值不自动上传（防脏值扩散）。
 */

import { apiService } from '../../../services/apiService';

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

/** 默认出口方档案（硬编码回退值；服务端 DEFAULT_EXPORTER_PROFILE 同款副本，任一侧修改必须同步另一侧） */
export const EXPORTER_PROFILE: ExporterProfile = {
  nameEn: 'JIANGSU PANDA CLOTHING CO.,LTD.',
  addressEn: 'ROOM A1028 WUYUE PLAZA,\nZHANGJIAGANG CITY, 215600 PR\nCHINA',
  beneficiary: 'JIANGSU PANDA CLOTHING CO.,LTD.',
  bankName: 'BANK OF CHINA ZHANGJIAGANG SUB-BRANCH',
  swiftCode: 'BKCHCNBJ95L',
  bankAddress: '111 MIDDLE RENMIN ROAD, ZHANGJIAGANG CITY, SUZHOU, JIANGSU PROV., P.R.CHINA.',
  usdAccountNumber: '467668133096',
};

/** 本机只读缓存 key（离线兜底；与旧真源 panda_system_config.exporterProfile 解耦，旧值不迁移不上传） */
const CACHE_KEY = 'bambook_exporter_profile_cache_v1';
/** 后台刷新节流：60s 内多次调用只发一次请求（失败同样节流，避免离线时每张单据打一次失败请求） */
const REFRESH_INTERVAL_MS = 60_000;

let refreshInflight: Promise<void> | null = null;
let lastRefreshAt = 0;

function readCachedProfile(): ExporterProfile {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return EXPORTER_PROFILE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EXPORTER_PROFILE;
    return { ...EXPORTER_PROFILE, ...parsed };
  } catch {
    return EXPORTER_PROFILE;
  }
}

/**
 * 从服务端拉取最新公司档案写入本机只读缓存。
 * 未登录 / 离线 / 服务端不可达时静默回退（本地回退链不受影响）。
 * AdminPanel 保存成功后应调用 refreshExporterProfile(true) 强制刷新缓存。
 */
export function refreshExporterProfile(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRefreshAt < REFRESH_INTERVAL_MS) return Promise.resolve();
  if (!refreshInflight) {
    lastRefreshAt = now;
    refreshInflight = (async () => {
      try {
        const res = await apiService.getCompanyExporterProfile();
        if (res?.value && typeof res.value === 'object') {
          localStorage.setItem(CACHE_KEY, JSON.stringify(res.value));
        }
      } catch {
        // 静默：离线/未登录均走本地回退链
      } finally {
        refreshInflight = null;
      }
    })();
  }
  return refreshInflight;
}

/**
 * 单据生成同步读取：本机缓存（= 最近一次服务端值）→ 代码默认值。
 * 首次调用时后台触发一次服务端刷新（下一次调用即生效），消费方零改动。
 */
export function getExporterProfile(): ExporterProfile {
  void refreshExporterProfile();
  return readCachedProfile();
}
