interface ParseDepthState {
  parens: number;
  angles: number;
  squares: number;
  curlies: number;
}

function updateParseDepthState(state: ParseDepthState, char: string) {
  if (char === '(') state.parens++;
  if (char === ')') state.parens = Math.max(0, state.parens - 1);
  if (char === '<') state.angles++;
  if (char === '>') state.angles = Math.max(0, state.angles - 1);
  if (char === '[') state.squares++;
  if (char === ']') state.squares = Math.max(0, state.squares - 1);
  if (char === '{') state.curlies++;
  if (char === '}') state.curlies = Math.max(0, state.curlies - 1);
}

function parseDepthIsTopLevel(state: ParseDepthState) {
  return state.parens === 0 && state.angles === 0 && state.squares === 0 && state.curlies === 0;
}

export function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  const state: ParseDepthState = {
    parens: 0,
    angles: 0,
    squares: 0,
    curlies: 0,
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    updateParseDepthState(state, char);

    if (char === separator && parseDepthIsTopLevel(state)) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

export function findTopLevelSeparator(input: string, separator: string): number {
  const state: ParseDepthState = {
    parens: 0,
    angles: 0,
    squares: 0,
    curlies: 0,
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    updateParseDepthState(state, char);
    if (char === separator && parseDepthIsTopLevel(state)) {
      return i;
    }
  }

  return -1;
}
