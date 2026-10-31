/**
 * Winston logger configuration for Backstage Agent
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

/**
 * Custom log format: timestamp - level: message
 */
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} - ${level}: ${message}`;
});

/**
 * Create and configure Winston logger
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      // Colour only on a terminal: the daemon's stdout is ~/.backstage-agent/logs/agent.log, which
      // must stay plain text for people reading or attaching it.
      format: process.stdout.isTTY
        ? combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat)
        : combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    }),
  ],
});

/**
 * Log levels: error, warn, info, http, verbose, debug, silly
 */
export default logger;
