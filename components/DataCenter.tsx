import React from 'react';
import { Archive, Loader2, Send, Sparkles } from 'lucide-react';
import SidePanelContainer from './ui/SidePanelContainer';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import { apiService } from '../services/apiService';
import { KnowledgeCitation } from '../types';

type TwinTool = 'select' | 'wall' | 'door' | 'station' | 'server' | 'rack';
type DeviceKind = 'desktop' | 'laptop';
type Presence = 'online' | 'away' | 'offline';
type StationSeat = 'north' | 'east' | 'south' | 'west';

type WallSegment = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
};

type RoomRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  thickness: number;
  label?: string;
};

type TwinObject = {
  id: string;
  type: 'station' | 'server' | 'rack';
  x: number;
  y: number;
  label: string;
  device?: DeviceKind;
  person?: string;
  presence?: Presence;
  seat?: StationSeat;
};

type DoorGap = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
};

type OfficeFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  thickness: number;
};

type ViewBoxState = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type FrameEdge = 'top' | 'right' | 'bottom' | 'left';

type FrameAttachment = {
  edge: FrameEdge;
  ratio: number;
};

type WallAxis = 'horizontal' | 'vertical';

type DragState =
  | { kind: 'object'; id: string; dx: number; dy: number }
  | { kind: 'wall-end'; id: string; end: 'start' | 'end' }
  | { kind: 'room-move'; id: string; dx: number; dy: number }
  | { kind: 'room-corner'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se' }
  | { kind: 'frame-move'; dx: number; dy: number }
  | { kind: 'frame-corner'; corner: 'nw' | 'ne' | 'sw' | 'se' }
  | { kind: 'pan'; startClientX: number; startClientY: number; startViewBox: ViewBoxState }
  | null;

type DataCenterProps = {
  isDarkMode?: boolean;
  dataCenterEndpoint?: string;
};

type LayoutSnapshot = {
  officeFrame: OfficeFrame;
  rooms: RoomRect[];
  walls: WallSegment[];
  doors: DoorGap[];
  objects: TwinObject[];
  selectedId: string;
};

/** 数据中心双 tab：看板（RAG 智能问答为主）+ 数字孪生布局编辑器 */
type DataCenterTab = 'overview' | 'twin';

/** 问答归档分类（与策略文库 KnowledgeItem.category 同一枚举语义） */
const QA_ARCHIVE_CATEGORIES = ['Company', 'Policy', 'Production', 'Product', 'Customer', 'Supplier'] as const;

/** 数据看板快捷提问：面向纺织外贸主业务的示例问题，点击填入提问框 */
const QA_SUGGESTED_QUESTIONS = [
  '面料尾期验货的抽样标准是什么？',
  '产前样需要哪两方签字确认？',
  'T/T 30 天付款条款在合同里怎么表述？',
] as const;

const CANVAS_W = 820;
const CANVAS_H = 620;
const DATA_TWIN_LAYOUT_STORAGE_KEY = 'bambook:data-twin-layout:v2';
const DATA_TWIN_LAYOUT_PROFILE_KIND = 'data-twin-layout';
const DATA_TWIN_LAYOUT_PROFILE_ID = 'data-twin-layout:main-office';
const DATA_TWIN_LAYOUT_PROFILE_NAME = '公司数字孪生排布';
const STATION_DESK_WIDTH = 63.3;
const STATION_DESK_HEIGHT = 35.1;
const STATION_DESK_JOIN_GAP = 0.6;
const STATION_SNAP_THRESHOLD = 10;
const stationSeatOptions: Array<{ value: StationSeat; label: string }> = [
  { value: 'north', label: '朝北' },
  { value: 'east', label: '朝东' },
  { value: 'south', label: '朝南' },
  { value: 'west', label: '朝西' },
];
const initialOfficeFrame: OfficeFrame = { x: 28, y: 42, width: 762, height: 546, thickness: 5 };
const initialViewBox: ViewBoxState = { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H };

const initialRooms: RoomRect[] = [
  { id: 'room-meeting-kitchen', x: 28, y: 42, width: 182, height: 154, thickness: 5, label: '会议 + 厨' },
  { id: 'room-warehouse', x: 210, y: 42, width: 252, height: 154, thickness: 5, label: '仓库' },
  { id: 'room-design', x: 462, y: 42, width: 328, height: 154, thickness: 5, label: '设计间' },
  { id: 'room-office-a', x: 28, y: 196, width: 474, height: 392, thickness: 5, label: '大办公室 A' },
  { id: 'room-office-b', x: 502, y: 196, width: 288, height: 392, thickness: 5, label: '大办公室 B' },
  { id: 'room-small-office-b', x: 502, y: 444, width: 144, height: 144, thickness: 5, label: '小办公室 B' },
  { id: 'room-small-office-a', x: 646, y: 444, width: 144, height: 144, thickness: 5, label: '小办公室 A' },
];

const initialWalls: WallSegment[] = [];

const initialDoors: DoorGap[] = [
  { id: 'door-warehouse', x1: 352, y1: 196, x2: 400, y2: 196, thickness: 10 },
  { id: 'door-meeting-b', x1: 170, y1: 280, x2: 170, y2: 328, thickness: 10 },
  { id: 'door-small-office-b', x1: 552, y1: 444, x2: 600, y2: 444, thickness: 10 },
  { id: 'door-small-office-a', x1: 698, y1: 444, x2: 746, y2: 444, thickness: 10 },
];

const initialObjects: TwinObject[] = [
  { id: 'amy', type: 'station', x: 214, y: 250, label: 'Amy', person: 'Amy', device: 'desktop', presence: 'online' },
  { id: 'kevin', type: 'station', x: 340, y: 250, label: 'Kevin', person: 'Kevin', device: 'laptop', presence: 'online' },
  { id: 'sunny', type: 'station', x: 214, y: 363, label: 'Sunny', person: 'Sunny', device: 'desktop', presence: 'online' },
  { id: 'pm', type: 'station', x: 542, y: 250, label: 'PM', person: 'PM', device: 'laptop', presence: 'online' },
  { id: 'wendy', type: 'station', x: 662, y: 250, label: 'Wendy', person: 'Wendy', device: 'desktop', presence: 'away' },
  { id: 'data-center', type: 'server', x: 346, y: 465, label: '数据中心' },
  { id: 'warehouse-rack-a', type: 'rack', x: 278, y: 92, label: '面料货架 A' },
  { id: 'warehouse-rack-b', type: 'rack', x: 366, y: 92, label: '面料货架 B' },
];

function cloneLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
  return {
    officeFrame: { ...snapshot.officeFrame },
    rooms: snapshot.rooms.map((room) => ({ ...room })),
    walls: snapshot.walls.map((wall) => ({ ...wall })),
    doors: snapshot.doors.map((door) => ({ ...door })),
    objects: snapshot.objects.map((item) => ({ ...item })),
    selectedId: snapshot.selectedId,
  };
}

function createDefaultLayoutSnapshot(): LayoutSnapshot {
  return cloneLayoutSnapshot({
    officeFrame: initialOfficeFrame,
    rooms: initialRooms,
    walls: initialWalls,
    doors: initialDoors,
    objects: initialObjects,
    selectedId: 'data-center',
  });
}

function normalizeLayoutSnapshot(snapshot: Partial<LayoutSnapshot> | null | undefined): LayoutSnapshot | null {
  if (
    !snapshot?.officeFrame ||
    !Array.isArray(snapshot.rooms) ||
    !Array.isArray(snapshot.walls) ||
    !Array.isArray(snapshot.doors) ||
    !Array.isArray(snapshot.objects)
  ) {
    return null;
  }
  return cloneLayoutSnapshot({
    officeFrame: snapshot.officeFrame,
    rooms: snapshot.rooms,
    walls: snapshot.walls,
    doors: snapshot.doors,
    objects: snapshot.objects,
    selectedId: typeof snapshot.selectedId === 'string' ? snapshot.selectedId : '',
  });
}

function readCachedLayoutSnapshot(): LayoutSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const rawLayout = window.localStorage.getItem(DATA_TWIN_LAYOUT_STORAGE_KEY);
    if (!rawLayout) return null;
    const savedLayout = JSON.parse(rawLayout) as Partial<LayoutSnapshot>;
    return normalizeLayoutSnapshot(savedLayout);
  } catch {
    window.localStorage.removeItem(DATA_TWIN_LAYOUT_STORAGE_KEY);
    return null;
  }
}

function cacheLayoutSnapshot(snapshot: LayoutSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DATA_TWIN_LAYOUT_STORAGE_KEY, JSON.stringify(snapshot));
}

function pointFromEvent<T extends SVGElement>(evt: React.PointerEvent<T>, viewBox: ViewBoxState): { x: number; y: number } {
  const svg = evt.currentTarget instanceof SVGSVGElement ? evt.currentTarget : evt.currentTarget.ownerSVGElement;
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  return {
    x: viewBox.x + ((evt.clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((evt.clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snap(value: number, grid = 10): number {
  return Math.round(value / grid) * grid;
}

function snapPoint(point: Point, grid = 10): Point {
  return { x: snap(point.x, grid), y: snap(point.y, grid) };
}

function getStationDeskSize(seat: StationSeat = 'north'): { width: number; height: number } {
  return seat === 'east' || seat === 'west'
    ? { width: STATION_DESK_HEIGHT, height: STATION_DESK_WIDTH }
    : { width: STATION_DESK_WIDTH, height: STATION_DESK_HEIGHT };
}

function snapStationToStations(moving: TwinObject, rawPoint: Point, objects: TwinObject[]): Point {
  if (moving.type !== 'station') return snapPoint(rawPoint, 2);

  const movingSeat = moving.seat ?? 'north';
  const movingDesk = getStationDeskSize(movingSeat);
  let best: { point: Point; score: number } | null = null;

  objects.forEach((target) => {
    if (target.id === moving.id || target.type !== 'station') return;

    const targetSeat = target.seat ?? 'north';
    const targetDesk = getStationDeskSize(targetSeat);
    const xGap = Math.abs(rawPoint.x - target.x);
    const yGap = Math.abs(rawPoint.y - target.y);

    const consider = (point: Point, score: number) => {
      if (score > STATION_SNAP_THRESHOLD * 1.8) return;
      if (!best || score < best.score) best = { point, score };
    };

    if (yGap <= STATION_SNAP_THRESHOLD) {
      const leftPoint = { x: target.x - movingDesk.width - STATION_DESK_JOIN_GAP, y: target.y };
      const rightPoint = { x: target.x + targetDesk.width + STATION_DESK_JOIN_GAP, y: target.y };
      consider(leftPoint, Math.abs(rawPoint.x - leftPoint.x) + yGap);
      consider(rightPoint, Math.abs(rawPoint.x - rightPoint.x) + yGap);
    }

    if (xGap <= STATION_SNAP_THRESHOLD) {
      const topPoint = { x: target.x, y: target.y - movingDesk.height - STATION_DESK_JOIN_GAP };
      const bottomPoint = { x: target.x, y: target.y + targetDesk.height + STATION_DESK_JOIN_GAP };
      consider(topPoint, Math.abs(rawPoint.y - topPoint.y) + xGap);
      consider(bottomPoint, Math.abs(rawPoint.y - bottomPoint.y) + xGap);
    }
  });

  // best 在 forEach 闭包内被赋值，TS control-flow 无法跨闭包跟踪，需显式类型断言。
  const bestSnap = best as { point: Point; score: number } | null;
  return snapPoint(bestSnap?.point ?? rawPoint, 2);
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function nearestPointOnSegment(point: { x: number; y: number }, wall: WallSegment): { x: number; y: number; distance: number; t: number } {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const lengthSquared = dx * dx + dy * dy || 1;
  const rawT = ((point.x - wall.x1) * dx + (point.y - wall.y1) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const x = wall.x1 + dx * t;
  const y = wall.y1 + dy * t;
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
}

function getFrameAttachment(point: Point, frame: OfficeFrame, threshold = 8): FrameAttachment | null {
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const candidates: Array<FrameAttachment & { distance: number }> = [];

  if (point.x >= frame.x - threshold && point.x <= right + threshold) {
    candidates.push({ edge: 'top', ratio: clamp((point.x - frame.x) / frame.width, 0, 1), distance: Math.abs(point.y - frame.y) });
    candidates.push({ edge: 'bottom', ratio: clamp((point.x - frame.x) / frame.width, 0, 1), distance: Math.abs(point.y - bottom) });
  }
  if (point.y >= frame.y - threshold && point.y <= bottom + threshold) {
    candidates.push({ edge: 'left', ratio: clamp((point.y - frame.y) / frame.height, 0, 1), distance: Math.abs(point.x - frame.x) });
    candidates.push({ edge: 'right', ratio: clamp((point.y - frame.y) / frame.height, 0, 1), distance: Math.abs(point.x - right) });
  }

  const match = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (!match || match.distance > threshold) return null;
  return { edge: match.edge, ratio: match.ratio };
}

function pointFromFrameAttachment(attachment: FrameAttachment, frame: OfficeFrame): Point {
  if (attachment.edge === 'top') return { x: frame.x + frame.width * attachment.ratio, y: frame.y };
  if (attachment.edge === 'bottom') return { x: frame.x + frame.width * attachment.ratio, y: frame.y + frame.height };
  if (attachment.edge === 'left') return { x: frame.x, y: frame.y + frame.height * attachment.ratio };
  return { x: frame.x + frame.width, y: frame.y + frame.height * attachment.ratio };
}

function carryFrameAttachedPoint(point: Point, oldFrame: OfficeFrame, nextFrame: OfficeFrame): Point {
  const attachment = getFrameAttachment(point, oldFrame);
  if (!attachment) return point;
  return pointFromFrameAttachment(attachment, nextFrame);
}

function getWallAxis(anchor: Point, point: Point): WallAxis {
  return Math.abs(point.x - anchor.x) >= Math.abs(point.y - anchor.y) ? 'horizontal' : 'vertical';
}

function constrainPointToAxis(point: Point, anchor: Point, axis: WallAxis): Point {
  return axis === 'horizontal' ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
}

function snapAxisPointToLayout(point: Point, anchor: Point, axis: WallAxis, walls: WallSegment[], frame: OfficeFrame, excludedWallId?: string): Point {
  const constrained = constrainPointToAxis(point, anchor, axis);
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const threshold = 12;

  if (axis === 'horizontal') {
    if (Math.abs(constrained.x - frame.x) <= threshold && constrained.y >= frame.y - threshold && constrained.y <= bottom + threshold) {
      return { x: frame.x, y: anchor.y };
    }
    if (Math.abs(constrained.x - right) <= threshold && constrained.y >= frame.y - threshold && constrained.y <= bottom + threshold) {
      return { x: right, y: anchor.y };
    }
  } else {
    if (Math.abs(constrained.y - frame.y) <= threshold && constrained.x >= frame.x - threshold && constrained.x <= right + threshold) {
      return { x: anchor.x, y: frame.y };
    }
    if (Math.abs(constrained.y - bottom) <= threshold && constrained.x >= frame.x - threshold && constrained.x <= right + threshold) {
      return { x: anchor.x, y: bottom };
    }
  }

  const wallEndpoints = walls
    .filter((wall) => wall.id !== excludedWallId)
    .flatMap((wall) => [
      { x: wall.x1, y: wall.y1 },
      { x: wall.x2, y: wall.y2 },
    ]);
  const alignedEndpoints = wallEndpoints.filter((endpoint) => (
    axis === 'horizontal' ? Math.abs(endpoint.y - anchor.y) <= threshold : Math.abs(endpoint.x - anchor.x) <= threshold
  ));
  const nearestEndpoint = alignedEndpoints
    .map((endpoint) => ({ endpoint, distance: axis === 'horizontal' ? Math.abs(constrained.x - endpoint.x) : Math.abs(constrained.y - endpoint.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearestEndpoint && nearestEndpoint.distance <= threshold) return { ...nearestEndpoint.endpoint };

  return snapPoint(constrained);
}

function snapToLayout(point: Point, walls: WallSegment[], frame: OfficeFrame, excludedWallId?: string): Point {
  const frameAttachment = getFrameAttachment(point, frame, 12);
  if (frameAttachment) return snapPoint(pointFromFrameAttachment(frameAttachment, frame), 2);

  const wallEndpoints = walls
    .filter((wall) => wall.id !== excludedWallId)
    .flatMap((wall) => [
      { x: wall.x1, y: wall.y1 },
      { x: wall.x2, y: wall.y2 },
    ]);
  const nearestEndpoint = wallEndpoints
    .map((endpoint) => ({ endpoint, distance: Math.hypot(point.x - endpoint.x, point.y - endpoint.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearestEndpoint && nearestEndpoint.distance <= 12) return { ...nearestEndpoint.endpoint };

  const threshold = 12;
  const verticalSnap = walls
    .filter((wall) => wall.id !== excludedWallId && Math.abs(wall.x1 - wall.x2) <= 1)
    .filter((wall) => point.y >= Math.min(wall.y1, wall.y2) - threshold && point.y <= Math.max(wall.y1, wall.y2) + threshold)
    .map((wall) => ({ x: wall.x1, distance: Math.abs(point.x - wall.x1) }))
    .sort((a, b) => a.distance - b.distance)[0];
  const horizontalSnap = walls
    .filter((wall) => wall.id !== excludedWallId && Math.abs(wall.y1 - wall.y2) <= 1)
    .filter((wall) => point.x >= Math.min(wall.x1, wall.x2) - threshold && point.x <= Math.max(wall.x1, wall.x2) + threshold)
    .map((wall) => ({ y: wall.y1, distance: Math.abs(point.y - wall.y1) }))
    .sort((a, b) => a.distance - b.distance)[0];

  return snapPoint({
    x: verticalSnap && verticalSnap.distance <= threshold ? verticalSnap.x : point.x,
    y: horizontalSnap && horizontalSnap.distance <= threshold ? horizontalSnap.y : point.y,
  });
}

function carryFrameAttachedLayout<T extends WallSegment | DoorGap>(items: T[], oldFrame: OfficeFrame, nextFrame: OfficeFrame): T[] {
  return items.map((item) => {
    const start = carryFrameAttachedPoint({ x: item.x1, y: item.y1 }, oldFrame, nextFrame);
    const end = carryFrameAttachedPoint({ x: item.x2, y: item.y2 }, oldFrame, nextFrame);
    return { ...item, x1: snap(start.x, 2), y1: snap(start.y, 2), x2: snap(end.x, 2), y2: snap(end.y, 2) };
  });
}

function roomToWallSegments(room: RoomRect): WallSegment[] {
  const right = room.x + room.width;
  const bottom = room.y + room.height;
  return [
    { id: `${room.id}:top`, x1: room.x, y1: room.y, x2: right, y2: room.y, thickness: room.thickness },
    { id: `${room.id}:right`, x1: right, y1: room.y, x2: right, y2: bottom, thickness: room.thickness },
    { id: `${room.id}:bottom`, x1: room.x, y1: bottom, x2: right, y2: bottom, thickness: room.thickness },
    { id: `${room.id}:left`, x1: room.x, y1: room.y, x2: room.x, y2: bottom, thickness: room.thickness },
  ];
}

function roomsToWallSegments(rooms: RoomRect[]): WallSegment[] {
  return rooms.flatMap(roomToWallSegments);
}

function getRoomSnapLines(frame: OfficeFrame, rooms: RoomRect[], walls: WallSegment[], excludedRoomId?: string): { vertical: number[]; horizontal: number[] } {
  const vertical = [frame.x, frame.x + frame.width];
  const horizontal = [frame.y, frame.y + frame.height];

  rooms.forEach((room) => {
    if (room.id === excludedRoomId) return;
    vertical.push(room.x, room.x + room.width);
    horizontal.push(room.y, room.y + room.height);
  });

  walls.forEach((wall) => {
    if (Math.abs(wall.x1 - wall.x2) <= 1) vertical.push(wall.x1);
    if (Math.abs(wall.y1 - wall.y2) <= 1) horizontal.push(wall.y1);
  });

  return { vertical, horizontal };
}

function nearestSnapLine(value: number, lines: number[], threshold = 12): number | null {
  const match = lines
    .map((line) => ({ line, distance: Math.abs(value - line) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return match && match.distance <= threshold ? match.line : null;
}

function snapRoomMove(room: RoomRect, rawX: number, rawY: number, frame: OfficeFrame, rooms: RoomRect[], walls: WallSegment[]): RoomRect {
  const lines = getRoomSnapLines(frame, rooms, walls, room.id);
  const leftSnap = nearestSnapLine(rawX, lines.vertical);
  const rightSnap = nearestSnapLine(rawX + room.width, lines.vertical);
  const topSnap = nearestSnapLine(rawY, lines.horizontal);
  const bottomSnap = nearestSnapLine(rawY + room.height, lines.horizontal);

  let x = rawX;
  let y = rawY;
  if (leftSnap !== null && rightSnap !== null) {
    x += Math.abs(rawX - leftSnap) <= Math.abs(rawX + room.width - rightSnap) ? leftSnap - rawX : rightSnap - (rawX + room.width);
  } else if (leftSnap !== null) {
    x = leftSnap;
  } else if (rightSnap !== null) {
    x = rightSnap - room.width;
  }

  if (topSnap !== null && bottomSnap !== null) {
    y += Math.abs(rawY - topSnap) <= Math.abs(rawY + room.height - bottomSnap) ? topSnap - rawY : bottomSnap - (rawY + room.height);
  } else if (topSnap !== null) {
    y = topSnap;
  } else if (bottomSnap !== null) {
    y = bottomSnap - room.height;
  }

  return { ...room, x: snap(x, 2), y: snap(y, 2) };
}

function snapRoomCorner(room: RoomRect, corner: 'nw' | 'ne' | 'sw' | 'se', point: Point, frame: OfficeFrame, rooms: RoomRect[], walls: WallSegment[]): RoomRect {
  const lines = getRoomSnapLines(frame, rooms, walls, room.id);
  const right = room.x + room.width;
  const bottom = room.y + room.height;
  const minWidth = 36;
  const minHeight = 36;
  let x = room.x;
  let y = room.y;
  let nextRight = right;
  let nextBottom = bottom;
  const nextX = snap(point.x, 2);
  const nextY = snap(point.y, 2);

  if (corner === 'nw' || corner === 'sw') {
    x = nearestSnapLine(nextX, lines.vertical) ?? nextX;
    x = Math.min(x, right - minWidth);
  }
  if (corner === 'ne' || corner === 'se') {
    nextRight = nearestSnapLine(nextX, lines.vertical) ?? nextX;
    nextRight = Math.max(nextRight, room.x + minWidth);
  }
  if (corner === 'nw' || corner === 'ne') {
    y = nearestSnapLine(nextY, lines.horizontal) ?? nextY;
    y = Math.min(y, bottom - minHeight);
  }
  if (corner === 'sw' || corner === 'se') {
    nextBottom = nearestSnapLine(nextY, lines.horizontal) ?? nextY;
    nextBottom = Math.max(nextBottom, room.y + minHeight);
  }

  return {
    ...room,
    x: snap(x, 2),
    y: snap(y, 2),
    width: snap(nextRight - x, 2),
    height: snap(nextBottom - y, 2),
  };
}

function getLayoutFitViewBox(frame: OfficeFrame, rooms: RoomRect[], walls: WallSegment[], doors: DoorGap[], objects: TwinObject[], editing = false): ViewBoxState {
  const points: Point[] = [
    { x: frame.x, y: frame.y },
    { x: frame.x + frame.width, y: frame.y + frame.height },
  ];

  rooms.forEach((room) => {
    points.push({ x: room.x, y: room.y }, { x: room.x + room.width, y: room.y + room.height });
  });
  walls.forEach((wall) => {
    points.push({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
  });
  doors.forEach((door) => {
    points.push({ x: door.x1, y: door.y1 }, { x: door.x2, y: door.y2 });
  });
  objects.forEach((item) => {
    const width = item.type === 'server' ? 124 : item.type === 'rack' ? 82 : 134;
    const height = item.type === 'rack' ? 46 : item.type === 'station' ? 104 : 112;
    const xPad = item.type === 'station' ? 18 : 16;
    const yPad = item.type === 'station' ? 20 : 16;
    points.push({ x: item.x - xPad, y: item.y - yPad }, { x: item.x + width, y: item.y + height });
  });

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const margin = 70;
  const sideSafeMargin = editing ? 180 : 0;
  return {
    x: minX - margin - sideSafeMargin,
    y: minY - margin,
    width: Math.max(320, maxX - minX + margin * 2 + sideSafeMargin * 2),
    height: Math.max(260, maxY - minY + margin * 2),
  };
}

function makeDoorGap(point: { x: number; y: number }, walls: WallSegment[], frame: OfficeFrame): DoorGap | null {
  const outerWalls: WallSegment[] = [
    { id: 'frame-top', x1: frame.x, y1: frame.y, x2: frame.x + frame.width, y2: frame.y, thickness: frame.thickness },
    { id: 'frame-bottom', x1: frame.x, y1: frame.y + frame.height, x2: frame.x + frame.width, y2: frame.y + frame.height, thickness: frame.thickness },
    { id: 'frame-left', x1: frame.x, y1: frame.y, x2: frame.x, y2: frame.y + frame.height, thickness: frame.thickness },
    { id: 'frame-right', x1: frame.x + frame.width, y1: frame.y, x2: frame.x + frame.width, y2: frame.y + frame.height, thickness: frame.thickness },
  ];
  const candidates = [...outerWalls, ...walls]
    .map((wall) => ({ wall, nearest: nearestPointOnSegment(point, wall) }))
    .sort((a, b) => a.nearest.distance - b.nearest.distance);
  const match = candidates[0];
  if (!match || match.nearest.distance > 24) return null;

  const { wall, nearest } = match;
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const half = Math.min(24, Math.max(14, length * 0.12));
  const centerX = wall.x1 + dx * nearest.t;
  const centerY = wall.y1 + dy * nearest.t;

  return {
    id: nextId('door'),
    x1: snap(centerX - ux * half, 2),
    y1: snap(centerY - uy * half, 2),
    x2: snap(centerX + ux * half, 2),
    y2: snap(centerY + uy * half, 2),
    thickness: Math.max(10, wall.thickness + 5),
  };
}

const toolLabels: Array<{ id: TwinTool; label: string; hint: string }> = [
  { id: 'select', label: '选择 / 移动', hint: '拖动物件或墙端点' },
  { id: 'wall', label: '矩形房间 / 隔断', hint: '点击两角画一个闭合框' },
  { id: 'door', label: '门洞 / 断口', hint: '点击墙体附近自动吸附' },
  { id: 'station', label: '员工工位', hint: '点击放置，可切设备' },
  { id: 'server', label: '服务器', hint: '点击放置数据中心' },
  { id: 'rack', label: '货架 / 样品点', hint: '点击放置仓库对象' },
];

const DataCenter: React.FC<DataCenterProps> = ({ isDarkMode = false, dataCenterEndpoint }) => {
  const buttonCls = `h-9 rounded-control px-4 text-xs font-light transition-all flex items-center justify-center border ${
    isDarkMode
      ? BAMBOOK_OS.controls.actionControl.dark
      : BAMBOOK_OS.controls.actionControl.light
  }`;
  const [initialLayout] = React.useState<LayoutSnapshot>(() => readCachedLayoutSnapshot() ?? createDefaultLayoutSnapshot());
  const [tool, setTool] = React.useState<TwinTool>('select');
  const [officeFrame, setOfficeFrame] = React.useState<OfficeFrame>(() => ({ ...initialLayout.officeFrame }));
  const [viewBox, setViewBox] = React.useState<ViewBoxState>(initialViewBox);
  const [rooms, setRooms] = React.useState<RoomRect[]>(() => initialLayout.rooms.map((room) => ({ ...room })));
  const [walls, setWalls] = React.useState<WallSegment[]>(() => initialLayout.walls.map((wall) => ({ ...wall })));
  const [doors, setDoors] = React.useState<DoorGap[]>(() => initialLayout.doors.map((door) => ({ ...door })));
  const [objects, setObjects] = React.useState<TwinObject[]>(() => initialLayout.objects.map((item) => ({ ...item })));
  const [selectedId, setSelectedId] = React.useState<string>(initialLayout.selectedId);
  const [wallStart, setWallStart] = React.useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = React.useState<DragState>(null);
  const [isEditingLayout, setIsEditingLayout] = React.useState(false);
  const [undoStack, setUndoStack] = React.useState<LayoutSnapshot[]>([]);
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  // 数据看板 tab（默认）：RAG 智能问答状态
  const [activeTab, setActiveTab] = React.useState<DataCenterTab>('overview');
  const [qaQuestion, setQaQuestion] = React.useState('');
  const [qaAnswer, setQaAnswer] = React.useState('');
  const [qaCitations, setQaCitations] = React.useState<KnowledgeCitation[]>([]);
  const [qaBusy, setQaBusy] = React.useState(false);
  const [qaError, setQaError] = React.useState<string | null>(null);
  const [qaArchiveCategory, setQaArchiveCategory] = React.useState<string>('Company');
  const [qaArchived, setQaArchived] = React.useState(false);
  const [qaArchiving, setQaArchiving] = React.useState(false);

  const officeFrameRef = React.useRef(officeFrame);
  const roomsRef = React.useRef(rooms);
  const wallsRef = React.useRef(walls);
  const doorsRef = React.useRef(doors);
  const objectsRef = React.useRef(objects);
  const selectedIdRef = React.useRef(selectedId);

  const applyLayoutSnapshot = React.useCallback((snapshot: LayoutSnapshot) => {
    setOfficeFrame({ ...snapshot.officeFrame });
    setRooms(snapshot.rooms.map((room) => ({ ...room })));
    setWalls(snapshot.walls.map((wall) => ({ ...wall })));
    setDoors(snapshot.doors.map((door) => ({ ...door })));
    setObjects(snapshot.objects.map((item) => ({ ...item })));
    setSelectedId(snapshot.selectedId);
    setWallStart(null);
    setDrag(null);
  }, []);

  React.useEffect(() => {
    officeFrameRef.current = officeFrame;
  }, [officeFrame]);

  React.useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  React.useEffect(() => {
    wallsRef.current = walls;
  }, [walls]);

  React.useEffect(() => {
    doorsRef.current = doors;
  }, [doors]);

  React.useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  React.useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  React.useEffect(() => {
    let cancelled = false;
    apiService
      .listBusinessProfiles<LayoutSnapshot>(DATA_TWIN_LAYOUT_PROFILE_KIND, dataCenterEndpoint)
      .then((profiles) => {
        if (cancelled) return;
        const profile = profiles.find((item) => item.id === DATA_TWIN_LAYOUT_PROFILE_ID) ?? profiles[0];
        const snapshot = normalizeLayoutSnapshot(profile?.payload);
        if (!snapshot) return;
        applyLayoutSnapshot(snapshot);
        cacheLayoutSnapshot(snapshot);
      })
      .catch((error) => {
        console.warn('[DataCenter] layout sync failed:', error?.message ?? error);
      });
    return () => {
      cancelled = true;
    };
  }, [applyLayoutSnapshot, dataCenterEndpoint]);

  const pushUndoSnapshot = React.useCallback(() => {
    const snapshot: LayoutSnapshot = {
      officeFrame: { ...officeFrameRef.current },
      rooms: roomsRef.current.map((room) => ({ ...room })),
      walls: wallsRef.current.map((wall) => ({ ...wall })),
      doors: doorsRef.current.map((door) => ({ ...door })),
      objects: objectsRef.current.map((item) => ({ ...item })),
      selectedId: selectedIdRef.current,
    };
    setUndoStack((stack) => [...stack.slice(-39), snapshot]);
  }, []);

  const undoLayout = React.useCallback(() => {
    setUndoStack((stack) => {
      const snapshot = stack[stack.length - 1];
      if (!snapshot) return stack;
      applyLayoutSnapshot(snapshot);
      return stack.slice(0, -1);
    });
  }, [applyLayoutSnapshot]);

  const saveLayout = React.useCallback(async () => {
    const snapshot: LayoutSnapshot = {
      officeFrame: { ...officeFrameRef.current },
      rooms: roomsRef.current.map((room) => ({ ...room })),
      walls: wallsRef.current.map((wall) => ({ ...wall })),
      doors: doorsRef.current.map((door) => ({ ...door })),
      objects: objectsRef.current.map((item) => ({ ...item })),
      selectedId: selectedIdRef.current,
    };
    setSaveState('saving');
    try {
      await apiService.saveBusinessProfile<LayoutSnapshot>({
        id: DATA_TWIN_LAYOUT_PROFILE_ID,
        kind: DATA_TWIN_LAYOUT_PROFILE_KIND,
        name: DATA_TWIN_LAYOUT_PROFILE_NAME,
        payload: snapshot,
        isActive: true,
      }, dataCenterEndpoint);
      cacheLayoutSnapshot(snapshot);
      setSaveState('saved');
    } catch (error) {
      console.warn('[DataCenter] layout save failed:', error?.message ?? error);
      setSaveState('failed');
    }
    window.setTimeout(() => setSaveState('idle'), 1600);
  }, [dataCenterEndpoint]);

  const fitLayoutView = React.useCallback(() => {
    setViewBox(getLayoutFitViewBox(officeFrameRef.current, roomsRef.current, wallsRef.current, doorsRef.current, objectsRef.current, isEditingLayout));
  }, [isEditingLayout]);

  /** 切换 tab：离开孪生画布时退出编辑态，避免隐藏的 Delete/Undo 键盘捕获与误保存 */
  const switchTab = React.useCallback((next: DataCenterTab) => {
    setActiveTab(next);
    if (next === 'overview') {
      setIsEditingLayout(false);
      setTool('select');
      setWallStart(null);
      setDrag(null);
    }
  }, []);

  /** RAG 智能问答：引用检索与流式回答并行（与策略文库 QA 同一 knowledge_api 契约） */
  const handleAsk = React.useCallback(async () => {
    const q = qaQuestion.trim();
    if (!q || qaBusy) return;
    setQaBusy(true);
    setQaError(null);
    setQaAnswer('');
    setQaCitations([]);
    setQaArchived(false);
    try {
      const searchPromise = apiService.searchKnowledgeBase(q).then(setQaCitations).catch(() => setQaCitations([]));
      await apiService.askKnowledgeBase(q, (piece) => setQaAnswer((prev) => prev + piece));
      await searchPromise;
    } catch (error: any) {
      setQaError(error?.message || '问答服务暂不可用，请稍后重试');
    } finally {
      setQaBusy(false);
    }
  }, [qaBusy, qaQuestion]);

  /** 问答归档：沉淀为知识文档进入检索语料，反哺后续问答 */
  const handleArchiveQa = React.useCallback(async () => {
    const q = qaQuestion.trim();
    const a = qaAnswer.trim();
    if (!q || !a || qaArchiving || qaArchived) return;
    setQaArchiving(true);
    setQaError(null);
    try {
      const title = `问答：${q.slice(0, 40)}${q.length > 40 ? '…' : ''}`;
      await apiService.ingestKnowledgeText({ title, text: `问题：${q}\n\n回答：${a}`, category: qaArchiveCategory, sourceType: 'qa' });
      setQaArchived(true);
    } catch (error: any) {
      setQaError(error?.message || '归档失败，请稍后重试');
    } finally {
      setQaArchiving(false);
    }
  }, [qaAnswer, qaArchived, qaArchiving, qaArchiveCategory, qaQuestion]);

  const deleteSelected = React.useCallback(() => {
    const id = selectedIdRef.current;
    if (!id || id === 'office-frame') return;
    pushUndoSnapshot();
    setObjects((items) => items.filter((item) => item.id !== id));
    setRooms((items) => items.filter((item) => item.id !== id));
    setWalls((items) => items.filter((item) => item.id !== id));
    setDoors((items) => items.filter((item) => item.id !== id));
    setSelectedId('');
  }, [pushUndoSnapshot]);

  React.useEffect(() => {
    if (!isEditingLayout) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIdRef.current && selectedIdRef.current !== 'office-frame') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key.toLowerCase() !== 'z') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      undoLayout();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, isEditingLayout, undoLayout]);

  const selectedObject = objects.find((item) => item.id === selectedId);
  const selectedRoom = rooms.find((item) => item.id === selectedId);
  const selectedWall = walls.find((item) => item.id === selectedId);
  const selectedDoor = doors.find((item) => item.id === selectedId);
  const isOfficeFrameSelected = selectedId === 'office-frame';
  const layoutWalls = React.useMemo(() => [...roomsToWallSegments(rooms), ...walls], [rooms, walls]);
  const browseViewBox = React.useMemo(
    () => getLayoutFitViewBox(officeFrame, rooms, walls, doors, objects, false),
    [doors, objects, officeFrame, rooms, walls],
  );
  const displayViewBox = isEditingLayout ? viewBox : browseViewBox;
  const pointFromPointer = React.useCallback(<T extends SVGElement,>(evt: React.PointerEvent<T>) => pointFromEvent(evt, displayViewBox), [displayViewBox]);
  const gridBounds = React.useMemo(() => ({
    x: displayViewBox.x - displayViewBox.width * 1.5,
    y: displayViewBox.y - displayViewBox.height * 1.5,
    width: displayViewBox.width * 4,
    height: displayViewBox.height * 4,
  }), [displayViewBox]);

  const updateFrameWithAttachedLayout = React.useCallback((getNextFrame: (frame: OfficeFrame) => OfficeFrame) => {
    setOfficeFrame((oldFrame) => {
      const nextFrame = getNextFrame(oldFrame);
      setWalls((items) => carryFrameAttachedLayout(items, oldFrame, nextFrame));
      setDoors((items) => carryFrameAttachedLayout(items, oldFrame, nextFrame));
      return nextFrame;
    });
  }, []);

  const addObject = (kind: TwinTool, x: number, y: number) => {
    pushUndoSnapshot();
    const base = { x: snap(x - 62), y: snap(y - 45) };
    if (kind === 'station') {
      const count = objects.filter((item) => item.type === 'station').length + 1;
      setObjects((items) => [
        ...items,
        {
          id: nextId('station'),
          type: 'station',
          label: `工位 ${count}`,
          person: `User ${count}`,
          presence: 'online',
          device: count % 2 === 0 ? 'laptop' : 'desktop',
          seat: 'north',
          ...base,
        },
      ]);
      return;
    }
    if (kind === 'server') {
      setObjects((items) => [...items, { id: nextId('server'), type: 'server', label: '服务器', x: snap(x - 54), y: snap(y - 54) }]);
      return;
    }
    if (kind === 'rack') {
      setObjects((items) => [...items, { id: nextId('rack'), type: 'rack', label: '货架', x: snap(x - 39), y: snap(y - 13) }]);
    }
  };

  const handleCanvasPointerDown = (evt: React.PointerEvent<SVGSVGElement>) => {
    if (evt.target !== evt.currentTarget) return;
    if (evt.button !== 0) return;
    if (!isEditingLayout) return;
    if (tool === 'select') {
      setSelectedId('');
      setWallStart(null);
      evt.currentTarget.setPointerCapture(evt.pointerId);
      setDrag({
        kind: 'pan',
        startClientX: evt.clientX,
        startClientY: evt.clientY,
        startViewBox: viewBox,
      });
      return;
    }
    const point = pointFromPointer(evt);
    if (tool === 'door') {
      const door = makeDoorGap(point, layoutWalls, officeFrameRef.current);
      if (!door) return;
      pushUndoSnapshot();
      setDoors((items) => [...items, door]);
      setSelectedId(door.id);
      return;
    }
    if (tool === 'wall') {
      if (!wallStart) {
        setWallStart(snapToLayout(point, layoutWalls, officeFrameRef.current));
        return;
      }
      const layoutPoint = snapToLayout(point, layoutWalls, officeFrameRef.current);
      const x = Math.min(wallStart.x, layoutPoint.x);
      const y = Math.min(wallStart.y, layoutPoint.y);
      const width = Math.abs(layoutPoint.x - wallStart.x);
      const height = Math.abs(layoutPoint.y - wallStart.y);
      if (width < 36 || height < 36) {
        setWallStart(layoutPoint);
        return;
      }
      pushUndoSnapshot();
      setRooms((items) => [...items, { id: nextId('room'), x, y, width, height, thickness: 5, label: `区域 ${items.length + 1}` }]);
      setWallStart(null);
      return;
    }
    addObject(tool, point.x, point.y);
  };

  const handleObjectPointerDown = (evt: React.PointerEvent<SVGGElement>, item: TwinObject) => {
    evt.stopPropagation();
    if (evt.button !== 0) return;
    setSelectedId(item.id);
    if (!isEditingLayout) return;
    evt.currentTarget.setPointerCapture(evt.pointerId);
    pushUndoSnapshot();
    const point = pointFromPointer(evt);
    setDrag({ kind: 'object', id: item.id, dx: point.x - item.x, dy: point.y - item.y });
  };

  const handleWallPointerDown = (evt: React.PointerEvent<SVGLineElement>, wall: WallSegment) => {
    evt.stopPropagation();
    if (evt.button !== 0) return;
    if (!isEditingLayout) return;
    if (tool === 'door') {
      const door = makeDoorGap(pointFromPointer(evt), layoutWalls, officeFrameRef.current);
      if (!door) return;
      pushUndoSnapshot();
      setDoors((items) => [...items, door]);
      setSelectedId(door.id);
      return;
    }
    setSelectedId(wall.id);
  };

  const handleRoomPointerDown = (evt: React.PointerEvent<SVGRectElement>, room: RoomRect) => {
    evt.stopPropagation();
    if (evt.button !== 0) return;
    if (!isEditingLayout) return;
    const point = pointFromPointer(evt);
    if (tool === 'door') {
      const door = makeDoorGap(point, layoutWalls, officeFrameRef.current);
      if (!door) return;
      pushUndoSnapshot();
      setDoors((items) => [...items, door]);
      setSelectedId(door.id);
      return;
    }
    setSelectedId(room.id);
    evt.currentTarget.setPointerCapture(evt.pointerId);
    pushUndoSnapshot();
    setDrag({ kind: 'room-move', id: room.id, dx: point.x - room.x, dy: point.y - room.y });
  };

  const handleRoomCornerPointerDown = (evt: React.PointerEvent<SVGCircleElement>, room: RoomRect, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!isEditingLayout) return;
    evt.stopPropagation();
    if (evt.button !== 0) return;
    setSelectedId(room.id);
    evt.currentTarget.setPointerCapture(evt.pointerId);
    pushUndoSnapshot();
    setDrag({ kind: 'room-corner', id: room.id, corner });
  };

  const handleFramePointerDown = (evt: React.PointerEvent<SVGRectElement>) => {
    if (!isEditingLayout) return;
    evt.stopPropagation();
    if (evt.button !== 0) return;
    const point = pointFromPointer(evt);
    if (tool === 'door') {
      const door = makeDoorGap(point, layoutWalls, officeFrameRef.current);
      if (!door) return;
      pushUndoSnapshot();
      setDoors((items) => [...items, door]);
      setSelectedId(door.id);
      return;
    }
    setSelectedId('office-frame');
    evt.currentTarget.setPointerCapture(evt.pointerId);
    pushUndoSnapshot();
    setDrag({ kind: 'frame-move', dx: point.x - officeFrame.x, dy: point.y - officeFrame.y });
  };

  const handleFrameCornerPointerDown = (evt: React.PointerEvent<SVGCircleElement>, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!isEditingLayout) return;
    evt.stopPropagation();
    if (evt.button !== 0) return;
    setSelectedId('office-frame');
    evt.currentTarget.setPointerCapture(evt.pointerId);
    pushUndoSnapshot();
    setDrag({ kind: 'frame-corner', corner });
  };

  const handleWallEndPointerDown = (evt: React.PointerEvent<SVGCircleElement>, wall: WallSegment, end: 'start' | 'end') => {
    if (!isEditingLayout) return;
    evt.stopPropagation();
    if (evt.button !== 0) return;
    setSelectedId(wall.id);
    evt.currentTarget.setPointerCapture(evt.pointerId);
    pushUndoSnapshot();
    setDrag({ kind: 'wall-end', id: wall.id, end });
  };

  const handlePointerMove = (evt: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (evt.buttons === 0) {
      setDrag(null);
      return;
    }
    if (drag.kind === 'pan') {
      const svg = evt.currentTarget;
      const rect = svg.getBoundingClientRect();
      const dx = ((evt.clientX - drag.startClientX) / rect.width) * drag.startViewBox.width;
      const dy = ((evt.clientY - drag.startClientY) / rect.height) * drag.startViewBox.height;
      setViewBox({ ...drag.startViewBox, x: drag.startViewBox.x - dx, y: drag.startViewBox.y - dy });
      return;
    }
    if (!isEditingLayout) return;
    const point = pointFromPointer(evt);
    if (drag.kind === 'object') {
      setObjects((items) => items.map((item) => (
        item.id === drag.id
          ? { ...item, ...snapStationToStations(item, { x: point.x - drag.dx, y: point.y - drag.dy }, items) }
          : item
      )));
      return;
    }
    if (drag.kind === 'room-move') {
      setRooms((items) => items.map((room) => (
        room.id === drag.id
          ? snapRoomMove(room, point.x - drag.dx, point.y - drag.dy, officeFrameRef.current, items, wallsRef.current)
          : room
      )));
      return;
    }
    if (drag.kind === 'room-corner') {
      setRooms((items) => items.map((room) => {
        if (room.id !== drag.id) return room;
        return snapRoomCorner(room, drag.corner, point, officeFrameRef.current, items, wallsRef.current);
      }));
      return;
    }
    if (drag.kind === 'wall-end') {
      setWalls((items) => items.map((wall) => {
        if (wall.id !== drag.id) return wall;
        const anchor = drag.end === 'start' ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
        const axis: WallAxis = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.y2 - wall.y1) ? 'horizontal' : 'vertical';
        const layoutPoint = snapAxisPointToLayout(point, anchor, axis, items, officeFrameRef.current, wall.id);
        if (drag.end === 'start') return { ...wall, x1: layoutPoint.x, y1: layoutPoint.y };
        return { ...wall, x2: layoutPoint.x, y2: layoutPoint.y };
      }));
      return;
    }
    if (drag.kind === 'frame-move') {
      updateFrameWithAttachedLayout((frame) => ({ ...frame, x: snap(point.x - drag.dx, 2), y: snap(point.y - drag.dy, 2) }));
      return;
    }
    updateFrameWithAttachedLayout((frame) => {
      const right = frame.x + frame.width;
      const bottom = frame.y + frame.height;
      const minWidth = 240;
      const minHeight = 180;
      const nextX = snap(point.x, 2);
      const nextY = snap(point.y, 2);

      if (drag.corner === 'nw') {
        const x = Math.min(nextX, right - minWidth);
        const y = Math.min(nextY, bottom - minHeight);
        return { ...frame, x, y, width: right - x, height: bottom - y };
      }
      if (drag.corner === 'ne') {
        const y = Math.min(nextY, bottom - minHeight);
        const width = Math.max(minWidth, nextX - frame.x);
        return { ...frame, y, width, height: bottom - y };
      }
      if (drag.corner === 'sw') {
        const x = Math.min(nextX, right - minWidth);
        const height = Math.max(minHeight, nextY - frame.y);
        return { ...frame, x, width: right - x, height };
      }
      return { ...frame, width: Math.max(minWidth, nextX - frame.x), height: Math.max(minHeight, nextY - frame.y) };
    });
  };

  const handleWheel = (evt: React.WheelEvent<SVGSVGElement>) => {
    if (!isEditingLayout) return;
    evt.preventDefault();
    const svg = evt.currentTarget;
    const rect = svg.getBoundingClientRect();
    const cursorX = viewBox.x + ((evt.clientX - rect.left) / rect.width) * viewBox.width;
    const cursorY = viewBox.y + ((evt.clientY - rect.top) / rect.height) * viewBox.height;
    const ratioX = (cursorX - viewBox.x) / viewBox.width;
    const ratioY = (cursorY - viewBox.y) / viewBox.height;
    const factor = evt.deltaY > 0 ? 1.08 : 0.92;
    const nextWidth = clamp(viewBox.width * factor, CANVAS_W * 0.46, CANVAS_W * 1.8);
    const nextHeight = clamp(viewBox.height * factor, CANVAS_H * 0.46, CANVAS_H * 1.8);
    setViewBox({
      x: cursorX - ratioX * nextWidth,
      y: cursorY - ratioY * nextHeight,
      width: nextWidth,
      height: nextHeight,
    });
  };

  const updateSelectedObject = (patch: Partial<TwinObject>) => {
    if (!selectedObject) return;
    pushUndoSnapshot();
    setObjects((items) => items.map((item) => item.id === selectedObject.id ? { ...item, ...patch } : item));
  };

  const updateSelectedRoom = (patch: Partial<RoomRect>) => {
    if (!selectedRoom) return;
    pushUndoSnapshot();
    setRooms((items) => items.map((item) => item.id === selectedRoom.id ? { ...item, ...patch } : item));
  };

  const tabButtonClass = (tab: DataCenterTab) =>
    `px-6 py-1.5 rounded-compact text-[11px] font-light tracking-wide transition-all ${activeTab === tab ? (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light) : (isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-500 hover:text-slate-700')}`;

  return (
    <div className={`w-full h-full flex flex-col bg-transparent overflow-hidden ${isDarkMode ? 'text-slate-100' : 'text-deep-alt'}`}>
      <PageHeader
        title="数据中心"
        subtitle="Data Center"
        contextLabel="Data Hub"
        isDarkMode={isDarkMode}
        actions={activeTab === 'twin' ? (
          <div className="flex items-center gap-2">
            {isEditingLayout && (
              <>
                <button
                  onClick={fitLayoutView}
                  className={buttonCls}
                >
                  适配视图
                </button>
                <button
                  onClick={saveLayout}
                  className={buttonCls}
                >
                  {saveState === 'saving' ? '同步中' : saveState === 'saved' ? '已同步' : saveState === 'failed' ? '同步失败' : '保存布局'}
                </button>
              </>
            )}
            <button
              onClick={() => {
                setIsEditingLayout((current) => {
                  const next = !current;
                  if (next) {
                    window.requestAnimationFrame(() => {
                      setViewBox(getLayoutFitViewBox(officeFrameRef.current, roomsRef.current, wallsRef.current, doorsRef.current, objectsRef.current, true));
                    });
                  }
                  return next;
                });
                setTool('select');
                setWallStart(null);
              }}
              className={buttonCls}
            >
              {isEditingLayout ? '完成布局' : '编辑布局'}
            </button>
          </div>
        ) : undefined}
      />

      <div className={`${BAMBOOK_OS.layout.desktopSinglePanelBodyClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`}>
        {/* Tab Bar */}
        <div className={`${BAMBOOK_OS.layout.desktopSubtoolbarClass} justify-center bg-transparent`}>
          <div className={`inline-flex p-1 rounded-full ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}>
            <button onClick={() => switchTab('overview')} className={tabButtonClass('overview')}>数据看板</button>
            <button onClick={() => switchTab('twin')} className={tabButtonClass('twin')}>数字孪生</button>
          </div>
        </div>

        {activeTab === 'overview' ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {/* 看板简介 */}
              <div className="flex items-start gap-3 px-1">
                <Sparkles size={18} strokeWidth={1.2} className={`mt-0.5 shrink-0 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`} />
                <div className="min-w-0">
                  <h2 className={`text-base font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>企业知识智能问答</h2>
                  <p className={`mt-1 text-[11px] font-light leading-relaxed ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    向量检索企业知识语料（邮件 / 文档 / SOP / 历史问答），LLM 流式生成回答并列出命中片段；有价值的一键归档回知识库。
                  </p>
                </div>
              </div>

              {/* 提问区 */}
              <div className={`p-6 ${BAMBOOK_OS.material.cardLight} ${isDarkMode ? 'bg-deep/48' : 'bg-white/46'}`}>
                <textarea
                  rows={3}
                  value={qaQuestion}
                  onChange={(e) => setQaQuestion(e.target.value)}
                  placeholder="向企业知识库提问，如：面料尾期验货的抽样标准是什么？"
                  className={`w-full px-5 py-4 border rounded-control outline-none font-light resize-none text-sm leading-relaxed transition-all ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {QA_SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => setQaQuestion(q)}
                      className={`px-3 py-1.5 rounded-full border text-[10px] font-light tracking-wide transition-all ${isDarkMode ? 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5' : 'border-slate-200/70 text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className={`text-[10px] font-light tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>向量检索知识语料 + LLM 流式回答，命中片段在下方列出</span>
                  <button
                    onClick={handleAsk}
                    disabled={qaBusy || !qaQuestion.trim()}
                    className={`px-5 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border disabled:opacity-50 ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}
                  >
                    {qaBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.2} />}
                    {qaBusy ? '检索回答中…' : '提问'}
                  </button>
                </div>
              </div>

              {qaError && (
                <div className={`px-5 py-3 rounded-control border text-xs font-light ${isDarkMode ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-500'}`}>{qaError}</div>
              )}

              {/* 回答区 */}
              {(qaAnswer || qaBusy) && (
                <div className={`p-6 ${BAMBOOK_OS.material.cardLight} ${isDarkMode ? 'bg-deep/48' : 'bg-white/46'}`}>
                  <div className={`mb-3 text-[10px] font-light tracking-[0.18em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>回答</div>
                  <p className={`whitespace-pre-wrap text-[13px] font-light leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    {qaAnswer}
                    {qaBusy && <span className="inline-block w-2 h-4 ml-0.5 align-middle animate-pulse bg-current opacity-40" />}
                  </p>
                  {!qaBusy && qaAnswer.trim() && (
                    <div className={`mt-5 pt-4 border-t flex items-center justify-end gap-3 ${isDarkMode ? 'border-white/10' : 'border-white/30'}`}>
                      {qaArchived ? (
                        <span className={`text-[11px] font-light ${isDarkMode ? 'text-emerald-300/80' : 'text-emerald-600'}`}>已归档到企业知识库</span>
                      ) : (
                        <>
                          <select
                            value={qaArchiveCategory}
                            onChange={(e) => setQaArchiveCategory(e.target.value)}
                            className={`px-3 py-2 border rounded-control outline-none text-[11px] font-light appearance-none ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}
                          >
                            {QA_ARCHIVE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <button
                            onClick={handleArchiveQa}
                            disabled={qaArchiving}
                            className={`px-4 py-2 rounded-full flex items-center gap-2 text-[11px] font-light tracking-wide transition-all border disabled:opacity-50 ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`}
                          >
                            {qaArchiving ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} strokeWidth={1.2} />}
                            归档此问答
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 引用片段 */}
              {qaCitations.length > 0 && (
                <div className={`p-6 ${BAMBOOK_OS.material.cardLight} ${isDarkMode ? 'bg-deep/48' : 'bg-white/46'}`}>
                  <div className={`mb-3 text-[10px] font-light tracking-[0.18em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>命中片段 ({qaCitations.length})</div>
                  <div className="space-y-3">
                    {qaCitations.map((c) => (
                      <div key={c.id} className={`rounded-control border px-4 py-3 ${isDarkMode ? 'border-white/[0.055] bg-white/[0.02]' : 'border-slate-200/55 bg-white/40'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className={`text-[11px] font-light truncate ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{c.title}</span>
                          <span className={`shrink-0 text-[9px] font-light tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{Math.round(c.score * 100)}%</span>
                        </div>
                        <p className={`mt-1 line-clamp-2 text-[11px] font-light leading-relaxed ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{c.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
        <div className="relative flex-1 min-h-0 px-5 pb-5">
        <div className="relative h-full min-h-0">
        <div className="absolute inset-0">
          <svg
            viewBox={`${displayViewBox.x} ${displayViewBox.y} ${displayViewBox.width} ${displayViewBox.height}`}
            className="h-full w-full select-none touch-none"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
            onWheel={handleWheel}
          >
            <defs>
              <pattern id="dataTwinGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M30 0H0V30" fill="none" stroke="rgb(var(--os-vnext-brand-blue-rgb)/.10)" strokeWidth="1" />
              </pattern>
              <linearGradient id="stationScreenOnTwin" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#a9ecff" />
                <stop offset=".42" stopColor="#2f9bff" />
                <stop offset="1" stopColor="#103f8f" />
              </linearGradient>
              <linearGradient id="deskSurfaceTwin" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity=".92" />
                <stop offset=".58" stopColor="#e6f4ff" stopOpacity=".72" />
                <stop offset="1" stopColor="#cfe8ff" stopOpacity=".54" />
              </linearGradient>
              <linearGradient id="serverBodyTwin" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#244f82" />
                <stop offset=".55" stopColor="#193a67" />
                <stop offset="1" stopColor="#102744" />
              </linearGradient>
              <linearGradient id="personHeadTwin" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#a9ecff" />
                <stop offset=".45" stopColor="#2f9bff" />
                <stop offset="1" stopColor="#126dcc" />
              </linearGradient>
              <linearGradient id="personBodyTwin" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity=".76" />
                <stop offset=".55" stopColor="#5ab8ff" stopOpacity=".58" />
                <stop offset="1" stopColor="#126dcc" stopOpacity=".72" />
              </linearGradient>
              <radialGradient id="personHaloTwin" cx="50%" cy="50%" r="68%">
                <stop offset="0" stopColor="#126dcc" stopOpacity=".12" />
                <stop offset="1" stopColor="#126dcc" stopOpacity="0" />
              </radialGradient>
              <filter id="softGlowTwin">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="var(--os-vnext-brand-blue-strong)" floodOpacity=".28" />
              </filter>
              <filter id="stationShadowTwin" x="-30%" y="-30%" width="160%" height="170%">
                <feDropShadow dx="0" dy="12" stdDeviation="7" floodColor="#225ca0" floodOpacity=".10" />
              </filter>
              <filter id="deskShadowTwin" x="-30%" y="-30%" width="160%" height="170%">
                <feDropShadow dx="0" dy="8" stdDeviation="5" floodColor="#225ca0" floodOpacity=".09" />
              </filter>
              <filter id="screenGlowTwin" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="var(--os-vnext-brand-blue-strong)" floodOpacity=".38" />
              </filter>
              <filter id="deviceBodyGlowTwin" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="var(--os-vnext-brand-blue-strong)" floodOpacity=".14" />
              </filter>
              <filter id="screenCoreGlowTwin" x="-80%" y="-80%" width="260%" height="260%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#8CE9FF" floodOpacity=".72" />
              </filter>
            </defs>
            <rect x={gridBounds.x} y={gridBounds.y} width={gridBounds.width} height={gridBounds.height} fill="url(#dataTwinGrid)" pointerEvents="none" />
            <rect x={gridBounds.x} y={gridBounds.y} width={gridBounds.width} height={gridBounds.height} fill={isDarkMode ? 'rgba(10,24,42,.18)' : 'rgba(255,255,255,.18)'} pointerEvents="none" />

            <rect
              x={officeFrame.x}
              y={officeFrame.y}
              width={officeFrame.width}
              height={officeFrame.height}
              fill="none"
              stroke={isOfficeFrameSelected ? 'var(--os-vnext-brand-blue-strong)' : isDarkMode ? 'rgba(180,206,240,.72)' : 'rgba(14,56,96,.72)'}
              strokeWidth={officeFrame.thickness}
              vectorEffect="non-scaling-stroke"
              onPointerDown={handleFramePointerDown}
              style={{ cursor: isEditingLayout ? 'move' : 'default' }}
            />
            {isEditingLayout && isOfficeFrameSelected && (
              <>
                {[
                  ['nw', officeFrame.x, officeFrame.y],
                  ['ne', officeFrame.x + officeFrame.width, officeFrame.y],
                  ['sw', officeFrame.x, officeFrame.y + officeFrame.height],
                  ['se', officeFrame.x + officeFrame.width, officeFrame.y + officeFrame.height],
                ].map(([corner, x, y]) => (
                  <circle
                    key={corner}
                    cx={Number(x)}
                    cy={Number(y)}
                    r="8"
                    fill="var(--os-vnext-brand-blue-strong)"
                    stroke="rgba(255,255,255,.88)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(evt) => handleFrameCornerPointerDown(evt, corner as 'nw' | 'ne' | 'sw' | 'se')}
                    style={{ cursor: `${corner}-resize` }}
                  />
                ))}
              </>
            )}

            {rooms.map((room) => (
              <g key={room.id}>
                <rect
                  x={room.x}
                  y={room.y}
                  width={room.width}
                  height={room.height}
                  fill="none"
                  stroke={selectedId === room.id ? 'var(--os-vnext-brand-blue-strong)' : isDarkMode ? 'rgba(180,206,240,.72)' : 'rgba(14,56,96,.72)'}
                  strokeWidth={room.thickness}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(evt) => handleRoomPointerDown(evt, room)}
                  style={{ cursor: isEditingLayout ? 'move' : 'default' }}
                />
                {room.label && (
                  <text x={room.x + 16} y={room.y + 24} fill={isDarkMode ? 'rgba(203,213,225,.44)' : 'rgba(71,85,105,.48)'} fontSize="12" letterSpacing="2" pointerEvents="none">
                    {room.label}
                  </text>
                )}
                {isEditingLayout && selectedId === room.id && (
                  <>
                    {[
                      ['nw', room.x, room.y],
                      ['ne', room.x + room.width, room.y],
                      ['sw', room.x, room.y + room.height],
                      ['se', room.x + room.width, room.y + room.height],
                    ].map(([corner, x, y]) => (
                      <circle
                        key={corner}
                        cx={Number(x)}
                        cy={Number(y)}
                        r="7"
                        fill="var(--os-vnext-brand-blue-strong)"
                        stroke="rgba(255,255,255,.88)"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        onPointerDown={(evt) => handleRoomCornerPointerDown(evt, room, corner as 'nw' | 'ne' | 'sw' | 'se')}
                        style={{ cursor: `${corner}-resize` }}
                      />
                    ))}
                  </>
                )}
              </g>
            ))}

            {walls.map((wall) => (
              <g key={wall.id}>
                <line
                  x1={wall.x1}
                  y1={wall.y1}
                  x2={wall.x2}
                  y2={wall.y2}
                  stroke={selectedId === wall.id ? 'var(--os-vnext-brand-blue-strong)' : isDarkMode ? 'rgba(180,206,240,.72)' : 'rgba(14,56,96,.72)'}
                  strokeWidth={wall.thickness}
                  strokeLinecap="square"
                  onPointerDown={(evt) => handleWallPointerDown(evt, wall)}
                />
                {isEditingLayout && selectedId === wall.id && (
                  <>
                    <circle cx={wall.x1} cy={wall.y1} r="7" fill="var(--os-vnext-brand-blue-strong)" onPointerDown={(evt) => handleWallEndPointerDown(evt, wall, 'start')} />
                    <circle cx={wall.x2} cy={wall.y2} r="7" fill="var(--os-vnext-brand-blue-strong)" onPointerDown={(evt) => handleWallEndPointerDown(evt, wall, 'end')} />
                  </>
                )}
              </g>
            ))}

            {doors.map((door) => (
              <line
                key={door.id}
                x1={door.x1}
                y1={door.y1}
                x2={door.x2}
                y2={door.y2}
                stroke={isDarkMode ? 'rgba(10,24,42,.96)' : 'rgba(255,255,255,.98)'}
                strokeWidth={door.thickness}
                strokeLinecap="square"
                onPointerDown={(evt) => {
                  evt.stopPropagation();
                  if (isEditingLayout) setSelectedId(door.id);
                }}
              />
            ))}

            {wallStart && (
              <circle cx={wallStart.x} cy={wallStart.y} r="6" fill="var(--os-vnext-brand-blue-strong)" filter="url(#softGlowTwin)" />
            )}

            {objects.map((item) => (
              <TwinObjectView
                key={item.id}
                item={item}
                isSelected={isEditingLayout && item.id === selectedId}
                isDarkMode={isDarkMode}
                onPointerDown={handleObjectPointerDown}
              />
            ))}
          </svg>
        </div>

        {isEditingLayout && (
          <>
            <SidePanelContainer isDarkMode={isDarkMode} spotlight className="absolute left-0 top-2 z-20 w-[184px] rounded-inset p-3 bambook-outer-panel" contentClassName="relative z-10 flex min-h-0 flex-col">
              <h2 className="mb-2 px-2 text-[10px] font-normal uppercase tracking-[0.16em] text-slate-500">绘制组件</h2>
              <div className="space-y-1.5">
                {toolLabels.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { setTool(item.id); setWallStart(null); }}
                    className={`w-full rounded-compact px-3 py-2 text-left transition-all border ${
                      tool === item.id
                        ? (isDarkMode
                            ? `${BAMBOOK_OS.controls.selectedSurface.dark} text-white`
                            : `${BAMBOOK_OS.controls.selectedSurface.light} text-deep-alt`)
                        : `border-transparent ${isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light}`
                    }`}
                  >
                    <span className="block text-[13px] font-light">{item.label}</span>
                    <span className="mt-0.5 block text-[9px] font-light text-slate-500">{item.hint}</span>
                  </button>
                ))}
              </div>
            </SidePanelContainer>

            <div className="absolute bottom-0 left-0 z-40">
            <SidePanelContainer isDarkMode={isDarkMode} spotlight className="w-[232px] rounded-inset p-3 bambook-outer-panel" contentClassName="relative z-10 flex min-h-0 flex-col">
              <h2 className="mb-3 px-2 text-[10px] font-normal uppercase tracking-[0.16em] text-slate-500">属性</h2>
              {selectedObject ? (
                <div className="space-y-2">
                  <Field label="名称" isDarkMode={isDarkMode}>
                    <input value={selectedObject.label} onChange={(evt) => updateSelectedObject({ label: evt.target.value })} className="w-full bg-transparent outline-none" />
                  </Field>
                  {selectedObject.type === 'station' && (
                    <>
                      <Field label="人员" isDarkMode={isDarkMode}>
                        <input value={selectedObject.person ?? ''} onChange={(evt) => updateSelectedObject({ person: evt.target.value })} className="w-full bg-transparent outline-none" />
                      </Field>
                      <Field label="设备" isDarkMode={isDarkMode}>
                        <select value={selectedObject.device} onChange={(evt) => updateSelectedObject({ device: evt.target.value as DeviceKind })} className="w-full bg-transparent outline-none">
                          <option value="desktop">台式机</option>
                          <option value="laptop">笔记本</option>
                        </select>
                      </Field>
                      <Field label="状态" isDarkMode={isDarkMode}>
                        <select value={selectedObject.presence} onChange={(evt) => updateSelectedObject({ presence: evt.target.value as Presence })} className="w-full bg-transparent outline-none">
                          <option value="online">在线</option>
                          <option value="away">离开</option>
                          <option value="offline">离线</option>
                        </select>
                      </Field>
                      <Field label="坐向" isDarkMode={isDarkMode}>
                        <div className="grid grid-cols-4 gap-1">
                          {stationSeatOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => updateSelectedObject({ seat: option.value })}
                              className={`h-8 rounded-full text-[9px] font-light transition-all ${
                                (selectedObject.seat ?? 'north') === option.value
                                  ? (isDarkMode 
                                      ? 'bg-[var(--os-vnext-brand-blue-strong)]/24 text-[var(--os-vnext-brand-blue-soft)] shadow-[inset_0_0_0_1px_rgb(var(--os-vnext-brand-blue-soft-rgb)/0.25)]' 
                                      : 'bg-[var(--os-vnext-brand-blue-strong)]/12 text-[var(--os-vnext-brand-blue-strong)] shadow-[inset_0_0_0_1px_rgb(var(--os-vnext-brand-blue-strong-rgb)/.22)]')
                                  : (isDarkMode ? 'text-slate-400 hover:bg-white/5' : 'text-slate-500 hover:bg-white/45')
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </Field>
                    </>
                  )}
                  <Field label="位置" isDarkMode={isDarkMode}>
                    <span>x {Math.round(selectedObject.x)} / y {Math.round(selectedObject.y)}</span>
                  </Field>
                </div>
              ) : selectedRoom ? (
                <div className="space-y-2">
                  <Field label="矩形区域" isDarkMode={isDarkMode}>
                    <input value={selectedRoom.label ?? ''} onChange={(evt) => updateSelectedRoom({ label: evt.target.value })} className="w-full bg-transparent outline-none" />
                  </Field>
                  <Field label="尺寸" isDarkMode={isDarkMode}>
                    <span>{Math.round(selectedRoom.width)} × {Math.round(selectedRoom.height)}</span>
                  </Field>
                  <Field label="位置" isDarkMode={isDarkMode}>
                    <span>x {Math.round(selectedRoom.x)} / y {Math.round(selectedRoom.y)}</span>
                  </Field>
                </div>
              ) : selectedWall ? (
                <div className="space-y-2">
                  <Field label="墙体" isDarkMode={isDarkMode}>
                    <span>{selectedWall.id}</span>
                  </Field>
                  <Field label="起点 / 终点" isDarkMode={isDarkMode}>
                    <span>{Math.round(selectedWall.x1)}, {Math.round(selectedWall.y1)} → {Math.round(selectedWall.x2)}, {Math.round(selectedWall.y2)}</span>
                  </Field>
                </div>
              ) : selectedDoor ? (
                <div className="space-y-2">
                  <Field label="门洞" isDarkMode={isDarkMode}>
                    <span>{selectedDoor.id}</span>
                  </Field>
                  <Field label="断口" isDarkMode={isDarkMode}>
                    <span>{Math.round(selectedDoor.x1)}, {Math.round(selectedDoor.y1)} → {Math.round(selectedDoor.x2)}, {Math.round(selectedDoor.y2)}</span>
                  </Field>
                </div>
              ) : isOfficeFrameSelected ? (
                <div className="space-y-2">
                  <Field label="最外框" isDarkMode={isDarkMode}>
                    <span>{Math.round(officeFrame.width)} × {Math.round(officeFrame.height)}</span>
                  </Field>
                  <Field label="位置" isDarkMode={isDarkMode}>
                    <span>x {Math.round(officeFrame.x)} / y {Math.round(officeFrame.y)}</span>
                  </Field>
                  <p className="px-2 text-xs font-light leading-5 text-slate-500">直接拖动外框移动，拖四角调整大小。</p>
                </div>
              ) : (
                <p className="px-2 text-xs font-light text-slate-500">选择对象后编辑属性。</p>
              )}
              <button onClick={deleteSelected} disabled={!selectedId || selectedId === 'office-frame'} className={`mt-3 h-8 w-full rounded-compact border transition-colors text-[11px] font-light disabled:opacity-35 ${isDarkMode ? 'border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'}`}>
                删除选中对象
              </button>
            </SidePanelContainer>
            </div>
          </>
        )}
        </div>
        </div>
        )}
      </div>
    </div>
  );
};

function Field({ label, children, isDarkMode = false }: { label: string; children: React.ReactNode; isDarkMode?: boolean }) {
  return (
    <label className={`block rounded-compact border px-3 py-2 text-[11px] font-light ${
      isDarkMode 
        ? 'border-white/5 bg-white/[0.02] text-slate-400' 
        : 'border-[var(--os-vnext-brand-blue)]/15 bg-white/35 text-slate-500'
    }`}>
      <span className={`mb-0.5 block text-[9px] uppercase tracking-[0.14em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{label}</span>
      <span className={`block ${isDarkMode ? 'text-white' : 'text-deep-alt'}`}>{children}</span>
    </label>
  );
}

function TwinObjectView({
  item,
  isSelected,
  isDarkMode,
  onPointerDown,
}: {
  item: TwinObject;
  isSelected: boolean;
  isDarkMode: boolean;
  onPointerDown: (evt: React.PointerEvent<SVGGElement>, item: TwinObject) => void;
}) {
  return (
    <g transform={`translate(${item.x} ${item.y})`} onPointerDown={(evt) => onPointerDown(evt, item)} style={{ cursor: 'grab' }}>
      {isSelected && <rect x={item.type === 'station' ? "-16" : "-8"} y={item.type === 'station' ? "-18" : "-8"} width={item.type === 'server' ? 124 : item.type === 'station' ? 150 : 142} height={item.type === 'station' ? 112 : 112} rx="18" fill="rgb(var(--os-vnext-brand-blue-strong-rgb)/.08)" stroke="rgb(var(--os-vnext-brand-blue-strong-rgb)/.30)" strokeWidth="1" />}
      {item.type === 'station' && <StationSvg item={item} isDarkMode={isDarkMode} />}
      {item.type === 'server' && <ServerSvg label={item.label} />}
      {item.type === 'rack' && <RackSvg label={item.label} />}
    </g>
  );
}

function StationSvg({ item, isDarkMode }: { item: TwinObject; isDarkMode: boolean }) {
  const personOpacity = item.presence === 'online' ? 1 : item.presence === 'away' ? 0.34 : 0.18;
  const nameColor = item.presence === 'online' ? '#48627E' : '#667C95';
  const seat = item.seat ?? 'north';
  const stationSeatLayout: Record<StationSeat, { deskRotation: number; person: Point; name: Point; personBehindDesk: boolean }> = {
    north: { deskRotation: 0, person: { x: 48, y: 44 }, name: { x: 64, y: 86 }, personBehindDesk: false },
    east: { deskRotation: 90, person: { x: 19, y: 18 }, name: { x: 35, y: 60 }, personBehindDesk: false },
    south: { deskRotation: 0, person: { x: 48, y: -1 }, name: { x: 64, y: 41 }, personBehindDesk: true },
    west: { deskRotation: 270, person: { x: 77, y: 18 }, name: { x: 93, y: 60 }, personBehindDesk: false },
  };
  const layout = stationSeatLayout[seat];
  const personLayer = item.person ? (
    <>
      {item.presence !== 'offline' && (
        <g transform={`translate(${layout.person.x} ${layout.person.y})`} opacity={personOpacity} filter="url(#softGlowTwin)">
          <g transform="scale(1.333333)">
            <circle cx="12" cy="7.7" r="4.5" fill="url(#personHeadTwin)" stroke="rgba(171,224,255,.56)" strokeWidth=".75" />
            <path d="M3.2 21.4c1-5.2 4.2-8 8.8-8s7.8 2.8 8.8 8z" fill="url(#personBodyTwin)" stroke="rgba(171,224,255,.38)" strokeWidth=".7" />
            <path d="M9.2 5.2c1.4-1.2 3.2-1.6 5.1-.9-1.2 1-2.8 1.5-5.3 1.8z" fill="rgba(255,255,255,.36)" opacity=".72" />
          </g>
        </g>
      )}
      <text x={layout.name.x} y={layout.name.y} textAnchor="middle" fontSize="9" fontWeight="500" letterSpacing=".02em" fill={nameColor}>{item.person}</text>
    </>
  ) : null;
  const deskGradientTransform = layout.deskRotation ? `rotate(${-layout.deskRotation} .5 .5)` : undefined;
  const deskLayer = (
    <g transform={`rotate(${layout.deskRotation} 64 38)`}>
      <g transform="translate(9.82 4) scale(.86)">
        <defs>
          <linearGradient id={`deskSurfaceTwin-${item.id}`} x1="0" y1="0" x2="1" y2="1" gradientTransform={deskGradientTransform}>
            <stop offset="0" stopColor="#ffffff" stopOpacity=".92" />
            <stop offset=".58" stopColor="#e6f4ff" stopOpacity=".72" />
            <stop offset="1" stopColor="#cfe8ff" stopOpacity=".54" />
          </linearGradient>
        </defs>
        <rect x="17" y="14" width="92" height="51" rx="6" fill={`url(#deskSurfaceTwin-${item.id})`} stroke="rgb(var(--os-vnext-brand-blue-rgb)/.24)" strokeWidth="1.1" filter="url(#deskShadowTwin)" />
        <path d="M23 20h80c-10 4-28 7-84 8z" fill="rgba(255,255,255,.42)" opacity=".74" />
        {item.device === 'laptop' ? <LaptopSvg /> : <DesktopSvg />}
      </g>
    </g>
  );

  return (
    <g transform="scale(.80)" filter="url(#stationShadowTwin)">
      {layout.personBehindDesk && personLayer}
      {deskLayer}
      {!layout.personBehindDesk && personLayer}
    </g>
  );
}

function DesktopSvg() {
  return (
    <g>
      <rect x="44" y="20" width="40" height="25" rx="2.8" fill="rgba(16,37,66,.58)" stroke="rgb(var(--os-vnext-brand-blue-soft-rgb)/.34)" strokeWidth=".75" filter="url(#deviceBodyGlowTwin)" />
      <rect x="46" y="22" width="36" height="21" rx="2.2" fill="url(#stationScreenOnTwin)" stroke="rgba(171,224,255,.55)" strokeWidth=".75" filter="url(#screenGlowTwin)" />
      <path d="M48 23h31c-5 3-13 5-33 7z" fill="rgba(255,255,255,.30)" opacity=".72" />
      <circle cx="76" cy="36" r="1.8" fill="rgba(140,233,255,.72)" filter="url(#screenCoreGlowTwin)" />
      <line x1="59" y1="46" x2="69" y2="46" stroke="var(--os-vnext-brand-blue-strong)" strokeWidth="1.55" strokeLinecap="round" />
      <line x1="55" y1="49" x2="73" y2="49" stroke="var(--os-vnext-brand-blue-strong)" strokeWidth="1.55" strokeLinecap="round" />
      <rect x="23" y="28" width="13" height="27" rx="2.6" fill="url(#serverBodyTwin)" stroke="rgb(var(--os-vnext-brand-blue-soft-rgb)/.34)" strokeWidth=".95" filter="url(#deviceBodyGlowTwin)" />
      <path d="M27 36h5M27 42h5M27 48h5" stroke="rgba(171,224,255,.54)" strokeWidth=".85" strokeLinecap="round" />
      <circle cx="30" cy="32" r="1.8" fill="rgba(140,233,255,.72)" filter="url(#screenCoreGlowTwin)" />
    </g>
  );
}

function LaptopSvg() {
  return (
    <g>
      <rect x="49" y="26" width="30" height="18" rx="2" fill="rgba(16,37,66,.42)" stroke="rgb(var(--os-vnext-brand-blue-soft-rgb)/.26)" strokeWidth=".55" filter="url(#deviceBodyGlowTwin)" />
      <rect x="50.5" y="27.5" width="27" height="15" rx="1.5" fill="url(#stationScreenOnTwin)" stroke="rgba(171,224,255,.48)" strokeWidth=".55" filter="url(#screenGlowTwin)" />
      <path d="M48 45h32l4 7H44z" fill="rgba(255,255,255,.50)" stroke="rgb(var(--os-vnext-brand-blue-strong-rgb)/.18)" strokeWidth=".75" filter="url(#deskShadowTwin)" />
      <rect x="59" y="48" width="10" height="2.2" rx=".8" fill="rgb(var(--os-vnext-brand-blue-strong-rgb)/.10)" stroke="rgb(var(--os-vnext-brand-blue-strong-rgb)/.18)" strokeWidth=".55" />
      <path d="M52 28.5h23c-3.5 2.2-9.8 3.5-25 5.2z" fill="rgba(255,255,255,.30)" opacity=".72" />
    </g>
  );
}

function ServerSvg({ label }: { label: string }) {
  return (
    <g transform="scale(.82)">
      <rect x="48" y="20" width="64" height="70" rx="6" fill="url(#serverBodyTwin)" stroke="rgba(171,224,255,.42)" strokeWidth="1.15" filter="url(#softGlowTwin)" />
      {[29, 47, 65].map((y) => (
        <g key={y}>
          <rect x="55" y={y} width="50" height="12" rx="3" fill="rgba(255,255,255,.08)" stroke="rgba(171,224,255,.22)" strokeWidth=".8" />
          <line x1="63" y1={y + 6} x2="90" y2={y + 6} stroke="rgba(171,224,255,.58)" strokeWidth=".9" strokeLinecap="round" />
          <circle cx="99" cy={y + 6} r="2.1" fill="#8CE9FF" filter="url(#screenCoreGlowTwin)" />
        </g>
      ))}
      <text x="80" y="108" textAnchor="middle" fontSize="11" fill="var(--os-vnext-brand-blue-strong)" letterSpacing="1">{label}</text>
    </g>
  );
}

function RackSvg({ label }: { label: string }) {
  return (
    <g>
      <rect x="2" y="3" width="74" height="20" rx="3" fill="rgba(255,255,255,.64)" stroke="rgb(var(--os-vnext-brand-blue-rgb)/.24)" strokeWidth="1.1" />
      <line x1="12" y1="9" x2="66" y2="9" stroke="rgba(22,54,94,.34)" strokeWidth="1" strokeLinecap="round" />
      <line x1="12" y1="14" x2="66" y2="14" stroke="rgba(22,54,94,.34)" strokeWidth="1" strokeLinecap="round" />
      <line x1="12" y1="19" x2="66" y2="19" stroke="rgba(22,54,94,.34)" strokeWidth="1" strokeLinecap="round" />
      <text x="39" y="38" textAnchor="middle" fontSize="10" fill="rgba(71,85,105,.62)">{label}</text>
    </g>
  );
}

export default DataCenter;
