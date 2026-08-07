
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as QRCode from 'qrcode';
import { ProductAsset, ProductSubCategory, MainCategory, ProductImage, PdmlRawFabric, Relation, RelationCategory } from '../../../types';
import { apiService } from '../../../services/apiService';
import { storageService } from '../../../services/storageService';
import RelationCombobox from '../RelationCombobox';
import {
  COMPOSITION_TERMS,
  findCompositionTermByValue,
  normalizeCompositionTermValue,
  type CompositionTermSuggestion,
} from '../../../data/compositionTerms';
import {
  Shirt, Search, Plus, LayoutGrid, List,
  ChevronRight, X, Save, ShieldCheck, ChevronLeft,
  Layers, Watch, Scissors, Gift, Box, Edit2, Trash2,
  DollarSign, FileText, Tag, Sparkles, Library,
  CheckCircle2, AlertTriangle, Archive, RefreshCw, Image as ImageIcon, Clock, ArrowDownAZ,
  type LucideIcon,
} from 'lucide-react';
import { BAMBOOK_OS } from '../bambookOsTokens';
import { OS_MATERIAL } from '../osMaterial';
import { PageHeader } from '../PageHeader';
import { RelatedEntitiesPanel } from '../../RelatedEntitiesPanel';
import {
  RELATIONS_FORM_NESTED_ROW_DARK_CLASS,
  RELATIONS_FORM_NESTED_ROW_LIGHT_CLASS,
  RELATIONS_FORM_QUIET_ACTION_DARK_CLASS,
  RELATIONS_FORM_QUIET_ACTION_LIGHT_CLASS,
} from '../relationsFormStyles';
import {
  SIDEBAR_ACTIVE_DARK_CLASS,
  SIDEBAR_ACTIVE_LIGHT_CLASS,
  SIDEBAR_HOVER_DARK_CLASS,
  SIDEBAR_HOVER_LIGHT_CLASS,
  SIDEBAR_PRESS_DARK_CLASS,
  SIDEBAR_PRESS_LIGHT_CLASS,
} from './compiledSidebarTemplates';
import {
  COMPILED_COLLECTION_CATEGORY_CARD_GRID_CLASS,
  COMPILED_COLLECTION_RECORD_CARD_GRID_CLASS,
  COMPILED_FORM_SECTION_TITLE_DARK_CLASS,
  COMPILED_FORM_SECTION_TITLE_LIGHT_CLASS,
  CompiledDetailShell,
  COMPILED_MODULE_TITLE_ACTION_BUTTON_CLASS,
  COMPILED_MODULE_TITLE_BAR_CLASS,
  COMPILED_MODULE_TITLE_BUTTON_DARK_CLASS,
  COMPILED_MODULE_TITLE_BUTTON_LIGHT_CLASS,
  COMPILED_MODULE_TITLE_ICON_BUTTON_CLASS,
  COMPILED_MODULE_TITLE_NAV_GROUP_CLASS,
  COMPILED_MODULE_TITLE_PAGE_LABEL_CLASS,
  COMPILED_MODULE_TITLE_SAFE_LEFT_STYLE,
  COMPILED_MODULE_TITLE_SEPARATOR_CLASS,
  COMPILED_MODULE_TITLE_TEXT_BUTTON_CLASS,
  CompiledBottomSheet,
  CompiledCollectionCardGrid,
  CompiledEdgeFade,
  CompiledImageUploader,
  CompiledInteractiveCard,
  CompiledFormMapPanel,
  CompiledFormSectionPanel,
  CompiledMotionInteractiveCard,
  CompiledSelectControl,
  CompiledSurfacePanel,
  CompiledTableShell,
  useCompiledGlassSurfaceEdgeMasks,
} from './compiledPrimitives';

export interface CompiledProductsPageProps {
  products: ProductAsset[];
  productCategories: ProductSubCategory[];
  /** 阶段 D / D2：关系档案列表（供应商/客户字段 RelationCombobox FK 化） */
  relations?: Relation[];
  onUpdateProducts?: (items: ProductAsset[], modified?: ProductAsset) => void;
  onUpdateCategories?: (items: ProductSubCategory[], modified?: ProductSubCategory) => void;
  cloudEndpoint?: string;
  isDarkMode?: boolean;
  isMobile?: boolean;
  moduleSettings?: {
    defaultListDisplayMode?: ProductListDisplayMode;
    defaultTableSort?: { column: string; desc: boolean };
    statusOptions?: Array<ProductAsset['status']>;
    requiredFieldIds?: string[];
    visibleTableColumnIds?: string[];
  };
}

type NavLevel = 'main' | 'sub' | 'list' | 'detail';
type ClassificationView = 'category' | 'supplier' | 'customer' | 'certification' | 'price' | 'status';
type ProductListDisplayMode = 'grid' | 'table';

/**
 * 阶段 D / D2：RelationCombobox 的 FormData 兼容包装器。
 *
 * 本页面的产品表单走原生 FormData 收集（非受控），RelationCombobox 是受控组件，
 * 因此用两个 hidden input 桥接：`name` 输出名称快照、`fkName` 输出 Relation FK。
 * 与 Order 的 snapshot + FK 双写模式一致：文本快照用于显示，FK 用于图谱与统计。
 *
 * 模块级定义（非闭包组件）：保证 combobox 内部 open/query 状态在父级重渲染后不丢失。
 */
const ProductRelationField: React.FC<{
  label: string;
  /** 名称快照字段（FormData key），如 'millName' / 'customer' / 'supplier' */
  name: string;
  /** Relation FK 字段（FormData key），如 'millOrganizationId' / 'customerRelationId' */
  fkName: string;
  defaultValue?: string | null;
  defaultRelationId?: string | null;
  relations: Relation[];
  filterCategories?: RelationCategory[];
  placeholder?: string;
  isDarkMode: boolean;
  labelClass: string;
}> = ({ label, name, fkName, defaultValue, defaultRelationId, relations, filterCategories, placeholder, isDarkMode, labelClass }) => {
  // 初值解析：FK 命中 Relation → 显示快照名（缺快照回退 Relation.name）+ 保留 FK；
  // FK 未命中（含历史裸文本残留在 FK 位的情况）→ 退化为纯文本快照，不携带 FK。
  const resolveInitial = () => {
    const fkHit = defaultRelationId ? relations.find((r) => r.id === defaultRelationId) : undefined;
    if (fkHit) return { name: defaultValue || fkHit.name, relationId: fkHit.id as string | undefined };
    return { name: defaultValue || defaultRelationId || '', relationId: undefined as string | undefined };
  };
  const [selection, setSelection] = useState<{ name: string; relationId?: string }>(resolveInitial);
  // 切换编辑对象时同步外部初值（表单无 key 重置，靠 prop 变化驱动）
  useEffect(() => {
    setSelection(resolveInitial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue, defaultRelationId]);

  return (
    <div className="space-y-2">
      <label className={labelClass}>{label}</label>
      <RelationCombobox
        value={selection.name}
        relationId={selection.relationId}
        relations={relations}
        filterCategories={filterCategories}
        isDarkMode={isDarkMode}
        placeholder={placeholder}
        onChange={(next) => setSelection({ name: next.name, relationId: next.relationId })}
      />
      <input type="hidden" name={name} value={selection.name} />
      <input type="hidden" name={fkName} value={selection.relationId || ''} />
    </div>
  );
};
type ProductFormSectionId =
  | 'images'
  | 'basic'
  | 'specs'
  | 'pricing'
  | 'risk'
  | 'notes'
  | 'garmentConstruction'
  | 'garmentMaterials'
  | 'garmentSizing'
  | 'garmentColors'
  | 'garmentDevelopment'
  | 'garmentProduction'
  | 'trimmingSpecs'
  | 'trimmingSupply'
  | 'trimmingQuality';
type ProductTableSortColumn =
  | 'sku'
  | 'name'
  | 'articleNo'
  | 'millQuality'
  | 'millOrg'
  | 'clientCode'
  | 'factoryPrice'
  | 'salesPrice'
  | 'stock'
  | 'completeness'
  | 'updatedAt';
type CompositionDraftLine = { id: string; percentage: string; abbreviation: string; chineseName: string; englishName: string };

export const ALL_PRODUCTS_CATEGORY_ID = '__all_products__';
export const UNCATEGORIZED_CATEGORY_ID = '__uncategorized_products__';
export const PDML_RAW_LIBRARY_ID = '__pdml_raw_library__';
const PDML_RAW_PAGE_SIZE = 500;

export type ProductMainCategoryDefinition = { id: MainCategory; label: string; icon: LucideIcon; color: string; desc: string };
export const PRODUCT_MAIN_CATEGORY_DEFINITIONS: ProductMainCategoryDefinition[] = [
  { id: 'Garment', label: '成衣', icon: Shirt, color: '', desc: '西服、外套、裤装等成品款式档案。' },
  { id: 'Fabric', label: '面料', icon: Layers, color: '', desc: '纺织底料、复合面料及其技术参数。' },
  { id: 'Accessories', label: '配饰', icon: Watch, color: '', desc: '领带、皮带、饰品等搭配资产。' },
  { id: 'Trimmings', label: '辅料', icon: Scissors, color: '', desc: '纽扣、拉链、衬布及商标标准。' },
  { id: 'Merchandise', label: '周边', icon: Gift, color: '', desc: '品牌延伸产品及授权数字资产。' },
  { id: 'Other', label: '其他', icon: Box, color: '', desc: '特殊资产或创新研发类目。' },
];

const DEFAULT_GARMENT_SUB_CATEGORIES: ProductSubCategory[] = [
  { id: 'garment-default-suit', mainCategory: 'Garment', name: '西装 / Suit', description: '成套西服、正装套装与配套款式。', updatedAt: 0 },
  { id: 'garment-default-blazer', mainCategory: 'Garment', name: '单西 / Blazer', description: '单件西装上衣、休闲西装与夹克式西装。', updatedAt: 0 },
  { id: 'garment-default-outerwear', mainCategory: 'Garment', name: '外套 / Outerwear', description: '大衣、夹克、风衣、棉服等外穿款式。', updatedAt: 0 },
  { id: 'garment-default-shirt', mainCategory: 'Garment', name: '衬衫 / Shirt', description: '正装衬衫、休闲衬衫与相关上装。', updatedAt: 0 },
  { id: 'garment-default-pants', mainCategory: 'Garment', name: '裤装 / Pants', description: '西裤、休闲裤、短裤与各类下装裤。', updatedAt: 0 },
  { id: 'garment-default-vest', mainCategory: 'Garment', name: '马甲 / Vest', description: '西装马甲、针织马甲与功能马甲。', updatedAt: 0 },
  { id: 'garment-default-skirt', mainCategory: 'Garment', name: '半裙 / Skirt', description: '半裙、套装裙与女装下装。', updatedAt: 0 },
  { id: 'garment-default-dress', mainCategory: 'Garment', name: '连衣裙 / Dress', description: '连衣裙、礼服裙与一体式女装。', updatedAt: 0 },
  { id: 'garment-default-knitwear', mainCategory: 'Garment', name: '针织 / Knitwear', description: '针织衫、毛衫、针织外套与针织套装。', updatedAt: 0 },
  { id: 'garment-default-uniform', mainCategory: 'Garment', name: '制服 / Uniform', description: '工装、职业装、团队制服与定制制服。', updatedAt: 0 },
  { id: 'garment-default-set', mainCategory: 'Garment', name: '套装 / Set', description: '上下装组合、系列组合与搭配套装。', updatedAt: 0 },
  { id: 'garment-default-other', mainCategory: 'Garment', name: '其他成衣 / Other Garment', description: '暂未归入固定品类的特殊成衣档案。', updatedAt: 0 },
];

const DEFAULT_TRIMMING_SUB_CATEGORIES: ProductSubCategory[] = [
  { id: 'trimming-default-button', mainCategory: 'Trimmings', name: '纽扣 / Button', description: '树脂扣、贝壳扣、金属扣、包布扣等扣类辅料。', updatedAt: 0 },
  { id: 'trimming-default-zipper', mainCategory: 'Trimmings', name: '拉链 / Zipper', description: '尼龙拉链、金属拉链、隐形拉链、拉头与拉片。', updatedAt: 0 },
  { id: 'trimming-default-label', mainCategory: 'Trimmings', name: '商标洗标 / Label', description: '主唛、尺码标、洗水标、织标、印标等标识辅料。', updatedAt: 0 },
  { id: 'trimming-default-hangtag', mainCategory: 'Trimmings', name: '吊牌 / Hangtag', description: '吊牌、贴纸、价格牌、合格证等纸品标识。', updatedAt: 0 },
  { id: 'trimming-default-interlining', mainCategory: 'Trimmings', name: '衬布 / Interlining', description: '有纺衬、无纺衬、马尾衬、胸衬和腰衬。', updatedAt: 0 },
  { id: 'trimming-default-lining', mainCategory: 'Trimmings', name: '里布 / Lining', description: '成衣里布、袖里、袋布及局部内衬材料。', updatedAt: 0 },
  { id: 'trimming-default-thread', mainCategory: 'Trimmings', name: '缝线 / Thread', description: '缝纫线、绣花线、锁边线及特殊功能线。', updatedAt: 0 },
  { id: 'trimming-default-tape', mainCategory: 'Trimmings', name: '织带绳带 / Tape & Cord', description: '织带、松紧带、包边带、绳带、魔术贴等带类辅料。', updatedAt: 0 },
  { id: 'trimming-default-hardware', mainCategory: 'Trimmings', name: '五金 / Hardware', description: '按扣、鸡眼、钩扣、调节扣、D 环及金属配件。', updatedAt: 0 },
  { id: 'trimming-default-padding', mainCategory: 'Trimmings', name: '垫肩胸垫 / Padding', description: '垫肩、胸垫、杯垫、填充棉及定型材料。', updatedAt: 0 },
  { id: 'trimming-default-packaging', mainCategory: 'Trimmings', name: '包装 / Packaging', description: '胶袋、纸箱、拷贝纸、衣架、防潮包等包装物料。', updatedAt: 0 },
  { id: 'trimming-default-other', mainCategory: 'Trimmings', name: '其他辅料 / Other Trimming', description: '暂未归入固定品类的特殊辅料档案。', updatedAt: 0 },
];

export type ProductClassificationViewDefinition = { id: ClassificationView; label: string };
export const PRODUCT_CLASSIFICATION_VIEW_DEFINITIONS: ProductClassificationViewDefinition[] = [
  { id: 'category', label: '产品类别' },
  { id: 'supplier', label: '供应商' },
  { id: 'customer', label: '客户' },
  { id: 'certification', label: '认证' },
  { id: 'price', label: '价格等级' },
  { id: 'status', label: '状态' },
];

const fabricProductFormSections: { id: ProductFormSectionId; label: string; desc: string }[] = [
  { id: 'basic', label: '基础信息', desc: 'SKU、二维码、品号、克重门幅、成分' },
  { id: 'specs', label: '规格参数', desc: '品质、颜色、组织、生产周期' },
  { id: 'pricing', label: '价格库存', desc: 'Client Code、价格、现货' },
  { id: 'risk', label: '认证风险', desc: '认证许可、质量风险' },
  { id: 'notes', label: '备注', desc: '特殊备注与补充说明' },
];

const garmentProductFormSections: { id: ProductFormSectionId; label: string; desc: string }[] = [
  { id: 'basic', label: '基础身份', desc: '款号、品类、客户、系列和状态' },
  { id: 'garmentConstruction', label: '成衣结构', desc: '版型、领袖、口袋、里布和工艺' },
  { id: 'garmentMaterials', label: '材料 BOM', desc: '主面料、配布、辅料、包装和替代料' },
  { id: 'garmentSizing', label: '尺码量体', desc: '尺码范围、POM、公差和放码' },
  { id: 'garmentColors', label: '颜色 SKU', desc: '颜色组、条码、可用尺码和起订量' },
  { id: 'garmentDevelopment', label: '开发版本', desc: '样衣版本、批注、负责人和技术包' },
  { id: 'garmentProduction', label: '生产质量', desc: '工厂、交期、价格、检验和包装' },
];

const trimmingProductFormSections: { id: ProductFormSectionId; label: string; desc: string }[] = [
  { id: 'basic', label: '基础识别', desc: '辅料编号、名称、类别、客户和状态' },
  { id: 'trimmingSpecs', label: '规格材质', desc: '材质、尺寸、颜色、表面处理和使用部位' },
  { id: 'trimmingSupply', label: '供应采购', desc: '供应商、工厂、单位、用量、起订量和交期' },
  { id: 'trimmingQuality', label: '质量合规', desc: '测试、标准、风险、包装和洗护要求' },
  { id: 'notes', label: '备注', desc: '特殊备注与补充说明' },
];

const PRODUCT_STATUS_OPTIONS: Array<{ value: ProductAsset['status']; label: string }> = [
  { value: 'Development', label: 'Development' },
  { value: 'Active', label: 'Active' },
  { value: 'Archived', label: 'Archived' },
];

const GARMENT_STATUS_OPTIONS: Array<{ value: ProductAsset['status']; label: string }> = [
  { value: '开发样', label: '开发样' },
  { value: '产前样', label: '产前样' },
  { value: '大货样', label: '大货样' },
];

export const PRODUCT_TITLE_BAR_CLASS = COMPILED_MODULE_TITLE_BAR_CLASS;
export const PRODUCT_TITLE_SAFE_LEFT_STYLE: React.CSSProperties = COMPILED_MODULE_TITLE_SAFE_LEFT_STYLE;
export const PRODUCT_TITLE_NAV_GROUP_CLASS = COMPILED_MODULE_TITLE_NAV_GROUP_CLASS;
export const PRODUCT_TITLE_TEXT_BUTTON_CLASS = COMPILED_MODULE_TITLE_TEXT_BUTTON_CLASS;
export const PRODUCT_TITLE_PAGE_LABEL_CLASS = COMPILED_MODULE_TITLE_PAGE_LABEL_CLASS;
export const PRODUCT_TITLE_SEPARATOR_CLASS = COMPILED_MODULE_TITLE_SEPARATOR_CLASS;
export const PRODUCT_TITLE_ICON_BUTTON_CLASS = COMPILED_MODULE_TITLE_ICON_BUTTON_CLASS;
export const PRODUCT_TITLE_ACTION_BUTTON_CLASS = COMPILED_MODULE_TITLE_ACTION_BUTTON_CLASS;
export const PRODUCT_TITLE_BUTTON_DARK_CLASS = COMPILED_MODULE_TITLE_BUTTON_DARK_CLASS;
export const PRODUCT_TITLE_BUTTON_LIGHT_CLASS = COMPILED_MODULE_TITLE_BUTTON_LIGHT_CLASS;
export const PRODUCT_CATEGORY_CARD_GRID_CLASS = COMPILED_COLLECTION_CATEGORY_CARD_GRID_CLASS;
export const PRODUCT_CARD_GRID_CLASS = COMPILED_COLLECTION_RECORD_CARD_GRID_CLASS;
export const PRODUCT_CARD_CLASS = 'p-6 h-[220px] rounded-card-lg';
export const PRODUCT_CARD_DARK_CLASS = `${OS_MATERIAL.raisedCard} bambook-panel-glass`;
export const PRODUCT_CARD_LIGHT_CLASS = `${OS_MATERIAL.raisedCard} bambook-panel-glass`;
export const PRODUCT_CARD_SPOTLIGHT_DARK_COLOR = BAMBOOK_OS.spotlight.cardDarkColor;
export const PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR = BAMBOOK_OS.spotlight.cardLightColor;
export const PRODUCT_CARD_SPOTLIGHT_DARK_SIZE = BAMBOOK_OS.spotlight.panelDarkSize;
export const PRODUCT_CARD_SPOTLIGHT_LIGHT_SIZE = BAMBOOK_OS.spotlight.panelLightSize;
export const PRODUCT_CARD_LAYOUT_TRANSITION = BAMBOOK_OS.motion.layoutTransition;
export const PRODUCT_SUB_INDEX_PANEL_CLASS = `${OS_MATERIAL.framePanel} rounded-card border overflow-hidden`;
export const PRODUCT_SUB_INDEX_ROW_CLASS = 'h-[72px] border-b last:border-b-0';
export const PRODUCT_EDGE_FADE_TOP_HEIGHT = 56;
export const PRODUCT_EDGE_FADE_TOP_START = 0;
export const PRODUCT_EDGE_FADE_BOTTOM_HEIGHT = 72;

type CompiledProductsPageBlueprint = {
  template: 'CompiledProductsPage';
  source: 'ProductsManager.ui-lab-1.0.full-contract';
  provenance: 'accepted';
  navLevels: readonly NavLevel[];
  titleBarClassName: string;
  titleSafeLeftStyle: React.CSSProperties;
  edgeFade: {
    topHeight: number;
    topFadeStartOffset: number;
    bottomHeight: number;
  };
  form: {
    mapMaterialRole: 'raisedCard';
    scrollViewportClassName: string;
    edgeFade: {
      topHeight: number;
      topFadeStartOffset: number;
      bottomHeight: number;
      shadowCasterBottomHeight: number;
      bottomFadeEndOffset: number;
      syncWheelScroll: true;
    };
  };
};

export const compileProductsPage = (): CompiledProductsPageBlueprint => ({
  template: 'CompiledProductsPage',
  source: 'ProductsManager.ui-lab-1.0.full-contract',
  provenance: 'accepted',
  navLevels: ['main', 'sub', 'list', 'detail'],
  titleBarClassName: PRODUCT_TITLE_BAR_CLASS,
  titleSafeLeftStyle: PRODUCT_TITLE_SAFE_LEFT_STYLE,
  edgeFade: {
    topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT,
    topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START,
    bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
  },
  form: {
    mapMaterialRole: 'raisedCard',
    scrollViewportClassName: `bambook-product-form-scroll-viewport min-w-0 -mt-[112px] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px] ${BAMBOOK_OS.layout.panelShadowViewportClass}`,
    edgeFade: {
      topHeight: 57,
      topFadeStartOffset: 58,
      bottomHeight: 57,
      shadowCasterBottomHeight: 57,
      bottomFadeEndOffset: BAMBOOK_OS.layout.desktopMainPanelBottomInset,
      syncWheelScroll: true,
    },
  },
});
export const PRODUCT_TOOLBAR_CLASS = BAMBOOK_OS.controls.toolbar.base;
export const PRODUCT_TOOLBAR_CONTENT_CLASS = BAMBOOK_OS.controls.toolbar.content;
export const PRODUCT_TOOLBAR_AMBIENT_CLASS = BAMBOOK_OS.controls.toolbar.ambient;
export const PRODUCT_TOOLBAR_SURFACE_DARK_CLASS = BAMBOOK_OS.controls.toolbar.surfaceDark;
export const PRODUCT_TOOLBAR_SURFACE_LIGHT_CLASS = BAMBOOK_OS.controls.toolbar.surfaceLight;
export const PRODUCT_TOOLBAR_SEARCH_DARK_CLASS = BAMBOOK_OS.controls.toolbar.searchDark;
export const PRODUCT_TOOLBAR_SEARCH_LIGHT_CLASS = BAMBOOK_OS.controls.toolbar.searchLight;
export const PRODUCT_TOOLBAR_SPOTLIGHT_DARK_SIZE = BAMBOOK_OS.controls.toolbar.spotlightDarkSize;
export const PRODUCT_TOOLBAR_SPOTLIGHT_LIGHT_SIZE = BAMBOOK_OS.controls.toolbar.spotlightLightSize;
export const PRODUCT_SEGMENT_BUTTON_CLASS = `relative z-20 h-9 w-7 rounded-none bg-transparent border-0 shadow-none text-[10px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label} flex items-center justify-center transition-[color,opacity,filter,transform] duration-200 ease-out active:translate-y-[1px]`;
export const PRODUCT_FORM_FIELD_DARK_CLASS = BAMBOOK_OS.controls.recessedField.dark;
export const PRODUCT_FORM_FIELD_LIGHT_CLASS = BAMBOOK_OS.controls.recessedField.light;
export const PRODUCT_FORM_LABEL_DARK_CLASS = BAMBOOK_OS.tone.text.formLabelDark;
export const PRODUCT_FORM_LABEL_LIGHT_CLASS = BAMBOOK_OS.tone.text.formLabelLight;
export const PRODUCT_FORM_SECTION_TITLE_DARK_CLASS = COMPILED_FORM_SECTION_TITLE_DARK_CLASS;
export const PRODUCT_FORM_SECTION_TITLE_LIGHT_CLASS = COMPILED_FORM_SECTION_TITLE_LIGHT_CLASS;
export const PRODUCT_FORM_MAP_INDEX_DARK_CLASS = `${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndexDark}`;
export const PRODUCT_FORM_MAP_INDEX_LIGHT_CLASS = `${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndexLight}`;
export const PRODUCT_TABLE_HEADER_DARK_CLASS = BAMBOOK_OS.controls.table.headerDark;
export const PRODUCT_TABLE_HEADER_LIGHT_CLASS = BAMBOOK_OS.controls.table.headerLight;
export const PRODUCT_TABLE_ROW_HOVER_DARK_CLASS = BAMBOOK_OS.controls.table.rowHoverDark;
export const PRODUCT_TABLE_ROW_HOVER_LIGHT_CLASS = BAMBOOK_OS.controls.table.rowHoverLight;
export const PRODUCT_TABLE_CELL_BORDER_DARK_CLASS = BAMBOOK_OS.controls.table.cellBorderDark;
export const PRODUCT_TABLE_CELL_BORDER_LIGHT_CLASS = BAMBOOK_OS.controls.table.cellBorderLight;
export const PRODUCT_DETAIL_PANEL_LAYOUT_CLASS = 'w-full h-full max-h-full min-h-0 overflow-hidden';
export const PRODUCT_DETAIL_PANEL_CONTENT_CLASS = 'relative z-10 grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)] overflow-hidden';
export const PRODUCT_DETAIL_MEDIA_PANEL_CLASS = 'min-h-0 p-6 flex flex-col gap-4';
export const PRODUCT_DETAIL_MEDIA_FRAME_CLASS = `${OS_MATERIAL.insetSurface} relative aspect-[4/5] rounded-inset overflow-hidden border`;
export const PRODUCT_DETAIL_MEDIA_META_CLASS = `${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3`;
export const PRODUCT_DETAIL_MAIN_PANEL_CLASS = 'min-h-0 overflow-hidden flex flex-col';
export const PRODUCT_DETAIL_HEADER_LAYOUT_CLASS = 'shrink-0 px-5 py-4 border-b flex items-start justify-between gap-4';
export const PRODUCT_DETAIL_BODY_SCROLL_CLASS = 'flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6';
export const PRODUCT_DETAIL_ITEM_CLASS = `${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3`;
export const PRODUCT_DETAIL_STATUS_PANEL_CLASS = `${OS_MATERIAL.insetSurface} rounded-inset border p-5`;
export const PRODUCT_DETAIL_HISTORY_PANEL_CLASS = `${OS_MATERIAL.insetSurface} rounded-inset border p-4`;

const ProductFormSection = ({
  id,
  title,
  description,
  isDarkMode,
  children,
}: {
  id: ProductFormSectionId;
  title: string;
  description: string;
  isDarkMode: boolean;
  children: React.ReactNode;
}) => (
  <CompiledFormSectionPanel
    id={`product-form-${id}`}
    title={title}
    isDarkMode={isDarkMode}
    materialRole="framePanel"
  >
    {children}
  </CompiledFormSectionPanel>
);

// ── 关联订单组件（通过 millQuality 反查 OrderLine）──────────────
const RelatedOrders: React.FC<{
  productId: string;
  millQuality?: string | null;
  cloudEndpoint?: string;
  isDarkMode: boolean;
}> = ({ productId, millQuality, cloudEndpoint, isDarkMode }) => {
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!millQuality) { setLines([]); return; }
    setLoading(true);
    apiService.getProductAsset(productId, cloudEndpoint)
      .then((data: any) => {
        setLines(Array.isArray(data?.relatedOrderLines) ? data.relatedOrderLines : []);
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  }, [productId, millQuality, cloudEndpoint]);

  if (!millQuality) {
    return (
      <div className={`${PRODUCT_DETAIL_HISTORY_PANEL_CLASS} text-xs leading-relaxed ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
        填写 Mill Quality 后可自动关联历史订单。
      </div>
    );
  }

  if (loading) {
    return <div className={`text-xs ${isDarkMode ? 'text-white/40' : 'text-slate-400'}`}>加载关联订单中…</div>;
  }

  if (lines.length === 0) {
    return (
      <div className={`${PRODUCT_DETAIL_HISTORY_PANEL_CLASS} text-xs leading-relaxed ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
        暂无关联订单（Mill Quality: {millQuality}）。历史调样、关联成衣将在样品/服装模块接入后补齐。
      </div>
    );
  }

  return (
    <div className={`rounded-card-lg border overflow-hidden ${isDarkMode ? 'border-white/[0.08]' : 'border-slate-100'}`}>
      <div className={`px-4 py-2.5 text-xs font-light ${isDarkMode ? 'bg-deep/60 text-white/60 border-b border-white/5' : 'bg-slate-50 text-slate-600'}`}>
        关联订单 ({lines.length})
      </div>
      <div className="divide-y divide-white/5">
        {lines.map((line: any) => (
          <div key={line.id} className={`px-4 py-2.5 flex items-center justify-between text-xs ${isDarkMode ? 'text-white/70' : 'text-slate-700'}`}>
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono font-light">{line.order?.poNumber || '-'}-{String(line.itemNo || line.lineNumber).padStart(3, '0')}</span>
              <span className="truncate">{line.description || line.cloth || '-'}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span>{line.quantity?.toLocaleString() ?? '-'} {line.unit || ''}</span>
              <span className={isDarkMode ? 'text-white/40' : 'text-slate-400'}>{line.order?.dueDate || ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 认证许可勾选组件 ─────────────────────────────────────────────
// 常见纺织认证清单，备忘录要求勾选式替代文本输入。
const CERT_OPTIONS = [
  { id: 'RWS', label: 'RWS (责任羊毛标准)' },
  { id: 'GRS', label: 'GRS (全球回收标准)' },
  { id: 'GOTS', label: 'GOTS (有机纺织标准)' },
  { id: 'Oeko-Tex', label: 'Oeko-Tex 100' },
  { id: '非新疆棉', label: '非新疆棉' },
  { id: 'BCI', label: 'BCI (良好棉花)' },
  { id: 'ZDHC', label: 'ZDHC (有害化学零排放)' },
  { id: 'Higg FEM', label: 'Higg FEM' },
  { id: 'ISO 9001', label: 'ISO 9001' },
  { id: 'ISO 14001', label: 'ISO 14001' },
];

const CertificationCheckboxes: React.FC<{
  product: Partial<ProductAsset> | null;
  isDarkMode: boolean;
  onChange: () => void;
}> = ({ product, isDarkMode, onChange }) => {
  const existing = new Set(
    (product?.fabricCertifications || []).map(c => c.certification),
  );
  const [checked, setChecked] = useState<Set<string>>(existing);
  const [customCerts, setCustomCerts] = useState<string[]>(
    [...existing].filter(c => !CERT_OPTIONS.some(o => o.id === c)),
  );
  const [customInput, setCustomInput] = useState('');

  // 写入隐藏 input，让 FormData 提交时自动拿到逗号分隔字符串
  const hiddenRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (hiddenRef.current) {
      const all = [...checked, ...customCerts];
      hiddenRef.current.value = all.join(', ');
    }
  }, [checked, customCerts]);

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    onChange();
  };

  const addCustom = () => {
    const val = customInput.trim();
    if (val && !checked.has(val) && !customCerts.includes(val)) {
      setCustomCerts(prev => [...prev, val]);
      setCustomInput('');
      onChange();
    }
  };

  const removeCustom = (cert: string) => {
    setCustomCerts(prev => prev.filter(c => c !== cert));
    onChange();
  };

  const labelCls = `text-[11px] font-light cursor-pointer select-none ${
    isDarkMode ? 'text-slate-300' : 'text-slate-700'
  }`;
  const boxCls = (on: boolean) =>
    `w-4 h-4 rounded border transition-colors ${
      on
        ? 'bg-[var(--os-vnext-brand-blue-strong)] border-[var(--os-vnext-brand-blue-strong)]'
        : isDarkMode
          ? 'bg-white/5 border-white/20'
          : 'bg-white border-slate-300'
    }`;

  return (
    <div className="space-y-3">
      {/* 隐藏 input 兼容 FormData 提交 */}
      <input ref={hiddenRef} type="hidden" name="certifications" defaultValue={(product?.fabricCertifications || []).map(c => c.certification).join(', ')} />

      {/* 标准认证勾选 */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {CERT_OPTIONS.map(opt => (
          <label key={opt.id} className="flex items-center gap-1.5 cursor-pointer">
            <div className={boxCls(checked.has(opt.id))} onClick={() => toggle(opt.id)}>
              {checked.has(opt.id) && (
                <svg className="w-3 h-3 text-white mx-auto mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className={labelCls}>{opt.label}</span>
          </label>
        ))}
      </div>

      {/* 自定义认证 */}
      {customCerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {customCerts.map(cert => (
            <span key={cert} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-light ${
              isDarkMode ? 'bg-[var(--os-vnext-brand-blue-strong)]/20 text-[var(--os-vnext-brand-blue-strong)]' : 'bg-[var(--os-vnext-brand-blue-strong)]/10 text-[var(--os-vnext-brand-blue-strong)]'
            }`}>
              {cert}
              <button type="button" onClick={() => removeCustom(cert)} className="opacity-60 hover:opacity-100">&times;</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder="其他认证（回车添加）"
          className={`flex-1 px-4 py-3 text-xs rounded-control border outline-none transition-all ${
            isDarkMode ? 'bg-deep/60 border-white/10 text-white placeholder-white/20 focus:border-[var(--os-vnext-brand-blue-strong)]/40' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-[rgb(var(--os-vnext-brand-blue-rgb)/0.1)]'
          }`}
        />
        <button
          type="button"
          onClick={addCustom}
          className={`px-4 py-3 text-xs rounded-full font-light transition-all ${
            isDarkMode ? 'bg-deep/80 text-slate-300 border border-white/10 hover:bg-deep' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          添加
        </button>
      </div>
    </div>
  );
};

export const CompiledProductsPage: React.FC<CompiledProductsPageProps> = ({ products, productCategories, relations = [], onUpdateProducts = () => undefined, onUpdateCategories = () => undefined, cloudEndpoint, isDarkMode = false, isMobile = false, moduleSettings }) => {
  const blueprint = useMemo(() => compileProductsPage(), []);
  const [navLevel, setNavLevel] = useState<NavLevel>('main');
  const [sideSearchTerm, setSideSearchTerm] = useState('');
  const [sideSortOption, setSideSortOption] = useState<'recent' | 'name'>('recent');
  const [selectedMain, setSelectedMain] = useState<MainCategory | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [classificationView, setClassificationView] = useState<ClassificationView>('category');
  const [listDisplayMode, setListDisplayMode] = useState<ProductListDisplayMode>(moduleSettings?.defaultListDisplayMode || 'grid');
  const [tableSort, setTableSort] = useState<{ column: ProductTableSortColumn; desc: boolean }>({
    column: (moduleSettings?.defaultTableSort?.column || 'updatedAt') as ProductTableSortColumn,
    desc: moduleSettings?.defaultTableSort?.desc ?? true,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [skuForQr, setSkuForQr] = useState('');
  const [skuQrDataUrl, setSkuQrDataUrl] = useState('');
  const [compositionDraftRows, setCompositionDraftRows] = useState<CompositionDraftLine[]>([]);
  const isPdmlRawView = selectedMain === 'Fabric' && selectedSubId === PDML_RAW_LIBRARY_ID;
  const skuInputRef = useRef<HTMLInputElement | null>(null);
  const mainCategoryScrollRef = useRef<HTMLDivElement | null>(null);
  const subIndexScrollRef = useRef<HTMLDivElement>(null);
  const pdmlRawScrollRef = useRef<HTMLDivElement | null>(null);
  const productGridScrollRef = useRef<HTMLDivElement>(null);
  const productFormScrollRef = useRef<HTMLDivElement | null>(null);
  const productDetailSidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const productDetailBodyScrollRef = useRef<HTMLDivElement | null>(null);

  useCompiledGlassSurfaceEdgeMasks({
    scrollRef: productGridScrollRef,
    enabled: navLevel === 'list' && listDisplayMode === 'grid' && !isPdmlRawView,
    source: 'CompiledProductsPage.productGrid.surfaceMasks',
    scopeSelector: null,
    topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT,
    bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
    topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START,
  });

  useCompiledGlassSurfaceEdgeMasks({
    scrollRef: mainCategoryScrollRef,
    enabled: navLevel === 'main',
    source: 'CompiledProductsPage.mainCategory.surfaceMasks',
    scopeSelector: null,
    topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT,
    bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
    topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START,
  });

  useCompiledGlassSurfaceEdgeMasks({
    scrollRef: subIndexScrollRef,
    enabled: navLevel === 'sub',
    source: 'CompiledProductsPage.subIndex.surfaceMasks',
    scopeSelector: null,
    topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT,
    bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
    topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START,
  });

  const productTableScrollRef = useRef<HTMLDivElement | null>(null);
  const pdmlRawHydratedRef = useRef(false);

  const [showAddSubModal, setshowAddSubModal] = useState(false);
  const [editingSub, setEditingSub] = useState<ProductSubCategory | null>(null);

  const [showAddProdModal, setShowAddProdModal] = useState(false);
  const [editingProd, setEditingProd] = useState<ProductAsset | null>(null);
  const fullscreenProductFormOpen = !isMobile && (showAddProdModal || !!editingProd);

  useCompiledGlassSurfaceEdgeMasks({
    scrollRef: productFormScrollRef,
    enabled: fullscreenProductFormOpen,
    source: 'CompiledProductsPage.productForm.surfaceMasks',
    scopeSelector: null,
    topHeight: blueprint.form.edgeFade.topHeight,
    topFadeStartOffset: blueprint.form.edgeFade.topFadeStartOffset,
    bottomHeight: blueprint.form.edgeFade.bottomHeight,
    shadowCasterBottomHeight: blueprint.form.edgeFade.shadowCasterBottomHeight,
    topFadeActivation: 'clip',
    bottomFadeActivation: 'zone',
    bottomFadeEndOffset: blueprint.form.edgeFade.bottomFadeEndOffset,
    bottomContentInset: 0,
    syncWheelScroll: blueprint.form.edgeFade.syncWheelScroll,
  });

  const [productStatusValue, setProductStatusValue] = useState('Development');
  const [editingImages, setEditingImages] = useState<ProductImage[]>([]);
  const [deleteSubId, setDeleteSubId] = useState<string | null>(null);
  const [deleteProdId, setDeleteProdId] = useState<string | null>(null);
  const [showOptionsSheet, setShowOptionsSheet] = useState<ProductAsset | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductAsset | null>(null);
  const [pdmlRawFabrics, setPdmlRawFabrics] = useState<PdmlRawFabric[]>([]);
  const [pdmlRawLoading, setPdmlRawLoading] = useState(false);
  const [pdmlRawSyncing, setPdmlRawSyncing] = useState(false);
  const [pdmlRawMapping, setPdmlRawMapping] = useState(false);
  const [pdmlRawError, setPdmlRawError] = useState('');
  const [productWriteError, setProductWriteError] = useState('');
  const [pdmlRawSyncedAt, setPdmlRawSyncedAt] = useState<number | null>(null);
  const [pdmlRawTotal, setPdmlRawTotal] = useState(0);
  const [pdmlRawHasMore, setPdmlRawHasMore] = useState(false);
  const formMainCategory = editingProd?.mainCategory || selectedMain;
  const isFabricFormContext = formMainCategory === 'Fabric';
  const isGarmentFormContext = formMainCategory === 'Garment';
  const isTrimmingFormContext = formMainCategory === 'Trimmings';
  const productStatusOptions = useMemo(() => {
    const baseOptions = isGarmentFormContext ? GARMENT_STATUS_OPTIONS : PRODUCT_STATUS_OPTIONS;
    const enabled = moduleSettings?.statusOptions?.length ? moduleSettings.statusOptions : baseOptions.map(option => option.value);
    const filtered = baseOptions.filter(option => enabled.includes(option.value));
    return filtered.length > 0 ? filtered : baseOptions;
  }, [isGarmentFormContext, moduleSettings?.statusOptions]);

  useEffect(() => {
    if (moduleSettings?.defaultListDisplayMode) {
      setListDisplayMode(moduleSettings.defaultListDisplayMode);
    }
  }, [moduleSettings?.defaultListDisplayMode]);

  useEffect(() => {
    const column = moduleSettings?.defaultTableSort?.column as ProductTableSortColumn | undefined;
    if (!column) return;
    setTableSort({ column, desc: moduleSettings?.defaultTableSort?.desc ?? true });
  }, [moduleSettings?.defaultTableSort?.column, moduleSettings?.defaultTableSort?.desc]);

  const ensureOnlineWrite = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('当前离线：只能浏览本机缓存，不能新增、编辑或删除。');
    }
  };

  const pollPdmlSyncJob = async (jobId: string) => {
    const deadline = Date.now() + 120_000;
    let job = await apiService.getPdmlRawSyncJob(cloudEndpoint, jobId);
    while ((job.status === 'queued' || job.status === 'running') && Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 1200));
      job = await apiService.getPdmlRawSyncJob(cloudEndpoint, jobId);
    }
    return job;
  };

  // Sync editingImages when editingProd changes
  useEffect(() => {
    setEditingImages(editingProd?.images?.filter((img: ProductImage) => !img.deletedAt) || []);
  }, [editingProd]);

  useEffect(() => {
    if (!showAddProdModal && !editingProd) return;
    setProductStatusValue(editingProd?.status || (selectedMain === 'Garment' ? '开发样' : 'Development'));
  }, [editingProd, selectedMain, showAddProdModal]);

  useEffect(() => {
    if (!fullscreenProductFormOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenProductFormOpen]);

  async function loadPdmlRawFabrics(search = '', mode: 'reset' | 'append' = 'reset') {
    setPdmlRawLoading(true);
    setPdmlRawError('');
    try {
      if (mode === 'reset' && !search.trim()) {
        const cached = await storageService.getCachedPdmlRawFabrics();
        if (cached.length > 0) {
          setPdmlRawFabrics(cached);
          setPdmlRawTotal(cached.length);
          setPdmlRawHasMore(false);
          setPdmlRawSyncedAt(cached[0]?.syncedAt || null);
          return;
        }
      }
      const offset = mode === 'append' ? pdmlRawFabrics.length : 0;
      const result = await apiService.listPdmlRawFabrics(cloudEndpoint, {
        limit: PDML_RAW_PAGE_SIZE,
        offset,
        search: search.trim() || undefined,
      });
      setPdmlRawFabrics(prev => {
        if (mode === 'reset') return result.fabrics;
        const seen = new Set(prev.map(row => row.id));
        return [...prev, ...result.fabrics.filter(row => !seen.has(row.id))];
      });
      setPdmlRawTotal(result.total);
      setPdmlRawHasMore(result.hasMore);
      const syncedAt = result.fabrics[0]?.syncedAt || pdmlRawSyncedAt;
      if (syncedAt) setPdmlRawSyncedAt(syncedAt);
    } catch (error: any) {
      setPdmlRawError(error?.message || String(error));
    } finally {
      setPdmlRawLoading(false);
    }
  }

  async function refreshPdmlRawCacheFromCloud() {
    setPdmlRawLoading(true);
    setPdmlRawError('');
    try {
      const result = await apiService.listAllPdmlRawFabrics(cloudEndpoint, { pageSize: PDML_RAW_PAGE_SIZE });
      const cached = await storageService.getCachedPdmlRawFabrics();
      if (result.fabrics.length === 0 && cached.length > 0) {
        setPdmlRawFabrics(cached);
        setPdmlRawTotal(cached.length);
        setPdmlRawHasMore(false);
        setPdmlRawSyncedAt(cached[0]?.syncedAt || null);
        setPdmlRawError('数据中心本次返回 0 条，已保留本机缓存。');
        return;
      }
      await storageService.saveCachedPdmlRawFabrics(result.fabrics);
      setPdmlRawFabrics(result.fabrics);
      setPdmlRawTotal(result.total || result.fabrics.length);
      setPdmlRawHasMore(false);
      setPdmlRawSyncedAt(result.syncedAt);
    } catch (error: any) {
      setPdmlRawError(error?.message || String(error));
    } finally {
      setPdmlRawLoading(false);
    }
  }

  async function hydratePdmlRawFabrics() {
    if (pdmlRawHydratedRef.current) return;
    pdmlRawHydratedRef.current = true;
    setPdmlRawLoading(true);
    setPdmlRawError('');
    try {
      const cached = await storageService.getCachedPdmlRawFabrics();
      if (cached.length > 0) {
        setPdmlRawFabrics(cached);
        setPdmlRawTotal(cached.length);
        setPdmlRawHasMore(false);
        setPdmlRawSyncedAt(cached[0]?.syncedAt || null);
        void refreshPdmlRawCacheFromCloud();
        return;
      }
      const firstPage = await apiService.listPdmlRawFabrics(cloudEndpoint, { limit: PDML_RAW_PAGE_SIZE, offset: 0 });
      setPdmlRawFabrics(firstPage.fabrics);
      setPdmlRawTotal(firstPage.total);
      setPdmlRawHasMore(firstPage.hasMore);
      setPdmlRawSyncedAt(firstPage.fabrics[0]?.syncedAt || null);
      void refreshPdmlRawCacheFromCloud();
    } catch (error: any) {
      setPdmlRawError(error?.message || String(error));
    } finally {
      setPdmlRawLoading(false);
    }
  }

  async function handleSyncPdmlRawFabrics() {
    setPdmlRawSyncing(true);
    setPdmlRawError('');
    try {
      const started = await apiService.startPdmlRawSync(cloudEndpoint, { pageSize: PDML_RAW_PAGE_SIZE });
      const job = await pollPdmlSyncJob(started.jobId);
      if (job.status === 'failed') throw new Error(job.error || 'PDML 同步任务失败');
      if (job.status !== 'completed' || !job.result) {
        setPdmlRawError(`同步任务仍在后台运行：${job.jobId}。已保留当前数据。`);
        return;
      }
      setPdmlRawSyncedAt(job.result.syncedAt);
      await refreshPdmlRawCacheFromCloud();
    } catch (error: any) {
      await loadPdmlRawFabrics(searchTerm, 'reset');
      setPdmlRawError(`同步未完成：${error?.message || String(error)}。已保留当前数据。`);
    } finally {
      setPdmlRawSyncing(false);
    }
  }

  async function handleMapPdmlRawFabrics() {
    setPdmlRawMapping(true);
    setPdmlRawError('');
    try {
      let offset = 0;
      let hasMore = true;
      const limit = 500;
      let created = 0;
      let updated = 0;
      while (hasMore) {
        const result = await apiService.mapPdmlRawFabricsToProducts(cloudEndpoint, { limit, offset });
        created += result.created;
        updated += result.updated;
        hasMore = result.hasMore;
        offset += result.mapped;
        if (result.mapped === 0) break;
      }
      const refreshed = await apiService.listProductAssets(cloudEndpoint, { mainCategory: 'Fabric', limit: 500 });
      onUpdateProducts(refreshed, refreshed[0]);
      setPdmlRawError(`已映射 ${created + updated} 条：新增 ${created}，更新 ${updated}`);
    } catch (error: any) {
      setPdmlRawError(error?.message || String(error));
    } finally {
      setPdmlRawMapping(false);
    }
  }

  const productSortOptions: Array<{ value: string; label: string; column: ProductTableSortColumn; desc: boolean }> = [
    { value: 'updatedAt:desc', label: '更新时间 最新优先', column: 'updatedAt', desc: true },
    { value: 'updatedAt:asc', label: '更新时间 最早优先', column: 'updatedAt', desc: false },
    { value: 'factoryPrice:desc', label: '工厂价 高到低', column: 'factoryPrice', desc: true },
    { value: 'factoryPrice:asc', label: '工厂价 低到高', column: 'factoryPrice', desc: false },
    { value: 'salesPrice:desc', label: '售价 高到低', column: 'salesPrice', desc: true },
    { value: 'salesPrice:asc', label: '售价 低到高', column: 'salesPrice', desc: false },
    { value: 'completeness:asc', label: '补全度 缺项少优先', column: 'completeness', desc: false },
    { value: 'stock:desc', label: '库存数量 多到少', column: 'stock', desc: true },
    { value: 'sku:asc', label: 'SKU A-Z', column: 'sku', desc: false },
    { value: 'name:asc', label: '名称 A-Z', column: 'name', desc: false },
    { value: 'articleNo:asc', label: 'Article A-Z', column: 'articleNo', desc: false },
    { value: 'millQuality:asc', label: 'Mill Quality A-Z', column: 'millQuality', desc: false },
    { value: 'millOrg:asc', label: '供应商 A-Z', column: 'millOrg', desc: false },
    { value: 'clientCode:asc', label: 'Client Code A-Z', column: 'clientCode', desc: false },
  ];
  const productSortValue = `${tableSort.column}:${tableSort.desc ? 'desc' : 'asc'}`;

  const mainCategories = PRODUCT_MAIN_CATEGORY_DEFINITIONS;

  useEffect(() => {
    if (!showAddProdModal && !editingProd) return;
    setSkuForQr('');
    setSkuQrDataUrl('');
    setCompositionDraftRows(
      (editingProd?.compositionLines || []).length > 0
        ? (editingProd?.compositionLines || []).map((line, index) => ({
          id: line.id || `composition-${index}`,
          percentage: line.percentage ? String(line.percentage) : '',
          abbreviation: line.term?.abbreviation || '',
          chineseName: line.term?.chineseName || line.termId || '',
          englishName: line.term?.englishName || '',
        }))
        : [{ id: `composition-${Date.now()}`, percentage: '', abbreviation: '', chineseName: '', englishName: '' }],
    );
  }, [editingProd, showAddProdModal]);

  useEffect(() => {
    if (selectedMain !== 'Fabric') return;
    void hydratePdmlRawFabrics();
  }, [selectedMain]);

  useEffect(() => {
    if (!isPdmlRawView) return;
    void hydratePdmlRawFabrics();
  }, [isPdmlRawView]);

  const handleGenerateSkuQr = async () => {
    const sku = skuInputRef.current?.value.trim() || '';
    if (!sku) {
      setSkuQrDataUrl('');
      setSkuForQr('');
      return;
    }

    setSkuForQr(sku);
    try {
      const url = await QRCode.toDataURL(sku, { margin: 1, width: 168, errorCorrectionLevel: 'M' });
      setSkuQrDataUrl(url);
    } catch {
      setSkuQrDataUrl('');
    }
  };

  const handleSkuKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  const currentSubCategories = useMemo(() => {
    const userCategories = productCategories.filter(c => c.mainCategory === selectedMain && !c.deletedAt);
    const defaultCategories = selectedMain === 'Garment'
      ? DEFAULT_GARMENT_SUB_CATEGORIES
      : selectedMain === 'Trimmings'
        ? DEFAULT_TRIMMING_SUB_CATEGORIES
        : null;
    if (!defaultCategories) return userCategories;

    const userKeys = new Set(userCategories.flatMap(category => [category.id, category.name]));
    const defaults = defaultCategories.filter(category => !userKeys.has(category.id) && !userKeys.has(category.name));
    return [...defaults, ...userCategories];
  }, [productCategories, selectedMain]);

  const activeSubCategoryIds = useMemo(() => new Set(currentSubCategories.map(c => c.id)), [currentSubCategories]);

  const compositionTermSuggestions: CompositionTermSuggestion[] = COMPOSITION_TERMS;

  const selectedMainProducts = useMemo(() => {
    return products.filter(p => p.mainCategory === selectedMain && !p.deletedAt);
  }, [products, selectedMain]);

  const uncategorizedProducts = useMemo(() => {
    return selectedMainProducts.filter(p => !p.subCategoryId || !activeSubCategoryIds.has(p.subCategoryId));
  }, [activeSubCategoryIds, selectedMainProducts]);

  const categoryGroups = useMemo(() => {
    if (classificationView === 'category') {
      const groups = currentSubCategories.map(cat => ({
        id: cat.id,
        name: cat.name,
        description: cat.description || '自定义产品类别分类。',
        count: selectedMainProducts.filter(p => p.subCategoryId === cat.id).length,
        tone: 'slate' as const,
      }));
      if (selectedMain === 'Fabric') {
        groups.unshift({
          id: PDML_RAW_LIBRARY_ID,
          name: '庞大原始库',
          description: '来自庞大面料库的完整原始记录，尚未映射成 Bambook SKU。',
          count: pdmlRawTotal || pdmlRawFabrics.length,
          tone: 'slate' as const,
        });
      }
      return groups;
    }

    const makeGroups = (records: Array<{ id: string; name: string; product: ProductAsset }>, fallbackLabel: string, tone: 'slate') => {
      const map = new Map<string, { id: string; name: string; count: number }>();
      for (const record of records) {
        const id = record.id || fallbackLabel;
        const existing = map.get(id);
        map.set(id, { id, name: record.name || fallbackLabel, count: (existing?.count || 0) + 1 });
      }
      const mapped = Array.from(map.values()).map(item => ({
        ...item,
        description: `${item.count} 个档案匹配此视图。`,
        tone,
      }));
      if (mapped.length > 0) return mapped;
      return [{
        id: `empty-${classificationView}`,
        name: fallbackLabel,
        description: '当前还没有可用于此分类方式的数据。',
        count: selectedMainProducts.length,
        tone,
      }];
    };
    const supplierGroup = (product: ProductAsset) => {
      if (product.mainCategory === 'Garment') return product.garmentProfile?.factory || '';
      if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.supplier || product.trimmingProfile?.factory || '';
      return product.fabricProfile?.millOrganizationId || '';
    };
    const supplierFallback = selectedMain === 'Garment' ? '工厂未填' : '供应商未填';
    const priceGroupValue = (product: ProductAsset) => {
      if (product.mainCategory === 'Garment') return Number(String(product.garmentProfile?.targetCost || product.garmentProfile?.fobPrice || '').replace(/[^\d.]/g, '')) || 0;
      if (product.mainCategory === 'Trimmings') return Number(String(product.trimmingProfile?.price || '').replace(/[^\d.]/g, '')) || 0;
      return latestPrice(product, 'factory')?.amount || latestPrice(product, 'customer')?.amount || 0;
    };
    const statusGroup = (product: ProductAsset) => {
      if (product.mainCategory === 'Garment') return product.status || '';
      if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.stockStatus || product.status || '';
      return product.fabricProfile?.stockStatus || product.status || '';
    };

    if (classificationView === 'supplier') {
      return makeGroups(selectedMainProducts.map(product => ({
        product,
        id: supplierGroup(product),
        name: supplierGroup(product) || supplierFallback,
      })), supplierFallback, 'slate');
    }

    if (classificationView === 'customer') {
      return makeGroups(selectedMainProducts.flatMap(product => {
        if (product.mainCategory === 'Garment') {
          return [{ product, id: product.garmentProfile?.customer || '', name: product.garmentProfile?.customer || '客户未填' }];
        }
        if (product.mainCategory === 'Trimmings') {
          const customer = product.trimmingProfile?.customer || product.trimmingProfile?.brand || '';
          return [{ product, id: customer, name: customer || '客户/品牌未填' }];
        }
        const codes = product.fabricCustomerCodes || [];
        return codes.length > 0
          ? codes.map(code => ({ product, id: code.customerOrganizationId || code.clientCode, name: code.customerNameSnapshot || code.clientCode }))
          : [{ product, id: '', name: '客户/Client Code 未填' }];
      }), '客户/Client Code 未填', 'slate');
    }

    if (classificationView === 'certification') {
      return makeGroups(selectedMainProducts.flatMap(product => {
        if (product.mainCategory === 'Garment') {
          const tests = String(product.garmentProfile?.complianceTests || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
          return tests.length > 0
            ? tests.map(test => ({ product, id: test, name: test }))
            : [{ product, id: '', name: '测试/合规未填' }];
        }
        if (product.mainCategory === 'Trimmings') {
          const tests = String(product.trimmingProfile?.complianceTests || product.trimmingProfile?.qualityStandard || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
          return tests.length > 0
            ? tests.map(test => ({ product, id: test, name: test }))
            : [{ product, id: '', name: '测试/合规未填' }];
        }
        const certs = product.fabricCertifications || [];
        return certs.length > 0
          ? certs.map(cert => ({ product, id: cert.certification, name: cert.certification }))
          : [{ product, id: '', name: '认证未填' }];
      }), '认证未填', 'slate');
    }

    if (classificationView === 'price') {
      return makeGroups(selectedMainProducts.map(product => {
        const price = priceGroupValue(product);
        const bucket = price <= 0 ? '价格未填' : price < 5 ? '低价位' : price < 15 ? '中价位' : '高价位';
        return { product, id: bucket, name: bucket };
      }), '价格未填', 'slate');
    }

    return makeGroups(selectedMainProducts.map(product => ({
      product,
      id: statusGroup(product),
      name: statusGroup(product) || '状态未填',
    })), '状态未填', 'slate');
  }, [classificationView, currentSubCategories, pdmlRawFabrics.length, pdmlRawTotal, selectedMain, selectedMainProducts]);

  const currentProducts = useMemo(() => {
    if (selectedSubId === PDML_RAW_LIBRARY_ID) return [];
    let list = selectedMainProducts;
    if (selectedSubId === UNCATEGORIZED_CATEGORY_ID) {
      list = uncategorizedProducts;
    } else if (selectedSubId && selectedSubId !== ALL_PRODUCTS_CATEGORY_ID) {
      if (classificationView === 'category') {
        list = selectedMainProducts.filter(p => p.subCategoryId === selectedSubId);
      } else if (classificationView === 'supplier') {
        list = selectedMainProducts.filter(p => {
          const supplier = p.mainCategory === 'Garment'
            ? (p.garmentProfile?.factory || '工厂未填')
            : p.mainCategory === 'Trimmings'
              ? (p.trimmingProfile?.supplier || p.trimmingProfile?.factory || '供应商未填')
              : (p.fabricProfile?.millOrganizationId || '供应商未填');
          return supplier === selectedSubId;
        });
      } else if (classificationView === 'customer') {
        list = selectedMainProducts.filter(p => {
          if (p.mainCategory === 'Garment') return (p.garmentProfile?.customer || '客户未填') === selectedSubId;
          if (p.mainCategory === 'Trimmings') return (p.trimmingProfile?.customer || p.trimmingProfile?.brand || '客户/品牌未填') === selectedSubId;
          const codes = p.fabricCustomerCodes || [];
          return codes.length > 0
            ? codes.some(code => (code.customerOrganizationId || code.clientCode) === selectedSubId)
            : selectedSubId === '客户/Client Code 未填';
        });
      } else if (classificationView === 'certification') {
        list = selectedMainProducts.filter(p => {
          if (p.mainCategory === 'Garment') {
            const tests = String(p.garmentProfile?.complianceTests || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
            return tests.length > 0 ? tests.includes(selectedSubId) : selectedSubId === '测试/合规未填';
          }
          if (p.mainCategory === 'Trimmings') {
            const tests = String(p.trimmingProfile?.complianceTests || p.trimmingProfile?.qualityStandard || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
            return tests.length > 0 ? tests.includes(selectedSubId) : selectedSubId === '测试/合规未填';
          }
          const certs = p.fabricCertifications || [];
          return certs.length > 0
            ? certs.some(cert => cert.certification === selectedSubId)
            : selectedSubId === '认证未填';
        });
      } else if (classificationView === 'price') {
        list = selectedMainProducts.filter(p => {
          const garmentPrice = Number(String(p.garmentProfile?.targetCost || p.garmentProfile?.fobPrice || '').replace(/[^\d.]/g, '')) || 0;
          const trimmingPrice = Number(String(p.trimmingProfile?.price || '').replace(/[^\d.]/g, '')) || 0;
          const price = p.mainCategory === 'Garment'
            ? garmentPrice
            : p.mainCategory === 'Trimmings'
              ? trimmingPrice
              : latestPrice(p, 'factory')?.amount || latestPrice(p, 'customer')?.amount || 0;
          const bucket = price <= 0 ? '价格未填' : price < 5 ? '低价位' : price < 15 ? '中价位' : '高价位';
          return bucket === selectedSubId;
        });
      } else if (classificationView === 'status') {
        list = selectedMainProducts.filter(p => {
          const status = p.mainCategory === 'Garment'
            ? (p.status || '状态未填')
            : p.mainCategory === 'Trimmings'
              ? (p.trimmingProfile?.stockStatus || p.status || '状态未填')
              : (p.fabricProfile?.stockStatus || p.status || '状态未填');
          return status === selectedSubId;
        });
      }
    }
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(lower) ||
        p.sku.toLowerCase().includes(lower) ||
        (p.fabricProfile?.articleNo || '').toLowerCase().includes(lower) ||
        (p.fabricProfile?.millQuality || '').toLowerCase().includes(lower) ||
        (p.fabricProfile?.millColorCode || '').toLowerCase().includes(lower) ||
        (p.fabricProfile?.colorDescription || '').toLowerCase().includes(lower) ||
        (p.garmentProfile?.styleNo || '').toLowerCase().includes(lower) ||
        (p.garmentProfile?.productName || '').toLowerCase().includes(lower) ||
        (p.garmentProfile?.garmentCategory || '').toLowerCase().includes(lower) ||
        (p.garmentProfile?.customer || '').toLowerCase().includes(lower) ||
        (p.garmentProfile?.factory || '').toLowerCase().includes(lower) ||
        (p.trimmingProfile?.trimmingCode || '').toLowerCase().includes(lower) ||
        (p.trimmingProfile?.trimmingName || '').toLowerCase().includes(lower) ||
        (p.trimmingProfile?.trimmingCategory || '').toLowerCase().includes(lower) ||
        (p.trimmingProfile?.supplier || '').toLowerCase().includes(lower) ||
        (p.trimmingProfile?.customer || '').toLowerCase().includes(lower) ||
        (p.fabricCustomerCodes || []).some(item => item.clientCode.toLowerCase().includes(lower)) ||
        (p.fabricCertifications || []).some(item => item.certification.toLowerCase().includes(lower))
      );
    }
    const priceOf = (product: ProductAsset, type: string) => product.fabricPrices?.find(price => price.priceType === type && !price.deletedAt)?.amount || 0;
    const missingCountOf = (product: ProductAsset) => {
      if (product.mainCategory === 'Garment') return garmentCompleteness(product).missing.length;
      if (product.mainCategory === 'Trimmings') return trimmingCompleteness(product).missing.length;
      if (product.mainCategory !== 'Fabric') return 0;
      const profile = product.fabricProfile;
      const hasText = (value?: string | null) => !!value?.trim();
      const hasNumber = (value?: number | null) => value !== null && value !== undefined && !Number.isNaN(value);
      return [
        hasText(product.sku),
        hasText(profile?.articleNo),
        (product.compositionLines || []).length > 0,
        hasNumber(profile?.weightValue) && hasText(profile?.weightUnit),
        (hasNumber(profile?.widthValue) || hasText(profile?.widthText)) && hasText(profile?.widthUnit),
        hasText(profile?.millQuality),
        hasText(profile?.millOrganizationId),
        (product.fabricCustomerCodes || []).length > 0,
        priceOf(product, 'factory') > 0,
        priceOf(product, 'customer') > 0,
        hasText(profile?.stockStatus),
        (product.fabricCertifications || []).length > 0 || hasText(profile?.riskNote),
      ].filter(ok => !ok).length;
    };

    const { column, desc } = tableSort;
    const dir = desc ? -1 : 1;
    const cmpNum = (na: number, nb: number) => dir * (na - nb);
    const cmpStr = (sa: string, sb: string) => dir * sa.localeCompare(sb, 'zh-Hans-CN', { numeric: true });
    const clientCodesJoined = (product: ProductAsset) =>
      (product.fabricCustomerCodes || []).map(c => c.clientCode).join(', ');
    const articleSortText = (product: ProductAsset) => product.mainCategory === 'Garment'
      ? (product.garmentProfile?.styleNo || '')
      : product.mainCategory === 'Trimmings'
        ? (product.trimmingProfile?.trimmingCode || '')
        : (product.fabricProfile?.articleNo || '');
    const qualitySortText = (product: ProductAsset) => product.mainCategory === 'Garment'
      ? (product.garmentProfile?.garmentCategory || '')
      : product.mainCategory === 'Trimmings'
        ? (product.trimmingProfile?.trimmingCategory || '')
        : (product.fabricProfile?.millQuality || '');
    const supplierSortText = (product: ProductAsset) => product.mainCategory === 'Garment'
      ? (product.garmentProfile?.factory || '')
      : product.mainCategory === 'Trimmings'
        ? (product.trimmingProfile?.supplier || product.trimmingProfile?.factory || '')
        : (product.fabricProfile?.millOrganizationId || '');
    const customerSortText = (product: ProductAsset) => product.mainCategory === 'Garment'
      ? (product.garmentProfile?.customer || '')
      : product.mainCategory === 'Trimmings'
        ? (product.trimmingProfile?.customer || product.trimmingProfile?.brand || '')
        : clientCodesJoined(product);
    const factoryPriceSortValue = (product: ProductAsset) => product.mainCategory === 'Garment'
      ? Number(String(product.garmentProfile?.targetCost || '').replace(/[^\d.]/g, '')) || 0
      : product.mainCategory === 'Trimmings'
        ? Number(String(product.trimmingProfile?.price || '').replace(/[^\d.]/g, '')) || 0
        : priceOf(product, 'factory');
    const salesPriceSortValue = (product: ProductAsset) => product.mainCategory === 'Garment'
      ? Number(String(product.garmentProfile?.fobPrice || '').replace(/[^\d.]/g, '')) || 0
      : product.mainCategory === 'Trimmings'
        ? Number(String(product.trimmingProfile?.price || '').replace(/[^\d.]/g, '')) || 0
        : priceOf(product, 'customer');
    const stockSortQuantity = (product: ProductAsset) => product.mainCategory === 'Trimmings'
      ? product.trimmingProfile?.stockQuantity ?? 0
      : product.fabricProfile?.stockQuantity ?? 0;
    const stockSortStatus = (product: ProductAsset) => product.mainCategory === 'Trimmings'
      ? product.trimmingProfile?.stockStatus || ''
      : product.fabricProfile?.stockStatus || '';

    return [...list].sort((a, b) => {
      let primary = 0;
      switch (column) {
        case 'sku':
          primary = cmpStr(a.sku, b.sku);
          break;
        case 'name':
          primary = cmpStr(a.name, b.name);
          break;
        case 'articleNo':
          primary = cmpStr(articleSortText(a), articleSortText(b));
          break;
        case 'millQuality':
          primary = cmpStr(qualitySortText(a), qualitySortText(b));
          break;
        case 'millOrg':
          primary = cmpStr(supplierSortText(a), supplierSortText(b));
          break;
        case 'clientCode':
          primary = cmpStr(customerSortText(a), customerSortText(b));
          break;
        case 'factoryPrice':
          primary = cmpNum(factoryPriceSortValue(a), factoryPriceSortValue(b));
          break;
        case 'salesPrice':
          primary = cmpNum(salesPriceSortValue(a), salesPriceSortValue(b));
          break;
        case 'stock': {
          const qa = stockSortQuantity(a);
          const qb = stockSortQuantity(b);
          primary = cmpNum(qa, qb);
          if (primary === 0) {
            primary = dir * stockSortStatus(a).localeCompare(stockSortStatus(b), 'zh-Hans-CN');
          }
          break;
        }
        case 'completeness':
          primary = cmpNum(missingCountOf(a), missingCountOf(b));
          break;
        case 'updatedAt':
          primary = cmpNum(a.updatedAt || 0, b.updatedAt || 0);
          break;
        default:
          primary = 0;
      }
      if (primary !== 0) return primary;
      return a.sku.localeCompare(b.sku);
    });
  }, [classificationView, searchTerm, selectedMainProducts, selectedSubId, tableSort, uncategorizedProducts]);

  const sidebarProducts = useMemo(() => {
    let list = [...currentProducts];
    if (sideSearchTerm) {
      const q = sideSearchTerm.toLowerCase();
      list = list.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.sku.toLowerCase().includes(q) || 
        (p.fabricProfile?.articleNo || '').toLowerCase().includes(q) ||
        (p.garmentProfile?.styleNo || '').toLowerCase().includes(q) ||
        (p.trimmingProfile?.trimmingCode || '').toLowerCase().includes(q)
      );
    }
    if (sideSortOption === 'recent') {
      list.sort((a, b) => (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }
    return list;
  }, [currentProducts, sideSearchTerm, sideSortOption]);

  const isFabricContext = selectedMain === 'Fabric';

  const currentPdmlRawFabrics = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase();
    const valueOf = (row: PdmlRawFabric, key: string) => String(row.rawData?.[key] ?? '').trim();
    return pdmlRawFabrics
      .filter(row => {
        if (!lower) return true;
        return [
          row.sourceId,
          row.articleNo,
          row.factoryArticleNo,
          row.supplierName,
          row.productLine,
          row.colorCode,
          row.factoryColorCode,
          valueOf(row, 'CF'),
          valueOf(row, 'KZ'),
          valueOf(row, 'FK'),
        ].some(value => String(value || '').toLowerCase().includes(lower));
      })
      .sort((a, b) => String(b.registeredDate || '').localeCompare(String(a.registeredDate || ''), 'zh-Hans-CN', { numeric: true }));
  }, [pdmlRawFabrics, searchTerm]);

  const buildFabricProfileFromForm = (formData: FormData, existing?: ProductAsset): ProductAsset['fabricProfile'] => {
    if (!isFabricFormContext && existing?.mainCategory !== 'Fabric') return existing?.fabricProfile;
    const now = Date.now();
    const valueOf = (key: string) => {
      const value = String(formData.get(key) || '').trim();
      return value || undefined;
    };
    const numberOf = (key: string) => {
      const value = valueOf(key);
      return value ? Number(value) : undefined;
    };
    return {
      id: existing?.fabricProfile?.id || `FAB-PROFILE-${now}`,
      productAssetId: existing?.id || '',
      articleNo: valueOf('articleNo'),
      millOrganizationId: valueOf('millOrganizationId'),
      millQuality: valueOf('millQuality'),
      millColorCode: valueOf('millColorCode'),
      colorDescription: valueOf('colorDescription'),
      construction: valueOf('construction'),
      yarnCount: valueOf('yarnCount'),
      pattern: valueOf('pattern'),
      weightValue: numberOf('weightValue'),
      weightUnit: valueOf('weightUnit'),
      widthValue: numberOf('widthValue'),
      widthUnit: valueOf('widthUnit'),
      widthText: valueOf('widthText'),
      productionLeadDays: numberOf('productionLeadDays'),
      referenceBatch: valueOf('referenceBatch'),
      stockStatus: valueOf('stockStatus'),
      stockQuantity: numberOf('stockQuantity'),
      stockUnit: valueOf('stockUnit'),
      moqValue: numberOf('moqValue'),
      factoryMoqValue: numberOf('factoryMoqValue'),
      sampleMoqValue: numberOf('sampleMoqValue'),
      riskNote: valueOf('riskNote'),
      specialNote: valueOf('specialNote'),
      updatedAt: now,
      deletedAt: undefined,
    };
  };

  const buildGarmentProfileFromForm = (formData: FormData, existing?: ProductAsset): ProductAsset['garmentProfile'] => {
    if (!isGarmentFormContext && existing?.mainCategory !== 'Garment') return existing?.garmentProfile;
    const now = Date.now();
    const valueOf = (key: string) => {
      const value = String(formData.get(key) || '').trim();
      return value || undefined;
    };
    return {
      id: existing?.garmentProfile?.id || `GAR-PROFILE-${now}`,
      productAssetId: existing?.id || '',
      styleNo: valueOf('styleNo'),
      productName: valueOf('productName'),
      garmentCategory: valueOf('garmentCategory'),
      collection: valueOf('collection'),
      customer: valueOf('customer'),
      brand: valueOf('brand'),
      project: valueOf('project'),
      gender: valueOf('gender'),
      ageGroup: valueOf('ageGroup'),
      tags: valueOf('tags'),
      silhouette: valueOf('silhouette'),
      fit: valueOf('fit'),
      collarType: valueOf('collarType'),
      sleeveType: valueOf('sleeveType'),
      closureType: valueOf('closureType'),
      pocketDetails: valueOf('pocketDetails'),
      hemDetails: valueOf('hemDetails'),
      waistbandDetails: valueOf('waistbandDetails'),
      liningStructure: valueOf('liningStructure'),
      interlining: valueOf('interlining'),
      shoulderPad: valueOf('shoulderPad'),
      stitchDetails: valueOf('stitchDetails'),
      constructionNote: valueOf('constructionNote'),
      mainFabric: valueOf('mainFabric'),
      contrastFabric: valueOf('contrastFabric'),
      liningFabric: valueOf('liningFabric'),
      ribFabric: valueOf('ribFabric'),
      pocketingFabric: valueOf('pocketingFabric'),
      button: valueOf('button'),
      zipper: valueOf('zipper'),
      snapsEyelets: valueOf('snapsEyelets'),
      thread: valueOf('thread'),
      labelTrims: valueOf('labelTrims'),
      packaging: valueOf('packaging'),
      materialUsage: valueOf('materialUsage'),
      substituteMaterials: valueOf('substituteMaterials'),
      sizeRange: valueOf('sizeRange'),
      baseSize: valueOf('baseSize'),
      measurementPoints: valueOf('measurementPoints'),
      sizeSpec: valueOf('sizeSpec'),
      tolerance: valueOf('tolerance'),
      gradingRule: valueOf('gradingRule'),
      shrinkageAllowance: valueOf('shrinkageAllowance'),
      garmentWeight: valueOf('garmentWeight'),
      colorways: valueOf('colorways'),
      customerColorCodes: valueOf('customerColorCodes'),
      fabricColorCodes: valueOf('fabricColorCodes'),
      garmentSku: valueOf('garmentSku'),
      barcode: valueOf('barcode'),
      availableSizes: valueOf('availableSizes'),
      colorImageNotes: valueOf('colorImageNotes'),
      moq: valueOf('moq'),
      sampleVersion: valueOf('sampleVersion'),
      patternMaker: valueOf('patternMaker'),
      merchandiser: valueOf('merchandiser'),
      owner: valueOf('owner'),
      revisionHistory: valueOf('revisionHistory'),
      fittingComments: valueOf('fittingComments'),
      customerComments: valueOf('customerComments'),
      confirmedDate: valueOf('confirmedDate'),
      techPackVersion: valueOf('techPackVersion'),
      factory: valueOf('factory'),
      orderQuantity: valueOf('orderQuantity'),
      deliveryDate: valueOf('deliveryDate'),
      targetCost: valueOf('targetCost'),
      fobPrice: valueOf('fobPrice'),
      exwPrice: valueOf('exwPrice'),
      retailPrice: valueOf('retailPrice'),
      inspectionStandard: valueOf('inspectionStandard'),
      commonDefects: valueOf('commonDefects'),
      washFinishing: valueOf('washFinishing'),
      careLabel: valueOf('careLabel'),
      complianceTests: valueOf('complianceTests'),
      packingMethod: valueOf('packingMethod'),
      cartonSpec: valueOf('cartonSpec'),
      countryOfOrigin: valueOf('countryOfOrigin'),
      qualityNote: valueOf('qualityNote'),
      updatedAt: now,
      deletedAt: undefined,
    };
  };

  const buildTrimmingProfileFromForm = (formData: FormData, existing?: ProductAsset): ProductAsset['trimmingProfile'] => {
    if (!isTrimmingFormContext && existing?.mainCategory !== 'Trimmings') return existing?.trimmingProfile;
    const now = Date.now();
    const valueOf = (key: string) => {
      const value = String(formData.get(key) || '').trim();
      return value || undefined;
    };
    const numberOf = (key: string) => {
      const value = valueOf(key);
      return value ? Number(value) : undefined;
    };
    return {
      id: existing?.trimmingProfile?.id || `TRIM-PROFILE-${now}`,
      productAssetId: existing?.id || '',
      trimmingCode: valueOf('trimmingCode'),
      trimmingName: valueOf('trimmingName'),
      trimmingCategory: valueOf('trimmingCategory'),
      material: valueOf('material'),
      specification: valueOf('specification'),
      size: valueOf('size'),
      color: valueOf('color'),
      colorCode: valueOf('colorCode'),
      finish: valueOf('finish'),
      supplier: valueOf('supplier'),
      factory: valueOf('factory'),
      brand: valueOf('brand'),
      customer: valueOf('customer'),
      applicableProducts: valueOf('applicableProducts'),
      usagePosition: valueOf('usagePosition'),
      unit: valueOf('unit'),
      unitConsumption: valueOf('unitConsumption'),
      moq: valueOf('moq'),
      leadTime: valueOf('leadTime'),
      stockStatus: valueOf('stockStatus'),
      stockQuantity: numberOf('stockQuantity'),
      stockUnit: valueOf('stockUnit'),
      price: valueOf('price'),
      currency: valueOf('currency'),
      complianceTests: valueOf('complianceTests'),
      qualityStandard: valueOf('qualityStandard'),
      riskNote: valueOf('riskNote'),
      packaging: valueOf('packaging'),
      careRequirement: valueOf('careRequirement'),
      notes: valueOf('notes'),
      updatedAt: now,
      deletedAt: undefined,
    };
  };

  const splitList = (value: FormDataEntryValue | null) => String(value || '')
    .split(/[,，\n]/)
    .map(item => item.trim())
    .filter(Boolean);

  const compositionText = (product?: ProductAsset | null) => {
    return (product?.compositionLines || [])
      .map(line => `${line.percentage}% ${line.term?.chineseName || line.term?.englishName || line.termId}`)
      .join(' + ');
  };

  const compositionDraftText = () => {
    return compositionDraftRows
      .map(row => ({
        percentage: row.percentage.trim(),
        abbreviation: row.abbreviation.trim(),
        chineseName: row.chineseName.trim(),
        englishName: row.englishName.trim(),
      }))
      .filter(row => row.percentage || row.abbreviation || row.chineseName || row.englishName)
      .map(row => `${row.percentage}${row.percentage ? '% ' : ''}${[row.abbreviation, row.chineseName, row.englishName].filter(Boolean).join(' / ')}`.trim())
      .join(' + ');
  };

  const compositionFilledRows = compositionDraftRows.filter(row =>
    row.percentage.trim() || row.abbreviation.trim() || row.chineseName.trim() || row.englishName.trim(),
  );
  const compositionTotal = Number(compositionFilledRows
    .reduce((total, row) => total + Number(row.percentage || 0), 0)
    .toFixed(2));
  const compositionTotalIsComplete = compositionFilledRows.length === 0 || Math.abs(compositionTotal - 100) < 0.01;
  const compositionTotalIsOver = compositionTotal > 100;
  const compositionValidationMessage = compositionFilledRows.length === 0
    ? '可先留空，后续补全；一旦填写成分，总比例必须等于 100%。'
    : compositionTotalIsComplete
      ? '成分比例已合计 100%。'
      : compositionTotalIsOver
        ? `当前合计 ${compositionTotal}%，已超过 100%。`
        : `当前合计 ${compositionTotal}%，还差 ${Number((100 - compositionTotal).toFixed(2))}%。`;

  const normalizePercentageValue = (value: string) => {
    if (value.trim() === '') return '';
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return '';
    return String(Math.min(100, Math.max(0, numeric)));
  };

  const findCompositionTermForDraftRow = (row: Pick<CompositionDraftLine, 'abbreviation' | 'chineseName' | 'englishName'>) => {
    const values = [row.abbreviation, row.chineseName, row.englishName]
      .map(normalizeCompositionTermValue)
      .filter(Boolean);
    if (values.length === 0) return null;

    return COMPOSITION_TERMS.find(term => {
      const termValues = [term.abbreviation, term.chineseName, term.englishName]
        .map(normalizeCompositionTermValue)
        .filter(Boolean);
      const hasMatchingIdentity = values.some(value => termValues.includes(value));
      if (!hasMatchingIdentity) return false;

      return (
        (!row.abbreviation.trim() || normalizeCompositionTermValue(row.abbreviation) === normalizeCompositionTermValue(term.abbreviation)) &&
        (!row.chineseName.trim() || normalizeCompositionTermValue(row.chineseName) === normalizeCompositionTermValue(term.chineseName)) &&
        (!row.englishName.trim() || normalizeCompositionTermValue(row.englishName) === normalizeCompositionTermValue(term.englishName))
      );
    }) || null;
  };

  const validateCompositionBeforeSave = () => {
    const invalidRows = compositionFilledRows.filter(row => !findCompositionTermForDraftRow(row));
    if (invalidRows.length > 0) {
      const firstInvalid = invalidRows[0];
      const label = [firstInvalid.abbreviation, firstInvalid.chineseName, firstInvalid.englishName].filter(Boolean).join(' / ') || '空词条';
      window.alert(`成分词条必须来自《成份符号.xls》。请检查：${label}`);
      return false;
    }
    if (compositionTotalIsComplete) return true;
    window.alert(`成分比例需要合计 100%。${compositionValidationMessage}`);
    return false;
  };

  const findCompositionTermSuggestion = (value: string) => {
    return findCompositionTermByValue(value);
  };

  const updateCompositionDraftRow = (id: string, patch: Partial<CompositionDraftLine>, shouldAutoFillTerm = false) => {
    setCompositionDraftRows(rows => rows.map(row => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (!shouldAutoFillTerm) return next;
      const matched = findCompositionTermSuggestion(patch.abbreviation || patch.chineseName || patch.englishName || '');
      return matched ? { ...next, ...matched } : next;
    }));
  };

  const addCompositionDraftRow = () => {
    setCompositionDraftRows(rows => [...rows, { id: `composition-${Date.now()}`, percentage: '', abbreviation: '', chineseName: '', englishName: '' }]);
  };

  const removeCompositionDraftRow = (id: string) => {
    setCompositionDraftRows(rows => rows.length > 1 ? rows.filter(row => row.id !== id) : [{ ...rows[0], percentage: '', abbreviation: '', chineseName: '', englishName: '' }]);
  };

  const parseCompositionDraftRows = (productId: string, existing?: ProductAsset): ProductAsset['compositionLines'] => {
    const now = Date.now();
    return compositionDraftRows
      .map(row => ({
        percentage: Number(row.percentage || 0),
        abbreviation: row.abbreviation.trim(),
        chineseName: row.chineseName.trim(),
        englishName: row.englishName.trim(),
      }))
      .filter(row => row.percentage > 0 || row.abbreviation || row.chineseName || row.englishName)
      .map((row, index) => {
        const matchedTerm = findCompositionTermForDraftRow(row);
        const abbreviation = matchedTerm?.abbreviation || row.abbreviation;
        const chineseName = matchedTerm?.chineseName || row.chineseName;
        const englishName = matchedTerm?.englishName || row.englishName;
        const displayName = chineseName || englishName || abbreviation;
        const safeTermId = `${abbreviation || displayName}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-|-$/g, '') || `term-${index}`;
        const termId = existing?.compositionLines?.[index]?.termId || `MCT-${safeTermId}`;
        return {
          id: existing?.compositionLines?.[index]?.id || `FCOMP-${productId}-${index}`,
          productAssetId: productId,
          termId,
          percentage: row.percentage,
          sortOrder: index,
          updatedAt: now,
          term: {
            ...(existing?.compositionLines?.[index]?.term || {}),
            id: termId,
            abbreviation: abbreviation || null,
            chineseName: chineseName || displayName,
            englishName: englishName || null,
            updatedAt: now,
          },
        };
      });
  };

  const buildFabricRelatedDataFromForm = (formData: FormData, productId: string, existing?: ProductAsset): Pick<ProductAsset, 'fabricCustomerCodes' | 'fabricPrices' | 'fabricCertifications' | 'compositionLines'> => {
    const now = Date.now();
    const clientCodes = splitList(formData.get('clientCodes'));
    const certifications = splitList(formData.get('certifications'));
    const factoryPrice = Number(formData.get('factoryPrice') || 0);
    const salesPrice = Number(formData.get('salesPrice') || 0);
    const samplePrice = Number(formData.get('samplePrice') || 0);
    const cuttingPrice = Number(formData.get('cuttingPrice') || 0);
    const currency = String(formData.get('priceCurrency') || 'USD').trim() || 'USD';
    const unit = String(formData.get('priceUnit') || 'm').trim() || 'm';
    const existingPrices = (existing?.fabricPrices || []).filter(price => !price.deletedAt);
    const createPriceRows = (priceType: 'factory' | 'customer' | 'sample' | 'cutting', amount: number) => {
      const previousRows = existingPrices
        .filter(price => price.priceType === priceType)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (amount <= 0) return previousRows;

      const latest = previousRows[0];
      const hasSameLatest = latest &&
        latest.amount === amount &&
        latest.currency === currency &&
        (latest.unit || '') === unit;

      if (hasSameLatest) return previousRows;

      return [{
        id: `FPRICE-${productId}-${priceType}-${now}`,
        productAssetId: productId,
        priceType,
        amount,
        currency,
        unit,
        sourceType: 'manual',
        effectiveDate: new Date(now).toISOString().slice(0, 10),
        updatedAt: now,
      } as const, ...previousRows];
    };

    return {
      fabricCustomerCodes: clientCodes.map((clientCode, index) => ({
        id: existing?.fabricCustomerCodes?.[index]?.id || `FCC-${productId}-${index}`,
        productAssetId: productId,
        clientCode,
        updatedAt: now,
      })),
      fabricCertifications: certifications.map((certification, index) => ({
        id: existing?.fabricCertifications?.[index]?.id || `FCERT-${productId}-${index}`,
        productAssetId: productId,
        certification,
        updatedAt: now,
      })),
      compositionLines: parseCompositionDraftRows(productId, existing),
      fabricPrices: [
        ...createPriceRows('factory', factoryPrice),
        ...createPriceRows('customer', salesPrice),
        ...createPriceRows('sample', samplePrice),
        ...createPriceRows('cutting', cuttingPrice),
        ...existingPrices.filter(price =>
          price.priceType !== 'factory' && price.priceType !== 'customer'
          && price.priceType !== 'sample' && price.priceType !== 'cutting'
        ),
      ],
    };
  };

  function priceHistoryRows(product: ProductAsset, type: string) {
    return (product.fabricPrices || [])
      .filter(price => price.priceType === type && !price.deletedAt)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function latestPrice(product: ProductAsset, type: string) {
    return priceHistoryRows(product, type)[0];
  }

  const formatPrice = (product: ProductAsset, type: string) => {
    const price = latestPrice(product, type);
    if (!price) return '未填';
    return `${price.currency} ${price.amount}${price.unit ? ` / ${price.unit}` : ''}`;
  };

  const clientCodeText = (product: ProductAsset) => {
    return (product.fabricCustomerCodes || []).map(item => item.clientCode).join(', ') || '未填';
  };

  const certificationText = (product: ProductAsset) => {
    return (product.fabricCertifications || []).map(item => item.certification).join(', ') || '未填';
  };

  const productCodeText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return product.garmentProfile?.styleNo || product.sku;
    if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.trimmingCode || product.sku;
    return product.fabricProfile?.articleNo || product.sku;
  };

  const productCategoryText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return product.garmentProfile?.garmentCategory || '品类未填';
    if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.trimmingCategory || '辅料类别未填';
    return product.fabricProfile?.millQuality || 'Mill Quality 未填';
  };

  const productSupplierText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return product.garmentProfile?.factory || '工厂未填';
    if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.supplier || product.trimmingProfile?.factory || '供应商未填';
    return product.fabricProfile?.millOrganizationId || '供应商未填';
  };

  const productCustomerText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return product.garmentProfile?.customer || '客户未填';
    if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.customer || product.trimmingProfile?.brand || '客户/品牌未填';
    return clientCodeText(product);
  };

  const productStockText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return `${product.garmentProfile?.colorways || '颜色未填'} / ${product.garmentProfile?.sizeRange || product.garmentProfile?.availableSizes || '尺码未填'}`;
    if (product.mainCategory === 'Trimmings') return `${product.trimmingProfile?.stockStatus || '库存未填'} / ${formatMeasure(product.trimmingProfile?.stockQuantity, product.trimmingProfile?.stockUnit)}`;
    return `${product.fabricProfile?.stockStatus || '未填'} / ${formatMeasure(product.fabricProfile?.stockQuantity, product.fabricProfile?.stockUnit)}`;
  };

  const productFactoryPriceText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return product.garmentProfile?.targetCost || '未填';
    if (product.mainCategory === 'Trimmings') return [product.trimmingProfile?.currency, product.trimmingProfile?.price].filter(Boolean).join(' ') || '未填';
    return formatPrice(product, 'factory');
  };

  const productSalesPriceText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return product.garmentProfile?.fobPrice || '未填';
    if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.unit ? `/ ${product.trimmingProfile.unit}` : '未填';
    return formatPrice(product, 'customer');
  };

  const productPriceValue = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return Number(String(product.garmentProfile?.targetCost || product.garmentProfile?.fobPrice || '').replace(/[^\d.]/g, '')) || 0;
    if (product.mainCategory === 'Trimmings') return Number(String(product.trimmingProfile?.price || '').replace(/[^\d.]/g, '')) || 0;
    return latestPrice(product, 'factory')?.amount || latestPrice(product, 'customer')?.amount || 0;
  };

  const productCertificationTokens = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return String(product.garmentProfile?.complianceTests || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
    if (product.mainCategory === 'Trimmings') return String(product.trimmingProfile?.complianceTests || product.trimmingProfile?.qualityStandard || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
    return (product.fabricCertifications || []).map(cert => cert.certification).filter(Boolean);
  };

  const productStatusGroupText = (product: ProductAsset) => {
    if (product.mainCategory === 'Garment') return product.status || '状态未填';
    if (product.mainCategory === 'Trimmings') return product.trimmingProfile?.stockStatus || product.status || '状态未填';
    return product.fabricProfile?.stockStatus || product.status || '状态未填';
  };

  const fabricCompleteness = (product: ProductAsset) => {
    if (product.mainCategory !== 'Fabric') {
      return { missing: [] as string[], total: 0, completed: 0, percent: 100, complete: true };
    }

    const profile = product.fabricProfile;
    const hasText = (value?: string | null) => !!value?.trim();
    const hasNumber = (value?: number | null) => value !== null && value !== undefined && !Number.isNaN(value);
    const checks = [
      { label: 'SKU', ok: hasText(product.sku) },
      { label: '品号', ok: hasText(profile?.articleNo) },
      { label: '成分', ok: (product.compositionLines || []).length > 0 },
      { label: '克重', ok: hasNumber(profile?.weightValue) && hasText(profile?.weightUnit) },
      { label: '门幅', ok: (hasNumber(profile?.widthValue) || hasText(profile?.widthText)) && hasText(profile?.widthUnit) },
      { label: 'Mill Quality', ok: hasText(profile?.millQuality) },
      { label: '生产工厂', ok: hasText(profile?.millOrganizationId) },
      { label: 'Client Code', ok: (product.fabricCustomerCodes || []).length > 0 },
      { label: '工厂价', ok: !!latestPrice(product, 'factory') },
      { label: '售价', ok: !!latestPrice(product, 'customer') },
      { label: '现货状态', ok: hasText(profile?.stockStatus) },
      { label: '认证/风险', ok: (product.fabricCertifications || []).length > 0 || hasText(profile?.riskNote) },
    ];
    const missing = checks.filter(item => !item.ok).map(item => item.label);
    const completed = checks.length - missing.length;
    return {
      missing,
      total: checks.length,
      completed,
      percent: Math.round((completed / checks.length) * 100),
      complete: missing.length === 0,
    };
  };

  const garmentCompleteness = (product: ProductAsset) => {
    if (product.mainCategory !== 'Garment') {
      return { missing: [] as string[], total: 0, completed: 0, percent: 100, complete: true };
    }

    const profile = product.garmentProfile;
    const hasText = (value?: string | null) => !!value?.trim();
    const checks = [
      { label: '款号', ok: hasText(profile?.styleNo) || hasText(product.sku) },
      { label: '款名', ok: hasText(profile?.productName) || hasText(product.name) },
      { label: '品类', ok: hasText(profile?.garmentCategory) },
      { label: '客户/品牌', ok: hasText(profile?.customer) || hasText(profile?.brand) },
      { label: '成衣结构', ok: hasText(profile?.silhouette) || hasText(profile?.fit) || hasText(profile?.constructionNote) },
      { label: '材料 BOM', ok: hasText(profile?.mainFabric) || hasText(profile?.materialUsage) },
      { label: '尺码', ok: hasText(profile?.sizeRange) || hasText(profile?.sizeSpec) },
      { label: '颜色/SKU', ok: hasText(profile?.colorways) || hasText(profile?.garmentSku) },
      { label: '开发记录', ok: hasText(profile?.sampleVersion) || hasText(profile?.revisionHistory) },
      { label: '生产信息', ok: hasText(profile?.factory) || hasText(profile?.deliveryDate) },
      { label: '质量包装', ok: hasText(profile?.inspectionStandard) || hasText(profile?.packingMethod) },
    ];
    const missing = checks.filter(item => !item.ok).map(item => item.label);
    const completed = checks.length - missing.length;
    return {
      missing,
      total: checks.length,
      completed,
      percent: Math.round((completed / checks.length) * 100),
      complete: missing.length === 0,
    };
  };

  const trimmingCompleteness = (product: ProductAsset) => {
    if (product.mainCategory !== 'Trimmings') {
      return { missing: [] as string[], total: 0, completed: 0, percent: 100, complete: true };
    }

    const profile = product.trimmingProfile;
    const hasText = (value?: string | null) => !!value?.trim();
    const hasNumber = (value?: number | null) => value !== null && value !== undefined && !Number.isNaN(value);
    const checks = [
      { label: '辅料编号', ok: hasText(profile?.trimmingCode) || hasText(product.sku) },
      { label: '辅料名称', ok: hasText(profile?.trimmingName) || hasText(product.name) },
      { label: '辅料类别', ok: hasText(profile?.trimmingCategory) },
      { label: '材质规格', ok: hasText(profile?.material) || hasText(profile?.specification) || hasText(profile?.size) },
      { label: '颜色', ok: hasText(profile?.color) || hasText(profile?.colorCode) },
      { label: '供应商', ok: hasText(profile?.supplier) || hasText(profile?.factory) },
      { label: '使用部位', ok: hasText(profile?.usagePosition) || hasText(profile?.applicableProducts) },
      { label: '采购信息', ok: hasText(profile?.unit) || hasText(profile?.unitConsumption) || hasText(profile?.moq) },
      { label: '库存价格', ok: hasText(profile?.stockStatus) || hasNumber(profile?.stockQuantity) || hasText(profile?.price) },
      { label: '质量合规', ok: hasText(profile?.complianceTests) || hasText(profile?.qualityStandard) || hasText(profile?.riskNote) },
      { label: '包装备注', ok: hasText(profile?.packaging) || hasText(profile?.notes) },
    ];
    const missing = checks.filter(item => !item.ok).map(item => item.label);
    const completed = checks.length - missing.length;
    return {
      missing,
      total: checks.length,
      completed,
      percent: Math.round((completed / checks.length) * 100),
      complete: missing.length === 0,
    };
  };

  const productCompleteness = (product: ProductAsset) => (
    product.mainCategory === 'Garment'
      ? garmentCompleteness(product)
      : product.mainCategory === 'Trimmings'
        ? trimmingCompleteness(product)
        : fabricCompleteness(product)
  );

  const detailValue = (value?: string | number | null) => {
    if (value === null || value === undefined || value === '') return '未填';
    return String(value);
  };

  const DetailItem = ({ label, value, wide = false }: { label: string; value?: string | number | null; wide?: boolean }) => (
    <div className={`${wide ? 'md:col-span-2' : ''} flex flex-col py-1.5`}>
      <p className={`text-[10px] font-light uppercase tracking-[0.18em] mb-1 ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}>
        {label}
      </p>
      <div className={`text-sm font-light whitespace-pre-wrap break-words ${isDarkMode ? 'text-white/80' : 'text-slate-700'}`}>
        {detailValue(value)}
      </div>
    </div>
  );

  const DetailSection = ({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) => {
    const sectionDividerClass = isDarkMode
        ? BAMBOOK_OS.tone.divider.sectionDark
        : BAMBOOK_OS.tone.divider.sectionLight;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative mb-4"
        >
            <CompiledSurfacePanel
                as="section"
                isDarkMode={isDarkMode}
                materialRole="insetSurface"
                materialTone="nested"
                className="p-4 !rounded-inset"
                contentClassName="relative z-10"
                compilerRole="detail-section-panel"
                source="CompiledProductsPage.detail-section"
            >
                <div className={`flex items-center gap-2 mb-3 pb-2.5 border-b ${sectionDividerClass}`}>
                    {icon ? (
                        <span className={isDarkMode ? 'text-white/58' : 'text-slate-600'}>{icon}</span>
                    ) : (
                        <div className={`w-1.5 h-3.5 rounded-full ${isDarkMode ? 'bg-white/20' : 'bg-slate-300'}`} />
                    )}
                    <h4 className={`text-[11px] font-light uppercase tracking-[0.18em] ${isDarkMode ? 'text-white/66' : 'text-slate-700'}`}>
                        {title}
                    </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                    {children}
                </div>
            </CompiledSurfacePanel>
        </motion.div>
    );
  };

  const getProductImageSrc = (image: ProductImage) => (
    image.url || (image.filePath ? apiService.getProductImageUrl(image.filePath) : '')
  );

  const getDisplayImages = (product: ProductAsset) => (
    (product.images || [])
      .filter(image => !image.deletedAt)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.sortOrder || 0) - (b.sortOrder || 0))
  );

  const classificationViews = PRODUCT_CLASSIFICATION_VIEW_DEFINITIONS;

  const formatMeasure = (value?: number | null, unit?: string | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '未填';
    return `${value}${unit ? ` ${unit}` : ''}`;
  };
  const formatWidth = (profile?: ProductAsset['fabricProfile']) => {
    const text = profile?.widthText?.trim();
    if (text) return `${text}${profile?.widthUnit ? ` ${profile.widthUnit}` : ''}`;
    return formatMeasure(profile?.widthValue, profile?.widthUnit);
  };

  const productFieldShellClass = `rounded-control border outline-none ${BAMBOOK_OS.typography.weight.ui} text-xs transition-all`;
  const productInputClass = `w-full h-9 px-3 ${productFieldShellClass} leading-none ${isDarkMode ? PRODUCT_FORM_FIELD_DARK_CLASS : PRODUCT_FORM_FIELD_LIGHT_CLASS}`;
  const productTextareaClass = `w-full px-3 py-3 ${productFieldShellClass} leading-relaxed resize-none ${isDarkMode ? PRODUCT_FORM_FIELD_DARK_CLASS : PRODUCT_FORM_FIELD_LIGHT_CLASS}`;
  const productLabelClass = `text-[10px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label} ml-1 ${isDarkMode ? PRODUCT_FORM_LABEL_DARK_CLASS : PRODUCT_FORM_LABEL_LIGHT_CLASS}`;
  const productFormSectionTitleClass = isDarkMode ? PRODUCT_FORM_SECTION_TITLE_DARK_CLASS : PRODUCT_FORM_SECTION_TITLE_LIGHT_CLASS;
  const productFormMapIndexClass = isDarkMode ? PRODUCT_FORM_MAP_INDEX_DARK_CLASS : PRODUCT_FORM_MAP_INDEX_LIGHT_CLASS;
  const productFormNestedRowClass = isDarkMode ? RELATIONS_FORM_NESTED_ROW_DARK_CLASS : RELATIONS_FORM_NESTED_ROW_LIGHT_CLASS;
  const productFormQuietActionClass = isDarkMode ? RELATIONS_FORM_QUIET_ACTION_DARK_CLASS : RELATIONS_FORM_QUIET_ACTION_LIGHT_CLASS;
  const productActionButtonClass = isDarkMode ? PRODUCT_TITLE_BUTTON_DARK_CLASS : PRODUCT_TITLE_BUTTON_LIGHT_CLASS;
  const productCardClass = isDarkMode ? PRODUCT_CARD_DARK_CLASS : PRODUCT_CARD_LIGHT_CLASS;
  const productToolbarSurfaceClass = isDarkMode ? PRODUCT_TOOLBAR_SURFACE_DARK_CLASS : PRODUCT_TOOLBAR_SURFACE_LIGHT_CLASS;
  const productTableHeaderClass = isDarkMode ? PRODUCT_TABLE_HEADER_DARK_CLASS : PRODUCT_TABLE_HEADER_LIGHT_CLASS;
  const productTableRowHoverClass = isDarkMode ? PRODUCT_TABLE_ROW_HOVER_DARK_CLASS : PRODUCT_TABLE_ROW_HOVER_LIGHT_CLASS;
  const productTableCellBorderClass = isDarkMode ? PRODUCT_TABLE_CELL_BORDER_DARK_CLASS : PRODUCT_TABLE_CELL_BORDER_LIGHT_CLASS;
  const productMutedTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const productGlassPanelClass = `${OS_MATERIAL.framePanel} bambook-panel-glass bambook-outer-panel`;
  const productFloatingPanelClass = `${OS_MATERIAL.floatingOverlay} bambook-panel-glass`;
  const productStatusChipClass = (complete: boolean) =>
    complete
      ? (isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue-soft)] border-white/10 shadow-none' : 'bg-[var(--os-vnext-brand-blue)]/6 text-[var(--os-vnext-brand-blue-strong)] border-slate-200/50')
      : (isDarkMode ? 'bg-white/[0.02] text-white/40 border-white/[0.04]' : 'bg-black/[0.02] text-slate-400 border-slate-200/30');
  const enabledProductTableColumnIds = new Set(
    moduleSettings?.visibleTableColumnIds?.length
      ? moduleSettings.visibleTableColumnIds
      : ['sku', 'name', 'articleNo', 'millQuality', 'millOrg', 'clientCode', 'factoryPrice', 'salesPrice', 'stock', 'completeness', 'updatedAt'],
  );
  const productTableColumns = [
    {
      id: 'sku',
      header: 'SKU',
      widthClass: 'w-[8%]',
      render: (product: ProductAsset) => <div className={`px-4 py-3 font-light whitespace-nowrap ${productTableCellBorderClass}`}>{product.sku}</div>,
    },
    {
      id: 'name',
      header: '名称',
      widthClass: 'w-[16%]',
      render: (product: ProductAsset) => (
        <div className="px-4 py-3 min-w-[180px]">
          <div className={`font-light ${isDarkMode ? 'text-white/85' : 'text-slate-900'}`}>{product.name}</div>
          <div className={`${isDarkMode ? 'text-white/30' : 'text-slate-400'} mt-1`}>{product.status}</div>
        </div>
      ),
    },
    {
      id: 'articleNo',
      header: selectedMain === 'Garment' ? '款号' : selectedMain === 'Trimmings' ? '辅料编号' : 'Article',
      widthClass: 'w-[9%]',
      render: (product: ProductAsset) => <div className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{productCodeText(product) || '未填'}</div>,
    },
    {
      id: 'millQuality',
      header: selectedMain === 'Garment' ? '品类' : selectedMain === 'Trimmings' ? '辅料类别' : 'Mill Quality',
      widthClass: 'w-[10%]',
      render: (product: ProductAsset) => <div className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{productCategoryText(product)}</div>,
    },
    {
      id: 'millOrg',
      header: selectedMain === 'Garment' ? '工厂' : '供应商',
      widthClass: 'w-[12%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 min-w-[140px]">{productSupplierText(product)}</div>,
    },
    {
      id: 'clientCode',
      header: selectedMain === 'Garment' ? '客户' : selectedMain === 'Trimmings' ? '客户/品牌' : 'Client Code',
      widthClass: 'w-[12%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 min-w-[140px]">{productCustomerText(product)}</div>,
    },
    {
      id: 'factoryPrice',
      header: selectedMain === 'Garment' ? '目标成本' : selectedMain === 'Trimmings' ? '单价' : '工厂价',
      widthClass: 'w-[8%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 whitespace-nowrap">{productFactoryPriceText(product)}</div>,
    },
    {
      id: 'salesPrice',
      header: selectedMain === 'Garment' ? 'FOB' : selectedMain === 'Trimmings' ? '单位' : '售价',
      widthClass: 'w-[8%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 whitespace-nowrap">{productSalesPriceText(product)}</div>,
    },
    {
      id: 'stock',
      header: selectedMain === 'Garment' ? '颜色/尺码' : selectedMain === 'Trimmings' ? '库存' : '库存',
      widthClass: 'w-[11%]',
      render: (product: ProductAsset) => (
        <div className="px-4 py-3 whitespace-nowrap">
          {productStockText(product)}
        </div>
      ),
    },
    {
      id: 'completeness',
      header: '补全',
      widthClass: 'w-[11%]',
      render: (product: ProductAsset) => (
        <div className="px-4 py-3 min-w-[140px]">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-light ${productStatusChipClass(productCompleteness(product).complete)}`}>
            {productCompleteness(product).complete ? <CheckCircle2 size={12} strokeWidth={1.5} /> : <AlertTriangle size={12} strokeWidth={1.5} />}
            {productCompleteness(product).complete ? '完整' : `缺 ${productCompleteness(product).missing.length} 项`}
          </span>
          {!productCompleteness(product).complete && (
            <div className={`mt-1 text-[10px] truncate ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
              {productCompleteness(product).missing.slice(0, 2).join('、')}
              {productCompleteness(product).missing.length > 2 ? '…' : ''}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'updatedAt',
      header: '更新时间',
      widthClass: 'w-[8%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 whitespace-nowrap">{new Date(product.updatedAt).toLocaleDateString()}</div>,
    },
  ].filter(column => enabledProductTableColumnIds.has(column.id));

  const renderClassificationTabBar = (embedded = false) => {
    return (
      <CompiledInteractiveCard
        spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
        spotlightSize={isDarkMode ? PRODUCT_TOOLBAR_SPOTLIGHT_DARK_SIZE : PRODUCT_TOOLBAR_SPOTLIGHT_LIGHT_SIZE}
        liquidSpotlight
        liquidSpotlightTone={isDarkMode ? 'dark' : 'light'}
        idleSpotlightOpacity={0}
        activeSpotlightOpacity={1}
        className={`${embedded ? 'w-full max-w-[620px]' : 'shrink-0 mx-8 mt-1'} ${PRODUCT_TOOLBAR_CLASS} ${productToolbarSurfaceClass}`}
      >
        <span className={PRODUCT_TOOLBAR_AMBIENT_CLASS} aria-hidden="true" />
        <div className={PRODUCT_TOOLBAR_CONTENT_CLASS}>
        <span className={`relative z-10 px-2 text-[10px] font-light tracking-[0.18em] uppercase ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
          筛选
        </span>
        <CompiledSelectControl
          value={classificationView}
          onChange={(value) => {
            setClassificationView(value as ClassificationView);
            if (navLevel === 'list') setNavLevel('sub');
            setSelectedSubId(null);
          }}
          options={classificationViews.map(view => ({ value: view.id, label: view.label }))}
          isDarkMode={isDarkMode}
          size="compact"
          surface="toolbar"
          triggerVariant="inline"
          menuPortal
          className="relative z-20 w-[148px] shrink-0"
        />
        </div>
      </CompiledInteractiveCard>
    );
  };

  const renderProductListToolbar = (embedded = false) => (
    <CompiledInteractiveCard
      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
      spotlightSize={isDarkMode ? PRODUCT_TOOLBAR_SPOTLIGHT_DARK_SIZE : PRODUCT_TOOLBAR_SPOTLIGHT_LIGHT_SIZE}
      liquidSpotlight
      liquidSpotlightTone={isDarkMode ? 'dark' : 'light'}
      idleSpotlightOpacity={0}
      activeSpotlightOpacity={1}
      className={`${embedded ? 'w-full max-w-[620px]' : 'shrink-0 mx-8 mt-1'} ${PRODUCT_TOOLBAR_CLASS} ${productToolbarSurfaceClass}`}
    >
      <span className={PRODUCT_TOOLBAR_AMBIENT_CLASS} aria-hidden="true" />
      <div className={PRODUCT_TOOLBAR_CONTENT_CLASS}>
      <div className="relative h-9 min-w-0 flex-1">
        <Search className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} size={14} />
        <input
          placeholder="搜索 SKU、款名..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className={`h-9 w-full rounded-control border pl-10 pr-3 outline-none font-light text-xs ${isDarkMode ? PRODUCT_TOOLBAR_SEARCH_DARK_CLASS : PRODUCT_TOOLBAR_SEARCH_LIGHT_CLASS}`}
        />
      </div>

      <div className="w-[170px] shrink-0">
        <CompiledSelectControl
          value={productSortValue}
          onChange={(value) => {
            const next = productSortOptions.find(option => option.value === value);
            if (next) setTableSort({ column: next.column, desc: next.desc });
          }}
          options={productSortOptions.map(option => ({ value: option.value, label: option.label }))}
          isDarkMode={isDarkMode}
          size="compact"
          surface="toolbar"
          triggerVariant="inline"
          menuPortal
        />
      </div>

      <div className="ml-auto flex h-9 shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setListDisplayMode(listDisplayMode === 'grid' ? 'table' : 'grid')}
          className={`${PRODUCT_SEGMENT_BUTTON_CLASS} ${isDarkMode ? 'text-slate-50 opacity-100 drop-shadow-none' : 'text-[var(--os-vnext-brand-blue)] opacity-100 drop-shadow-none'}`}
          aria-label={listDisplayMode === 'grid' ? '切换到表格视图' : '切换到格子视图'}
        >
          {listDisplayMode === 'grid' ? (
            <List size={13} strokeWidth={1.5} />
          ) : (
            <LayoutGrid size={13} strokeWidth={1.5} />
          )}
        </button>
      </div>
      </div>
    </CompiledInteractiveCard>
  );

  const renderFabricProfileFields = (product?: ProductAsset | null) => {
    if (!isFabricFormContext && product?.mainCategory !== 'Fabric') return null;
    const profile = product?.fabricProfile;

    return (
      <>
        <ProductFormSection id="specs" title="规格参数" description="沉淀面料识别、规格、组织和生产周期，用于后续样品、大货、报价引用。" isDarkMode={isDarkMode}>
          <div className="space-y-2">
            <label className={productLabelClass}>供应商 / 生产工厂</label>
            <input defaultValue={profile?.millOrganizationId || ''} name="millOrganizationId" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>Mill Quality</label>
            <input defaultValue={profile?.millQuality || ''} name="millQuality" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>Col.</label>
            <input defaultValue={profile?.millColorCode || ''} name="millColorCode" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>Description</label>
            <input defaultValue={profile?.colorDescription || ''} name="colorDescription" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>组织</label>
            <input defaultValue={profile?.construction || ''} name="construction" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>纱支</label>
            <input defaultValue={profile?.yarnCount || ''} name="yarnCount" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>花型</label>
            <input defaultValue={profile?.pattern || ''} name="pattern" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>标样批号</label>
            <input defaultValue={profile?.referenceBatch || ''} name="referenceBatch" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>生产周期（天）</label>
            <input defaultValue={profile?.productionLeadDays ?? ''} type="number" name="productionLeadDays" className={productInputClass} />
          </div>
        </ProductFormSection>

        <ProductFormSection id="pricing" title="价格库存" description="把客户代码、价格口径和库存状态作为可对比字段录入。" isDarkMode={isDarkMode}>
          <div className="space-y-2">
            <label className={productLabelClass}>Client Code（逗号/换行分隔）</label>
            <input defaultValue={(product?.fabricCustomerCodes || []).map(item => item.clientCode).join(', ')} name="clientCodes" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>工厂价格</label>
            <input defaultValue={latestPrice(product || {} as ProductAsset, 'factory')?.amount ?? ''} type="number" step="0.01" name="factoryPrice" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>售价（大货）</label>
            <input defaultValue={latestPrice(product || {} as ProductAsset, 'customer')?.amount ?? ''} type="number" step="0.01" name="salesPrice" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>样品价</label>
            <input defaultValue={latestPrice(product || {} as ProductAsset, 'sample')?.amount ?? ''} type="number" step="0.01" name="samplePrice" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>零剪价</label>
            <input defaultValue={latestPrice(product || {} as ProductAsset, 'cutting')?.amount ?? ''} type="number" step="0.01" name="cuttingPrice" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>价格币种</label>
            <input defaultValue={latestPrice(product || {} as ProductAsset, 'factory')?.currency || latestPrice(product || {} as ProductAsset, 'customer')?.currency || 'USD'} name="priceCurrency" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>价格单位</label>
            <input defaultValue={latestPrice(product || {} as ProductAsset, 'factory')?.unit || latestPrice(product || {} as ProductAsset, 'customer')?.unit || 'm'} name="priceUnit" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>现货状态</label>
            <input defaultValue={profile?.stockStatus || ''} name="stockStatus" placeholder="现货 / 开发中 / 常备" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>现货数量</label>
            <div className="grid grid-cols-[1fr,96px] gap-2">
              <input defaultValue={profile?.stockQuantity ?? ''} type="number" step="0.01" name="stockQuantity" className={productInputClass} />
              <input defaultValue={profile?.stockUnit || 'm'} name="stockUnit" className={productInputClass} />
            </div>
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>起订量</label>
            <input defaultValue={profile?.moqValue ?? ''} type="number" step="0.01" name="moqValue" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>工厂起订量</label>
            <input defaultValue={profile?.factoryMoqValue ?? ''} type="number" step="0.01" name="factoryMoqValue" className={productInputClass} />
          </div>
          <div className="space-y-2">
            <label className={productLabelClass}>试样起订量</label>
            <input defaultValue={profile?.sampleMoqValue ?? ''} type="number" step="0.01" name="sampleMoqValue" className={productInputClass} />
          </div>
        </ProductFormSection>

        <ProductFormSection id="risk" title="认证风险" description="集中记录认证、禁用风险、质量稳定性等会影响报价和接单判断的信息。" isDarkMode={isDarkMode}>
          <div className="md:col-span-2 space-y-2">
            <label className={productLabelClass}>相关认证许可</label>
            <CertificationCheckboxes
              product={product ?? null}
              isDarkMode={isDarkMode}
              onChange={() => {}}
            />
          </div>
          <div className="md:col-span-2 space-y-2">
            <label className={productLabelClass}>品质风险</label>
            <textarea defaultValue={profile?.riskNote || ''} name="riskNote" rows={3} className={productTextareaClass} />
          </div>
        </ProductFormSection>

	        <ProductFormSection id="notes" title="备注" description="放不进结构字段、但业务上需要保留的补充说明。" isDarkMode={isDarkMode}>
	          <div className="md:col-span-2 space-y-2">
	            <label className={productLabelClass}>特殊备注</label>
	            <textarea defaultValue={profile?.specialNote || ''} name="specialNote" rows={4} className={productTextareaClass} />
	          </div>
	        </ProductFormSection>
      </>
    );
  };

  const renderGarmentProfileFields = (product?: ProductAsset | null) => {
    if (!isGarmentFormContext && product?.mainCategory !== 'Garment') return null;
    const profile = product?.garmentProfile;
    const TextField = ({ label, name, value, placeholder }: { label: string; name: string; value?: string | null; placeholder?: string }) => (
      <div className="space-y-2">
        <label className={productLabelClass}>{label}</label>
        <input defaultValue={value || ''} name={name} placeholder={placeholder} className={productInputClass} />
      </div>
    );
    const TextAreaField = ({ label, name, value, rows = 3, wide = true, placeholder }: { label: string; name: string; value?: string | null; rows?: number; wide?: boolean; placeholder?: string }) => (
      <div className={`${wide ? 'md:col-span-2' : ''} space-y-2`}>
        <label className={productLabelClass}>{label}</label>
        <textarea defaultValue={value || ''} name={name} rows={rows} placeholder={placeholder} className={productTextareaClass} />
      </div>
    );

    return (
      <>
        <ProductFormSection id="garmentConstruction" title="成衣结构" description="记录这件衣服的廓形、版型、部件结构和缝制工艺。" isDarkMode={isDarkMode}>
          <TextField label="廓形" name="silhouette" value={profile?.silhouette} placeholder="例如 Single Breasted Jacket" />
          <TextField label="版型" name="fit" value={profile?.fit} placeholder="Slim / Regular / Relaxed" />
          <TextField label="领型" name="collarType" value={profile?.collarType} />
          <TextField label="袖型" name="sleeveType" value={profile?.sleeveType} />
          <TextField label="门襟 / 开合方式" name="closureType" value={profile?.closureType} />
          <TextField label="口袋结构" name="pocketDetails" value={profile?.pocketDetails} />
          <TextField label="下摆" name="hemDetails" value={profile?.hemDetails} />
          <TextField label="腰头 / 袖口 / 裤脚" name="waistbandDetails" value={profile?.waistbandDetails} />
          <TextField label="里布结构" name="liningStructure" value={profile?.liningStructure} placeholder="全里 / 半里 / 无里" />
          <TextField label="衬布" name="interlining" value={profile?.interlining} />
          <TextField label="垫肩 / 胸衬" name="shoulderPad" value={profile?.shoulderPad} />
          <TextField label="缝制工艺" name="stitchDetails" value={profile?.stitchDetails} />
          <TextAreaField label="结构备注" name="constructionNote" value={profile?.constructionNote} />
        </ProductFormSection>

        <ProductFormSection id="garmentMaterials" title="材料 BOM" description="关联或记录主面料、配布、辅料、包装和材料用量。" isDarkMode={isDarkMode}>
          <TextField label="主面料" name="mainFabric" value={profile?.mainFabric} />
          <TextField label="配布 / 撞色布" name="contrastFabric" value={profile?.contrastFabric} />
          <TextField label="里布" name="liningFabric" value={profile?.liningFabric} />
          <TextField label="罗纹 / 腰里" name="ribFabric" value={profile?.ribFabric} />
          <TextField label="口袋布" name="pocketingFabric" value={profile?.pocketingFabric} />
          <TextField label="扣子" name="button" value={profile?.button} />
          <TextField label="拉链" name="zipper" value={profile?.zipper} />
          <TextField label="按扣 / 鸡眼 / 绳扣" name="snapsEyelets" value={profile?.snapsEyelets} />
          <TextField label="线" name="thread" value={profile?.thread} />
          <TextField label="商标 / 洗标 / 吊牌" name="labelTrims" value={profile?.labelTrims} />
          <TextField label="包装材料" name="packaging" value={profile?.packaging} />
          <TextAreaField label="材料用量 / 部位 / 颜色 / 供应商" name="materialUsage" value={profile?.materialUsage} />
          <TextAreaField label="替代材料" name="substituteMaterials" value={profile?.substituteMaterials} />
        </ProductFormSection>

        <ProductFormSection id="garmentSizing" title="尺码与量体" description="记录尺码范围、基准码、测量点、公差、放码和缩率预留。" isDarkMode={isDarkMode}>
          <TextField label="尺码范围" name="sizeRange" value={profile?.sizeRange} placeholder="XS-XXL / 38-52 / Custom" />
          <TextField label="基准码" name="baseSize" value={profile?.baseSize} />
          <TextField label="成衣重量" name="garmentWeight" value={profile?.garmentWeight} />
          <TextField label="缩率预留" name="shrinkageAllowance" value={profile?.shrinkageAllowance} />
          <TextAreaField label="POM 测量点" name="measurementPoints" value={profile?.measurementPoints} placeholder="胸围、肩宽、衣长、袖长..." />
          <TextAreaField label="尺码表" name="sizeSpec" value={profile?.sizeSpec} rows={4} />
          <TextAreaField label="公差" name="tolerance" value={profile?.tolerance} />
          <TextAreaField label="放码规则" name="gradingRule" value={profile?.gradingRule} />
        </ProductFormSection>

        <ProductFormSection id="garmentColors" title="颜色与 SKU" description="记录颜色组、客户色号、面料色号、条码、可用尺码和 MOQ。" isDarkMode={isDarkMode}>
          <TextField label="颜色组" name="colorways" value={profile?.colorways} />
          <TextField label="客户色号" name="customerColorCodes" value={profile?.customerColorCodes} />
          <TextField label="面料色号" name="fabricColorCodes" value={profile?.fabricColorCodes} />
          <TextField label="成衣 SKU" name="garmentSku" value={profile?.garmentSku} />
          <TextField label="条码" name="barcode" value={profile?.barcode} />
          <TextField label="可用尺码" name="availableSizes" value={profile?.availableSizes} />
          <TextField label="MOQ / 起订量" name="moq" value={profile?.moq} />
          <TextAreaField label="颜色图片备注" name="colorImageNotes" value={profile?.colorImageNotes} />
        </ProductFormSection>

        <ProductFormSection id="garmentDevelopment" title="开发与版本" description="记录样衣版本、试身意见、客户批注、负责人和技术包版本。" isDarkMode={isDarkMode}>
          <TextField label="样衣版本号" name="sampleVersion" value={profile?.sampleVersion} />
          <TextField label="版师" name="patternMaker" value={profile?.patternMaker} />
          <TextField label="跟单" name="merchandiser" value={profile?.merchandiser} />
          <TextField label="负责人" name="owner" value={profile?.owner} />
          <TextField label="确认日期" name="confirmedDate" value={profile?.confirmedDate} placeholder="YYYY-MM-DD" />
          <TextField label="技术包版本" name="techPackVersion" value={profile?.techPackVersion} />
          <TextAreaField label="修改记录" name="revisionHistory" value={profile?.revisionHistory} rows={4} />
          <TextAreaField label="试身意见" name="fittingComments" value={profile?.fittingComments} />
          <TextAreaField label="客户批注意见" name="customerComments" value={profile?.customerComments} />
        </ProductFormSection>

        <ProductFormSection id="garmentProduction" title="生产、质量、商业" description="记录工厂、数量、交期、价格、检验标准、合规测试和包装方式。" isDarkMode={isDarkMode}>
          <TextField label="工厂" name="factory" value={profile?.factory} />
          <TextField label="订单数量" name="orderQuantity" value={profile?.orderQuantity} />
          <TextField label="交期" name="deliveryDate" value={profile?.deliveryDate} />
          <TextField label="目标成本" name="targetCost" value={profile?.targetCost} />
          <TextField label="FOB" name="fobPrice" value={profile?.fobPrice} />
          <TextField label="EXW" name="exwPrice" value={profile?.exwPrice} />
          <TextField label="Retail" name="retailPrice" value={profile?.retailPrice} />
          <TextField label="原产国" name="countryOfOrigin" value={profile?.countryOfOrigin} />
          <TextAreaField label="检验标准" name="inspectionStandard" value={profile?.inspectionStandard} />
          <TextAreaField label="常见疵点" name="commonDefects" value={profile?.commonDefects} />
          <TextAreaField label="洗水 / 后整理" name="washFinishing" value={profile?.washFinishing} />
          <TextAreaField label="洗标内容" name="careLabel" value={profile?.careLabel} />
          <TextAreaField label="合规测试" name="complianceTests" value={profile?.complianceTests} />
          <TextAreaField label="包装方式" name="packingMethod" value={profile?.packingMethod} />
          <TextAreaField label="箱规" name="cartonSpec" value={profile?.cartonSpec} />
          <TextAreaField label="质量备注" name="qualityNote" value={profile?.qualityNote} />
        </ProductFormSection>
      </>
    );
  };

  const renderTrimmingProfileFields = (product?: ProductAsset | null) => {
    if (!isTrimmingFormContext && product?.mainCategory !== 'Trimmings') return null;
    const profile = product?.trimmingProfile;
    const TextField = ({ label, name, value, placeholder }: { label: string; name: string; value?: string | number | null; placeholder?: string }) => (
      <div className="space-y-2">
        <label className={productLabelClass}>{label}</label>
        <input defaultValue={value ?? ''} name={name} placeholder={placeholder} className={productInputClass} />
      </div>
    );
    const TextAreaField = ({ label, name, value, rows = 3, wide = true, placeholder }: { label: string; name: string; value?: string | null; rows?: number; wide?: boolean; placeholder?: string }) => (
      <div className={`${wide ? 'md:col-span-2' : ''} space-y-2`}>
        <label className={productLabelClass}>{label}</label>
        <textarea defaultValue={value || ''} name={name} rows={rows} placeholder={placeholder} className={productTextareaClass} />
      </div>
    );

    return (
      <>
        <ProductFormSection id="trimmingSpecs" title="规格材质" description="记录辅料材质、规格、尺寸、颜色、表面处理和使用部位。" isDarkMode={isDarkMode}>
          <TextField label="材质" name="material" value={profile?.material} placeholder="树脂 / 金属 / 聚酯 / 棉 / 无纺" />
          <TextField label="规格" name="specification" value={profile?.specification} placeholder="四眼 / YKK 3# / 30D / 2cm" />
          <TextField label="尺寸" name="size" value={profile?.size} />
          <TextField label="颜色" name="color" value={profile?.color} />
          <TextField label="色号" name="colorCode" value={profile?.colorCode} />
          <TextField label="表面处理" name="finish" value={profile?.finish} placeholder="哑光 / 亮面 / 电镀 / 烫金" />
          <TextField label="使用部位" name="usagePosition" value={profile?.usagePosition} placeholder="前门襟、袖口、腰头、内里、包装" />
        </ProductFormSection>

        <ProductFormSection id="trimmingSupply" title="供应采购" description="记录供应来源、采购单位、单件用量、起订量、交期、库存和单价。" isDarkMode={isDarkMode}>
          <TextField label="供应商" name="supplier" value={profile?.supplier} />
          <TextField label="工厂" name="factory" value={profile?.factory} />
          <TextField label="采购单位" name="unit" value={profile?.unit} placeholder="pcs / m / roll / set" />
          <TextField label="单件用量" name="unitConsumption" value={profile?.unitConsumption} placeholder="6 pcs / garment" />
          <TextField label="MOQ" name="moq" value={profile?.moq} />
          <TextField label="交期" name="leadTime" value={profile?.leadTime} placeholder="7 天 / 2 周" />
          <TextField label="库存状态" name="stockStatus" value={profile?.stockStatus} />
          <div className="space-y-2">
            <label className={productLabelClass}>库存数量</label>
            <div className="grid grid-cols-[1fr,96px] gap-2">
              <input defaultValue={profile?.stockQuantity ?? ''} type="number" step="0.01" name="stockQuantity" className={productInputClass} />
              <input defaultValue={profile?.stockUnit || profile?.unit || 'pcs'} name="stockUnit" className={productInputClass} />
            </div>
          </div>
          <TextField label="单价" name="price" value={profile?.price} />
          <TextField label="币种" name="currency" value={profile?.currency || 'USD'} />
        </ProductFormSection>

        <ProductFormSection id="trimmingQuality" title="质量合规" description="记录测试要求、质量标准、风险、包装和洗护限制。" isDarkMode={isDarkMode}>
          <TextAreaField label="合规测试" name="complianceTests" value={profile?.complianceTests} placeholder="OEKO-TEX、REACH、Nickel Free、色牢度..." />
          <TextAreaField label="质量标准" name="qualityStandard" value={profile?.qualityStandard} />
          <TextAreaField label="风险备注" name="riskNote" value={profile?.riskNote} />
          <TextAreaField label="包装方式" name="packaging" value={profile?.packaging} />
          <TextAreaField label="洗护要求" name="careRequirement" value={profile?.careRequirement} />
        </ProductFormSection>

        <ProductFormSection id="notes" title="备注" description="放不进结构字段、但业务上需要保留的辅料补充说明。" isDarkMode={isDarkMode}>
          <TextAreaField label="特殊备注" name="notes" value={profile?.notes} rows={4} />
        </ProductFormSection>
      </>
    );
  };

  const handleAddSub = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedMain) return;
    const formData = new FormData(e.currentTarget);
    const newItem: ProductSubCategory = {
      id: `CAT-${Date.now().toString().slice(-6)}`,
      mainCategory: selectedMain,
      name: formData.get('name') as string,
      description: String(formData.get('description') || '').trim() || undefined,
      updatedAt: Date.now()
    };
    setProductWriteError('');
    try {
      ensureOnlineWrite();
      await apiService.saveProductCategory(newItem, cloudEndpoint);
      onUpdateCategories([newItem, ...productCategories], newItem);
      setshowAddSubModal(false);
    } catch (error: any) {
      setProductWriteError(error?.message || String(error));
    }
  };

  const handleEditSub = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingSub) return;
    const formData = new FormData(e.currentTarget);
    const updated = {
      ...editingSub,
      name: formData.get('name') as string,
      description: String(formData.get('description') || '').trim() || undefined,
      updatedAt: Date.now(),
    };
    setProductWriteError('');
    try {
      ensureOnlineWrite();
      await apiService.saveProductCategory(updated, cloudEndpoint);
      onUpdateCategories(productCategories.map(c => c.id === updated.id ? updated : c), updated);
      setEditingSub(null);
    } catch (error: any) {
      setProductWriteError(error?.message || String(error));
    }
  };

  const handleDeleteSub = async () => {
    if (!deleteSubId) return;
    const target = productCategories.find(c => c.id === deleteSubId);
    if (target) {
      const tombstone = { ...target, deletedAt: Date.now() };
      setProductWriteError('');
      try {
        ensureOnlineWrite();
        await apiService.deleteProductCategory(tombstone, cloudEndpoint);
        onUpdateCategories(productCategories.map(c => c.id === deleteSubId ? tombstone : c), tombstone);
        setDeleteSubId(null);
      } catch (error: any) {
        setProductWriteError(error?.message || String(error));
      }
      return;
    }
    setDeleteSubId(null);
  };

  const handleAddProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedMain || !selectedSubId) return;
    if (!validateCompositionBeforeSave()) return;
    const formData = new FormData(e.currentTarget);
	    const id = `PROD-${Date.now().toString().slice(-6)}`;
	    const fabricProfile = buildFabricProfileFromForm(formData);
	    const garmentProfile = buildGarmentProfileFromForm(formData);
	    const trimmingProfile = buildTrimmingProfileFromForm(formData);
	    const sku = String(formData.get('sku') || '').trim();
	    const articleNo = String(formData.get('articleNo') || '').trim();
	    const productName = String(formData.get('productName') || '').trim();
	    const styleNo = String(formData.get('styleNo') || '').trim();
	    const fallbackName = String(formData.get('name') || '').trim();
	    const trimmingName = String(formData.get('trimmingName') || fallbackName).trim();
	    const trimmingCode = String(formData.get('trimmingCode') || '').trim();
	    const subCategoryId = selectedSubId === ALL_PRODUCTS_CATEGORY_ID || selectedSubId === UNCATEGORIZED_CATEGORY_ID
	      ? 'uncategorized'
	      : selectedSubId;
	    const newItem: ProductAsset = {
	      id,
	      sku,
	      name: selectedMain === 'Garment'
	        ? (productName || styleNo || sku)
	        : selectedMain === 'Trimmings'
	          ? (trimmingName || trimmingCode || sku)
	          : (articleNo || sku),
	      mainCategory: selectedMain,
	      subCategoryId,
	      season: String(formData.get('season') || formData.get('collection') || '').trim(),
	      cost: Number(formData.get('cost') || String(formData.get('targetCost') || '').replace(/[^\d.]/g, '') || 0),
	      status: (String(formData.get('status') || '') as ProductAsset['status']) || (selectedMain === 'Garment' ? '开发样' : 'Development'),
	      updatedAt: Date.now(),
	      fabricProfile: fabricProfile ? { ...fabricProfile, productAssetId: id } : undefined,
	      garmentProfile: garmentProfile ? { ...garmentProfile, productAssetId: id } : undefined,
	      trimmingProfile: trimmingProfile ? { ...trimmingProfile, productAssetId: id } : undefined,
	    };
    Object.assign(newItem, buildFabricRelatedDataFromForm(formData, id));
    const payload = { ...newItem, fabricProfile: newItem.fabricProfile || undefined, garmentProfile: newItem.garmentProfile || undefined, trimmingProfile: newItem.trimmingProfile || undefined };
    setProductWriteError('');
    try {
      ensureOnlineWrite();
      const persisted = await apiService.createProductAsset(payload as any, cloudEndpoint);
      onUpdateProducts([persisted, ...products], persisted);
      setShowAddProdModal(false);
    } catch (error: any) {
      setProductWriteError(error?.message || String(error));
    }
  };

  const handleEditProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProd) return;
    if (!validateCompositionBeforeSave()) return;
	    const formData = new FormData(e.currentTarget);
	    const sku = String(formData.get('sku') || editingProd.sku).trim();
	    const articleNo = String(formData.get('articleNo') || editingProd.fabricProfile?.articleNo || '').trim();
	    const productName = String(formData.get('productName') || editingProd.garmentProfile?.productName || '').trim();
	    const styleNo = String(formData.get('styleNo') || editingProd.garmentProfile?.styleNo || '').trim();
	    const fallbackName = String(formData.get('name') || editingProd.name || '').trim();
	    const trimmingName = String(formData.get('trimmingName') || editingProd.trimmingProfile?.trimmingName || fallbackName).trim();
	    const trimmingCode = String(formData.get('trimmingCode') || editingProd.trimmingProfile?.trimmingCode || '').trim();
	    const updated: ProductAsset = {
	      ...editingProd,
	      sku,
	      name: editingProd.mainCategory === 'Garment'
	        ? (productName || styleNo || sku)
	        : editingProd.mainCategory === 'Trimmings'
	          ? (trimmingName || trimmingCode || sku)
	          : (articleNo || sku),
	      season: String(formData.get('season') || formData.get('collection') || editingProd.season || '').trim(),
	      cost: Number(formData.get('cost') || String(formData.get('targetCost') || '').replace(/[^\d.]/g, '') || editingProd.cost || 0),
	      status: (String(formData.get('status') || '') as ProductAsset['status']) || editingProd.status || (editingProd.mainCategory === 'Garment' ? '开发样' : 'Development'),
	      updatedAt: Date.now(),
	    };
    const fabricProfile = buildFabricProfileFromForm(formData, updated);
	    if (fabricProfile) {
	      updated.fabricProfile = { ...fabricProfile, productAssetId: updated.id };
	    }
	    const garmentProfile = buildGarmentProfileFromForm(formData, updated);
	    if (garmentProfile) {
	      updated.garmentProfile = { ...garmentProfile, productAssetId: updated.id };
	    }
	    const trimmingProfile = buildTrimmingProfileFromForm(formData, updated);
	    if (trimmingProfile) {
	      updated.trimmingProfile = { ...trimmingProfile, productAssetId: updated.id };
	    }
	    Object.assign(updated, buildFabricRelatedDataFromForm(formData, updated.id, updated));
    const payload = {
      sku: updated.sku,
      name: updated.name,
      mainCategory: updated.mainCategory,
      subCategoryId: updated.subCategoryId,
      season: updated.season,
      cost: updated.cost,
	      status: updated.status,
	      fabricProfile: updated.fabricProfile || undefined,
	      garmentProfile: updated.garmentProfile || undefined,
	      trimmingProfile: updated.trimmingProfile || undefined,
	      fabricCustomerCodes: updated.fabricCustomerCodes,
      fabricCertifications: updated.fabricCertifications,
      fabricPrices: updated.fabricPrices,
      compositionLines: updated.compositionLines,
    };
    setProductWriteError('');
    try {
      ensureOnlineWrite();
      const persisted = await apiService.updateProductAsset(updated.id, payload, cloudEndpoint);
      onUpdateProducts(products.map(p => p.id === persisted.id ? persisted : p), persisted);
      setEditingProd(null);
    } catch (error: any) {
      setProductWriteError(error?.message || String(error));
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteProdId) return;
    const target = products.find(p => p.id === deleteProdId);
    if (target) {
      const tombstone = { ...target, deletedAt: Date.now() };
      setProductWriteError('');
      try {
        ensureOnlineWrite();
        await apiService.deleteProductAsset(deleteProdId, cloudEndpoint);
        onUpdateProducts(products.map(p => p.id === deleteProdId ? tombstone : p), tombstone);
        setDeleteProdId(null);
        setEditingProd(null);
        setShowAddProdModal(false);
      } catch (error: any) {
        setProductWriteError(error?.message || String(error));
      }
      return;
    }
    setDeleteProdId(null);
  };

  const pdmlRawValue = (row: PdmlRawFabric, key: string) => String(row.rawData?.[key] ?? '').trim();

  const hideUnderlyingProductPage = fullscreenProductFormOpen;
  const productContentCanvasClass = isMobile ? 'w-full' : BAMBOOK_OS.layout.desktopPageCanvasClass;

  return (
    <div
      data-os-compiler-template={blueprint.template}
      data-os-compiler-source={blueprint.source}
      data-os-compiler-provenance={blueprint.provenance}
      data-os-compiler-role="products-manager-full-contract"
      data-os-compiler-edge-fade-source="PRODUCT_EDGE_FADE_*"
      className="w-full h-full flex flex-col bg-transparent overflow-visible"
    >
      {/* Primary Header - fixed, transparent title/navigation system. */}
      <PageHeader
        title="数字档案"
        subtitle="Digital Archive"
        isDarkMode={isDarkMode}
        hidden={hideUnderlyingProductPage}
        breadcrumb={(
          <div className="flex items-center gap-1.5 min-w-0">
            {navLevel !== 'main' && (
              <CompiledInteractiveCard
                spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                spotlightSize={isDarkMode ? 180 : 140}
                idleSpotlightOpacity={0}
                activeSpotlightOpacity={1}
                className={`${PRODUCT_TITLE_ICON_BUTTON_CLASS} ${productActionButtonClass}`}
              >
              <button
                onClick={() => {
                  if (navLevel === 'list') {
                    setNavLevel('sub');
                    setSelectedSubId(id => (id === ALL_PRODUCTS_CATEGORY_ID ? null : id));
                  } else {
                    setNavLevel('main');
                  }
                }}
                data-ui-lab-wallpaper-contrast="primary"
                className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center"
                aria-label="返回上一级"
              >
                <ChevronLeft size={18} strokeWidth={1} />
              </button>
              </CompiledInteractiveCard>
            )}
            {selectedMain && (
              <div className={`h-9 flex items-center gap-1.5 min-w-0 text-[11px] font-light tracking-wide ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
                <span data-ui-lab-wallpaper-contrast="secondary" className={PRODUCT_TITLE_SEPARATOR_CLASS}>
                  <ChevronRight size={18} strokeWidth={1.4} />
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNavLevel('sub');
                    setSelectedSubId(null);
                    setSearchTerm('');
                  }}
                  data-ui-lab-wallpaper-contrast="primary"
                  className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} bg-transparent border-0 p-0 rounded-none shadow-none transition-colors ${isDarkMode ? 'text-white/70 hover:text-white' : 'text-slate-700 hover:text-[var(--os-vnext-brand-blue)]'}`}
                >
                  {mainCategories.find(c => c.id === selectedMain)?.label}
                </button>
                {(navLevel === 'list' || navLevel === 'detail') && selectedSubId && (
                  <>
                    <span data-ui-lab-wallpaper-contrast="secondary" className={PRODUCT_TITLE_SEPARATOR_CLASS}>
                      <ChevronRight size={18} strokeWidth={1.4} />
                    </span>
                    {navLevel === 'detail' ? (
                      <button
                        type="button"
                        onClick={() => { setNavLevel('list'); setSelectedProduct(null); }}
                        data-ui-lab-wallpaper-contrast="primary"
                        className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} bg-transparent border-0 p-0 rounded-none shadow-none transition-colors ${isDarkMode ? 'text-white/70 hover:text-white' : 'text-slate-700 hover:text-[var(--os-vnext-brand-blue)]'}`}
                      >
                        {selectedSubId === ALL_PRODUCTS_CATEGORY_ID
                          ? '全部档案'
                          : categoryGroups.find(group => group.id === selectedSubId)?.name || '列表'}
                      </button>
                    ) : (
                      <span data-ui-lab-wallpaper-contrast="primary" className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} ${isDarkMode ? 'text-white/70' : 'text-slate-700'}`}>
                        {selectedSubId === ALL_PRODUCTS_CATEGORY_ID
                          ? '全部档案'
                          : categoryGroups.find(group => group.id === selectedSubId)?.name || '列表'}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        center={(
        <>
          {navLevel === 'sub' && renderClassificationTabBar(true)}
          {navLevel === 'list' && renderProductListToolbar(true)}
        </>
        )}
        actions={(
        <>
          {productWriteError && (
            <div className={`max-w-[280px] truncate text-[11px] font-light ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>
              {productWriteError}
            </div>
          )}
          {navLevel === 'list' && isPdmlRawView && (
            <>
              <CompiledInteractiveCard
                spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                spotlightSize={isDarkMode ? 180 : 140}
                idleSpotlightOpacity={0}
                activeSpotlightOpacity={1}
                className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass}`}
              >
                <button
                  onClick={handleSyncPdmlRawFabrics}
                  disabled={pdmlRawSyncing || pdmlRawMapping}
                  data-ui-lab-wallpaper-contrast="primary"
                  className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2 disabled:opacity-55"
                >
                  <RefreshCw size={14} strokeWidth={1} className={pdmlRawSyncing ? 'animate-spin' : ''} /> 同步庞大
                </button>
              </CompiledInteractiveCard>
              <CompiledInteractiveCard
                spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                spotlightSize={isDarkMode ? 180 : 140}
                idleSpotlightOpacity={0}
                activeSpotlightOpacity={1}
                className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass}`}
              >
                <button
                  onClick={handleMapPdmlRawFabrics}
                  disabled={pdmlRawSyncing || pdmlRawMapping || pdmlRawTotal === 0}
                  data-ui-lab-wallpaper-contrast="primary"
                  className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2 disabled:opacity-55"
                >
                  <RefreshCw size={14} strokeWidth={1} className={pdmlRawMapping ? 'animate-spin' : ''} /> 映射入档案
                </button>
              </CompiledInteractiveCard>
            </>
          )}
          {navLevel === 'list' && !isPdmlRawView && (
            <CompiledInteractiveCard
              spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
              spotlightSize={isDarkMode ? 180 : 140}
              idleSpotlightOpacity={0}
              activeSpotlightOpacity={1}
              className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass}`}
            >
              <button onClick={() => setShowAddProdModal(true)} data-ui-lab-wallpaper-contrast="primary" className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2">
                <Plus size={14} strokeWidth={1} /> 录入档案
              </button>
            </CompiledInteractiveCard>
          )}
        </>
        )}
      />

      <div className={`${productContentCanvasClass} flex-1 flex flex-col min-h-0 overflow-visible ${hideUnderlyingProductPage ? 'hidden' : ''}`}>
        {navLevel === 'main' && (
          <div className="relative h-full overflow-hidden">
          <CompiledCollectionCardGrid
            profile="category"
            isMobile={isMobile}
            overlapTitleBar={!isMobile}
            paddingClassName={isMobile ? 'px-3 pt-5 pb-28' : 'px-5 pt-[104px] pb-5'}
            layout
            ref={mainCategoryScrollRef}
            transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION }}
          >
            {mainCategories.map((cat, idx) => (
              <CompiledMotionInteractiveCard
                as="button"
                type="button"
                layout
                key={cat.id}
                onClick={() => { setSelectedMain(cat.id); setNavLevel('sub'); }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4, transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] } }}
                transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION, delay: idx * 0.05 }}
                spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                spotlightSize={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_SIZE : PRODUCT_CARD_SPOTLIGHT_LIGHT_SIZE}
                idleSpotlightOpacity={0}
                liquidSpotlight
                liquidSpotlightTone="light"
                className={`group relative isolate overflow-hidden ${isMobile ? 'p-4 h-[190px] rounded-inset' : 'p-6 h-[220px] rounded-card-lg'} flex flex-col items-start text-left transition-colors duration-200 ${productCardClass}`}
                data-glass-edge-mask
              >
                <div className={`relative z-10 -ml-1 -mt-1 ${isMobile ? 'mb-3 flex h-9 w-9' : 'mb-4 flex h-10 w-10'} items-center justify-center transition-colors duration-300 ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)] group-hover:text-slate-100' : 'text-[var(--os-vnext-brand-blue)]'}`}>
                  <cat.icon size={24} strokeWidth={1} />
                </div>

                <h3 className={`relative z-10 ${isMobile ? 'text-sm' : 'text-base'} font-light tracking-tight ${isDarkMode ? 'text-white/90' : 'text-slate-900'}`}>
                  {cat.label}
                </h3>
                <p className={`relative z-10 ${isMobile ? 'text-[10px] line-clamp-2' : 'text-[12px] line-clamp-3'} mt-2 font-light leading-relaxed ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
                  {cat.desc}
                </p>

                <div className={`relative z-10 mt-auto flex items-center gap-2 pt-4 border-t w-full ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/50'}`}>
                  <span className={`text-[9px] font-light tracking-wide flex items-center gap-1.5 ${isDarkMode ? 'text-white/40' : 'text-slate-400'}`}>
                    <Library size={12} strokeWidth={1.5} className={isDarkMode ? 'text-[var(--os-vnext-brand-blue-soft)]' : 'text-[var(--os-vnext-brand-blue-strong)]'} />
                    {products.filter(p => p.mainCategory === cat.id && !p.deletedAt).length} SKU 档案
                  </span>
                </div>
              </CompiledMotionInteractiveCard>
            ))}
          </CompiledCollectionCardGrid>
          </div>
        )}

        {navLevel === 'sub' && (
          <CompiledTableShell
            isDarkMode={isDarkMode}
            scrollRef={subIndexScrollRef}
            shellBaseClassName={`${isMobile ? 'h-full overflow-visible px-3 pb-24 pt-5' : BAMBOOK_OS.layout.desktopTablePanelShellCompactClass} flex-1 min-h-0 flex flex-col`}
            panelClassName={`${productGlassPanelClass} overflow-hidden flex h-full min-h-0 flex-col`}
            scrollClassName={`${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-full-bleed-row-viewport`}
            edgeFade={{
              topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT,
              topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START,
              bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
            }}
            header={(
              <div className={`hidden md:grid shrink-0 grid-cols-[minmax(0,1.35fr)_120px_minmax(180px,0.9fr)_108px] items-center gap-5 border-b px-6 py-3 text-[10px] font-light tracking-wide ${isDarkMode ? 'border-white/[0.06] text-white/35' : 'border-white/50 text-slate-400'}`}>
                <span>索引</span>
                <span>档案</span>
                <span>摘要</span>
                <span className="text-right">操作</span>
              </div>
            )}
          >
                {categoryGroups.length === 0 && (
                  <div className={`flex min-h-[360px] flex-col items-center justify-center px-6 text-center ${productMutedTextClass}`}>
                    <Archive size={34} strokeWidth={1} className={isDarkMode ? 'text-white/30' : 'text-slate-400'} />
                    <div className={`mt-4 text-sm font-light ${isDarkMode ? 'text-white/70' : 'text-slate-700'}`}>当前分类暂无索引</div>
                    <div className="mt-2 max-w-sm text-xs font-light leading-relaxed">
                      这个主类目还没有子分类或可分组档案。请前往数字档案模块设置管理分类，或返回选择有数据的类目。
                    </div>
                  </div>
                )}
                {categoryGroups.map((group, idx) => {
                const editableCategory = classificationView === 'category'
                  ? currentSubCategories.find(category => category.id === group.id)
                  : null;
                const ratio = selectedMainProducts.length > 0
                  ? Math.round((group.count / selectedMainProducts.length) * 100)
                  : 0;
                return (
                  <CompiledMotionInteractiveCard
                    as="div"
                    role="button"
                    tabIndex={0}
                    layout
                    key={`${classificationView}-${group.id}`}
                    onClick={() => { setSelectedSubId(group.id); setNavLevel('list'); }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setSelectedSubId(group.id);
                      setNavLevel('list');
                    }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -1, transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] } }}
                    transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION, delay: idx * 0.03 }}
                    spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                    spotlightSize={isDarkMode ? 360 : 280}
                    idleSpotlightOpacity={0}
                    liquidSpotlight
                    liquidSpotlightTone="light"
                    className={`group relative isolate cursor-pointer overflow-hidden ${PRODUCT_SUB_INDEX_ROW_CLASS} px-4 py-0 text-left transition-[background,box-shadow,color,transform] duration-200 ${isDarkMode ? 'border-white/[0.045] hover:bg-white/[0.035]' : 'border-white/45 hover:bg-white/28'}`}
                    data-glass-edge-mask
                  >
                    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1.35fr)_120px_minmax(180px,0.9fr)_108px] md:gap-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center transition-colors duration-300 ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)] group-hover:text-slate-100' : 'text-[var(--os-vnext-brand-blue)]'}`}>
                          {group.id === UNCATEGORIZED_CATEGORY_ID
                            ? <Archive size={20} strokeWidth={1} />
                            : <LayoutGrid size={20} strokeWidth={1} />
                          }
                        </div>
                        <div className="min-w-0">
                          <h4 className={`truncate text-sm font-light ${isDarkMode ? 'text-white/90' : 'text-slate-900'}`}>{group.name}</h4>
                          <p className={`mt-1 truncate text-[10px] font-light md:hidden ${isDarkMode ? 'text-white/45' : 'text-slate-500'}`}>{group.description}</p>
                        </div>
                      </div>

                      <div className="hidden md:flex min-w-0 flex-col gap-1">
                        <span className={`text-sm font-light ${isDarkMode ? 'text-white/82' : 'text-slate-900'}`}>{group.count}</span>
                        <div className={`h-1 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-white/[0.055]' : 'bg-white/45'}`}>
                          <span
                            className={`block h-full rounded-full ${isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/55' : 'bg-[var(--os-vnext-brand-blue)]/45'}`}
                            style={{ width: `${Math.min(100, Math.max(4, ratio))}%` }}
                          />
                        </div>
                      </div>

                      <p className={`hidden md:block min-w-0 truncate text-xs font-light ${isDarkMode ? 'text-white/45' : 'text-slate-500'}`}>
                        {group.description}
                      </p>

                      <div className="flex items-center justify-end gap-1">
                        <span className={`md:hidden text-xs font-light ${isDarkMode ? 'text-white/70' : 'text-slate-700'}`}>{group.count}</span>
                        {editableCategory && (
                          <>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingSub(editableCategory);
                              }}
                              className={`flex h-8 w-8 items-center justify-center rounded-control transition-all ${productActionButtonClass} ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                              aria-label={`编辑${group.name}`}
                            >
                              <Edit2 size={13} strokeWidth={1.4} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteSubId(editableCategory.id);
                              }}
                              className={`flex h-8 w-8 items-center justify-center rounded-control transition-all ${productActionButtonClass} ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                              aria-label={`删除${group.name}`}
                            >
                              <Trash2 size={13} strokeWidth={1.4} />
                            </button>
                          </>
                        )}
                        <ChevronRight size={16} strokeWidth={1.4} className={isDarkMode ? 'text-white/32' : 'text-slate-400'} />
                      </div>
                    </div>
                  </CompiledMotionInteractiveCard>
                );
              })}
          </CompiledTableShell>
        )}

        {navLevel === 'list' && (
          <div className="flex-1 min-h-0 flex flex-col">
            {isPdmlRawView ? (
              <div className={BAMBOOK_OS.layout.desktopTablePanelShellClass}>
                <div className={`flex h-full min-h-0 w-full flex-col rounded-card border overflow-hidden ${productGlassPanelClass}`}>
                  <div className={`shrink-0 px-6 py-4 border-b ${isDarkMode ? 'border-white/[0.055]' : 'border-white/40'}`}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className={`text-sm font-light ${isDarkMode ? 'text-white/86' : 'text-slate-900'}`}>庞大面料原始缓存</div>
                        <div className={`mt-1 text-[11px] font-light ${productMutedTextClass}`}>
                          {pdmlRawLoading && pdmlRawFabrics.length === 0 ? '读取中' : `已加载 ${pdmlRawFabrics.length} / ${pdmlRawTotal || pdmlRawFabrics.length} 条缓存记录`}
                          {pdmlRawSyncedAt ? ` · 最近同步 ${new Date(pdmlRawSyncedAt).toLocaleString()}` : ''}
                        </div>
                      </div>
                      {pdmlRawError && (
                        <div className={`max-w-[420px] truncate text-[11px] font-light ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>
                          {pdmlRawError}
                        </div>
                      )}
                    </div>
                  </div>
                  <CompiledEdgeFade
                    scrollRef={pdmlRawScrollRef}
                    isDarkMode={isDarkMode}
                    variant="normal"
                    renderMode="content-mask"
                    source="CompiledProductsPage.pdmlRawTable.edgeFade"
                    topHeight={PRODUCT_EDGE_FADE_TOP_HEIGHT}
                    topFadeStartOffset={PRODUCT_EDGE_FADE_TOP_START}
                    bottomHeight={PRODUCT_EDGE_FADE_BOTTOM_HEIGHT}
                  />
                  <div ref={pdmlRawScrollRef} className="flex-1 min-h-0 overflow-y-auto">
                    <table className="w-full table-fixed border-separate border-spacing-0 text-left text-xs">
                      <colgroup>
                        <col className="w-[10%]" />
                        <col className="w-[12%]" />
                        <col className="w-[11%]" />
                        <col className="w-[12%]" />
                        <col className="w-[10%]" />
                        <col className="w-[18%]" />
                        <col className="w-[8%]" />
                        <col className="w-[8%]" />
                        <col className="w-[7%]" />
                        <col className="w-[4%]" />
                      </colgroup>
                      <thead className={`${productTableHeaderClass} ${isDarkMode ? 'text-white/40' : 'text-slate-400'}`}>
                        <tr>
                          {['条码', '公司品号', '工厂品号', '供应商', '系列', '成份', '克重', '门幅', '登记', '状态'].map(header => (
                            <th key={header} className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} tracking-wide whitespace-nowrap ${productTableCellBorderClass}`}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode ? 'divide-white/[0.045]' : 'divide-white/28'}`}>
                        {currentPdmlRawFabrics.map(row => (
                          <tr key={row.id} className={`transition-[background,box-shadow] ${productTableRowHoverClass}`}>
                            <td className={`px-4 py-3 font-light whitespace-nowrap ${productTableCellBorderClass}`}>{row.sourceId}</td>
                            <td className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{row.articleNo || '未填'}</td>
                            <td className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{row.factoryArticleNo || '未填'}</td>
                            <td className="px-4 py-3 truncate">{row.supplierName || '未填'}</td>
                            <td className="px-4 py-3 truncate">{row.productLine || '未填'}</td>
                            <td className={`px-4 py-3 truncate ${productMutedTextClass}`}>{pdmlRawValue(row, 'CF') || '未填'}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{[pdmlRawValue(row, 'KZ'), pdmlRawValue(row, 'KZDW')].filter(Boolean).join(' ') || '未填'}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{[pdmlRawValue(row, 'FK'), pdmlRawValue(row, 'FKDW')].filter(Boolean).join(' ') || '未填'}</td>
                            <td className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{row.registeredDate || '未填'}</td>
                            <td className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{row.sourceStatus || '未填'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!pdmlRawLoading && currentPdmlRawFabrics.length === 0 && (
                      <div className={`p-12 text-center text-sm ${productMutedTextClass}`}>暂无庞大原始缓存，点击右上角同步庞大。</div>
                    )}
                    {pdmlRawHasMore && currentPdmlRawFabrics.length > 0 && (
                      <div className="px-4 py-5 flex justify-center">
                        <button
                          type="button"
                          onClick={() => loadPdmlRawFabrics(searchTerm, 'append')}
                          disabled={pdmlRawLoading}
                          className={`h-9 px-5 rounded-control border text-xs font-light transition-all disabled:opacity-55 ${productActionButtonClass}`}
                        >
                          {pdmlRawLoading ? '加载中' : `加载更多 ${Math.min(PDML_RAW_PAGE_SIZE, Math.max((pdmlRawTotal || 0) - pdmlRawFabrics.length, 0))} 条`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : listDisplayMode === 'grid' ? (
              <div className="relative flex-1 min-h-0 overflow-visible">
              <CompiledCollectionCardGrid
                profile="record"
                paddingClassName="p-8"
                layout
                ref={productGridScrollRef}
                transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION }}
              >
                <AnimatePresence>
                  {currentProducts.map((product, idx) => (
                    <CompiledMotionInteractiveCard
                      as="button"
                      type="button"
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      whileHover={{ y: -4, transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] } }}
                      transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION, delay: idx * 0.02 }}
                      key={product.id}
                      onClick={() => { setSelectedProduct(product); setNavLevel('detail'); }}
                      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                      spotlightSize={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_SIZE : PRODUCT_CARD_SPOTLIGHT_LIGHT_SIZE}
                      idleSpotlightOpacity={0}
                      liquidSpotlight
                      liquidSpotlightTone="light"
                      className={`group relative isolate overflow-hidden p-6 h-[220px] rounded-card-lg text-left transition-colors duration-200 ${productCardClass}`}
                      data-glass-edge-mask
                    >
                      <div className="relative z-10 flex justify-between items-start mb-3">
                        <div className={`-ml-1 -mt-1 flex h-10 w-10 items-center justify-center transition-colors duration-300 ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)] group-hover:text-slate-100' : 'text-[var(--os-vnext-brand-blue)]'}`}>
                          <Library size={22} strokeWidth={1} />
                        </div>
                        <span className={`px-2.5 py-1 rounded-full border text-[9px] font-light tracking-wide ${productStatusChipClass(productCompleteness(product).complete)}`}>
                          {productCompleteness(product).complete ? '完整' : `待补 ${productCompleteness(product).missing.length}`}
                        </span>
                      </div>

                      <h3 className={`relative z-10 text-base font-light line-clamp-1 ${isDarkMode ? 'text-white/90' : 'text-slate-900'}`}>
                        {product.name}
                      </h3>
	                      <p className={`relative z-10 text-xs font-light mt-1 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
	                        {productCodeText(product)}
	                      </p>

                      <div className="relative z-10 mt-3 space-y-1.5 flex-1 min-h-0">
                        <div className={`flex items-center gap-2 text-xs font-light ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
	                          <Tag size={12} strokeWidth={1.5} className={isDarkMode ? 'text-white/30' : 'text-slate-400'} />
	                          <span className="truncate">{productCategoryText(product)}</span>
                        </div>
                        <div className={`flex items-center gap-2 text-xs font-light ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
                          <Box size={12} strokeWidth={1.5} className={isDarkMode ? 'text-white/30' : 'text-slate-400'} />
	                          <span className="truncate">{productSupplierText(product)}</span>
                        </div>
                      </div>

                      <div className={`relative z-10 mt-auto pt-3 border-t flex items-center justify-between gap-3 ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/50'}`}>
                        <span className={`min-w-0 truncate text-[9px] font-light ${productMutedTextClass}`}>
	                          {productCustomerText(product)}
                        </span>
                        <span className={`shrink-0 text-[9px] font-light ${isDarkMode ? 'text-white/46' : 'text-slate-400'}`}>
	                          {productFactoryPriceText(product)}
                        </span>
                      </div>
                    </CompiledMotionInteractiveCard>
                  ))}
                </AnimatePresence>
                {currentProducts.length === 0 && (
                  <div className={`col-span-full flex min-h-[360px] flex-col items-center justify-center px-6 text-center ${productMutedTextClass}`}>
                    <Archive size={34} strokeWidth={1} className={isDarkMode ? 'text-white/30' : 'text-slate-400'} />
                    <div className={`mt-4 text-sm font-light ${isDarkMode ? 'text-white/70' : 'text-slate-700'}`}>当前视图下暂无档案</div>
                    <div className="mt-2 max-w-sm text-xs font-light leading-relaxed">
                      可以调整筛选、切换分类方式，或点击右上角录入档案。
                    </div>
                  </div>
                )}
              </CompiledCollectionCardGrid>
              </div>
            ) : (
              <CompiledTableShell
                isDarkMode={isDarkMode}
                scrollRef={productTableScrollRef}
                panelClassName={productGlassPanelClass}
                edgeFade={blueprint.edgeFade}
                header={(
                  <div className="shrink-0 overflow-hidden">
                    <div className={`flex w-full min-w-[1000px] text-left text-xs ${productTableHeaderClass} ${isDarkMode ? 'text-white/40' : 'text-slate-400'}`}>
                      {productTableColumns.map(column => (
                        <div key={column.id} className={`${column.widthClass} px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} tracking-wide whitespace-nowrap ${productTableCellBorderClass}`}>{column.header}</div>
                      ))}
                      <div className={`w-[8%] px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} tracking-wide whitespace-nowrap ${productTableCellBorderClass}`}>操作</div>
                    </div>
                  </div>
                )}
                empty={currentProducts.length === 0 && (
                  <div className={`p-12 text-center text-sm ${productMutedTextClass}`}>当前视图下暂无档案</div>
                )}
              >
                    <div className={`flex flex-col min-w-[1000px] text-left text-xs divide-y ${isDarkMode ? 'divide-white/[0.045]' : 'divide-white/28'}`}>
                      {currentProducts.map((product, idx) => (
                        <CompiledMotionInteractiveCard
                          as="div"
                          key={product.id}
                          onClick={() => { setSelectedProduct(product); setNavLevel('detail'); }}
                          spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                          spotlightSize={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_SIZE : PRODUCT_CARD_SPOTLIGHT_LIGHT_SIZE}
                          idleSpotlightOpacity={0}
                          liquidSpotlight
                          liquidSpotlightTone="light"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          whileHover={{ y: -1, transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] } }}
                          transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION, delay: idx * 0.02 }}
                          className={`flex w-full relative isolate overflow-hidden cursor-pointer transition-[background,box-shadow,color,transform] duration-200 ${productTableRowHoverClass}`}
                          data-glass-edge-mask
                        >
                          {productTableColumns.map(column => (
                            <div key={column.id} className={`${column.widthClass} relative z-10 flex flex-col justify-center`}>
                               {column.render(product)}
                            </div>
                          ))}
                          <div className="w-[8%] px-4 py-3 relative z-10 flex flex-col justify-center">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setEditingProd(product); }}
                                className={`p-2 rounded-full ${isDarkMode ? BAMBOOK_OS.controls.table.editActionDark : BAMBOOK_OS.controls.table.editActionLight}`}
                                aria-label="编辑档案"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDeleteProdId(product.id); }}
                                className={`p-2 rounded-full ${isDarkMode ? BAMBOOK_OS.controls.table.editActionDark : BAMBOOK_OS.controls.table.editActionLight}`}
                                aria-label="归档档案"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </CompiledMotionInteractiveCard>
                      ))}
                    </div>
              </CompiledTableShell>
            )}
          </div>
        )}
      
        {navLevel === 'detail' && selectedProduct && (
        <div className={`h-full w-full min-h-0 flex overflow-visible relative ${isMobile ? 'pb-24' : 'bambook-main-panel-bottom-inset'}`}>
          {/* 左侧产品列表面板 */}
          <div className={`${BAMBOOK_OS.layout.relationsDetailListShellClass} hidden md:block`}>
            <CompiledSurfacePanel
              isDarkMode={isDarkMode}
              className={BAMBOOK_OS.layout.relationsDetailListPanelClass}
              contentClassName="relative z-10 flex min-h-0 flex-1 flex-col"
              compilerRole="detail-sidebar-panel"
              source="CompiledProductsPage.detail-sidebar"
            >
              <div className="px-4 pt-4 pb-3 shrink-0">
                <div className="mb-3 flex items-center justify-between">
                  <p className={`text-[10px] font-light uppercase tracking-[0.2em] ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}>
                    {!selectedMain ? '全部产品' : (PRODUCT_MAIN_CATEGORY_DEFINITIONS.find(c => c.id === selectedMain)?.label || '产品列表')}
                  </p>
                  <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/38' : 'text-slate-500'}`}>
                    {sidebarProducts.length} 项
                  </span>
                </div>
                
                <div className="flex items-center">
                  <div className="relative flex-1 min-w-0">
                    <Search
                      size={14}
                      strokeWidth={1.5}
                      className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}
                    />
                    <input
                      type="text"
                      placeholder="搜索目录..."
                      value={sideSearchTerm}
                      onChange={(e) => setSideSearchTerm(e.target.value)}
                      className={`w-full h-9 pl-9 pr-[4.35rem] rounded-control text-xs font-light border outline-none transition-all ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}
                    />
                    {sideSearchTerm && (
                      <button onClick={() => setSideSearchTerm('')} className={`absolute right-8 top-0 z-10 grid h-9 w-7 place-items-center p-0 leading-none transition-colors ${isDarkMode ? 'text-white/40 hover:text-white/70' : 'text-slate-400 hover:text-slate-600'}`}>
                        <X size={12} strokeWidth={1.5} className="block" />
                      </button>
                    )}
                    <button
                      onClick={() => setSideSortOption(prev => prev === 'recent' ? 'name' : 'recent')}
                      title={sideSortOption === 'recent' ? '按名称排序' : '按近期更新排序'}
                      className={`absolute right-1 top-1/2 z-10 grid h-8 w-7 -translate-y-1/2 place-items-center rounded-full p-0 leading-none transition-colors ${isDarkMode ? 'text-white/48 hover:bg-white/10 hover:text-white/72' : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-700'}`}
                    >
                      {sideSortOption === 'recent' ? <Clock size={13} className="block" /> : <ArrowDownAZ size={13} className="block" />}
                    </button>
                  </div>
                </div>
              </div>
              <CompiledEdgeFade
                scrollRef={productDetailSidebarScrollRef}
                isDarkMode={isDarkMode}
                renderMode="content-mask"
                source="CompiledProductsPage.productDetailSidebar.edgeFade"
                topHeight={40}
                bottomHeight={52}
              />
              <div
                ref={productDetailSidebarScrollRef}
                data-os-compiler-role="product-detail-sidebar-scroll"
                className={`bambook-product-detail-sidebar-scroll-viewport flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1 bambook-scrollbar ${BAMBOOK_OS.layout.panelShadowViewportClass}`}
              >
                {sidebarProducts.map((p) => {
                  const isSelected = p.id === selectedProduct.id;
                  const displayImages = getDisplayImages(p);
                  const thumb = displayImages[0] ? getProductImageSrc(displayImages[0]) : null;
                  const ProductAvatarIcon = PRODUCT_MAIN_CATEGORY_DEFINITIONS.find(category => category.id === p.mainCategory)?.icon || Box;
                  
                  const activeClass = isDarkMode ? SIDEBAR_ACTIVE_DARK_CLASS : SIDEBAR_ACTIVE_LIGHT_CLASS;
                  const hoverClass = isDarkMode ? SIDEBAR_HOVER_DARK_CLASS : SIDEBAR_HOVER_LIGHT_CLASS;
                  const pressClass = isDarkMode ? SIDEBAR_PRESS_DARK_CLASS : SIDEBAR_PRESS_LIGHT_CLASS;
                  
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProduct(p)}
                      className={`w-full px-3 py-2.5 flex items-center gap-3 transition-[color,transform] duration-[320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] relative isolate overflow-visible rounded-control 
                        ${isSelected ? activeClass : `${hoverClass} ${pressClass}`}`}
                    >
                      {/* OS-level active shadow indicator if selected */}
                      {isSelected && (
                        <div className={`absolute inset-0 z-0 pointer-events-none rounded-control ${activeClass}`} />
                      )}
                      
                      {thumb ? (
                        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-white/10 relative z-10">
                          <img src={thumb} alt={p.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div
                          className={`relative z-10 h-8 w-8 shrink-0 overflow-hidden rounded-full ${isDarkMode ? 'bg-[var(--os-vnext-brand-blue)]/14 text-[var(--os-vnext-brand-blue-soft)] shadow-none' : 'bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue-strong)] shadow-none'}`}
                          aria-label={`${p.name} 产品头像`}
                        >
                          <div className="grid h-full w-full place-items-center rounded-full">
                            <ProductAvatarIcon size={14} strokeWidth={1.45} className="block" />
                          </div>
                          <div className={`pointer-events-none absolute inset-0 rounded-full ring-1 ${isDarkMode ? 'ring-white/[0.10]' : 'ring-white/45'}`} />
                          <div className={`pointer-events-none absolute inset-0 rounded-full ${isDarkMode ? BAMBOOK_OS.material.panelSurfaceDark : BAMBOOK_OS.material.panelSurfaceLight} opacity-55 mix-blend-soft-light`} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-left relative z-10">
	                        <p className={`font-light text-sm truncate ${isSelected ? (isDarkMode ? 'text-white' : 'text-slate-700') : (isDarkMode ? 'text-slate-300' : 'text-slate-700')}`}>{productCodeText(p) || p.name}</p>
                        <p className={`text-[10px] font-light uppercase tracking-wider truncate ${isSelected ? (isDarkMode ? 'text-white/60' : 'text-slate-700/60') : (isDarkMode ? 'text-slate-500' : 'text-slate-500')}`}>{p.sku}</p>
                      </div>
                      {isSelected && <ChevronRight size={14} className={`relative z-10 ${isDarkMode ? BAMBOOK_OS.tone.text.brandDark : BAMBOOK_OS.tone.text.brandLight}`} />}
                    </button>
                  );
                })}
              </div>
            </CompiledSurfacePanel>
          </div>

          <div className={BAMBOOK_OS.layout.relationsDetailMainShellClass}>
            <CompiledDetailShell
              isDarkMode={isDarkMode}
              className={`h-full flex flex-col rounded-card shadow-none overflow-hidden ${isDarkMode ? OS_MATERIAL.raisedCard : OS_MATERIAL.raisedCard}`}
              contentClassName="relative z-10 flex min-h-0 flex-1 flex-col"
              role="product-detail-panel"
              source="CompiledProductsPage.product-detail-panel"
            >
              {/* 1. Header (模仿 Relations DetailPanel) */}
              <div className={`shrink-0 px-6 py-5 flex items-center justify-between border-b ${isDarkMode ? BAMBOOK_OS.tone.divider.panelDark : BAMBOOK_OS.tone.divider.panelLight}`}>
                <div className="flex items-center gap-4 min-w-0">
                  <button
                    onClick={() => setSelectedProduct(null)}
                    className={`shrink-0 w-8 h-8 rounded-control flex items-center justify-center transition-colors ${isDarkMode ? 'text-white/60 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-200'}`}
                  >
                    <ChevronLeft size={18} strokeWidth={1.5} />
                  </button>
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <Library size={22} strokeWidth={1.5} className={isDarkMode ? BAMBOOK_OS.tone.text.brandDark : BAMBOOK_OS.tone.text.brandLight} />
                    <h2 className={`text-lg font-light truncate ${isDarkMode ? 'text-white/95' : 'text-slate-900'}`}>
                      {selectedProduct.name}
                    </h2>
                    <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-light tracking-wide ${productStatusChipClass(selectedProduct.status === 'Active')}`}>
                      {selectedProduct.status}
                    </span>
                    <span className={`text-xs font-light ${isDarkMode ? 'text-white/45' : 'text-slate-500'}`}>
                      {selectedProduct.sku}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setEditingProd(selectedProduct); setSelectedProduct(null); }}
                    className={`h-8 px-4 rounded-full border text-xs font-light flex items-center justify-center transition-colors ${isDarkMode ? BAMBOOK_OS.controls.actionControl.borderedDark : BAMBOOK_OS.controls.actionControl.borderedLight}`}
                  >
                    <Edit2 size={13} className="mr-1.5" /> 编辑
                  </button>
                </div>
              </div>

              {/* 2. Scrollable Body */}
              <CompiledEdgeFade
                scrollRef={productDetailBodyScrollRef}
                isDarkMode={isDarkMode}
                renderMode="content-mask"
                source="CompiledProductsPage.productDetailBody.edgeFade"
                topHeight={56}
                bottomHeight={72}
              />
              <div
                ref={productDetailBodyScrollRef}
                data-os-compiler-role="product-detail-body-scroll"
                className={`flex-1 min-h-0 overflow-y-auto px-6 py-8 bambook-scrollbar ${BAMBOOK_OS.layout.panelShadowViewportClass}`}
              >
                <div className="max-w-[720px] mx-auto space-y-6">
                  
                  {/* 图片相册区域 (Image Gallery) */}
                  {(() => {
                    const displayImages = getDisplayImages(selectedProduct);
                    if (displayImages.length === 0) {
                      return (
                        <div className="w-full flex gap-3 pb-4">
                          <div className={`w-[320px] h-[320px] sm:w-[360px] sm:h-[360px] rounded-card border border-dashed flex flex-col items-center justify-center gap-4 ${isDarkMode ? 'border-white/20 text-white/30 bg-white/[0.02]' : 'border-slate-300 text-slate-400 bg-slate-50/50'}`}>
                            <ImageIcon size={48} strokeWidth={1} />
                            <div className="text-sm font-light tracking-wide">暂无产品图片</div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="w-full flex gap-4 overflow-x-auto pb-6 snap-x hide-scrollbar">
                        {displayImages.map((img, idx) => {
                          const src = getProductImageSrc(img);
                          return (
                            <div key={img.id} className={`shrink-0 snap-start ${idx === 0 ? 'w-[320px] h-[320px] sm:w-[360px] sm:h-[360px]' : 'w-[200px] h-[200px] mt-auto'} rounded-card overflow-hidden border shadow-none ${isDarkMode ? 'border-white/10' : 'border-slate-200/60'} ${OS_MATERIAL.insetSurface}`}>
                              {src && <img src={src} className="w-full h-full object-cover transition-transform hover:scale-105 duration-300" alt={img.fileName || 'Product Image'} />}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* 完成度状态 (Completeness Status) */}
                  {(selectedProduct.mainCategory === 'Fabric' || selectedProduct.mainCategory === 'Garment' || selectedProduct.mainCategory === 'Trimmings') && (
                    <div className={`rounded-inset p-5 ${OS_MATERIAL.insetSurface} ${isDarkMode ? BAMBOOK_OS.tone.surface.linkedPanelDark : BAMBOOK_OS.tone.surface.linkedPanelLight}`}>
                      <div className={`text-xs font-light flex items-center gap-2 ${productCompleteness(selectedProduct).complete ? (isDarkMode ? 'text-[var(--os-vnext-brand-blue-soft)]' : 'text-[var(--os-vnext-brand-blue-strong)]') : (isDarkMode ? 'text-white/40' : 'text-slate-400')}`}>
                        {productCompleteness(selectedProduct).complete ? <CheckCircle2 size={16} strokeWidth={1.5} /> : <AlertTriangle size={16} strokeWidth={1.5} />}
                        {productCompleteness(selectedProduct).complete ? '核心档案信息已完整' : `核心档案待补全：缺 ${productCompleteness(selectedProduct).missing.length} 项`}
                      </div>
                      <div className={`mt-4 h-1.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`}>
                        <div
                          className="h-full rounded-full bg-[var(--os-vnext-brand-blue)]"
                          style={{ width: `${productCompleteness(selectedProduct).percent}%` }}
                        />
                      </div>
                      {!productCompleteness(selectedProduct).complete && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {productCompleteness(selectedProduct).missing.map(label => (
                            <span key={label} className={`px-2.5 py-1 rounded-full border text-[10px] font-light ${isDarkMode ? BAMBOOK_OS.tone.chip.subtleDark : BAMBOOK_OS.tone.chip.subtleLight}`}>
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

	                  {/* 信息区域 (Detail Sections) */}
	                  {selectedProduct.mainCategory === 'Garment' ? (
	                    <>
	                      <DetailSection title="基础身份" icon={<Tag size={14} />}>
	                        <DetailItem label="SKU" value={selectedProduct.sku} />
	                        <DetailItem label="款号" value={selectedProduct.garmentProfile?.styleNo} />
	                        <DetailItem label="成衣名称" value={selectedProduct.garmentProfile?.productName || selectedProduct.name} />
	                        <DetailItem label="品类" value={selectedProduct.garmentProfile?.garmentCategory} />
	                        <DetailItem label="系列" value={selectedProduct.garmentProfile?.collection || selectedProduct.season} />
	                        <DetailItem label="客户" value={selectedProduct.garmentProfile?.customer} />
	                        <DetailItem label="品牌" value={selectedProduct.garmentProfile?.brand} />
	                        <DetailItem label="项目" value={selectedProduct.garmentProfile?.project} />
	                        <DetailItem label="性别 / 年龄段" value={[selectedProduct.garmentProfile?.gender, selectedProduct.garmentProfile?.ageGroup].filter(Boolean).join(' / ')} />
	                        <DetailItem label="标签" value={selectedProduct.garmentProfile?.tags} wide />
	                      </DetailSection>
	                      <DetailSection title="成衣结构" icon={<Shirt size={14} />}>
	                        <DetailItem label="廓形" value={selectedProduct.garmentProfile?.silhouette} />
	                        <DetailItem label="版型" value={selectedProduct.garmentProfile?.fit} />
	                        <DetailItem label="领型" value={selectedProduct.garmentProfile?.collarType} />
	                        <DetailItem label="袖型" value={selectedProduct.garmentProfile?.sleeveType} />
	                        <DetailItem label="门襟 / 开合" value={selectedProduct.garmentProfile?.closureType} />
	                        <DetailItem label="口袋" value={selectedProduct.garmentProfile?.pocketDetails} />
	                        <DetailItem label="下摆" value={selectedProduct.garmentProfile?.hemDetails} />
	                        <DetailItem label="腰头 / 袖口 / 裤脚" value={selectedProduct.garmentProfile?.waistbandDetails} />
	                        <DetailItem label="里布结构" value={selectedProduct.garmentProfile?.liningStructure} />
	                        <DetailItem label="衬布 / 垫肩" value={[selectedProduct.garmentProfile?.interlining, selectedProduct.garmentProfile?.shoulderPad].filter(Boolean).join(' / ')} />
	                        <DetailItem label="缝制工艺" value={selectedProduct.garmentProfile?.stitchDetails} wide />
	                        <DetailItem label="结构备注" value={selectedProduct.garmentProfile?.constructionNote} wide />
	                      </DetailSection>
	                      <DetailSection title="材料 BOM" icon={<Layers size={14} />}>
	                        <DetailItem label="主面料" value={selectedProduct.garmentProfile?.mainFabric} />
	                        <DetailItem label="配布" value={selectedProduct.garmentProfile?.contrastFabric} />
	                        <DetailItem label="里布" value={selectedProduct.garmentProfile?.liningFabric} />
	                        <DetailItem label="罗纹 / 腰里" value={selectedProduct.garmentProfile?.ribFabric} />
	                        <DetailItem label="口袋布" value={selectedProduct.garmentProfile?.pocketingFabric} />
	                        <DetailItem label="扣子 / 拉链" value={[selectedProduct.garmentProfile?.button, selectedProduct.garmentProfile?.zipper].filter(Boolean).join(' / ')} />
	                        <DetailItem label="小五金 / 线" value={[selectedProduct.garmentProfile?.snapsEyelets, selectedProduct.garmentProfile?.thread].filter(Boolean).join(' / ')} />
	                        <DetailItem label="商标 / 包装" value={[selectedProduct.garmentProfile?.labelTrims, selectedProduct.garmentProfile?.packaging].filter(Boolean).join(' / ')} />
	                        <DetailItem label="材料用量" value={selectedProduct.garmentProfile?.materialUsage} wide />
	                        <DetailItem label="替代材料" value={selectedProduct.garmentProfile?.substituteMaterials} wide />
	                      </DetailSection>
	                      <DetailSection title="尺码与颜色" icon={<FileText size={14} />}>
	                        <DetailItem label="尺码范围" value={selectedProduct.garmentProfile?.sizeRange} />
	                        <DetailItem label="基准码" value={selectedProduct.garmentProfile?.baseSize} />
	                        <DetailItem label="成衣重量" value={selectedProduct.garmentProfile?.garmentWeight} />
	                        <DetailItem label="缩率预留" value={selectedProduct.garmentProfile?.shrinkageAllowance} />
	                        <DetailItem label="POM 测量点" value={selectedProduct.garmentProfile?.measurementPoints} wide />
	                        <DetailItem label="尺码表" value={selectedProduct.garmentProfile?.sizeSpec} wide />
	                        <DetailItem label="公差" value={selectedProduct.garmentProfile?.tolerance} />
	                        <DetailItem label="放码规则" value={selectedProduct.garmentProfile?.gradingRule} />
	                        <DetailItem label="颜色组" value={selectedProduct.garmentProfile?.colorways} />
	                        <DetailItem label="客户色号" value={selectedProduct.garmentProfile?.customerColorCodes} />
	                        <DetailItem label="面料色号" value={selectedProduct.garmentProfile?.fabricColorCodes} />
	                        <DetailItem label="成衣 SKU / 条码" value={[selectedProduct.garmentProfile?.garmentSku, selectedProduct.garmentProfile?.barcode].filter(Boolean).join(' / ')} />
	                        <DetailItem label="可用尺码 / MOQ" value={[selectedProduct.garmentProfile?.availableSizes, selectedProduct.garmentProfile?.moq].filter(Boolean).join(' / ')} />
	                        <DetailItem label="颜色图片备注" value={selectedProduct.garmentProfile?.colorImageNotes} wide />
	                      </DetailSection>
	                      <DetailSection title="开发与版本" icon={<Clock size={14} />}>
	                        <DetailItem label="样衣版本号" value={selectedProduct.garmentProfile?.sampleVersion} />
	                        <DetailItem label="版师" value={selectedProduct.garmentProfile?.patternMaker} />
	                        <DetailItem label="跟单" value={selectedProduct.garmentProfile?.merchandiser} />
	                        <DetailItem label="负责人" value={selectedProduct.garmentProfile?.owner} />
	                        <DetailItem label="确认日期" value={selectedProduct.garmentProfile?.confirmedDate} />
	                        <DetailItem label="技术包版本" value={selectedProduct.garmentProfile?.techPackVersion} />
	                        <DetailItem label="修改记录" value={selectedProduct.garmentProfile?.revisionHistory} wide />
	                        <DetailItem label="试身意见" value={selectedProduct.garmentProfile?.fittingComments} wide />
	                        <DetailItem label="客户批注意见" value={selectedProduct.garmentProfile?.customerComments} wide />
	                      </DetailSection>
	                      <DetailSection title="生产质量商业" icon={<ShieldCheck size={14} />}>
	                        <DetailItem label="工厂" value={selectedProduct.garmentProfile?.factory} />
	                        <DetailItem label="订单数量" value={selectedProduct.garmentProfile?.orderQuantity} />
	                        <DetailItem label="交期" value={selectedProduct.garmentProfile?.deliveryDate} />
	                        <DetailItem label="目标成本 / FOB" value={[selectedProduct.garmentProfile?.targetCost, selectedProduct.garmentProfile?.fobPrice].filter(Boolean).join(' / ')} />
	                        <DetailItem label="EXW / Retail" value={[selectedProduct.garmentProfile?.exwPrice, selectedProduct.garmentProfile?.retailPrice].filter(Boolean).join(' / ')} />
	                        <DetailItem label="原产国" value={selectedProduct.garmentProfile?.countryOfOrigin} />
	                        <DetailItem label="检验标准" value={selectedProduct.garmentProfile?.inspectionStandard} wide />
	                        <DetailItem label="常见疵点" value={selectedProduct.garmentProfile?.commonDefects} wide />
	                        <DetailItem label="洗水 / 后整理" value={selectedProduct.garmentProfile?.washFinishing} wide />
	                        <DetailItem label="洗标内容" value={selectedProduct.garmentProfile?.careLabel} wide />
	                        <DetailItem label="合规测试" value={selectedProduct.garmentProfile?.complianceTests} wide />
	                        <DetailItem label="包装方式 / 箱规" value={[selectedProduct.garmentProfile?.packingMethod, selectedProduct.garmentProfile?.cartonSpec].filter(Boolean).join('\n')} wide />
	                        <DetailItem label="质量备注" value={selectedProduct.garmentProfile?.qualityNote} wide />
	                      </DetailSection>
	                    </>
	                  ) : selectedProduct.mainCategory === 'Trimmings' ? (
	                    <>
	                      <DetailSection title="基础识别" icon={<Tag size={14} />}>
	                        <DetailItem label="SKU" value={selectedProduct.sku} />
	                        <DetailItem label="辅料编号" value={selectedProduct.trimmingProfile?.trimmingCode} />
	                        <DetailItem label="辅料名称" value={selectedProduct.trimmingProfile?.trimmingName || selectedProduct.name} />
	                        <DetailItem label="辅料类别" value={selectedProduct.trimmingProfile?.trimmingCategory} />
	                        <DetailItem label="客户 / 品牌" value={[selectedProduct.trimmingProfile?.customer, selectedProduct.trimmingProfile?.brand].filter(Boolean).join(' / ')} />
	                        <DetailItem label="适用款式" value={selectedProduct.trimmingProfile?.applicableProducts} wide />
	                      </DetailSection>
	                      <DetailSection title="规格材质" icon={<Scissors size={14} />}>
	                        <DetailItem label="材质" value={selectedProduct.trimmingProfile?.material} />
	                        <DetailItem label="规格" value={selectedProduct.trimmingProfile?.specification} />
	                        <DetailItem label="尺寸" value={selectedProduct.trimmingProfile?.size} />
	                        <DetailItem label="颜色 / 色号" value={[selectedProduct.trimmingProfile?.color, selectedProduct.trimmingProfile?.colorCode].filter(Boolean).join(' / ')} />
	                        <DetailItem label="表面处理" value={selectedProduct.trimmingProfile?.finish} />
	                        <DetailItem label="使用部位" value={selectedProduct.trimmingProfile?.usagePosition} />
	                      </DetailSection>
	                      <DetailSection title="供应采购" icon={<Box size={14} />}>
	                        <DetailItem label="供应商" value={selectedProduct.trimmingProfile?.supplier} />
	                        <DetailItem label="工厂" value={selectedProduct.trimmingProfile?.factory} />
	                        <DetailItem label="单位" value={selectedProduct.trimmingProfile?.unit} />
	                        <DetailItem label="单件用量" value={selectedProduct.trimmingProfile?.unitConsumption} />
	                        <DetailItem label="MOQ" value={selectedProduct.trimmingProfile?.moq} />
	                        <DetailItem label="交期" value={selectedProduct.trimmingProfile?.leadTime} />
	                        <DetailItem label="库存状态" value={selectedProduct.trimmingProfile?.stockStatus} />
	                        <DetailItem label="库存数量" value={formatMeasure(selectedProduct.trimmingProfile?.stockQuantity, selectedProduct.trimmingProfile?.stockUnit)} />
	                        <DetailItem label="单价" value={[selectedProduct.trimmingProfile?.currency, selectedProduct.trimmingProfile?.price].filter(Boolean).join(' ')} />
	                      </DetailSection>
	                      <DetailSection title="质量合规" icon={<ShieldCheck size={14} />}>
	                        <DetailItem label="合规测试" value={selectedProduct.trimmingProfile?.complianceTests} wide />
	                        <DetailItem label="质量标准" value={selectedProduct.trimmingProfile?.qualityStandard} wide />
	                        <DetailItem label="风险备注" value={selectedProduct.trimmingProfile?.riskNote} wide />
	                        <DetailItem label="包装方式" value={selectedProduct.trimmingProfile?.packaging} wide />
	                        <DetailItem label="洗护要求" value={selectedProduct.trimmingProfile?.careRequirement} wide />
	                        <DetailItem label="备注" value={selectedProduct.trimmingProfile?.notes} wide />
	                      </DetailSection>
	                    </>
	                  ) : (
	                    <>
	                      <DetailSection title="基础识别" icon={<Tag size={14} />}>
	                        <DetailItem label="SKU" value={selectedProduct.sku} />
	                        <DetailItem label="Article No." value={selectedProduct.fabricProfile?.articleNo} />
	                        <DetailItem label="供应商 / 生产工厂" value={selectedProduct.fabricProfile?.millOrganizationId} />
	                        <DetailItem label="Mill Quality" value={selectedProduct.fabricProfile?.millQuality} />
	                        <DetailItem label="Col." value={selectedProduct.fabricProfile?.millColorCode} />
	                        <DetailItem label="Description" value={selectedProduct.fabricProfile?.colorDescription} wide />
	                        <DetailItem label="Client Code" value={(selectedProduct.fabricCustomerCodes || []).map(item => item.clientCode).join(', ')} wide />
	                      </DetailSection>
	                      <DetailSection title="规格参数" icon={<Layers size={14} />}>
	                        <DetailItem label="成分" value={(selectedProduct.compositionLines || []).map(line => `${line.percentage}% ${line.term?.chineseName || line.term?.englishName || line.termId}`).join(' + ')} wide />
	                        <DetailItem label="克重" value={formatMeasure(selectedProduct.fabricProfile?.weightValue, selectedProduct.fabricProfile?.weightUnit)} />
	                        <DetailItem label="门幅" value={formatWidth(selectedProduct.fabricProfile)} />
	                        <DetailItem label="组织" value={selectedProduct.fabricProfile?.construction} />
	                        <DetailItem label="纱支" value={selectedProduct.fabricProfile?.yarnCount} />
	                        <DetailItem label="花型" value={selectedProduct.fabricProfile?.pattern} />
	                        <DetailItem label="生产周期" value={selectedProduct.fabricProfile?.productionLeadDays ? `${selectedProduct.fabricProfile.productionLeadDays} 天` : undefined} />
	                      </DetailSection>
	                      <DetailSection title="价格与库存" icon={<DollarSign size={14} />}>
	                        <DetailItem label="工厂价格" value={formatPrice(selectedProduct, 'factory')} />
	                        <DetailItem label="售价" value={formatPrice(selectedProduct, 'customer')} />
	                        <DetailItem label="现货状态" value={selectedProduct.fabricProfile?.stockStatus} />
	                        <DetailItem label="现货数量" value={formatMeasure(selectedProduct.fabricProfile?.stockQuantity, selectedProduct.fabricProfile?.stockUnit)} />
	                        <DetailItem label="起订量" value={selectedProduct.fabricProfile?.moqValue} />
	                        <DetailItem label="工厂起订量" value={selectedProduct.fabricProfile?.factoryMoqValue} />
	                        <DetailItem label="试样起订量" value={selectedProduct.fabricProfile?.sampleMoqValue} />
	                      </DetailSection>
	                      <DetailSection title="生产追溯与风险" icon={<ShieldCheck size={14} />}>
	                        <DetailItem label="标样批号" value={selectedProduct.fabricProfile?.referenceBatch} />
	                        <DetailItem label="认证许可" value={certificationText(selectedProduct)} wide />
	                        <DetailItem label="品质风险" value={selectedProduct.fabricProfile?.riskNote} wide />
	                        <DetailItem label="特殊备注" value={selectedProduct.fabricProfile?.specialNote} wide />
	                      </DetailSection>
	                      <div className="pt-2">
	                        <RelatedOrders productId={selectedProduct.id} millQuality={selectedProduct.fabricProfile?.millQuality} cloudEndpoint={cloudEndpoint} isDarkMode={isDarkMode} />
	                      </div>
	                    </>
	                  )}

	                  {/* 跨模块关联视图（EntityLink 图谱）— 开发案/BOM/订单行等 */}
	                  <div className="pt-2">
	                    <RelatedEntitiesPanel
	                      type="product"
	                      id={selectedProduct.id}
	                      isDarkMode={isDarkMode}
	                      title="产品关联视图"
	                    />
	                  </div>

                </div>
              </div>
            </CompiledDetailShell>
          </div>
        </div>
      )}
      </div>

      {/* Mobile Options Sheet */}
      {isMobile && (
        <CompiledBottomSheet
          isOpen={!!showOptionsSheet}
          onClose={() => setShowOptionsSheet(null)}
          title={showOptionsSheet?.name || 'Item Options'}
          height="auto"
          isDarkMode={isDarkMode}
        >
          <div className="space-y-4 py-4">
            <button
              onClick={() => { if (showOptionsSheet) { setEditingProd(showOptionsSheet); setShowOptionsSheet(null); } }}
              className={`w-full p-4 rounded-inset flex items-center gap-4 text-left font-light ${isDarkMode ? 'bg-slate-800/50 text-slate-200' : 'bg-slate-50 text-slate-700'}`}
            >
              <Edit2 size={18} /> 编辑产品信息
            </button>
            <button
              onClick={() => { if (showOptionsSheet) { setDeleteProdId(showOptionsSheet.id); setShowOptionsSheet(null); } }}
              className={`w-full p-4 rounded-inset flex items-center gap-4 text-left font-light ${isDarkMode ? 'text-white/70 bg-white/[0.06]' : 'text-slate-600 bg-slate-100/60'}`}
            >
              <Trash2 size={18} /> 归档此产品
            </button>
          </div>
        </CompiledBottomSheet>
      )}

      

      {/* MODALS / SHEETS */}
      {isMobile ? (
        <>
          {/* Mobile: Add Sub Category Sheet */}
          <CompiledBottomSheet isOpen={showAddSubModal || !!editingSub} onClose={() => { setshowAddSubModal(false); setEditingSub(null); }} title={editingSub ? '编辑类目' : '分类管理'} height="auto" isDarkMode={isDarkMode}>
            <form onSubmit={editingSub ? handleEditSub : handleAddSub} className="space-y-6 pt-4 pb-12">
              <div className="space-y-4">
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">分类名称</label>
                <input defaultValue={editingSub?.name} name="name" required className={`w-full px-6 py-4 rounded-control outline-none font-light ${isDarkMode ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-100'}`} />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">分类说明</label>
                <textarea defaultValue={editingSub?.description || ''} name="description" rows={3} className={`w-full px-6 py-4 rounded-control outline-none font-light resize-none ${isDarkMode ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-100'}`} />
              </div>
              <button type="submit" className={`w-full py-4 rounded-full font-light tracking-wide transition-all ${isDarkMode ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-white/70 border border-slate-200/60 text-slate-700 hover:bg-white/90 hover:text-slate-900'}`}>{editingSub ? '保存' : '确认'}</button>
            </form>
          </CompiledBottomSheet>

          {/* Mobile: Add Product Sheet */}
          <CompiledBottomSheet isOpen={showAddProdModal || !!editingProd} onClose={() => { setShowAddProdModal(false); setEditingProd(null); }} title={editingProd ? '修正档案' : '录入 SKU'} height="full" isDarkMode={isDarkMode}>
            <form onSubmit={editingProd ? handleEditProduct : handleAddProduct} className="space-y-6 pt-2 pb-24">
              {editingProd && (
                <div className="space-y-3">
                  <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">产品图片</label>
                  <CompiledImageUploader
                    productId={editingProd.id}
                    images={editingImages}
                    cloudEndpoint={cloudEndpoint}
                    isDarkMode={isDarkMode}
                    onChange={setEditingImages}
                  />
                </div>
              )}
              <div className="space-y-3">
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">档案款名 (Name)</label>
                <input defaultValue={editingProd?.name} name="name" required className={`w-full px-6 py-4 rounded-control outline-none font-light ${isDarkMode ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-100'}`} />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">SKU</label>
                <input defaultValue={editingProd?.sku} name="sku" required className={`w-full px-6 py-4 rounded-control outline-none font-light ${isDarkMode ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-100'}`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">Season</label>
                  <input defaultValue={editingProd?.season} name="season" placeholder="AW25" required className={`w-full px-6 py-4 rounded-control outline-none font-light ${isDarkMode ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-100'}`} />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">Cost ($)</label>
                  <input defaultValue={editingProd?.cost} type="number" step="0.01" name="cost" required className={`w-full px-6 py-4 rounded-control outline-none font-light ${isDarkMode ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-100'}`} />
                </div>
	              </div>
	              {renderFabricProfileFields(editingProd)}
	              {renderGarmentProfileFields(editingProd)}
	              {renderTrimmingProfileFields(editingProd)}
	              <div className="space-y-3">
                <label className="text-[10px] font-light text-slate-400 tracking-wide ml-1">Status</label>
                <input type="hidden" name="status" value={productStatusValue} />
                <CompiledSelectControl
                  value={productStatusValue}
                  onChange={setProductStatusValue}
                  isDarkMode={isDarkMode}
                  options={productStatusOptions}
                  surface="form"
                  menuPortal
                  className="relative z-30 w-full"
                  source="CompiledProductsPage.mobile-status-select"
                />
              </div>
              <button type="submit" className={`w-full py-5 rounded-full font-light tracking-wide mt-4 transition-all ${isDarkMode ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-white/70 border border-slate-200/60 text-slate-700 hover:bg-white/90 hover:text-slate-900'}`}>{editingProd ? '保存修正' : '确认录入'}</button>
            </form>
          </CompiledBottomSheet>
        </>
      ) : (
        <>
          {(showAddSubModal || editingSub) && (
            <motion.div
              className={`absolute inset-0 z-[70] flex items-center justify-center p-6 backdrop-blur-md ${isDarkMode ? 'bg-slate-950/45' : 'bg-slate-950/15'}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <motion.form
                onSubmit={editingSub ? handleEditSub : handleAddSub}
                className={`w-full max-w-md overflow-hidden rounded-card border ${productFloatingPanelClass}`}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <div className={`px-8 py-6 border-b ${isDarkMode ? 'border-white/[0.08]' : 'border-white/60'}`}>
                  <p className={`text-[10px] font-light tracking-[0.24em] uppercase ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
                    {mainCategories.find(c => c.id === selectedMain)?.label || 'Digital Archive'}
                  </p>
                  <h3 className={`mt-1 text-xl font-light tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {editingSub ? '编辑子分类' : '分类管理'}
                  </h3>
                </div>
                <div className="px-8 py-7 space-y-4">
                  <div className="space-y-3">
                    <label className={productLabelClass}>分类名称</label>
                    <input
                      defaultValue={editingSub?.name}
                      name="name"
                      required
                      autoFocus
                      className={productInputClass}
                      placeholder="例如：常规面料 / 辅料 / 客户专属"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className={productLabelClass}>分类说明</label>
                    <textarea
                      defaultValue={editingSub?.description || ''}
                      name="description"
                      rows={3}
                      className={productTextareaClass}
                      placeholder="用于说明这个分类下应该放哪些档案"
                    />
                  </div>
                </div>
                <div className={`px-8 py-5 border-t flex justify-end gap-3 ${isDarkMode ? 'border-white/10 bg-deep/26' : 'border-white/60 bg-white/22'}`}>
                  <button
                    type="button"
                    onClick={() => { setshowAddSubModal(false); setEditingSub(null); }}
                    className={`h-9 px-4 rounded-full text-[11px] font-light tracking-wide transition-all ${productActionButtonClass}`}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className={`h-9 px-4 rounded-full text-[11px] font-light tracking-wide transition-all ${productActionButtonClass}`}
                  >
                    {editingSub ? '保存修正' : '确认新增'}
                  </button>
                </div>
              </motion.form>
            </motion.div>
          )}

          {(showAddProdModal || editingProd) && (
            <div className="absolute inset-0 z-[70] bg-transparent">
              <div className="h-full w-full overflow-hidden flex flex-col bg-transparent">
                <div className={`${PRODUCT_TITLE_BAR_CLASS} flex`} style={PRODUCT_TITLE_SAFE_LEFT_STYLE}>
                  <div className={PRODUCT_TITLE_NAV_GROUP_CLASS}>
                    <CompiledInteractiveCard
                      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                      spotlightSize={isDarkMode ? 180 : 140}
                      idleSpotlightOpacity={0}
                      activeSpotlightOpacity={1}
                      className={`${PRODUCT_TITLE_ICON_BUTTON_CLASS} ${productActionButtonClass}`}
                    >
                      <button
                        type="button"
                        onClick={() => { setShowAddProdModal(false); setEditingProd(null); }}
                        data-ui-lab-wallpaper-contrast="primary"
                        className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center"
                        aria-label="返回数字档案"
                      >
                        <ChevronLeft size={18} strokeWidth={1.4} />
                      </button>
                    </CompiledInteractiveCard>
                    <div className={`h-9 flex items-center gap-1.5 min-w-0 text-[11px] font-light tracking-wide ${isDarkMode ? 'text-white/48' : 'text-slate-400'}`}>
                      <button type="button" onClick={() => { setShowAddProdModal(false); setEditingProd(null); }} className={`${PRODUCT_TITLE_TEXT_BUTTON_CLASS} ${isDarkMode ? 'text-white hover:text-white' : 'text-slate-900 hover:text-[var(--os-vnext-brand-blue)]'}`}>
                        <span className={`${BAMBOOK_OS.layout.desktopTitleTextClass} ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          数字档案
                        </span>
                      </button>
                      <span data-ui-lab-wallpaper-contrast="secondary" className={PRODUCT_TITLE_SEPARATOR_CLASS}>
                        <ChevronRight size={18} strokeWidth={1.4} />
                      </span>
                      <h3 data-ui-lab-wallpaper-contrast="primary" className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} ${isDarkMode ? 'text-white/70' : 'text-slate-700'}`}>{editingProd ? '修正档案' : '录入档案'}</h3>
                    </div>
                  </div>
                  <div className="flex h-full items-center gap-2 shrink-0">
                    {editingProd && (
                      <button
                        type="button"
                        onClick={() => setDeleteProdId(editingProd.id)}
                        className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[11px] font-light tracking-wide transition-all border ${isDarkMode ? 'text-white/70 border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.10]' : 'text-slate-600 border-slate-300/40 hover:bg-slate-100/60 hover:border-slate-300/40'}`}
                      >
                        <Trash2 size={13} strokeWidth={1.5} /> 归档
                      </button>
                    )}
                    <CompiledInteractiveCard
                      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                      spotlightSize={isDarkMode ? 180 : 140}
                      idleSpotlightOpacity={0}
                      activeSpotlightOpacity={1}
                      className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass}`}
                    >
                      <button type="button" onClick={() => { setShowAddProdModal(false); setEditingProd(null); }} data-ui-lab-wallpaper-contrast="primary" className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center">
                        取消
                      </button>
                    </CompiledInteractiveCard>
                    <CompiledInteractiveCard
                      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                      spotlightSize={isDarkMode ? 180 : 140}
                      idleSpotlightOpacity={0}
                      activeSpotlightOpacity={1}
                      className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${compositionTotalIsComplete ? productActionButtonClass : 'bg-slate-200/50 text-slate-400 border-transparent cursor-not-allowed'}`}
                    >
                      <button
                        type="submit"
                        form="product-fullscreen-form"
                        disabled={!compositionTotalIsComplete}
                        data-ui-lab-wallpaper-contrast="primary"
                        className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2 disabled:cursor-not-allowed"
                      >
                        <Save size={14} strokeWidth={1.5} /> 保存资料
                      </button>
                    </CompiledInteractiveCard>
                  </div>
                </div>
                <form id="product-fullscreen-form" onSubmit={editingProd ? handleEditProduct : handleAddProduct} className="w-full flex-1 min-h-0 px-5 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch">
                    <aside className="self-start">
                      <CompiledFormMapPanel
                        materialRole={blueprint.form.mapMaterialRole}
                        isDarkMode={isDarkMode}
                        titleClassName={productFormSectionTitleClass}
                        source="CompiledProductsPage.form-map"
                      >
                        <div className="space-y-1">
	                          {(isGarmentFormContext ? garmentProductFormSections : isTrimmingFormContext ? trimmingProductFormSections : fabricProductFormSections)
	                            .map((section, idx) => (
                            <button
                              key={section.id}
                              type="button"
                              onClick={() => document.getElementById(`product-form-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                              className={`w-full text-left rounded-full border px-3 py-3 transition-all group ${productActionButtonClass}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className={`w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-light transition-colors ${productFormMapIndexClass}`}>{idx + 1}</span>
                                <div className="min-w-0">
                                  <div className={`text-xs font-light ${isDarkMode ? 'text-white/75' : 'text-slate-800'}`}>{section.label}</div>
                                  <div className={`text-[10px] mt-0.5 truncate ${productLabelClass}`}>{section.desc}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </CompiledFormMapPanel>
                    </aside>

                    <div ref={productFormScrollRef} className={blueprint.form.scrollViewportClassName}>
                      {/* Images section */}
                      {editingProd && (
                        <ProductFormSection id="images" title="产品图片" description="上传面料/产品的实物照片，第一张自动设为主图。" isDarkMode={isDarkMode}>
                          <CompiledImageUploader
                            productId={editingProd.id}
                            images={editingImages}
                            cloudEndpoint={cloudEndpoint}
                            isDarkMode={isDarkMode}
                            onChange={setEditingImages}
                          />
                        </ProductFormSection>
                      )}
	                      <ProductFormSection id="basic" title={isGarmentFormContext ? '基础身份' : isTrimmingFormContext ? '基础识别' : '基础信息'} description={isGarmentFormContext ? '记录款号、款名、品类、客户、系列和样衣状态。' : isTrimmingFormContext ? '记录辅料编号、名称、类别、客户、品牌和状态。' : '只保留这条档案最核心的身份信息：SKU、二维码、品号、克重、门幅和成分。'} isDarkMode={isDarkMode}>
                        <div className="space-y-2">
                          <label className={productLabelClass}>唯一 SKU 识别码</label>
                          <input
                            defaultValue={editingProd?.sku}
                            name="sku"
                            required
                            ref={skuInputRef}
                            onBlur={handleGenerateSkuQr}
                            onKeyDown={handleSkuKeyDown}
                            className={productInputClass}
                          />
                        </div>
                        <div className={`rounded-inset border p-4 flex items-center ${productFormNestedRowClass}`}>
                          <div className="w-[116px] h-[116px] rounded-inset bg-white border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                            {skuQrDataUrl ? (
                              <img src={skuQrDataUrl} alt={`${skuForQr} QR Code`} className="w-full h-full object-contain" />
                            ) : (
                              <div className="w-full h-full" />
                            )}
                          </div>
                        </div>
	                        {isGarmentFormContext ? (
	                          <>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>款号 / Style No.</label>
	                              <input defaultValue={editingProd?.garmentProfile?.styleNo || ''} name="styleNo" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>成衣名称</label>
	                              <input defaultValue={editingProd?.garmentProfile?.productName || editingProd?.name || ''} name="productName" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>品类</label>
	                              <input defaultValue={editingProd?.garmentProfile?.garmentCategory || ''} name="garmentCategory" placeholder="西装 / 衬衫 / 裤子 / 外套" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>系列 / Season / Collection</label>
	                              <input defaultValue={editingProd?.garmentProfile?.collection || editingProd?.season || ''} name="collection" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>客户</label>
	                              <input defaultValue={editingProd?.garmentProfile?.customer || ''} name="customer" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>品牌</label>
	                              <input defaultValue={editingProd?.garmentProfile?.brand || ''} name="brand" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>项目</label>
	                              <input defaultValue={editingProd?.garmentProfile?.project || ''} name="project" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>状态</label>
	                              <input type="hidden" name="status" value={productStatusValue} />
	                              <CompiledSelectControl
	                                value={productStatusValue}
	                                onChange={setProductStatusValue}
	                                isDarkMode={isDarkMode}
	                                options={productStatusOptions}
	                                surface="form"
	                                menuPortal
	                                className="relative z-30 w-full"
	                                source="CompiledProductsPage.garment-status-select"
	                              />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>性别</label>
	                              <input defaultValue={editingProd?.garmentProfile?.gender || ''} name="gender" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>年龄段</label>
	                              <input defaultValue={editingProd?.garmentProfile?.ageGroup || ''} name="ageGroup" className={productInputClass} />
	                            </div>
	                            <div className="md:col-span-2 space-y-2">
	                              <label className={productLabelClass}>标签</label>
	                              <input defaultValue={editingProd?.garmentProfile?.tags || ''} name="tags" placeholder="商务、制服、婚礼、休闲、可持续" className={productInputClass} />
	                            </div>
	                          </>
	                        ) : isTrimmingFormContext ? (
	                          <>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>辅料编号 / Trim Code</label>
	                              <input defaultValue={editingProd?.trimmingProfile?.trimmingCode || ''} name="trimmingCode" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>辅料名称</label>
	                              <input defaultValue={editingProd?.trimmingProfile?.trimmingName || editingProd?.name || ''} name="trimmingName" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>辅料类别</label>
	                              <input defaultValue={editingProd?.trimmingProfile?.trimmingCategory || ''} name="trimmingCategory" placeholder="纽扣 / 拉链 / 商标 / 衬布" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>供应商</label>
	                              <input defaultValue={editingProd?.trimmingProfile?.supplier || ''} name="supplier" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>客户</label>
	                              <input defaultValue={editingProd?.trimmingProfile?.customer || ''} name="customer" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>品牌</label>
	                              <input defaultValue={editingProd?.trimmingProfile?.brand || ''} name="brand" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>状态</label>
	                              <input type="hidden" name="status" value={productStatusValue} />
	                              <CompiledSelectControl
	                                value={productStatusValue}
	                                onChange={setProductStatusValue}
	                                isDarkMode={isDarkMode}
	                                options={productStatusOptions}
	                                surface="form"
	                                menuPortal
	                                className="relative z-30 w-full"
	                                source="CompiledProductsPage.trimming-status-select"
	                              />
	                            </div>
	                            <div className="md:col-span-2 space-y-2">
	                              <label className={productLabelClass}>适用款式 / 使用范围</label>
	                              <input defaultValue={editingProd?.trimmingProfile?.applicableProducts || ''} name="applicableProducts" placeholder="西装、衬衫、裤装、指定客户款号" className={productInputClass} />
	                            </div>
	                          </>
	                        ) : (
	                          <>
	                            <input type="hidden" name="status" value={productStatusValue} />
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>品号 / Article No.</label>
	                              <input defaultValue={editingProd?.fabricProfile?.articleNo || ''} name="articleNo" className={productInputClass} />
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>克重</label>
	                              <div className="grid grid-cols-[1fr,96px] gap-2">
	                                <input defaultValue={editingProd?.fabricProfile?.weightValue ?? ''} type="number" step="0.01" name="weightValue" className={productInputClass} />
	                                <input defaultValue={editingProd?.fabricProfile?.weightUnit || 'gsm'} name="weightUnit" className={productInputClass} />
	                              </div>
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>门幅</label>
	                              <div className="grid grid-cols-[1fr,96px] gap-2">
	                                <input defaultValue={editingProd?.fabricProfile?.widthValue ?? ''} type="number" step="0.01" name="widthValue" className={productInputClass} />
	                                <input defaultValue={editingProd?.fabricProfile?.widthUnit || 'cm'} name="widthUnit" className={productInputClass} />
	                              </div>
	                            </div>
	                            <div className="space-y-2">
	                              <label className={productLabelClass}>门幅原值</label>
	                              <input defaultValue={editingProd?.fabricProfile?.widthText || ''} name="widthText" placeholder="例如 57/58" className={productInputClass} />
	                            </div>
	                            <div className="md:col-span-2 space-y-2">
	                              <label className={productLabelClass}>成分</label>
	                          <datalist id="fabric-composition-abbreviations">
                            {compositionTermSuggestions.map((term, index) => term.abbreviation && (
                              <option key={`${term.abbreviation}-${index}`} value={term.abbreviation} />
                            ))}
                          </datalist>
                          <datalist id="fabric-composition-chinese-names">
                            {compositionTermSuggestions.map((term, index) => term.chineseName && (
                              <option key={`${term.chineseName}-${index}`} value={term.chineseName} />
                            ))}
                          </datalist>
                          <datalist id="fabric-composition-english-names">
                            {compositionTermSuggestions.map((term, index) => term.englishName && (
                              <option key={`${term.englishName}-${index}`} value={term.englishName} />
                            ))}
                          </datalist>
                          <div className={`rounded-inset border p-4 space-y-3 ${productFormNestedRowClass}`}>
                            <div className={`grid grid-cols-[90px_100px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-3 px-1 text-[10px] font-light tracking-wide ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
                              <span>比例</span>
                              <span>缩写</span>
                              <span>中文名称</span>
                              <span>英文名称</span>
                              <span />
                            </div>
                            {compositionDraftRows.map((row, index) => (
                              <div key={row.id} className="grid grid-cols-[90px_100px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-3 items-center">
                                <input
                                  value={row.percentage}
                                  onChange={(event) => updateCompositionDraftRow(row.id, { percentage: normalizePercentageValue(event.target.value) })}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  placeholder="%"
                                  className={productInputClass}
                                  aria-label={`成分 ${index + 1} 百分比`}
                                />
                                <input
                                  value={row.abbreviation}
                                  onChange={(event) => updateCompositionDraftRow(row.id, { abbreviation: event.target.value }, true)}
                                  list="fabric-composition-abbreviations"
                                  placeholder="W"
                                  className={productInputClass}
                                  aria-label={`成分 ${index + 1} 缩写`}
                                />
                                <input
                                  value={row.chineseName}
                                  onChange={(event) => updateCompositionDraftRow(row.id, { chineseName: event.target.value }, true)}
                                  list="fabric-composition-chinese-names"
                                  placeholder="羊毛"
                                  className={productInputClass}
                                  aria-label={`成分 ${index + 1} 中文名称`}
                                />
                                <input
                                  value={row.englishName}
                                  onChange={(event) => updateCompositionDraftRow(row.id, { englishName: event.target.value }, true)}
                                  list="fabric-composition-english-names"
                                  placeholder="WOOL"
                                  className={productInputClass}
                                  aria-label={`成分 ${index + 1} 英文名称`}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeCompositionDraftRow(row.id)}
                                  className={`h-9 rounded-full flex items-center justify-center transition-all ${productFormQuietActionClass}`}
                                  aria-label="删除成分行"
                                >
                                  <X size={15} />
                                </button>
                              </div>
                            ))}
                            <div className="flex items-center justify-between gap-3 pt-1">
                              <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
                                成分词条以《成份符号.xls》为准；输入符号、全称或名称会自动补齐，不在表内的词条不能保存。
                              </p>
                              <button
                                type="button"
                                onClick={addCompositionDraftRow}
                                className={`shrink-0 h-9 px-4 rounded-full text-[11px] font-light tracking-wide transition-all ${productFormQuietActionClass}`}
                              >
                                添加成分
                              </button>
                            </div>
                            <div className={`rounded-inset border px-4 py-3 text-[11px] font-light ${productFormNestedRowClass} ${compositionTotalIsComplete ? (isDarkMode ? 'text-white/70' : 'text-slate-600') : compositionTotalIsOver ? (isDarkMode ? 'text-white/70' : 'text-slate-600') : (isDarkMode ? 'text-white/70' : 'text-slate-600')}`}>
                              成分合计：{compositionTotal}% · {compositionValidationMessage}
                            </div>
                          </div>
                          {compositionDraftText() && (
                            <div className={`text-[11px] font-light ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
                              当前成分：{compositionDraftText()}
                            </div>
                          )}
	                            </div>
	                          </>
	                        )}
	                      </ProductFormSection>
	                      {renderFabricProfileFields(editingProd)}
	                      {renderGarmentProfileFields(editingProd)}
	                      {renderTrimmingProfileFields(editingProd)}
                    </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {(deleteSubId || deleteProdId) && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`${isDarkMode ? 'bg-deep/90 border border-white/10' : 'bg-white'} rounded-floating w-full max-w-sm shadow-none overflow-hidden animate-in zoom-in duration-300`}>
            <div className="p-10 text-center space-y-6">
              <div className={`w-20 h-20 rounded-control flex items-center justify-center mx-auto mb-2 border ${isDarkMode ? 'bg-white/[0.06] text-white/70 border-white/[0.08]' : 'bg-slate-100/60 text-slate-600 border-slate-300/40'}`}>
                <AlertTriangle size={32} strokeWidth={1} />
              </div>
              <div className="space-y-2">
                <h3 className={`text-lg font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{deleteSubId ? '确认移除分类？' : '确认归档产品？'}</h3>
                <p className="text-sm text-slate-400 font-light leading-relaxed">
                  {deleteSubId ? '该分类下的所有 SKU 将失去此分类关联，但原始档案不会被删除。' : '该产品 SKU 将从当前活跃列表中移除并存入历史档案库。'}
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={deleteSubId ? handleDeleteSub : handleDeleteProduct}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all ${isDarkMode ? 'bg-white/[0.06] text-white/70 hover:bg-white/[0.08] border border-white/[0.08]' : 'bg-slate-100/60 text-slate-600 hover:bg-slate-100/60'}`}
                >
                  确认{deleteSubId ? '移除' : '归档'}
                </button>
                <button
                  onClick={() => { setDeleteSubId(null); setDeleteProdId(null); }}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
