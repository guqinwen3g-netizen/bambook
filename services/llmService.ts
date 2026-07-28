import { KnowledgeItem, Order, Email, ChatAttachment, Insight, ChatMessage, Relation } from "../types";

export const llmService = {
    /**
     * @deprecated Browser-side LLM calls are disabled. Use the Agent runtime via
     * Assistant component / /api/ai/chat endpoint instead. This stub exists only
     * for backward compatibility and always returns a placeholder.
     */
    async chat(
        prompt: string,
        knowledge: KnowledgeItem[],
        orders: Order[],
        relations: Relation[],
        history: any[] = [],
        attachments: ChatAttachment[] = [],
        insights: Insight[] = [],
        useSearch: boolean = false,
        onStep?: (step: string) => void,
        model?: string,
        temperature?: number
    ) {
        console.warn('[LLM Service] Browser-side model calls are disabled. Use /api/ai/chat via Assistant runtime.');
        return {
            text: 'AI Runtime must be called through the Bambook backend.',
            sources: []
        };
    },

    /**
     * Safety Net: Cleanup any leaked JSON or SSE chunks from model output
     */
    sanitizeResponse(text: string): string {
        if (!text) return '';
        let clean = text.replace(/\{"index":\d+,"finish_reason".+?\}/g, '');
        return clean.trim();
    },

    /**
     * @deprecated Browser-side insight extraction is disabled. Route through the
     * backend AI runtime (/api/ai/insights) instead. This stub always returns [].
     */
    async extractInsights(lastMessages: ChatMessage[]): Promise<Insight[]> {
        console.warn('[LLM Service] Browser-side insight extraction is disabled. Route this through the backend AI runtime.');
        return [];
    },

    /**
     * Generate Executive Summary (template-based, runs locally on the data center)
     */
    async getExecutiveSummary(orders: Order[], emails: Email[], knowledge: KnowledgeItem[], insights: Insight[]) {
        const alertCount = orders.filter(o => o.status === 'Alert').length;
        const productionCount = orders.filter(o => o.status === 'Production').length;
        const shippingCount = orders.filter(o => o.status === 'Shipping').length;

        const statusPhrase = alertCount > 0
            ? `with ${alertCount} critical alert${alertCount > 1 ? 's' : ''} requiring attention`
            : 'operating within normal parameters';

        const summary = `Business operations ${statusPhrase}. Currently tracking ${orders.length} orders (${productionCount} in production, ${shippingCount} shipping). ${insights.length} actionable insights identified from ${emails.length} communications.`;

        console.log('[Executive Summary] Generated:', summary);
        return summary;
    },
};
