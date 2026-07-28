import { createLogger, format, transports, Logger } from 'winston';

/**
 * Bambook Agent 结构化日志系统
 * - JSON 格式输出
 * - 支持 Trace ID 追踪
 * - 分离 Console 和 File 输出
 */

// 自定义格式：添加 traceId 和 component 字段
const customFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, traceId, component, ...meta }) => {
        const baseLog = {
            timestamp,
            level: level.toUpperCase(),
            component: component || 'SYSTEM',
            traceId: traceId || 'N/A',
            message,
            ...meta
        };
        return JSON.stringify(baseLog);
    })
);

// Console 格式（更易读）
const consoleFormat = format.combine(
    format.colorize(),
    format.timestamp({ format: 'HH:mm:ss' }),
    format.printf(({ timestamp, level, message, component }) => {
        const comp = component ? `[${component}]` : '';
        return `${timestamp} ${level} ${comp} ${message}`;
    })
);

// 创建 Logger 实例
const logger: Logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: customFormat,
    defaultMeta: { service: 'bambook-agent' },
    transports: [
        // 控制台输出（更易读）— 仅在非生产环境
        new transports.Console({
            format: consoleFormat,
            level: 'debug'
        }),
        // 文件输出（结构化 JSON）
        new transports.File({
            filename: 'logs/bambook-error.log',
            level: 'error'
        }),
        new transports.File({
            filename: 'logs/bambook-combined.log'
        })
    ]
});

// 生产环境移除 Console 输出
if (process.env.NODE_ENV === 'production') {
    logger.remove(logger.transports[0]);
}

/**
 * 创建带有 Trace ID 的子日志器
 */
export function createTraceLogger(traceId: string, component?: string) {
    return {
        info: (message: string, meta?: Record<string, any>) =>
            logger.info(message, { traceId, component, ...meta }),
        warn: (message: string, meta?: Record<string, any>) =>
            logger.warn(message, { traceId, component, ...meta }),
        error: (message: string, meta?: Record<string, any>) =>
            logger.error(message, { traceId, component, ...meta }),
        debug: (message: string, meta?: Record<string, any>) =>
            logger.debug(message, { traceId, component, ...meta })
    };
}

/**
 * 工具调用专用日志
 */
export function logToolExecution(
    traceId: string,
    toolName: string,
    status: 'start' | 'success' | 'error' | 'timeout',
    meta?: Record<string, any>
) {
    const emoji = {
        start: '🔧',
        success: '✅',
        error: '❌',
        timeout: '⏱️'
    }[status];

    logger.info(`${emoji} Tool [${toolName}] ${status}`, {
        traceId,
        component: 'TOOL',
        tool: toolName,
        status,
        ...meta
    });
}

export { logger };
export default logger;
