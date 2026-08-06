import { KnowledgeItem, Order, Email, Insight } from "../types";

/**
 * llmService — 仅保留本地模板化的经营摘要。
 * 浏览器端 LLM 调用已全部退役：对话/洞察抽取统一走后端 AI Runtime
 * （Assistant 组件 /api/ai/chat、/api/ai/insights）。
 */
export const llmService = {
    /**
     * Generate Executive Summary (template-based, computed locally from real order/email/insight counts)
     */
    async getExecutiveSummary(orders: Order[], emails: Email[], knowledge: KnowledgeItem[], insights: Insight[]) {
        const alertCount = orders.filter(o => o.status === 'Alert').length;
        const productionCount = orders.filter(o => o.status === 'Production').length;
        const shippingCount = orders.filter(o => o.status === 'Shipping').length;

        const statusPhrase = alertCount > 0
            ? `with ${alertCount} critical alert${alertCount > 1 ? 's' : ''} requiring attention`
            : 'operating within normal parameters';

        return `Business operations ${statusPhrase}. Currently tracking ${orders.length} orders (${productionCount} in production, ${shippingCount} shipping). ${insights.length} actionable insights identified from ${emails.length} communications.`;
    },
};
