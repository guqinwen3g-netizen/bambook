import { Response } from 'express';

export interface DataChangeEvent {
  entity: string;
  action: string;
  ids?: string[];
  timestamp?: number;
}

const clients = new Set<Response>();

export function addRealtimeClient(res: Response): () => void {
  clients.add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

  return () => {
    clients.delete(res);
  };
}

export function publishDataChange(event: DataChangeEvent) {
  const payload = JSON.stringify({ ...event, timestamp: event.timestamp ?? Date.now() });
  for (const client of clients) {
    client.write(`event: data-change\ndata: ${payload}\n\n`);
  }
}

