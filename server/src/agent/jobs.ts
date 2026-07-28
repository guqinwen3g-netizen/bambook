type AgentJobRecord = {
  id: string;
  jobType: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  priority: number;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export function createJobService() {
  const jobs: AgentJobRecord[] = [];

  async function enqueue(input: { jobType: string; payload: Record<string, unknown>; priority?: number }) {
    const job: AgentJobRecord = {
      id: `job_${jobs.length + 1}`,
      jobType: input.jobType,
      status: 'queued',
      priority: input.priority ?? 5,
      payload: input.payload,
      createdAt: new Date(),
    };
    jobs.push(job);
    return job;
  }

  async function stats() {
    return {
      queued: jobs.filter(job => job.status === 'queued').length,
      running: jobs.filter(job => job.status === 'running').length,
      completed: jobs.filter(job => job.status === 'completed').length,
      failed: jobs.filter(job => job.status === 'failed').length,
    };
  }

  return { enqueue, stats };
}
