import * as Http from 'http';
import * as Https from 'https';
import * as Url from 'url';

import * as GetBody from 'get-body';
import * as CookieHelper from 'cookie';
import * as Pako from 'pako';

import { Connector, TaskErrorMap } from 'low/src/connectors/connector';
import { TaskConfig } from 'low/src/environment';

import { Site, SiteMap, SiteConfig, Route } from './site';
import { HttpVerb } from './http-verbs';
import { HttpError } from './http-error';
import { ConnectorRunError } from 'low/src/connectors/connector-run-error';
import { ObjectCompiler } from 'low/src/object-compiler';

const POSSIBLE_HTTPS_HEADERS = {
  'x-forwarded-proto': 'https',           //Recommended way for load balancers and proxies
  'front-end-https': 'on',                //Microsoft's way
  'x-arr_ssl': true,                      //Another Microsoft way
  'cloudfront-forwarded-proto': 'https',  //Amazon's CloudFront way
  'x-forwarded-scheme': 'https',          //KeyCDN's way
  'x-forwarded-protocol': 'https',        //Some other ways
  'x-forwarded-ssl': 'on',
  'x-url-scheme': 'https'
};

export class ConnectorHttp extends Connector<ConnectorHttpConfig, any, HttpInput> {
  httpServer?: Http.Server;
  httpsServer?: Https.Server;
  sites: SiteMap = {};

  async setup() {
    if (this.config.httpOptions) {
      this.httpServer = Http.createServer(this.config.httpOptions, this.requestHandler.bind(this));
    }

    if (this.config.httpsOptions) {
      this.httpsServer = Https.createServer(this.config.httpsOptions, this.requestHandler.bind(this));
    }

    for (const [siteName, siteConfig] of Object.entries(this.config.sites)) {
      const site = new Site(siteName, siteConfig);
      this.sites[siteName] = site;
    }

    await this.setupTasks();
  }

  async setupTask(task: TaskConfig, config: HttpTaskConfig) {
    for (const site of config.sites) {
      this.sites[site].registerRoutes(task, config);
    }
  }

  async requestHandler(request: Http.IncomingMessage, response: Http.ServerResponse) {
    const input: HttpInput = {
      url: this.getRequestUrl(request),
      verb: request.method as HttpVerb || 'GET'
    };

    try {
      input.site = this.getSiteFromHostname(input.url.hostname);

      const match = input.site.matchRoute(input.url.pathname, input.verb);

      input.params = match.params;
      input.route = match.route;
      input.query = this.getQuerystringObject(input.url);
      input.cookies = CookieHelper.parse(request.headers.cookie || '');
      input.body = await GetBody.parse(request, request.headers as GetBody.Headers);

      const context = await this.runTask(match.route.task, input, match.route.config);
      const output = await ObjectCompiler.compile(match.route.config.output, context);

      this.sendResponse(response, output);
    } catch(err) {
      await this.handleError(response, err, input);
    }
  }

  hostnameCache: HostnameCache = {};
  getSiteFromHostname(hostname: string) {
    if (this.hostnameCache.hasOwnProperty(hostname)) {
      return this.hostnameCache[hostname];
    }

    const foundSite = Object.values(this.sites).find(site => site.config.hostnames.includes(hostname));

    if (!foundSite) {
      throw new HttpError('Invalid hostname', 400);
    }

    this.hostnameCache[hostname] = foundSite;
    return foundSite;
  }

  getRequestProtocol(request: Http.IncomingMessage) {
    for (const [name, value] of Object.entries(POSSIBLE_HTTPS_HEADERS)) {
      if (typeof value === 'boolean' && request.headers[name]) {
        return 'https';
      } else if (request.headers[name] === value) {
        return 'https';
      }
    }
    return 'http';
  }

  getRequestUrl(request: Http.IncomingMessage) {
    const protocol = this.getRequestProtocol(request);
    const host = request.headers.host || 'localhost';
    const path = request.url || '/';
    const url = new Url.URL(path, `${protocol}://${host}`);
    return url;
  }

  getQuerystringObject(url: Url.URL) {
    const query: any = {};

    for (let key of url.searchParams.keys()) {
      key = key.replace('[]', '');
      query[key] = url.searchParams.getAll(key);
    }

    return query;
  }

  async handleError(response: Http.ServerResponse, error: Error | HttpError | ConnectorRunError, input: HttpInput) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    try {
      const handlers = this.mergeErrorHandlers(input.site);
      const handler = this.findErrorHandler(handlers, statusCode);

      const task = this.env.getTask(handler.taskName);
      const config = input.route && input.route.config || {};
      let data: any = {};
      let errors: TaskErrorMap = {};

      if (error instanceof ConnectorRunError) {
        data = error.context.data;
        errors = error.context.errors;
      }

      const context = await this.runTask(task, input, config, data, errors);
      const output = await ObjectCompiler.compile(handler.output, context);

      this.sendResponse(response, output);
    } catch (err) {
      this.sendResponse(response, {
        body: error.message,
        statusCode: statusCode,
        statusMessage: error.message
      });
    }
  }

  mergeErrorHandlers(site?: Site) {
    const handlers: ErrorHandler[] = [
      ...(site && site.config.errorHandlers || []),
      ...(this.config.errorHandlers || [])
    ];

    return handlers;
  }

  findErrorHandler(handlers: ErrorHandler[], statusCode: number = 500) {
    for (const handler of handlers) {
      if (statusCode >= handler.statusCodeMin && statusCode <= handler.statusCodeMax) {
        return handler;
      }
    }

    throw new Error('No error handler found');
  }

  sendResponse(response: Http.ServerResponse, output: HttpOutput) {
    response.statusCode = output.statusCode || 200;
    response.statusMessage = output.statusMessage || 'OK';
    this.setResponseHeaders(response, output.headers);
    this.setResponseCookies(response, output.cookies);
    this.setResponseBody(response, output.body, output.gzip);
    response.end();
  }

  setResponseHeaders(response: Http.ServerResponse, headers?: HeaderMap, site?: Site) {
    if (site && this.config.responseHeaders) {
      for (const [name, value] of Object.entries(this.config.responseHeaders)) {
        response.setHeader(name.toLowerCase(), value);
      }
    }

    if (site && site.config.responseHeaders) {
      for (const [name, value] of Object.entries(site.config.responseHeaders)) {
        response.setHeader(name.toLowerCase(), value);
      }
    }

    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name.toLowerCase(), value);
      }
    }
  }

  setResponseCookies(response: Http.ServerResponse, cookies?: CookieMap) {
    if (cookies) {
      for (const [cookieName, cookie] of Object.entries(cookies)) {
        const cookieString = cookie.value ?
          CookieHelper.serialize(cookieName, cookie.value, cookie.options) :
          CookieHelper.serialize(cookieName, '', { expires: new Date(0) });
        response.setHeader('Set-Cookie', cookieString);
      }
    }
  }

  getContentType(response: Http.ServerResponse, body: any) {
    const contentType = response.getHeader('content-type');

    if (Array.isArray(contentType)) {
      return contentType[0];
    } else if (contentType) {
      return contentType.toString();
    }

    const bodyType = typeof body;
    if (bodyType === 'undefined' || body === null) {
      return 'text/plain';
    }

    if (bodyType === 'object') {
      return 'application/json';
    } else {
      return 'text/html';
    }
  }

  setResponseBody(response: Http.ServerResponse, body: any, gzip: boolean = false) {
    const bodyType = typeof body;
    if (bodyType === 'undefined' || body === null) {
      return;
    }

    let contentType = this.getContentType(response, body);
    let bodyBuffer = Buffer.from([]);

    if (Buffer.isBuffer(body)) {
      bodyBuffer = body;
    } else if (bodyType === 'object') {
      const bodyJson = JSON.stringify(body);
      bodyBuffer = Buffer.from(bodyJson);
    } else {
      const bodyString = body.toString();
      bodyBuffer = Buffer.from(bodyString);
    }

    if (gzip) {
      const zipped = Pako.gzip(bodyBuffer);
      bodyBuffer = Buffer.from(zipped);

      response.setHeader('content-encoding', 'gzip');
      response.setHeader('content-length', bodyBuffer.length);

      // Clean up unnecessary stuff from the content type
      if (contentType.indexOf('charset') > -1) {
        contentType = contentType.substr(0, contentType.indexOf(';'));
      }
      contentType += '; charset=x-user-defined-binary';
    }

    response.removeHeader('content-type');
    response.setHeader('content-type', contentType);

    response.write(bodyBuffer);
  }
}

export interface ConnectorHttpConfig {
  httpOptions?: Http.ServerOptions;
  httpsOptions?: Https.ServerOptions;
  sites: { [name: string]: SiteConfig };
  errorHandlers?: ErrorHandler[];
  responseHeaders?: HeaderMap;
}

export interface HostnameCache {
  [hostname: string]: Site;
}

export interface HttpTaskConfig {
  patterns: string[];
  sites: string[];
  output: HttpOutput;
  verbs?: HttpVerb[];
  priority?: number;
}

export interface HttpInput {
  url: Url.URL;
  verb: HttpVerb;
  query?: any;
  cookies?: any;
  body?: any;
  site?: Site;
  headers?: any;
  params?: any;
  route?: Route;
}

export interface HttpOutput {
  body: any;
  statusCode?: number;
  statusMessage?: string;
  headers?: HeaderMap;
  cookies?: CookieMap;
  gzip?: boolean;
}

export interface HeaderMap {
  [name: string]: string | number | string[];
}

export interface CookieMap {
  [name: string]: Cookie;
}

export interface Cookie {
  value?: string;
  options?: CookieHelper.CookieSerializeOptions;
}

export interface ErrorHandler {
  statusCodeMin: number;
  statusCodeMax: number;
  taskName: string;
  output: HttpOutput;
}