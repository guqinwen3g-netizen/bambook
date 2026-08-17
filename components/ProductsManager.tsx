
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as QRCode from 'qrcode';
import { ProductAsset, ProductSubCategory, MainCategory, ProductImage, PdmlRawFabric } from '../types';
import { apiService } from '../services/apiService';
import { storageService } from '../services/storageService';
import ImageUploader from './ImageUploader';
import {
  COMPOSITION_TERMS,
  findCompositionTermByValue,
  normalizeCompositionTermValue,
  type CompositionTermSuggestion,
} from '../data/compositionTerms';
import {
  Shirt, Search, Plus, LayoutGrid, List,
  ChevronRight, X, Save, ShieldCheck, ChevronLeft,
  Layers, Watch, Scissors, Gift, Box, Edit2, Trash2,
  DollarSign, FileText, Tag, Sparkles, FolderPlus, Library,
  CheckCircle2, AlertTriangle, Archive, RefreshCw, Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react';
import BottomSheet from './ui/BottomSheet';
import CustomSelect from './ui/CustomSelect';
import { SpotlightCard } from './ui/SpotlightCard';
import { CompiledMotionInteractiveCard, CompiledSurfacePanel } from './ui/osCompiler/compiledSurfacePrimitives';
import { CompiledModuleTitleBar, CompiledTableShell } from './ui/osCompiler/compiledPrimitives';
import { PageHeader } from './ui/PageHeader';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { useGlassSurfaceEdgeMasks } from './ui/useGlassSurfaceEdgeMasks';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';
import {
  RELATIONS_FORM_MAP_PANEL_CLASS,
  RELATIONS_FORM_NESTED_ROW_CLASS,
  RELATIONS_FORM_PANEL_CLASS,
  RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING,
  RELATIONS_FORM_QUIET_ACTION_CLASS,
} from './ui/relationsFormStyles';

interface ProductsProps {
  products: ProductAsset[];
  productCategories: ProductSubCategory[];
  onUpdateProducts: (items: ProductAsset[], modified?: ProductAsset) => void;
  onUpdateCategories: (items: ProductSubCategory[], modified?: ProductSubCategory) => void;
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

type NavLevel = 'main' | 'sub' | 'list';
type ClassificationView = 'category' | 'supplier' | 'customer' | 'certification' | 'price' | 'status';
type ProductListDisplayMode = 'grid' | 'table';
type ProductFormSectionId = 'images' | 'basic' | 'specs' | 'pricing' | 'risk' | 'notes';
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

const productFormSections: { id: ProductFormSectionId; label: string; desc: string }[] = [
  { id: 'basic', label: '基础信息', desc: 'SKU、二维码、品号、克重门幅、成分' },
  { id: 'specs', label: '规格参数', desc: '品质、颜色、组织、生产周期' },
  { id: 'pricing', label: '价格库存', desc: 'Client Code、价格、现货' },
  { id: 'risk', label: '认证风险', desc: '认证许可、质量风险' },
  { id: 'notes', label: '备注', desc: '特殊备注与补充说明' },
];

const PRODUCT_STATUS_OPTIONS = [
  { value: 'Development', label: 'Development' },
  { value: 'Active', label: 'Active' },
  { value: 'Archived', label: 'Archived' },
];

export const PRODUCT_TITLE_BAR_CLASS = BAMBOOK_OS.layout.desktopTitleBarWithInsetClass;
export const PRODUCT_TITLE_SAFE_LEFT_STYLE: React.CSSProperties = BAMBOOK_OS.layout.desktopTitleSafeLeftStyle;
export const PRODUCT_TITLE_NAV_GROUP_CLASS = 'flex h-full items-center gap-1.5 min-w-0';
export const PRODUCT_TITLE_TEXT_BUTTON_CLASS = 'h-9 flex items-center shrink-0 bg-transparent border-0 p-0 rounded-none shadow-none transition-colors';
export const PRODUCT_TITLE_PAGE_LABEL_CLASS = BAMBOOK_OS.controls.title.pageLabel;
export const PRODUCT_TITLE_SEPARATOR_CLASS = 'h-9 w-5 flex items-center justify-center shrink-0';
export const PRODUCT_TITLE_ICON_BUTTON_CLASS = BAMBOOK_OS.controls.title.iconButton;
export const PRODUCT_TITLE_ACTION_BUTTON_CLASS = BAMBOOK_OS.controls.title.actionButton;
export const PRODUCT_TITLE_BUTTON_CLASS = BAMBOOK_OS.controls.actionControl.base;
export const PRODUCT_CATEGORY_CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,316px)] justify-center gap-6 content-start';
export const PRODUCT_CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,300px)] justify-center gap-6 content-start';
export const PRODUCT_CARD_CLASS = 'p-6 h-[220px] rounded-card-lg';
export const PRODUCT_CARD_SURFACE_CLASS = `${OS_MATERIAL.raisedCard} bambook-panel-glass`;
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
export const PRODUCT_TOOLBAR_CLASS = BAMBOOK_OS.controls.toolbar.base;
export const PRODUCT_TOOLBAR_CONTENT_CLASS = BAMBOOK_OS.controls.toolbar.content;
export const PRODUCT_TOOLBAR_AMBIENT_CLASS = BAMBOOK_OS.controls.toolbar.ambient;
export const PRODUCT_TOOLBAR_SURFACE_CLASS = BAMBOOK_OS.controls.toolbar.surface;
export const PRODUCT_TOOLBAR_SEARCH_CLASS = BAMBOOK_OS.controls.toolbar.search;
export const PRODUCT_TOOLBAR_SPOTLIGHT_DARK_SIZE = BAMBOOK_OS.controls.toolbar.spotlightDarkSize;
export const PRODUCT_TOOLBAR_SPOTLIGHT_LIGHT_SIZE = BAMBOOK_OS.controls.toolbar.spotlightLightSize;
export const PRODUCT_SEGMENT_BUTTON_CLASS = `relative z-20 h-9 w-7 rounded-none bg-transparent border-0 shadow-none text-[10px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label} flex items-center justify-center transition-[color,opacity,filter,transform] duration-200 ease-out active:translate-y-[1px]`;
export const PRODUCT_FORM_FIELD_CLASS = BAMBOOK_OS.controls.recessedField.base;
export const PRODUCT_FORM_LABEL_CLASS = BAMBOOK_OS.tone.text.formLabel;
export const PRODUCT_FORM_SECTION_TITLE_CLASS = 'text-[var(--text-primary)] dark:text-[var(--text-secondary)]';
export const PRODUCT_FORM_MAP_INDEX_CLASS = `${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndex}`;
export const PRODUCT_TABLE_HEADER_CLASS = BAMBOOK_OS.controls.table.header;
export const PRODUCT_TABLE_ROW_HOVER_CLASS = BAMBOOK_OS.controls.table.rowHover;
export const PRODUCT_TABLE_CELL_BORDER_CLASS = BAMBOOK_OS.controls.table.cellBorder;
export const PRODUCT_DETAIL_PANEL_LAYOUT_CLASS = 'w-full h-full max-h-full min-h-0 overflow-hidden';
export const PRODUCT_DETAIL_PANEL_CONTENT_CLASS = 'relative z-10 grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)] overflow-hidden';
export const PRODUCT_DETAIL_MEDIA_PANEL_CLASS = 'min-h-0 p-6 flex flex-col gap-4';
export const PRODUCT_DETAIL_MEDIA_FRAME_CLASS = `${OS_MATERIAL.insetSurface} relative aspect-[4/5] rounded-inset overflow-hidden border`;
export const PRODUCT_DETAIL_MEDIA_META_CLASS = `${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3`;
export const PRODUCT_DETAIL_MAIN_PANEL_CLASS = 'min-h-0 overflow-hidden flex flex-col';
export const PRODUCT_DETAIL_HEADER_LAYOUT_CLASS = 'shrink-0 px-8 py-6 border-b flex items-start justify-between gap-4';
export const PRODUCT_DETAIL_BODY_SCROLL_CLASS = 'flex-1 min-h-0 overflow-y-auto p-8 space-y-8';
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
  <CompiledSurfacePanel
    as="section"
    id={`product-form-${id}`}
    isDarkMode={isDarkMode}
    materialRole="framePanel"
    edgeFadeItem
    spotlight
    spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}
    className={RELATIONS_FORM_PANEL_CLASS}
  >
    <h4 className={`text-xs font-light tracking-wide mb-4 ${PRODUCT_FORM_SECTION_TITLE_CLASS}`}>{title}</h4>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {children}
    </div>
  </CompiledSurfacePanel>
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
      <div className={`${PRODUCT_DETAIL_HISTORY_PANEL_CLASS} text-xs leading-relaxed text-[var(--text-tertiary)]`}>
        填写 Mill Quality 后可自动关联历史订单。
      </div>
    );
  }

  if (loading) {
    return <div className={`text-xs text-[var(--text-tertiary)]`}>加载关联订单中…</div>;
  }

  if (lines.length === 0) {
    return (
      <div className={`${PRODUCT_DETAIL_HISTORY_PANEL_CLASS} text-xs leading-relaxed text-[var(--text-tertiary)]`}>
        暂无关联订单（Mill Quality: {millQuality}）。历史调样、关联成衣将在样品/服装模块接入后补齐。
      </div>
    );
  }

  return (
    <div className={`rounded-inset border overflow-hidden border-[var(--border-c-default)]`}>
      <div className={`px-4 py-2.5 text-xs font-light bg-[var(--recessed-bg)] dark:bg-deep/60 dark:border-b dark:border-[var(--border-c-subtle)] text-[var(--text-secondary)]`}>
        关联订单 ({lines.length})
      </div>
      <div className="divide-y divide-white/5">
        {lines.map((line: any) => (
          <div key={line.id} className={`px-4 py-2.5 flex items-center justify-between text-xs text-[var(--text-secondary)]`}>
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono font-light">{line.order?.poNumber || '-'}-{String(line.itemNo || line.lineNumber).padStart(3, '0')}</span>
              <span className="truncate">{line.description || line.cloth || '-'}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span>{line.quantity?.toLocaleString() ?? '-'} {line.unit || ''}</span>
              <span className={'text-[var(--text-tertiary)]'}>{line.order?.dueDate || ''}</span>
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
    'text-[var(--text-secondary)]'
  }`;
  const boxCls = (on: boolean) =>
    `w-4 h-4 rounded-bds-xs border transition-colors ${
      on
        ? 'bg-[var(--os-vnext-brand-blue-strong)] border-[var(--os-vnext-brand-blue-strong)]'
        : 'bg-[var(--recessed-bg)] border-[var(--border-c-strong)]'
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
            <span key={cert} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-bds-sm text-[11px] font-light bg-[var(--os-vnext-brand-blue-strong)]/10 text-[var(--os-vnext-brand-blue)] dark:bg-[var(--os-vnext-brand-blue-strong)]/20 dark:text-[var(--os-vnext-brand-blue-strong)]">
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
            'bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:ring-2 focus:ring-[var(--os-vnext-brand-blue)] dark:bg-deep/60 dark:focus:ring-0 dark:focus:border-[var(--os-vnext-brand-blue-strong)]/40'
          }`}
        />
        <button
          type="button"
          onClick={addCustom}
          className={`px-4 py-3 text-xs rounded-control font-light transition-all ${
            'bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)] dark:bg-deep/80 dark:border dark:border-[var(--border-c-default)] dark:hover:bg-deep'
          }`}
        >
          添加
        </button>
      </div>
    </div>
  );
};

const ProductsManager: React.FC<ProductsProps> = ({ products, productCategories, onUpdateProducts, onUpdateCategories, cloudEndpoint, isDarkMode = false, isMobile = false, moduleSettings }) => {
  const [navLevel, setNavLevel] = useState<NavLevel>('main');
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

  useGlassSurfaceEdgeMasks({
    scrollRef: productGridScrollRef,
    enabled: navLevel === 'list' && listDisplayMode === 'grid' && !isPdmlRawView,
    scopeSelector: null,
    topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT,
    bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
    topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START,
  });

  useGlassSurfaceEdgeMasks({
    scrollRef: mainCategoryScrollRef,
    enabled: navLevel === 'main',
    scopeSelector: null,
    topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT,
    bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
    topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START,
  });

  useGlassSurfaceEdgeMasks({
    scrollRef: subIndexScrollRef,
    enabled: navLevel === 'sub',
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

  useGlassSurfaceEdgeMasks({
    scrollRef: productFormScrollRef,
    enabled: fullscreenProductFormOpen,
    scopeSelector: null,
    topHeight: 57,
    topFadeStartOffset: 58,
    bottomHeight: 57,
    shadowCasterBottomHeight: 57,
    topFadeActivation: 'clip',
    bottomFadeActivation: 'zone',
    bottomFadeEndOffset: BAMBOOK_OS.layout.desktopMainPanelBottomInset,
    bottomContentInset: 0,
    syncWheelScroll: true,
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
  const productStatusOptions = useMemo(() => {
    const enabled = moduleSettings?.statusOptions?.length ? moduleSettings.statusOptions : PRODUCT_STATUS_OPTIONS.map(option => option.value);
    return PRODUCT_STATUS_OPTIONS.filter(option => enabled.includes(option.value));
  }, [moduleSettings?.statusOptions]);

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
    setProductStatusValue(editingProd?.status || 'Development');
  }, [editingProd, showAddProdModal]);

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

    if (classificationView === 'supplier') {
      return makeGroups(selectedMainProducts.map(product => ({
        product,
        id: product.fabricProfile?.millOrganizationId || '',
        name: product.fabricProfile?.millOrganizationId || '供应商未填',
      })), '供应商未填', 'slate');
    }

    if (classificationView === 'customer') {
      return makeGroups(selectedMainProducts.flatMap(product => {
        const codes = product.fabricCustomerCodes || [];
        return codes.length > 0
          ? codes.map(code => ({ product, id: code.customerOrganizationId || code.clientCode, name: code.customerNameSnapshot || code.clientCode }))
          : [{ product, id: '', name: '客户/Client Code 未填' }];
      }), '客户/Client Code 未填', 'slate');
    }

    if (classificationView === 'certification') {
      return makeGroups(selectedMainProducts.flatMap(product => {
        const certs = product.fabricCertifications || [];
        return certs.length > 0
          ? certs.map(cert => ({ product, id: cert.certification, name: cert.certification }))
          : [{ product, id: '', name: '认证未填' }];
      }), '认证未填', 'slate');
    }

    if (classificationView === 'price') {
      return makeGroups(selectedMainProducts.map(product => {
        const price = latestPrice(product, 'factory')?.amount || latestPrice(product, 'customer')?.amount || 0;
        const bucket = price <= 0 ? '价格未填' : price < 5 ? '低价位' : price < 15 ? '中价位' : '高价位';
        return { product, id: bucket, name: bucket };
      }), '价格未填', 'slate');
    }

    return makeGroups(selectedMainProducts.map(product => ({
      product,
      id: product.fabricProfile?.stockStatus || product.status || '',
      name: product.fabricProfile?.stockStatus || product.status || '状态未填',
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
        list = selectedMainProducts.filter(p => (p.fabricProfile?.millOrganizationId || '供应商未填') === selectedSubId);
      } else if (classificationView === 'customer') {
        list = selectedMainProducts.filter(p => {
          const codes = p.fabricCustomerCodes || [];
          return codes.length > 0
            ? codes.some(code => (code.customerOrganizationId || code.clientCode) === selectedSubId)
            : selectedSubId === '客户/Client Code 未填';
        });
      } else if (classificationView === 'certification') {
        list = selectedMainProducts.filter(p => {
          const certs = p.fabricCertifications || [];
          return certs.length > 0
            ? certs.some(cert => cert.certification === selectedSubId)
            : selectedSubId === '认证未填';
        });
      } else if (classificationView === 'price') {
        list = selectedMainProducts.filter(p => {
          const price = latestPrice(p, 'factory')?.amount || latestPrice(p, 'customer')?.amount || 0;
          const bucket = price <= 0 ? '价格未填' : price < 5 ? '低价位' : price < 15 ? '中价位' : '高价位';
          return bucket === selectedSubId;
        });
      } else if (classificationView === 'status') {
        list = selectedMainProducts.filter(p => (p.fabricProfile?.stockStatus || p.status || '状态未填') === selectedSubId);
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
        (p.fabricCustomerCodes || []).some(item => item.clientCode.toLowerCase().includes(lower)) ||
        (p.fabricCertifications || []).some(item => item.certification.toLowerCase().includes(lower))
      );
    }
    const priceOf = (product: ProductAsset, type: string) => product.fabricPrices?.find(price => price.priceType === type && !price.deletedAt)?.amount || 0;
    const missingCountOf = (product: ProductAsset) => {
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
          primary = cmpStr(a.fabricProfile?.articleNo || '', b.fabricProfile?.articleNo || '');
          break;
        case 'millQuality':
          primary = cmpStr(a.fabricProfile?.millQuality || '', b.fabricProfile?.millQuality || '');
          break;
        case 'millOrg':
          primary = cmpStr(a.fabricProfile?.millOrganizationId || '', b.fabricProfile?.millOrganizationId || '');
          break;
        case 'clientCode':
          primary = cmpStr(clientCodesJoined(a), clientCodesJoined(b));
          break;
        case 'factoryPrice':
          primary = cmpNum(priceOf(a, 'factory'), priceOf(b, 'factory'));
          break;
        case 'salesPrice':
          primary = cmpNum(priceOf(a, 'customer'), priceOf(b, 'customer'));
          break;
        case 'stock': {
          const qa = a.fabricProfile?.stockQuantity ?? 0;
          const qb = b.fabricProfile?.stockQuantity ?? 0;
          primary = cmpNum(qa, qb);
          if (primary === 0) {
            primary = dir * (a.fabricProfile?.stockStatus || '').localeCompare(b.fabricProfile?.stockStatus || '', 'zh-Hans-CN');
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
    if (!isFabricContext && existing?.mainCategory !== 'Fabric') return existing?.fabricProfile;
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

  const detailValue = (value?: string | number | null) => {
    if (value === null || value === undefined || value === '') return '未填';
    return String(value);
  };

  const DetailItem = ({ label, value, wide = false }: { label: string; value?: string | number | null; wide?: boolean }) => (
    <div className={`${wide ? 'md:col-span-2' : ''} ${PRODUCT_DETAIL_ITEM_CLASS}`}>
      <div className={`text-[10px] font-light tracking-wide text-[var(--text-tertiary)]`}>{label}</div>
      <div className={`mt-1 text-sm font-light whitespace-pre-wrap break-words text-[var(--text-primary)]`}>{detailValue(value)}</div>
    </div>
  );

  const DetailSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="space-y-3">
      <h4 className={`text-xs font-light tracking-wide text-[var(--text-tertiary)]`}>{title}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </section>
  );

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

  const productFieldShellClass = `rounded-full border outline-none ${BAMBOOK_OS.typography.weight.ui} text-xs transition-all`;
  const productInputClass = `w-full h-9 px-3 ${productFieldShellClass} leading-none ${PRODUCT_FORM_FIELD_CLASS}`;
  const productTextareaClass = `w-full px-3 py-3 ${productFieldShellClass} leading-relaxed resize-none ${PRODUCT_FORM_FIELD_CLASS}`;
  const productLabelClass = `text-[10px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label} ml-1 ${PRODUCT_FORM_LABEL_CLASS}`;
  const productFormSectionTitleClass = PRODUCT_FORM_SECTION_TITLE_CLASS;
  const productFormMapIndexClass = PRODUCT_FORM_MAP_INDEX_CLASS;
  const productFormNestedRowClass = RELATIONS_FORM_NESTED_ROW_CLASS;
  const productFormQuietActionClass = RELATIONS_FORM_QUIET_ACTION_CLASS;
  const productActionButtonClass = PRODUCT_TITLE_BUTTON_CLASS;
  const productCardClass = PRODUCT_CARD_SURFACE_CLASS;
  const productToolbarSurfaceClass = PRODUCT_TOOLBAR_SURFACE_CLASS;
  const productTableHeaderClass = PRODUCT_TABLE_HEADER_CLASS;
  const productTableRowHoverClass = PRODUCT_TABLE_ROW_HOVER_CLASS;
  const productTableCellBorderClass = PRODUCT_TABLE_CELL_BORDER_CLASS;
  const productMutedTextClass = BAMBOOK_OS.tone.text.quiet;
  const productGlassPanelClass = `${OS_MATERIAL.framePanel} bambook-panel-glass bambook-outer-panel`;
  const productFloatingPanelClass = `${OS_MATERIAL.floatingOverlay} bambook-panel-glass`;
  const productStatusChipClass = (complete: boolean) =>
    complete
      ? 'bg-[var(--os-vnext-brand-blue)]/6 text-[var(--os-vnext-brand-blue-strong)] border-[var(--border-c-default)] dark:bg-[var(--os-vnext-brand-blue)]/10 dark:text-[var(--os-vnext-brand-blue-soft)] dark:shadow-none'
      : 'bg-[var(--recessed-bg)] text-[var(--text-tertiary)] border-[var(--border-c-subtle)]';
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
          <div className={`font-light text-[var(--text-primary)]`}>{product.name}</div>
          <div className={`text-[var(--text-tertiary)] mt-1`}>{product.status}</div>
        </div>
      ),
    },
    {
      id: 'articleNo',
      header: 'Article',
      widthClass: 'w-[9%]',
      render: (product: ProductAsset) => <div className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{product.fabricProfile?.articleNo || '未填'}</div>,
    },
    {
      id: 'millQuality',
      header: 'Mill Quality',
      widthClass: 'w-[10%]',
      render: (product: ProductAsset) => <div className={`px-4 py-3 whitespace-nowrap ${productMutedTextClass}`}>{product.fabricProfile?.millQuality || '未填'}</div>,
    },
    {
      id: 'millOrg',
      header: '供应商',
      widthClass: 'w-[12%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 min-w-[140px]">{product.fabricProfile?.millOrganizationId || '未填'}</div>,
    },
    {
      id: 'clientCode',
      header: 'Client Code',
      widthClass: 'w-[12%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 min-w-[140px]">{clientCodeText(product)}</div>,
    },
    {
      id: 'factoryPrice',
      header: '工厂价',
      widthClass: 'w-[8%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 whitespace-nowrap">{formatPrice(product, 'factory')}</div>,
    },
    {
      id: 'salesPrice',
      header: '售价',
      widthClass: 'w-[8%]',
      render: (product: ProductAsset) => <div className="px-4 py-3 whitespace-nowrap">{formatPrice(product, 'customer')}</div>,
    },
    {
      id: 'stock',
      header: '库存',
      widthClass: 'w-[11%]',
      render: (product: ProductAsset) => (
        <div className="px-4 py-3 whitespace-nowrap">
          {(product.fabricProfile?.stockStatus || '未填')} / {formatMeasure(product.fabricProfile?.stockQuantity, product.fabricProfile?.stockUnit)}
        </div>
      ),
    },
    {
      id: 'completeness',
      header: '补全',
      widthClass: 'w-[11%]',
      render: (product: ProductAsset) => (
        <div className="px-4 py-3 min-w-[140px]">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-light ${productStatusChipClass(fabricCompleteness(product).complete)}`}>
            {fabricCompleteness(product).complete ? <CheckCircle2 size={12} strokeWidth={1.5} /> : <AlertTriangle size={12} strokeWidth={1.5} />}
            {fabricCompleteness(product).complete ? '完整' : `缺 ${fabricCompleteness(product).missing.length} 项`}
          </span>
          {!fabricCompleteness(product).complete && (
            <div className={`mt-1 text-[10px] truncate text-[var(--text-tertiary)]`}>
              {fabricCompleteness(product).missing.slice(0, 2).join('、')}
              {fabricCompleteness(product).missing.length > 2 ? '…' : ''}
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
      <SpotlightCard
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
        <span className={`relative z-10 px-2 text-[10px] font-light tracking-[0.18em] uppercase text-[var(--text-tertiary)]`}>
          筛选
        </span>
        <CustomSelect
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
      </SpotlightCard>
    );
  };

  const renderProductListToolbar = (embedded = false) => (
    <SpotlightCard
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
        <Search className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--text-tertiary)]`} size={14} />
        <input
          placeholder="搜索 SKU、款名..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className={`h-9 w-full rounded-control border pl-10 pr-3 outline-none font-light text-xs ${PRODUCT_TOOLBAR_SEARCH_CLASS}`}
        />
      </div>

      <div className="w-[170px] shrink-0">
        <CustomSelect
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
          className={`${PRODUCT_SEGMENT_BUTTON_CLASS} text-[var(--text-primary)] opacity-100 `}
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
    </SpotlightCard>
  );

  const renderFabricProfileFields = (product?: ProductAsset | null) => {
    if (!isFabricContext && product?.mainCategory !== 'Fabric') return null;
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
    const sku = String(formData.get('sku') || '').trim();
    const articleNo = String(formData.get('articleNo') || '').trim();
    const subCategoryId = selectedSubId === ALL_PRODUCTS_CATEGORY_ID || selectedSubId === UNCATEGORIZED_CATEGORY_ID
      ? 'uncategorized'
      : selectedSubId;
    const newItem: ProductAsset = {
      id,
      sku,
      name: articleNo || sku,
      mainCategory: selectedMain,
      subCategoryId,
      season: '',
      cost: 0,
      status: 'Development',
      updatedAt: Date.now(),
      fabricProfile: fabricProfile ? { ...fabricProfile, productAssetId: id } : undefined,
    };
    Object.assign(newItem, buildFabricRelatedDataFromForm(formData, id));
    const payload = { ...newItem, fabricProfile: newItem.fabricProfile || undefined };
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
    const updated: ProductAsset = {
      ...editingProd,
      sku,
      name: articleNo || sku,
      season: editingProd.season || '',
      cost: editingProd.cost || 0,
      status: editingProd.status || 'Development',
      updatedAt: Date.now(),
    };
    const fabricProfile = buildFabricProfileFromForm(formData, updated);
    if (fabricProfile) {
      updated.fabricProfile = { ...fabricProfile, productAssetId: updated.id };
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
      } catch (error: any) {
        setProductWriteError(error?.message || String(error));
      }
      return;
    }
    setDeleteProdId(null);
  };

  const pdmlRawValue = (row: PdmlRawFabric, key: string) => String(row.rawData?.[key] ?? '').trim();

  const productDetailOpen = !!selectedProduct;
  const hideUnderlyingProductPage = fullscreenProductFormOpen || productDetailOpen;
  const productContentCanvasClass = isMobile ? 'w-full' : BAMBOOK_OS.layout.desktopPageCanvasClass;

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-visible">
      {/* Primary Header - fixed, transparent title/navigation system. */}
      <PageHeader
        title="数字档案"
        subtitle="Digital Archive"
        isDarkMode={isDarkMode}
        hidden={hideUnderlyingProductPage}
        safeLeftStyle={PRODUCT_TITLE_SAFE_LEFT_STYLE}
        breadcrumb={(
          <>
        <div className={`${PRODUCT_TITLE_NAV_GROUP_CLASS} shrink-0`}>
          {navLevel !== 'main' && (
            <SpotlightCard
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
            </SpotlightCard>
          )}
          <div className={`h-9 flex items-center gap-1.5 min-w-0 text-[11px] font-light tracking-wide text-[var(--text-tertiary)]`}>
            {selectedMain && (
              <>
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
                  className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} bg-transparent border-0 p-0 rounded-none shadow-none transition-colors text-[var(--text-secondary)] hover:text-[var(--os-vnext-brand-blue)] dark:hover:text-[var(--text-primary)]`}
                >
                  {mainCategories.find(c => c.id === selectedMain)?.label}
                </button>
              </>
            )}
            {navLevel === 'list' && selectedSubId && (
              <>
                <span data-ui-lab-wallpaper-contrast="secondary" className={PRODUCT_TITLE_SEPARATOR_CLASS}>
                  <ChevronRight size={18} strokeWidth={1.4} />
                </span>
                <span data-ui-lab-wallpaper-contrast="primary" className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} text-[var(--text-secondary)]`}>
                  {selectedSubId === ALL_PRODUCTS_CATEGORY_ID
                    ? '全部档案'
                    : categoryGroups.find(group => group.id === selectedSubId)?.name || '列表'}
                </span>
              </>
            )}
          </div>
        </div>
          </>
        )}
        center={(
          <>
        <div className="mx-4 flex h-full min-w-0 flex-1 items-center justify-center">
          {navLevel === 'sub' && renderClassificationTabBar(true)}
          {navLevel === 'list' && renderProductListToolbar(true)}
        </div>
          </>
        )}
        actions={(
          <>
        <div className="flex h-full items-center gap-2 shrink-0">
          {productWriteError && (
            <div className={`max-w-[280px] truncate text-[11px] font-light text-[var(--text-secondary)]`}>
              {productWriteError}
            </div>
          )}
          {navLevel === 'sub' && (
            <SpotlightCard
              spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
              spotlightSize={isDarkMode ? 180 : 140}
              idleSpotlightOpacity={0}
              activeSpotlightOpacity={1}
              className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass}`}
            >
            <button onClick={() => setshowAddSubModal(true)} data-ui-lab-wallpaper-contrast="primary" className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2">
              <FolderPlus size={14} strokeWidth={1} /> 新增子分类
            </button>
            </SpotlightCard>
          )}
          {navLevel === 'list' && isPdmlRawView && (
            <>
              <SpotlightCard
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
              </SpotlightCard>
              <SpotlightCard
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
              </SpotlightCard>
            </>
          )}
          {navLevel === 'list' && !isPdmlRawView && (
            <SpotlightCard
              spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
              spotlightSize={isDarkMode ? 180 : 140}
              idleSpotlightOpacity={0}
              activeSpotlightOpacity={1}
              className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass}`}
            >
              <button onClick={() => setShowAddProdModal(true)} data-ui-lab-wallpaper-contrast="primary" className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2">
                <Plus size={14} strokeWidth={1} /> 录入档案
              </button>
            </SpotlightCard>
          )}
        </div>
          </>
        )}
      />

      <div className={`${productContentCanvasClass} flex-1 overflow-visible ${hideUnderlyingProductPage ? 'hidden' : ''}`}>
        {navLevel === 'main' && (
          <div className="relative h-full overflow-hidden">
          <motion.div
            layout
            ref={mainCategoryScrollRef}
            transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION }}
            className={`${isMobile ? `h-full overflow-y-scroll grid grid-cols-2 gap-3 px-3 pt-5 pb-28 content-start ${BAMBOOK_OS.layout.panelShadowViewportClass}` : `absolute -top-16 inset-x-0 bottom-0 overflow-y-scroll ${PRODUCT_CATEGORY_CARD_GRID_CLASS} ${BAMBOOK_OS.layout.panelShadowViewportClass} px-8 pt-[104px] pb-8`}`}
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
                <div className={`relative z-10 -ml-1 -mt-1 ${isMobile ? 'mb-3 flex h-9 w-9' : 'mb-4 flex h-10 w-10'} items-center justify-center transition-colors duration-300 text-[var(--os-vnext-brand-blue)] group-hover:text-[var(--text-primary)]`}>
                  <cat.icon size={24} strokeWidth={1} />
                </div>

                <h3 className={`relative z-10 ${isMobile ? 'text-sm' : 'text-base'} font-light tracking-tight text-[var(--text-primary)]`}>
                  {cat.label}
                </h3>
                <p className={`relative z-10 ${isMobile ? 'text-[10px] line-clamp-2' : 'text-[12px] line-clamp-3'} mt-2 font-light leading-relaxed text-[var(--text-tertiary)]`}>
                  {cat.desc}
                </p>

                <div className={`relative z-10 mt-auto flex items-center gap-2 pt-4 border-t w-full border-[var(--border-c-default)]`}>
                  <span className={`text-[9px] font-light tracking-wide flex items-center gap-1.5 text-[var(--text-tertiary)]`}>
                    <Library size={12} strokeWidth={1.5} className="text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)]" />
                    {products.filter(p => p.mainCategory === cat.id && !p.deletedAt).length} SKU 档案
                  </span>
                </div>
              </CompiledMotionInteractiveCard>
            ))}
          </motion.div>
          </div>
        )}

        {navLevel === 'sub' && (
          <div className={isMobile ? 'h-full overflow-visible px-3 pb-24 pt-5' : BAMBOOK_OS.layout.desktopTablePanelShellCompactClass}>
            <motion.div
              layout
              transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION }}
              className={`${productGlassPanelClass} overflow-hidden flex h-full min-h-0 flex-col`}
            >
              <div className={`hidden md:grid shrink-0 grid-cols-[minmax(0,1.35fr)_120px_minmax(180px,0.9fr)_108px] items-center gap-5 border-b px-6 py-3 text-[10px] font-light tracking-wide border-[var(--border-c-default)] text-[var(--text-tertiary)]`}>
                <span>索引</span>
                <span>档案</span>
                <span>摘要</span>
                <span className="text-right">操作</span>
              </div>
              <div ref={subIndexScrollRef} className={`flex-1 min-h-0 overflow-y-scroll ${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-full-bleed-row-viewport`}>
                {categoryGroups.length === 0 && (
                  <div className={`flex min-h-[360px] flex-col items-center justify-center px-6 text-center ${productMutedTextClass}`}>
                    <Archive size={34} strokeWidth={1} className={'text-[var(--text-tertiary)]'} />
                    <div className={`mt-4 text-sm font-light text-[var(--text-secondary)]`}>当前分类暂无索引</div>
                    <div className="mt-2 max-w-sm text-xs font-light leading-relaxed">
                      这个主类目还没有子分类或可分组档案。可以新增子分类，或返回选择有数据的类目。
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
                    className={`group relative isolate cursor-pointer overflow-hidden ${PRODUCT_SUB_INDEX_ROW_CLASS} px-4 py-0 text-left transition-[background,box-shadow,color,transform] duration-200 border-[var(--border-c-default)] hover:bg-[var(--hover-darken)]`}
                    data-glass-edge-mask
                  >
                    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1.35fr)_120px_minmax(180px,0.9fr)_108px] md:gap-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center transition-colors duration-300 text-[var(--os-vnext-brand-blue)] group-hover:text-[var(--text-primary)]`}>
                          {group.id === UNCATEGORIZED_CATEGORY_ID
                            ? <Archive size={20} strokeWidth={1} />
                            : <LayoutGrid size={20} strokeWidth={1} />
                          }
                        </div>
                        <div className="min-w-0">
                          <h4 className={`truncate text-sm font-light text-[var(--text-primary)]`}>{group.name}</h4>
                          <p className={`mt-1 truncate text-[10px] font-light md:hidden text-[var(--text-tertiary)]`}>{group.description}</p>
                        </div>
                      </div>

                      <div className="hidden md:flex min-w-0 flex-col gap-1">
                        <span className={`text-sm font-light text-[var(--text-primary)]`}>{group.count}</span>
                        <div className={`h-1 w-full overflow-hidden rounded-full bg-[var(--recessed-bg)]`}>
                          <span
                            className={`block h-full rounded-full bg-[var(--os-vnext-brand-blue)]/45 dark:bg-[var(--os-vnext-brand-blue)]/55`}
                            style={{ width: `${Math.min(100, Math.max(4, ratio))}%` }}
                          />
                        </div>
                      </div>

                      <p className={`hidden md:block min-w-0 truncate text-xs font-light text-[var(--text-tertiary)]`}>
                        {group.description}
                      </p>

                      <div className="flex items-center justify-end gap-1">
                        <span className={`md:hidden text-xs font-light text-[var(--text-secondary)]`}>{group.count}</span>
                        {editableCategory && (
                          <>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingSub(editableCategory);
                              }}
                              className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${productActionButtonClass} ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
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
                              className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${productActionButtonClass} ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                              aria-label={`删除${group.name}`}
                            >
                              <Trash2 size={13} strokeWidth={1.4} />
                            </button>
                          </>
                        )}
                        <ChevronRight size={16} strokeWidth={1.4} className={'text-[var(--text-tertiary)]'} />
                      </div>
                    </div>
                  </CompiledMotionInteractiveCard>
                );
              })}
              </div>
            </motion.div>
          </div>
        )}

        {navLevel === 'list' && (
          <div className="h-full flex flex-col">
            {isPdmlRawView ? (
              <div className={BAMBOOK_OS.layout.desktopTablePanelShellClass}>
                <div className={`flex h-full min-h-0 w-full flex-col rounded-card border overflow-hidden ${productGlassPanelClass}`}>
                  <div className={`shrink-0 px-6 py-4 border-b border-[var(--border-c-default)]`}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className={`text-sm font-light text-[var(--text-primary)]`}>庞大面料原始缓存</div>
                        <div className={`mt-1 text-[11px] font-light ${productMutedTextClass}`}>
                          {pdmlRawLoading && pdmlRawFabrics.length === 0 ? '读取中' : `已加载 ${pdmlRawFabrics.length} / ${pdmlRawTotal || pdmlRawFabrics.length} 条缓存记录`}
                          {pdmlRawSyncedAt ? ` · 最近同步 ${new Date(pdmlRawSyncedAt).toLocaleString()}` : ''}
                        </div>
                      </div>
                      {pdmlRawError && (
                        <div className={`max-w-[420px] truncate text-[11px] font-light text-[var(--text-secondary)]`}>
                          {pdmlRawError}
                        </div>
                      )}
                    </div>
                  </div>
                  <ScrollEdgeFades
                    scrollRef={pdmlRawScrollRef}
                    isDarkMode={isDarkMode}
                    variant="normal"
                    renderMode="content-mask"
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
                      <thead className={`${productTableHeaderClass} text-[var(--text-tertiary)]`}>
                        <tr>
                          {['条码', '公司品号', '工厂品号', '供应商', '系列', '成份', '克重', '门幅', '登记', '状态'].map(header => (
                            <th key={header} className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} tracking-wide whitespace-nowrap ${productTableCellBorderClass}`}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className={`divide-y divide-white/28 dark:divide-white/[0.045]`}>
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
              <motion.div
                layout
                ref={productGridScrollRef}
                transition={{ layout: PRODUCT_CARD_LAYOUT_TRANSITION }}
                className={`h-full overflow-y-scroll ${PRODUCT_CARD_GRID_CLASS} ${BAMBOOK_OS.layout.panelShadowViewportClass} p-8`}
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
                      onClick={() => setSelectedProduct(product)}
                      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                      spotlightSize={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_SIZE : PRODUCT_CARD_SPOTLIGHT_LIGHT_SIZE}
                      idleSpotlightOpacity={0}
                      liquidSpotlight
                      liquidSpotlightTone="light"
                      className={`group relative isolate overflow-hidden p-6 h-[220px] rounded-card-lg text-left transition-colors duration-200 ${productCardClass}`}
                      data-glass-edge-mask
                    >
                      <div className="relative z-10 flex justify-between items-start mb-3">
                        <div className={`-ml-1 -mt-1 flex h-10 w-10 items-center justify-center transition-colors duration-300 text-[var(--os-vnext-brand-blue)] group-hover:text-[var(--text-primary)]`}>
                          <Library size={22} strokeWidth={1} />
                        </div>
                        <span className={`px-2.5 py-1 rounded-full border text-[9px] font-light tracking-wide ${productStatusChipClass(fabricCompleteness(product).complete)}`}>
                          {fabricCompleteness(product).complete ? '完整' : `待补 ${fabricCompleteness(product).missing.length}`}
                        </span>
                      </div>

                      <h3 className={`relative z-10 text-base font-light line-clamp-1 text-[var(--text-primary)]`}>
                        {product.name}
                      </h3>
                      <p className={`relative z-10 text-xs font-light mt-1 text-[var(--text-tertiary)]`}>
                        {product.fabricProfile?.articleNo || product.sku}
                      </p>

                      <div className="relative z-10 mt-3 space-y-1.5 flex-1 min-h-0">
                        <div className={`flex items-center gap-2 text-xs font-light text-[var(--text-tertiary)]`}>
                          <Tag size={12} strokeWidth={1.5} className={'text-[var(--text-tertiary)]'} />
                          <span className="truncate">{product.fabricProfile?.millQuality || 'Mill Quality 未填'}</span>
                        </div>
                        <div className={`flex items-center gap-2 text-xs font-light text-[var(--text-tertiary)]`}>
                          <Box size={12} strokeWidth={1.5} className={'text-[var(--text-tertiary)]'} />
                          <span className="truncate">{product.fabricProfile?.millOrganizationId || '供应商未填'}</span>
                        </div>
                      </div>

                      <div className={`relative z-10 mt-auto pt-3 border-t flex items-center justify-between gap-3 border-[var(--border-c-default)]`}>
                        <span className={`min-w-0 truncate text-[9px] font-light ${productMutedTextClass}`}>
                          {clientCodeText(product)}
                        </span>
                        <span className={`shrink-0 text-[9px] font-light text-[var(--text-tertiary)]`}>
                          {formatPrice(product, 'factory')}
                        </span>
                      </div>
                    </CompiledMotionInteractiveCard>
                  ))}
                </AnimatePresence>
                {currentProducts.length === 0 && (
                  <div className={`col-span-full flex min-h-[360px] flex-col items-center justify-center px-6 text-center ${productMutedTextClass}`}>
                    <Archive size={34} strokeWidth={1} className={'text-[var(--text-tertiary)]'} />
                    <div className={`mt-4 text-sm font-light text-[var(--text-secondary)]`}>当前视图下暂无档案</div>
                    <div className="mt-2 max-w-sm text-xs font-light leading-relaxed">
                      可以调整筛选、切换分类方式，或点击右上角录入档案。
                    </div>
                  </div>
                )}
              </motion.div>
              </div>
            ) : (
              <CompiledTableShell
                isDarkMode={isDarkMode}
                scrollRef={productTableScrollRef}
                shellBaseClassName={BAMBOOK_OS.layout.desktopTablePanelShellClass}
                panelClassName={productGlassPanelClass}
                edgeFade={{ topHeight: PRODUCT_EDGE_FADE_TOP_HEIGHT, topFadeStartOffset: PRODUCT_EDGE_FADE_TOP_START, bottomHeight: PRODUCT_EDGE_FADE_BOTTOM_HEIGHT }}
                header={(
                  <div className="shrink-0 overflow-hidden">
                    <div className={`flex w-full min-w-[1000px] text-left text-xs ${productTableHeaderClass} text-[var(--text-tertiary)]`}>
                      {productTableColumns.map(column => (
                        <div key={column.id} className={`${column.widthClass} px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} tracking-wide whitespace-nowrap ${productTableCellBorderClass}`}>{column.header}</div>
                      ))}
                      <div className={`w-[8%] px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} tracking-wide whitespace-nowrap ${productTableCellBorderClass}`}>操作</div>
                    </div>
                  </div>
                )}
                empty={currentProducts.length === 0 ? (
                  <div className={`p-12 text-center text-sm ${productMutedTextClass}`}>当前视图下暂无档案</div>
                ) : undefined}
              >
                <div className={`flex flex-col min-w-[1000px] text-left text-xs divide-y divide-white/28 dark:divide-white/[0.045]`}>
                      {currentProducts.map((product, idx) => (
                        <CompiledMotionInteractiveCard
                          as="div"
                          key={product.id}
                          onClick={() => setSelectedProduct(product)}
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
                                className={`p-2 rounded-control ${BAMBOOK_OS.controls.table.editAction}`}
                                aria-label="编辑档案"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDeleteProdId(product.id); }}
                                className={`p-2 rounded-control ${BAMBOOK_OS.controls.table.editAction}`}
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
      </div>

      {/* Mobile Options Sheet */}
      {isMobile && (
        <BottomSheet
          isOpen={!!showOptionsSheet}
          onClose={() => setShowOptionsSheet(null)}
          title={showOptionsSheet?.name || 'Item Options'}
          height="auto"
          isDarkMode={isDarkMode}
        >
          <div className="space-y-4 py-4">
            <button
              onClick={() => { if (showOptionsSheet) { setEditingProd(showOptionsSheet); setShowOptionsSheet(null); } }}
              className={`w-full p-4 rounded-full flex items-center gap-4 text-left font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}
            >
              <Edit2 size={18} /> 编辑产品信息
            </button>
            <button
              onClick={() => { if (showOptionsSheet) { setDeleteProdId(showOptionsSheet.id); setShowOptionsSheet(null); } }}
              className={`w-full p-4 rounded-full flex items-center gap-4 text-left font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}
            >
              <Trash2 size={18} /> 归档此产品
            </button>
          </div>
        </BottomSheet>
      )}

      {selectedProduct && (
        <div
          className="absolute inset-0 z-[80] flex items-center justify-center p-6 bg-transparent"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedProduct(null);
          }}
        >
          <CompiledSurfacePanel
            materialRole="framePanel"
            spotlight
            isDarkMode={isDarkMode}
            className={`${PRODUCT_DETAIL_PANEL_LAYOUT_CLASS} text-[var(--text-primary)]`}
            contentClassName={PRODUCT_DETAIL_PANEL_CONTENT_CLASS}
            data-os-compiler-role="product-detail-panel"
          >
            <div
              className={`${PRODUCT_DETAIL_MEDIA_PANEL_CLASS} border-r border-[var(--border-c-default)]`}
              data-os-compiler-role="product-detail-media-panel"
            >
              {(() => {
                const displayImages = getDisplayImages(selectedProduct);
                const primaryImage = displayImages[0];
                const primaryImageSrc = primaryImage ? getProductImageSrc(primaryImage) : '';
                return (
                  <>
                    <div className={PRODUCT_DETAIL_MEDIA_FRAME_CLASS}>
                      {primaryImageSrc ? (
                        <img src={primaryImageSrc} alt={primaryImage?.fileName || selectedProduct.name} className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-[var(--text-tertiary)]`}>
                          <ImageIcon size={34} strokeWidth={1.3} />
                          <div className="text-xs font-light leading-relaxed">
                            暂无产品图片
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={PRODUCT_DETAIL_MEDIA_META_CLASS}>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full border text-[10px] font-light tracking-wide ${productStatusChipClass(selectedProduct.status === 'Active')}`}>
                          {selectedProduct.status}
                        </span>
                        <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>{selectedProduct.mainCategory}</span>
                      </div>
                      <h3 className={`mt-4 text-xl font-light leading-tight tracking-tight text-[var(--text-primary)]`}>
                        {selectedProduct.name}
                      </h3>
                      <div className={`mt-3 flex items-center gap-2 text-xs text-[var(--text-tertiary)]`}>
                        <Tag size={13} strokeWidth={1.5} />
                        <span className="min-w-0 truncate">{selectedProduct.sku}</span>
                      </div>
                      <p className={`mt-2 text-xs font-light leading-relaxed text-[var(--text-tertiary)]`}>
                        {selectedProduct.fabricProfile?.colorDescription || selectedProduct.fabricProfile?.millQuality || selectedProduct.subCategoryId || '产品详情档案'}
                      </p>
                    </div>

                    {selectedProduct.mainCategory === 'Fabric' && (
                      <div className={PRODUCT_DETAIL_STATUS_PANEL_CLASS}>
                        <div className={`text-xs font-light flex items-center gap-2 ${fabricCompleteness(selectedProduct).complete ? 'text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)]' : productMutedTextClass}`}>
                          {fabricCompleteness(selectedProduct).complete ? <CheckCircle2 size={16} strokeWidth={1.5} /> : <AlertTriangle size={16} strokeWidth={1.5} />}
                          {fabricCompleteness(selectedProduct).complete ? '核心档案信息已完整' : `核心档案待补全：缺 ${fabricCompleteness(selectedProduct).missing.length} 项`}
                        </div>
                        <div className={`mt-3 h-2 rounded-full overflow-hidden bg-[var(--recessed-bg)]`}>
                          <div
                            className="h-full rounded-full bg-[var(--os-vnext-brand-blue)]"
                            style={{ width: `${fabricCompleteness(selectedProduct).percent}%` }}
                          />
                        </div>
                        {!fabricCompleteness(selectedProduct).complete && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {fabricCompleteness(selectedProduct).missing.map(label => (
                              <span key={label} className={`px-2.5 py-1 rounded-full border text-[10px] font-light ${productStatusChipClass(false)}`}>
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className={`mt-auto ${PRODUCT_DETAIL_MEDIA_META_CLASS}`}>
                      <div className={`text-[10px] font-light tracking-[0.22em] uppercase text-[var(--text-tertiary)]`}>
                        Media
                      </div>
                      <div className={`mt-1 text-xs font-light leading-relaxed text-[var(--text-tertiary)]`}>
                        {displayImages.length > 0 ? `${displayImages.length} 张图片 · 主图预览` : '编辑档案后可上传产品图片。'}
                      </div>
                      {displayImages.length > 1 && (
                        <div className="mt-4 grid grid-cols-4 gap-2">
                          {displayImages.slice(0, 4).map(image => {
                            const src = getProductImageSrc(image);
                            return (
                              <div key={image.id} className={`${OS_MATERIAL.insetSurface} relative aspect-square overflow-hidden rounded-inset border`}>
                                {src && <img src={src} alt={image.fileName} className="absolute inset-0 h-full w-full object-cover" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className={PRODUCT_DETAIL_MAIN_PANEL_CLASS} data-os-compiler-role="product-detail-main-panel">
              <div className={`${PRODUCT_DETAIL_HEADER_LAYOUT_CLASS} justify-end bg-[var(--recessed-bg)] border-[var(--border-c-default)] dark:bg-deep/52`}>
                <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => { setEditingProd(selectedProduct); setSelectedProduct(null); }}
                  className={`px-4 py-2 rounded-full text-xs font-light flex items-center gap-2 ${productActionButtonClass}`}
                >
                  <Edit2 size={14} /> 编辑
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className={`p-2 rounded-full ${productActionButtonClass}`}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className={PRODUCT_DETAIL_BODY_SCROLL_CLASS}>
              <DetailSection title="基础识别">
                <DetailItem label="SKU" value={selectedProduct.sku} />
                <DetailItem label="Article No." value={selectedProduct.fabricProfile?.articleNo} />
                <DetailItem label="供应商 / 生产工厂" value={selectedProduct.fabricProfile?.millOrganizationId} />
                <DetailItem label="Mill Quality" value={selectedProduct.fabricProfile?.millQuality} />
                <DetailItem label="Col." value={selectedProduct.fabricProfile?.millColorCode} />
                <DetailItem label="Description" value={selectedProduct.fabricProfile?.colorDescription} wide />
                <DetailItem label="Client Code" value={(selectedProduct.fabricCustomerCodes || []).map(item => item.clientCode).join(', ')} wide />
              </DetailSection>

              <DetailSection title="规格参数">
                <DetailItem label="成分" value={(selectedProduct.compositionLines || []).map(line => `${line.percentage}% ${line.term?.chineseName || line.term?.englishName || line.termId}`).join(' + ')} wide />
                <DetailItem label="克重" value={formatMeasure(selectedProduct.fabricProfile?.weightValue, selectedProduct.fabricProfile?.weightUnit)} />
                <DetailItem label="门幅" value={formatWidth(selectedProduct.fabricProfile)} />
                <DetailItem label="组织" value={selectedProduct.fabricProfile?.construction} />
                <DetailItem label="纱支" value={selectedProduct.fabricProfile?.yarnCount} />
                <DetailItem label="花型" value={selectedProduct.fabricProfile?.pattern} />
                <DetailItem label="生产周期" value={selectedProduct.fabricProfile?.productionLeadDays ? `${selectedProduct.fabricProfile.productionLeadDays} 天` : undefined} />
              </DetailSection>

              <DetailSection title="价格与库存">
                <DetailItem label="工厂价格" value={formatPrice(selectedProduct, 'factory')} />
                <DetailItem label="售价" value={formatPrice(selectedProduct, 'customer')} />
                <DetailItem label="现货状态" value={selectedProduct.fabricProfile?.stockStatus} />
                <DetailItem label="现货数量" value={formatMeasure(selectedProduct.fabricProfile?.stockQuantity, selectedProduct.fabricProfile?.stockUnit)} />
                <DetailItem label="起订量" value={selectedProduct.fabricProfile?.moqValue} />
                <DetailItem label="工厂起订量" value={selectedProduct.fabricProfile?.factoryMoqValue} />
                <DetailItem label="试样起订量" value={selectedProduct.fabricProfile?.sampleMoqValue} />
              </DetailSection>

              <section className="space-y-3">
                <h4 className={`text-xs font-light tracking-wide text-[var(--text-tertiary)]`}>价格历史</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(['factory', 'customer'] as const).map(type => (
                    <div key={type} className={PRODUCT_DETAIL_HISTORY_PANEL_CLASS}>
                      <div className={`text-[10px] font-light tracking-wide mb-3 text-[var(--text-tertiary)]`}>
                        {type === 'factory' ? '工厂价格历史' : '售价历史'}
                      </div>
                      <div className="space-y-2">
                        {priceHistoryRows(selectedProduct, type).length > 0 ? priceHistoryRows(selectedProduct, type).slice(0, 5).map(price => (
                          <div key={price.id} className={`flex items-center justify-between gap-3 rounded-control px-3 py-2 bds-inset`}>
                            <span className={`text-xs font-light text-[var(--text-primary)]`}>
                              {price.currency} {price.amount}{price.unit ? ` / ${price.unit}` : ''}
                            </span>
                            <span className={`text-[10px] text-[var(--text-tertiary)]`}>
                              {price.effectiveDate || new Date(price.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        )) : (
                          <div className={`text-xs text-[var(--text-tertiary)]`}>暂无历史价格</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <DetailSection title="生产追溯与风险">
                <DetailItem label="标样批号" value={selectedProduct.fabricProfile?.referenceBatch} />
                <DetailItem label="认证许可" value={certificationText(selectedProduct)} wide />
                <DetailItem label="品质风险" value={selectedProduct.fabricProfile?.riskNote} wide />
                <DetailItem label="特殊备注" value={selectedProduct.fabricProfile?.specialNote} wide />
              </DetailSection>

              <RelatedOrders productId={selectedProduct.id} millQuality={selectedProduct.fabricProfile?.millQuality} cloudEndpoint={cloudEndpoint} isDarkMode={isDarkMode} />
              </div>
            </div>
          </CompiledSurfacePanel>
        </div>
      )}

      {/* MODALS / SHEETS */}
      {isMobile ? (
        <>
          {/* Mobile: Add Sub Category Sheet */}
          <BottomSheet isOpen={showAddSubModal || !!editingSub} onClose={() => { setshowAddSubModal(false); setEditingSub(null); }} title={editingSub ? '编辑类目' : '新增子分类'} height="auto" isDarkMode={isDarkMode}>
            <form onSubmit={editingSub ? handleEditSub : handleAddSub} className="space-y-6 pt-4 pb-12">
              <div className="space-y-4">
                <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">分类名称</label>
                <input defaultValue={editingSub?.name} name="name" required className={`w-full px-6 py-4 rounded-full outline-none font-light bg-[var(--recessed-bg)] border-[var(--border-c-subtle)] dark:bg-deep/80 dark:border-[var(--border-c-default)] dark:text-[var(--text-primary)]`} />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">分类说明</label>
                <textarea defaultValue={editingSub?.description || ''} name="description" rows={3} className={`w-full px-6 py-4 rounded-full outline-none font-light resize-none bg-[var(--recessed-bg)] border-[var(--border-c-subtle)] dark:bg-deep/80 dark:border-[var(--border-c-default)] dark:text-[var(--text-primary)]`} />
              </div>
              <button type="submit" className={`w-full py-4 rounded-full font-light tracking-wide transition-all bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] border border-[var(--border-c-default)] hover:bg-[var(--active-darken)]`}>{editingSub ? '保存' : '确认'}</button>
            </form>
          </BottomSheet>

          {/* Mobile: Add Product Sheet */}
          <BottomSheet isOpen={showAddProdModal || !!editingProd} onClose={() => { setShowAddProdModal(false); setEditingProd(null); }} title={editingProd ? '修正档案' : '录入 SKU'} height="full" isDarkMode={isDarkMode}>
            <form onSubmit={editingProd ? handleEditProduct : handleAddProduct} className="space-y-6 pt-2 pb-24">
              {editingProd && (
                <div className="space-y-3">
                  <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">产品图片</label>
                  <ImageUploader
                    productId={editingProd.id}
                    images={editingImages}
                    cloudEndpoint={cloudEndpoint}
                    isDarkMode={isDarkMode}
                    onChange={setEditingImages}
                  />
                </div>
              )}
              <div className="space-y-3">
                <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">档案款名 (Name)</label>
                <input defaultValue={editingProd?.name} name="name" required className={`w-full px-6 py-4 rounded-full outline-none font-light bg-[var(--recessed-bg)] border-[var(--border-c-subtle)] dark:bg-deep/80 dark:border-[var(--border-c-default)] dark:text-[var(--text-primary)]`} />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">SKU</label>
                <input defaultValue={editingProd?.sku} name="sku" required className={`w-full px-6 py-4 rounded-full outline-none font-light bg-[var(--recessed-bg)] border-[var(--border-c-subtle)] dark:bg-deep/80 dark:border-[var(--border-c-default)] dark:text-[var(--text-primary)]`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">Season</label>
                  <input defaultValue={editingProd?.season} name="season" placeholder="AW25" required className={`w-full px-6 py-4 rounded-full outline-none font-light bg-[var(--recessed-bg)] border-[var(--border-c-subtle)] dark:bg-deep/80 dark:border-[var(--border-c-default)] dark:text-[var(--text-primary)]`} />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">Cost ($)</label>
                  <input defaultValue={editingProd?.cost} type="number" step="0.01" name="cost" required className={`w-full px-6 py-4 rounded-full outline-none font-light bg-[var(--recessed-bg)] border-[var(--border-c-subtle)] dark:bg-deep/80 dark:border-[var(--border-c-default)] dark:text-[var(--text-primary)]`} />
                </div>
              </div>
              {renderFabricProfileFields(editingProd)}
              <div className="space-y-3">
                <label className="text-[10px] font-light text-[var(--text-tertiary)] tracking-wide ml-1">Status</label>
                <input type="hidden" name="status" value={productStatusValue} />
                <CustomSelect
                  value={productStatusValue}
                  onChange={setProductStatusValue}
                  isDarkMode={isDarkMode}
                  options={productStatusOptions}
                  surface="form"
                  menuPortal
                  className="w-full"
                />
              </div>
              <button type="submit" className={`w-full py-5 rounded-full font-light tracking-wide mt-4 transition-all bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] border border-[var(--border-c-default)] hover:bg-[var(--active-darken)]`}>{editingProd ? '保存修正' : '确认录入'}</button>
            </form>
          </BottomSheet>
        </>
      ) : (
        <>
          {(showAddSubModal || editingSub) && (
            <motion.div
              className={`absolute inset-0 z-[70] flex items-center justify-center p-6 backdrop-blur-md bg-slate-950/60`}
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
                <div className={`px-8 py-6 border-b border-[var(--border-c-default)]`}>
                  <p className={`text-[10px] font-light tracking-[0.24em] uppercase text-[var(--text-tertiary)]`}>
                    {mainCategories.find(c => c.id === selectedMain)?.label || 'Digital Archive'}
                  </p>
                  <h3 className={`mt-1 text-xl font-light tracking-tight text-[var(--text-primary)]`}>
                    {editingSub ? '编辑子分类' : '新增子分类'}
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
                <div className={`px-8 py-5 border-t flex justify-end gap-3 border-[var(--border-c-default)] bg-[var(--recessed-bg)] dark:bg-deep/26`}>
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
                <CompiledModuleTitleBar
                  template="products-module-title"
                  source="ProductsManager.productFormTitle"
                  baseClassName={PRODUCT_TITLE_BAR_CLASS}
                  style={PRODUCT_TITLE_SAFE_LEFT_STYLE}
                  leading={(
                    <>
                  <div className={PRODUCT_TITLE_NAV_GROUP_CLASS}>
                    <SpotlightCard
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
                    </SpotlightCard>
                    <div className={`h-9 flex items-center gap-1.5 min-w-0 text-[11px] font-light tracking-wide text-[var(--text-tertiary)]`}>
                      <button type="button" onClick={() => { setShowAddProdModal(false); setEditingProd(null); }} className={`${PRODUCT_TITLE_TEXT_BUTTON_CLASS} text-[var(--text-primary)] hover:text-[var(--os-vnext-brand-blue)]`}>
                        <span className={`${BAMBOOK_OS.layout.desktopTitleTextClass} text-[var(--text-primary)]`}>
                          数字档案
                        </span>
                      </button>
                      <span data-ui-lab-wallpaper-contrast="secondary" className={PRODUCT_TITLE_SEPARATOR_CLASS}>
                        <ChevronRight size={18} strokeWidth={1.4} />
                      </span>
                      <h3 data-ui-lab-wallpaper-contrast="primary" className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} text-[var(--text-secondary)]`}>{editingProd ? '修正档案' : '录入档案'}</h3>
                    </div>
                  </div>
                    </>
                  )}
                  actions={(
                    <>
                  <div className="flex h-full items-center gap-2 shrink-0">
                    {editingProd && (
                      <button
                        type="button"
                        onClick={() => setDeleteProdId(editingProd.id)}
                        className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[11px] font-light tracking-wide transition-all border text-[var(--text-secondary)] border-[var(--border-c-default)] hover:bg-[var(--recessed-bg-hover)] hover:border-[var(--border-c-default)]`}
                      >
                        <Trash2 size={13} strokeWidth={1.5} /> 归档
                      </button>
                    )}
                    <SpotlightCard
                      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                      spotlightSize={isDarkMode ? 180 : 140}
                      idleSpotlightOpacity={0}
                      activeSpotlightOpacity={1}
                      className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass}`}
                    >
                      <button type="button" onClick={() => { setShowAddProdModal(false); setEditingProd(null); }} data-ui-lab-wallpaper-contrast="primary" className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center">
                        取消
                      </button>
                    </SpotlightCard>
                    <SpotlightCard
                      spotlightColor={isDarkMode ? PRODUCT_CARD_SPOTLIGHT_DARK_COLOR : PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR}
                      spotlightSize={isDarkMode ? 180 : 140}
                      idleSpotlightOpacity={0}
                      activeSpotlightOpacity={1}
                      className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${compositionTotalIsComplete ? productActionButtonClass : 'bg-[var(--recessed-bg-strong)] text-[var(--text-tertiary)] border-transparent cursor-not-allowed'}`}
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
                    </SpotlightCard>
                  </div>
                    </>
                  )}
                />
                <form id="product-fullscreen-form" onSubmit={editingProd ? handleEditProduct : handleAddProduct} className="w-full flex-1 min-h-0 px-7 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch">
                    <aside className="self-start">
                      <CompiledSurfacePanel materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={RELATIONS_FORM_MAP_PANEL_CLASS}>
                        <p className={`px-3 pb-3 text-[10px] font-light tracking-[0.22em] uppercase ${productFormSectionTitleClass}`}>Form Map</p>
                        <div className="space-y-1">
                          {productFormSections
                            .filter(section => section.id === 'basic' || isFabricContext || editingProd?.mainCategory === 'Fabric')
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
                                  <div className={`text-xs font-light text-[var(--text-secondary)]`}>{section.label}</div>
                                  <div className={`text-[10px] mt-0.5 truncate ${productLabelClass}`}>{section.desc}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </CompiledSurfacePanel>
                    </aside>

                    <div ref={productFormScrollRef} className={`bambook-product-form-scroll-viewport min-w-0 -mt-[112px] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px] ${BAMBOOK_OS.layout.panelShadowViewportClass}`}>
                      {/* Images section */}
                      {editingProd && (
                        <ProductFormSection id="images" title="产品图片" description="上传面料/产品的实物照片，第一张自动设为主图。" isDarkMode={isDarkMode}>
                          <ImageUploader
                            productId={editingProd.id}
                            images={editingImages}
                            cloudEndpoint={cloudEndpoint}
                            isDarkMode={isDarkMode}
                            onChange={setEditingImages}
                          />
                        </ProductFormSection>
                      )}
                      <ProductFormSection id="basic" title="基础信息" description="只保留这条档案最核心的身份信息：SKU、二维码、品号、克重、门幅和成分。" isDarkMode={isDarkMode}>
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
                          <div className="w-[116px] h-[116px] rounded-inset bds-inset border border-[var(--border-c-subtle)] flex items-center justify-center overflow-hidden shrink-0">
                            {skuQrDataUrl ? (
                              <img src={skuQrDataUrl} alt={`${skuForQr} QR Code`} className="w-full h-full object-contain" />
                            ) : (
                              <div className="w-full h-full" />
                            )}
                          </div>
                        </div>
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
                            <div className={`grid grid-cols-[90px_100px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-3 px-1 text-[10px] font-light tracking-wide text-[var(--text-tertiary)]`}>
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
                              <p className={`text-[11px] leading-relaxed text-[var(--text-tertiary)]`}>
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
                            <div className={`rounded-inset border px-4 py-3 text-[11px] font-light ${productFormNestedRowClass} text-[var(--text-secondary)]`}>
                              成分合计：{compositionTotal}% · {compositionValidationMessage}
                            </div>
                          </div>
                          {compositionDraftText() && (
                            <div className={`text-[11px] font-light text-[var(--text-tertiary)]`}>
                              当前成分：{compositionDraftText()}
                            </div>
                          )}
                        </div>
                      </ProductFormSection>
                      {renderFabricProfileFields(editingProd)}
                    </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {(deleteSubId || deleteProdId) && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`bg-[var(--bg-card)] dark:bg-deep/90 dark:border dark:border-[var(--border-c-default)] rounded-card w-full max-w-sm shadow-none overflow-hidden animate-in zoom-in duration-300 backdrop-blur-xl`}>
            <div className="p-10 text-center space-y-6">
              <div className={`w-20 h-20 rounded-control flex items-center justify-center mx-auto mb-2 border bg-[var(--recessed-bg)] text-[var(--text-secondary)] border-[var(--border-c-default)]`}>
                <AlertTriangle size={32} strokeWidth={1} />
              </div>
              <div className="space-y-2">
                <h3 className={`text-lg font-light text-[var(--text-primary)]`}>{deleteSubId ? '确认移除分类？' : '确认归档产品？'}</h3>
                <p className="text-sm text-[var(--text-tertiary)] font-light leading-relaxed">
                  {deleteSubId ? '该分类下的所有 SKU 将失去此分类关联，但原始档案不会被删除。' : '该产品 SKU 将从当前活跃列表中移除并存入历史档案库。'}
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={deleteSubId ? handleDeleteSub : handleDeleteProduct}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)] border border-[var(--border-c-default)]`}
                >
                  确认{deleteSubId ? '移除' : '归档'}
                </button>
                <button
                  onClick={() => { setDeleteSubId(null); setDeleteProdId(null); }}
                  className={`w-full py-4 rounded-full text-xs font-light tracking-wide transition-all bg-[var(--recessed-bg)] text-[var(--text-tertiary)] hover:bg-[var(--active-darken)]`}
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

export default ProductsManager;
