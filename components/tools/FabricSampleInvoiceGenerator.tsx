import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  ChevronDown,
  CheckCircle2,
  Download,
  FileCode,
  History,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Plus,
  Printer,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import CustomerSearchInput from '../ui/CustomerSearchInput';
import { BusinessProfile, ProductAsset, Relation } from '../../types';
import { apiService } from '../../services/apiService';
import {
  DEFAULT_SAMPLE_INVOICE_TEMPLATE,
  FabricSampleInvoiceItem,
  SampleInvoiceTemplateConfig,
  calculateInvoiceTotal,
  createEmptyFabricInvoiceItem,
  generateFabricSampleInvoiceHtml,
} from './sampleInvoiceTemplate';

declare global {
  interface Window {
    bambookInvoice?: {
      savePdf: (html: string, filename: string) => Promise<{ path: string }>;
    };
  }
}

const PROFILE_KIND = 'fabric-sample-invoice';
const HISTORY_PROFILE_KIND = 'fabric-sample-invoice-history';
const HISTORY_PROFILE_ID = 'BPROF-fabric-sample-invoice-history';
const LAST_PROFILE_STORAGE_KEY = 'bambook:last-business-profile:fabric-sample-invoice';
const LEGACY_TEMPLATE_STORAGE_KEY = 'bambook_fabric_sample_invoice_template_v1';
const LEGACY_HISTORY_STORAGE_KEY = 'bambook_fabric_sample_invoice_history_v1';

interface SavedFabricSampleInvoice {
  id: string;
  savedAt: number;
  invoiceNumber: string;
  invoiceDate: string;
  billToName: string;
  billToAddress: string;
  poNumber: string;
  items: FabricSampleInvoiceItem[];
  template: SampleInvoiceTemplateConfig;
}

interface CustomerOption {
  value: string;
  label: string;
  description?: string;
  billingAddress?: string;
  shippingAddress?: string;
  relation: Relation;
}

interface FabricSampleInvoiceGeneratorProps {
  isDarkMode: boolean;
  relations?: Relation[];
}

type AdjustableInvoiceAsset = 'logo' | 'stamp';
type ProductSuggestionMap = Record<string, ProductAsset[]>;
type SampleInvoiceProfilePayload = Omit<SampleInvoiceTemplateConfig, 'logoDataUrl' | 'stampDataUrl'>;
type SampleInvoiceProfileAssets = Pick<SampleInvoiceTemplateConfig, 'logoDataUrl' | 'stampDataUrl'>;
type SampleInvoiceBusinessProfile = BusinessProfile<SampleInvoiceProfilePayload, SampleInvoiceProfileAssets>;

const generateInvoiceNumber = (date: Date): string => {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 90) + 10);
  return `PDAS${yy}${mm}${dd}${seq}`;
};

const fieldClass = (isDarkMode: boolean, extra = '') =>
  `w-full px-3 py-2 rounded-control text-sm transition-colors focus:outline-none focus:border-[var(--os-vnext-brand-blue)] ${extra} ${
    isDarkMode
      ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-600'
      : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;

const labelClass = (isDarkMode: boolean) =>
  `block text-[10px] font-light uppercase tracking-wider mb-1 ${
    isDarkMode ? 'text-slate-500' : 'text-slate-400'
  }`;

const panelClass = (isDarkMode: boolean) =>
  `p-4 rounded-card ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`;

const readImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const loadLegacyTemplate = (): SampleInvoiceTemplateConfig | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_TEMPLATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SampleInvoiceTemplateConfig>;
    return { ...DEFAULT_SAMPLE_INVOICE_TEMPLATE, ...parsed };
  } catch {
    return null;
  }
};

const loadLegacySavedInvoices = (): SavedFabricSampleInvoice[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const clearLegacyInvoiceStorage = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LEGACY_TEMPLATE_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_HISTORY_STORAGE_KEY);
};

const loadLastProfileId = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(LAST_PROFILE_STORAGE_KEY) || '';
};

const saveLastProfileId = (profileId: string) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_PROFILE_STORAGE_KEY, profileId);
};

const splitTemplateForProfile = (template: SampleInvoiceTemplateConfig) => {
  const { logoDataUrl, stampDataUrl, ...payload } = template;
  return {
    payload: payload as SampleInvoiceProfilePayload,
    assets: { logoDataUrl, stampDataUrl },
  };
};

const templateFromProfile = (profile: SampleInvoiceBusinessProfile): SampleInvoiceTemplateConfig => ({
  ...DEFAULT_SAMPLE_INVOICE_TEMPLATE,
  ...(profile.payload || {}),
  ...(profile.assets || {}),
});

const profileInputFromTemplate = (template: SampleInvoiceTemplateConfig, name: string, id?: string) => {
  const { payload, assets } = splitTemplateForProfile(template);
  return {
    id,
    kind: PROFILE_KIND,
    name,
    payload,
    assets,
    isActive: true,
  };
};

const activeCustomerCode = (product: ProductAsset) =>
  (product.fabricCustomerCodes || []).find(code => !code.deletedAt && code.clientCode.trim())?.clientCode || '';

const fabricDisplayName = (product: ProductAsset) => {
  const profile = product.fabricProfile;
  return [
    profile?.articleNo,
    profile?.millQuality,
    profile?.millColorCode,
  ].filter(Boolean).join(' / ') || product.name || product.sku;
};

const latestPriceAmount = (product: ProductAsset) => {
  const prices = (product.fabricPrices || []).filter(price => !price.deletedAt && Number(price.amount) > 0);
  for (const priceType of ['sample', 'customer', 'factory', 'cutting']) {
    const matched = prices
      .filter(price => price.priceType === priceType)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (matched) return Number(matched.amount);
  }
  return 0;
};

const FabricSampleInvoiceGenerator: React.FC<FabricSampleInvoiceGeneratorProps> = ({
  isDarkMode,
  relations = [],
}) => {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | undefined>();
  const [billToName, setBillToName] = useState('');
  const [billToAddress, setBillToAddress] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [items, setItems] = useState<FabricSampleInvoiceItem[]>([createEmptyFabricInvoiceItem()]);
  const [template, setTemplate] = useState<SampleInvoiceTemplateConfig>(DEFAULT_SAMPLE_INVOICE_TEMPLATE);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [savedInvoices, setSavedInvoices] = useState<SavedFabricSampleInvoice[]>([]);
  const [activePage, setActivePage] = useState<'editor' | 'history'>('editor');
  const [selectedPreviewAsset, setSelectedPreviewAsset] = useState<AdjustableInvoiceAsset | null>(null);
  const [productSuggestions, setProductSuggestions] = useState<ProductSuggestionMap>({});
  const [profiles, setProfiles] = useState<SampleInvoiceBusinessProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const templateRef = useRef(template);
  const lookupTimersRef = useRef<Record<string, number>>({});
  const profileSaveTimerRef = useRef<number | null>(null);
  const dataCenterEndpoint = useMemo(() => apiService.getStoredConfig().cloudEndpoint, []);

  useEffect(() => {
    const today = new Date();
    setInvoiceDate(today.toISOString().split('T')[0]);
    setInvoiceNumber(generateInvoiceNumber(today));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const legacyTemplate = loadLegacyTemplate();
    const legacyInvoices = loadLegacySavedInvoices();

    const loadDataCenterProfiles = async () => {
      try {
        const [remoteProfiles, remoteHistoryProfiles] = await Promise.all([
          apiService.listBusinessProfiles<SampleInvoiceProfilePayload, SampleInvoiceProfileAssets>(PROFILE_KIND, dataCenterEndpoint),
          apiService.listBusinessProfiles<{ invoices: SavedFabricSampleInvoice[] }>(HISTORY_PROFILE_KIND, dataCenterEndpoint),
        ]);
        if (cancelled) return;

        let nextProfiles = remoteProfiles;
        if (nextProfiles.length === 0) {
          const initialTemplate = legacyTemplate || DEFAULT_SAMPLE_INVOICE_TEMPLATE;
          const created = await apiService.saveBusinessProfile<SampleInvoiceProfilePayload, SampleInvoiceProfileAssets>(
            profileInputFromTemplate(initialTemplate, '默认样品发票档案'),
            dataCenterEndpoint,
          );
          nextProfiles = [created];
        }

        if (cancelled) return;
        setProfiles(nextProfiles);
        const lastProfileId = loadLastProfileId();
        const selected = nextProfiles.find(profile => profile.id === lastProfileId) || nextProfiles[0];
        if (selected) {
          const nextTemplate = templateFromProfile(selected);
          setSelectedProfileId(selected.id);
          setProfileNameDraft(selected.name);
          saveLastProfileId(selected.id);
          templateRef.current = nextTemplate;
          setTemplate(nextTemplate);
        }

        const historyProfile = remoteHistoryProfiles[0];
        const remoteInvoices = Array.isArray(historyProfile?.payload?.invoices) ? historyProfile.payload.invoices : [];
        if (remoteInvoices.length > 0) {
          setSavedInvoices(remoteInvoices);
        } else if (legacyInvoices.length > 0) {
          await apiService.saveBusinessProfile<{ invoices: SavedFabricSampleInvoice[] }>(
            {
              id: HISTORY_PROFILE_ID,
              kind: HISTORY_PROFILE_KIND,
              name: '样品发票历史',
              payload: { invoices: legacyInvoices },
              assets: {},
              isActive: true,
            },
            dataCenterEndpoint,
          );
          if (!cancelled) setSavedInvoices(legacyInvoices);
        }

        clearLegacyInvoiceStorage();
      } catch (error) {
        console.warn('[SampleInvoice] data center profiles unavailable:', error);
      }
    };

    loadDataCenterProfiles();
    return () => {
      cancelled = true;
    };
  }, [dataCenterEndpoint]);

  useEffect(() => {
    templateRef.current = template;
  }, [template]);

  useEffect(() => () => {
    Object.values(lookupTimersRef.current).forEach(timer => window.clearTimeout(timer));
    if (profileSaveTimerRef.current) window.clearTimeout(profileSaveTimerRef.current);
  }, []);

  const totals = useMemo(() => calculateInvoiceTotal(items), [items]);
  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === selectedProfileId),
    [profiles, selectedProfileId],
  );

  const persistProfileTemplate = useCallback(async (
    nextTemplate: SampleInvoiceTemplateConfig,
    options: { name?: string; profileId?: string } = {},
  ) => {
    const profileId = options.profileId || selectedProfileId;
    const existing = profiles.find(profile => profile.id === profileId);
    if (!existing && !options.name) return;

    setIsProfileSaving(true);
    try {
      const saved = await apiService.saveBusinessProfile<SampleInvoiceProfilePayload, SampleInvoiceProfileAssets>(
        profileInputFromTemplate(nextTemplate, options.name || existing?.name || '样品发票档案', profileId || undefined),
        dataCenterEndpoint,
      );
      setProfiles(prev => [saved, ...prev.filter(profile => profile.id !== saved.id)]);
      setSelectedProfileId(saved.id);
      setProfileNameDraft(saved.name);
      saveLastProfileId(saved.id);
    } catch (error) {
      console.warn('[SampleInvoice] save profile failed:', error);
    } finally {
      setIsProfileSaving(false);
    }
  }, [dataCenterEndpoint, profiles, selectedProfileId]);

  const scheduleProfileSave = useCallback((nextTemplate: SampleInvoiceTemplateConfig) => {
    if (!selectedProfileId) return;
    if (profileSaveTimerRef.current) {
      window.clearTimeout(profileSaveTimerRef.current);
    }
    profileSaveTimerRef.current = window.setTimeout(() => {
      persistProfileTemplate(nextTemplate);
    }, 500);
  }, [persistProfileTemplate, selectedProfileId]);

  const persistSavedInvoiceHistory = useCallback((nextInvoices: SavedFabricSampleInvoice[]) => {
    apiService.saveBusinessProfile<{ invoices: SavedFabricSampleInvoice[] }>(
      {
        id: HISTORY_PROFILE_ID,
        kind: HISTORY_PROFILE_KIND,
        name: '样品发票历史',
        payload: { invoices: nextInvoices },
        assets: {},
        isActive: true,
      },
      dataCenterEndpoint,
    ).catch(error => {
      console.warn('[SampleInvoice] save invoice history failed:', error);
    });
  }, [dataCenterEndpoint]);

  const updateItem = useCallback(
    (id: string, field: keyof FabricSampleInvoiceItem, value: string | number) => {
      setItems(prev =>
        prev.map(item =>
          item.id === id
            ? { ...item, [field]: value }
            : item
        )
      );
    },
    []
  );

  const queueProductLookup = useCallback((itemId: string, query: string) => {
    if (lookupTimersRef.current[itemId]) {
      window.clearTimeout(lookupTimersRef.current[itemId]);
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setProductSuggestions(prev => ({ ...prev, [itemId]: [] }));
      return;
    }

    lookupTimersRef.current[itemId] = window.setTimeout(() => {
      apiService.listProductAssets(dataCenterEndpoint, { mainCategory: 'Fabric', search: trimmed })
        .then(results => {
          setProductSuggestions(prev => ({
            ...prev,
            [itemId]: results.filter(item => !item.deletedAt).slice(0, 6),
          }));
        })
        .catch(error => {
          console.warn('[SampleInvoice] product lookup failed:', error?.message ?? error);
          setProductSuggestions(prev => ({ ...prev, [itemId]: [] }));
        });
    }, 220);
  }, [dataCenterEndpoint]);

  const applyProductSuggestion = useCallback((itemId: string, product: ProductAsset) => {
    const clientCode = activeCustomerCode(product);
    const fabric = fabricDisplayName(product);
    const unitPrice = latestPriceAmount(product);
    setItems(prev => prev.map(item => item.id === itemId
      ? {
          ...item,
          zroh: clientCode || item.zroh,
          fabric,
          unitPrice: unitPrice || item.unitPrice,
        }
      : item));
    setProductSuggestions(prev => ({ ...prev, [itemId]: [] }));
  }, []);

  const buildDocument = (templateOverride = template) => ({
    invoiceNumber,
    invoiceDate,
    billToName,
    billToAddress,
    poNumber,
    items,
    template: templateOverride,
  });

  const refreshPreviewWithTemplate = (nextTemplate: SampleInvoiceTemplateConfig) => {
    if (!previewHtml) return;
    setPreviewHtml(generateFabricSampleInvoiceHtml(buildDocument(nextTemplate)));
  };

  const updateTemplate = useCallback(
    (field: keyof SampleInvoiceTemplateConfig, value: string | number) => {
      setTemplate(prev => {
        const next = { ...DEFAULT_SAMPLE_INVOICE_TEMPLATE, ...prev, [field]: value };
        templateRef.current = next;
        scheduleProfileSave(next);
        refreshPreviewWithTemplate(next);
        return next;
      });
    },
    [previewHtml, invoiceNumber, invoiceDate, billToName, billToAddress, poNumber, items, scheduleProfileSave]
  );

  const handleCustomerChange = (_value: string, option?: CustomerOption) => {
    setSelectedCustomer(option);
    if (!option) return;
    setBillToName(option.label || '');
    setBillToAddress(option.billingAddress || option.description || '');
  };

  const handleSelectProfile = (profileId: string) => {
    const profile = profiles.find(item => item.id === profileId);
    if (!profile) return;
    const nextTemplate = templateFromProfile(profile);
    setSelectedProfileId(profile.id);
    setProfileNameDraft(profile.name);
    saveLastProfileId(profile.id);
    templateRef.current = nextTemplate;
    setTemplate(nextTemplate);
    if (previewHtml) {
      setPreviewHtml(generateFabricSampleInvoiceHtml(buildDocument(nextTemplate)));
    }
  };

  const handleCreateProfile = async () => {
    const name = profileNameDraft.trim() || '样品发票档案';
    await persistProfileTemplate(templateRef.current, { name, profileId: `BPROF-${Date.now()}` });
  };

  const handleSaveProfile = async () => {
    const nextName = profileNameDraft.trim() || selectedProfile?.name || '样品发票档案';
    const profileId = selectedProfileId || undefined;
    if (profileId) {
      setProfiles(prev => prev.map(profile => (
        profile.id === profileId ? { ...profile, name: nextName } : profile
      )));
    }
    await persistProfileTemplate(templateRef.current, { name: nextName, profileId });
  };

  const handleProfileNameChange = (name: string) => {
    setProfileNameDraft(name);
    if (!selectedProfileId) return;
    setProfiles(prev => prev.map(profile => (
      profile.id === selectedProfileId ? { ...profile, name } : profile
    )));
  };

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    field: 'logoDataUrl' | 'stampDataUrl'
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readImageFile(file);
    updateTemplate(field, dataUrl);
    setSelectedPreviewAsset(field === 'logoDataUrl' ? 'logo' : 'stamp');
    event.target.value = '';
  };

  const generatePreview = () => {
    const html = generateFabricSampleInvoiceHtml(buildDocument(templateRef.current));
    setPreviewHtml(html);
    return html;
  };

  const applyPreviewAssetSelection = useCallback(() => {
    const doc = previewFrameRef.current?.contentDocument;
    if (!doc) return;

    (['logo', 'stamp'] as AdjustableInvoiceAsset[]).forEach(asset => {
      const element = doc.querySelector<HTMLElement>(`.${asset}`);
      if (!element) return;
      element.style.outline = '';
      element.style.outlineOffset = '';
    });
  }, [selectedPreviewAsset]);

  const getAssetAdjustment = (asset: AdjustableInvoiceAsset, source = templateRef.current) => ({
    scale: asset === 'logo' ? source.logoScale : source.stampScale,
    offsetX: asset === 'logo' ? source.logoOffsetX : source.stampOffsetX,
    offsetY: asset === 'logo' ? source.logoOffsetY : source.stampOffsetY,
  });

  const getAssetFields = (asset: AdjustableInvoiceAsset) => ({
    scale: asset === 'logo' ? 'logoScale' : 'stampScale',
    offsetX: asset === 'logo' ? 'logoOffsetX' : 'stampOffsetX',
    offsetY: asset === 'logo' ? 'logoOffsetY' : 'stampOffsetY',
    minScale: asset === 'logo' ? 0.5 : 0.6,
    maxScale: asset === 'logo' ? 2.4 : 3.5,
  } as const);

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const applyLiveTransform = (element: HTMLElement, asset: AdjustableInvoiceAsset, offsetX: number, offsetY: number, scale: number) => {
    element.style.transform = `translate(${offsetX}mm, ${offsetY}mm) scale(${scale})`;
    element.style.transformOrigin = asset === 'logo' ? 'left center' : 'bottom right';
  };

  const commitAssetAdjustment = (
    asset: AdjustableInvoiceAsset,
    adjustment: { scale: number; offsetX: number; offsetY: number },
    refreshPreview = true
  ) => {
    const fields = getAssetFields(asset);
    const next = {
      ...DEFAULT_SAMPLE_INVOICE_TEMPLATE,
      ...templateRef.current,
      [fields.scale]: adjustment.scale,
      [fields.offsetX]: adjustment.offsetX,
      [fields.offsetY]: adjustment.offsetY,
    };
    templateRef.current = next;
    setTemplate(next);
    scheduleProfileSave(next);
    if (refreshPreview && previewHtml) {
      setPreviewHtml(generateFabricSampleInvoiceHtml(buildDocument(next)));
    }
  };

  const removePreviewEditingOverlay = (doc: Document) => {
    doc.querySelector('.invoice-asset-edit-overlay')?.remove();
  };

  const positionPreviewEditingOverlay = (overlay: HTMLElement, element: HTMLElement, doc: Document) => {
    const rect = element.getBoundingClientRect();
    const scrollX = doc.defaultView?.scrollX || 0;
    const scrollY = doc.defaultView?.scrollY || 0;
    overlay.style.left = `${rect.left + scrollX}px`;
    overlay.style.top = `${rect.top + scrollY}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };

  const syncPreviewEditingOverlay = useCallback(() => {
    const doc = previewFrameRef.current?.contentDocument;
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (!doc || !frameWindow) return;

    removePreviewEditingOverlay(doc);
    if (!selectedPreviewAsset) return;

    const element = doc.querySelector<HTMLElement>(`.${selectedPreviewAsset}`);
    if (!element) return;

    const overlay = doc.createElement('div');
    overlay.className = 'invoice-asset-edit-overlay';
    overlay.style.position = 'absolute';
    overlay.style.border = '1.5px solid var(--os-vnext-brand-blue)';
    overlay.style.boxSizing = 'border-box';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '9999';

    const confirm = doc.createElement('button');
    confirm.type = 'button';
    confirm.title = '确认并退出编辑';
    // 使用内联 SVG 对勾图标（UI 禁用 ✓ 文本符号）
    confirm.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    confirm.style.position = 'absolute';
    confirm.style.right = '-10px';
    confirm.style.top = '-10px';
    confirm.style.width = '20px';
    confirm.style.height = '20px';
    confirm.style.border = '1px solid var(--os-vnext-brand-blue)';
    confirm.style.borderRadius = '999px';
    confirm.style.background = '#ffffff';
    confirm.style.color = 'var(--os-vnext-brand-blue)';
    confirm.style.boxShadow = 'none';
    confirm.style.cursor = 'pointer';
    confirm.style.display = 'flex';
    confirm.style.alignItems = 'center';
    confirm.style.justifyContent = 'center';
    confirm.style.fontSize = '13px';
    confirm.style.lineHeight = '18px';
    confirm.style.padding = '0';
    confirm.style.pointerEvents = 'auto';

    const resizeHandle = doc.createElement('div');
    resizeHandle.title = '拖拽调整大小';
    resizeHandle.style.position = 'absolute';
    resizeHandle.style.right = '-7px';
    resizeHandle.style.bottom = '-7px';
    resizeHandle.style.width = '14px';
    resizeHandle.style.height = '14px';
    resizeHandle.style.border = '2px solid var(--os-vnext-brand-blue)';
    resizeHandle.style.background = '#ffffff';
    resizeHandle.style.borderRadius = '999px';
    resizeHandle.style.boxShadow = 'none';
    resizeHandle.style.cursor = 'nwse-resize';
    resizeHandle.style.boxSizing = 'border-box';
    resizeHandle.style.pointerEvents = 'auto';

    overlay.appendChild(confirm);
    overlay.appendChild(resizeHandle);
    doc.body.appendChild(overlay);
    positionPreviewEditingOverlay(overlay, element, doc);

    confirm.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedPreviewAsset(null);
    });

    resizeHandle.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();

      const asset = selectedPreviewAsset;
      const fields = getAssetFields(asset);
      const start = getAssetAdjustment(asset);
      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = element.getBoundingClientRect();
      const baseline = Math.max(startRect.width, startRect.height, 1);
      let latest = start;

      const handleMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const dragDelta = asset === 'logo'
          ? Math.max(moveEvent.clientX - startX, moveEvent.clientY - startY)
          : Math.max(startX - moveEvent.clientX, startY - moveEvent.clientY);
        const nextScale = Number(clamp(start.scale * (1 + dragDelta / baseline), fields.minScale, fields.maxScale).toFixed(2));
        latest = { ...start, scale: nextScale };
        applyLiveTransform(element, asset, latest.offsetX, latest.offsetY, latest.scale);
        positionPreviewEditingOverlay(overlay, element, doc);
      };

      const handleUp = () => {
        frameWindow.removeEventListener('mousemove', handleMove);
        frameWindow.removeEventListener('mouseup', handleUp);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        commitAssetAdjustment(asset, latest);
      };

      frameWindow.addEventListener('mousemove', handleMove);
      frameWindow.addEventListener('mouseup', handleUp);
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    });
  }, [selectedPreviewAsset, previewHtml]);

  useEffect(() => {
    applyPreviewAssetSelection();
    syncPreviewEditingOverlay();
  }, [applyPreviewAssetSelection, syncPreviewEditingOverlay, previewHtml]);

  const handlePreviewFrameLoad = () => {
    const doc = previewFrameRef.current?.contentDocument;
    if (!doc) return;
    const frameWindow = previewFrameRef.current?.contentWindow;
    const sheet = doc.querySelector<HTMLElement>('.sheet');
    const mmPerPx = sheet ? 200 / sheet.getBoundingClientRect().width : 0.264583;

    (['logo', 'stamp'] as AdjustableInvoiceAsset[]).forEach(asset => {
      const element = doc.querySelector<HTMLElement>(`.${asset}`);
      if (!element) return;
      element.style.cursor = 'grab';
      element.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedPreviewAsset(asset);
      });
      element.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedPreviewAsset(asset);
        element.style.cursor = 'grabbing';

        const start = getAssetAdjustment(asset);
        const startX = event.clientX;
        const startY = event.clientY;
        let latest = start;

        const handleMove = (moveEvent: MouseEvent) => {
          moveEvent.preventDefault();
          const nextOffsetX = start.offsetX + (moveEvent.clientX - startX) * mmPerPx;
          const nextOffsetY = start.offsetY + (moveEvent.clientY - startY) * mmPerPx;
          latest = { ...start, offsetX: Number(nextOffsetX.toFixed(2)), offsetY: Number(nextOffsetY.toFixed(2)) };
          applyLiveTransform(element, asset, latest.offsetX, latest.offsetY, latest.scale);
          syncPreviewEditingOverlay();
        };

        const removeDragListeners = () => {
          frameWindow?.removeEventListener('mousemove', handleMove);
          frameWindow?.removeEventListener('mouseup', handleUp);
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('mouseup', handleUp);
        };

        const handleUp = () => {
          element.style.cursor = 'grab';
          removeDragListeners();
          commitAssetAdjustment(asset, latest);
        };

        frameWindow?.addEventListener('mousemove', handleMove);
        frameWindow?.addEventListener('mouseup', handleUp);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
      });
    });
    applyPreviewAssetSelection();
    syncPreviewEditingOverlay();
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationStatus('idle');
    try {
      generatePreview();
      setGenerationStatus('success');
    } catch (error) {
      console.error('发票生成失败:', error);
      setGenerationStatus('error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadHtml = () => {
    const html = generatePreview();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${invoiceNumber || 'sample-invoice'}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSaveInvoice = () => {
    const doc = buildDocument(templateRef.current);
    const saved: SavedFabricSampleInvoice = {
      id: `${doc.invoiceNumber || 'invoice'}-${Date.now()}`,
      savedAt: Date.now(),
      ...doc,
    };
    const next = [saved, ...savedInvoices.filter(item => item.invoiceNumber !== saved.invoiceNumber)].slice(0, 100);
    setSavedInvoices(next);
    persistSavedInvoiceHistory(next);
    setGenerationStatus('success');
  };

  const handleLoadInvoice = (invoice: SavedFabricSampleInvoice) => {
    const restoredTemplate = { ...DEFAULT_SAMPLE_INVOICE_TEMPLATE, ...invoice.template };
    setInvoiceNumber(invoice.invoiceNumber);
    setInvoiceDate(invoice.invoiceDate);
    setBillToName(invoice.billToName);
    setBillToAddress(invoice.billToAddress);
    setPoNumber(invoice.poNumber);
    setItems(invoice.items.length ? invoice.items : [createEmptyFabricInvoiceItem()]);
    setTemplate(restoredTemplate);
    setSelectedCustomer(undefined);
    const html = generateFabricSampleInvoiceHtml({ ...invoice, template: restoredTemplate });
    setPreviewHtml(html);
    setGenerationStatus('success');
    setActivePage('editor');
  };

  const handleDeleteSavedInvoice = (id: string) => {
    const next = savedInvoices.filter(invoice => invoice.id !== id);
    setSavedInvoices(next);
    persistSavedInvoiceHistory(next);
  };

  const downloadFile = (content: BlobPart, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSavePdf = async () => {
    const html = generatePreview();
    const filename = invoiceNumber || 'sample-invoice';

    try {
      if (window.bambookInvoice?.savePdf) {
        await window.bambookInvoice.savePdf(html, filename);
      } else {
        downloadFile(html, `${filename}.html`, 'text/html;charset=utf-8');
      }
      setGenerationStatus('success');
    } catch (error) {
      console.error('PDF 保存失败:', error);
      setGenerationStatus('error');
    }
  };

  if (activePage === 'history') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="relative z-30 flex-shrink-0 flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => setActivePage('editor')}
              className={`mb-3 inline-flex items-center gap-2 text-sm transition-all duration-300 ${
                isDarkMode ? 'text-slate-400 hover:text-[var(--os-vnext-brand-blue)]' : 'text-slate-500 hover:text-[var(--os-vnext-brand-blue)]'
              }`}
            >
              <ArrowLeft size={16} />
              <span>返回发票编辑</span>
            </button>
            <h2 className={`text-xl font-normal tracking-tight leading-snug ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              样品发票历史记录
            </h2>
            <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              本机保存 {savedInvoices.length} 份，点击任意记录可载入到编辑页面继续导出或修改
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-4 pb-4">
          {savedInvoices.length === 0 ? (
            <section className={`${panelClass(isDarkMode)} min-h-[280px] flex flex-col items-center justify-center text-center`}>
              <History size={32} strokeWidth={1} className={isDarkMode ? 'text-slate-600' : 'text-slate-300'} />
              <h3 className={`mt-4 text-base font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                暂无历史发票
              </h3>
              <p className={`mt-2 max-w-sm text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                在编辑页生成预览后点击“保存”，历史发票会集中出现在这里。
              </p>
            </section>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {savedInvoices.map(invoice => (
                <section
                  key={invoice.id}
                  className={`${panelClass(isDarkMode)} flex items-center justify-between gap-4`}
                >
                  <button
                    type="button"
                    onClick={() => handleLoadInvoice(invoice)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className={`text-base font-light truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                      {invoice.invoiceNumber || '未命名发票'}
                    </div>
                    <div className={`mt-1 text-sm truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      {invoice.billToName || 'No Bill To'} · PO {invoice.poNumber || '-'}
                    </div>
                    <div className={`mt-2 text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      Invoice Date {invoice.invoiceDate || '-'} · 保存于 {new Date(invoice.savedAt).toLocaleString('zh-CN')}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSavedInvoice(invoice.id)}
                    className={`p-2 rounded-control transition-colors shrink-0 ${
                      isDarkMode ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-400/10' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'
                    }`}
                    title="删除历史发票"
                  >
                    <Trash2 size={16} />
                  </button>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="relative z-30 flex-shrink-0 flex items-start justify-between gap-4">
        <div>
          <h2 className={`text-xl font-normal tracking-tight leading-snug ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            面料样品发票生成器
          </h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            按 Panda 样品发票模板生成英文 INVOICE，支持 logo / 印章替换与直接保存 PDF
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActivePage('history')}
          className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-light transition-all duration-300 ${
            isDarkMode
              ? 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/10'
              : 'bg-white/70 text-slate-600 hover:bg-white border border-slate-200'
          }`}
        >
          <History size={14} />
          历史发票
          <span className={isDarkMode ? 'text-slate-500' : 'text-slate-400'}>{savedInvoices.length}</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-3">
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(520px,0.9fr)_minmax(560px,1.1fr)] gap-4 pb-4">
          <div className="space-y-3">
            <section className={panelClass(isDarkMode)}>
              <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                发票信息
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass(isDarkMode)}>Invoice Number</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={e => setInvoiceNumber(e.target.value)}
                    className={fieldClass(isDarkMode, 'font-mono')}
                  />
                </div>
                <div>
                  <label className={labelClass(isDarkMode)}>Invoice Date</label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={e => setInvoiceDate(e.target.value)}
                    className={fieldClass(isDarkMode)}
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClass(isDarkMode)}>PO Number</label>
                  <input
                    type="text"
                    value={poNumber}
                    onChange={e => setPoNumber(e.target.value)}
                    placeholder="54858"
                    className={fieldClass(isDarkMode)}
                  />
                </div>
              </div>
            </section>

            <section className={panelClass(isDarkMode)}>
              <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                客户 / Bill To
              </h3>
              <div className="space-y-3">
                <div>
                  <label className={labelClass(isDarkMode)}>搜索客户</label>
                  <CustomerSearchInput
                    relations={relations}
                    value={selectedCustomer?.value || ''}
                    onChange={handleCustomerChange}
                    placeholder="输入客户名称搜索..."
                    isDarkMode={isDarkMode}
                  />
                </div>

                {selectedCustomer && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className={`p-3 rounded-inset ${isDarkMode ? 'bg-white/5 border border-white/10' : 'bg-slate-50 border border-slate-200'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 size={14} className="text-[var(--os-vnext-brand-blue)]" />
                      <span className={`text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {selectedCustomer.label}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {selectedCustomer.billingAddress && (
                        <div className="flex items-start gap-2">
                          <MapPin size={12} className={isDarkMode ? 'text-slate-400 mt-0.5' : 'text-slate-500 mt-0.5'} />
                          <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                            {selectedCustomer.billingAddress}
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                <div>
                  <label className={labelClass(isDarkMode)}>Bill To Name</label>
                  <input
                    type="text"
                    value={billToName}
                    onChange={e => setBillToName(e.target.value)}
                    placeholder="Peerless Clothing"
                    className={fieldClass(isDarkMode)}
                  />
                </div>
                <div>
                  <label className={labelClass(isDarkMode)}>Bill To Address</label>
                  <textarea
                    value={billToAddress}
                    onChange={e => setBillToAddress(e.target.value)}
                    rows={4}
                    placeholder={'8888 PIE IX Boulevard\nMONTREAL QC CA H1Z 4J5'}
                    className={fieldClass(isDarkMode, 'resize-none')}
                  />
                </div>
              </div>
            </section>

            <section className={panelClass(isDarkMode)}>
              <div className={`mb-3 rounded-inset border p-3 ${isDarkMode ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50/70'}`}>
                <label className={labelClass(isDarkMode)}>当前云端档案</label>
                <select
                  value={selectedProfileId}
                  onChange={event => handleSelectProfile(event.target.value)}
                  className={fieldClass(isDarkMode, 'text-xs')}
                >
                  {profiles.map(profile => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </select>

                <label className={`${labelClass(isDarkMode)} mt-3`}>档案名称</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={profileNameDraft}
                    onChange={event => handleProfileNameChange(event.target.value)}
                    onBlur={handleSaveProfile}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="输入档案名称"
                    className={fieldClass(isDarkMode, 'min-w-0 flex-1 text-xs')}
                  />
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    className={`shrink-0 px-3 py-2 rounded-full text-xs font-light ${isDarkMode ? 'bg-white/10 text-slate-200 hover:bg-white/15' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                  >
                    {isProfileSaving ? '保存中' : '保存'}
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleCreateProfile}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-light ${isDarkMode ? 'bg-white/5 text-slate-400 hover:text-slate-200' : 'bg-white/70 text-slate-500 hover:text-slate-700'}`}
                  >
                    用当前内容另存为新档案
                  </button>
                  <span className={`ml-auto self-center text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    本机只记住上次选择
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTemplateOpen(prev => !prev)}
                className="w-full flex items-center justify-between gap-3 text-left"
              >
                <div>
                  <h3 className={`text-xs font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    模板信息
                  </h3>
                  <p className={`text-[10px] mt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    公司信息 / 付款详情 / Logo / 印章，上传后自动存档
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    {template.logoDataUrl ? 'Logo已存档' : 'Logo默认'}
                    {' · '}
                    {template.stampDataUrl ? '印章已存档' : '印章未上传'}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform ${isTemplateOpen ? 'rotate-180' : ''} ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}
                  />
                </div>
              </button>

              {isTemplateOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-3 overflow-hidden"
                >
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <label className={`flex items-center justify-center gap-2 px-3 py-2 rounded-full text-xs font-light cursor-pointer transition-colors ${
                      isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                      <Upload size={13} />
                      上传 Logo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => handleImageUpload(e, 'logoDataUrl')}
                      />
                    </label>
                    <label className={`flex items-center justify-center gap-2 px-3 py-2 rounded-full text-xs font-light cursor-pointer transition-colors ${
                      isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                      <ImageIcon size={13} />
                      上传印章
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => handleImageUpload(e, 'stampDataUrl')}
                      />
                    </label>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className={labelClass(isDarkMode)}>Company Name</label>
                      <input
                        type="text"
                        value={template.companyName}
                        onChange={e => updateTemplate('companyName', e.target.value)}
                        className={fieldClass(isDarkMode)}
                      />
                    </div>
                    <div>
                      <label className={labelClass(isDarkMode)}>Company Address</label>
                      <textarea
                        value={template.companyAddress}
                        onChange={e => updateTemplate('companyAddress', e.target.value)}
                        rows={3}
                        className={fieldClass(isDarkMode, 'resize-none')}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass(isDarkMode)}>Payment Terms</label>
                        <input
                          type="text"
                          value={template.paymentTerms}
                          onChange={e => updateTemplate('paymentTerms', e.target.value)}
                          className={fieldClass(isDarkMode)}
                        />
                      </div>
                      <div>
                        <label className={labelClass(isDarkMode)}>USD Account</label>
                        <input
                          type="text"
                          value={template.usdAccountNumber}
                          onChange={e => updateTemplate('usdAccountNumber', e.target.value)}
                          className={fieldClass(isDarkMode, 'font-mono')}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass(isDarkMode)}>Bank Name</label>
                      <input
                        type="text"
                        value={template.bankName}
                        onChange={e => updateTemplate('bankName', e.target.value)}
                        className={fieldClass(isDarkMode)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass(isDarkMode)}>SWIFT Code</label>
                        <input
                          type="text"
                          value={template.swiftCode}
                          onChange={e => updateTemplate('swiftCode', e.target.value)}
                          className={fieldClass(isDarkMode, 'font-mono')}
                        />
                      </div>
                      <div>
                        <label className={labelClass(isDarkMode)}>Beneficiary</label>
                        <input
                          type="text"
                          value={template.beneficiary}
                          onChange={e => updateTemplate('beneficiary', e.target.value)}
                          className={fieldClass(isDarkMode)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass(isDarkMode)}>Bank Address</label>
                      <textarea
                        value={template.bankAddress}
                        onChange={e => updateTemplate('bankAddress', e.target.value)}
                        rows={2}
                        className={fieldClass(isDarkMode, 'resize-none')}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </section>

            <section className={panelClass(isDarkMode)}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-xs font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  面料样品明细
                </h3>
                <button
                  onClick={() => setItems(prev => [...prev, createEmptyFabricInvoiceItem()])}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-light transition-all duration-300 ${
                    isDarkMode
                      ? 'bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue)]/20'
                      : 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.08)] text-[var(--os-vnext-brand-blue)] hover:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.12)]'
                  }`}
                >
                  <Plus size={12} />
                  添加样品
                </button>
              </div>

              <div className="space-y-4">
                {items.map((item, index) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-inset p-3 border ${isDarkMode ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50/70'}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-light ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                        Line {index + 1}
                      </span>
                      <button
                        onClick={() => setItems(prev => prev.length > 1 ? prev.filter(row => row.id !== item.id) : prev)}
                        disabled={items.length === 1}
                        className={`p-1.5 rounded-control transition-all duration-300 ${
                          items.length === 1
                            ? 'opacity-30 cursor-not-allowed'
                            : isDarkMode
                              ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-400/10'
                              : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'
                        }`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-4">
                        <label className={labelClass(isDarkMode)}>Client Code</label>
                        <input
                          value={item.zroh}
                          onChange={e => {
                            updateItem(item.id, 'zroh', e.target.value);
                            queueProductLookup(item.id, e.target.value);
                          }}
                          onFocus={e => queueProductLookup(item.id, e.currentTarget.value)}
                          placeholder="144749"
                          className={fieldClass(isDarkMode, 'text-xs')}
                        />
                      </div>
                      <div className="col-span-8">
                        <label className={labelClass(isDarkMode)}>Fabric</label>
                        <input
                          value={item.fabric}
                          onChange={e => {
                            updateItem(item.id, 'fabric', e.target.value);
                            queueProductLookup(item.id, e.target.value);
                          }}
                          onFocus={e => queueProductLookup(item.id, e.currentTarget.value)}
                          placeholder="RD7302/PCHR"
                          className={fieldClass(isDarkMode, 'text-xs')}
                        />
                      </div>
                      {(productSuggestions[item.id] || []).length > 0 && (
                        <div className="col-span-12">
                          <div className={`rounded-inset border overflow-hidden ${isDarkMode ? 'border-white/10 bg-slate-950/70' : 'border-slate-200 bg-white shadow-none'}`}>
                            {(productSuggestions[item.id] || []).map(product => {
                              const clientCode = activeCustomerCode(product);
                              const fabric = fabricDisplayName(product);
                              const price = latestPriceAmount(product);
                              const composition = (product.compositionLines || [])
                                .map(line => `${line.percentage}% ${line.term?.chineseName || line.term?.englishName || line.termId}`)
                                .join(' + ');
                              return (
                                <button
                                  key={product.id}
                                  type="button"
                                  onMouseDown={event => {
                                    event.preventDefault();
                                    applyProductSuggestion(item.id, product);
                                  }}
                                  className={`w-full px-3 py-2 text-left transition-colors border-b last:border-b-0 ${isDarkMode ? 'border-white/5 hover:bg-white/[0.08]' : 'border-slate-100 hover:bg-slate-50'}`}
                                >
                                  <div className={`text-xs font-light ${isDarkMode ? 'text-white/85' : 'text-slate-800'}`}>
                                    {clientCode || 'No Client Code'} · {fabric}
                                  </div>
                                  <div className={`mt-1 text-[10px] leading-relaxed ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
                                    {[product.sku, product.fabricProfile?.millOrganizationId, composition, price ? `USD ${price}` : ''].filter(Boolean).join(' · ')}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div className="col-span-7">
                        <label className={labelClass(isDarkMode)}>AWB</label>
                        <input
                          value={item.awb}
                          onChange={e => updateItem(item.id, 'awb', e.target.value)}
                          placeholder="DHL 5136/32742"
                          className={fieldClass(isDarkMode, 'text-xs')}
                        />
                      </div>
                      <div className="col-span-5">
                        <label className={labelClass(isDarkMode)}>Ship To Address</label>
                        <input
                          value={item.shipToAddress}
                          onChange={e => updateItem(item.id, 'shipToAddress', e.target.value)}
                          placeholder="PT DAESE"
                          className={fieldClass(isDarkMode, 'text-xs')}
                        />
                      </div>
                      <div className="col-span-6">
                        <label className={labelClass(isDarkMode)}>Qty (M)</label>
                        <input
                          type="number"
                          min="0"
                          value={item.qty || ''}
                          onChange={e => updateItem(item.id, 'qty', parseFloat(e.target.value) || 0)}
                          placeholder="5"
                          className={fieldClass(isDarkMode, 'text-xs text-right')}
                        />
                      </div>
                      <div className="col-span-6">
                        <label className={labelClass(isDarkMode)}>Unit Price (USD)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice || ''}
                          onChange={e => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                          placeholder="8.10"
                          className={fieldClass(isDarkMode, 'text-xs text-right')}
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-light ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    合计：{totals.qty} M
                  </span>
                  <span className={`text-lg font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    <span className="text-xs opacity-50">$</span>
                    {totals.amount.toFixed(2)}
                    <span className="text-xs ml-1 opacity-50">USD</span>
                  </span>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="col-span-3 sm:col-span-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full text-sm font-light bg-[var(--os-vnext-brand-blue)] text-white hover:bg-[var(--os-vnext-brand-blue)]/90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <FileCode size={16} />}
                生成预览
              </button>
              <button
                onClick={handleSaveInvoice}
                disabled={!previewHtml}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-full text-sm font-light transition-all duration-300 ${
                  previewHtml
                    ? isDarkMode
                      ? 'bg-white/10 text-white hover:bg-white/20'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <Save size={16} />
                保存
              </button>
              <button
                onClick={handleDownloadHtml}
                disabled={!previewHtml}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-full text-sm font-light transition-all duration-300 ${
                  previewHtml
                    ? isDarkMode
                      ? 'bg-white/10 text-white hover:bg-white/20'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <Download size={16} />
                HTML
              </button>
              <button
                onClick={handleSavePdf}
                disabled={!previewHtml}
                className={`col-span-3 sm:col-span-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full text-sm font-light transition-all duration-300 ${
                  previewHtml
                    ? isDarkMode
                      ? 'bg-white/10 text-white hover:bg-white/20'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <Printer size={16} />
                PDF
              </button>
            </div>

            {generationStatus !== 'idle' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-center gap-2 p-3 rounded-inset text-sm ${
                  generationStatus === 'success'
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-rose-500/10 text-rose-500'
                }`}
              >
                {generationStatus === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{generationStatus === 'success' ? '操作成功！' : '保存失败，请重试'}</span>
              </motion.div>
            )}
          </div>

          <section className={`rounded-card overflow-hidden flex flex-col min-h-[760px] ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
            <div className={`px-4 py-3 border-b flex-shrink-0 flex items-center justify-between ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
              <h3 className={`text-xs font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                预览区域
              </h3>
              <span className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                A5 Landscape / Direct PDF
              </span>
            </div>
            <div className="flex-1 min-h-0">
              {previewHtml ? (
                <iframe
                  ref={previewFrameRef}
                  srcDoc={previewHtml}
                  title="Fabric Sample Invoice Preview"
                  onLoad={handlePreviewFrameLoad}
                  className="w-full h-full border-0 bg-white"
                />
              ) : (
                <div className={`flex flex-col items-center justify-center h-full ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  <FileCode size={48} strokeWidth={0.5} className="mb-4 opacity-30" />
                  <p className="text-sm">填写表单后点击“生成预览”</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default FabricSampleInvoiceGenerator;
