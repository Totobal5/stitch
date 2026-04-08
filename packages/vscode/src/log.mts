import { Pathy } from '@bscotch/pathy';
import vscode from 'vscode';

export async function showErrorMessage<T extends string>(message: string | Error, ...items: T[]) {
  return await vscode.window.showErrorMessage(
    typeof message === 'string' ? message : message.message,
    ...items,
  );
}

/**
 * Create a drop-in replacement for `console` that will
 * write to both STDI/O and to a VSCode output channel.
 */
export class Logger {
  static outputChannels = new Map<string, vscode.OutputChannel>();

  constructor(
    readonly channel: string,
    readonly prefix?: string,
  ) {
    if (!Logger.outputChannels.has(channel)) {
      Logger.outputChannels.set(channel, vscode.window.createOutputChannel(channel, 'stitch-logs'));
    }
  }

  withPrefix(prefix: string) {
    return new Logger(this.channel, prefix);
  }

  get output() {
    return Logger.outputChannels.get(this.channel)!;
  }

  protected emit(type: 'debug' | 'info' | 'warn' | 'error', ...args: any[]) {
    const timestamp = new Date().toISOString().replace(/^.*T(.*)Z$/, '$1');
    args = args.map((arg) => {
      const isObject = arg && typeof arg === 'object';
      if (isObject && 'uri' in arg && 'fsPath' in arg.uri) {
        // Then this is probably a text document
        // convert it to a URI
        arg = arg.uri;
      }
      if (isObject && 'fsPath' in arg) {
        // change arg to a pathy object
        arg = arg.fsPath;
      }
      if (isObject && arg instanceof Pathy) {
        // Log the path relative to the workspace root
        return arg.relativeFrom(vscode.workspace.workspaceFolders![0].uri.fsPath);
      }
      if (isObject && arg instanceof Error) {
        return stringifyError(arg, true);
      }
      return formatLogArg(arg);
    });
    const components = [type.toUpperCase(), timestamp];
    if (this.prefix) {
      components.push(`[${this.prefix}]`);
    }
    components.push(...args);
    this.output.appendLine(components.join(' '));
    console[type](this.channel, ...components);
  }

  log(...args: any[]) {
    this.emit('info', ...args);
  }

  debug(...args: any[]) {
    this.emit('debug', ...args);
  }

  info(...args: any[]) {
    this.emit('info', ...args);
  }

  warn(...args: any[]) {
    this.emit('warn', ...args);
  }

  error(...args: any[]) {
    this.emit('error', ...args);
  }

  dir(obj: any, options?: any) {
    this.output.appendLine(JSON.stringify(obj, null, 2));
    console.dir(obj, options);
  }
}

const maxLogArgLength = 280;

function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return truncateMiddle(arg, maxLogArgLength);
  }

  if (isTokenLikeArg(arg)) {
    const tokenType = typeof arg.tokenType?.name === 'string' ? arg.tokenType.name : 'Unknown';
    const image = typeof arg.image === 'string' ? arg.image : String(arg.image ?? '');
    const startLine = Number.isFinite(arg.startLine) ? arg.startLine : '?';
    const startColumn = Number.isFinite(arg.startColumn) ? arg.startColumn : '?';
    return `{ token: ${tokenType}, image: ${JSON.stringify(image)}, at: ${startLine}:${startColumn} }`;
  }

  if (arg && typeof arg === 'object') {
    try {
      return truncateMiddle(JSON.stringify(arg), maxLogArgLength);
    } catch {
      return '[Unserializable Object]';
    }
  }

  return String(arg);
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const partLength = Math.max(8, Math.floor((maxLength - 7) / 2));
  return `${value.slice(0, partLength)} ... ${value.slice(-partLength)}`;
}

function isTokenLikeArg(arg: unknown): arg is {
  image?: unknown;
  startLine?: number;
  startColumn?: number;
  tokenType?: { name?: unknown };
} {
  if (!arg || typeof arg !== 'object') {
    return false;
  }
  const tokenArg = arg as {
    image?: unknown;
    startLine?: unknown;
    startColumn?: unknown;
    tokenType?: { name?: unknown };
  };
  return (
    'image' in tokenArg &&
    'startLine' in tokenArg &&
    'startColumn' in tokenArg &&
    typeof tokenArg.tokenType?.name === 'string'
  );
}

export const logger = new Logger('Stitch');

export function info(...args: any[]) {
  logger.info(...args);
}

export function warn(...args: any[]) {
  logger.warn(...args);
}

export class Timer {
  start = Date.now();
  restart() {
    this.start = Date.now();
  }
  millis(message: string) {
    info(message, Date.now() - this.start, 'millis');
  }
  seconds(message: string) {
    info(message, (Date.now() - this.start) / 1000, 'seconds');
  }

  static start() {
    const timer = new Timer();
    return timer;
  }
}

function stringifyError(error: Error, includeStack = false, indent = 0) {
  const indentation = '  '.repeat(indent);
  const lines = [`${indentation}${indent === 0 ? 'ERROR' : 'CAUSE'}: ${error.message}`];
  if (includeStack && error.stack) {
    lines.push(...error.stack.split(/[\r\n]/).map((line) => `${indentation}${line}`));
  }
  if (error.cause && error.cause instanceof Error) {
    lines.push(stringifyError(error.cause, includeStack, indent + 1));
  }
  return lines.join('\n');
}

export function getErrorMessage(error: unknown): string {
  let combinedMessage = '';
  if (error instanceof Error) {
    if ('message' in error && typeof error.message === 'string' && error.message.length) {
      combinedMessage = error.message;
    }
    if ('cause' in error && error.cause instanceof Error) {
      const causeError = getErrorMessage(error.cause);
      if (combinedMessage && causeError) {
        combinedMessage += ` ← ${causeError}`;
      } else if (causeError) {
        combinedMessage = causeError;
      }
    }
  }
  return combinedMessage;
}
