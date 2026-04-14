import winston from "winston";
import path from "node:path";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    if (stack) {
      return `${timestamp} ${level}: ${message}\n${stack}`;
    }
    return `${timestamp} ${level}: ${message}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  defaultMeta: { service: "hexnest-node" },
  transports: [
    new winston.transports.File({ 
      filename: "hexnest-error.log", 
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 3
    }),
    new winston.transports.File({ 
      filename: "hexnest.log",
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

// Polyfill for global console to use winston
export function setupGlobalLogger() {
  console.log = (...args: any[]) => logger.info(args.length === 1 ? args[0] : args);
  console.info = (...args: any[]) => logger.info(args.length === 1 ? args[0] : args);
  console.warn = (...args: any[]) => logger.warn(args.length === 1 ? args[0] : args);
  console.error = (...args: any[]) => logger.error(args.length === 1 ? args[0] : args);
}
