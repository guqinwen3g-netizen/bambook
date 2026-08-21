/**
 * C3e 培训管理 tab — 课程 + 报名/成绩
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Plus, Trash2, X } from 'lucide-react';
import { hrTokens, hrFormatDate, hrOptionLabel, type HrPersonnelOption } from './hrTokens';
import {
  hrService, COURSE_STATUS_OPTIONS, ENROLLMENT_STATUS_OPTIONS,
  type TrainingCourse, type TrainingEnrollment, type EnrollmentStatus,
} from '../../services/hrService';
import { statusSemanticClass, type StatusSemantic } from '../rdlBusinessStatusTokens';
import CapsuleDateInput from '../ui/CapsuleDateInput';

interface TrainingTabProps {
  isDarkMode: boolean;
  personnel: HrPersonnelOption[];
}

const courseSemantic = (status: string): StatusSemantic => {
  switch (status) {
    case 'Ongoing': return 'active';
    case 'Planned': return 'info';
    case 'Completed': return 'neutral';
    case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
};

const enrollmentSemantic = (status: string): StatusSemantic => {
  switch (status) {
    case 'Completed': return 'active';
    case 'Enrolled': return 'info';
    case 'Absent': return 'warning';
    default: return 'neutral';
  }
};

const emptyCourseForm = {
  title: '', type: 'Internal' as 'Internal' | 'External', instructor: '',
  startDate: '', endDate: '', capacity: '', description: '',
};

const TrainingTab: React.FC<TrainingTabProps> = ({ isDarkMode, personnel }) => {
  const t = hrTokens(isDarkMode);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [courseForm, setCourseForm] = useState(emptyCourseForm);

  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [enrollUserId, setEnrollUserId] = useState('');
  const [editingEnrollmentId, setEditingEnrollmentId] = useState<string | null>(null);
  const [enrollmentForm, setEnrollmentForm] = useState({ status: 'Enrolled' as EnrollmentStatus, score: '', certificate: '' });

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true);
    try {
      const rows = await hrService.listTrainingCourses({ status: statusFilter || undefined });
      setCourses(rows);
    } catch (e: any) {
      setError(e?.message || '加载课程失败');
    } finally {
      setCoursesLoading(false);
    }
  }, [statusFilter]);

  const loadEnrollments = useCallback(async (courseId: string) => {
    try {
      const rows = await hrService.listEnrollments({ courseId });
      setEnrollments(rows);
    } catch (e: any) {
      setError(e?.message || '加载报名记录失败');
    }
  }, []);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  useEffect(() => {
    if (selectedCourseId) loadEnrollments(selectedCourseId);
    else setEnrollments([]);
  }, [selectedCourseId, loadEnrollments]);

  const selectedCourse = useMemo(
    () => courses.find(c => c.id === selectedCourseId) || null,
    [courses, selectedCourseId],
  );

  // 未报名员工（picker）
  const unenrolled = useMemo(() => {
    const enrolled = new Set(enrollments.map(e => e.userId));
    return personnel.filter(p => !enrolled.has(p.id));
  }, [enrollments, personnel]);

  const submitCourse = async () => {
    if (!courseForm.title.trim()) { setError('课程名称必填'); return; }
    const capacity = courseForm.capacity === '' ? null : Number(courseForm.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) { setError('名额须为正整数'); return; }
    setBusy(true);
    setError('');
    try {
      const course = await hrService.createTrainingCourse({
        title: courseForm.title.trim(),
        type: courseForm.type,
        instructor: courseForm.instructor || null,
        startDate: courseForm.startDate || null,
        endDate: courseForm.endDate || null,
        capacity,
        description: courseForm.description || null,
      });
      setCourseForm(emptyCourseForm);
      setShowCourseForm(false);
      await loadCourses();
      setSelectedCourseId(course.id);
    } catch (e: any) {
      setError(e?.message || '创建课程失败');
    } finally {
      setBusy(false);
    }
  };

  const setCourseStatus = async (id: string, status: TrainingCourse['status']) => {
    setBusy(true);
    setError('');
    try {
      await hrService.updateTrainingCourse(id, { status });
      await loadCourses();
    } catch (e: any) {
      setError(e?.message || '更新课程状态失败');
    } finally {
      setBusy(false);
    }
  };

  const removeCourse = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await hrService.deleteTrainingCourse(id);
      if (selectedCourseId === id) setSelectedCourseId(null);
      await loadCourses();
    } catch (e: any) {
      setError(e?.message || '删除课程失败');
    } finally {
      setBusy(false);
    }
  };

  const enroll = async () => {
    if (!selectedCourseId || !enrollUserId) return;
    setBusy(true);
    setError('');
    try {
      await hrService.enrollTraining(selectedCourseId, enrollUserId);
      setEnrollUserId('');
      await loadEnrollments(selectedCourseId);
      await loadCourses();
    } catch (e: any) {
      setError(e?.message || '报名失败');
    } finally {
      setBusy(false);
    }
  };

  const openEditEnrollment = (e: TrainingEnrollment) => {
    setEditingEnrollmentId(e.id);
    setEnrollmentForm({
      status: e.status,
      score: e.score != null ? String(e.score) : '',
      certificate: e.certificate || '',
    });
  };

  const submitEnrollment = async () => {
    if (!editingEnrollmentId) return;
    const score = enrollmentForm.score === '' ? null : Number(enrollmentForm.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) { setError('成绩须在 0-100'); return; }
    setBusy(true);
    setError('');
    try {
      await hrService.updateEnrollment(editingEnrollmentId, {
        status: enrollmentForm.status,
        score,
        certificate: enrollmentForm.certificate || null,
      });
      setEditingEnrollmentId(null);
      if (selectedCourseId) await loadEnrollments(selectedCourseId);
      await loadCourses();
    } catch (e: any) {
      setError(e?.message || '更新报名记录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <select className={`${t.selectCls} max-w-36`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          {COURSE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className={t.sectionMutedClass}>共 {courses.length} 门课程</span>
        <div className="ml-auto">
          <button onClick={() => setShowCourseForm(v => !v)} className={t.primaryButtonCls}>
            <Plus className="w-3.5 h-3.5" /> 新建课程
          </button>
        </div>
      </div>

      {error && (
        <div className={`mx-1 rounded-full border px-4 py-2.5 flex items-center gap-2 text-xs font-light ${statusSemanticClass('danger', isDarkMode)}`}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {showCourseForm && (
        <div className={`${t.cardClass} mx-1 p-5 space-y-3`}>
          <div className={t.sectionTitleClass}>新建培训课程</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className={t.labelCls + ' mb-1'}>课程名称 *</div>
              <input className={t.inputCls} value={courseForm.title}
                onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))} placeholder="如：面料基础知识入门" />
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>类型</div>
              <select className={t.selectCls} value={courseForm.type}
                onChange={e => setCourseForm(f => ({ ...f, type: e.target.value as 'Internal' | 'External' }))}>
                <option value="Internal">内部培训</option>
                <option value="External">外部培训</option>
              </select>
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>讲师</div>
              <input className={t.inputCls} value={courseForm.instructor}
                onChange={e => setCourseForm(f => ({ ...f, instructor: e.target.value }))} />
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>开始日期</div>
              <CapsuleDateInput className={t.inputCls} value={courseForm.startDate}
                onChange={(v) => setCourseForm(f => ({ ...f, startDate: v }))} isDarkMode={isDarkMode} />
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>结束日期</div>
              <CapsuleDateInput className={t.inputCls} value={courseForm.endDate}
                onChange={(v) => setCourseForm(f => ({ ...f, endDate: v }))} isDarkMode={isDarkMode} />
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>名额上限</div>
              <input type="number" min="1" step="1" className={t.inputCls} value={courseForm.capacity}
                onChange={e => setCourseForm(f => ({ ...f, capacity: e.target.value }))} placeholder="不限" />
            </div>
          </div>
          <div>
            <div className={t.labelCls + ' mb-1'}>课程简介</div>
            <input className={t.inputCls} value={courseForm.description}
              onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCourseForm(false)} className={t.actionButtonCls}>取消</button>
            <button onClick={submitCourse} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
              <Check className="w-3.5 h-3.5" /> {busy ? '提交中…' : '创建'}
            </button>
          </div>
        </div>
      )}

      <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 px-1">
        {/* 左：课程列表 */}
        <div className={`${t.cardClass} flex min-h-0 flex-col overflow-hidden`}>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {courses.map(c => (
              <button key={c.id} onClick={() => setSelectedCourseId(c.id)}
                className={`block w-full px-4 py-3 text-left ${t.rowCls(selectedCourseId === c.id)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-xs font-light ${t.textPrimaryClass}`}>{c.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(courseSemantic(c.status), isDarkMode)}`}>
                    {hrOptionLabel(COURSE_STATUS_OPTIONS, c.status)}
                  </span>
                </div>
                <div className={`mt-1 text-[11px] font-light ${t.textSecondaryClass}`}>
                  {c.type === 'Internal' ? '内部' : '外部'}
                  {c.instructor ? ` · ${c.instructor}` : ''}
                  {c.startDate ? ` · ${hrFormatDate(c.startDate)}` : ''}
                  {` · 报名 ${c.enrolledCount}${c.capacity ? `/${c.capacity}` : ''} · 结业 ${c.completedCount}`}
                </div>
              </button>
            ))}
            {!coursesLoading && courses.length === 0 && (
              <div className={`py-12 text-center ${t.sectionMutedClass}`}>暂无课程，点击右上角新建</div>
            )}
            {coursesLoading && <div className={`py-12 text-center ${t.sectionMutedClass}`}>加载中…</div>}
          </div>
        </div>

        {/* 右：课程详情 + 报名 */}
        <div className={`${t.cardClass} flex min-h-0 flex-col overflow-hidden`}>
          {selectedCourse ? (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--border-c-default)] px-4 py-3">
                <span className={`truncate ${t.sectionTitleClass}`}>{selectedCourse.title}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {selectedCourse.status === 'Planned' && (
                    <button disabled={busy} onClick={() => setCourseStatus(selectedCourse.id, 'Ongoing')} className={t.subtleButtonCls}>开课</button>
                  )}
                  {selectedCourse.status === 'Ongoing' && (
                    <button disabled={busy} onClick={() => setCourseStatus(selectedCourse.id, 'Completed')} className={t.subtleButtonCls}>结课</button>
                  )}
                  {(selectedCourse.status === 'Planned' || selectedCourse.status === 'Ongoing') && (
                    <button disabled={busy} onClick={() => setCourseStatus(selectedCourse.id, 'Cancelled')} className={t.dangerButtonCls}>取消课程</button>
                  )}
                  <button disabled={busy} onClick={() => removeCourse(selectedCourse.id)} className={t.dangerButtonCls}>
                    <Trash2 className="w-3 h-3" /> 删除
                  </button>
                </div>
              </div>

              {(selectedCourse.status === 'Planned' || selectedCourse.status === 'Ongoing') && (
                <div className="flex items-center gap-2 border-b border-[var(--border-c-default)] px-4 py-3">
                  <select className={`${t.selectCls} max-w-56`} value={enrollUserId} onChange={e => setEnrollUserId(e.target.value)}>
                    <option value="">选择员工报名</option>
                    {unenrolled.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select>
                  <button onClick={enroll} disabled={busy || !enrollUserId} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                    <Plus className="w-3.5 h-3.5" /> 报名
                  </button>
                  {selectedCourse.capacity != null && (
                    <span className={t.sectionMutedClass}>名额 {selectedCourse.enrolledCount}/{selectedCourse.capacity}</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-[minmax(0,1fr)_96px_80px_minmax(0,1fr)_80px] border-b border-[var(--border-c-default)]">
                <div className={t.thCls}>员工</div>
                <div className={t.thCls}>状态</div>
                <div className={t.thCls}>成绩</div>
                <div className={t.thCls}>证书</div>
                <div className={t.thCls}></div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {enrollments.map(e => (
                  <React.Fragment key={e.id}>
                    <div className="grid grid-cols-[minmax(0,1fr)_96px_80px_minmax(0,1fr)_80px] items-center">
                      <div className={t.tdCls}>{e.displayName || e.userId}</div>
                      <div className={t.tdCls}>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(enrollmentSemantic(e.status), isDarkMode)}`}>
                          {hrOptionLabel(ENROLLMENT_STATUS_OPTIONS, e.status)}
                        </span>
                      </div>
                      <div className={t.tdCls}>{e.score ?? '-'}</div>
                      <div className={`${t.tdCls} truncate ${t.textSecondaryClass}`}>{e.certificate || '-'}</div>
                      <div className={t.tdCls}>
                        <button onClick={() => openEditEnrollment(e)} className={t.subtleButtonCls}>更新</button>
                      </div>
                    </div>
                    {editingEnrollmentId === e.id && (
                      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-end gap-2 border-b border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] px-4 py-3">
                        <div>
                          <div className={t.labelCls + ' mb-1'}>状态</div>
                          <select className={t.selectCls} value={enrollmentForm.status}
                            onChange={ev => setEnrollmentForm(f => ({ ...f, status: ev.target.value as EnrollmentStatus }))}>
                            {ENROLLMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={t.labelCls + ' mb-1'}>成绩（0-100）</div>
                          <input type="number" min="0" max="100" step="0.5" className={t.inputCls} value={enrollmentForm.score}
                            onChange={ev => setEnrollmentForm(f => ({ ...f, score: ev.target.value }))} />
                        </div>
                        <div>
                          <div className={t.labelCls + ' mb-1'}>证书编号</div>
                          <input className={t.inputCls} value={enrollmentForm.certificate}
                            onChange={ev => setEnrollmentForm(f => ({ ...f, certificate: ev.target.value }))} />
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => setEditingEnrollmentId(null)} className={t.actionButtonCls}>取消</button>
                          <button onClick={submitEnrollment} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                            <Check className="w-3.5 h-3.5" /> 保存
                          </button>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
                {enrollments.length === 0 && (
                  <div className={`py-12 text-center ${t.sectionMutedClass}`}>暂无报名记录</div>
                )}
              </div>
            </>
          ) : (
            <div className={`flex-1 flex items-center justify-center ${t.sectionMutedClass}`}>从左侧选择课程</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TrainingTab;
