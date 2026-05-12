import { expect } from 'chai';
import { replaceGenerics, updateGenericsMap } from './types.checks.js';
import { KnownTypesMap, typeFromFeatherString } from './types.feather.js';
import { Type, TypeStore } from './types.js';

describe('Types', function () {
  it('can parse function signature feather types', function () {
    const knownTypes: KnownTypesMap = new Map();
    const parsed = typeFromFeatherString(
      'Function(state: String, time: Real, values: Array<Real>): Bool',
      knownTypes,
      false,
    );
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0].kind).to.equal('Function');

    const fn = parsed[0];
    const params = fn.listParameters();
    expect(params).to.have.lengthOf(3);
    expect(params[0]!.name).to.equal('state');
    expect(params[0]!.type.toFeatherString()).to.equal('String');
    expect(params[1]!.name).to.equal('time');
    expect(params[1]!.type.toFeatherString()).to.equal('Real');
    expect(params[2]!.name).to.equal('values');
    expect(params[2]!.type.toFeatherString()).to.equal('Array<Real>');
    expect(fn.returns?.toFeatherString()).to.equal('Bool');
  });

  it('can parse unnamed function signature parameter types', function () {
    const knownTypes: KnownTypesMap = new Map();
    const parsed = typeFromFeatherString('Function(Real, String): Bool', knownTypes, false);
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0].kind).to.equal('Function');

    const fn = parsed[0];
    const params = fn.listParameters();
    expect(params).to.have.lengthOf(2);
    expect(params[0]!.name).to.equal('arg0');
    expect(params[0]!.type.toFeatherString()).to.equal('Real');
    expect(params[1]!.name).to.equal('arg1');
    expect(params[1]!.type.toFeatherString()).to.equal('String');
    expect(fn.returns?.toFeatherString()).to.equal('Bool');
  });

  it('can parse bare custom underscored type names as Structs', function () {
    const knownTypes: KnownTypesMap = new Map();
    const parsed = typeFromFeatherString('__scribble_class_element', knownTypes, false);
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0].kind).to.equal('Struct');
    expect(parsed[0].name).to.equal('__scribble_class_element');
  });

  it('can resolve extended name-expression identifiers', function () {
    const knownTypes: KnownTypesMap = new Map();
    const parsed = typeFromFeatherString('module:service/Type#member~inner', knownTypes, false);
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0].kind).to.equal('Struct');
    expect(parsed[0].name).to.equal('module:service/Type#member~inner');
  });

  it('maps record types to struct members with typed properties', function () {
    const knownTypes: KnownTypesMap = new Map();
    const parsed = typeFromFeatherString(
      '{persistent: Bool, cleared: Bool, tags: Array<String>}',
      knownTypes,
      false,
    );
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0].kind).to.equal('Struct');

    const persistent = parsed[0].getMember('persistent', true);
    const cleared = parsed[0].getMember('cleared', true);
    const tags = parsed[0].getMember('tags', true);

    expect(persistent?.type.toFeatherString()).to.equal('Bool');
    expect(cleared?.type.toFeatherString()).to.equal('Bool');
    expect(tags?.type.toFeatherString()).to.equal('Array<String>');
    expect(persistent?.def).to.exist;
    expect(cleared?.def).to.exist;
    expect(tags?.def).to.exist;
  });

  it('can resursively resolve generic types', function () {
    const genericType = new Type('Any').named('T').genericize();
    const generics = [{ T: [genericType] }];
    const toType = (s: string) => typeFromFeatherString(s, generics, false);

    const knownTypes: KnownTypesMap = new Map();

    let resolved = updateGenericsMap(genericType, new Type('String'), knownTypes);
    expect(resolved.get('T')!.type[0].kind).to.equal('String');

    resolved = updateGenericsMap(toType('Array<T>'), new Type('String'), knownTypes);
    expect(resolved.get('T')).to.be.undefined;

    resolved = updateGenericsMap(toType('Array<T>'), toType('Array<String>'), knownTypes);
    expect(resolved.get('T')!.type[0].kind).to.equal('String');

    resolved = updateGenericsMap(toType('Array<T>'), toType('Array<Struct<String>>'), knownTypes);
    expect(resolved.get('T')!.type[0].kind).to.equal('Struct');
    expect(resolved.get('T')!.type[0].items!.type[0].kind).to.equal('String');

    // For cases with mixed types, this should still all work!
    resolved = updateGenericsMap(
      toType('Real|Array<T>|Struct<Array<T>>'),
      toType('Real|Struct<String>|Array<Id.DsMap>|Struct<Array<Id.Instance>>'),
      knownTypes,
    );
    const resolvedTypes = resolved.get('T')!.type;
    expect(resolvedTypes.length).to.equal(2);
    expect(resolvedTypes[0].kind).to.equal('Id.DsMap');
    expect(resolvedTypes[1].kind).to.equal('Id.Instance');

    // Make sure we can substitue generics
    const replaced = replaceGenerics(
      toType('Real|Array<T>|Struct<Array<T>>|ObjectType<Id.Instance>'),
      knownTypes,
      resolved,
    );
    expect(replaced.type[0].kind).to.equal('Real');
    expect(replaced.type[1].kind).to.equal('Array');
    expect(replaced.type[1].items!.type[0].kind).to.equal('Id.DsMap');
    expect(replaced.type[1].items!.type[1].kind).to.equal('Id.Instance');
    expect(replaced.type[2].kind).to.equal('Struct');
    expect(replaced.type[2].items!.type[0].kind).to.equal('Array');
    expect(replaced.type[2].items!.type[0].items!.type[0].kind).to.equal('Id.DsMap');
    expect(replaced.type[2].items!.type[0].items!.type[1].kind).to.equal('Id.Instance');
  });

  it('can check whether one simple type satisfies another', function () {
    const string = new Type('String');
    expect(string.narrows(new Type('String'))).to.be.true;
    expect(string.narrows(new Type('Real'))).to.be.false;

    const union = new TypeStore();
    union.type = [new Type('String'), new Type('Real')];
    expect(string.narrows(union)).to.be.true;
    expect(union.narrows(string)).to.be.false;
  });

  it('can check whether one struct type satisfies another', function () {
    const broadStruct = new Type('Struct');
    const narrowStruct = new Type('Struct');

    for (const struct of [broadStruct, narrowStruct]) {
      struct.addMember('name', { type: new Type('String') });
      struct.addMember('id', { type: new Type('Real') });
    }

    // They are the same at the moment, so should be true both ways
    expect(narrowStruct.narrows(broadStruct)).to.be.true;
    expect(broadStruct.narrows(narrowStruct)).to.be.true;

    // Now making the narrow struct more specific
    narrowStruct.addMember('specialty', { type: new Type('String') });
    expect(narrowStruct.narrows(broadStruct)).to.be.true;
    expect(broadStruct.narrows(narrowStruct)).to.be.false;
  });

  it('renders anonymous struct return shapes in function hover text', function () {
    const fn = new Type('Function').named('enemy_list_room_effective_config');
    const returnStruct = new Type('Struct');
    returnStruct.addMember('persistent', { type: new Type('Bool') });
    returnStruct.addMember('cleared', { type: new Type('Bool') });
    fn.setReturnType(returnStruct);

    expect(fn.code).to.equal(
      'function enemy_list_room_effective_config(): { cleared: Bool, persistent: Bool }',
    );
    expect(fn.details).to.include('*@returns* `Struct`');
    expect(fn.details).to.include('persistent: Bool');
    expect(fn.details).to.include('cleared: Bool');
  });

  it('prioritizes struct hover rendering for Struct|Undefined function returns', function () {
    const fn = new Type('Function').named('runner_next');
    const returnStruct = new Type('Struct');
    returnStruct.addMember('commands', { type: new Type('Array') });
    returnStruct.addMember('labels', { type: new Type('Struct') });
    fn.setReturnType([returnStruct, new Type('Undefined')]);

    expect(fn.code).to.equal('function runner_next(): { commands: Array, labels: Struct }');
    expect(fn.details).to.include('*@returns* `Struct`');
    expect(fn.details).to.include('commands: Array');
    expect(fn.details).to.include('labels: Struct');
  });

  it('keeps named struct return rendering compact in function hover text', function () {
    const fn = new Type('Function').named('factory');
    const namedStruct = new Type('Struct').named('EnemyConfig');
    namedStruct.addMember('persistent', { type: new Type('Bool') });
    fn.setReturnType(namedStruct);

    expect(fn.code).to.equal('function factory(): Struct.EnemyConfig');
    expect(fn.details).to.include('*@returns* `Struct.EnemyConfig`');
    expect(fn.details).to.not.include('persistent: Bool');
  });

  it('keeps derived named struct return rendering compact in function hover text', function () {
    const fn = new Type('Function').named('factory2');
    const namedStruct = new Type('Struct').named('VSRunner');
    namedStruct.addMember('Break', { type: new Type('Function') });
    const derived = namedStruct.derive();
    fn.setReturnType(derived);

    expect(fn.code).to.equal('function factory2(): Struct.VSRunner');
    expect(fn.details).to.include('*@returns* `Struct.VSRunner`');
    expect(fn.details).to.not.include('Break: Function');
  });

  it('renders inherited struct members in hover details', function () {
    const baseStruct = new Type('Struct').named('BaseStruct');
    const persistent = baseStruct.addMember('persistent', { type: new Type('Bool') });
    const cleared = baseStruct.addMember('cleared', { type: new Type('Bool') });
    persistent!.def = {};
    cleared!.def = {};

    const derivedStruct = baseStruct.derive();
    const details = derivedStruct.details;

    expect(details).to.include('persistent: Bool');
    expect(details).to.include('cleared: Bool');
  });

  it('uses signifier name in function hover text when function type name is missing', function () {
    const container = new Type('Struct').named('Container');
    const member = container.addMember('Runner', { type: new Type('Function') });
    expect(member).to.exist;
    const fn = member!.getTypeByKind('Function');
    expect(fn).to.exist;
    fn!.signifier = member!;
    fn!.setReturnType(new Type('Bool'));

    expect(fn!.code).to.equal('function Runner(): Bool');
  });
});
