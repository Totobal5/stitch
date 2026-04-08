import { pathy } from '@bscotch/pathy';
import { undent } from '@bscotch/utility';
import { expect } from 'chai';
import type { IRecognitionException } from 'chevrotain';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import { logger } from './logger.js';
import { GmlParser } from './parser.js';
import { Type } from './types.js';
import { ok } from './util.js';

dotenv.config();

function showErrors(parser: GmlParser | IRecognitionException[], filepath?: string) {
  const errors = Array.isArray(parser) ? parser : parser.errors;
  if (!errors.length) return;
  logger.error(
    errors.map((e) => ({
      loc: `${filepath || ''}:${e.token.startLine}:${e.token.startColumn}`,
      msg: e.message,
      token: e.token.image,
      resynced: e.resyncedTokens.map((t) => ({
        image: t.image,
        startLine: t.startLine,
        startColumn: t.startColumn,
      })),
    })),
  );
}

describe('Parser', function () {
  it('can get types from typestrings', function () {
    expect(Type.fromFeatherString('Array', new Map(), false)[0].kind).to.equal('Array');
    const stringArray = Type.fromFeatherString('Array<string>', new Map(), false)[0];
    expect(stringArray.kind).to.equal('Array');
    expect(stringArray.items!.kind).to.equal('String');
    const dsMap = Type.fromFeatherString('Id.DsMap[String,Real]', new Map(), false)[0];
    expect(dsMap.kind).to.equal('Id.DsMap');
    const dsMapItems = dsMap.items!.type;
    expect(dsMapItems.length).to.equal(2);
    expect(dsMapItems[0].kind).to.equal('String');
    expect(dsMapItems[1].kind).to.equal('Real');
  });

  it('can parse cross-referencing types', function () {
    const knownTypes = new Map();
    const arrayOfStructs = Type.fromFeatherString('Array<Struct.Hello>', knownTypes, true)[0];
    knownTypes.set('Struct.Hello', arrayOfStructs.items!.type[0]);
    const structType = Type.fromFeatherString('Struct.Hello', knownTypes, false)[0];

    ok(knownTypes.get('Struct.Hello') === structType);
    expect(arrayOfStructs.kind).to.equal('Array');
    expect(arrayOfStructs.items!.kind).to.equal('Struct');
    ok(arrayOfStructs.items!.type[0] === structType);
    expect(arrayOfStructs.items!.type[0].name).to.equal('Hello');
  });

  it('can parse complex typestrings', function () {
    const complexType = Type.fromFeatherString(
      'Array<string OR Array<Real>>|Struct.Hello OR Id.DsMap[String,Real]',
      new Map(),
      true,
    );
    const [arrayType, structType, dsMapType] = complexType;
    expect(complexType.length).to.equal(3);
    expect(arrayType.kind).to.equal('Array');
    const arrayItems = arrayType.items!.type;
    expect(arrayItems.length).to.equal(2);
    expect(arrayItems[0].kind).to.equal('String');
    expect(arrayItems[1].kind).to.equal('Array');
    expect(arrayItems[1].items!.kind).to.equal('Real');
    expect(structType.kind).to.equal('Struct');
    expect(structType.name).to.equal('Hello');
    expect(dsMapType.kind).to.equal('Id.DsMap');
    const dsMapItems = dsMapType.items!.type;
    expect(dsMapItems.length).to.equal(2);
    expect(dsMapItems[0].kind).to.equal('String');
    expect(dsMapItems[1].kind).to.equal('Real');
  });

  it('can parse simple expressions', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse('(1 + 2 * 3) + (hello / (world || undefined))');
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can get errors for invalid simple expressions', function () {
    const parser = new GmlParser();
    const { cst, errors } = parser.parse('(1 + 2 * 3) + hello / world || undefined +');
    expect(parser.errors.length).to.equal(1);
    expect(errors.length).to.equal(1);
  });

  it('can parse complex expressions', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      '1 + 2 * 3 + hello / world[no+true] || undefined + (1 + 2 * 3 + hello / world || undefined ^^ functionCall(10+3,undefined,,))',
    );
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
    // logger.log(
    //   GmlParser.jsonify(
    //     // @ts-expect-error
    //     cst!.children.statement[0].children.expressionStatement[0].children
    //       .expression[0],
    //   ),
    // );
  });

  it('can parse struct literals in expression positions', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        with ({}) {
          value = 1;
        }
        payload = ({ key: "value", nested: { x: 1 } });
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse `new function` expressions with immediate invocation', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        throw new function(_msg) : Exception() constructor {
          message = "Fatal";
          longMessage = _msg;
        }("boom");
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse accessor chains after parenthesized expressions', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        var result = (global.config).ui.open();
        var value = (make_source()).nested.get_value(1, 2);
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse `new (function...)` expressions with immediate invocation', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        throw new (function(_msg) : Exception() constructor {
          message = _msg;
        })("boom");
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse switch cases with block body and trailing break', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        switch (state) {
          case "a": {
            var x = 1;
          } break;
          default: {
            var y = 2;
          } break;
        }
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse enums with identifier-assigned values', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        enum INPUT_VERB {
          EFFECT_OFF = ps5_gamepad_trigger_effect_state_off,
          EFFECT_FEEDBACK = ps5_gamepad_trigger_effect_state_feedback,
        }
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse empty enums', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        enum INPUT_VERB_GROUP {
        }
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse if/else blocks when else block starts on the same line', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        if (ready)
        {
          do_ok();
        } else { do_fail(); }
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse if-body followed by jsdoc and static declaration', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        if (_sprite != undefined && _sprite != noone)
        {
          var _type = true;
          speedScale = (_type) ? 1 : 2;
        }

        /// @desc Change the start and end frame of the Snip
        /// @param {real} startFrame
        /// @param {real} endFrame
        static setFrameSE = function(_start, _end)
        {
          frameStart = _start ?? 0;
          frameEnd   = _end ?? 1;
        }
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('should infer types from documented parameters in constructor assignments', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        /// @desc Internal struct with documented callback parameters
        /// @param {Function} on_enter Callback function for entering state
        /// @param {Function} on_leave Callback function for leaving state
        function StateStruct(_on_enter, _on_leave) constructor
        {
          // These should inherit Function type from the documented parameters
          OnEnter = _on_enter;
          OnLeave = _on_leave;
        }
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse function-call followed by a scoped block statement', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        if (alpha > 0)
        {
          shader_set(shDistort)
          {
            draw_sprite_ext(sprite, image_index, x, y, image_xscale, image_yscale, image_angle, image_blend, alpha);
          }
          shader_reset();
        }
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse GML style JSDocs', function () {
    const parser = new GmlParser();
    const { cst } = parser.parse(
      undent`
        /// @description This is a description
        /// @param {string} a
        /// @param {number} b
        /// @returns {string}
        function myFunc(a, b) {}
      `,
    );
    showErrors(parser);
    expect(parser.errors.length).to.equal(0);
    expect(cst).to.exist;
  });

  it('can parse sample files', async function () {
    const parser = new GmlParser();
    const samples = await fs.readdir('./samples');
    for (const sample of samples) {
      // logger.log('Parsing', sample);
      if (!sample.endsWith('.gml')) {
        continue;
      }
      const filePath = `./samples/${sample}`;
      const code = await fs.readFile(filePath, 'utf-8');
      const { cst } = parser.parse(code);
      showErrors(parser, filePath);
      expect(cst).to.exist;
      expect(parser.errors).to.have.length(0);
      // logger.log(cst);
    }
  });

  xit('can parse sample project', async function () {
    const projectDir = process.env.GML_PARSER_SAMPLE_PROJECT_DIR;
    expect(
      projectDir,
      'A dotenv file should provide a path to a full sample project, as env var GML_PARSER_SAMPLE_PROJECT_DIR',
    ).to.exist;
    const dir = pathy(projectDir);
    const files = await dir.listChildrenRecursively({
      includeExtension: ['.gml'],
    });
    expect(files.length).to.be.greaterThan(0);

    const parser = new GmlParser();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const code = await file.read<string>();
      const { cst } = parser.parse(code);
      showErrors(parser, file.absolute);
      expect(cst).to.exist;
      expect(parser.errors).to.have.length(0);
      // logger.log(cst);
    }
  });
});
