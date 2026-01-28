import * as fs from 'fs';

const logFilePath = './mcp-snes.log';

// Ensure the log file exists
try {
  fs.appendFileSync(logFilePath, '');
} catch (err) {
  console.error('CRITICAL FAILURE: Failed to ensure log file exists:', err);
}

type LogLevel = 'INFO' | 'ERROR' | 'WARN' | 'DEBUG' | 'VERBOSE';

function writeLog(level: LogLevel, message: string, ...optionalParams: any[]) {
  const timestamp = new Date().toISOString();
  let logEntry = `${timestamp} [${level}] ${message}`;

  if (optionalParams.length > 0) {
    const formattedParams = optionalParams.map(param => {
      if (level === 'VERBOSE' && typeof param === 'object' && param !== null) {
        try {
          return JSON.stringify(param);
        } catch (e) {
          return '[Unserializable Object]';
        }
      } else if (typeof param === 'object' && param !== null) {
        return param instanceof Error ? param.stack || param.message : JSON.stringify(param);
      } else {
        return String(param);
      }
    });
    logEntry += ` ${formattedParams.join(' ')}`;
  }

  logEntry += '\n';

  try {
    fs.appendFileSync(logFilePath, logEntry);
  } catch (err) {
    console.error(`Failed to write to log file: ${logFilePath}`, err);
  }
}

export const log = {
  info: (message: string, ...optionalParams: any[]) => {
    writeLog('INFO', message, ...optionalParams);
  },
  error: (message: string, ...optionalParams: any[]) => {
    console.error(message);
    writeLog('ERROR', message, ...optionalParams);
  },
  warn: (message: string, ...optionalParams: any[]) => {
    writeLog('WARN', message, ...optionalParams);
  },
  debug: (message: string, ...optionalParams: any[]) => {
    writeLog('DEBUG', message, ...optionalParams);
  },
  verbose: (message: string, ...optionalParams: any[]) => {
    writeLog('VERBOSE', message, ...optionalParams);
  }
};
