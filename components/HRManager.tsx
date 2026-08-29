import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../services/apiService';
import { hasPermission } from '../services/authService';
import { motion, AnimatePresence } from 'framer-motion';
import { RdlToolbar, RdlPill, RdlSurface } from './ui/RDLPrimitives';
import {
  Users, Building2, FolderKanban, ClipboardList, Plus, Trash2, Pencil,
  X, Check, Clock3, AlertCircle, UserCircle2, Search,
} from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import UserAvatar from './ui/UserAvatar';
import { buildDepartmentOptions } from '../lib/departmentTree';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { StatusSemantic } from './rdlBusinessStatusTokens';
import EmployeeProfilesTab from './hr/EmployeeProfilesTab';
import AttendanceLeaveTab from './hr/AttendanceLeaveTab';
import PayrollTab from './hr/PayrollTab';
import PerformanceTab from './hr/PerformanceTab';
import TrainingTab from './hr/TrainingTab';
import TeamManagementTab from './hr/TeamManagementTab';
import { bdsConfirm } from './ui/BdsDialog';
import { bdsToast } from './ui/bdsToast';
import { hrErrorMessage } from './hr/hrTokens';

// ── C3 HR 视图（org = 既有组织架构视图）──
type HRView = 'org' | 'teams' | 'employees' | 'attendance' | 'payroll' | 'performance' | 'training';

const HR_VIEWS: Array<{ id: HRView; label: string }> = [
  { id: 'org', label: '组织架构' },
  { id: 'teams', label: '小组管理' },
  { id: 'employees', label: '员工档案' },
  { id: 'attendance', label: '考勤请假' },
  { id: 'payroll', label: '薪资工资' },
  { id: 'performance', label: '绩效管理' },
  { id: 'training', label: '培训管理' },
];

// ───────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────

interface PersonnelMember {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  status: string;
  roles: string[];
  departmentId: string | null;
  department: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface DeptInfo {
  id: string;
  name: string;
  parentId: string | null;
  status: string;
}

interface PositionInfo {
  id: string;
  title: string;
  departmentId: string | null;
  department: string | null;
  headcount: number;
  status: string;
  description: string | null;
}

interface TeamInfo {
  id: string;
  name: string;
  description: string | null;
  leaderId: string | null;
  departmentId: string | null;
  department: string | null;
  status: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  teamId: string | null;
  teamName: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  memberCount: number;
  assignmentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AssignmentInfo {
  id: string;
  title: string;
  description: string | null;
  projectId: string | null;
  projectName: string | null;
  userId: string;
  userName: string;
  userAvatar: string | null;
  assignerId: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── HR API 响应信封（apiService.hrGet 泛型实参）──
interface HrPersonnelResponse { personnel?: PersonnelMember[]; departments?: DeptInfo[]; positions?: PositionInfo[] }
interface HrTeamsResponse { teams?: TeamInfo[] }
interface HrProjectsResponse { projects?: ProjectInfo[] }
interface HrAssignmentsResponse { assignments?: AssignmentInfo[] }

// ── Org tree node types ──
interface ProjectNode { kind: 'project'; project: ProjectInfo; headcount: number; }
interface TeamNode { kind: 'team'; team: TeamInfo; projects: ProjectNode[]; headcount: number; }
interface DeptNode { kind: 'dept'; dept: DeptInfo; childDepts: DeptNode[]; teams: TeamNode[]; headcount: number; }
interface OrgForest { depts: DeptNode[]; orphanTeams: TeamNode[]; orphanProjects: ProjectNode[]; }

type SelectedNodeType = 'all' | 'dept' | 'team' | 'project';
interface SelectedNode { type: SelectedNodeType; id: string; }

const PROJECT_STATUS_OPTIONS = [
  { value: 'planning', label: '规划中' },
  { value: 'active', label: '进行中' },
  { value: 'on_hold', label: '暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
] as const;

const ASSIGNMENT_STATUS_OPTIONS = [
  { value: 'assigned', label: '已分配' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'overdue', label: '已逾期' },
  { value: 'cancelled', label: '已取消' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
] as const;

// BDS v2.1：语义 → bds-badge 变体映射（bds-badge 无 active 变体，归并到 info；主题透明，替代 statusSemanticClass 拼装）
type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';
const SEMANTIC_BADGE_VARIANT: Record<StatusSemantic, BadgeVariant> = {
  neutral: 'neutral',
  active: 'info',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
  destructive: 'danger',
  rebate: 'info',
};

const statusLabel = (status: string, options: readonly { value: string; label: string }[]) =>
  options.find(o => o.value === status)?.label || status;

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

// ───────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────

interface HRManagerProps {
  isDarkMode: boolean;
}

const HRManager: React.FC<HRManagerProps> = ({ isDarkMode }) => {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [activeView, setActiveView] = useState<HRView>('org');

  // K1 工资保密门禁：薪资工资 tab 仅 sensitive:salary 持有者可见（矩阵真源：老板+指定 HR）
  const canViewSalary = hasPermission('sensitive:salary');
  // K3 岗位管理：新建/改/删为 hr:write 写操作（后端门禁同口径），无权限时只读
  const canManagePositions = hasPermission('hr:write');
  // R678-③：全 lane 写按钮统一按 hr:write 门控（与后端写门同口径）——canManagePositions 的通用别名
  const canWriteHr = canManagePositions;

  // R678-⑤：子 tab 保活——记录访问过的视图，懒挂载后以 display:none 切换（不再卸载丢筛选/选中/在途表单状态）；
  // 数据保鲜口径：各 tab 的筛选变更/表单提交/查询按钮均会重拉（HR 低频域数据可接受）
  const [visitedViews, setVisitedViews] = useState<ReadonlySet<HRView>>(() => new Set<HRView>(['org']));
  useEffect(() => {
    setVisitedViews(prev => (prev.has(activeView) ? prev : new Set(prev).add(activeView)));
  }, [activeView]);

  // Personnel
  const [personnel, setPersonnel] = useState<PersonnelMember[]>([]);
  const [departments, setDepartments] = useState<DeptInfo[]>([]);
  const [positions, setPositions] = useState<PositionInfo[]>([]);

  // Teams
  const [teams, setTeams] = useState<TeamInfo[]>([]);

  // Projects
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  // Assignments
  const [assignments, setAssignments] = useState<AssignmentInfo[]>([]);

  // Tree nav + detail
  const [selectedNode, setSelectedNode] = useState<SelectedNode>({ type: 'all', id: 'all' });
  const [treeSearchTerm, setTreeSearchTerm] = useState('');
  const [detailSearchTerm, setDetailSearchTerm] = useState('');

  // Forms（v2.1：团队表单移除——组生命周期统一走「小组管理」tab）
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: '', code: '', description: '', teamId: '', priority: 'normal', startDate: '', endDate: '' });
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ title: '', description: '', projectId: '', userId: '', priority: 'normal', dueDate: '' });
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

  // K3 岗位管理表单（组织架构 tab · 岗位设置区）
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [positionForm, setPositionForm] = useState({ title: '', departmentId: '', headcount: 1, description: '' });
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 样式分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
  const labelCls = 'block text-xs mb-1 text-[var(--text-tertiary)]';
  const inputCls = 'bds-input';
  const selectCls = 'bds-select';

  const primaryButtonCls = 'bds-btn bds-btn-primary';
  const actionButtonCls = 'bds-btn bds-btn-ghost';
  const subtleButtonCls = 'bds-btn bds-btn-secondary';

  const sectionTitleClass = 'text-sm font-light text-[var(--text-primary)]';
  const sectionMutedClass = 'text-xs font-light text-[var(--text-tertiary)]';
  const borderSoftClass = 'border-[var(--border-c-subtle)]';

  const navItemActiveClass = 'bg-[var(--active-darken)] text-[var(--text-primary)]';
  const navItemIdleClass = 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-darken)]';

  const treeBtnClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-compact py-1.5 pr-3 text-xs font-light transition-colors ${active ? navItemActiveClass : navItemIdleClass}`;

  const statusChipCls = (status: string) => {
    const semanticMap: Record<string, StatusSemantic> = {
      active: 'active',
      in_progress: 'active',
      planning: 'info',
      assigned: 'info',
      completed: 'neutral',
      cancelled: 'neutral',
      disabled: 'neutral',
      on_hold: 'warning',
      pending: 'warning',
      overdue: 'danger',
      error: 'danger',
    };
    const semantic = semanticMap[status] || 'neutral';
    return `bds-badge sm ${SEMANTIC_BADGE_VARIANT[semantic]}`;
  };

  const priorityChipCls = (priority: string) => {
    const semanticMap: Record<string, StatusSemantic> = {
      urgent: 'danger',
      high: 'warning',
      critical: 'danger',
      normal: 'neutral',
      medium: 'neutral',
      low: 'neutral',
    };
    return `bds-badge sm ${SEMANTIC_BADGE_VARIANT[semanticMap[priority] || 'neutral']}`;
  };

  // ── API helpers（统一走 apiService HR 通道：endpoint 解析 / API key / JWT / 错误信封）──

  // ── Data loading: one-shot load of all HR data ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [personnelData, teamsData, projectsData, assignmentsData] = await Promise.all([
        apiService.hrGet<HrPersonnelResponse>('personnel'),
        apiService.hrGet<HrTeamsResponse>('teams'),
        apiService.hrGet<HrProjectsResponse>('projects'),
        apiService.hrGet<HrAssignmentsResponse>('assignments'),
      ]);
      setPersonnel(personnelData.personnel || []);
      setDepartments(personnelData.departments || []);
      setPositions(personnelData.positions || []);
      setTeams(teamsData.teams || []);
      setProjects(projectsData.projects || []);
      setAssignments(assignmentsData.assignments || []);
    } catch (e: any) {
      setLoadError(hrErrorMessage(e, '加载人事数据失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Form open/close helpers ──
  // v2.1（DR-042 §8.5）：组生命周期（建/编/删/成员/授权/解散）统一走「小组管理」tab，
  // 组织架构视图只读目录化——此处仅保留项目/任务表单。
  const openProjectForm = useCallback((project?: ProjectInfo) => {
    setShowAssignmentForm(false);
    setShowPositionForm(false);
    if (project) {
      setProjectForm({
        name: project.name, code: project.code || '', description: project.description || '',
        teamId: project.teamId || '', priority: project.priority,
        startDate: project.startDate || '', endDate: project.endDate || '',
      });
      setEditingProjectId(project.id);
    } else {
      const presetTeamId = selectedNode.type === 'team' ? selectedNode.id : '';
      setProjectForm({ name: '', code: '', description: '', teamId: presetTeamId, priority: 'normal', startDate: '', endDate: '' });
      setEditingProjectId(null);
    }
    setShowProjectForm(true);
  }, [selectedNode]);

  const closeProjectForm = () => {
    setProjectForm({ name: '', code: '', description: '', teamId: '', priority: 'normal', startDate: '', endDate: '' });
    setEditingProjectId(null);
    setShowProjectForm(false);
  };

  const openAssignmentForm = useCallback((assignment?: AssignmentInfo) => {
    setShowProjectForm(false);
    if (assignment) {
      setAssignmentForm({
        title: assignment.title, description: assignment.description || '',
        projectId: assignment.projectId || '', userId: assignment.userId,
        priority: assignment.priority, dueDate: assignment.dueDate || '',
      });
      setEditingAssignmentId(assignment.id);
    } else {
      const presetProjectId = selectedNode.type === 'project' ? selectedNode.id : '';
      setAssignmentForm({ title: '', description: '', projectId: presetProjectId, userId: '', priority: 'normal', dueDate: '' });
      setEditingAssignmentId(null);
    }
    setShowAssignmentForm(true);
  }, [selectedNode]);

  const closeAssignmentForm = () => {
    setAssignmentForm({ title: '', description: '', projectId: '', userId: '', priority: 'normal', dueDate: '' });
    setEditingAssignmentId(null);
    setShowAssignmentForm(false);
  };

  // ── Team handlers（v2.1 移除：组生命周期统一走「小组管理」tab）──

  // ── Project handlers ──
  const submitProject = async () => {
    if (!projectForm.name.trim() || actionBusy) return;
    setActionBusy(true);
    try {
      if (editingProjectId) {
        await apiService.hrSend(`projects/${editingProjectId}`, projectForm, 'PATCH');
      } else {
        await apiService.hrSend('projects', projectForm);
      }
      closeProjectForm();
      bdsToast.success(editingProjectId ? '项目已保存' : '项目已创建');
      await loadAll();
    } catch (e: any) {
      setLoadError(hrErrorMessage(e, '保存项目失败'));
    } finally {
      setActionBusy(false);
    }
  };

  const deleteProject = async (id: string) => {
    if (actionBusy) return;
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该项目？此操作不可撤销。', danger: true }))) return;
    setActionBusy(true);
    try {
      await apiService.hrSend(`projects/${id}`, {}, 'DELETE');
      bdsToast.success('项目已删除');
      await loadAll();
    } catch (e: any) {
      setLoadError(hrErrorMessage(e, '删除项目失败'));
    } finally {
      setActionBusy(false);
    }
  };

  // ── Assignment handlers ──
  const submitAssignment = async () => {
    if (!assignmentForm.title.trim() || !assignmentForm.userId || actionBusy) return;
    setActionBusy(true);
    try {
      if (editingAssignmentId) {
        await apiService.hrSend(`assignments/${editingAssignmentId}`, assignmentForm, 'PATCH');
      } else {
        await apiService.hrSend('assignments', assignmentForm);
      }
      closeAssignmentForm();
      bdsToast.success(editingAssignmentId ? '工作分配已保存' : '工作分配已创建');
      await loadAll();
    } catch (e: any) {
      setLoadError(hrErrorMessage(e, '保存工作分配失败'));
    } finally {
      setActionBusy(false);
    }
  };

  const deleteAssignment = async (id: string) => {
    if (actionBusy) return;
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该工作分配？此操作不可撤销。', danger: true }))) return;
    setActionBusy(true);
    try {
      await apiService.hrSend(`assignments/${id}`, {}, 'DELETE');
      bdsToast.success('工作分配已删除');
      await loadAll();
    } catch (e: any) {
      setLoadError(hrErrorMessage(e, '删除工作分配失败'));
    } finally {
      setActionBusy(false);
    }
  };

  // ── Position handlers（K3 岗位管理：后端 positions CRUD 直通）──
  const openPositionForm = useCallback((position?: PositionInfo) => {
    setShowProjectForm(false);
    setShowAssignmentForm(false);
    if (position) {
      setPositionForm({
        title: position.title,
        departmentId: position.departmentId || '',
        headcount: position.headcount,
        description: position.description || '',
      });
      setEditingPositionId(position.id);
    } else {
      setPositionForm({ title: '', departmentId: '', headcount: 1, description: '' });
      setEditingPositionId(null);
    }
    setShowPositionForm(true);
  }, []);

  const closePositionForm = () => {
    setPositionForm({ title: '', departmentId: '', headcount: 1, description: '' });
    setEditingPositionId(null);
    setShowPositionForm(false);
  };

  const submitPosition = async () => {
    if (!positionForm.title.trim() || actionBusy) return;
    setActionBusy(true);
    try {
      const body = {
        title: positionForm.title.trim(),
        departmentId: positionForm.departmentId || null,
        headcount: Math.max(1, Number(positionForm.headcount) || 1),
        description: positionForm.description.trim() || null,
      };
      if (editingPositionId) {
        await apiService.hrSend(`positions/${editingPositionId}`, body, 'PATCH');
      } else {
        await apiService.hrSend('positions', body);
      }
      closePositionForm();
      bdsToast.success(editingPositionId ? '岗位已保存' : '岗位已创建');
      await loadAll();
    } catch (e: any) {
      setLoadError(hrErrorMessage(e, '保存岗位失败'));
    } finally {
      setActionBusy(false);
    }
  };

  const deletePosition = async (id: string) => {
    if (actionBusy) return;
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该岗位？此操作不可撤销。', danger: true }))) return;
    setActionBusy(true);
    try {
      await apiService.hrSend(`positions/${id}`, {}, 'DELETE');
      bdsToast.success('岗位已删除');
      await loadAll();
    } catch (e: any) {
      setLoadError(hrErrorMessage(e, '删除岗位失败'));
    } finally {
      setActionBusy(false);
    }
  };

  // ── Org tree construction ──
  const departmentOptions = useMemo(() => buildDepartmentOptions(departments), [departments]);

  const forest = useMemo<OrgForest>(() => {
    const deptById = new Map(departments.map(d => [d.id, d]));
    const childDeptsMap = new Map<string, DeptInfo[]>();
    const rootDepts: DeptInfo[] = [];
    for (const d of departments) {
      if (d.parentId && deptById.has(d.parentId)) {
        const arr = childDeptsMap.get(d.parentId) || [];
        arr.push(d);
        childDeptsMap.set(d.parentId, arr);
      } else {
        rootDepts.push(d);
      }
    }

    const teamsByDept = new Map<string, TeamInfo[]>();
    const orphanTeams: TeamInfo[] = [];
    for (const t of teams) {
      if (t.departmentId && deptById.has(t.departmentId)) {
        const arr = teamsByDept.get(t.departmentId) || [];
        arr.push(t);
        teamsByDept.set(t.departmentId, arr);
      } else {
        orphanTeams.push(t);
      }
    }

    const teamById = new Map(teams.map(t => [t.id, t]));
    const projectsByTeam = new Map<string, ProjectInfo[]>();
    const orphanProjects: ProjectInfo[] = [];
    for (const p of projects) {
      if (p.teamId && teamById.has(p.teamId)) {
        const arr = projectsByTeam.get(p.teamId) || [];
        arr.push(p);
        projectsByTeam.set(p.teamId, arr);
      } else {
        orphanProjects.push(p);
      }
    }

    const personnelByDept = new Map<string, number>();
    for (const p of personnel) {
      if (p.departmentId) {
        personnelByDept.set(p.departmentId, (personnelByDept.get(p.departmentId) || 0) + 1);
      }
    }

    const buildProjectNode = (p: ProjectInfo): ProjectNode => ({ kind: 'project', project: p, headcount: p.memberCount });
    const buildTeamNode = (t: TeamInfo): TeamNode => ({
      kind: 'team',
      team: t,
      projects: (projectsByTeam.get(t.id) || []).map(buildProjectNode),
      headcount: t.memberCount,
    });
    const buildDeptNode = (dept: DeptInfo): DeptNode => {
      const childDepts = (childDeptsMap.get(dept.id) || []).map(buildDeptNode);
      const teamList = (teamsByDept.get(dept.id) || []).map(buildTeamNode);
      const directCount = personnelByDept.get(dept.id) || 0;
      const childCount = childDepts.reduce((s, n) => s + n.headcount, 0);
      return { kind: 'dept', dept, childDepts, teams: teamList, headcount: directCount + childCount };
    };

    return {
      depts: rootDepts.map(buildDeptNode),
      orphanTeams: orphanTeams.map(buildTeamNode),
      orphanProjects: orphanProjects.map(buildProjectNode),
    };
  }, [departments, teams, projects, personnel]);

  // ── Tree search filter ──
  const visibleForest = useMemo<OrgForest>(() => {
    const term = treeSearchTerm.trim().toLowerCase();
    if (!term) return forest;
    const match = (s: string) => s.toLowerCase().includes(term);
    const filterProject = (n: ProjectNode): ProjectNode | null => match(n.project.name) ? n : null;
    const filterTeam = (n: TeamNode): TeamNode | null => {
      const projects = n.projects.map(filterProject).filter(Boolean) as ProjectNode[];
      if (match(n.team.name) || projects.length) return { ...n, projects };
      return null;
    };
    const filterDept = (n: DeptNode): DeptNode | null => {
      const childDepts = n.childDepts.map(filterDept).filter(Boolean) as DeptNode[];
      const teams = n.teams.map(filterTeam).filter(Boolean) as TeamNode[];
      if (match(n.dept.name) || childDepts.length || teams.length) return { ...n, childDepts, teams };
      return null;
    };
    return {
      depts: forest.depts.map(filterDept).filter(Boolean) as DeptNode[],
      orphanTeams: forest.orphanTeams.map(filterTeam).filter(Boolean) as TeamNode[],
      orphanProjects: forest.orphanProjects.map(filterProject).filter(Boolean) as ProjectNode[],
    };
  }, [forest, treeSearchTerm]);

  const treeHasContent = visibleForest.depts.length > 0 || visibleForest.orphanTeams.length > 0 || visibleForest.orphanProjects.length > 0;

  // ── Selected node + derived data ──
  const effectiveNode = useMemo<SelectedNode>(() => {
    if (selectedNode.type === 'dept' && !departments.find(d => d.id === selectedNode.id)) return { type: 'all', id: 'all' };
    if (selectedNode.type === 'team' && !teams.find(t => t.id === selectedNode.id)) return { type: 'all', id: 'all' };
    if (selectedNode.type === 'project' && !projects.find(p => p.id === selectedNode.id)) return { type: 'all', id: 'all' };
    return selectedNode;
  }, [selectedNode, departments, teams, projects]);

  const selectedDept = effectiveNode.type === 'dept' ? departments.find(d => d.id === effectiveNode.id) : null;
  const selectedTeam = effectiveNode.type === 'team' ? teams.find(t => t.id === effectiveNode.id) : null;
  const selectedProject = effectiveNode.type === 'project' ? projects.find(p => p.id === effectiveNode.id) : null;

  const deptPersonnel = useMemo(() => {
    if (effectiveNode.type !== 'dept') return [];
    const collect = (deptId: string): PersonnelMember[] => {
      const direct = personnel.filter(p => p.departmentId === deptId);
      const childIds = departments.filter(d => d.parentId === deptId).map(d => d.id);
      return [...direct, ...childIds.flatMap(collect)];
    };
    return collect(effectiveNode.id);
  }, [effectiveNode, personnel, departments]);

  const deptTeams = useMemo(() => (selectedDept ? teams.filter(t => t.departmentId === selectedDept.id) : []), [selectedDept, teams]);
  const teamProjects = useMemo(() => (selectedTeam ? projects.filter(p => p.teamId === selectedTeam.id) : []), [selectedTeam, projects]);
  const projectAssignments = useMemo(() => (selectedProject ? assignments.filter(a => a.projectId === selectedProject.id) : []), [selectedProject, assignments]);
  const teamLeader = useMemo(() => (selectedTeam?.leaderId ? personnel.find(p => p.id === selectedTeam.leaderId) || null : null), [selectedTeam, personnel]);
  const parentDept = useMemo(() => (selectedDept?.parentId ? departments.find(d => d.id === selectedDept.parentId) || null : null), [selectedDept, departments]);

  const filteredAllPersonnel = useMemo(() => {
    const t = detailSearchTerm.trim().toLowerCase();
    if (!t) return personnel;
    return personnel.filter(p => p.displayName.toLowerCase().includes(t) || (p.email || '').toLowerCase().includes(t));
  }, [personnel, detailSearchTerm]);

  const filteredDeptPersonnel = useMemo(() => {
    const t = detailSearchTerm.trim().toLowerCase();
    if (!t) return deptPersonnel;
    return deptPersonnel.filter(p => p.displayName.toLowerCase().includes(t) || (p.email || '').toLowerCase().includes(t));
  }, [deptPersonnel, detailSearchTerm]);

  // R678-①：detailSearchTerm 消费补全——team 视图按项目名/编号过滤，project 视图按任务标题/承担人过滤
  // （此前 placeholder 承诺「搜索工作分配…」但两视图均不过滤，属装饰性搜索框）
  const filteredTeamProjects = useMemo(() => {
    const t = detailSearchTerm.trim().toLowerCase();
    if (!t) return teamProjects;
    return teamProjects.filter(p => p.name.toLowerCase().includes(t) || (p.code || '').toLowerCase().includes(t));
  }, [teamProjects, detailSearchTerm]);

  const filteredProjectAssignments = useMemo(() => {
    const t = detailSearchTerm.trim().toLowerCase();
    if (!t) return projectAssignments;
    return projectAssignments.filter(a => a.title.toLowerCase().includes(t) || a.userName.toLowerCase().includes(t));
  }, [projectAssignments, detailSearchTerm]);

  const detailSearchPlaceholder =
    effectiveNode.type === 'project' ? '搜索工作分配…'
    : effectiveNode.type === 'team' ? '搜索项目…'
    : '搜索人员…';

  // ── Tree node renderer ──
  const renderTreeNode = (node: DeptNode | TeamNode | ProjectNode, depth: number): React.ReactNode => {
    const pad = 10 + depth * 14;
    if (node.kind === 'dept') {
      const active = effectiveNode.type === 'dept' && effectiveNode.id === node.dept.id;
      return (
        <div key={`dept-${node.dept.id}`}>
          <button className={treeBtnClass(active)} style={{ paddingLeft: pad }} onClick={() => setSelectedNode({ type: 'dept', id: node.dept.id })}>
            <Building2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span className="flex-1 text-left truncate">{node.dept.name}</span>
            {node.headcount > 0 && <span className="text-[10px] opacity-50">{node.headcount}</span>}
          </button>
          {node.childDepts.map(c => renderTreeNode(c, depth + 1))}
          {node.teams.map(t => renderTreeNode(t, depth + 1))}
        </div>
      );
    }
    if (node.kind === 'team') {
      const active = effectiveNode.type === 'team' && effectiveNode.id === node.team.id;
      return (
        <div key={`team-${node.team.id}`}>
          <button className={treeBtnClass(active)} style={{ paddingLeft: pad }} onClick={() => setSelectedNode({ type: 'team', id: node.team.id })}>
            <Users className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span className="flex-1 text-left truncate">{node.team.name}</span>
            {node.headcount > 0 && <span className="text-[10px] opacity-50">{node.headcount}</span>}
          </button>
          {node.projects.map(p => renderTreeNode(p, depth + 1))}
        </div>
      );
    }
    const active = effectiveNode.type === 'project' && effectiveNode.id === node.project.id;
    return (
      <button
        key={`proj-${node.project.id}`}
        className={treeBtnClass(active)}
        style={{ paddingLeft: pad }}
        onClick={() => setSelectedNode({ type: 'project', id: node.project.id })}
      >
        <FolderKanban className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="flex-1 text-left truncate">{node.project.name}</span>
        {node.headcount > 0 && <span className="text-[10px] opacity-50">{node.headcount}</span>}
      </button>
    );
  };

  // ── Shared card renderers ──
  const renderPersonCard = (person: PersonnelMember) => (
    <div key={person.id} className="bds-card flex items-center gap-3">
      <UserAvatar
        name={person.displayName}
        email={person.email}
        avatarUrl={person.avatarUrl}
        sizeClassName="w-10 h-10"
        isDarkMode={isDarkMode}
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-light truncate text-[var(--text-primary)]`}>
          {person.displayName}
        </div>
        <div className={`text-[10px] font-light truncate text-[var(--text-tertiary)]`}>
          {person.email || '未绑定邮箱'}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {person.roles.map(role => (
          <span key={role} className="bds-badge sm neutral">{role}</span>
        ))}
        <span className={statusChipCls(person.status)}>{person.status === 'active' ? '正常' : person.status === 'pending' ? '待审批' : person.status === 'disabled' ? '已停用' : person.status}</span>
      </div>
    </div>
  );

  const renderTeamCard = (team: TeamInfo) => (
    <div key={team.id} className="bds-card">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <button
            className="text-sm font-light text-left truncate text-[var(--text-primary)] hover:text-[var(--accent-text)] transition-colors"
            onClick={() => setSelectedNode({ type: 'team', id: team.id })}
          >
            {team.name}
          </button>
          {team.description && (
            <div className={`text-[10px] font-light mt-1 text-[var(--text-tertiary)]`}>{team.description}</div>
          )}
        </div>
        <span className={statusChipCls(team.status)}>{team.status === 'active' ? '活跃' : team.status}</span>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-c-subtle)]">
        <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
          <Users className="w-3 h-3 inline mr-1" />{team.memberCount} 成员
        </span>
        <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
          组维护走「小组管理」（v2.1 目录只读）
        </span>
      </div>
    </div>
  );

  const renderProjectCard = (proj: ProjectInfo) => (
    <div key={proj.id} className="bds-card">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <button
            className="text-sm font-light text-left truncate text-[var(--text-primary)] hover:text-[var(--accent-text)] transition-colors"
            onClick={() => setSelectedNode({ type: 'project', id: proj.id })}
          >
            {proj.name}
          </button>
          {proj.code && (
            <span className={`text-[10px] font-light ml-1 text-[var(--text-quaternary)]`}>#{proj.code}</span>
          )}
          {proj.description && (
            <div className={`text-[10px] font-light mt-1 text-[var(--text-tertiary)]`}>{proj.description}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={statusChipCls(proj.status)}>{statusLabel(proj.status, PROJECT_STATUS_OPTIONS)}</span>
          <span className={priorityChipCls(proj.priority)}>{statusLabel(proj.priority, PRIORITY_OPTIONS)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-c-subtle)]">
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
            <Users className="w-3 h-3 inline mr-1" />{proj.memberCount}
          </span>
          <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
            <ClipboardList className="w-3 h-3 inline mr-1" />{proj.assignmentCount} 任务
          </span>
          {proj.endDate && (
            <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
              <Clock3 className="w-3 h-3 inline mr-1" />{formatDate(proj.endDate)}
            </span>
          )}
        </div>
        {canWriteHr && (
          <div className="flex gap-1">
            <button onClick={() => openProjectForm(proj)} className={subtleButtonCls}>
              <Pencil className="w-3 h-3" /> 编辑
            </button>
            <button onClick={() => deleteProject(proj.id)} disabled={actionBusy} className={`${subtleButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderAssignmentRow = (a: AssignmentInfo) => (
    <div key={a.id} className="bds-card flex items-center gap-4">
      <UserAvatar
        name={a.userName}
        avatarUrl={a.userAvatar}
        sizeClassName="w-9 h-9"
        isDarkMode={isDarkMode}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-light text-[var(--text-primary)]`}>{a.title}</span>
          <span className={priorityChipCls(a.priority)}>{statusLabel(a.priority, PRIORITY_OPTIONS)}</span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
            <UserCircle2 className="w-3 h-3 inline mr-1" />{a.userName}
          </span>
          {a.dueDate && (
            <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
              <Clock3 className="w-3 h-3 inline mr-1" />{formatDate(a.dueDate)}
            </span>
          )}
        </div>
      </div>
      <span className={statusChipCls(a.status)}>{statusLabel(a.status, ASSIGNMENT_STATUS_OPTIONS)}</span>
      {canWriteHr && (
        <div className="flex gap-1">
          <button onClick={() => openAssignmentForm(a)} className={subtleButtonCls}>
            <Pencil className="w-3 h-3" />
          </button>
          <button onClick={() => deleteAssignment(a.id)} disabled={actionBusy} className={`${subtleButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );

  // ── Detail header ──
  const renderDetailHeader = () => {
    if (effectiveNode.type === 'all') {
      return (
        <div className={`shrink-0 px-5 pt-4 pb-3 border-b ${borderSoftClass}`}>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 opacity-60" />
            <h2 className={sectionTitleClass}>全部人员</h2>
          </div>
          <div className={`${sectionMutedClass} mt-0.5 text-[11px]`}>
            {personnel.length} 人 · 在职 {personnel.filter(p => p.status === 'active').length} · 待审批 {personnel.filter(p => p.status === 'pending').length}
          </div>
        </div>
      );
    }
    if (effectiveNode.type === 'dept' && selectedDept) {
      return (
        <div className={`shrink-0 px-5 pt-4 pb-3 border-b ${borderSoftClass}`}>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 opacity-60" />
            <h2 className={sectionTitleClass}>{selectedDept.name}</h2>
            <span className={statusChipCls(selectedDept.status)}>{selectedDept.status === 'active' ? '活跃' : selectedDept.status}</span>
          </div>
          <div className={`${sectionMutedClass} mt-0.5 text-[11px]`}>
            部门 · {deptPersonnel.length} 人 · {deptTeams.length} 个团队{parentDept ? ` · 上级 ${parentDept.name}` : ''}
          </div>
        </div>
      );
    }
    if (effectiveNode.type === 'team' && selectedTeam) {
      return (
        <div className={`shrink-0 px-5 pt-4 pb-3 border-b ${borderSoftClass}`}>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 opacity-60" />
            <h2 className={sectionTitleClass}>{selectedTeam.name}</h2>
            <span className={statusChipCls(selectedTeam.status)}>{selectedTeam.status === 'active' ? '活跃' : selectedTeam.status}</span>
          </div>
          <div className={`${sectionMutedClass} mt-0.5 text-[11px]`}>
            团队 · {selectedTeam.memberCount} 成员 · {teamProjects.length} 个项目{teamLeader ? ` · 负责人 ${teamLeader.displayName}` : ''}
          </div>
        </div>
      );
    }
    if (effectiveNode.type === 'project' && selectedProject) {
      return (
        <div className={`shrink-0 px-5 pt-4 pb-3 border-b ${borderSoftClass}`}>
          <div className="flex items-center gap-2">
            <FolderKanban className="w-4 h-4 opacity-60" />
            <h2 className={sectionTitleClass}>{selectedProject.name}</h2>
            {selectedProject.code && <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>#{selectedProject.code}</span>}
            <span className={statusChipCls(selectedProject.status)}>{statusLabel(selectedProject.status, PROJECT_STATUS_OPTIONS)}</span>
            <span className={priorityChipCls(selectedProject.priority)}>{statusLabel(selectedProject.priority, PRIORITY_OPTIONS)}</span>
          </div>
          <div className={`${sectionMutedClass} mt-0.5 text-[11px]`}>
            项目 · {selectedProject.memberCount} 成员 · {projectAssignments.length} 任务
            {selectedProject.endDate && ` · 截止 ${formatDate(selectedProject.endDate)}`}
          </div>
        </div>
      );
    }
    return null;
  };

  // ── Detail toolbar (context-aware actions) ──
  const renderDetailToolbar = () => (
    <div className={`shrink-0 px-5 py-2 flex items-center gap-2 border-b ${borderSoftClass}`}>
      <div className="bds-search flex-1 min-w-40">
        <Search className="bds-search-icon" />
        <input
          className="bds-input sm"
          value={detailSearchTerm}
          onChange={e => setDetailSearchTerm(e.target.value)}
          placeholder={detailSearchPlaceholder}
        />
      </div>
      {canWriteHr && (
        <div className="ml-auto flex items-center gap-1.5">
          {effectiveNode.type === 'dept' && (
            <button onClick={() => openProjectForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新项目</button>
          )}
          {effectiveNode.type === 'team' && selectedTeam && (
            <button onClick={() => openProjectForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新项目</button>
          )}
          {effectiveNode.type === 'project' && selectedProject && (
            <>
              <button onClick={() => openAssignmentForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 分配任务</button>
              <button onClick={() => openProjectForm(selectedProject)} className={subtleButtonCls}><Pencil className="w-3 h-3" /> 编辑</button>
            </>
          )}
        </div>
      )}
    </div>
  );

  // ── Detail content by node type ──
  const renderDetailContent = () => {
    if (effectiveNode.type === 'all') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="在职人员" value={personnel.filter(p => p.status === 'active').length} />
            <StatCard label="部门数量" value={departments.length} />
            <StatCard label="岗位设置" value={positions.length} />
            <StatCard label="待审批用户" value={personnel.filter(p => p.status === 'pending').length} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>人员名册</h3>
              <span className={sectionMutedClass}>{filteredAllPersonnel.length} 人</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredAllPersonnel.map(renderPersonCard)}
              {filteredAllPersonnel.length === 0 && (
                <div className="bds-empty col-span-2"><div className="title">暂无人员数据</div></div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>岗位设置</h3>
              {canManagePositions && (
                <button onClick={() => openPositionForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新建岗位</button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {positions.map(pos => (
                <div key={pos.id} className="bds-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-light truncate text-[var(--text-primary)]`}>{pos.title}</div>
                      <div className={`text-[10px] font-light mt-1 text-[var(--text-tertiary)]`}>
                        {pos.department || '未分配部门'} · 编制 {pos.headcount}
                      </div>
                    </div>
                    {canManagePositions && (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openPositionForm(pos)} className={subtleButtonCls}>
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => deletePosition(pos.id)} disabled={actionBusy} className={`${subtleButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  {pos.description && (
                    <div className={`text-[10px] font-light mt-2 text-[var(--text-quaternary)]`}>
                      {pos.description}
                    </div>
                  )}
                </div>
              ))}
              {positions.length === 0 && (
                <div className="bds-empty col-span-3"><div className="title">暂无岗位数据</div></div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (effectiveNode.type === 'dept' && selectedDept) {
      return (
        <div className="space-y-4">
          <div className="bds-card">
            <div className={`text-[10px] font-light tracking-wide text-[var(--text-tertiary)]`}>部门信息</div>
            <div className={`text-sm font-light mt-1 text-[var(--text-primary)]`}>{selectedDept.name}</div>
            <div className={`text-[10px] font-light mt-2 text-[var(--text-tertiary)]`}>
              状态：{selectedDept.status === 'active' ? '活跃' : selectedDept.status} · 上级部门：{parentDept ? parentDept.name : '无'}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>部门成员</h3>
              <span className={sectionMutedClass}>{filteredDeptPersonnel.length} 人</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredDeptPersonnel.map(renderPersonCard)}
              {filteredDeptPersonnel.length === 0 && (
                <div className="bds-empty col-span-2"><div className="title">该部门暂无直接归属人员</div></div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>下属小组</h3>
              <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>组维护走「小组管理」</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {deptTeams.map(renderTeamCard)}
              {deptTeams.length === 0 && (
                <div className="bds-empty col-span-2">
                  <div className="glyph"><Building2 size={24} /></div>
                  <div className="title">该部门暂无团队</div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (effectiveNode.type === 'team' && selectedTeam) {
      return (
        <div className="space-y-4">
          <div className="bds-card">
            <div className={`text-[10px] font-light tracking-wide text-[var(--text-tertiary)]`}>团队信息</div>
            <div className={`text-sm font-light mt-1 text-[var(--text-primary)]`}>{selectedTeam.name}</div>
            {selectedTeam.description && (
              <div className={`text-[10px] font-light mt-2 text-[var(--text-tertiary)]`}>{selectedTeam.description}</div>
            )}
            <div className={`text-[10px] font-light mt-2 text-[var(--text-tertiary)]`}>
              成员编制：{selectedTeam.memberCount} · 负责人：{teamLeader ? teamLeader.displayName : '未指定'} · 所属部门：{selectedTeam.department || '未分配'}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>团队项目</h3>
              {canWriteHr && (
                <button onClick={() => openProjectForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新建</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredTeamProjects.map(renderProjectCard)}
              {filteredTeamProjects.length === 0 && (
                <div className="bds-empty col-span-2">
                  <div className="glyph"><FolderKanban size={24} /></div>
                  <div className="title">该团队暂无项目</div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (effectiveNode.type === 'project' && selectedProject) {
      return (
        <div className="space-y-4">
          <div className="bds-card">
            <div className={`text-[10px] font-light tracking-wide text-[var(--text-tertiary)]`}>项目信息</div>
            <div className={`text-sm font-light mt-1 text-[var(--text-primary)]`}>{selectedProject.name}</div>
            {selectedProject.description && (
              <div className={`text-[10px] font-light mt-2 text-[var(--text-tertiary)]`}>{selectedProject.description}</div>
            )}
            <div className={`text-[10px] font-light mt-2 text-[var(--text-tertiary)]`}>
              所属团队：{selectedProject.teamName || '未分配'} · 成员：{selectedProject.memberCount} · 任务：{selectedProject.assignmentCount}
              {selectedProject.startDate && ` · 开始 ${formatDate(selectedProject.startDate)}`}
              {selectedProject.endDate && ` · 截止 ${formatDate(selectedProject.endDate)}`}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>工作分配</h3>
              {canWriteHr && (
                <button onClick={() => openAssignmentForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 分配任务</button>
              )}
            </div>
            <div className="space-y-2">
              {filteredProjectAssignments.map(renderAssignmentRow)}
              {filteredProjectAssignments.length === 0 && (
                <div className="bds-empty">
                  <div className="glyph"><ClipboardList size={24} /></div>
                  <div className="title">该项目暂无工作分配</div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // ════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════

  return (
    <div className="w-full h-full min-h-0 flex flex-col overflow-hidden">
      {/* Header */}
      <PageHeader
        title="人事管理"
        subtitle="Human Resources"
        contextLabel="Organization & Teams"
        actions={activeView === 'org' && canWriteHr ? (
          <RdlToolbar density="compact">
            <RdlPill type="button" active tone="accent" onClick={() => openProjectForm()} className="min-h-8 px-4 text-[11px]">
              <Plus className="w-3.5 h-3.5" /> 新建项目
            </RdlPill>
          </RdlToolbar>
        ) : undefined}
      />

      {/* C3 视图切换 tab 栏（K1：薪资工资仅 sensitive:salary 持有者可见） */}
      <div className="flex-shrink-0 px-7 pb-1">
        <RdlToolbar density="compact">
          {HR_VIEWS.filter(v => v.id !== 'payroll' || canViewSalary).map(v => (
            <RdlPill
              key={v.id}
              type="button"
              active={activeView === v.id}
              tone={activeView === v.id ? 'accent' : undefined}
              onClick={() => setActiveView(v.id)}
              className="min-h-8 px-4 text-[11px]"
            >
              {v.label}
            </RdlPill>
          ))}
        </RdlToolbar>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {loadError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex-shrink-0 px-7 pt-2"
          >
            <div className="bds-alert danger text-xs font-light">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} className="ml-auto opacity-60 hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main: org tree nav + detail panel（org 视图）/ C3 tab 视图 */}
      {activeView === 'org' ? (
      <main className="flex-1 min-h-0 px-7 pb-5 pt-1">
        <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] gap-3">
          {/* Left: org tree navigation */}
          <RdlSurface tone="panel" padding="compact" className="flex h-full min-h-0 flex-col">
            <div className="bds-search mb-2">
              <Search className="bds-search-icon" />
              <input
                className="bds-input sm"
                value={treeSearchTerm}
                onChange={e => setTreeSearchTerm(e.target.value)}
                placeholder="搜索部门 / 团队 / 项目"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-0.5">
              <button
                className={treeBtnClass(effectiveNode.type === 'all')}
                style={{ paddingLeft: 10 }}
                onClick={() => setSelectedNode({ type: 'all', id: 'all' })}
              >
                <Users className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className="flex-1 text-left truncate">全部人员</span>
                <span className="text-[10px] opacity-50">{personnel.length}</span>
              </button>

              {visibleForest.depts.map(node => renderTreeNode(node, 0))}
              {visibleForest.orphanTeams.length > 0 && (
                <div className={`pt-2 pb-1 px-2 text-[10px] font-light text-[var(--text-tertiary)]`}>跨部门小组</div>
              )}
              {visibleForest.orphanTeams.map(node => renderTreeNode(node, 0))}
              {visibleForest.orphanProjects.map(node => renderTreeNode(node, 0))}

              {!treeHasContent && (
                <div className="bds-empty">
                  <div className="glyph"><Building2 size={24} /></div>
                  <div className="title">{treeSearchTerm ? '未找到匹配的组织节点' : '暂无部门 / 团队数据'}</div>
                </div>
              )}
            </div>
          </RdlSurface>

          {/* Right: detail panel */}
          <RdlSurface tone="panel" className="flex h-full min-h-0 flex-col overflow-hidden">
            {renderDetailHeader()}
            {renderDetailToolbar()}

            {/* Inline form expansion（v2.1：组生命周期统一走「小组管理」tab，此处仅项目/任务表单） */}
            <AnimatePresence>
              {showProjectForm && canWriteHr && (
                <motion.div
                  key="project-form"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-5 py-3">
                    <div className="bds-card space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls}>项目名称</div>
                          <input className={inputCls} value={projectForm.name}
                            onChange={e => setProjectForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="如：2026秋冬季面料开发" />
                        </div>
                        <div>
                          <div className={labelCls}>项目编号</div>
                          <input className={inputCls} value={projectForm.code}
                            onChange={e => setProjectForm(f => ({ ...f, code: e.target.value }))}
                            placeholder="可选" />
                        </div>
                      </div>
                      <div>
                        <div className={labelCls}>项目描述</div>
                        <input className={inputCls} value={projectForm.description}
                          onChange={e => setProjectForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="项目简介" />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className={labelCls}>所属团队</div>
                          <select className="bds-select" value={projectForm.teamId}
                            onChange={e => setProjectForm(f => ({ ...f, teamId: e.target.value }))}>
                            <option value="">无</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls}>优先级</div>
                          <select className="bds-select" value={projectForm.priority}
                            onChange={e => setProjectForm(f => ({ ...f, priority: e.target.value }))}>
                            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls}>开始日期</div>
                          <CapsuleDateInput className={inputCls} value={projectForm.startDate}
                            onChange={(v) => setProjectForm(f => ({ ...f, startDate: v }))} isDarkMode={isDarkMode} />
                        </div>
                      </div>
                      <div>
                        <div className={labelCls}>结束日期</div>
                        <CapsuleDateInput className={inputCls} value={projectForm.endDate}
                          onChange={(v) => setProjectForm(f => ({ ...f, endDate: v }))} isDarkMode={isDarkMode} />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={closeProjectForm} className={actionButtonCls}>取消</button>
                        <button onClick={submitProject} disabled={actionBusy} className={`${primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                          <Check className="w-3.5 h-3.5" /> {actionBusy ? '提交中…' : editingProjectId ? '保存' : '创建'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {showAssignmentForm && canWriteHr && (
                <motion.div
                  key="assignment-form"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-5 py-3">
                    <div className="bds-card space-y-3">
                      <div>
                        <div className={labelCls}>任务标题</div>
                        <input className={inputCls} value={assignmentForm.title}
                          onChange={e => setAssignmentForm(f => ({ ...f, title: e.target.value }))}
                          placeholder="如：安排面料打样" />
                      </div>
                      <div>
                        <div className={labelCls}>任务描述</div>
                        <input className={inputCls} value={assignmentForm.description}
                          onChange={e => setAssignmentForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="任务详情" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls}>指派给</div>
                          <select className="bds-select" value={assignmentForm.userId}
                            onChange={e => setAssignmentForm(f => ({ ...f, userId: e.target.value }))}>
                            <option value="">选择人员</option>
                            {personnel.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls}>关联项目</div>
                          <select className="bds-select" value={assignmentForm.projectId}
                            onChange={e => setAssignmentForm(f => ({ ...f, projectId: e.target.value }))}>
                            <option value="">无</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls}>优先级</div>
                          <select className="bds-select" value={assignmentForm.priority}
                            onChange={e => setAssignmentForm(f => ({ ...f, priority: e.target.value }))}>
                            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls}>截止日期</div>
                          <CapsuleDateInput className={inputCls} value={assignmentForm.dueDate}
                            onChange={(v) => setAssignmentForm(f => ({ ...f, dueDate: v }))} isDarkMode={isDarkMode} />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={closeAssignmentForm} className={actionButtonCls}>取消</button>
                        <button onClick={submitAssignment} className={`${primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`} disabled={!assignmentForm.userId || actionBusy}>
                          <Check className="w-3.5 h-3.5" /> {actionBusy ? '提交中…' : editingAssignmentId ? '保存' : '分配'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {showPositionForm && canManagePositions && (
                <motion.div
                  key="position-form"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-5 py-3">
                    <div className="bds-card space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls}>岗位名称</div>
                          <input className={inputCls} value={positionForm.title}
                            onChange={e => setPositionForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="如：资深跟单员" />
                        </div>
                        <div>
                          <div className={labelCls}>所属部门</div>
                          <select className={selectCls} value={positionForm.departmentId}
                            onChange={e => setPositionForm(f => ({ ...f, departmentId: e.target.value }))}>
                            <option value="">未分配</option>
                            {departmentOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls}>编制人数</div>
                          <input type="number" min={1} className={inputCls} value={positionForm.headcount}
                            onChange={e => setPositionForm(f => ({ ...f, headcount: Number(e.target.value) || 1 }))} />
                        </div>
                        <div>
                          <div className={labelCls}>岗位描述</div>
                          <input className={inputCls} value={positionForm.description}
                            onChange={e => setPositionForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="可选" />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={closePositionForm} className={actionButtonCls}>取消</button>
                        <button onClick={submitPosition} disabled={!positionForm.title.trim() || actionBusy} className={`${primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                          <Check className="w-3.5 h-3.5" /> {actionBusy ? '提交中…' : editingPositionId ? '保存' : '创建'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Content scroll area */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4">
              {loading ? (
                <div className={`text-center py-12 ${sectionMutedClass}`}>
                  <div className="inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin opacity-40 mb-2" />
                  <div className="text-xs">加载中…</div>
                </div>
              ) : (
                renderDetailContent()
              )}
            </div>
          </RdlSurface>
        </div>
      </main>
      ) : (
      <main className="flex-1 min-h-0 px-7 pb-5 pt-1">
        <RdlSurface tone="panel" className="flex h-full min-h-0 flex-col overflow-hidden p-4">
          {/* R678-⑤：子 tab 懒挂载 + display:none 保活——切换视图不再卸载（筛选/选中/在途表单状态保留），
              仅访问过的视图才挂载（避免首屏六路并发请求）；payroll 保留 sensitive:salary 直达防御 */}
          {visitedViews.has('employees') && (
            <div className="flex-1 min-h-0 flex flex-col" style={{ display: activeView === 'employees' ? 'flex' : 'none' }}>
              <EmployeeProfilesTab
                isDarkMode={isDarkMode}
                personnel={personnel}
                departments={departments}
                positions={positions}
              />
            </div>
          )}
          {visitedViews.has('attendance') && (
            <div className="flex-1 min-h-0 flex flex-col" style={{ display: activeView === 'attendance' ? 'flex' : 'none' }}>
              <AttendanceLeaveTab isDarkMode={isDarkMode} personnel={personnel} />
            </div>
          )}
          {visitedViews.has('payroll') && (
            <div className="flex-1 min-h-0 flex flex-col" style={{ display: activeView === 'payroll' && canViewSalary ? 'flex' : 'none' }}>
              <PayrollTab isDarkMode={isDarkMode} personnel={personnel} />
            </div>
          )}
          {visitedViews.has('performance') && (
            <div className="flex-1 min-h-0 flex flex-col" style={{ display: activeView === 'performance' ? 'flex' : 'none' }}>
              <PerformanceTab isDarkMode={isDarkMode} personnel={personnel} projects={projects.map(p => ({ id: p.id, name: p.name, code: p.code }))} />
            </div>
          )}
          {visitedViews.has('training') && (
            <div className="flex-1 min-h-0 flex flex-col" style={{ display: activeView === 'training' ? 'flex' : 'none' }}>
              <TrainingTab isDarkMode={isDarkMode} personnel={personnel} />
            </div>
          )}
          {visitedViews.has('teams') && (
            <div className="flex-1 min-h-0 flex flex-col" style={{ display: activeView === 'teams' ? 'flex' : 'none' }}>
              <TeamManagementTab isDarkMode={isDarkMode} personnel={personnel} departments={departments} />
            </div>
          )}
        </RdlSurface>
      </main>
      )}
    </div>
  );
};

// ───────────────────────────────────────────────
// StatCard sub-component
// ───────────────────────────────────────────────

const StatCard: React.FC<{
  label: string;
  value: number;
}> = ({ label, value }) => (
  <div className="bds-card">
    <div className="bds-stat-label" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
    <div className="bds-stat-num mt-1">{value}</div>
  </div>
);

export default HRManager;
