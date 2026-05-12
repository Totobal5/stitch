import type { Signifier } from './signifiers.js';
import { prioritizeNonUndefinedTypes } from './types.checks.js';
import type { Type } from './types.js';
import { assert } from './util.js';

function typeMemberToHoverText(member: Signifier) {
  let code = member.name;
  if (member.optional) {
    code += '?';
  }
  code += ': ' + member.type.toFeatherString();
  return code;
}

function sortMembersForHover(a: Signifier, b: Signifier) {
  // underscore-prefixed should be sorted last
  const a_prefix_count = a.name?.match(/^_+/)?.[0]?.length || 0;
  const b_prefix_count = b.name?.match(/^_+/)?.[0]?.length || 0;
  if (a_prefix_count !== b_prefix_count) {
    return a_prefix_count - b_prefix_count;
  }
  return a.name?.toLocaleLowerCase?.().localeCompare(b.name?.toLocaleLowerCase?.());
}

function structMembersForHover(type: Type<'Struct'>, includeSynthetic = false) {
  const ownMembers = type
    .listMembers(true)
    .filter((x) => x.name !== 'self' && (includeSynthetic || !!x.def));
  const members = ownMembers.length
    ? ownMembers
    : type.listMembers().filter((x) => x.name !== 'self' && (includeSynthetic || !!x.def));
  return members.sort(sortMembersForHover);
}

function structToInlineHoverText(type: Type<'Struct'>): string | undefined {
  const members = structMembersForHover(type, true);
  if (!members.length) {
    return;
  }
  const maxMembers = 6;
  const parts: string[] = [];
  let i = 0;
  for (const member of members) {
    parts.push(typeMemberToHoverText(member));
    i++;
    if (i >= maxMembers) {
      break;
    }
  }
  const suffix = members.length > maxMembers ? ', ...' : '';
  return `{ ${parts.join(', ')}${suffix} }`;
}

function structToHoverCodeBlock(type: Type<'Struct'>, includeSynthetic = false) {
  const members = structMembersForHover(type, includeSynthetic);
  if (!members.length) {
    return;
  }
  let code = '```ts\n{\n';
  let i = 0;
  for (const member of members) {
    code += `  ${member.name}: ${member.type.toFeatherString()},\n`;
    i++;
    if (i > 19) {
      code += '  // ... and more!\n';
      break;
    }
  }
  code += '}\n```';
  return code;
}

function getNamedStructIdentity(type: Type<'Struct'>): Type<'Struct'> | undefined {
  let current: Type | undefined = type;
  while (current?.kind === 'Struct') {
    if (current.name) {
      return current as Type<'Struct'>;
    }
    current = current.extends;
  }
  return undefined;
}

function isAnonymousStructForHover(type: Type<'Struct'>) {
  return !getNamedStructIdentity(type);
}

function getPreferredFunctionReturnType(type: Type<'Function'>): Type | undefined {
  if (!type.returns?.type.length) {
    return undefined;
  }
  return prioritizeNonUndefinedTypes(type.returns.type)[0];
}

export function typeToHoverDetails(type: Type) {
  const lines: string[] = [];
  if (type.isFunction) {
    if (type.self) {
      lines.push(`*@self* \`${type.self.toFeatherString()}\``);
    }
    for (const param of type.listParameters()) {
      if (param?.def && param.description) {
        lines.push(`*@param* \`${param.name}\` - ${param.description}`);
      }
    }
    const preferredReturn = getPreferredFunctionReturnType(type as Type<'Function'>);
    if (preferredReturn?.kind === 'Struct') {
      const returnStruct = preferredReturn as Type<'Struct'>;
      const namedIdentity = getNamedStructIdentity(returnStruct);
      const returnLabel = namedIdentity?.toFeatherString() || 'Struct';
      lines.push(`*@returns* \`${returnLabel}\``);

      if (isAnonymousStructForHover(returnStruct)) {
        const code = structToHoverCodeBlock(returnStruct, true);
        if (code) {
          lines.push(code);
        }
      }
    }
  } else if (type.kind === 'Struct') {
    const code = structToHoverCodeBlock(type as Type<'Struct'>);
    if (code) {
      lines.push(code);
    }
  } else if (type.kind === 'Enum') {
    const members = type.listMembers().filter((x) => x.def);
    if (members.length) {
      let code = '```ts\n{\n';
      let i = 0;
      for (const member of members) {
        code += `  ${member.name},\n`;
        i++;
        if (i > 19) {
          code += '  // ... and more!\n';
          break;
        }
      }
      code += '}\n```';
      lines.push(code);
    }
  }
  return lines.join('\n\n');
}

export function typeToHoverText(type: Type) {
  let code = '';
  if (type.isFunction) {
    const functionName = type.name || type.signifier?.name || '';
    code = `function ${functionName}(`;
    const params = type.listParameters();
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      assert(param, 'Param is undefined');
      if (i > 0) {
        code += ', ';
      }
      code += typeMemberToHoverText(param);
    }
    code += ')';
    if (type.isConstructor) {
      code += ` constructor`;
    }
    const preferredReturn = getPreferredFunctionReturnType(type as Type<'Function'>);
    code += `: ${
      type.isConstructor
        ? type.self!.toFeatherString()
        : preferredReturn?.kind === 'Struct'
          ? (() => {
              const returnStruct = preferredReturn as Type<'Struct'>;
              if (isAnonymousStructForHover(returnStruct)) {
                return structToInlineHoverText(returnStruct) || type.returns!.toFeatherString();
              }
              return (
                getNamedStructIdentity(returnStruct)?.toFeatherString() ||
                type.returns!.toFeatherString()
              );
            })()
          : type.returns?.type.length
            ? type.returns.toFeatherString()
            : 'Undefined'
    }`;
  } else {
    code += type.toFeatherString();
  }
  return code;
}
