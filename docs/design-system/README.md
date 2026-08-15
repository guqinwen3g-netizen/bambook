# Bambook OS Design Grammar V1

> **权威声明（2026-08-16 · BDS v2.2 起）**：现行唯一设计真源是 **BDS v2.2**
> （`styles/bds/tokens.css` + `styles/bds/components.css` + `styles/bds/showcase.html`）。
> 组件的**语境应用规则**（什么场景用什么组件/规格/材质）以
> `component-application-spec.md`（语境 × 元素决策矩阵）为准。
> 本目录其余文档描述 legacy 三层体系，仅供旧组件维护与收编迁移参考。

This is the authoritative entrypoint for Bambook OS UI design. The system is code-first: exact visual values live in tokens and primitives, while this directory explains how new UI is derived.

## Source Of Truth

Authoritative files:

- `styles/os-vnext.css`: exact CSS variables, material role rendering, selected-surface tokens, UI Lab and app material scopes.
- `components/ui/bambookOsTokens.ts`: semantic recipes, component roles, layout, typography, motion, and allowed composition language.
- `components/ui/osMaterial.ts`: material role enum.
- `components/ui/osCompiler/compiledPrimitives.tsx`: compiler-level primitive consumption for accepted generated UI.
- `components/ui/SidePanelContainer.tsx`: panel primitive, spotlight binding, and edge-fade shadow splitting.
- `components/ui/ScrollEdgeFades.tsx`: scroll boundary fade behavior.
- `components/ui/bambookDesignSystem.ts`: design-system registry tying code, docs, and tests together.

Legacy files:

- `styles/design-system.css` is a historical Command Center stylesheet. Do not add new Bambook OS material values there.
- `styles/flat-experimental.css` is a temporary flat-material migration shield. It can suppress legacy rim/shadow artifacts, but it is not the long-term source of truth.

## Working Rule

Every new visible UI must answer three questions before styling:

1. Material role: what physical surface is this?
2. State model: does it have idle, hover, press, active, focus, or selected behavior?
3. Layout role: is it chrome, content, scrolling content, overlay, or inline metadata?

If a design cannot answer those questions, it is not ready to become a new UI pattern.

For new pages, answer four additional inputs before layout:

1. Page type.
2. Primary task.
3. Information density.
4. Dominant content model.

The grammar should then derive the page shell, material levels, component states, adaptive color roles, and content language. If two visual outcomes remain possible, the missing input must be named instead of solved with local styling.

## Deliverables

V1 consists of four code-backed artifacts:

- Final design tokens: CSS custom properties and TypeScript recipes.
- Design grammar: this directory plus `components/ui/bambookDesignSystem.ts`.
- Material library: UI Lab should render every category listed in `BAMBOOK_MATERIAL_LIBRARY_CATEGORIES`.
- Migration rules: tests and audit scripts prevent new page-local visual values.

## Documents

- `component-application-spec.md`: **BDS v2.2 应用层真源** — 语境 × 元素决策矩阵（高度规格、搜索/工具条/按钮/下拉/容器/列表范式、页面骨架、落地判定流程）。
- `design-constitution.md`: principles that cannot be violated.
- `tokens.md`: primitive, semantic, and decision token layers.
- `layout-grammar.md`: page shell, sidebar shell, split workspace, toolbar, grid, detail, form, table, spacing, canvas, density, and structural rules.
- `material-grammar.md`: material levels, lighting, shadow, fade, mask, and ghost shadow.
- `flat-material-authority.md`: flat material ownership, migration shield boundaries, and forbidden local material patterns.
- `rdl-component-authority.md`: RonDesignLab official-site component evidence, Bambook transfer boundaries, and shared pill/search/filter/card dialect.
- `component-grammar.md`: component families and state matrices.
- `content-language.md`: interface language, labels, empty states, and missing values.
- `page-generation.md`: how to derive a new page into one valid shape.
- `design-compiler.md`: compiler-level fidelity, provenance, slots, and no page-local visual output.
- `governance.md`: migration order, audit rules, review gates, and legacy boundaries.
- `class-ownership.md`: current ownership map for authority, role, recipe, bridge, legacy, and protected visual classes.
- `known-rendering-issues.md`: confirmed rendering-level issues and debugging order for low-level material bugs.

## Retired Documents

These older design notes are no longer active grammar:

- `material-levels.md`: merged into `material-grammar.md`.
- `component-rules.md`: merged into `component-grammar.md`.
- `migration.md`: replaced by `governance.md`.
- `bambook-ui-spec.md`: archived historical Command Center / Neural UI spec.
- `docs/Bambook-OS-UI-Guidelines.md`: archived intermediate UI guideline.
- `docs/UI_AUDIT_REPORT.md`: archived historical UI audit.

Do not cite retired documents for new UI. If a retired document conflicts with this directory or `components/ui/bambookDesignSystem.ts`, the registry wins.

## Non-Negotiables

- Do not create page-local glass colors, shadows, selected fills, input rims, or hover materials.
- Do not treat `styles/flat-experimental.css` as a design authority. Move durable flat material decisions into `os-vnext.css`, `osMaterial.ts`, `bambookOsTokens.ts`, and compiled primitives.
- Do not stack blue-white film inside blue-white film. Level 1 may use shared glass; nested levels must use nested or derived material.
- Do not use selected styling for hover-only controls.
- Do not put edge fade on the wrong node. The scroll viewport owns fade timing; the glass surface owns mask fidelity; ghost siblings own outward shadow when needed.
- Do not introduce a fourth-level surface by guessing a new color. Derive it from the level system.
- Do not add instructional or marketing copy inside operational UI.
- Do not add a new page without declaring material role, state model, layout role, and content role for every visible element.
- UI Lab 2.0 is the compiler review surface. Current UI Lab references are source material, but only `accepted` compiler outputs become standards.
