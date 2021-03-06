"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeDoer = void 0;
const stripe_1 = require("stripe");
const Dot = __importStar(require("dot-object"));
const low_1 = require("low");
class StripeDoer extends low_1.Doer {
    constructor() {
        super(...arguments);
        this.clients = {};
    }
    setup() {
        return __awaiter(this, void 0, void 0, function* () {
            for (const [name, keyPair] of Object.entries(this.secrets)) {
                this.clients[name] = new stripe_1.Stripe(keyPair.secret_key, this.config[name] || {});
            }
        });
    }
    main(context, taskConfig, config) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(config.client in this.clients)) {
                throw new Error(`No stripe client called '${config.client}'`);
            }
            const stripe = this.clients[config.client];
            const method = Dot.pick(config.path, stripe);
            if (typeof method !== 'function') {
                if (!config.justReturn) {
                    throw new Error(`Stripe.${config.path} is not a function`);
                }
                else {
                    return method;
                }
            }
            const args = config.args || [];
            const isAsync = typeof config.isAsync === 'boolean' ? config.isAsync : method.constructor.name === 'AsyncFunction';
            context = this.getContext(stripe, config.path, config.context);
            if (isAsync) {
                return yield method.apply(context, args);
            }
            else {
                return method.apply(context, args);
            }
        });
    }
    getContext(stripe, path, contextPath) {
        if (!contextPath) {
            if (path.indexOf('.') === -1) {
                return stripe;
            }
            contextPath = path.substring(0, path.lastIndexOf('.'));
        }
        const context = Dot.pick(contextPath, stripe);
        if (!context) {
            throw new Error(`Could not find context for Stripe call at path '${contextPath}'`);
        }
        return context;
    }
}
exports.StripeDoer = StripeDoer;
//# sourceMappingURL=stripe-doer.js.map