import React, { useMemo, useRef, useState } from 'react';
import { BookOpenText, CheckCircle2, ChevronLeft, ChevronRight, Columns3, Database, Plus, Save, Search, SlidersHorizontal, Tags, Trash2 } from 'lucide-react';
import { apiService } from '../../../services/apiService';
import { COMPOSITION_TERMS } from '../../../data/compositionTerms';
import type { MainCategory, ProductAsset, ProductSubCategory } from '../../../types';
import {
  RELATIONS_FORM_NESTED_ROW_DARK_CLASS,
  RELATIONS_FORM_NESTED_ROW_LIGHT_CLASS,
} from '../relationsFormStyles';
import { BAMBOOK_OS } from '../bambookOsTokens';
import {
  CompiledInteractiveCard,
  CompiledFormSectionPanel,
  CompiledModuleTitleBar,
  CompiledSplitMainPanel,
  CompiledSplitNavPanel,
  CompiledSplitWorkspace,
} from './compiledPrimitives';

export const UI_LAB_PRODUCT_MODULE_SETTINGS_KEY = 'bambook_ui_lab_product_module_settings';
const PRODUCT_MODULE_SETTINGS_DEMO_NOW = 1772380800000;

const PRODUCT_MODULE_MAIN_CATEGORY_OPTIONS: Array<{ id: MainCategory; label: string }> = [
  { id: 'Fabric', label: '面料' },
  { id: 'Garment', label: '成衣' },
  { id: 'Accessories', label: '配饰' },
  { id: 'Trimmings', label: '辅料' },
  { id: 'Merchandise', label: '周边' },
  { id: 'Other', label: '其他' },
];
const PRODUCT_MODULE_FIELD_DEFINITIONS = [
  { id: 'sku', label: 'SKU', group: '基础信息' },
  { id: 'name', label: '名称', group: '基础信息' },
  { id: 'season', label: '季节', group: '基础信息' },
  { id: 'articleNo', label: '工厂品号', group: '面料信息' },
  { id: 'millQuality', label: '工厂品质', group: '面料信息' },
  { id: 'composition', label: '成分', group: '面料信息' },
  { id: 'weight', label: '克重', group: '规格参数' },
  { id: 'width', label: '门幅', group: '规格参数' },
  { id: 'factoryPrice', label: '工厂价', group: '价格库存' },
  { id: 'customerPrice', label: '销售价', group: '价格库存' },
  { id: 'stockStatus', label: '库存状态', group: '价格库存' },
  { id: 'certification', label: '认证', group: '认证风险' },
];
const PRODUCT_MODULE_TABLE_COLUMN_DEFINITIONS = [
  { id: 'sku', label: 'SKU' },
  { id: 'name', label: '名称' },
  { id: 'articleNo', label: '品号' },
  { id: 'millQuality', label: '品质' },
  { id: 'clientCode', label: '客户编号' },
  { id: 'factoryPrice', label: '工厂价' },
  { id: 'salesPrice', label: '销售价' },
  { id: 'stock', label: '库存' },
  { id: 'updatedAt', label: '更新' },
];
const PRODUCT_MODULE_SORT_OPTIONS = [
  { value: 'updatedAt:desc', label: '更新 最新优先' },
  { value: 'sku:asc', label: 'SKU A-Z' },
  { value: 'name:asc', label: '名称 A-Z' },
  { value: 'articleNo:asc', label: '品号 A-Z' },
  { value: 'factoryPrice:desc', label: '工厂价 高到低' },
  { value: 'stock:desc', label: '库存 多到少' },
];
const PRODUCT_MODULE_STATUS_OPTIONS: Array<{ value: ProductAsset['status']; label: string }> = [
  { value: 'Development', label: '开发中' },
  { value: 'Active', label: '启用' },
  { value: 'Archived', label: '归档' },
];
export type ProductModuleSettingsSectionId =
  | 'overview'
  | 'field-management'
  | 'classification-system'
  | 'dictionary-terms'
  | 'list-display';
type ProductModuleCompositionTerm = {
  id: string;
  abbreviation: string;
  chineseName: string;
  englishName: string;
};
export type UiLabProductModuleSettings = {
  requiredFieldIds: string[];
  visibleTableColumnIds: string[];
  defaultListDisplayMode: 'grid' | 'table';
  defaultSortValue: string;
  statusOptions: Array<ProductAsset['status']>;
  compositionTerms: ProductModuleCompositionTerm[];
  requireSkuUnique: boolean;
  protectManualFields: boolean;
  pdmlAutoMap: boolean;
  updatedAt: number;
};
export const DEFAULT_PRODUCT_MODULE_SETTINGS: UiLabProductModuleSettings = {
  requiredFieldIds: ['sku', 'name', 'season', 'articleNo', 'millQuality'],
  visibleTableColumnIds: ['sku', 'name', 'articleNo', 'millQuality', 'clientCode', 'factoryPrice', 'stock', 'updatedAt'],
  defaultListDisplayMode: 'grid',
  defaultSortValue: 'updatedAt:desc',
  statusOptions: ['Development', 'Active', 'Archived'],
  compositionTerms: COMPOSITION_TERMS.slice(0, 16).map((term, index) => ({
    id: `term-${term.abbreviation || index}`,
    abbreviation: term.abbreviation,
    chineseName: term.chineseName,
    englishName: term.englishName,
  })),
  requireSkuUnique: true,
  protectManualFields: true,
  pdmlAutoMap: false,
  updatedAt: PRODUCT_MODULE_SETTINGS_DEMO_NOW,
};

const normalizeProductModuleSettings = (value: Partial<UiLabProductModuleSettings> | null | undefined): UiLabProductModuleSettings => ({
  ...DEFAULT_PRODUCT_MODULE_SETTINGS,
  ...value,
  requiredFieldIds: Array.isArray(value?.requiredFieldIds) ? value.requiredFieldIds : DEFAULT_PRODUCT_MODULE_SETTINGS.requiredFieldIds,
  visibleTableColumnIds: Array.isArray(value?.visibleTableColumnIds) ? value.visibleTableColumnIds : DEFAULT_PRODUCT_MODULE_SETTINGS.visibleTableColumnIds,
  defaultListDisplayMode: value?.defaultListDisplayMode === 'table' ? 'table' : 'grid',
  defaultSortValue: typeof value?.defaultSortValue === 'string' ? value.defaultSortValue : DEFAULT_PRODUCT_MODULE_SETTINGS.defaultSortValue,
  statusOptions: Array.isArray(value?.statusOptions) && value.statusOptions.length > 0 ? value.statusOptions : DEFAULT_PRODUCT_MODULE_SETTINGS.statusOptions,
  compositionTerms: Array.isArray(value?.compositionTerms) ? value.compositionTerms : DEFAULT_PRODUCT_MODULE_SETTINGS.compositionTerms,
  updatedAt: Number(value?.updatedAt || Date.now()),
});

export const readInitialProductModuleSettings = (): UiLabProductModuleSettings => {
  if (typeof window === 'undefined') return DEFAULT_PRODUCT_MODULE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(UI_LAB_PRODUCT_MODULE_SETTINGS_KEY);
    return normalizeProductModuleSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PRODUCT_MODULE_SETTINGS;
  }
};

export const persistProductModuleSettings = (settings: UiLabProductModuleSettings) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(UI_LAB_PRODUCT_MODULE_SETTINGS_KEY, JSON.stringify(settings));
};

export const parseProductModuleSortValue = (value: string) => {
  const [column = 'updatedAt', dir = 'desc'] = value.split(':');
  return { column, desc: dir !== 'asc' };
};
const UI_LAB_APP_SCALE_POINTS = [
  { width: 1920, scale: 1.00 },
  { width: 2400, scale: 1.25 },
  { width: 2880, scale: 1.45 },
  { width: 3200, scale: 1.65 },
  { width: 3840, scale: 1.90 },
] as const;
const UI_LAB_APP_HEIGHT_SCALE_POINTS = [
  { height: 900, scale: 1.00 },
  { height: 1080, scale: 1.25 },
  { height: 1200, scale: 1.45 },
  { height: 1440, scale: 1.65 },
  { height: 1600, scale: 1.90 },
] as const;
const UI_LAB_PRODUCT_MODULE_SETTINGS_SECTIONS: Array<{
  id: ProductModuleSettingsSectionId;
  title: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}> = [
  {
    id: 'overview',
    title: '设置总览',
    desc: '模块规则、默认行为和同步边界。',
    icon: Database,
  },
  {
    id: 'field-management',
    title: '字段管理',
    desc: '表单字段、规格字段和必填规则。',
    icon: SlidersHorizontal,
  },
  {
    id: 'classification-system',
    title: '分类体系',
    desc: '维护数字档案的产品分类。',
    icon: Tags,
  },
  {
    id: 'dictionary-terms',
    title: '字典词条',
    desc: '维护成分缩写和显示名称。',
    icon: BookOpenText,
  },
  {
    id: 'list-display',
    title: '列表显示',
    desc: '卡片、表格、筛选和排序字段。',
    icon: Columns3,
  },
] as const;


type CompiledProductModuleSettingsWorkspaceBlueprint = {
  template: 'CompiledProductModuleSettingsWorkspace';
  source: 'UiLabProductModuleSettingsWorkspace.ui-lab-1.0.contract';
  provenance: 'accepted';
  sections: typeof UI_LAB_PRODUCT_MODULE_SETTINGS_SECTIONS;
  shellClassName: string;
  titleBarClassName: string;
  panelRowClassName: string;
};

export const compileProductModuleSettingsWorkspace = (): CompiledProductModuleSettingsWorkspaceBlueprint => ({
  template: 'CompiledProductModuleSettingsWorkspace',
  source: 'UiLabProductModuleSettingsWorkspace.ui-lab-1.0.contract',
  provenance: 'accepted',
  sections: UI_LAB_PRODUCT_MODULE_SETTINGS_SECTIONS,
  shellClassName: BAMBOOK_OS.layout.desktopWorkspaceFrameClass,
  titleBarClassName: BAMBOOK_OS.layout.desktopTitleBarWithInsetClass,
  panelRowClassName: BAMBOOK_OS.layout.desktopBackstagePanelRowClass,
});

export const CompiledProductModuleSettingsWorkspace = ({
  isDarkMode,
  products,
  productCategories,
  moduleSettings,
  cloudEndpoint,
  onBack,
  onUpdateCategories,
  onUpdateModuleSettings,
}: {
  isDarkMode: boolean;
  products: ProductAsset[];
  productCategories: ProductSubCategory[];
  moduleSettings: UiLabProductModuleSettings;
  cloudEndpoint?: string;
  onBack: () => void;
  onUpdateCategories: (items: ProductSubCategory[], modified?: ProductSubCategory) => void;
  onUpdateModuleSettings: (settings: UiLabProductModuleSettings) => void;
}) => {
  const blueprint = useMemo(() => compileProductModuleSettingsWorkspace(), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<ProductModuleSettingsSectionId>('overview');
  const [selectedMainCategory, setSelectedMainCategory] = useState<MainCategory>('Fabric');
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [termAbbreviation, setTermAbbreviation] = useState('');
  const [termChineseName, setTermChineseName] = useState('');
  const [termEnglishName, setTermEnglishName] = useState('');
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const activeSection = UI_LAB_PRODUCT_MODULE_SETTINGS_SECTIONS.find(section => section.id === activeSectionId) ?? UI_LAB_PRODUCT_MODULE_SETTINGS_SECTIONS[0];
  const primaryTextClass = isDarkMode ? 'text-white/80' : 'text-slate-900';
  const secondaryTextClass = isDarkMode ? 'text-white/46' : 'text-slate-500';
  const labelClass = `text-[10px] font-light tracking-wide ${isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight}`;
  const inputClass = `h-9 w-full rounded-full border px-3 text-xs font-light outline-none transition ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`;
  const quietButtonClass = `h-9 rounded-full border px-3 text-[11px] font-light transition ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`;
  const selectedButtonClass = isDarkMode ? `${BAMBOOK_OS.controls.selectedSurface.dark} text-white` : `${BAMBOOK_OS.controls.selectedSurface.light} text-slate-800`;
  const tertiaryRowClass = `rounded-inset border p-3 ${isDarkMode ? RELATIONS_FORM_NESTED_ROW_DARK_CLASS : RELATIONS_FORM_NESTED_ROW_LIGHT_CLASS}`;
  const tinyActionClass = `h-8 rounded-full border px-3 text-[11px] font-light transition ${isDarkMode ? 'border-white/8 text-white/58 hover:bg-white/6 hover:text-white/78' : 'border-white/40 text-slate-500 hover:bg-white/50 hover:text-slate-800'}`;
  const switchControlClass = (checked: boolean) => `group relative inline-flex h-8 w-[58px] shrink-0 items-center rounded-full border p-[3px] transition-[background,border-color,box-shadow] duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${checked
    ? (isDarkMode
      ? 'bambook-state-switch-track--checked-dark'
      : 'bambook-state-switch-track--checked-light')
    : (isDarkMode
      ? 'border-white/[0.06] bg-white/[0.14] shadow-none'
      : 'border-slate-300/20 bg-slate-400/18 shadow-none')}`;
  const switchSliderClass = (checked: boolean) => `h-[26px] w-[34px] rounded-full transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${checked ? 'translate-x-[18px]' : 'translate-x-0'} ${isDarkMode
    ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(232,238,245,0.88)_100%)] shadow-none'
    : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(245,248,252,0.92)_100%)] shadow-none'}`;

  const categoriesForMain = useMemo(() => {
    const query = categoryQuery.trim().toLowerCase();
    return productCategories
      .filter(category => category.mainCategory === selectedMainCategory && !category.deletedAt)
      .filter(category => !query || category.name.toLowerCase().includes(query) || (category.description || '').toLowerCase().includes(query));
  }, [categoryQuery, productCategories, selectedMainCategory]);

  const productCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      if (product.deletedAt || product.mainCategory !== selectedMainCategory) continue;
      counts.set(product.subCategoryId || '', (counts.get(product.subCategoryId || '') || 0) + 1);
    }
    return counts;
  }, [products, selectedMainCategory]);

  const patchModuleSettings = (patch: Partial<UiLabProductModuleSettings>) => {
    const next = normalizeProductModuleSettings({ ...moduleSettings, ...patch, updatedAt: Date.now() });
    onUpdateModuleSettings(next);
    setStatusText('已保存');
  };

  const toggleArrayValue = (values: string[], value: string) =>
    values.includes(value) ? values.filter(item => item !== value) : [...values, value];

  const resetCategoryDraft = () => {
    setEditingCategoryId(null);
    setCategoryName('');
    setCategoryDescription('');
  };

  const submitCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) return;
    const existing = editingCategoryId ? productCategories.find(category => category.id === editingCategoryId) : null;
    const item: ProductSubCategory = {
      id: existing?.id || `CAT-${Date.now().toString(36)}`,
      mainCategory: selectedMainCategory,
      name,
      description: categoryDescription.trim() || undefined,
      updatedAt: Date.now(),
    };
    onUpdateCategories(existing ? productCategories.map(category => category.id === item.id ? item : category) : [item, ...productCategories], item);
    resetCategoryDraft();
    setStatusText('分类已保存');
    try {
      await apiService.saveProductCategory(item, cloudEndpoint);
    } catch (error: any) {
      setStatusText(`本地已保存，云端同步失败：${error?.message || String(error)}`);
    }
  };

  const editCategory = (category: ProductSubCategory) => {
    setEditingCategoryId(category.id);
    setCategoryName(category.name);
    setCategoryDescription(category.description || '');
  };

  const deleteCategory = async (category: ProductSubCategory) => {
    const tombstone = { ...category, deletedAt: Date.now(), updatedAt: Date.now() };
    onUpdateCategories(productCategories.map(item => item.id === category.id ? tombstone : item), tombstone);
    if (editingCategoryId === category.id) resetCategoryDraft();
    setStatusText('分类已删除');
    try {
      await apiService.deleteProductCategory(tombstone, cloudEndpoint);
    } catch (error: any) {
      setStatusText(`本地已删除，云端同步失败：${error?.message || String(error)}`);
    }
  };

  const resetTermDraft = () => {
    setEditingTermId(null);
    setTermAbbreviation('');
    setTermChineseName('');
    setTermEnglishName('');
  };

  const submitTerm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const abbreviation = termAbbreviation.trim();
    const chineseName = termChineseName.trim();
    if (!abbreviation || !chineseName) return;
    const term: ProductModuleCompositionTerm = {
      id: editingTermId || `term-${Date.now().toString(36)}`,
      abbreviation,
      chineseName,
      englishName: termEnglishName.trim(),
    };
    patchModuleSettings({
      compositionTerms: editingTermId
        ? moduleSettings.compositionTerms.map(item => item.id === editingTermId ? term : item)
        : [term, ...moduleSettings.compositionTerms],
    });
    resetTermDraft();
  };

  const editTerm = (term: ProductModuleCompositionTerm) => {
    setEditingTermId(term.id);
    setTermAbbreviation(term.abbreviation);
    setTermChineseName(term.chineseName);
    setTermEnglishName(term.englishName);
  };

  const renderSwitch = (label: string, checked: boolean, onChange: () => void) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`flex min-h-11 w-full items-center justify-between gap-4 rounded-inset border px-4 py-2 text-left transition ${checked ? selectedButtonClass : (isDarkMode ? `${BAMBOOK_OS.controls.actionControl.dark} text-white/62` : `${BAMBOOK_OS.controls.actionControl.light} text-slate-600`)}`}
      onClick={onChange}
    >
      <span className="text-xs font-light">{label}</span>
      <span aria-hidden="true" className={switchControlClass(checked)}>
        <span className={switchSliderClass(checked)} />
      </span>
    </button>
  );

  const renderOverview = () => (
    <div className="space-y-4">
      <CompiledFormSectionPanel
        id="product-module-settings-overview-rules"
        title="模块规则"
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        contentBaseClassName="block"
        titleClassName={primaryTextClass}
      >
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {renderSwitch('SKU 必须唯一', moduleSettings.requireSkuUnique, () => patchModuleSettings({ requireSkuUnique: !moduleSettings.requireSkuUnique }))}
          {renderSwitch('保护人工编辑字段', moduleSettings.protectManualFields, () => patchModuleSettings({ protectManualFields: !moduleSettings.protectManualFields }))}
          {renderSwitch('PDML 同步后自动映射', moduleSettings.pdmlAutoMap, () => patchModuleSettings({ pdmlAutoMap: !moduleSettings.pdmlAutoMap }))}
        </div>
      </CompiledFormSectionPanel>
      <CompiledFormSectionPanel
        id="product-module-settings-overview-status"
        title="状态选项"
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        contentBaseClassName="block"
        titleClassName={primaryTextClass}
      >
        <div className="mt-4 grid grid-cols-3 gap-2">
          {PRODUCT_MODULE_STATUS_OPTIONS.map(option => renderSwitch(option.label, moduleSettings.statusOptions.includes(option.value), () => {
            const next = moduleSettings.statusOptions.includes(option.value)
              ? moduleSettings.statusOptions.filter(item => item !== option.value)
              : [...moduleSettings.statusOptions, option.value];
            patchModuleSettings({ statusOptions: next.length > 0 ? next : DEFAULT_PRODUCT_MODULE_SETTINGS.statusOptions });
          }))}
        </div>
      </CompiledFormSectionPanel>
    </div>
  );

  const renderFields = () => (
    <div className="space-y-4">
      <CompiledFormSectionPanel
        id="product-module-settings-fields-required"
        title="必填字段"
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        contentBaseClassName="block"
        titleClassName={primaryTextClass}
      >
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
          {PRODUCT_MODULE_FIELD_DEFINITIONS.map(field => renderSwitch(`${field.group} / ${field.label}`, moduleSettings.requiredFieldIds.includes(field.id), () => {
            patchModuleSettings({ requiredFieldIds: toggleArrayValue(moduleSettings.requiredFieldIds, field.id) });
          }))}
        </div>
      </CompiledFormSectionPanel>
    </div>
  );

  const renderClassification = () => (
    <div className="grid min-h-0 grid-cols-[220px_1fr] gap-4">
      <div className="space-y-2">
        {PRODUCT_MODULE_MAIN_CATEGORY_OPTIONS.map(option => (
          <button
            key={option.id}
            type="button"
            className={`h-10 w-full rounded-inset border px-4 text-left text-xs font-light transition ${selectedMainCategory === option.id ? selectedButtonClass : (isDarkMode ? `${BAMBOOK_OS.controls.actionControl.dark} text-white/58` : `${BAMBOOK_OS.controls.actionControl.light} text-slate-500`)}`}
            onClick={() => {
              setSelectedMainCategory(option.id);
              resetCategoryDraft();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        <CompiledFormSectionPanel
          id="product-module-settings-category-editor"
          title="分类编辑"
          isDarkMode={isDarkMode}
          materialRole="raisedCard"
          contentBaseClassName="block"
          titleClassName={primaryTextClass}
        >
          <form onSubmit={submitCategory}>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
              <label className="space-y-2">
                <span className={labelClass}>分类名称</span>
                <input value={categoryName} onChange={event => setCategoryName(event.target.value)} className={inputClass} />
              </label>
              <label className="space-y-2">
                <span className={labelClass}>说明</span>
                <input value={categoryDescription} onChange={event => setCategoryDescription(event.target.value)} className={inputClass} />
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" className={`${quietButtonClass} flex items-center gap-2`}>
                  <Save size={14} strokeWidth={1.5} />
                  {editingCategoryId ? '保存' : '新增'}
                </button>
                {editingCategoryId && <button type="button" className={tinyActionClass} onClick={resetCategoryDraft}>取消</button>}
              </div>
            </div>
          </form>
        </CompiledFormSectionPanel>
        <CompiledFormSectionPanel
          id="product-module-settings-category-list"
          title="分类列表"
          isDarkMode={isDarkMode}
          materialRole="raisedCard"
          contentBaseClassName="block"
          titleClassName={primaryTextClass}
        >
          <div className="mb-3 flex h-9 items-center gap-2">
            <Search size={15} strokeWidth={1.4} className={secondaryTextClass} />
            <input value={categoryQuery} onChange={event => setCategoryQuery(event.target.value)} placeholder="搜索分类" className={`${inputClass} h-8 flex-1`} />
          </div>
          <div className="grid gap-2">
            {categoriesForMain.map(category => (
              <div key={category.id} className={`grid grid-cols-[1fr_auto] items-center gap-4 ${tertiaryRowClass}`}>
                <button type="button" className="min-w-0 text-left" onClick={() => editCategory(category)}>
                  <div className={`truncate text-sm font-light ${primaryTextClass}`}>{category.name}</div>
                  <div className={`mt-1 truncate text-[11px] font-light ${secondaryTextClass}`}>
                    {category.description || '未填写说明'} · {productCountByCategory.get(category.id) || 0} 个档案
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" className={tinyActionClass} onClick={() => editCategory(category)}>编辑</button>
                  <button type="button" className={`${tinyActionClass} flex items-center`} onClick={() => deleteCategory(category)} aria-label={`删除 ${category.name}`}>
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))}
            {categoriesForMain.length === 0 && (
              <div className={`py-8 text-center text-xs font-light ${secondaryTextClass}`}>没有匹配的分类</div>
            )}
          </div>
        </CompiledFormSectionPanel>
      </div>
    </div>
  );

  const renderDictionary = () => (
    <div className="space-y-4">
      <CompiledFormSectionPanel
        id="product-module-settings-dictionary-editor"
        title="成分词典"
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        contentBaseClassName="block"
        titleClassName={primaryTextClass}
      >
        <form onSubmit={submitTerm}>
          <div className="grid grid-cols-[120px_1fr_1fr_auto] gap-3">
            <label className="space-y-2">
              <span className={labelClass}>缩写</span>
              <input value={termAbbreviation} onChange={event => setTermAbbreviation(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2">
              <span className={labelClass}>中文名</span>
              <input value={termChineseName} onChange={event => setTermChineseName(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2">
              <span className={labelClass}>英文名</span>
              <input value={termEnglishName} onChange={event => setTermEnglishName(event.target.value)} className={inputClass} />
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className={`${quietButtonClass} flex items-center gap-2`}>
                <Plus size={14} strokeWidth={1.5} />
                {editingTermId ? '保存' : '新增'}
              </button>
              {editingTermId && <button type="button" className={tinyActionClass} onClick={resetTermDraft}>取消</button>}
            </div>
          </div>
        </form>
      </CompiledFormSectionPanel>
      <CompiledFormSectionPanel
        id="product-module-settings-dictionary-list"
        title="词条列表"
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        contentBaseClassName="block"
        titleClassName={primaryTextClass}
      >
        <div className="grid gap-2">
          {moduleSettings.compositionTerms.map(term => (
            <div key={term.id} className={`grid grid-cols-[120px_1fr_1fr_auto] items-center gap-3 ${tertiaryRowClass}`}>
              <div className={`text-xs font-light ${primaryTextClass}`}>{term.abbreviation}</div>
              <div className={`truncate text-xs font-light ${primaryTextClass}`}>{term.chineseName}</div>
              <div className={`truncate text-xs font-light ${secondaryTextClass}`}>{term.englishName || '未填'}</div>
              <div className="flex items-center gap-2">
                <button type="button" className={tinyActionClass} onClick={() => editTerm(term)}>编辑</button>
                <button
                  type="button"
                  className={tinyActionClass}
                  onClick={() => patchModuleSettings({ compositionTerms: moduleSettings.compositionTerms.filter(item => item.id !== term.id) })}
                  aria-label={`删除 ${term.abbreviation}`}
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </CompiledFormSectionPanel>
    </div>
  );

  const renderListDisplay = () => (
    <div className="space-y-4">
      <CompiledFormSectionPanel
        id="product-module-settings-list-default-view"
        title="默认视图"
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        contentBaseClassName="block"
        titleClassName={primaryTextClass}
      >
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(['grid', 'table'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              className={`h-10 rounded-full border text-xs font-light transition ${moduleSettings.defaultListDisplayMode === mode ? selectedButtonClass : (isDarkMode ? `${BAMBOOK_OS.controls.actionControl.dark} text-white/58` : `${BAMBOOK_OS.controls.actionControl.light} text-slate-500`)}`}
              onClick={() => patchModuleSettings({ defaultListDisplayMode: mode })}
            >
              {mode === 'grid' ? '卡片' : '表格'}
            </button>
          ))}
        </div>
        <label className="mt-4 block space-y-2">
          <span className={labelClass}>默认排序</span>
          <select value={moduleSettings.defaultSortValue} onChange={event => patchModuleSettings({ defaultSortValue: event.target.value })} className={inputClass}>
            {PRODUCT_MODULE_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </CompiledFormSectionPanel>
      <CompiledFormSectionPanel
        id="product-module-settings-list-columns"
        title="表格列"
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        contentBaseClassName="block"
        titleClassName={primaryTextClass}
      >
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
          {PRODUCT_MODULE_TABLE_COLUMN_DEFINITIONS.map(column => renderSwitch(column.label, moduleSettings.visibleTableColumnIds.includes(column.id), () => {
            const next = toggleArrayValue(moduleSettings.visibleTableColumnIds, column.id);
            patchModuleSettings({ visibleTableColumnIds: next.length > 0 ? next : DEFAULT_PRODUCT_MODULE_SETTINGS.visibleTableColumnIds });
          }))}
        </div>
      </CompiledFormSectionPanel>
    </div>
  );

  const renderActiveSection = () => {
    if (activeSectionId === 'field-management') return renderFields();
    if (activeSectionId === 'classification-system') return renderClassification();
    if (activeSectionId === 'dictionary-terms') return renderDictionary();
    if (activeSectionId === 'list-display') return renderListDisplay();
    return renderOverview();
  };

  return (
    <div
      data-os-compiler-template={blueprint.template}
      data-os-compiler-source={blueprint.source}
      data-os-compiler-provenance={blueprint.provenance}
      data-os-compiler-role="product-module-settings-workspace"
      data-ui-lab-module-settings-workspace
      className={BAMBOOK_OS.layout.desktopWorkspaceFrameClass}
      aria-label="数字档案后台配置工作区"
    >
      <CompiledModuleTitleBar
        template={blueprint.template}
        source="PRODUCT_MODULE_SETTINGS_TITLE_*"
        leading={(
        <div className="flex h-full min-w-0 items-center gap-1.5">
          <CompiledInteractiveCard
            spotlightColor={isDarkMode ? BAMBOOK_OS.spotlight.cardDarkColor : BAMBOOK_OS.spotlight.cardLightColor}
            spotlightSize={isDarkMode ? BAMBOOK_OS.controls.title.spotlightDarkSize : BAMBOOK_OS.controls.title.spotlightLightSize}
            idleSpotlightOpacity={0}
            activeSpotlightOpacity={1}
            className={`${BAMBOOK_OS.controls.title.backButton} ${isDarkMode ? BAMBOOK_OS.controls.title.buttonDark : BAMBOOK_OS.controls.title.buttonLight}`}
          >
            <button
              type="button"
              data-ui-lab-module-settings-back
              aria-label="返回数字档案"
              data-ui-lab-wallpaper-contrast="primary"
              className="relative z-10 flex h-full w-full items-center justify-center rounded-[inherit] text-inherit"
              onClick={onBack}
            >
              <ChevronLeft size={18} strokeWidth={1.4} />
            </button>
          </CompiledInteractiveCard>
          <div className={`${BAMBOOK_OS.controls.title.breadcrumb} ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
            <button
              type="button"
              onClick={onBack}
              className={`${BAMBOOK_OS.controls.title.textButton} ${isDarkMode ? 'text-white hover:text-white' : 'text-slate-900 hover:text-[var(--os-vnext-brand-blue)]'}`}
            >
              <span className={`text-xl font-light tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                数字档案
              </span>
            </button>
            <span data-ui-lab-wallpaper-contrast="secondary" className={BAMBOOK_OS.controls.title.separator}>
              <ChevronRight size={18} strokeWidth={1.4} />
            </span>
            <h2 data-ui-lab-wallpaper-contrast="primary" className={`${BAMBOOK_OS.controls.title.pageLabel} ${isDarkMode ? 'text-white/70' : 'text-slate-700'}`}>
              配置
            </h2>
          </div>
        </div>
        )}
      />

      <CompiledSplitWorkspace
        blueprint={blueprint as any}
        source="PRODUCT_MODULE_SETTINGS_SPLIT_WORKSPACE"
      >
        <CompiledSplitNavPanel
          isDarkMode={isDarkMode}
          className="bambook-module-settings-nav-panel"
          source="PRODUCT_MODULE_SETTINGS_SPLIT_NAV_PANEL"
          ariaLabel="数字档案配置分类"
        >
          {UI_LAB_PRODUCT_MODULE_SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const selected = section.id === activeSectionId;
            const selectedSurfaceClass = isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light;
            return (
              <button
                key={section.id}
                type="button"
                data-ui-lab-module-settings-section={section.id}
                aria-pressed={selected}
                className={`group ${BAMBOOK_OS.controls.navigationRow.base} ${
                  selected
                    ? (isDarkMode
                      ? `${selectedSurfaceClass} text-slate-50`
                      : `${selectedSurfaceClass} text-slate-800`)
                    : (isDarkMode
                      ? `${BAMBOOK_OS.controls.actionControl.dark} text-white/58`
                      : `${BAMBOOK_OS.controls.actionControl.light} text-slate-500`)
                }`}
                onClick={() => setActiveSectionId(section.id)}
              >
                <span className="flex items-start gap-3">
                  <span className={`${BAMBOOK_OS.controls.navigationRow.icon} ${selected ? 'text-current' : (isDarkMode ? 'text-white/42' : 'text-slate-500')}`}>
                    <Icon size={19} strokeWidth={1.35} />
                  </span>
                  <span className="min-w-0">
                    <span className={BAMBOOK_OS.controls.navigationRow.title}>{section.title}</span>
                    <span className={`${BAMBOOK_OS.controls.navigationRow.desc} ${selected ? (isDarkMode ? 'text-white/48' : 'text-slate-600') : (isDarkMode ? 'text-white/36' : 'text-slate-500')}`}>
                      {section.desc}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </CompiledSplitNavPanel>

        <CompiledSplitMainPanel
          isDarkMode={isDarkMode}
          source="PRODUCT_MODULE_SETTINGS_SPLIT_MAIN_PANEL"
          scrollRef={scrollRef}
        >
            <div className="w-full max-w-none space-y-6">
              <section className={BAMBOOK_OS.layout.desktopDetailStackClass}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className={`text-sm font-light tracking-tight ${isDarkMode ? 'text-white/78' : 'text-slate-900'}`}>{activeSection.title}</h3>
                    <p className={`mt-1 max-w-2xl text-xs font-light leading-relaxed ${isDarkMode ? 'text-white/46' : 'text-slate-600'}`}>
                    {activeSection.desc}
                    </p>
                  </div>
                  {statusText && (
                    <span className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-light ${isDarkMode ? 'border-white/8 text-white/44' : 'border-white/40 text-slate-500'}`}>
                      <CheckCircle2 size={13} strokeWidth={1.5} />
                      {statusText}
                    </span>
                  )}
                </div>

                {renderActiveSection()}
              </section>
            </div>
        </CompiledSplitMainPanel>
      </CompiledSplitWorkspace>
    </div>
  );
};
