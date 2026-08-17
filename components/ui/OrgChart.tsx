/**
 * OrgChart - 组织架构图组件
 * 
 * 可视化展示组织内部的汇报关系和层级结构。
 * 采用 Bambook OS 风格的轻量玻璃态美学。
 */

import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Relation } from '../../types';
import {
    User, ChevronDown, Plus, Edit2,
    Building2, Users,
    ZoomIn, ZoomOut, RotateCcw
} from 'lucide-react';
import { BAMBOOK_OS } from './bambookOsTokens';
import { CompiledSurfacePanel } from './primitives/compiledSurfacePrimitives';

interface OrgChartProps {
    organization: Relation;
    contacts: Relation[];
    onSelectContact: (id: string) => void;
    onAddContact: () => void;
    onEditContact: (contact: Relation) => void;
    onMoveContact: (contactId: string, reportsToId?: string) => void;
    isDarkMode: boolean;
}

// 根据 reportsToId 构建树形结构
interface OrgNode {
    contact: Relation;
    children: OrgNode[];
    level: number;
}

const buildOrgTree = (contacts: Relation[]): OrgNode[] => {
    // 找出所有顶级节点（没有 reportsToId 或 reportsToId 不在 contacts 中）
    const contactIds = new Set(contacts.map(c => c.id));

    const topLevel = contacts.filter(c =>
        !c.reportsToId || !contactIds.has(c.reportsToId)
    );

    const buildSubtree = (parent: Relation, level: number): OrgNode => {
        const children = contacts
            .filter(c => c.reportsToId === parent.id)
            .map(c => buildSubtree(c, level + 1));

        return {
            contact: parent,
            children,
            level
        };
    };

    return topLevel.map(c => buildSubtree(c, 0));
};

const isDescendantContact = (contacts: Relation[], sourceId: string, maybeDescendantId?: string) => {
    if (!maybeDescendantId) return false;

    let current = contacts.find(contact => contact.id === maybeDescendantId);
    const seen = new Set<string>();

    while (current?.reportsToId) {
        if (current.reportsToId === sourceId) return true;
        if (seen.has(current.id)) return false;
        seen.add(current.id);
        current = contacts.find(contact => contact.id === current?.reportsToId);
    }

    return false;
};

const ORG_CHART_NODE_CLASS = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.glassColor} bambook-outer-panel !rounded-inset`;
const ORG_CHART_PRESS_CLASS = BAMBOOK_OS.controls.listRow.press;
const ORG_CHART_MIN_ZOOM = 0.65;
const ORG_CHART_MAX_ZOOM = 1.35;
const ORG_CHART_ZOOM_STEP = 0.1;
const ORG_CHART_CANVAS_TOP_OFFSET = 118;

const clampOrgChartZoom = (value: number) =>
    Math.min(ORG_CHART_MAX_ZOOM, Math.max(ORG_CHART_MIN_ZOOM, value));

// 单个节点组件
const OrgNodeCard: React.FC<{
    node: OrgNode;
    focusedContactId: string | null;
    onFocusContact: (id: string, element: HTMLElement) => void;
    onOpenContact: (id: string) => void;
    onEdit: (contact: Relation) => void;
    onDragStart: (contactId: string) => void;
    onDragEnd: () => void;
    onDropOnContact: (targetId: string) => void;
    onDragOverContact: (targetId: string) => void;
    onDragLeaveContact: () => void;
    draggingContactId: string | null;
    dropTargetId: string | null;
    canDropOnContact: (targetId: string) => boolean;
    isDarkMode: boolean;
    isRoot?: boolean;
}> = ({
    node,
    focusedContactId,
    onFocusContact,
    onOpenContact,
    onEdit,
    onDragStart,
    onDragEnd,
    onDropOnContact,
    onDragOverContact,
    onDragLeaveContact,
    draggingContactId,
    dropTargetId,
    canDropOnContact,
    isDarkMode,
    isRoot
}) => {
    const { contact, children } = node;
    const hasChildren = children.length > 0;
    const isDragging = draggingContactId === contact.id;
    const canDropHere = canDropOnContact(contact.id);
    const isDropTarget = dropTargetId === contact.id && canDropHere;
    const isFocused = focusedContactId === contact.id;
    const brandTextClass = BAMBOOK_OS.tone.text.brandEmphasis;
    const subtleChipClass = BAMBOOK_OS.tone.chip.subtle;
    const dropTargetChipClass = BAMBOOK_OS.tone.chip.dropTarget;
    const metaEditClass = BAMBOOK_OS.controls.orgChartMeta.edit;
    const childrenBadgeClass = BAMBOOK_OS.controls.orgChartMeta.childrenBadge;

    return (
        <div className="flex flex-col items-center">
            {/* 连接线 - 向上 */}
            {!isRoot && (
                <div className="w-px h-8 bg-[var(--recessed-bg-strong)]" />
            )}

            {/* 节点卡片 */}
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: isDragging ? 0.45 : 1, scale: isDropTarget ? 1.04 : 1 }}
                className={`
          relative group cursor-pointer
          w-[200px]
        `}
                data-org-node-card
                draggable
                onDragStart={(event) => {
                    event.stopPropagation();
                    const dragEvent = event as unknown as React.DragEvent<HTMLDivElement>;
                    dragEvent.dataTransfer.effectAllowed = 'move';
                    dragEvent.dataTransfer.setData('text/plain', contact.id);
                    onDragStart(contact.id);
                }}
                onDragEnd={onDragEnd}
                onDragOver={(event) => {
                    if (!canDropHere) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    onDragOverContact(contact.id);
                }}
                onDragLeave={onDragLeaveContact}
                onDrop={(event) => {
                    if (!canDropHere) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onDropOnContact(contact.id);
                }}
                onClick={(event) => {
                    onFocusContact(contact.id, event.currentTarget);
                }}
                onDoubleClick={(event) => {
                    event.stopPropagation();
                    onOpenContact(contact.id);
                }}
            >
                <div
                    className={`
          p-3.5 rounded-inset
          ${ORG_CHART_NODE_CLASS} ${isDropTarget || isFocused ? BAMBOOK_OS.controls.selectedSurface.base : BAMBOOK_OS.controls.listRow.hover} ${ORG_CHART_PRESS_CLASS}
          ${draggingContactId && !canDropHere && !isDragging ? 'opacity-45' : ''}
        `}>
                    {isDropTarget && (
                        <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[9px] font-light tracking-wide ${dropTargetChipClass}`}>
                            放到这里
                        </div>
                    )}
                    {/* 顶部：基本信息 */}
                    <div className="flex items-center gap-2.5">
                        <span
                            className={`w-4 shrink-0 text-center text-base font-light ${brandTextClass}`}
                        >
                            {contact.name.charAt(0).toUpperCase()}
                        </span>

                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-light truncate text-[var(--text-primary)]">
                                {contact.name}
                            </h4>
                            <div className="mt-0.5">
                                <span className={`text-[10px] font-light truncate text-[var(--text-tertiary)]`}>
                                    {contact.role || '未设置职位'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* 底部：部门 + 展开按钮 */}
                    <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[var(--border-c-subtle)]">
                        {contact.department && (
                            <span className={`text-[10px] font-light px-2 py-0.5 rounded-full ${subtleChipClass}`}>
                                {contact.department}
                            </span>
                        )}

                        {hasChildren && (
                            <span className={`text-[9px] font-light text-[var(--text-tertiary)]`}>
                                {children.length} 下级
                            </span>
                        )}
                    </div>

                </div>

                {/* 编辑按钮放在卡片外层，避免被玻璃容器圆角裁剪。 */}
                <button
                    onClick={(e) => { e.stopPropagation(); onEdit(contact); }}
                    className={`
              absolute -top-2 -right-2 z-30 p-1.5 rounded-control opacity-0 group-hover:opacity-100 transition-all
              ${metaEditClass} ${BAMBOOK_OS.controls.listRow.hover}
            `}
                    aria-label={`编辑${contact.name}`}
                >
                    <Edit2 size={12} />
                </button>

                {/* 直接下属数量标签 */}
                {hasChildren && (
                    <div className={`
            absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[9px] font-light
            ${childrenBadgeClass}
          `}>
                        <Users size={10} className="inline mr-1" />
                        {children.length} 直属
                    </div>
                )}
            </motion.div>

            {/* 子节点 */}
            <AnimatePresence>
                {hasChildren && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-col items-center"
                    >
                        {/* 连接线 - 向下 */}
                        <div className="w-px h-8 bg-[var(--recessed-bg-strong)]" />

                        {/* 横向连接线 */}
                        {children.length > 1 && (
                            <div className="h-px bg-[var(--recessed-bg-strong)]"
                                style={{ width: `${Math.min(children.length * 240, 800)}px` }} />
                        )}

                        {/* 子节点容器 */}
                        <div className="flex gap-5 items-start">
                            {children.map((child, idx) => (
                                <OrgNodeCard
                                    key={child.contact.id}
                                    node={child}
                                    focusedContactId={focusedContactId}
                                    onFocusContact={onFocusContact}
                                    onOpenContact={onOpenContact}
                                    onEdit={onEdit}
                                    onDragStart={onDragStart}
                                    onDragEnd={onDragEnd}
                                    onDropOnContact={onDropOnContact}
                                    onDragOverContact={onDragOverContact}
                                    onDragLeaveContact={onDragLeaveContact}
                                    draggingContactId={draggingContactId}
                                    dropTargetId={dropTargetId}
                                    canDropOnContact={canDropOnContact}
                                    isDarkMode={isDarkMode}
                                />
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const OrgChart: React.FC<OrgChartProps> = ({
    organization,
    contacts,
    onSelectContact,
    onAddContact,
    onEditContact,
    onMoveContact,
    isDarkMode
}) => {
    const orgTree = useMemo(() => buildOrgTree(contacts), [contacts]);
    const [draggingContactId, setDraggingContactId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [focusedContactId, setFocusedContactId] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const viewportRef = useRef<HTMLDivElement>(null);
    const panStartRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
    const zoomPercent = Math.round(zoom * 100);

    const updatePan = (nextPan: { x: number; y: number } | ((current: { x: number; y: number }) => { x: number; y: number })) => {
        setPan(current => {
            const next = typeof nextPan === 'function' ? nextPan(current) : nextPan;
            // 动态计算边界，根据联系人数量给一个宽裕但有限的空间
            const limitX = Math.max(2000, contacts.length * 300);
            const limitY = Math.max(2000, contacts.length * 300);
            return {
                x: Math.max(-limitX, Math.min(limitX, next.x)),
                y: Math.max(-limitY, Math.min(limitY, next.y)),
            };
        });
    };

    const updateZoom = (nextZoom: number | ((current: number) => number)) => {
        setZoom(current => clampOrgChartZoom(typeof nextZoom === 'function' ? nextZoom(current) : nextZoom));
    };

    const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (!event.ctrlKey && !event.metaKey) {
            updatePan(current => ({
                x: current.x - event.deltaX,
                y: current.y - event.deltaY,
            }));
            return;
        }
        const direction = event.deltaY > 0 ? -1 : 1;
        updateZoom(current => current + direction * ORG_CHART_ZOOM_STEP);
    };

    const focusNodeInViewport = (element: HTMLElement) => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const viewportRect = viewport.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const viewportCenterX = viewportRect.left + viewportRect.width / 2;
        const viewportCenterY = viewportRect.top + (viewportRect.height + ORG_CHART_CANVAS_TOP_OFFSET) / 2;
        const elementCenterX = elementRect.left + elementRect.width / 2;
        const elementCenterY = elementRect.top + elementRect.height / 2;

        updatePan(current => ({
            x: current.x + (viewportCenterX - elementCenterX),
            y: current.y + (viewportCenterY - elementCenterY),
        }));
    };

    const handleFocusContact = (contactId: string, element: HTMLElement) => {
        setFocusedContactId(contactId);
        focusNodeInViewport(element);
    };

    const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, input, select, textarea, [data-org-node-card], [data-org-chart-static]')) return;

        panStartRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            panX: pan.x,
            panY: pan.y,
        };
        setIsPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const start = panStartRef.current;
        if (!start || start.pointerId !== event.pointerId) return;

        updatePan({
            x: start.panX + event.clientX - start.x,
            y: start.panY + event.clientY - start.y,
        });
    };

    const handleCanvasPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (panStartRef.current?.pointerId !== event.pointerId) return;
        panStartRef.current = null;
        setIsPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const canDropOnContact = (targetId: string) => {
        if (!draggingContactId) return false;
        if (draggingContactId === targetId) return false;

        const dragged = contacts.find(contact => contact.id === draggingContactId);
        if (!dragged || dragged.reportsToId === targetId) return false;

        return !isDescendantContact(contacts, draggingContactId, targetId);
    };

    const canDropOnOrganization = () => {
        if (!draggingContactId) return false;
        const dragged = contacts.find(contact => contact.id === draggingContactId);
        return !!dragged && !!dragged.reportsToId;
    };
    const brandTextClass = BAMBOOK_OS.tone.text.brandEmphasis;
    const actionButtonClass = BAMBOOK_OS.controls.actionControl.bordered;
    const quietIconSurfaceClass = BAMBOOK_OS.tone.surface.quietIcon;
    const floatingToolClusterClass = BAMBOOK_OS.controls.floatingToolCluster.surface;

    const clearDragState = () => {
        setDraggingContactId(null);
        setDropTargetId(null);
    };

    const handleDropOnContact = (targetId: string) => {
        if (!draggingContactId || !canDropOnContact(targetId)) {
            clearDragState();
            return;
        }

        onMoveContact(draggingContactId, targetId);
        clearDragState();
    };

    const handleDropOnOrganization = () => {
        if (!draggingContactId || !canDropOnOrganization()) {
            clearDragState();
            return;
        }

        onMoveContact(draggingContactId, undefined);
        clearDragState();
    };

    // 空状态
    if (contacts.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
                <div className={`w-20 h-20 rounded-card flex items-center justify-center mb-5 ${quietIconSurfaceClass}`}>
                    <Users size={40} strokeWidth={1} className="text-[var(--text-tertiary)]" />
                </div>
                <h3 className="text-base font-light mb-2 text-[var(--text-primary)]">
                    暂无组织架构
                </h3>
                <p className="text-sm text-center max-w-md mb-6 text-[var(--text-tertiary)]">
                    开始添加团队成员并设置汇报关系，构建 {organization.name} 的组织架构图。
                </p>
                <button
                    onClick={onAddContact}
                    className={`
            h-9 px-4 rounded-control border flex items-center gap-2 font-light text-xs transition-all
            ${actionButtonClass}
          `}
                >
                    <Plus size={16} />
                    添加第一位成员
                </button>
            </div>
        );
    }

    return (
        <div
            ref={viewportRef}
            className={`no-drag relative flex-1 min-h-0 overflow-hidden px-6 py-5 select-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
            onWheel={handleViewportWheel}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerEnd}
            onPointerCancel={handleCanvasPointerEnd}
            onDoubleClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('button, input, select, textarea, [data-org-node-card], [data-org-chart-static]')) return;
                updateZoom(1);
                setPan({ x: 0, y: 0 });
            }}
        >
            <div className="absolute right-6 top-5 z-30">
                <div className={`flex h-9 w-fit items-center gap-1 rounded-control border px-1.5 ${floatingToolClusterClass}`}>
                    <button
                        type="button"
                        onClick={() => updateZoom(current => current - ORG_CHART_ZOOM_STEP)}
                        className={`h-8 w-7 rounded-compact flex items-center justify-center transition-all ${BAMBOOK_OS.controls.listRow.hover} ${ORG_CHART_PRESS_CLASS} text-[var(--text-tertiary)]`}
                        aria-label="缩小组织架构"
                    >
                        <ZoomOut size={14} strokeWidth={1.6} />
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            updateZoom(1);
                            setPan({ x: 0, y: 0 });
                        }}
                        className={`h-8 min-w-12 rounded-compact px-2 text-[10px] font-light tracking-wide transition-all ${BAMBOOK_OS.controls.listRow.hover} ${ORG_CHART_PRESS_CLASS} text-[var(--text-tertiary)]`}
                        aria-label="重置组织架构缩放"
                    >
                        <span className="inline-flex items-center gap-1">
                            <RotateCcw size={11} strokeWidth={1.6} />
                            {zoomPercent}%
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => updateZoom(current => current + ORG_CHART_ZOOM_STEP)}
                        className={`h-8 w-7 rounded-compact flex items-center justify-center transition-all ${BAMBOOK_OS.controls.listRow.hover} ${ORG_CHART_PRESS_CLASS} text-[var(--text-tertiary)]`}
                        aria-label="放大组织架构"
                    >
                        <ZoomIn size={14} strokeWidth={1.6} />
                    </button>
                </div>
            </div>
            {/* 架构说明 */}
            <CompiledSurfacePanel
                isDarkMode={isDarkMode}
                data-org-chart-static
                className="relative z-20 mr-[158px] p-3"
                contentClassName="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2"
                compilerRole="relation-org-chart-legend-panel"
                source="OrgChart.LegendPanel"
            >
                <span className="text-[10px] font-light uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                    架构视图：
                </span>
                <div className="flex items-center gap-1.5">
                    <Building2 size={12} className={brandTextClass} />
                    <span className={`text-xs font-light text-[var(--text-tertiary)]`}>组织</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <User size={12} className={brandTextClass} />
                    <span className={`text-xs font-light text-[var(--text-tertiary)]`}>人员</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <ChevronDown size={12} className="text-[var(--text-tertiary)]" />
                    <span className={`text-xs font-light text-[var(--text-tertiary)]`}>下级关系</span>
                </div>
                <span className="text-[11px] ml-auto font-light text-[var(--text-tertiary)]">
                    拖动人员卡片到另一张卡片下方，或拖到组织卡片设为顶层
                </span>
            </CompiledSurfacePanel>

            {/* 组织架构图 */}
            <div className="absolute inset-x-6 bottom-5 top-[118px] z-10 overflow-visible">
            <div className="flex min-w-full justify-center">
            <div
                className={`w-max flex flex-col items-center transition-transform ${isPanning ? 'duration-0' : 'duration-300'} ease-[cubic-bezier(0.16,1,0.3,1)]`}
                style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, transformOrigin: 'top center' }}
            >
                {/* 组织顶部节点 */}
                <div
                    onDragOver={(event) => {
                        if (!canDropOnOrganization()) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDropTargetId('__organization__');
                    }}
                    onDragLeave={() => setDropTargetId(null)}
                    onDrop={(event) => {
                        if (!canDropOnOrganization()) return;
                        event.preventDefault();
                        handleDropOnOrganization();
                    }}
                    data-org-node-card
                    className={`
          w-[200px] p-3.5 rounded-inset mb-2
          ${ORG_CHART_NODE_CLASS} ${dropTargetId === '__organization__' ? BAMBOOK_OS.controls.selectedSurface.base : ''}
        `}
                >
                    <div className="flex items-center gap-2.5">
                        <Building2 size={20} className={`shrink-0 ${brandTextClass}`} />
                        <div>
                            <h3 className="text-sm font-light text-[var(--text-primary)]">
                                {organization.name}
                            </h3>
                            <span className="text-[10px] font-light text-[var(--text-tertiary)]">
                                {dropTargetId === '__organization__' ? '松手设为顶层成员' : `${contacts.length} 位成员`}
                            </span>
                        </div>
                    </div>
                </div>

                {/* 连接线 */}
                <div className="w-px h-8 bg-[var(--recessed-bg-strong)]" />

                {/* 树形结构 */}
                <div className="flex gap-6 items-start">
                    {orgTree.map((node) => (
                        <OrgNodeCard
                            key={node.contact.id}
                            node={node}
                            focusedContactId={focusedContactId}
                            onFocusContact={handleFocusContact}
                            onOpenContact={onSelectContact}
                            onEdit={onEditContact}
                            onDragStart={(contactId) => {
                                setDraggingContactId(contactId);
                                setDropTargetId(null);
                            }}
                            onDragEnd={clearDragState}
                            onDropOnContact={handleDropOnContact}
                            onDragOverContact={setDropTargetId}
                            onDragLeaveContact={() => setDropTargetId(null)}
                            draggingContactId={draggingContactId}
                            dropTargetId={dropTargetId}
                            canDropOnContact={canDropOnContact}
                            isDarkMode={isDarkMode}
                            isRoot
                        />
                    ))}
                </div>
            </div>
            </div>
            </div>

            {/* 添加成员按钮 */}
            <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 justify-center">
                <button
                    onClick={onAddContact}
                    className={`
            h-9 px-4 rounded-control flex items-center gap-2 font-light text-xs transition-all border
            ${actionButtonClass}
          `}
                >
                    <Plus size={14} />
                    添加成员
                </button>
            </div>
        </div>
    );
};

export default OrgChart;
