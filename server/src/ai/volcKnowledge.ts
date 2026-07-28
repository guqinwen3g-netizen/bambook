import { KnowledgeHit } from '../agent/types';

type VolcKnowledgeResult = {
  id?: string;
  content?: string;
  md_content?: string;
  html_content?: string;
  score?: number;
  doc_name?: string;
  document_name?: string;
  title?: string;
  point_id?: string;
  chunk_id?: number;
};

type VolcKnowledgeResponse = {
  code?: number;
  message?: string;
  data?: {
    collection_name?: string;
    result_list?: VolcKnowledgeResult[];
  };
};

type SearchVolcKnowledgeOptions = {
  query: string;
  signal?: AbortSignal;
};

type AddVolcKnowledgeDocumentInput = {
  collectionName: string;
  project?: string;
  docId: string;
  docName: string;
  docType: string;
  url: string;
  meta?: Array<Record<string, unknown>>;
  signal?: AbortSignal;
};

type AddVolcKnowledgeDocumentResponse = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    collection_name?: string;
    resource_id?: string;
    project?: string;
    doc_id?: string;
    dedup_info?: unknown;
  };
};

export async function searchVolcKnowledge(options: SearchVolcKnowledgeOptions): Promise<KnowledgeHit[]> {
  const apiKey = process.env.BAMBOOK_KNOWLEDGE_API_KEY;
  const collections = parseCollections(process.env.BAMBOOK_KNOWLEDGE_COLLECTIONS || process.env.BAMBOOK_KNOWLEDGE_DEFAULT_COLLECTION);
  if (!apiKey || collections.length === 0) return [];

  const baseUrl = (process.env.BAMBOOK_KNOWLEDGE_BASE_URL || 'https://api-knowledgebase.mlp.cn-beijing.volces.com').replace(/\/$/, '');
  const project = process.env.BAMBOOK_KNOWLEDGE_PROJECT || 'default';
  const perCollectionLimit = Number(process.env.BAMBOOK_KNOWLEDGE_LIMIT || 5);
  const finalLimit = Number(process.env.BAMBOOK_KNOWLEDGE_CONTEXT_LIMIT || 8);

  const results = await Promise.allSettled(
    collections.map(collection => searchCollection({
      apiKey,
      baseUrl,
      project,
      collection,
      query: options.query,
      limit: Number.isFinite(perCollectionLimit) ? perCollectionLimit : 5,
      signal: options.signal,
    })),
  );

  return results
    .flatMap(result => (result.status === 'fulfilled' ? result.value : []))
    .sort((a, b) => Number((b as any).score || 0) - Number((a as any).score || 0))
    .slice(0, Number.isFinite(finalLimit) ? finalLimit : 8)
    .map(({ score: _score, ...hit }) => hit);
}

export async function addVolcKnowledgeDocument(input: AddVolcKnowledgeDocumentInput) {
  const apiKey = process.env.BAMBOOK_KNOWLEDGE_API_KEY;
  if (!apiKey) throw new Error('BAMBOOK_KNOWLEDGE_API_KEY is not configured');

  const baseUrl = (process.env.BAMBOOK_KNOWLEDGE_BASE_URL || 'https://api-knowledgebase.mlp.cn-beijing.volces.com').replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/api/knowledge/doc/add`, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      collection_name: input.collectionName,
      project: input.project || process.env.BAMBOOK_KNOWLEDGE_PROJECT || 'default',
      add_type: 'url',
      doc_id: input.docId,
      doc_name: input.docName,
      doc_type: input.docType,
      url: input.url,
      ...(input.meta?.length ? { meta: input.meta } : {}),
    }),
  });

  const data = await res.json().catch(() => ({})) as AddVolcKnowledgeDocumentResponse;
  if (!res.ok || data.code !== 0) {
    const message = data.message || `Volc knowledge document add failed with ${res.status}`;
    throw new Error(message);
  }
  return data;
}

function parseCollections(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

async function searchCollection(input: {
  apiKey: string;
  baseUrl: string;
  project: string;
  collection: string;
  query: string;
  limit: number;
  signal?: AbortSignal;
}): Promise<Array<KnowledgeHit & { score?: number }>> {
  const res = await fetch(`${input.baseUrl}/api/knowledge/collection/search_knowledge`, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      project: input.project,
      name: input.collection,
      query: input.query,
      limit: input.limit,
      pre_processing: {
        need_instruction: true,
        rewrite: false,
        return_token_usage: true,
        messages: [
          { role: 'system', content: '' },
          { role: 'user', content: input.query },
        ],
      },
      dense_weight: 0.5,
      post_processing: {
        get_attachment_link: false,
        chunk_group: true,
        rerank_only_chunk: false,
        rerank_switch: false,
        chunk_diffusion_count: 0,
      },
    }),
  });

  const data = await res.json().catch(() => ({})) as VolcKnowledgeResponse;
  if (!res.ok || data.code !== 0) {
    const message = data.message || `Volc knowledge search failed with ${res.status}`;
    throw new Error(message);
  }

  const collectionName = data.data?.collection_name || input.collection;
  return (data.data?.result_list || []).map((item, index) => {
    const content = item.md_content || item.content || item.html_content || '';
    return {
      title: item.title || item.doc_name || item.document_name || `${collectionName}#${item.chunk_id ?? index}`,
      category: 'VolcKnowledge',
      content,
      source: `volc-knowledge:${collectionName}`,
      scopes: ['company'],
      score: item.score,
    };
  }).filter(hit => hit.content.trim().length > 0);
}
