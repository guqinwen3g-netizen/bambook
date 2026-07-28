import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getApiBaseUrl } from '../services/apiBase';
import { motion, AnimatePresence } from 'framer-motion';
import { RdlToolbar, RdlPill, RdlSurface, RdlSearch } from './ui/RDLPrimitives';
import {
  Users, Building2, FolderKanban, ClipboardList, Plus, Trash2, Pencil,
  X, Check, Clock3, AlertCircle, UserCircle2,
} from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import UserAvatar from './ui/UserAvatar';
import { statusSemanticClass, StatusSemantic } from './rdlBusinessStatusTokens';

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

  // Forms
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: '', description: '', leaderId: '', departmentId: '' });
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: '', code: '', description: '', teamId: '', priority: 'normal', startDate: '', endDate: '' });
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ title: '', description: '', projectId: '', userId: '', priority: 'normal', dueDate: '' });
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

  // ── Style tokens (mirror AdminPanel patterns) ──
  const cardClass = `rounded-inset border transition-all duration-300 ${
    isDarkMode
      ? 'border-white/[0.055] bg-white/[0.018]'
      : 'border-white/45 bg-white/24'
  }`;

  const labelCls = `text-[10px] font-light tracking-wide ${isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight}`;
  const inputCls = `w-full h-9 px-3 rounded-control border outline-none text-xs font-light transition-all duration-200 ${
    isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light
  }`;

  const primaryButtonCls = `h-9 px-4 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-all duration-200 ${
    isDarkMode
      ? `${BAMBOOK_OS.controls.stateControl.baseDark} ${BAMBOOK_OS.controls.stateControl.interactionDark}`
      : `${BAMBOOK_OS.controls.stateControl.baseLight} ${BAMBOOK_OS.controls.stateControl.interactionLight}`
  }`;

  const actionButtonCls = `h-9 px-3 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-all duration-200 ${
    isDarkMode ? BAMBOOK_OS.controls.actionControl.borderedDark : BAMBOOK_OS.controls.actionControl.borderedLight
  }`;

  const subtleButtonCls = `h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors ${
    isDarkMode
      ? 'border-white/12 text-white/58 hover:text-white/82 hover:bg-white/[0.035]'
      : 'border-white/45 text-slate-600 hover:text-deep-alt hover:bg-white/30'
  }`;

  const titleClass = `${BAMBOOK_OS.layout.desktopTitleTextClass} text-os-adaptive-title`;
  const sectionTitleClass = `text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`;
  const sectionMutedClass = `text-xs font-light ${isDarkMode ? 'text-white/42' : 'text-slate-500'}`;
  const borderSoftClass = isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/60';

  const navItemActiveClass = isDarkMode
    ? `${BAMBOOK_OS.controls.selectedSurface.dark} text-white`
    : `${BAMBOOK_OS.controls.selectedSurface.light} text-deep-alt`;
  const navItemIdleClass = isDarkMode
    ? `${BAMBOOK_OS.controls.actionControl.dark} text-white/58 hover:text-white/84`
    : `${BAMBOOK_OS.controls.actionControl.light} text-slate-600 hover:text-deep-alt`;

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
    return `rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(semantic, isDarkMode)}`;
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
    return `rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(semanticMap[priority] || 'neutral', isDarkMode)}`;
  };

  // ── API helpers ──
  const apiBase = getApiBaseUrl().replace(/\/$/, '');
  const authToken = () => localStorage.getItem('bambook_auth_token') || sessionStorage.getItem('bambook_auth_token');
  const authHeaders = (extra: Record<string, string> = {}) => {
    const token = authToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  };

  const fetchHR = useCallback(async (path: string) => {
    const res = await fetch(`${apiBase}/hr/${path}`, {
      headers: authHeaders(),
      credentials: authToken() ? 'omit' : 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    return data;
  }, [apiBase]);

  const sendHR = useCallback(async (path: string, body: any, method = 'POST') => {
    const res = await fetch(`${apiBase}/hr/${path}`, {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      credentials: authToken() ? 'omit' : 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Operation failed');
    return data;
  }, [apiBase]);

  // ── Data loading: one-shot load of all HR data ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [personnelData, teamsData, projectsData, assignmentsData] = await Promise.all([
        fetchHR('personnel'),
        fetchHR('teams'),
        fetchHR('projects'),
        fetchHR('assignments'),
      ]);
      setPersonnel(personnelData.personnel || []);
      setDepartments(personnelData.departments || []);
      setPositions(personnelData.positions || []);
      setTeams(teamsData.teams || []);
      setProjects(projectsData.projects || []);
      setAssignments(assignmentsData.assignments || []);
    } catch (e: any) {
      setLoadError(e?.message || '加载人事数据失败');
    } finally {
      setLoading(false);
    }
  }, [fetchHR]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Form open/close helpers ──
  const openTeamForm = useCallback((team?: TeamInfo) => {
    setShowProjectForm(false);
    setShowAssignmentForm(false);
    if (team) {
      setTeamForm({ name: team.name, description: team.description || '', leaderId: team.leaderId || '', departmentId: team.departmentId || '' });
      setEditingTeamId(team.id);
    } else {
      const presetDeptId = selectedNode.type === 'dept' ? selectedNode.id : '';
      setTeamForm({ name: '', description: '', leaderId: '', departmentId: presetDeptId });
      setEditingTeamId(null);
    }
    setShowTeamForm(true);
  }, [selectedNode]);

  const closeTeamForm = () => {
    setTeamForm({ name: '', description: '', leaderId: '', departmentId: '' });
    setEditingTeamId(null);
    setShowTeamForm(false);
  };

  const openProjectForm = useCallback((project?: ProjectInfo) => {
    setShowTeamForm(false);
    setShowAssignmentForm(false);
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
    setShowTeamForm(false);
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

  // ── Team handlers ──
  const submitTeam = async () => {
    if (!teamForm.name.trim()) return;
    try {
      if (editingTeamId) {
        await sendHR(`teams/${editingTeamId}`, teamForm, 'PATCH');
      } else {
        await sendHR('teams', teamForm);
      }
      closeTeamForm();
      await loadAll();
    } catch (e: any) {
      setLoadError(e?.message || '保存团队失败');
    }
  };

  const deleteTeam = async (id: string) => {
    try {
      await sendHR(`teams/${id}`, {}, 'DELETE');
      await loadAll();
    } catch (e: any) {
      setLoadError(e?.message || '删除团队失败');
    }
  };

  // ── Project handlers ──
  const submitProject = async () => {
    if (!projectForm.name.trim()) return;
    try {
      if (editingProjectId) {
        await sendHR(`projects/${editingProjectId}`, projectForm, 'PATCH');
      } else {
        await sendHR('projects', projectForm);
      }
      closeProjectForm();
      await loadAll();
    } catch (e: any) {
      setLoadError(e?.message || '保存项目失败');
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await sendHR(`projects/${id}`, {}, 'DELETE');
      await loadAll();
    } catch (e: any) {
      setLoadError(e?.message || '删除项目失败');
    }
  };

  // ── Assignment handlers ──
  const submitAssignment = async () => {
    if (!assignmentForm.title.trim() || !assignmentForm.userId) return;
    try {
      if (editingAssignmentId) {
        await sendHR(`assignments/${editingAssignmentId}`, assignmentForm, 'PATCH');
      } else {
        await sendHR('assignments', assignmentForm);
      }
      closeAssignmentForm();
      await loadAll();
    } catch (e: any) {
      setLoadError(e?.message || '保存工作分配失败');
    }
  };

  const deleteAssignment = async (id: string) => {
    try {
      await sendHR(`assignments/${id}`, {}, 'DELETE');
      await loadAll();
    } catch (e: any) {
      setLoadError(e?.message || '删除工作分配失败');
    }
  };

  // ── Org tree construction ──
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

  const detailSearchPlaceholder = effectiveNode.type === 'project' ? '搜索工作分配…' : '搜索人员…';

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
    <div key={person.id} className={`${cardClass} p-4 flex items-center gap-3`}>
      <UserAvatar
        name={person.displayName}
        email={person.email}
        avatarUrl={person.avatarUrl}
        sizeClassName="w-10 h-10"
        isDarkMode={isDarkMode}
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-light truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
          {person.displayName}
        </div>
        <div className={`text-[10px] font-light truncate ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
          {person.email || '未绑定邮箱'}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {person.roles.map(role => (
          <span key={role} className={`rounded-full px-2 py-0.5 text-[10px] font-light ${
            isDarkMode ? 'bg-white/[0.04] text-white/50' : 'bg-white/34 text-slate-600'
          }`}>{role}</span>
        ))}
        <span className={statusChipCls(person.status)}>{person.status === 'active' ? '正常' : person.status === 'pending' ? '待审批' : person.status === 'disabled' ? '已停用' : person.status}</span>
      </div>
    </div>
  );

  const renderTeamCard = (team: TeamInfo) => (
    <div key={team.id} className={`${cardClass} p-4`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <button
            className={`text-sm font-light text-left truncate ${isDarkMode ? 'text-white hover:text-white/80' : 'text-slate-900 hover:text-deep-alt'}`}
            onClick={() => setSelectedNode({ type: 'team', id: team.id })}
          >
            {team.name}
          </button>
          {team.description && (
            <div className={`text-[10px] font-light mt-1 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>{team.description}</div>
          )}
        </div>
        <span className={statusChipCls(team.status)}>{team.status === 'active' ? '活跃' : team.status}</span>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
        <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
          <Users className="w-3 h-3 inline mr-1" />{team.memberCount} 成员
        </span>
        <div className="flex gap-1">
          <button onClick={() => openTeamForm(team)} className={subtleButtonCls}>
            <Pencil className="w-3 h-3" /> 编辑
          </button>
          <button onClick={() => deleteTeam(team.id)} className={subtleButtonCls}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );

  const renderProjectCard = (proj: ProjectInfo) => (
    <div key={proj.id} className={`${cardClass} p-4`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <button
            className={`text-sm font-light text-left truncate ${isDarkMode ? 'text-white hover:text-white/80' : 'text-slate-900 hover:text-deep-alt'}`}
            onClick={() => setSelectedNode({ type: 'project', id: proj.id })}
          >
            {proj.name}
          </button>
          {proj.code && (
            <span className={`text-[10px] font-light ml-1 ${isDarkMode ? 'text-white/36' : 'text-slate-400'}`}>#{proj.code}</span>
          )}
          {proj.description && (
            <div className={`text-[10px] font-light mt-1 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>{proj.description}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={statusChipCls(proj.status)}>{statusLabel(proj.status, PROJECT_STATUS_OPTIONS)}</span>
          <span className={priorityChipCls(proj.priority)}>{statusLabel(proj.priority, PRIORITY_OPTIONS)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
            <Users className="w-3 h-3 inline mr-1" />{proj.memberCount}
          </span>
          <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
            <ClipboardList className="w-3 h-3 inline mr-1" />{proj.assignmentCount} 任务
          </span>
          {proj.endDate && (
            <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
              <Clock3 className="w-3 h-3 inline mr-1" />{formatDate(proj.endDate)}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={() => openProjectForm(proj)} className={subtleButtonCls}>
            <Pencil className="w-3 h-3" /> 编辑
          </button>
          <button onClick={() => deleteProject(proj.id)} className={subtleButtonCls}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );

  const renderAssignmentRow = (a: AssignmentInfo) => (
    <div key={a.id} className={`${cardClass} p-4 flex items-center gap-4`}>
      <UserAvatar
        name={a.userName}
        avatarUrl={a.userAvatar}
        sizeClassName="w-9 h-9"
        isDarkMode={isDarkMode}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{a.title}</span>
          <span className={priorityChipCls(a.priority)}>{statusLabel(a.priority, PRIORITY_OPTIONS)}</span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
            <UserCircle2 className="w-3 h-3 inline mr-1" />{a.userName}
          </span>
          {a.dueDate && (
            <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
              <Clock3 className="w-3 h-3 inline mr-1" />{formatDate(a.dueDate)}
            </span>
          )}
        </div>
      </div>
      <span className={statusChipCls(a.status)}>{statusLabel(a.status, ASSIGNMENT_STATUS_OPTIONS)}</span>
      <div className="flex gap-1">
        <button onClick={() => openAssignmentForm(a)} className={subtleButtonCls}>
          <Pencil className="w-3 h-3" />
        </button>
        <button onClick={() => deleteAssignment(a.id)} className={subtleButtonCls}>
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
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
            {selectedProject.code && <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-400'}`}>#{selectedProject.code}</span>}
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
      <RdlSearch
        density="compact"
        value={detailSearchTerm}
        onChange={e => setDetailSearchTerm(e.target.value)}
        placeholder={detailSearchPlaceholder}
        className="flex-1 min-w-[160px]"
      />
      <div className="ml-auto flex items-center gap-1.5">
        {effectiveNode.type === 'dept' && (
          <>
            <button onClick={() => openTeamForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新团队</button>
            <button onClick={() => openProjectForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新项目</button>
          </>
        )}
        {effectiveNode.type === 'team' && selectedTeam && (
          <>
            <button onClick={() => openProjectForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新项目</button>
            <button onClick={() => openTeamForm(selectedTeam)} className={subtleButtonCls}><Pencil className="w-3 h-3" /> 编辑</button>
          </>
        )}
        {effectiveNode.type === 'project' && selectedProject && (
          <>
            <button onClick={() => openAssignmentForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 分配任务</button>
            <button onClick={() => openProjectForm(selectedProject)} className={subtleButtonCls}><Pencil className="w-3 h-3" /> 编辑</button>
          </>
        )}
      </div>
    </div>
  );

  // ── Detail content by node type ──
  const renderDetailContent = () => {
    if (effectiveNode.type === 'all') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="在职人员" value={personnel.filter(p => p.status === 'active').length} isDarkMode={isDarkMode} cardClass={cardClass} />
            <StatCard label="部门数量" value={departments.length} isDarkMode={isDarkMode} cardClass={cardClass} />
            <StatCard label="岗位设置" value={positions.length} isDarkMode={isDarkMode} cardClass={cardClass} />
            <StatCard label="待审批用户" value={personnel.filter(p => p.status === 'pending').length} isDarkMode={isDarkMode} cardClass={cardClass} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={sectionTitleClass}>人员名册</h3>
              <span className={sectionMutedClass}>{filteredAllPersonnel.length} 人</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredAllPersonnel.map(renderPersonCard)}
              {filteredAllPersonnel.length === 0 && (
                <div className={`col-span-2 text-center py-8 ${sectionMutedClass}`}>暂无人员数据</div>
              )}
            </div>
          </div>

          <div>
            <h3 className={`${sectionTitleClass} mb-3`}>岗位设置</h3>
            <div className="grid grid-cols-3 gap-3">
              {positions.map(pos => (
                <div key={pos.id} className={`${cardClass} p-4`}>
                  <div className={`text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{pos.title}</div>
                  <div className={`text-[10px] font-light mt-1 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
                    {pos.department || '未分配部门'} · 编制 {pos.headcount}
                  </div>
                  {pos.description && (
                    <div className={`text-[10px] font-light mt-2 ${isDarkMode ? 'text-white/36' : 'text-slate-400'}`}>
                      {pos.description}
                    </div>
                  )}
                </div>
              ))}
              {positions.length === 0 && (
                <div className={`col-span-3 text-center py-8 ${sectionMutedClass}`}>暂无岗位数据</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (effectiveNode.type === 'dept' && selectedDept) {
      return (
        <div className="space-y-4">
          <div className={`${cardClass} p-4`}>
            <div className={`text-[10px] font-light tracking-wide ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>部门信息</div>
            <div className={`text-sm font-light mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedDept.name}</div>
            <div className={`text-[10px] font-light mt-2 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
              状态：{selectedDept.status === 'active' ? '活跃' : selectedDept.status} · 上级部门：{parentDept ? parentDept.name : '无'}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={sectionTitleClass}>部门成员</h3>
              <span className={sectionMutedClass}>{filteredDeptPersonnel.length} 人</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredDeptPersonnel.map(renderPersonCard)}
              {filteredDeptPersonnel.length === 0 && (
                <div className={`col-span-2 text-center py-8 ${sectionMutedClass}`}>该部门暂无直接归属人员</div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={sectionTitleClass}>下属团队</h3>
              <button onClick={() => openTeamForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新建</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {deptTeams.map(renderTeamCard)}
              {deptTeams.length === 0 && (
                <div className={`col-span-2 text-center py-8 ${sectionMutedClass}`}>
                  <Building2 className="w-7 h-7 mx-auto mb-2 opacity-30" />
                  该部门暂无团队
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
          <div className={`${cardClass} p-4`}>
            <div className={`text-[10px] font-light tracking-wide ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>团队信息</div>
            <div className={`text-sm font-light mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedTeam.name}</div>
            {selectedTeam.description && (
              <div className={`text-[10px] font-light mt-2 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>{selectedTeam.description}</div>
            )}
            <div className={`text-[10px] font-light mt-2 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
              成员编制：{selectedTeam.memberCount} · 负责人：{teamLeader ? teamLeader.displayName : '未指定'} · 所属部门：{selectedTeam.department || '未分配'}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={sectionTitleClass}>团队项目</h3>
              <button onClick={() => openProjectForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 新建</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {teamProjects.map(renderProjectCard)}
              {teamProjects.length === 0 && (
                <div className={`col-span-2 text-center py-8 ${sectionMutedClass}`}>
                  <FolderKanban className="w-7 h-7 mx-auto mb-2 opacity-30" />
                  该团队暂无项目
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
          <div className={`${cardClass} p-4`}>
            <div className={`text-[10px] font-light tracking-wide ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>项目信息</div>
            <div className={`text-sm font-light mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedProject.name}</div>
            {selectedProject.description && (
              <div className={`text-[10px] font-light mt-2 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>{selectedProject.description}</div>
            )}
            <div className={`text-[10px] font-light mt-2 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
              所属团队：{selectedProject.teamName || '未分配'} · 成员：{selectedProject.memberCount} · 任务：{selectedProject.assignmentCount}
              {selectedProject.startDate && ` · 开始 ${formatDate(selectedProject.startDate)}`}
              {selectedProject.endDate && ` · 截止 ${formatDate(selectedProject.endDate)}`}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={sectionTitleClass}>工作分配</h3>
              <button onClick={() => openAssignmentForm()} className={subtleButtonCls}><Plus className="w-3 h-3" /> 分配任务</button>
            </div>
            <div className="space-y-2">
              {projectAssignments.map(renderAssignmentRow)}
              {projectAssignments.length === 0 && (
                <div className={`text-center py-8 ${sectionMutedClass}`}>
                  <ClipboardList className="w-7 h-7 mx-auto mb-2 opacity-30" />
                  该项目暂无工作分配
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
        isDarkMode={isDarkMode}
        actions={(
          <RdlToolbar density="compact">
            <RdlPill type="button" active tone="accent" onClick={() => openTeamForm()} className="min-h-8 px-4 text-[11px]">
              <Plus className="w-3.5 h-3.5" /> 新建团队
            </RdlPill>
            <RdlPill type="button" active tone="accent" onClick={() => openProjectForm()} className="min-h-8 px-4 text-[11px]">
              <Plus className="w-3.5 h-3.5" /> 新建项目
            </RdlPill>
          </RdlToolbar>
        )}
      />

      {/* Error banner */}
      <AnimatePresence>
        {loadError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex-shrink-0 px-7 pt-2"
          >
            <div className={`rounded-full border px-4 py-2.5 flex items-center gap-2 text-xs font-light ${
              statusSemanticClass('danger', isDarkMode)
            }`}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} className="ml-auto opacity-60 hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main: org tree nav + detail panel */}
      <main className="flex-1 min-h-0 px-5 pb-5 pt-1">
        <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] gap-3">
          {/* Left: org tree navigation */}
          <RdlSurface tone="panel" padding="compact" className="flex h-full min-h-0 flex-col">
            <RdlSearch
              density="compact"
              value={treeSearchTerm}
              onChange={e => setTreeSearchTerm(e.target.value)}
              placeholder="搜索部门 / 团队 / 项目"
              className="mb-2"
            />
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
              {visibleForest.orphanTeams.map(node => renderTreeNode(node, 0))}
              {visibleForest.orphanProjects.map(node => renderTreeNode(node, 0))}

              {!treeHasContent && (
                <div className={`text-center py-8 ${sectionMutedClass}`}>
                  <Building2 className="w-7 h-7 mx-auto mb-2 opacity-30" />
                  {treeSearchTerm ? '未找到匹配的组织节点' : '暂无部门 / 团队数据'}
                </div>
              )}
            </div>
          </RdlSurface>

          {/* Right: detail panel */}
          <RdlSurface tone="panel" className="flex h-full min-h-0 flex-col overflow-hidden">
            {renderDetailHeader()}
            {renderDetailToolbar()}

            {/* Inline form expansion */}
            <AnimatePresence>
              {showTeamForm && (
                <motion.div
                  key="team-form"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-5 py-3">
                    <div className={`${cardClass} p-5 space-y-3`}>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls + ' mb-1'}>团队名称</div>
                          <input
                            className={inputCls}
                            value={teamForm.name}
                            onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="如：面料采购组"
                          />
                        </div>
                        <div>
                          <div className={labelCls + ' mb-1'}>所属部门</div>
                          <select
                            className={inputCls}
                            value={teamForm.departmentId}
                            onChange={e => setTeamForm(f => ({ ...f, departmentId: e.target.value }))}
                          >
                            <option value="">无</option>
                            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <div className={labelCls + ' mb-1'}>团队描述</div>
                        <input
                          className={inputCls}
                          value={teamForm.description}
                          onChange={e => setTeamForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="团队职责简介"
                        />
                      </div>
                      <div>
                        <div className={labelCls + ' mb-1'}>团队负责人</div>
                        <select
                          className={inputCls}
                          value={teamForm.leaderId}
                          onChange={e => setTeamForm(f => ({ ...f, leaderId: e.target.value }))}
                        >
                          <option value="">未指定</option>
                          {personnel.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                        </select>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={closeTeamForm} className={actionButtonCls}>取消</button>
                        <button onClick={submitTeam} className={primaryButtonCls}>
                          <Check className="w-3.5 h-3.5" /> {editingTeamId ? '保存' : '创建'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {showProjectForm && (
                <motion.div
                  key="project-form"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-5 py-3">
                    <div className={`${cardClass} p-5 space-y-3`}>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls + ' mb-1'}>项目名称</div>
                          <input className={inputCls} value={projectForm.name}
                            onChange={e => setProjectForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="如：2026秋冬季面料开发" />
                        </div>
                        <div>
                          <div className={labelCls + ' mb-1'}>项目编号</div>
                          <input className={inputCls} value={projectForm.code}
                            onChange={e => setProjectForm(f => ({ ...f, code: e.target.value }))}
                            placeholder="可选" />
                        </div>
                      </div>
                      <div>
                        <div className={labelCls + ' mb-1'}>项目描述</div>
                        <input className={inputCls} value={projectForm.description}
                          onChange={e => setProjectForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="项目简介" />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className={labelCls + ' mb-1'}>所属团队</div>
                          <select className={inputCls} value={projectForm.teamId}
                            onChange={e => setProjectForm(f => ({ ...f, teamId: e.target.value }))}>
                            <option value="">无</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls + ' mb-1'}>优先级</div>
                          <select className={inputCls} value={projectForm.priority}
                            onChange={e => setProjectForm(f => ({ ...f, priority: e.target.value }))}>
                            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls + ' mb-1'}>开始日期</div>
                          <input type="date" className={inputCls} value={projectForm.startDate}
                            onChange={e => setProjectForm(f => ({ ...f, startDate: e.target.value }))} />
                        </div>
                      </div>
                      <div>
                        <div className={labelCls + ' mb-1'}>结束日期</div>
                        <input type="date" className={inputCls} value={projectForm.endDate}
                          onChange={e => setProjectForm(f => ({ ...f, endDate: e.target.value }))} />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={closeProjectForm} className={actionButtonCls}>取消</button>
                        <button onClick={submitProject} className={primaryButtonCls}>
                          <Check className="w-3.5 h-3.5" /> {editingProjectId ? '保存' : '创建'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {showAssignmentForm && (
                <motion.div
                  key="assignment-form"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-5 py-3">
                    <div className={`${cardClass} p-5 space-y-3`}>
                      <div>
                        <div className={labelCls + ' mb-1'}>任务标题</div>
                        <input className={inputCls} value={assignmentForm.title}
                          onChange={e => setAssignmentForm(f => ({ ...f, title: e.target.value }))}
                          placeholder="如：安排面料打样" />
                      </div>
                      <div>
                        <div className={labelCls + ' mb-1'}>任务描述</div>
                        <input className={inputCls} value={assignmentForm.description}
                          onChange={e => setAssignmentForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="任务详情" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls + ' mb-1'}>指派给</div>
                          <select className={inputCls} value={assignmentForm.userId}
                            onChange={e => setAssignmentForm(f => ({ ...f, userId: e.target.value }))}>
                            <option value="">选择人员</option>
                            {personnel.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls + ' mb-1'}>关联项目</div>
                          <select className={inputCls} value={assignmentForm.projectId}
                            onChange={e => setAssignmentForm(f => ({ ...f, projectId: e.target.value }))}>
                            <option value="">无</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls + ' mb-1'}>优先级</div>
                          <select className={inputCls} value={assignmentForm.priority}
                            onChange={e => setAssignmentForm(f => ({ ...f, priority: e.target.value }))}>
                            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={labelCls + ' mb-1'}>截止日期</div>
                          <input type="date" className={inputCls} value={assignmentForm.dueDate}
                            onChange={e => setAssignmentForm(f => ({ ...f, dueDate: e.target.value }))} />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={closeAssignmentForm} className={actionButtonCls}>取消</button>
                        <button onClick={submitAssignment} className={primaryButtonCls} disabled={!assignmentForm.userId}>
                          <Check className="w-3.5 h-3.5" /> {editingAssignmentId ? '保存' : '分配'}
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
    </div>
  );
};

// ───────────────────────────────────────────────
// StatCard sub-component
// ───────────────────────────────────────────────

const StatCard: React.FC<{
  label: string;
  value: number;
  isDarkMode: boolean;
  cardClass: string;
}> = ({ label, value, isDarkMode, cardClass }) => (
  <div className={`${cardClass} p-4`}>
    <div className={`text-[10px] font-light tracking-wide ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>{label}</div>
    <div className={`text-2xl font-light mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{value}</div>
  </div>
);

export default HRManager;
