import { Type, type StructType } from './types.js';

function getFunctionParent(functionType: Type<'Function'>): Type<'Function'> | undefined {
  return functionType.extends?.kind === 'Function'
    ? (functionType.extends as Type<'Function'>)
    : undefined;
}

function getFunctionStructFromChain(
  functionType: Type<'Function'>,
  key: 'local' | 'self',
): StructType | undefined {
  let current: Type<'Function'> | undefined = functionType;
  while (current) {
    const struct = current[key];
    if (struct?.kind === 'Struct') {
      return struct as StructType;
    }
    current = getFunctionParent(current);
  }
  return;
}

function isConstructorFunction(functionType: Type<'Function'>): boolean {
  let current: Type<'Function'> | undefined = functionType;
  while (current) {
    if (current.isConstructor) {
      return true;
    }
    current = getFunctionParent(current);
  }
  return false;
}

export function getFunctionLocalScope(functionType: Type<'Function'>): StructType | undefined {
  return getFunctionStructFromChain(functionType, 'local');
}

/**
 * Returns the storage struct that holds static members for a function type.
 * Constructors store statics on their constructor self struct, while other
 * functions store statics in their function-local struct.
 */
export function getFunctionStaticStorage(functionType: Type<'Function'>): StructType | undefined {
  if (isConstructorFunction(functionType)) {
    return getFunctionStructFromChain(functionType, 'self');
  }
  return getFunctionLocalScope(functionType);
}

/**
 * Resolve the container where a `static` declaration should be written.
 * If we are not inside the owning function body, fall back to the current
 * local scope to avoid leaking static declarations to outer `self` contexts.
 */
export function getStaticDeclarationContainer(
  ownerFunction: Type<'Function'> | undefined,
  currentLocalScope: StructType,
): StructType {
  if (!ownerFunction) {
    return currentLocalScope;
  }
  const storage = getFunctionStaticStorage(ownerFunction);
  if (!storage) {
    return currentLocalScope;
  }
  const inOwningFunctionBody = getFunctionLocalScope(ownerFunction) === currentLocalScope;
  return inOwningFunctionBody ? storage : currentLocalScope;
}

/**
 * Build a struct view containing only static members from the input struct
 * and its parent chain.
 */
export function createStaticMembersView(struct: StructType | undefined): StructType | undefined {
  if (!struct) {
    return;
  }

  const staticView = new Type('Struct');
  let hasOwnStaticMembers = false;
  for (const member of struct.listMembers(true)) {
    if (!member.static) {
      continue;
    }
    staticView.addMember(member);
    hasOwnStaticMembers = true;
  }

  const parentStruct =
    struct.extends?.kind === 'Struct' ? (struct.extends as StructType) : undefined;
  const parentStaticView = createStaticMembersView(parentStruct);
  if (parentStaticView) {
    staticView.extends = parentStaticView;
  }

  if (!hasOwnStaticMembers && !parentStaticView) {
    return;
  }

  return staticView;
}

/**
 * Build a static-members-only struct view for a function.
 * Optionally uses a per-call WeakMap cache to avoid recomputing views.
 */
export function getFunctionStaticMembersView(
  functionType: Type<'Function'>,
  cache?: WeakMap<Type<'Function'>, StructType | undefined>,
): StructType | undefined {
  if (cache?.has(functionType)) {
    return cache.get(functionType);
  }

  const staticView = createStaticMembersView(getFunctionStaticStorage(functionType));
  cache?.set(functionType, staticView);
  return staticView;
}
