import { Code, JsdocSummary, Signifier, primitiveNames } from '@bscotch/gml-parser';
import vscode, { CancellationToken, CompletionContext } from 'vscode';
import { stitchConfig } from './config.mjs';
import type { StitchWorkspace } from './extension.workspace.mjs';
import { logger } from './log.mjs';

const identifierCompletionTriggerCharacters = [
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  '_',
];

export const completionTriggerCharacters = [
  '.',
  '{',
  '<',
  '|',
  ...identifierCompletionTriggerCharacters,
];

export class StitchCompletionProvider implements vscode.CompletionItemProvider {
  constructor(readonly provider: StitchWorkspace) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: CancellationToken,
    context: CompletionContext,
  ): Promise<vscode.CompletionItem[] | undefined> {
    try {
      // If we're already processing this file, wait briefly for fresher symbols,
      // but don't block completions long enough for VS Code to cancel them.
      const pendingProcessing = this.provider.processingFiles.get(document.uri.fsPath);
      if (pendingProcessing) {
        const maxWaitMs = Math.max(25, stitchConfig.reprocessOnTypeDelay);
        await Promise.race([
          pendingProcessing.catch(() => undefined),
          new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, maxWaitMs);
            token.onCancellationRequested(() => {
              clearTimeout(timeout);
              resolve();
            });
          }),
        ]);
      }
      if (token.isCancellationRequested) {
        return undefined;
      }

      const gmlFile = this.provider.getGmlFile(document);
      const offset = document.offsetAt(position);
      if (!gmlFile) {
        return undefined;
      }
      // Are we inside a JSDoc comment?
      const jsdoc = gmlFile.getJsdocAt(offset);
      if (jsdoc) {
        return jsdocCompletions(document, position, gmlFile, jsdoc, offset);
      } else if (context.triggerCharacter === '.' || !context.triggerCharacter) {
        // Are we in a StructNewMember range?
        const inStruct = gmlFile.getStructNewMemberRangeAt(offset);
        const scopeRange = gmlFile.getScopeRangeAt(offset);
        if (inStruct) {
          return inScopeSymbolsToCompletions(
            document,
            position,
            gmlFile,
            inStruct.type.listMembers(),
            scopeRange,
          );
        }
        const items = gmlFile.getInScopeSymbolsAt(offset);
        return inScopeSymbolsToCompletions(document, position, gmlFile, items, scopeRange);
      }
      return undefined;
    } catch (err) {
      logger.error('Completion provider failed', err);
      return undefined;
    }
  }

  static register(provider: StitchWorkspace) {
    return vscode.languages.registerCompletionItemProvider(
      { language: 'gml', scheme: 'file' },
      new StitchCompletionProvider(provider),
      ...completionTriggerCharacters,
    );
  }
}

export function jsdocCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  file: Code,
  jsdoc: JsdocSummary,
  offset: number,
): vscode.CompletionItem[] {
  const constructors = jsdocStructConstructorCompletions(document, position, file, jsdoc, offset);
  if (constructors.length) {
    return constructors;
  }

  // Fallback: all known types.
  const completions: vscode.CompletionItem[] = [];
  const typeNames = new Set<string>(file.project.types.keys());
  for (const primitiveName of primitiveNames) {
    typeNames.add(primitiveName);
  }
  for (const type of typeNames) {
    const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Interface);
    completions.push(item);
  }
  return completions;
}

function jsdocStructConstructorCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  file: Code,
  jsdoc: JsdocSummary,
  offset: number,
): vscode.CompletionItem[] {
  const fullText = document.getText();
  const textBeforeCursor = fullText.slice(jsdoc.start.offset, offset);
  const structAccess = /Struct\.([a-zA-Z0-9_]*)$/i.exec(textBeforeCursor);
  if (!structAccess) {
    return [];
  }

  // Keep this scoped to a type expression block `{ ... }`.
  const lastOpenBrace = textBeforeCursor.lastIndexOf('{');
  const lastCloseBrace = textBeforeCursor.lastIndexOf('}');
  const accessStart = structAccess.index;
  const inTypeBlock = lastOpenBrace > lastCloseBrace && accessStart >= lastOpenBrace;
  if (!inTypeBlock) {
    return [];
  }

  const query = structAccess[1] || '';
  const rankedConstructors = [...file.project.types.entries()]
    .filter(([typeName, type]) => {
      if (!typeName.startsWith('Struct.')) {
        return false;
      }
      return !!type.signifier?.getTypeByKind('Function')?.isConstructor;
    })
    .map(([typeName]) => {
      const name = typeName.slice('Struct.'.length);
      const score = fuzzyMatchScore(name, query);
      return { name, score };
    })
    .filter(({ score }) => !query || score !== undefined)
    .sort((a, b) => {
      if ((a.score ?? 0) !== (b.score ?? 0)) {
        return (b.score ?? 0) - (a.score ?? 0);
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  const queryStart = position.translate(0, -query.length);
  const queryRange = new vscode.Range(queryStart, position);

  return rankedConstructors.map(({ name: constructorName, score }, index) => {
    const item = new vscode.CompletionItem(constructorName, vscode.CompletionItemKind.Constructor);
    item.detail = `Struct.${constructorName}`;
    item.filterText = `Struct.${constructorName}`;
    item.insertText = constructorName;
    item.range = queryRange;
    const cappedScore = Math.max(0, Math.min(99_999, score ?? 0));
    const invertedScore = String(99_999 - cappedScore).padStart(5, '0');
    item.sortText = `${invertedScore}-${constructorName.toLocaleLowerCase()}-${String(index).padStart(5, '0')}`;
    return item;
  });
}

export function inScopeSymbolsToCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  file: Code,
  items: Signifier[],
  scopeRange?: ReturnType<Code['getScopeRangeAt']>,
): vscode.CompletionItem[] {
  const query = extractCompletionQuery(document, position);
  const ranked = rankCompletionCandidates(document, file, items, query, scopeRange);
  const completions: vscode.CompletionItem[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const { signifier, priority, score } = ranked[i];
    const item = new vscode.CompletionItem(signifier.name!, vscode.CompletionItemKind.Constant);
    item.detail = inferDetails(signifier);
    item.kind = inferVscodeKind(signifier);
    item.filterText = signifier.name;
    item.sortText = completionSortText(priority, score, signifier.name!, i);

    completions.push(item);
  }
  completions.push(...constructorSuperCompletions(scopeRange, query));
  return completions;
}

interface ConstructorStaticAncestorChain {
  depth: number;
  label: string;
  expression: string;
  struct: Signifier['parent'];
}

function buildStaticGetChain(totalCalls: number) {
  let expression = 'self';
  for (let i = 0; i < totalCalls; i++) {
    expression = `static_get(${expression})`;
  }
  return expression;
}

function constructorStaticAncestorChains(
  scopeRange?: ReturnType<Code['getScopeRangeAt']>,
): ConstructorStaticAncestorChain[] {
  const self = scopeRange?.self;
  if (!self || self.kind !== 'Struct') {
    return [];
  }
  const currentFunction = self.signifier?.getTypeByKind('Function');
  if (!currentFunction?.isConstructor) {
    return [];
  }

  const chains: ConstructorStaticAncestorChain[] = [];
  let ancestor = self.extends;
  let depth = 1;
  while (ancestor?.kind === 'Struct') {
    chains.push({
      depth,
      label: Array(depth).fill('super').join('.'),
      expression: buildStaticGetChain(depth + 1),
      struct: ancestor,
    });
    ancestor = ancestor.extends;
    depth++;
  }

  return chains;
}

function maxFuzzyScore(candidates: string[], query: string): number | undefined {
  let maxScore: number | undefined;
  for (const candidate of candidates) {
    const score = fuzzyMatchScore(candidate, query);
    if (score === undefined) {
      continue;
    }
    if (maxScore === undefined || score > maxScore) {
      maxScore = score;
    }
  }
  return maxScore;
}

function superCompletionSortText(depth: number, score: number, name: string, index: number) {
  const cappedScore = Math.max(0, Math.min(99_999, score));
  const invertedScore = String(99_999 - cappedScore).padStart(5, '0');
  const depthOrder = String(depth).padStart(2, '0');
  const tieBreaker = String(index).padStart(5, '0');
  // `0z` sorts after normal in-scope (`0-...`) and before globals (`1-...`).
  return `0z-${depthOrder}-${invertedScore}-${name.toLocaleLowerCase()}-${tieBreaker}`;
}

function constructorSuperCompletions(
  scopeRange: ReturnType<Code['getScopeRangeAt']> | undefined,
  query: string,
): vscode.CompletionItem[] {
  const chains = constructorStaticAncestorChains(scopeRange);
  if (!chains.length) {
    return [];
  }

  const completions: vscode.CompletionItem[] = [];
  const dedup = new Set<string>();
  let completionIndex = 0;

  for (const chain of chains) {
    const chainScore = maxFuzzyScore([chain.label], query);
    if (!query || chainScore !== undefined) {
      const chainItem = new vscode.CompletionItem(chain.label, vscode.CompletionItemKind.Snippet);
      chainItem.detail = `Parent static chain (${chain.label})`;
      chainItem.insertText = new vscode.SnippetString(`${chain.expression}.$0`);
      chainItem.filterText = chain.label;
      chainItem.sortText = superCompletionSortText(
        chain.depth,
        chainScore ?? 0,
        chain.label,
        completionIndex++,
      );
      completions.push(chainItem);
      dedup.add(chain.label.toLocaleLowerCase());
    }

    for (const parentMember of chain.struct.listMembers(true)) {
      if (!parentMember.name || parentMember.ignored) {
        continue;
      }
      const memberLabel = `${chain.label}.${parentMember.name}`;
      const dedupKey = memberLabel.toLocaleLowerCase();
      if (dedup.has(dedupKey)) {
        continue;
      }

      const score = maxFuzzyScore(
        [memberLabel, parentMember.name, `${chain.label}${parentMember.name}`],
        query,
      );
      if (query && score === undefined) {
        continue;
      }

      const memberItem = new vscode.CompletionItem(memberLabel, inferVscodeKind(parentMember));
      memberItem.detail = `Parent static member (${chain.label})`;
      memberItem.filterText = `${memberLabel} ${parentMember.name}`;
      const isFunction = !!parentMember.getTypeByKind('Function');
      memberItem.insertText = new vscode.SnippetString(
        isFunction
          ? `${chain.expression}.${parentMember.name}($0)`
          : `${chain.expression}.${parentMember.name}$0`,
      );
      memberItem.sortText = superCompletionSortText(
        chain.depth,
        score ?? 0,
        memberLabel,
        completionIndex++,
      );
      completions.push(memberItem);
      dedup.add(dedupKey);
    }
  }

  return completions;
}

function extractCompletionQuery(document: vscode.TextDocument, position: vscode.Position) {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  return linePrefix.match(/([a-zA-Z0-9_$#~:/-]+)$/)?.[1] || '';
}

function rankCompletionCandidates(
  document: vscode.TextDocument,
  file: Code,
  items: Signifier[],
  query: string,
  scopeRange?: ReturnType<Code['getScopeRangeAt']>,
) {
  const ranked: {
    signifier: Signifier;
    priority: number;
    score: number;
  }[] = [];

  for (const signifier of items) {
    if (!signifier.name) {
      continue;
    }
    if (signifier.ignored) {
      continue;
    }

    const location = signifier.def;
    const ignoredPrefix = stitchConfig.autocompleteIgnoredPrefix;
    const shouldHideByPrefix =
      ignoredPrefix &&
      signifier.name.startsWith(ignoredPrefix) &&
      location?.file &&
      location.file.path.equals(document.uri.fsPath);
    if (shouldHideByPrefix) {
      continue;
    }

    const fuzzyScore = fuzzyMatchScore(signifier.name, query);
    if (query && fuzzyScore === undefined) {
      continue;
    }

    ranked.push({
      signifier,
      priority: completionPriority(signifier, file, scopeRange),
      score: fuzzyScore ?? 0,
    });
  }

  ranked.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return a.signifier.name.localeCompare(b.signifier.name, undefined, { sensitivity: 'base' });
  });

  return ranked;
}

function completionPriority(
  signifier: Signifier,
  file: Code,
  scopeRange?: ReturnType<Code['getScopeRangeAt']>,
) {
  const globalSelf = file.project.self;
  const isGlobal = signifier.parent === globalSelf || signifier.global || !!signifier.native;
  const isFunction = !!signifier.getTypeByKind('Function');
  const isMacro = signifier.macro;
  const isEnum = !!signifier.getTypeByKind('Enum') || signifier.enum || signifier.enumMember;

  const localOwned = scopeRange?.local?.getMember(signifier.name, true);
  const selfOwned = scopeRange?.self?.getMember(signifier.name, true);
  const inCurrentScope =
    !!(localOwned && localOwned === signifier) ||
    !!(scopeRange?.self !== globalSelf && selfOwned && selfOwned === signifier) ||
    signifier.local ||
    signifier.parameter;

  if (inCurrentScope) {
    return 0;
  }

  if (isGlobal && isFunction) {
    return 1;
  }
  if (isGlobal && isMacro) {
    return 2;
  }
  if (isGlobal && isEnum) {
    return 3;
  }

  return 4;
}

function fuzzyMatchScore(candidate: string, query: string): number | undefined {
  if (!query) {
    return 0;
  }

  const source = candidate.toLocaleLowerCase();
  const target = query.toLocaleLowerCase();

  if (source === target) {
    return 10_000;
  }
  if (source.startsWith(target)) {
    return 9_000 - (source.length - target.length);
  }

  const containsIndex = source.indexOf(target);
  if (containsIndex >= 0) {
    return 8_000 - containsIndex * 10 - (source.length - target.length);
  }

  let firstMatch = -1;
  let prev = -1;
  let gapPenalty = 0;
  for (const char of target) {
    const idx = source.indexOf(char, prev + 1);
    if (idx < 0) {
      return undefined;
    }
    if (firstMatch < 0) {
      firstMatch = idx;
    }
    if (prev >= 0) {
      gapPenalty += idx - prev - 1;
    }
    prev = idx;
  }

  return 7_000 - gapPenalty * 25 - firstMatch * 10 - (source.length - target.length);
}

function completionSortText(priority: number, score: number, name: string, index: number) {
  const cappedScore = Math.max(0, Math.min(99_999, score));
  const invertedScore = String(99_999 - cappedScore).padStart(5, '0');
  const tieBreaker = String(index).padStart(5, '0');
  return `${priority}-${invertedScore}-${name.toLocaleLowerCase()}-${tieBreaker}`;
}

function inferDetails(signifier: Signifier): string | undefined {
  const details: string[] = [signifier.type.toFeatherString()];
  if (signifier.native) {
    details.push('native');
  }
  if (signifier.global) {
    details.push('global');
  }
  if (signifier.local) {
    details.push('local');
  }
  if (signifier.parameter) {
    details.push('parameter');
  }
  if (details.length) {
    return details.join(' ');
  }
  return;
}

function inferVscodeKind(signifier: Signifier): vscode.CompletionItemKind {
  if (signifier.getTypeByKind('Enum')) {
    return vscode.CompletionItemKind.Enum;
  }
  const functionType = signifier.getTypeByKind('Function');
  if (functionType?.isConstructor) {
    return vscode.CompletionItemKind.Constructor;
  } else if (functionType) {
    return vscode.CompletionItemKind.Function;
  }
  return vscode.CompletionItemKind.Variable;
}
