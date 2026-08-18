import React, { useMemo, useRef } from 'react';
import { BookOpenText } from 'lucide-react';
import {
  BAMBOOK_DESIGN_SYSTEM_CONTRACT,
  BAMBOOK_MATERIAL_LIBRARY_CATEGORIES,
  BAMBOOK_MATERIAL_LIBRARY_ITEMS,
} from '../bambookDesignSystem';
import { BAMBOOK_OS } from '../bambookOsTokens';
import ScrollEdgeFades from '../ScrollEdgeFades';
import SidePanelContainer from '../SidePanelContainer';

type CompiledMaterialLibraryPageBlueprint = {
  template: 'CompiledMaterialLibraryReferencePage';
  source: 'UiLabMaterialLibraryReferencePage.ui-lab-1.0.contract';
  provenance: 'accepted';
  title: string;
  version: string;
  categories: typeof BAMBOOK_MATERIAL_LIBRARY_CATEGORIES;
  shellClassName: string;
  titleBarClassName: string;
};

export const compileMaterialLibraryReferencePage = (): CompiledMaterialLibraryPageBlueprint => ({
  template: 'CompiledMaterialLibraryReferencePage',
  source: 'UiLabMaterialLibraryReferencePage.ui-lab-1.0.contract',
  provenance: 'accepted',
  title: 'Bambook OS Material Library',
  version: BAMBOOK_DESIGN_SYSTEM_CONTRACT.version,
  categories: BAMBOOK_MATERIAL_LIBRARY_CATEGORIES,
  shellClassName: `${BAMBOOK_OS.layout.desktopPageFrameClass} ${BAMBOOK_OS.layout.desktopPageXClass}`,
  titleBarClassName: `${BAMBOOK_OS.layout.desktopTitleBarClass} flex`,
});

export const CompiledMaterialLibraryReferencePage = ({ isDarkMode }: { isDarkMode: boolean }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const blueprint = useMemo(() => compileMaterialLibraryReferencePage(), []);
  const itemByCategory = useMemo(() => BAMBOOK_MATERIAL_LIBRARY_CATEGORIES.map(category => ({
    ...category,
    entries: BAMBOOK_MATERIAL_LIBRARY_ITEMS.filter(item => item.category === category.id),
  })), []);

  return (
    <div
      data-os-compiler-template={blueprint.template}
      data-os-compiler-source={blueprint.source}
      data-os-compiler-provenance={blueprint.provenance}
      data-ui-lab-material-library-reference-page
      className={blueprint.shellClassName}
      aria-label="Bambook OS 内部材料库参考页"
    >
      <div className={blueprint.titleBarClassName}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-c-default)] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
            <BookOpenText size={18} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className={`text-[10px] font-light uppercase ${BAMBOOK_OS.typography.tracking.overline} text-[var(--text-tertiary)]`}>
              {blueprint.version}
            </p>
            <h2 className={`mt-1 truncate text-xl font-light tracking-tight text-[var(--text-primary)]`}>
              {blueprint.title}
            </h2>
          </div>
        </div>
        <span className={`${BAMBOOK_OS.controls.title.pageLabel} text-[var(--text-tertiary)]`}>
          Dev-only reference, not product chrome
        </span>
      </div>

      <SidePanelContainer
        isDarkMode={isDarkMode}
        materialRole="framePanel"
        className="ui-lab-material-library-shell h-full min-h-0 overflow-hidden p-0"
        contentClassName="relative z-10 flex h-full min-h-0 flex-col"
        edgeFadeItem
      >
        <header className={`shrink-0 border-b px-6 py-5 border-[var(--border-c-default)]`}>
          <p className={`max-w-3xl text-xs font-light leading-relaxed text-[var(--text-secondary)]`}>
            所有样张来自代码 contract。它只作为 UI Lab 内部参考内容存在，不挂载到 Dashboard、关系智库、数字档案或设置这些真实页面的前端 chrome。
          </p>
        </header>

        <div className={`grid shrink-0 grid-cols-4 gap-2 border-b px-6 py-3 border-[var(--border-c-default)]`}>
          {blueprint.categories.map(category => (
            <div
              key={category.id}
              data-ui-lab-material-library-category={category.id}
              className={`rounded-inset border px-3 py-2 border-[var(--border-c-default)] bg-[var(--recessed-bg)]`}
            >
              <div className={`ui-lab-material-library-eyebrow text-[10px] font-light uppercase text-[var(--text-tertiary)]`}>{category.id}</div>
              <div className={`mt-1 text-xs font-light text-[var(--text-primary)]`}>{category.title}</div>
            </div>
          ))}
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className={`h-full min-h-0 overflow-y-auto px-6 py-5 ${BAMBOOK_OS.layout.panelShadowViewportClass}`}>
            <div className="space-y-5">
              <section data-ui-lab-material-library-sample="materials" className="grid gap-3">
                <div className="flex items-center justify-between gap-4">
                  <h4 className={`text-sm font-light text-[var(--text-primary)]`}>Material Levels</h4>
                  <span className={`ui-lab-material-library-eyebrow text-[10px] font-light uppercase text-[var(--text-tertiary)]`}>1 / 2 / 3 / derived 4</span>
                </div>
                <SidePanelContainer isDarkMode={isDarkMode} materialRole="framePanel" className="p-4">
                  <div className="grid gap-3">
                    <div className={`text-xs font-light text-[var(--text-primary)]`}>Level 1 Frame Panel</div>
                    <div className="grid grid-cols-2 gap-3">
                      <SidePanelContainer isDarkMode={isDarkMode} materialRole="raisedCard" materialTone="nested" className="ui-lab-material-library-radius p-3">
                        <div className={`text-xs font-light text-[var(--text-primary)]`}>Level 2 Raised</div>
                        <div className={`mt-1 text-[10px] font-light text-[var(--text-tertiary)]`}>nested glass</div>
                      </SidePanelContainer>
                      <SidePanelContainer isDarkMode={isDarkMode} materialRole="insetSurface" materialTone="nested" className="ui-lab-material-library-radius p-3">
                        <div className={`text-xs font-light text-[var(--text-primary)]`}>Level 2 Inset</div>
                        <div className={`mt-1 text-[10px] font-light text-[var(--text-tertiary)]`}>secondary shadow</div>
                      </SidePanelContainer>
                    </div>
                    <div className={`${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-outer-panel bambook-tertiary-surface ui-lab-material-library-radius p-3`}>
                      <div className={`text-xs font-light text-[var(--text-primary)]`}>Level 3 Tertiary</div>
                      <div className={`mt-1 text-[10px] font-light text-[var(--text-tertiary)]`}>selected-light rim logic in light mode</div>
                    </div>
                    <div className={`rounded-inset border border-dashed px-3 py-2 text-xs font-light border-[var(--border-c-default)] text-[var(--text-tertiary)]`}>
                      Level 4 Derived: spec-only, generated from level 3 when content grouping cannot solve hierarchy.
                    </div>
                  </div>
                </SidePanelContainer>
              </section>

              {itemByCategory.map(category => (
                <section key={category.id} data-ui-lab-material-library-sample={category.id} className="grid gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <h4 className={`text-sm font-light text-[var(--text-primary)]`}>{category.title}</h4>
                    <span className={`ui-lab-material-library-eyebrow text-[10px] font-light uppercase text-[var(--text-tertiary)]`}>{category.entries.length} entries</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {category.entries.map(item => (
                      <article
                        key={item.id}
                        data-ui-lab-material-library-item={item.id}
                        className={`ui-lab-material-library-radius border p-3 border-[var(--border-c-default)] bg-[var(--recessed-bg)]`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`ui-lab-material-library-role text-[10px] font-light uppercase text-[var(--text-tertiary)]`}>{item.role}</p>
                            <h5 className={`mt-1 text-xs font-light text-[var(--text-primary)]`}>{item.title}</h5>
                          </div>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-light border-[var(--border-c-default)] text-[var(--text-tertiary)]`}>
                            {item.status}
                          </span>
                        </div>
                        <p className={`mt-2 text-[10px] font-light leading-relaxed text-[var(--text-tertiary)]`}>{item.token}</p>
                        <p className={`mt-2 text-xs font-light leading-relaxed text-[var(--text-secondary)]`}>{item.usage}</p>
                        <p className={`mt-2 text-[10px] font-light leading-relaxed text-[var(--text-quaternary)]`}>Forbidden: {item.forbidden}</p>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
          <ScrollEdgeFades scrollRef={scrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} />
        </div>
      </SidePanelContainer>
    </div>
  );
};
