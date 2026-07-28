import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  compileBambookPage,
  createCompilerFidelityReport,
  OS_COMPILER_FORBIDDEN_ESCAPE_HATCHES,
  OS_COMPILER_VISUAL_SYSTEMS,
} from './osCompiler';
import {
  CompiledCardGrid,
  CompiledCollectionCardGrid,
  CompiledDashboardCard,
  CompiledDetailShell,
  CompiledEdgeFade,
  CompiledBottomSheet,
  CompiledFormMapPanel,
  CompiledFormNotePanel,
  CompiledFormSectionPanel,
  CompiledImageUploader,
  CompiledInteractiveCard,
  CompiledModuleTitleBar,
  CompiledMotionInteractiveCard,
  CompiledPage,
  CompiledPageCanvas,
  CompiledPanelRow,
  CompiledPanel,
  CompiledScrollViewport,
  CompiledSectionStack,
  CompiledSelectControl,
  CompiledSplitMainPanel,
  CompiledSplitNavPanel,
  CompiledSplitWorkspace,
  CompiledSurfacePanel,
  CompiledTableShell,
  CompiledToolbarRow,
} from './compiledPrimitives';

describe('Bambook OS compiler contract', () => {
  it('compiles a resource library page into one full visual blueprint', () => {
    const blueprint = compileBambookPage({
      pageId: 'products',
      pageType: 'resource-library',
      title: { primary: '数字', brand: '档案' },
      density: 'standard',
      navigationDepth: 'module',
      contentModel: 'card-grid-table-switch',
      mutationModel: 'crud',
      stateModel: 'ready',
      referenceSurface: 'ui-lab-products-current',
    });

    expect(blueprint.layout.pageShell.component).toBe('CompiledPage');
    expect(blueprint.layout.titleBar.component).toBe('CompiledTitleBar');
    expect(blueprint.layout.canvas.maxWidth).toBe(1130);
    expect(blueprint.layout.panelRow.component).toBe('CompiledPanelRow');
    expect(blueprint.layout.toolbar.component).toBe('CompiledToolbarRow');
    expect(blueprint.layout.content.component).toBe('CompiledCardGrid');
    expect(blueprint.layout.scrollViewport.edgeFade).toEqual({
      topStartOffset: 56,
      topHeight: 32,
      bottomHeight: 48,
      source: 'BAMBOOK_OS.layout.cardGridEdgeFade*',
    });
    expect(blueprint.material.mainPanel.materialRole).toBe('framePanel');
    expect(blueprint.material.mainPanel.shadowRole).toBe('none');
    expect(blueprint.material.mainPanel.shadowMode).toBe('none');
    expect(blueprint.material.sectionPanel.materialRole).toBe('raisedCard');
    expect(blueprint.material.sectionPanel.shadowRole).toBe('none');
    expect(blueprint.material.sectionPanel.shadowMode).toBe('none');
    expect(blueprint.material.inlinePanel.materialRole).toBe('tertiarySurface');
    expect(blueprint.material.inlinePanel.shadowRole).toBe('none');
    expect(blueprint.material.inlinePanel.shadowMode).toBe('none');
    expect(blueprint.typography.pageTitle.source).toBe('BAMBOOK_OS.controls.title');
    expect(blueprint.motion.hover.durationMs).toBe(200);
    expect(blueprint.contentLanguage.interfaceLanguage).toBe('zh-CN');
    expect(blueprint.stateMatrix).toContain('selected');
    expect(blueprint.slotContract.requiredSlots).toEqual([
      'title.leading',
      'title.identity',
      'title.actions',
      'toolbar.search',
      'toolbar.filters',
      'toolbar.viewSwitch',
      'toolbar.actions',
      'content.primary',
      'content.empty',
      'content.error',
    ]);
    expect(blueprint.provenance.material).toBe('accepted');
    expect(blueprint.provenance.layout).toBe('accepted');
    expect(blueprint.fidelity.referenceSurface).toBe('ui-lab-products-current');
    expect(blueprint.fidelity.gates).toContain('compiler-output-only');
    expect(blueprint.forbiddenEscapeHatches).toBe(OS_COMPILER_FORBIDDEN_ESCAPE_HATCHES);
    expect(OS_COMPILER_VISUAL_SYSTEMS).toEqual([
      'layout',
      'material',
      'shadow',
      'typography',
      'motion',
      'state',
      'iconography',
      'content-language',
      'responsive-scale',
      'visual-provenance',
      'reference-snapshot',
      'slot-contract',
    ]);
  });

  it('renders compiled primitives with traceable compiler markers', () => {
    const blueprint = compileBambookPage({
      pageId: 'relations',
      pageType: 'list-detail',
      title: { primary: '关系', brand: '智库' },
      density: 'standard',
      navigationDepth: 'root',
      contentModel: 'list-detail',
      mutationModel: 'inline-edit',
      stateModel: 'ready',
      referenceSurface: 'ui-lab-relations-current',
    });

    const html = renderToStaticMarkup(
      <CompiledPage blueprint={blueprint} actions={<button type="button">Action</button>}>
        <CompiledToolbarRow blueprint={blueprint} search={<input aria-label="Search" />} />
        <CompiledPageCanvas blueprint={blueprint}>
          <CompiledPanelRow blueprint={blueprint}>
            <CompiledPanel blueprint={blueprint} level={1} role="main">
              <CompiledScrollViewport blueprint={blueprint}>
                <CompiledSectionStack blueprint={blueprint}>
                  <CompiledPanel blueprint={blueprint} level={2} role="section">
                    <CompiledCardGrid blueprint={blueprint}>
                      <CompiledPanel blueprint={blueprint} level={3} role="inline">Inline</CompiledPanel>
                    </CompiledCardGrid>
                  </CompiledPanel>
                </CompiledSectionStack>
              </CompiledScrollViewport>
            </CompiledPanel>
          </CompiledPanelRow>
        </CompiledPageCanvas>
      </CompiledPage>,
    );

    expect(html).toContain('data-os-compiler-page="relations"');
    expect(html).toContain('data-os-compiler-role="page"');
    expect(html).toContain('data-os-compiler-role="title-bar"');
    expect(html).toContain('data-os-compiler-role="toolbar-row"');
    expect(html).toContain('data-os-compiler-role="page-canvas"');
    expect(html).toContain('data-os-compiler-role="panel-row"');
    expect(html).toContain('data-os-compiler-role="panel"');
    expect(html).toContain('data-os-compiler-level="1"');
    expect(html).toContain('data-os-compiler-level="2"');
    expect(html).toContain('data-os-compiler-level="3"');
    expect(html).toContain('data-os-surface-role="framePanel"');
    expect(html).toContain('data-os-shadow-role="none"');
    expect(html).toContain('data-os-shadow-mode="none"');
    expect(html).not.toContain('data-os-shadow-role="frame"');
    expect(html).not.toContain('data-os-shadow-mode="ghost"');
    expect(html).toContain('data-os-compiler-role="scroll-viewport"');
    expect(html).toContain('data-os-compiler-edge-fade-source="BAMBOOK_OS.layout.cardGridEdgeFade*"');
    expect(html).toContain('data-os-compiler-role="card-grid"');

    const sharedTemplateHtml = renderToStaticMarkup(
      <>
        <CompiledModuleTitleBar
          template="CompiledSharedContract"
          source="test-title"
          leading={<button type="button">Root</button>}
          center={<div>Switch</div>}
          actions={<button type="button">Save</button>}
        />
        <CompiledCollectionCardGrid profile="category">
          <div>Category</div>
        </CompiledCollectionCardGrid>
        <CompiledTableShell
          scrollRef={React.createRef<HTMLDivElement>()}
          header={<div>Header</div>}
          edgeFade={{ topHeight: 56, topFadeStartOffset: 0, bottomHeight: 72 }}
        >
          <div>Rows</div>
        </CompiledTableShell>
        <CompiledFormSectionPanel id="shared-form" title="Shared Form">
          <input aria-label="Shared Field" />
        </CompiledFormSectionPanel>
        <CompiledFormMapPanel>
          <button type="button">Map Item</button>
        </CompiledFormMapPanel>
        <CompiledFormNotePanel>
          Shared note
        </CompiledFormNotePanel>
        <CompiledDetailShell role="shared-detail-panel">
          Detail
        </CompiledDetailShell>
        <CompiledSurfacePanel compilerRole="shared-surface-panel" isDarkMode={false}>
          Surface
        </CompiledSurfacePanel>
        <CompiledEdgeFade
          scrollRef={React.createRef<HTMLDivElement>()}
          compilerRole="shared-edge-fade"
          source="test-edge-fade"
        />
        <CompiledInteractiveCard compilerRole="shared-interactive-card">
          Interactive
        </CompiledInteractiveCard>
        <CompiledMotionInteractiveCard compilerRole="shared-motion-card">
          Motion
        </CompiledMotionInteractiveCard>
        <CompiledDashboardCard>
          Dashboard
        </CompiledDashboardCard>
        <CompiledSelectControl
          compilerRole="shared-select-control"
          value="a"
          onChange={() => undefined}
          options={[{ value: 'a', label: 'A' }]}
        />
        <CompiledBottomSheet
          compilerRole="shared-bottom-sheet"
          isOpen={false}
          onClose={() => undefined}
          title="Sheet"
        >
          Sheet
        </CompiledBottomSheet>
        <CompiledImageUploader
          compilerRole="shared-image-uploader"
          productId="product"
          images={[]}
          onChange={() => undefined}
        />
        <CompiledSplitWorkspace blueprint={blueprint}>
          <CompiledSplitNavPanel ariaLabel="Shared Navigation">
            <button type="button">Nav</button>
          </CompiledSplitNavPanel>
          <CompiledSplitMainPanel scrollRef={React.createRef<HTMLDivElement>()}>
            <div>Main</div>
          </CompiledSplitMainPanel>
        </CompiledSplitWorkspace>
      </>,
    );

    expect(sharedTemplateHtml).toContain('data-os-compiler-role="module-title-bar"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-slot="title.leading"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="collection-card-grid"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="table-shell"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="form-section-panel"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="form-map-panel"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="form-note-panel"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-detail-panel"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-surface-panel"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-edge-fade"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-source="test-edge-fade"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-interactive-card"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-motion-card"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="dashboard-card"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-select-control"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-bottom-sheet"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="shared-image-uploader"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="split-workspace"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="split-nav-panel"');
    expect(sharedTemplateHtml).toContain('data-os-compiler-role="split-main-panel"');
  });

  it('reports provisional sources so UI Lab 2.0 cannot hide fidelity gaps', () => {
    const blueprint = compileBambookPage({
      pageId: 'dashboard',
      pageType: 'dashboard',
      title: { primary: '全景', brand: '看板' },
      density: 'spacious',
      navigationDepth: 'root',
      contentModel: 'dashboard-summary',
      mutationModel: 'read-mostly',
      stateModel: 'ready',
      referenceSurface: 'ui-lab-dashboard-current',
      provenanceOverrides: {
        motion: 'provisional',
        referenceSnapshot: 'provisional',
      },
    });

    const report = createCompilerFidelityReport(blueprint);

    expect(report.pageId).toBe('dashboard');
    expect(report.provisionalSystems).toEqual(['motion', 'referenceSnapshot']);
    expect(report.isFullyAccepted).toBe(false);
    expect(report.requiredReview).toBe('User review required before this blueprint becomes accepted reference.');
  });
});
