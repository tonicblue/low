"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const javascript_renderer_1 = require("@low-systems/javascript-renderer");
const Crypto = __importStar(require("crypto"));
const FS = __importStar(require("fs"));
const Path = __importStar(require("path"));
const Querystring = __importStar(require("querystring"));
const Url = __importStar(require("url"));
class SyncJavascriptRenderer extends javascript_renderer_1.JavascriptRenderer {
    core(func, context, metadata) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const imports = {
                    crypto: Crypto,
                    fs: FS,
                    path: Path,
                    querystring: Querystring,
                    url: Url
                };
                if (metadata && Array.isArray(metadata.imports)) {
                    metadata.imports.forEach((importName) => {
                        imports[importName] = require(importName);
                    });
                }
                const output = func(context, metadata, this.functions, imports);
                return output;
            }
            catch (err) {
                throw err;
            }
        });
    }
    makeFunction(code, name) {
        const syncCode = this.wrapCode(code, name);
        try {
            const func = new Function('context', 'metadata', 'functions', 'imports', syncCode);
            return func;
        }
        catch (err) {
            console.error(`Failed to make sync function '${name || 'without a name'}': ${err.message}`);
            console.error(err.stack);
            console.error(syncCode);
            const errorCode = `throw new Error('Cannot call sync function ${name || 'without a name'} as it contains a syntax error');\nreturn null;`;
            const wrappedErrorCode = this.wrapCode(errorCode, name);
            const func = new Function('context', 'metadata', 'functions', 'imports', wrappedErrorCode);
            return func;
        }
    }
    wrapCode(code, name) {
        const sourceMap = name ? `//# sourceURL=${name}` : '';
        let wrappedCode = code;
        if (code.replace(/"'`/g, '').includes('return')) {
            wrappedCode = `${sourceMap}\n${code}`;
        }
        else {
            wrappedCode = wrappedCode.trim().replace(/;$/g, '');
            wrappedCode = `${sourceMap}\nreturn(${code})`;
        }
        return wrappedCode;
    }
}
exports.SyncJavascriptRenderer = SyncJavascriptRenderer;
//# sourceMappingURL=sync-javascript-renderer.js.map