import { expect } from 'chai';
import { pathy } from '@bscotch/pathy';
import { logger } from './logger.js';
import type { Asset } from './project.asset.js';
import { Project } from './project.js';
import { Native } from './project.native.js';
import { Signifier } from './signifiers.js';
import { resetSandbox } from './test.lib.js';
import { Type, TypeStore } from './types.js';
import type { PrimitiveName } from './types.primitives.js';
import { assert, ok } from './util.js';

describe('Project', function () {
  it('can load the GML spec', async function () {
    const spec = await Native.from(undefined, new Type('Struct'), new Map());
    expect(spec).to.exist;

    // STRUCTS AND CONSTS
    const track = spec.types.get('Struct.Track');
    ok(track);
    ok(track.kind === 'Struct');

    const name = track.getMember('name');
    ok(name);
    expect(name.type.kind).to.equal('String');

    const visible = track.getMember('visible');
    ok(visible);
    expect(visible.type.kind).to.equal('Bool');

    const tracks = track.getMember('tracks');
    ok(tracks);
    expect(tracks.type.kind).to.equal('Array');
    expect(tracks.type.items[0].kind).to.equal('Struct');
    expect(tracks.type.items[0].type[0]).to.eql(track);

    const keyframes = track.getMember('keyframes');
    ok(keyframes);
    expect(keyframes.type.kind).to.equal('Array');
    expect(keyframes.type.items[0].kind).to.equal('Struct');
    expect(keyframes.type.items[0].type[0]).to.eql(spec.types.get('Struct.Keyframe'));

    const typeField = track.getMember('type');
    ok(typeField);
    const expectedTypeType = spec.types.get('Constant.SequenceTrackType');
    ok(expectedTypeType);
    ok(typeField.type.type[0] === expectedTypeType);
    ok(expectedTypeType.kind === 'Real');

    // VARIABLES
    const depthSymbol = spec.globalSelf.getMember('depth');
    ok(depthSymbol);
    expect(depthSymbol.type.kind).to.equal('Real');

    // FUNCTIONS
    const scriptExecuteType = spec.types.get('Function.script_execute');
    const scriptExecuteSymbol = spec.globalSelf.getMember('script_execute');
    ok(scriptExecuteSymbol);
    ok(scriptExecuteSymbol.type.type[0] === scriptExecuteType);
    ok(scriptExecuteType);
    ok(scriptExecuteType.kind === 'Function');
    expect(scriptExecuteType.listParameters()).to.have.lengthOf(2);
    expect(scriptExecuteType.listParameters()![0]!.name).to.equal('scr');
    expect(scriptExecuteType.listParameters()![0]!.type.type).to.have.lengthOf(2);
    expect(scriptExecuteType.listParameters()![0]!.type.type[0].kind).to.equal('Function');
    expect(scriptExecuteType.listParameters()![0]!.type.type[1].kind).to.equal('Asset.GMScript');
    expect(scriptExecuteType.listParameters()![1]!.name).to.equal('...');
  });

  it('can use fallback GmlSpec', async function () {
    await Project.fallbackGmlSpecPath.exists({ assert: true });
  });

  it('can find a gml file by absolute path', async function () {
    const project = await Project.initialize('samples/project');
    const absolutePath = pathy(project.dir.join('objects/o_object/Create_0.gml').absolute);
    const gml = project.getGmlFile(absolutePath);
    ok(gml);
    expect(gml.path.absolute.toLocaleLowerCase()).to.equal(
      absolutePath.absolute.toLocaleLowerCase(),
    );
  });

  it('can find room and instance creation code by absolute path', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');

    const roomCreationCodePath = pathy(
      project.dir.join('rooms/r_CH1_colegio_1/RoomCreationCode.gml').absolute,
    );
    const roomCreationCode = project.getGmlFile(roomCreationCodePath);
    ok(roomCreationCode, 'Expected RoomCreationCode to be indexed');

    const instanceCreationCodePath = pathy(
      project.dir.join('rooms/r_CH1_colegio_1/InstanceCreationCode_inst_59621245.gml').absolute,
    );
    const instanceCreationCode = project.getGmlFile(instanceCreationCodePath);
    ok(instanceCreationCode, 'Expected InstanceCreationCode to be indexed');
  });

  it('resolves instance creation code variables against the instance object scope', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const room = project.getAssetByName('r_CH1_colegio_1');
    ok(room && room.assetKind === 'rooms');

    const instanceId = 'inst_59621245';

    const instanceCreationCodePath = pathy(
      project.dir.join(`rooms/r_CH1_colegio_1/InstanceCreationCode_${instanceId}.gml`).absolute,
    );
    const instanceCreationCode = project.getGmlFile(instanceCreationCodePath);
    ok(instanceCreationCode, 'Expected InstanceCreationCode to be indexed');
    const expectedSelf = room.getSelfForGmlFile(instanceCreationCodePath);
    ok(expectedSelf, `Expected room instance ${instanceId} to resolve an object scope`);
    ok(
      instanceCreationCode.scopes[0]?.self === expectedSelf,
      'Expected InstanceCreationCode root scope to use the instance object scope',
    );

    const xOffset = instanceCreationCode.content.indexOf('x = 140;');
    ok(xOffset >= 0, 'Expected sample assignment to x in InstanceCreationCode');
    const inScope = instanceCreationCode.getInScopeSymbolsAt(1, 1);
    ok(
      inScope.find((symbol) => symbol.name === 'x'),
      'Expected x to be in scope in InstanceCreationCode',
    );
  });

  it('implicitly inherits parent Create variables when child has no Create event', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const child = project.getAssetByName('o_fx_fade_gui_begin');
    const parent = project.getAssetByName('o_fx_fade_gui');
    ok(child && child.assetKind === 'objects');
    ok(parent && parent.assetKind === 'objects');

    const childAsset = child as Asset<'objects'>;
    expect(childAsset.gmlFilesArray.some((f) => f.name === 'Create_0')).to.equal(false);

    const draw = childAsset.gmlFilesArray.find((f) => f.name === 'Draw_74');
    ok(draw, 'Expected Draw_74 event to exist for o_fx_fade_gui_begin');

    const spriteOffset = draw!.content.indexOf('sprite != noone');
    ok(spriteOffset >= 0, 'Could not find sprite usage in Draw_74');
    const spriteRef = draw!.getReferenceAt(spriteOffset + 1);
    ok(spriteRef, 'Expected sprite reference in Draw_74 to resolve');
    expect(spriteRef!.item.name).to.equal('sprite');

    const alphaOffset = draw!.content.indexOf('alpha);');
    ok(alphaOffset >= 0, 'Could not find alpha usage in Draw_74');
    const alphaRef = draw!.getReferenceAt(alphaOffset + 1);
    ok(alphaRef, 'Expected alpha reference in Draw_74 to resolve');
    expect(alphaRef!.item.name).to.equal('alpha');

    const parentVariables = (parent as Asset<'objects'>).variables;
    ok(parentVariables, 'Expected parent object variables to exist');
    expect(spriteRef!.item).to.equal(parentVariables!.getMember('sprite'));
    expect(alphaRef!.item).to.equal(parentVariables!.getMember('alpha'));

    const undeclaredDiagnostics = draw!.getDiagnostics().UNDECLARED_VARIABLE_REFERENCE;
    expect(undeclaredDiagnostics).to.have.lengthOf(0);
  });

  it('resolves @returns {self} to the constructor self type', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const runner = project.getAssetByName('crispy_Runner');
    ok(runner && runner.assetKind === 'scripts');

    const runnerFile = (runner as Asset<'scripts'>).gmlFile;
    const discoverDecl = 'static Discover = function';
    const discoverDeclOffset = runnerFile.content.indexOf(discoverDecl);
    ok(discoverDeclOffset >= 0, 'Could not find Discover declaration in crispy_Runner');

    const discoverRef = runnerFile.getReferenceAt(discoverDeclOffset + 'static '.length);
    ok(discoverRef, 'Could not resolve Discover declaration reference');
    expect(discoverRef!.item.name).to.equal('Discover');

    const discoverType = discoverRef!.item.getTypeByKind('Function');
    ok(discoverType, 'Discover should resolve to a function type');
    expect(discoverType!.returns?.toFeatherString()).to.equal('Struct.CrispyRunner');
  });

  it('resolves constructor static sugar access Function.member as static_get(Function).member', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const functionsAsset = project.getAssetByName('crispy_Functions');
    const testAsset = project.getAssetByName('crispy_Test');
    ok(functionsAsset && functionsAsset.assetKind === 'scripts');
    ok(testAsset && testAsset.assetKind === 'scripts');

    const functionsFile = (functionsAsset as Asset<'scripts'>).gmlFile;
    const testFile = (testAsset as Asset<'scripts'>).gmlFile;

    const returnExprOffset = functionsFile.content.indexOf('CrispyTest.vars');
    ok(returnExprOffset >= 0, 'Could not find CrispyTest.vars in crispy_Functions');

    const constructorRef = functionsFile.getReferenceAt(returnExprOffset + 1);
    ok(constructorRef, 'Expected CrispyTest reference to resolve');
    expect(constructorRef!.item.name).to.equal('CrispyTest');

    const varsRef = functionsFile.getReferenceAt(returnExprOffset + 'CrispyTest.'.length + 1);
    ok(varsRef, 'Expected vars reference to resolve through constructor static sugar');
    expect(varsRef!.item.name).to.equal('vars');

    const varsDefOffset = testFile.content.indexOf('static vars = {}');
    ok(varsDefOffset >= 0, 'Could not find static vars definition in crispy_Test');
    const varsDefRef = testFile.getReferenceAt(varsDefOffset + 'static '.length + 1);
    ok(varsDefRef, 'Expected vars definition reference to resolve in crispy_Test');
    expect(varsRef!.item).to.equal(varsDefRef!.item);

    const diagnostics = functionsFile.getDiagnostics().INVALID_OPERATION;
    expect(diagnostics).to.have.lengthOf(0);
  });

  it('keeps method statics function-owned and out of instance scope', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const npcAsset = project.getAssetByName('o_npc');
    ok(npcAsset && npcAsset.assetKind === 'objects');

    const createFile = (npcAsset as Asset<'objects'>).gmlFile;
    const methodDeclOffset = createFile.content.indexOf('PatrolAddPoint = function');
    ok(methodDeclOffset >= 0, 'Could not find PatrolAddPoint method declaration');

    const methodRef = createFile.getReferenceAt(methodDeclOffset + 1);
    ok(methodRef, 'Could not resolve PatrolAddPoint declaration reference');
    expect(methodRef!.item.name).to.equal('PatrolAddPoint');

    const methodType = methodRef!.item.getTypeByKind('Function');
    ok(methodType, 'PatrolAddPoint should resolve to a function type');

    const staticDeclOffset = createFile.content.indexOf('static FDef = function() {}');
    ok(staticDeclOffset >= 0, 'Could not find FDef static declaration in PatrolAddPoint');

    const staticRef = createFile.getReferenceAt(staticDeclOffset + 'static '.length + 1);
    ok(staticRef, 'Could not resolve FDef static declaration reference');
    expect(staticRef!.item.name).to.equal('FDef');
    expect(staticRef!.item.static).to.equal(true);

    const npc = npcAsset as Asset<'objects'>;
    expect(npc.instanceType?.getMember('FDef')).to.equal(undefined);
    expect(npc.variables?.getMember('FDef')).to.equal(undefined);

    const localStatic = methodType!.local?.getMember('FDef', true);
    ok(localStatic, 'Expected method-local static member FDef to exist');
    expect(staticRef!.item).to.equal(localStatic);
  });

  it('resolves global function statics via Function.member and static_get(Function)', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const gameFunctionsAsset = project.getAssetByName('__Game_Functions');
    ok(gameFunctionsAsset && gameFunctionsAsset.assetKind === 'scripts');

    const gameFunctionsFile = (gameFunctionsAsset as Asset<'scripts'>).gmlFile;
    const initialInvalidOps = gameFunctionsFile.getDiagnostics().INVALID_OPERATION.length;
    const originalContent = gameFunctionsFile.content;
    const probeCode =
      '\nvar __test_func_static_hash = gos_trace.__hash;\n' +
      'var __test_static_get_hash = static_get(gos_trace).__hash;\n';

    try {
      await gameFunctionsFile.reload(originalContent + probeCode, { reloadDirty: true });

      const expectedStatic = project.self
        .getMember('gos_trace')
        ?.getTypeByKind('Function')
        ?.local?.getMember('__hash', true);
      ok(expectedStatic, 'Could not resolve expected gos_trace static member __hash');
      expect(expectedStatic!.static).to.equal(true);

      const directAccessOffset = gameFunctionsFile.content.indexOf('gos_trace.__hash');
      ok(directAccessOffset >= 0, 'Could not find direct function static access probe');
      const directAccessRef = gameFunctionsFile.getReferenceAt(
        directAccessOffset + 'gos_trace.'.length + 1,
      );
      ok(directAccessRef, 'Could not resolve gos_trace.__hash reference');
      expect(directAccessRef!.item).to.equal(expectedStatic);

      const staticGetAccessOffset = gameFunctionsFile.content.indexOf(
        'static_get(gos_trace).__hash',
      );
      ok(staticGetAccessOffset >= 0, 'Could not find static_get function static access probe');
      const staticGetAccessRef = gameFunctionsFile.getReferenceAt(
        staticGetAccessOffset + 'static_get(gos_trace).'.length + 1,
      );
      ok(staticGetAccessRef, 'Could not resolve static_get(gos_trace).__hash reference');
      expect(staticGetAccessRef!.item).to.equal(expectedStatic);

      const updatedInvalidOps = gameFunctionsFile.getDiagnostics().INVALID_OPERATION.length;
      expect(updatedInvalidOps).to.equal(initialInvalidOps);
    } finally {
      await gameFunctionsFile.reload(originalContent, { reloadDirty: true });
    }
  });

  it('resolves typed JSDoc record return members via dot access without undeclared diagnostics', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const gameFunctionsAsset = project.getAssetByName('__Game_Functions');
    ok(gameFunctionsAsset && gameFunctionsAsset.assetKind === 'scripts');

    const gameFunctionsFile = (gameFunctionsAsset as Asset<'scripts'>).gmlFile;
    const originalContent = gameFunctionsFile.content;
    const initialUndeclared =
      gameFunctionsFile.getDiagnostics().UNDECLARED_VARIABLE_REFERENCE.length;
    const probeCode =
      '\nvar __test_effective = enemy_list_room_effective_config();\n' +
      'var __test_effective_persistent = __test_effective.persistent;\n';

    try {
      await gameFunctionsFile.reload(originalContent + probeCode, { reloadDirty: true });

      const effectiveDeclOffset = gameFunctionsFile.content.indexOf(
        '__test_effective = enemy_list_room_effective_config()',
      );
      ok(effectiveDeclOffset >= 0, 'Could not find typed-return local assignment probe');
      const effectiveRef = gameFunctionsFile.getReferenceAt(effectiveDeclOffset + 1);
      ok(effectiveRef, 'Could not resolve typed-return local variable reference');
      const effectiveStruct = effectiveRef!.item.getTypeByKind('Struct');
      ok(effectiveStruct, 'Typed-return local variable should keep a Struct type');
      expect(effectiveStruct!.getMember('persistent')).to.exist;
      expect(effectiveStruct!.getMember('cleared')).to.exist;

      const persistentOffset = gameFunctionsFile.content.indexOf('__test_effective.persistent');
      ok(persistentOffset >= 0, 'Could not find typed-return dot-access probe');

      const dotScopeSymbols = gameFunctionsFile.getInScopeSymbolsAt(
        persistentOffset + '__test_effective.'.length,
      );
      expect(dotScopeSymbols.some((symbol) => symbol.name === 'persistent')).to.equal(true);
      expect(dotScopeSymbols.some((symbol) => symbol.name === 'cleared')).to.equal(true);

      const persistentRef = gameFunctionsFile.getReferenceAt(
        persistentOffset + '__test_effective.'.length + 1,
      );
      ok(persistentRef, 'Could not resolve persistent member from typed return struct');
      expect(persistentRef!.item.name).to.equal('persistent');
      expect(persistentRef!.item.def).to.exist;

      const updatedUndeclared =
        gameFunctionsFile.getDiagnostics().UNDECLARED_VARIABLE_REFERENCE.length;
      expect(updatedUndeclared).to.equal(initialUndeclared);
    } finally {
      await gameFunctionsFile.reload(originalContent, { reloadDirty: true });
    }
  });

  it('can resolve object yy properties as typed references in code', async function () {
    const project = await Project.initialize('samples/gm-ghost-seed');
    const asset = project.getAssetByName('o_change_room');
    ok(asset && asset.assetKind === 'objects');

    const obj = asset as Asset<'objects'>;
    const toRoom = obj.variables?.getMember('toRoom');
    const time = obj.variables?.getMember('time');
    ok(toRoom);
    ok(time);
    expect(toRoom.type.toFeatherString()).to.equal('Asset.GMRoom');
    expect(time.type.toFeatherString()).to.equal('Real');

    const create = obj.gmlFile;
    const toRoomRef = create.refs.find((ref) => ref.item.name === 'toRoom');
    const timeRef = create.refs.find((ref) => ref.item.name === 'time');
    ok(toRoomRef);
    ok(timeRef);
    ok(toRoomRef.item === toRoom);
    ok(timeRef.item === time);

    const callbackPlayerStart = create.content.indexOf('player.fsm.Change("Default");');
    ok(callbackPlayerStart >= 0);
    const callbackPlayerRef = create.getReferenceAt(callbackPlayerStart + 1);
    ok(callbackPlayerRef);
    expect(callbackPlayerRef.item.name).to.equal('player');

    // Verify that `Change` is resolved correctly in `_pyr.fsm.Change("Freeze")`
    const pyrFsmChangeStr = '_pyr.fsm.Change("Freeze")';
    const pyrFsmChangeStart = create.content.indexOf(pyrFsmChangeStr);
    ok(pyrFsmChangeStart >= 0, 'Could not find _pyr.fsm.Change("Freeze") in file');
    const changeOffset = pyrFsmChangeStart + '_pyr.fsm.'.length;
    const changeRef = create.getReferenceAt(changeOffset);
    ok(changeRef, `No reference found at 'Change' position (offset ${changeOffset})`);
    expect(changeRef.item.name).to.equal('Change');
    expect(changeRef.item.type.kind).to.equal('Function');

    const playerAsset = project.getAssetByName('o_player');
    ok(playerAsset && playerAsset.assetKind === 'objects');
    const playerCreateFile = (playerAsset as Asset<'objects'>).gmlFilesArray.find(
      (f) => f.name === 'Create_0',
    );
    ok(playerCreateFile, 'Could not find o_player Create_0');
    const playerStartCall = 'fsm.Start("default");';
    const playerStartCallStart = playerCreateFile!.content.indexOf(playerStartCall);
    ok(playerStartCallStart >= 0, 'Could not find fsm.Start("default") in o_player Create_0');
    const playerStartOffset = playerStartCallStart + 'fsm.'.length;
    const playerStartRef = playerCreateFile!.getReferenceAt(playerStartOffset);
    ok(playerStartRef, 'Could not resolve Start reference in o_player');
    expect(playerStartRef.item.name).to.equal('Start');
    expect(playerStartRef.item.parent?.name).to.equal('LpSM');

    const originalPlayerCreateContent = playerCreateFile!.content;
    const ambiguousStartContent = originalPlayerCreateContent.replace(
      'fsm.Start("default");',
      'if (true) fsm = new LpSMEx();\n\nfsm.Start("default");',
    );
    await playerCreateFile!.reload(ambiguousStartContent, { reloadDirty: true });
    const ambiguousStartCallStart = playerCreateFile!.content.indexOf('fsm.Start("default");');
    ok(ambiguousStartCallStart >= 0, 'Could not find Start call after ambiguous assignment');
    const ambiguousStartOffset = ambiguousStartCallStart + 'fsm.'.length;
    const ambiguousStartRef = playerCreateFile!.getReferenceAt(ambiguousStartOffset);
    ok(ambiguousStartRef, 'Could not resolve Start in ambiguous LpSM/LpSMEx union');
    expect(ambiguousStartRef.item.name).to.equal('Start');
    expect(ambiguousStartRef.item.parent?.name).to.equal('LpSM');
    await playerCreateFile!.reload(originalPlayerCreateContent, { reloadDirty: true });

    const lpsmAsset = project.getAssetByName('LpSM_SM');
    ok(lpsmAsset && lpsmAsset.assetKind === 'scripts');
    const lpsmFile = (lpsmAsset as Asset<'scripts'>).gmlFile;
    const lpsmStartDef = 'static Start = function(_state)';
    const lpsmStartDefStart = lpsmFile.content.indexOf(lpsmStartDef);
    ok(lpsmStartDefStart >= 0, 'Could not find LpSM Start definition');
    const lpsmStartNameOffset = lpsmStartDefStart + 'static '.length;
    const lpsmStartDefRef = lpsmFile.getReferenceAt(lpsmStartNameOffset);
    ok(lpsmStartDefRef, 'Could not resolve Start definition reference in LpSM_SM');
    expect(lpsmStartDefRef.item.name).to.equal('Start');
    expect(lpsmStartDefRef.item.parent?.name).to.equal('LpSM');

    const lpsmExAsset = project.getAssetByName('LpSM_SM_EX');
    ok(lpsmExAsset && lpsmExAsset.assetKind === 'scripts');
    const lpsmExFile = (lpsmExAsset as Asset<'scripts'>).gmlFile;
    const lpsmExStartDef = 'static Start = function(_state, _data = undefined)';
    const lpsmExStartDefStart = lpsmExFile.content.indexOf(lpsmExStartDef);
    ok(lpsmExStartDefStart >= 0, 'Could not find LpSMEx Start definition');
    const lpsmExStartOffset = lpsmExStartDefStart + 'static '.length;
    const lpsmExStartRef = lpsmExFile.getReferenceAt(lpsmExStartOffset);
    ok(lpsmExStartRef, 'Could not resolve Start definition reference in LpSM_SM_EX');
    expect(lpsmExStartRef.item.name).to.equal('Start');
    expect(lpsmExStartRef.item.parent?.name).to.equal('LpSMEx');
    expect(lpsmExStartRef.item).not.to.equal(lpsmStartDefRef.item);

    const onEnterAssignment = 'OnEnter =  _on_enter;';
    const assignmentStart = lpsmFile.content.indexOf(onEnterAssignment);
    ok(assignmentStart >= 0, 'Could not find OnEnter assignment in LpSM_SM');

    const onEnterMemberOffset = assignmentStart + onEnterAssignment.indexOf('OnEnter');
    const onEnterMemberRef = lpsmFile.getReferenceAt(onEnterMemberOffset);
    ok(onEnterMemberRef, 'Could not resolve OnEnter member reference');
    expect(onEnterMemberRef.item.name).to.equal('OnEnter');
    expect(onEnterMemberRef.item.type.toFeatherString()).to.equal('Function');

    const onEnterParamOffset = assignmentStart + onEnterAssignment.indexOf('_on_enter');
    const onEnterParamRef = lpsmFile.getReferenceAt(onEnterParamOffset);
    ok(onEnterParamRef, 'Could not resolve _on_enter parameter reference');
    expect(onEnterParamRef.item.name).to.equal('_on_enter');
    expect(onEnterParamRef.item.type.toFeatherString()).to.equal('Function');

    const statesStrMatch = 'states_str = {}';
    const statesStrStart = lpsmFile.content.indexOf(statesStrMatch);
    ok(statesStrStart >= 0, 'Could not find states_str declaration in LpSM_SM');
    const statesStrOffset = statesStrStart + statesStrMatch.indexOf('states_str');
    const statesStrRef = lpsmFile.getReferenceAt(statesStrOffset);
    ok(statesStrRef, 'Could not resolve states_str reference');
    expect(statesStrRef.item.name).to.equal('states_str');
    expect(statesStrRef.item.type.toFeatherString()).to.equal('Struct<Struct.__Lpss>');

    const currentAssign = 'var _current = states_str[$ _key];';
    const currentAssignStart = lpsmFile.content.indexOf(currentAssign);
    ok(currentAssignStart >= 0, 'Could not find _current assignment in LpSM_SM');
    const currentVarOffset = currentAssignStart + currentAssign.indexOf('_current');
    const currentVarRef = lpsmFile.getReferenceAt(currentVarOffset);
    ok(currentVarRef, 'Could not resolve _current reference');
    expect(currentVarRef.item.name).to.equal('_current');
    expect(currentVarRef.item.type.toFeatherString()).to.equal('Struct.__Lpss');

    // GameMaker-style: @param order is source-of-truth, even if names differ.
    const originalLpsmContent = lpsmFile.content;
    const weirdParamNamesContent = originalLpsmContent
      .replace(
        '/// @param {String} [name] State name.',
        '/// @param {String} [dkjaslkjdlkasjdas] State name.',
      )
      .replace(
        '/// @param {Function} [on_enter] Callback executed on enter: function(current, previous) {}',
        '/// @param {Function} [uu18928823] Callback executed on enter: function(current, previous) {}',
      );

    await lpsmFile.reload(weirdParamNamesContent, { reloadDirty: true });
    const weirdAssignmentStart = lpsmFile.content.indexOf(onEnterAssignment);
    ok(weirdAssignmentStart >= 0, 'Could not find OnEnter assignment after weird @param rename');
    const weirdParamOffset = weirdAssignmentStart + onEnterAssignment.indexOf('_on_enter');
    const weirdParamRef = lpsmFile.getReferenceAt(weirdParamOffset);
    ok(weirdParamRef, 'Could not resolve _on_enter with positional @param mapping');
    expect(weirdParamRef.item.name).to.equal('_on_enter');
    expect(weirdParamRef.item.type.toFeatherString()).to.equal('Function');

    // Restore original content to avoid side effects for later tests.
    await lpsmFile.reload(originalLpsmContent, { reloadDirty: true });
  });

  it('can analyze a representative project', async function () {
    const projectDir = 'samples/project';
    const project = await Project.initialize(projectDir);
    ok(project);

    //#region ASSETS
    const script = project.getAssetByName('Script1')!;
    const scriptFile = script.gmlFile;
    const jsdocs = project.getAssetByName('Jsdocs')!;
    const jsdocsFile = jsdocs.gmlFile;
    const complexScript = project.getAssetByName('Complicated')!;
    const complexScriptFile = complexScript.gmlFile;
    const recoveryScript = project.getAssetByName('Recovery')!;
    const recoveryScriptFile = recoveryScript.gmlFile;
    const obj = project.getAssetByName('o_object')!;
    const objCreate = obj.gmlFilesArray.find((f) => f.name === 'Create_0');
    const objStep = obj.gmlFilesArray.find((f) => f.name === 'Step_0');
    const parent = project.getAssetByName('o_parent')!;
    const child = project.getAssetByName('o_child1')!;
    const grandchild = project.getAssetByName('o_child1_child')!;
    const child2 = project.getAssetByName('o_child2')!;
    ok(script);
    ok(scriptFile);
    ok(jsdocs);
    ok(jsdocsFile);
    ok(complexScript);
    ok(complexScriptFile);
    ok(obj);
    ok(objCreate);
    ok(objStep);
    ok(recoveryScript);
    ok(recoveryScriptFile);
    ok(parent);
    ok(child);
    ok(grandchild);
    ok(child2);
    //#endregion ASSETS

    //#region OBJECT INHERITANCE
    // Child1 and Child2 both inherit from Parent
    // Child1Child inherits from Child1
    // Child2 does not call event_inherited in its Create event
    const parentVars = ['parent_var'];
    const childVars = ['child1_var'];
    const grandchildVars = ['child1_child_var'];
    const child2Vars = ['child2_var'];
    // Check inheritance links
    ok(child.parent === parent);
    ok(grandchild.parent === child);
    ok(child2.parent === parent);
    // Check that variables are propery inherited
    expect(parent.instanceType?.listMembers().map((m) => m.name)).to.include.members(parentVars);
    expect(child.instanceType?.listMembers().map((m) => m.name)).to.include.members([
      ...parentVars,
      ...childVars,
    ]);
    expect(grandchild.instanceType?.listMembers().map((m) => m.name)).to.include.members([
      ...parentVars,
      ...childVars,
      ...grandchildVars,
    ]);
    expect(child2.instanceType?.listMembers().map((m) => m.name)).to.include.members(child2Vars);
    expect(child2.instanceType?.listMembers().map((m) => m.name)).not.to.include.members(
      parentVars,
    );

    // Check that a reference to the parent_var works in the grandchild
    const grandChildRef = grandchild.gmlFile.getReferenceAt(4, 24);
    ok(grandChildRef);
    expect(grandChildRef.item.name).to.equal('parent_var');
    ok(grandChildRef.item === parent.instanceType!.getMember('parent_var'));
    ok(grandChildRef.item.def);

    //#endregion OBJECT INHERITANCE

    // Check fancy assignmnent operators
    const decrementer = script.gmlFile.getReferenceAt(72, 3);
    ok(decrementer);
    const decrementRhs = script.gmlFile.getReferenceAt(72, 19);
    ok(decrementRhs);

    // Check assignment to an unknown variable
    const unknownVar = script.gmlFile.getReferenceAt(76, 13);
    ok(!unknownVar);
    const unknownVarRhs = script.gmlFile.getReferenceAt(76, 24);
    ok(unknownVarRhs);

    // Check reference inside of an accessor
    const accessorRef = script.gmlFile.getReferenceAt(81, 27);
    ok(accessorRef);

    //#region GLOBALVARS
    const globalVarName = 'GLOBAL_SCRIPT_VAR';
    const globalvarDef = scriptFile.getReferenceAt(2, 18);
    const globalvarRef = scriptFile.getReferenceAt(2, 37);
    const otherGlobalvarRef = objStep.getReferenceAt(2, 36);
    ok(globalvarDef);
    ok(globalvarRef);
    ok(otherGlobalvarRef);
    // All refs should point to the same thing
    ok(globalvarDef.item === globalvarRef.item);
    ok(globalvarDef.item === otherGlobalvarRef.item);
    // The definition should exist and be named
    const item = globalvarDef.item;
    ok(item.isRenameable);
    ok(item.def);
    ok(item.name === globalVarName);
    // The globalvar should have appropriate symbol and type info
    ok(item.$tag === 'Sym');
    ok(item.global === true);
    //#endregion GLOBALVARS

    //#region REF RENAMING
    expect(globalvarRef.text).to.equal(globalVarName);
    expect(globalvarRef.isRenameable).to.equal(true);
    //#endregion REF RENAMING

    //#region ROOT SCRIPT SCOPE
    const inRootScriptScope = scriptFile.getInScopeSymbolsAt(762);
    ok(inRootScriptScope.length);
    // Local scope
    const localConstructed = inRootScriptScope.find((id) => id.name === 'const');
    ok(localConstructed);
    ok(localConstructed.local);
    ok(!localConstructed.global);
    // Global scope
    const globalConstructor = inRootScriptScope.find(
      (id) => id.name === 'GlobalConstructor',
    ) as Signifier;
    ok(globalConstructor);
    ok(!globalConstructor.local);
    ok(globalConstructor.global);
    ok(globalConstructor.name === 'GlobalConstructor');
    ok(globalConstructor.type.constructs);
    ok(globalConstructor.type.constructs[0].name === 'GlobalConstructor');
    ok(globalConstructor.type.type[0].isFunction);
    expect(globalConstructor.type.kind).to.equal('Function');
    expect(globalConstructor.type.type[0].isConstructor).to.equal(true);
    // Instance scope (should not be found)
    ok(!inRootScriptScope.find((id) => id.name === 'instance_function'));
    // Deeper local scope (should not be found)
    ok(!inRootScriptScope.find((id) => id.name === '_name'));
    //#endregion ROOT SCRIPT SCOPE

    //#region FUNCTION SCOPE
    // Params
    const paramName = '_name';
    const paramRef = scriptFile.getReferenceAt({ line: 18, column: 32 });
    ok(paramRef);
    expect(paramRef.text).to.equal(paramName);
    const param = paramRef.item as Signifier;
    ok(param);
    ok(param.local);
    ok(param.parameter);
    expect(param.name).to.equal(paramName);
    // Params should be visible in the function scope
    const inFunctionScope = scriptFile.getInScopeSymbolsAt(19, 16);
    ok(inFunctionScope.length);
    ok(inFunctionScope.find((id) => id.name === paramName));
    // And so should local vars
    const inFunctionLocalvar = inFunctionScope.find((id) => id.name === 'local');
    ok(inFunctionLocalvar);
    ok(scriptFile.getReferenceAt(21, 10)!.item === inFunctionLocalvar);
    //#endregion FUNCTION SCOPE

    //#region INSTANCE SCOPE
    const instanceVarName = 'instance_variable';
    const inInstanceScope = objStep.getReferenceAt(4, 9);
    const objectType = obj.instanceType;
    ok(objectType);
    ok(inInstanceScope);
    expect(inInstanceScope.text).to.equal(instanceVarName);
    ok(inInstanceScope.item.name === instanceVarName);
    ok(inInstanceScope.item.instance);
    // Are functions properly added to self?
    const instanceFunctionName = 'instance_function';
    const instanceFunction = objectType.getMember(instanceFunctionName);
    ok(instanceFunction);
    //#endregion INSTANCE SCOPE

    //#region ENUMS
    const enumName = 'SurpriseEnum';
    const enumMemberName = 'another_surprise';
    const enumDef = scriptFile.getReferenceAt(22, 12);
    const enumMemberDef = scriptFile.getReferenceAt(22, 40);
    ok(enumDef);
    expect(enumDef.text).to.equal(enumName);
    ok(enumDef.item.name === enumName);
    ok(enumMemberDef);
    ok(enumMemberDef.item.name === enumMemberName);

    const enumRef = objCreate.getReferenceAt(3, 23);
    const enumMemberRef = objCreate.getReferenceAt(3, 38);
    ok(enumRef);
    ok(enumRef.item.name === enumName);
    ok(enumMemberRef);
    expect(enumMemberRef.text).to.equal(enumMemberName);
    ok(enumMemberRef.item.name === enumMemberName);
    //#endregion ENUMS

    //#region RECOVERY
    const enumAutocompleteScope = recoveryScriptFile.getScopeRangeAt(3, 22);
    ok(enumAutocompleteScope);
    const enumAutocompleteList = recoveryScriptFile.getInScopeSymbolsAt(3, 22);
    ok(enumAutocompleteList);
    expect(enumAutocompleteList.length).to.equal(2);
    //#endregion RECOVERY

    //#region CONSTRUCTORS
    const constructorName = 'GlobalConstructor';
    const constructorDef = scriptFile.getReferenceAt(18, 17);
    const constructorSymbol = constructorDef!.item;
    const constructorType = constructorSymbol.type as TypeStore<'Function'>;
    ok(constructorDef);
    expect(constructorDef.text).to.equal(constructorName);
    ok(constructorSymbol);
    ok(constructorType);
    ok(constructorSymbol.name === constructorName);
    ok(constructorSymbol instanceof Signifier);
    expect(constructorSymbol.type.kind).to.equal('Function');
    expect(constructorSymbol.type.type[0].isConstructor).to.equal(true);
    expect(constructorType.type[0].name).to.equal(constructorName);
    expect(constructorType.type[0].listParameters()).to.have.lengthOf(2);
    expect(constructorType.constructs[0].kind).to.equal('Struct');
    expect(constructorType.constructs[0].name).to.equal(constructorName);
    ok(project.self.getMember(constructorName) === constructorSymbol);
    ok(project.types.get(`Struct.${constructorName}`) === constructorType.constructs[0]);

    //#endregion CONSTRUCTORS

    //#region FUNCTION CALLS
    ok(!scriptFile.getFunctionArgRangeAt(29, 35)!.hasExpression);
    ok(scriptFile.getFunctionArgRangeAt(41, 50)!.hasExpression);
    //#endregion FUNCTION CALLS

    //#region DOT ASSIGNMENTS
    const dotAssignedRefName = 'another_instance_variable';
    const dotAssignedRef = objCreate.getReferenceAt(20, 14);
    const dotAssignedType = dotAssignedRef?.item as Signifier;
    ok(dotAssignedRef);
    expect(dotAssignedRef.text).to.equal(dotAssignedRefName);
    ok(dotAssignedRef.item.name === dotAssignedRefName);
    ok(dotAssignedType);
    ok(dotAssignedType.parent === obj.instanceType?.extends);
    //#endregion DOT ASSIGNMENTS

    //#region FUNCTIONS
    // Check the return type of a function
    const functionDefRef = complexScriptFile.getReferenceAt(119, 22);
    expect((functionDefRef?.item as Signifier).type.returns[0].kind).to.equal('Array');
    const globalFunction = scriptFile.getReferenceAt(6, 19);
    ok(globalFunction);
    ok(globalFunction.item.name === 'global_function');
    //#endregion FUNCTIONS

    await validateCrossFileDiagnostics(project);
    validateGenerics(project);
    validateWithContexts(project);
    validateFunctionContexts(project);
    validateJsdocs(project);

    validateBschemaConstructor(project);
    await validateAccessorTypes(project);

    // Reprocess a file and ensure that the tests still pass
    await complexScriptFile.reload();
    logger.log('Re-running after reload...');
    validateBschemaConstructor(project);

    // Mock reload a file during editing and ensure that
    // no extraneous identifiers are created
    let code = complexScriptFile.content;
    await complexScriptFile.reload(code + `\n\nfunction Tmp () constructor {a}`, {
      reloadDirty: true,
    });
    await complexScriptFile.reload(code + `\n\nfunction Tmp () constructor {ab}`, {
      reloadDirty: true,
    });
    // A should no longer exist!
    assert(complexScriptFile.refs.find((r) => r.item.name === 'ab'));
    assert(!complexScriptFile.refs.find((r) => r.item.name === 'a'));
    assert(
      complexScriptFile.refs
        .find((r) => r.item.name === 'Tmp')!
        .item.type.type[0].self!.getMember('ab'),
    );
    assert(
      !complexScriptFile.refs
        .find((r) => r.item.name === 'Tmp')!
        .item.type.type[0].self!.getMember('a'),
    );
  });

  it('applies @ignore metadata to signifiers', async function () {
    const project = await Project.initialize('samples/project');
    const futures = project.getAssetByName('Futures');
    ok(futures);
    const futuresFile = futures.gmlFile;
    ok(futuresFile);

    const ignoredSymbolOffset = futuresFile.content.indexOf('__resolve = function');
    ok(ignoredSymbolOffset >= 0, 'Could not find __resolve declaration in Futures.gml');
    const ignoredRef = futuresFile.getReferenceAt(ignoredSymbolOffset + 1);
    ok(ignoredRef, 'Could not resolve __resolve declaration reference');
    expect(ignoredRef.item.name).to.equal('__resolve');
    expect(ignoredRef.item.ignored).to.equal(true);
  });

  it('updates @ignore metadata when the annotation is removed', async function () {
    const project = await Project.initialize('samples/project');
    const futures = project.getAssetByName('Futures');
    ok(futures);
    const futuresFile = futures.gmlFile;
    ok(futuresFile);

    const originalContent = futuresFile.content;
    const withoutIgnore = originalContent.replace(
      /\/\/\/\s*@ignore\s*\r?\n(\s*(?:static\s+)?__resolve\s*=\s*function)/,
      '$1',
    );
    ok(withoutIgnore !== originalContent, 'Could not remove @ignore annotation for __resolve');

    try {
      await futuresFile.reload(withoutIgnore, { reloadDirty: true });

      const updatedOffset = futuresFile.content.indexOf('__resolve = function');
      ok(updatedOffset >= 0, 'Could not find __resolve declaration in updated Futures.gml');
      const updatedRef = futuresFile.getReferenceAt(updatedOffset + 1);
      ok(updatedRef, 'Could not resolve __resolve declaration reference after removing @ignore');
      expect(updatedRef.item.ignored).to.equal(false);
    } finally {
      await futuresFile.reload(originalContent, { reloadDirty: true });
    }
  });

  it('does not apply @ignore from child assignments to inherited symbols', async function () {
    const project = await Project.initialize('samples/project');
    const parent = project.getAssetByName('o_parent');
    const child = project.getAssetByName('o_child1');
    ok(parent && parent.assetKind === 'objects');
    ok(child && child.assetKind === 'objects');

    const parentVarBefore = (parent as Asset<'objects'>).instanceType?.getMember(
      'parent_var',
      true,
    );
    ok(parentVarBefore, 'Could not resolve parent_var on parent object');
    expect(parentVarBefore.ignored).to.equal(false);

    const childCreate = (child as Asset<'objects'>).gmlFile;
    const originalContent = childCreate.content;
    const withIgnoredInheritedAssignment = `${originalContent}\n\n/// @ignore\nparent_var = parent_var;\n`;

    try {
      await childCreate.reload(withIgnoredInheritedAssignment, { reloadDirty: true });
      const parentVarAfter = (parent as Asset<'objects'>).instanceType?.getMember(
        'parent_var',
        true,
      );
      ok(parentVarAfter, 'Could not resolve parent_var after child reload');
      expect(parentVarAfter.ignored).to.equal(false);
    } finally {
      await childCreate.reload(originalContent, { reloadDirty: true });
    }
  });

  it('updates inheritance when event_inherited is toggled on reload', async function () {
    const project = await Project.initialize('samples/project');
    const child2 = project.getAssetByName('o_child2');
    ok(child2 && child2.assetKind === 'objects');
    const create = (child2 as Asset<'objects'>).gmlFile;

    const hasParentVar = () => !!(child2 as Asset<'objects'>).instanceType?.getMember('parent_var');

    expect(hasParentVar()).to.equal(false);

    const withSuper = create.content.replace('//event_inherited()', 'event_inherited()');
    await create.reload(withSuper, { reloadDirty: true });
    expect(hasParentVar()).to.equal(true);

    const withoutSuper = withSuper.replace('event_inherited()', '//event_inherited()');
    await create.reload(withoutSuper, { reloadDirty: true });
    expect(hasParentVar()).to.equal(false);

    const emptyCreate = `/// @description empty create`;
    await create.reload(emptyCreate, { reloadDirty: true });
    expect(hasParentVar()).to.equal(true);
  });

  it('can sync datafiles', async function () {
    const project = await resetSandbox();
    await project.dir.join('datafiles/test-folder/test-file.txt').write('hello');
    await project.syncIncludedFiles();
    const synced = project.datafiles.find(
      (f) => f.name === 'test-file.txt' && f.filePath === 'datafiles/test-folder',
    );
    assert(synced);
    // Included file masks must remain numeric to avoid GameMaker schema corruption.
    expect(synced.CopyToMask).to.equal(-1);
  });

  xit('can parse sample project', async function () {
    const projectDir = process.env.GML_PARSER_SAMPLE_PROJECT_DIR;
    ok(
      projectDir,
      'A dotenv file should provide a path to a full sample project, as env var GML_PARSER_SAMPLE_PROJECT_DIR',
    );
    const project = await Project.initialize(projectDir);
  });
});

function validateGenerics(project: Project) {
  const scriptFile = project.getAssetByName('Generics')!.gmlFile;
  const o_object = project.getAssetByName('o_object')! as Asset<'objects'>;

  // SIMPLE IDENTIFY FUNCTION
  const identifyFunc = scriptFile.getReferenceAt(4, 15)!.item;
  const returns = identifyFunc.type.returns;
  expect(returns).to.have.lengthOf(1);
  expect(returns[0].type[0].name).to.equal('T');

  const sampleType = scriptFile.getReferenceAt(8, 9)!.item.type.type[0];
  const returnedSample = scriptFile.getReferenceAt(11, 11)!.item;
  const returnedSampleType = returnedSample.type.type[0];
  ok(sampleType.kind === returnedSampleType.kind);

  // InstanceType<>
  const returnedInstance = scriptFile.getReferenceAt(24, 7)!.item.type.type[0];
  ok(returnedInstance.kind === o_object.instanceType!.kind);

  // ObjectType<>
  const returnedObject = scriptFile.getReferenceAt(25, 7)!.item.type.type[0];
  ok(returnedObject.kind === o_object.assetType.kind);
}

async function validateCrossFileDiagnostics(project: Project) {
  // In VSCode, we were finding that when a Create event was updated
  // then a struct stored in its variables would have incorrect "missing"
  // properties in the Step of the same object.
  const asset = project.getAssetByName('o_child1_child')!;
  const createEvent = asset.getEventByName('Create_0')!;
  const stepEvent = asset.getEventByName('Step_0')!;
  const propName = 'idle';

  const declaration = createEvent.getReferenceAt(5, 4)!;
  const reference = stepEvent.getReferenceAt(1, 20)!;

  const propertyDeclaration = createEvent.getReferenceAt(6, 5)!;
  const propertyReference = stepEvent.getReferenceAt(1, 25)!;

  assert(declaration.item === reference.item);
  assert(propertyDeclaration.item === propertyReference.item);
  assert(propertyDeclaration.item.name === propName);
  assert(declaration.item.type.type[0]!.getMember(propName) === propertyDeclaration.item);
  // Should not have any diagnostics in these files.
  const stepDiagnostics = stepEvent.getDiagnostics().UNDECLARED_VARIABLE_REFERENCE;
  expect(stepDiagnostics).to.have.lengthOf(0);

  // Upon reloading the Create event, should STILL have
  // no diagnostics and the references
  // should all go to the same, *defined* signifiers.
  await createEvent.reload(createEvent.content, { reloadDirty: true });

  const reloadedDeclaration = createEvent.getReferenceAt(5, 4)!;
  assert(reloadedDeclaration.item === declaration.item);
  const reloadedReference = stepEvent.getReferenceAt(1, 20)!;
  expect(reloadedReference.item).to.equal(reloadedDeclaration.item);

  const reloadedPropertyDeclaration = createEvent.getReferenceAt(6, 5)!;
  assert(reloadedPropertyDeclaration.item.name === propName);
  assert(reloadedPropertyDeclaration.item === propertyDeclaration.item);
  const reloadedPropertyReference = stepEvent.getReferenceAt(1, 25)!;
  assert(reloadedPropertyReference.item === reloadedPropertyDeclaration.item);

  const reloadedStepDiagnostics = stepEvent.getDiagnostics().UNDECLARED_VARIABLE_REFERENCE;
  expect(reloadedStepDiagnostics).to.have.lengthOf(0);
}

async function validateAccessorTypes(project: Project) {
  // There was an issue where the type retrieved from an accessor
  // would end up being a *new* type, causing structs to lose
  // properties upon reload

  // The sample case is in the `Reactions` script, where the
  // `_timer` localvar initially has the expected struct type
  // but after reloading it is missing most of its properties

  const reactionTimerFunction = project.self.getMember('ReactionTimer');
  ok(reactionTimerFunction);
  const reactionTimerConstruct = reactionTimerFunction.type.constructs[0];
  ok(reactionTimerConstruct);
  ok(reactionTimerConstruct.name === 'ReactionTimer');
  const expectedMemberNames = [
    'reaction_id',
    'timer',
    'maxtime_min',
    'maxtime_max',
    'maxtime',
    'event_id',
  ];
  const assertAllMembersExist = (type: TypeStore) => {
    expectedMemberNames.forEach((name) => {
      ok(type.type[0].getMember(name), `Missing member ${name}`);
    });
  };

  const reactionsAsset = project.getAssetByName('Reactions')!;
  const reactionsFile = reactionsAsset.gmlFile;
  const functionScope = reactionsFile.getScopeRangeAt(3, 1);
  ok(functionScope);
  const timerVar = functionScope!.local.getMember('_timer');
  ok(timerVar);
  ok(timerVar.type.type[0] === reactionTimerConstruct, 'Timer var type is not the expected type');
  let withContext = reactionsFile.getScopeRangeAt(5, 1)!;
  ok(withContext.self === reactionTimerConstruct);
  assertAllMembersExist(timerVar.type);

  // Reload the file and ensure that the type is still correct
  await reactionsFile.reload();
  const reloadedTimerVar = reactionsFile.getScopeRangeAt(3, 1)!.local.getMember('_timer');
  ok(reloadedTimerVar);
  ok(
    reloadedTimerVar.type.type[0] === reactionTimerConstruct,
    'Timer var type is not the expected type after reload',
  );
  withContext = reactionsFile.getScopeRangeAt(5, 1)!;
  ok(withContext.self === reactionTimerConstruct);
  assertAllMembersExist(reloadedTimerVar.type);
}

function validateFunctionContexts(project: Project) {
  const complicatedScriptFile = project.getAssetByName('Complicated')!.gmlFile;
  const functionScript = project.getAssetByName('FunctionSelf')!;
  const functionScriptFile = functionScript.gmlFile;
  ok(functionScript);
  ok(functionScriptFile);
  ok(complicatedScriptFile);

  // GLOBAL CONSTRUCTED CONTEXT
  const bschemaGlobalContext = complicatedScriptFile.getReferenceAt(7, 14)!.item;
  const functionWithBschemaGlobalContext = functionScriptFile.getScopeRangeAt(2, 32)!;
  ok(
    functionWithBschemaGlobalContext &&
      functionWithBschemaGlobalContext.self === bschemaGlobalContext.type.constructs[0],
  );

  // OBJECT CONTEXT
  const obj = project.getAssetByName('o_object')!;
  ok(obj && obj.instanceType);
  const functionWithObjectContext = functionScriptFile.getScopeRangeAt(7, 25)!;
  ok(functionWithObjectContext && functionWithObjectContext.self === obj.assetType);

  // INSTANCE CONTEXT
  const functionWithInstanceContext = functionScriptFile.getScopeRangeAt(12, 27);
  ok(functionWithInstanceContext && functionWithInstanceContext.self === obj.instanceType);
}

function validateJsdocs(project: Project) {
  const jsdocsFile = project.getAssetByName('Jsdocs')!.gmlFile;
  const jsdocs = jsdocsFile.jsdocs;
  expect(jsdocs).to.have.lengthOf(8);

  // Check positions
  let jsdoc = jsdocs[0];
  expect(jsdoc.start.line).to.equal(1);
  expect(jsdoc.start.column).to.equal(1);
  expect(jsdoc.end.line).to.equal(11);
  expect(jsdoc.end.column).to.equal(16);
  expect(jsdoc.params![2].optional).to.equal(true);
  expect(jsdoc.params![2].name!.content).to.equal('maybe');
  expect(jsdoc.params![2].name!.start.line).to.equal(6);
  expect(jsdoc.params![2].name!.end.line).to.equal(6);
  expect(jsdoc.params![2].name!.start.column).to.equal(22);
  expect(jsdoc.params![2].name!.end.column).to.equal(26);
  expect(jsdoc.params![2].type!.content).to.equal('Struct');
  expect(jsdoc.params![2].type!.start.line).to.equal(6);
  expect(jsdoc.params![2].type!.end.line).to.equal(6);
  expect(jsdoc.params![2].type!.start.column).to.equal(13);
  expect(jsdoc.params![2].type!.end.column).to.equal(18);

  jsdoc = jsdocs[1];
  expect(jsdoc.start.line).to.equal(13);
  expect(jsdoc.start.column).to.equal(3);
  expect(jsdoc.end.line).to.equal(14);
  expect(jsdoc.end.column).to.equal(21);

  jsdoc = jsdocs[2];
  expect(jsdoc.start.line).to.equal(17);
  expect(jsdoc.start.column).to.equal(3);
  expect(jsdoc.end.line).to.equal(19);
  expect(jsdoc.end.column).to.equal(6);

  jsdoc = jsdocs[3];
  expect(jsdoc.start.line).to.equal(23);
  expect(jsdoc.start.column).to.equal(1);
  expect(jsdoc.end.line).to.equal(34);
  expect(jsdoc.end.column).to.equal(38);

  // This one was misbehaving despite the above tests passing
  const scriptFile = project.getAssetByName('Script1')!.gmlFile;
  const lastJsdoc = scriptFile.jsdocs.at(-3)!;
  expect(lastJsdoc.start.line).to.equal(55);
  expect(lastJsdoc.start.column).to.equal(1);
  expect(lastJsdoc.end.line).to.equal(55);
  expect(lastJsdoc.end.column).to.equal(42);
  expect(lastJsdoc.params![0].name!.content).to.equal('hello');
  expect(lastJsdoc.params![0].type!.start.line).to.equal(55);
  expect(lastJsdoc.params![0].type!.end.line).to.equal(55);
  expect(lastJsdoc.params![0].type!.start.column).to.equal(11);
  expect(lastJsdoc.params![0].type!.end.column).to.equal(34);

  // Make sure that a JSDoc description without a type annotation
  // doesn't cause the type to be forced to `Any`
  const undescribedVar = jsdocsFile.getReferenceAt(42, 11)!.item;
  ok(undescribedVar);
  expect(undescribedVar.type.kind).to.equal('String');

  const describedVar = jsdocsFile.getReferenceAt(44, 11)!.item;
  ok(describedVar);
  expect(describedVar.type.kind).to.equal('String');
}

function validateWithContexts(project: Project) {
  const complicatedScriptFile = project.getAssetByName('Complicated')!.gmlFile;
  const withingScript = project.getAssetByName('Withing')!;
  const withingScriptFile = withingScript.gmlFile;
  ok(withingScript);
  ok(withingScriptFile);
  ok(complicatedScriptFile);

  // WITHING INTO A GLOBAL CONSTRUCTED
  const bschemaGlobalContext = complicatedScriptFile.getReferenceAt(1, 14)!.item.type.type[0];
  ok(
    bschemaGlobalContext &&
      bschemaGlobalContext.kind === 'Struct' &&
      bschemaGlobalContext.name === 'Bschema',
  );
  const withIntoBschemaGlobal = withingScriptFile.getScopeRangeAt(2, 15)!;
  ok(withIntoBschemaGlobal && withIntoBschemaGlobal.self === bschemaGlobalContext);

  // WITHING INTO AN OBJECT IDENTIFIER
  const obj = project.getAssetByName('o_object')!;
  ok(obj && obj.instanceType);
  const withIntoObject = withingScriptFile.getScopeRangeAt(6, 16)!;
  ok(withIntoObject && withIntoObject.self === obj.assetType);

  // TYPE TEXT
  const typeTextRef = withingScriptFile.getReferenceAt(10, 20)!;
  ok(typeTextRef);
  expect(typeTextRef.text).to.equal('Id.Instance.o_object');
  expect(typeTextRef.isRenameable).to.equal(true);
  expect(typeTextRef.toRenamed('new_name')).to.equal('Id.Instance.new_name');

  // WITHING INTO AN OBJECT INSTANCE
  const instanceVarRef = withingScriptFile.getReferenceAt(11, 11)!;
  const instanceVar = instanceVarRef.item;
  ok(instanceVar && instanceVar.type.type[0] === obj.instanceType);
  expect(instanceVarRef.text).to.equal('o_instance');
  expect(instanceVarRef.isRenameable).to.equal(true);
  const withIntoInstance = withingScriptFile.getScopeRangeAt(13, 18)!;
  ok(withIntoInstance && withIntoInstance.self === obj.instanceType);

  // WITHING USING A JSDOC CONTEXT
  const withIntoJsdoc = withingScriptFile.getScopeRangeAt(20, 25)!;
  ok(withIntoJsdoc && withIntoJsdoc.self === obj.instanceType);

  // WITHING INTO LOCAL STRUCT
  const localStruct = withingScriptFile.getReferenceAt(24, 9)!.item;
  ok(localStruct && localStruct.type.kind === 'Struct');
  const withIntoLocalStruct = withingScriptFile.getScopeRangeAt(27, 16)!;
  ok(withIntoLocalStruct && withIntoLocalStruct.self === localStruct.type.type[0]);

  // The following JSDoc was misbehaving at one point...
  const jsdoc = withingScriptFile.jsdocs[0];
  ok(jsdoc);
  expect(jsdoc.type?.content).to.equal('Id.Instance.o_object');
  expect(jsdoc.type?.start.column).to.equal(12);
}

function validateBschemaConstructor(project: Project) {
  const complexScript = project.getAssetByName('Complicated')!;
  const complexScriptFile = complexScript.gmlFile;
  const bschemaGlobal = project.self.getMember('BSCHEMA');
  const bschemaStructType = project.types.get('Struct.Bschema') as Type<'Struct'>;
  const bschemaGlobalDef = complexScriptFile.getReferenceAt(1, 15);
  const bschemaConstructor = complexScriptFile.getReferenceAt(7, 13)?.item as Signifier;
  const bschemaRoleType = project.types.get('Struct.BschemaRole') as Type<'Struct'>;
  ok(bschemaGlobal);
  ok(bschemaStructType);
  ok(bschemaStructType.kind === 'Struct');
  ok(bschemaGlobalDef);
  ok(bschemaGlobalDef.item === bschemaGlobal);
  ok(bschemaConstructor);
  ok(bschemaConstructor.type.kind === 'Function');
  expect(bschemaConstructor.type.type[0].name).to.equal('Bschema');
  ok(bschemaConstructor.type.constructs[0] === bschemaStructType);
  ok(bschemaRoleType);
  // Check all of the members of Struct.Bschema.

  // Make sure that the project_setup Bschema field gets typed based on its assignment
  const projectSetupAssignedTo = bschemaConstructor.type.type[0].getParameter(0)!;
  ok(projectSetupAssignedTo.name === 'project_setup_function');
  // ok(projectSetupType === projectSetupAssignedTo.type);

  // Check the types of all of the fields of the Bschema struct
  const expectedKinds = {
    base: { kind: 'Struct' },
    changes: { kind: 'Any' },
    clear_changes: { kind: 'Function' },
    commit_id_prefix: { kind: 'String' },
    commitId: { kind: 'String' },
    create_commit_id: { kind: 'Function' },
    create_role: { kind: 'Function' },
    force_use_packed: { kind: 'Bool' },
    init: { kind: 'Function' },
    latest_commitId: {
      kinds: ['String', 'Undefined'],
      code: 'String|Undefined',
    },
    latest: { kind: 'String' },
    next_commit_id: { kind: 'Function' },
    packed_commitId: {
      kinds: ['String', 'Undefined'],
      code: 'String|Undefined',
    },
    project_setup: { kind: 'Function' },
    roles: { kind: 'Struct', code: 'Struct<Struct.BschemaRole>' },
    schema_mote_ids: { kind: 'Struct', code: 'Struct<Array<String>>' },
    uid_pools: { kind: 'Struct' },
  } satisfies Record<string, { kind?: PrimitiveName; kinds?: PrimitiveName[]; code?: string }>;

  for (const [fieldName, info] of Object.entries(expectedKinds)) {
    logger.log('Checking field', fieldName, 'of Bschema');
    const member = bschemaStructType.getMember(fieldName);
    const type = member?.type;
    ok(member, `Expected to find member ${fieldName}`);
    ok(type, `Expected to find type for member ${fieldName}`);
    expect(member.name).to.equal(fieldName);
    if ('kind' in info) {
      expect(type.kind).to.equal(info.kind);
    }
    expect(member.def, 'All members should have a definition location').to.exist;
    if ('kinds' in info) {
      expect(type?.type.length).to.equal(info.kinds.length);
      for (const expectedKind of info.kinds) {
        expect(
          type?.type.some((t) => t.kind === expectedKind),
          `Type ${expectedKind} not found in Union`,
        ).to.be.true;
      }
    }
    if ('code' in info) {
      expect(type.toFeatherString()).to.equal(info.code);
    }
  }

  // Deeper checks on the types of some of the fields
  //#region Bschema.schema_mote_ids
  const schemaMoteIds = bschemaStructType.getMember('schema_mote_ids')!;
  expect(schemaMoteIds.type.kind).to.equal('Struct');
  expect(schemaMoteIds.type.items).to.exist;
  expect(schemaMoteIds.type.items[0].kind).to.equal('Array');
  expect(schemaMoteIds.type.items[0].type[0].items).to.exist;
  expect(schemaMoteIds.type.items[0].type[0].items!.kind).to.equal('String');
  expect(schemaMoteIds.type.toFeatherString()).to.equal('Struct<Array<String>>');
  //#endregion Bschema.schema_mote_ids

  //#region Bschema.roles
  const roles = bschemaStructType.getMember('roles')!;
  expect(roles.type.kind).to.equal('Struct');
  expect(roles.type.items[0]).to.exist;
  expect(roles.type.items[0].kind).to.equal('Struct');
  ok(roles.type.items[0].type[0] === bschemaRoleType);
  //#endregion Bschema.roles
}
