import { Project } from './dist/index.js';
const project = await Project.initialize('samples/gm-ghost-seed');
const asset = project.getAssetByName('__Game_Functions');
if (!asset || asset.assetKind !== 'scripts') throw new Error('__Game_Functions not found');
const file = asset.gmlFile;
const fnIdx = file.content.indexOf('function enemy_list_room_effective_config');
if (fnIdx < 0) throw new Error('function not found');
const fnRef = file.getReferenceAt(fnIdx + 'function '.length + 1);
if (!fnRef) throw new Error('function ref not found');
const fnType = fnRef.item.getTypeByKind('Function');
if (!fnType) throw new Error('function type missing');
const ret = fnType.returns?.type?.[0];
console.log(JSON.stringify({
  kind: ret ? ret.kind : null,
  feather: (ret && ret.toFeatherString) ? ret.toFeatherString() : null,
  persistent: (ret && ret.getMember && ret.getMember('persistent')) ? ret.getMember('persistent').type.toFeatherString() : null,
  cleared: (ret && ret.getMember && ret.getMember('cleared')) ? ret.getMember('cleared').type.toFeatherString() : null,
}, null, 2));
