import { JavascriptRenderer } from '@low-systems/javascript-renderer';
import { Context } from 'low';

import * as Crypto from 'crypto';
import * as FS from 'fs';
import * as Path from 'path';
import * as Querystring from 'querystring';
import * as Url from 'url';

export class AsyncJavascriptRenderer extends JavascriptRenderer {
  async core(func: Function, context: Context, metadata: any): Promise<any> {
    try {
      const imports: { [name: string]: any } = {
        crypto: Crypto,
        fs: FS,
        path: Path,
        querystring: Querystring,
        url: Url
      };

      if (metadata && Array.isArray(metadata.imports)) {
        metadata.imports.forEach((importName: string) => {
          imports[importName] = require(importName);
        });
      }

      const output = await func(context, metadata, this.functions, imports);
      return output;
    } catch(err) {
      throw err;
    }
  }

  makeFunction(code: string, name?: string): Function {
    const asyncCode = this.wrapCode(code, name);
    try {
      const func = new Function(asyncCode)();
      return func;
    } catch (err) {
      console.error(`Failed to make async function '${name || 'without a name'}': ${err.message}`);
      console.error(err.stack);
      console.error(asyncCode);
      const errorCode = `throw new Error('Cannot call async function ${name || 'without a name'} as it contains a syntax error');`;
      const wrappedErrorCode = this.wrapCode(errorCode, name);
      const func = new Function(wrappedErrorCode)();
      return func;
    }
  }

  wrapCode(code: string, name?: string) {
    const sourceMap = name ? `//# sourceURL=${name}` : '';
    const wrappedCode = `
      return async (context, metadata, functions, imports) => {
        ${sourceMap};
        ${code}
      };
    `;
    return wrappedCode;
  }
}