"use strict";
require("any-promise/register")("bluebird");
var readYaml = require("read-yaml"), extend = require("extend");

var debug = require("debug")("koala-puree");
var Emitter = require("events").EventEmitter;
var co = require("co");
var compose = require("koa-compose");
var closest = require("closest-package");
var Cookies = require("cookies");
var http = require("http");
var http2 = require("spdy");
var fs = require("mz/fs");
var send = require('koa-send');

class Puree extends Emitter {
  constructor(mod, config) {
      super();
      var closestPath = closest.sync(require("path").dirname(mod.filename));
      this._basePath = require("path").dirname(closestPath);
      var pkginfo = require("@shekhei/pkginfo")(mod);
      debug("Configurations read", pkginfo);
      if (!(this instanceof Puree)) return new Puree(mod, config);
      debug(`pwd is ${require("path").resolve(".")}`);
      config = config || "./config/server.yml";
      this._env = process.env.NODE_ENV = process.env.NODE_ENV || "development";
      this._config = extend({}, Puree.DEFAULTCONFIG, readYaml.sync(require("path").resolve(this._basePath,config))[process.env.NODE_ENV.toLowerCase()]);
      var app = this._app = require("@shekhei/koala")({
          fileServer: {
              root: this._basePath+"/public"
          },
          session: {
              domain: this._config.passport.domain
          },
          security: {
              xframe: "same"
          }
      });
      app.listen = function listen(port, cb, options) {

          if (typeof port === "function") options = cb, cb = port, port = null;
          if ( options === undefined && typeof cb !== "function" ) options = cb, cb = undefined;
          options = options || {};
          var fn = app.callback();
          var server;
          var oldfn = fn;
          server = http2.createServer(options.server);
          fn = function onIncomingRequest(req, res){
              req.socket = req.connection;
              //req.connection = req.connection || req.socket;
              res.socket = res.socket || res.stream;
              res.socket.on("end", function(){
                  debug("at least this is ended?!?!?!?!");
              });
              res.templateContext = {};
              res.connection = res.connection || res.socket;
              oldfn(req, res);
          };
          var oldcb = cb;
          cb = function() {
              server.emit("listening");
              oldcb && oldcb();
          };

          server.on("request", fn);
          server.on("checkContinue", function (req, res) {
              req.checkContinue = true;
              fn(req, res);
          });
          server.listen(port || process.env.PORT, cb);

          return server;
      };

      this._config.name = pkginfo.name;
      this._config.version = pkginfo.version;

      this._pkginfo = pkginfo;
      app.keys = ["notasecret"];
      var self = this;
      app.use(function*(next){
          this.cookies = new Cookies(this.req, this.res, app.keys);
          yield* next;
      });
      app.use(function*(next){
          debug("static route");
          var path = "/static";
          if ( this.request.path ) {

              if ( self.ns && self.ns !== "/" ) {
                  path = self.ns+path;
              }

              if (this.request.url.startsWith(path)) {
                  debug(this.request.url.substr(0,this.request.url.indexOf("?")));
                  debug("serving file");
          // have to remove the starting slash too
          // and remove the query string
                  yield send(this, this.request.path.substr(path.length+1), { root: self._basePath+"/public"});
                  return;
              }
          }
          this.res.pushStatic = ((reqPath, originalPath) => {
            var rs = this.res;
            if (reqPath.startsWith(path)) {
              // first implement a naive implementation
              var stream = this.res.push(originalPath,{
                request:{accepts: "*/*", "accept-encoding": "gzip"},
                response:{
                  vary: "accept-encoding"
                  // "content-encoding": "gzip"
                }
              })
              var localPath = self._basePath+"/public"+reqPath.substr(path.length);
              return fs.exists(localPath+".gz").then((exists)=>{
                if ( exists ) {
                  stream.sendHeaders({"content-encoding":"gzip"});
                  // stream.headers["content-encoding"] = "gzip";
                  fs.createReadStream(localPath+".gz").pipe(stream);
                  return true;
                }
                return fs.exists(localPath);
              }).then((exists)=>{
                if ( exists ) {
                  fs.createReadStream(localPath).pipe(stream);
                  return true;
                }
                stream.headers[":status"] = 404;
              })
            }
            return Promise.resolve(true)
          })
          debug("path doesnt match");
          yield* next;
      });

      app.use(function*(next){
          debug("jwt xsrf generation");
      // jwt based xsrf token

/*          if ( "GET HEAD".split(" ").indexOf(this.request.method) >= 0 ) {

          }*/
          yield* next;
      });



      app.puree = this;
      this.use(require("./lib/jwt_plugin.js"));
      if( this._config.noModel != true ) {
          this.use(require("./lib/models.js"));
      }
      this.use(require("./lib/dust.js"), {precompile: this._config.precompileTemplates === true});
      this.use(require("./lib/controllers.js"));
      this.use(require("./lib/sio.js"));

      if ( this._config.noMdns != true) {
          this.use(require("./lib/mdns.js"));
      }
      this.use(require("./lib/service.js").middleware);
      this.use(require("./lib/passport.js"));
      this.use(require("./lib/crypt.js"));

      this.ns = "/";
  }
  get app() { return this._app; }
  get config() { return this._config; }
  set config(config) { return this._config = config; }
  set namespace(ns) { this._ns = ns; this.emit("namespace", ns);}
  get namespace() { return this._ns; }
  get middleware() { return this._middleware; }
  use(mw){
      this._middleware = this._middleware || [];
      debug("adding middleware");
      var args = new Array(arguments.length);
      for(var i = 1; i < args.length; ++i) {
                  //i is always valid index in the arguments object
          args[i-1] = arguments[i];
      }
      if ( require("util").isFunction(mw)) {
          mw = mw.apply(this, args);
      }
      this._middleware.push(mw);
  }
  //* app could be a http server or another koala-puree app
  start(app, forConsole) {
      var self = this;
      self._forConsole = forConsole;

      return new Promise(function(resolve, reject){
          self.bootstrap && self.bootstrap();
          debug("starting server");
          function* startServer(next){
              debug("starting startServer Mw");
              require("pmx").init();
              var server;
              yield* next;
              debug("going into send step of starting server");
              var options = {server: {
                  spdy: {
                      protocols: ['h2', 'http/1.1'],
                      plain: true,
                      connection: {
                          windowSize: 1024*1024
                      }
                  }
              }};
              if ( self._config.ssl ) {
                  options.server.key = fs.readFileSync(self._config.ssl.key)
                  options.server.cert = fs.readFileSync(self._config.ssl.cert)
                  options.server.spdy.plain = false;
              }
              if ( forConsole ) {
                  debug("starting with sock");

                  server = self._server = self._app.listen("/tmp/"+Math.random()+Date.now()+".sock", options);
              } else {
                  debug("Trying to listen to", self._config.port, self._config.host);
                  server = self._server = self._app.listen(self._config.port, self._config.host, options);
              }
              var completed = false;
              debug("waiting for listen event");
              server.once("listening", function(){
                  debug("Receiving listening event!");
                  if ( completed ) {
                      resolve(self);
                      self.emit("listening", self);
                  }
                  completed = true;
              });

              if ( completed ) {
                  debug("It has already completed");
                  resolve(self);
                  self.emit("listening", self);
              }
              debug("should get here");
              completed = true;
          }

          var serverMw = startServer;
          if ( app && "__puree_plate__" in app ) {
              self._mounted = true;
              self._server = app._server;
              self._sioInstance = app._sioInstance;
              debug("server is mounting");
              serverMw = function* startMounted(next){
                  debug("starting server mw");

          // debug(self._server);

                  app.once("listening", function(){
                      self.emit("listening", self);
                  });
                  debug("resolving for mounting server");
                  yield* next;
                  debug("going into send step of starting server for platter");
                  resolve(self);

              };
          }
          debug("preparing to start server");
          try {
              var fn = co.wrap(compose([serverMw].concat(self._middleware.map(function(el){
                  return el.setup;
              }).filter(function(el){return undefined !== el;}))));
              debug("starting server...");
              fn.call(self).catch(reject);
          } catch(e) { debug(e.stack); }
      }).catch(function(err){
          debug(err.stack);
      });
  }
  close(){
      debug("closing service...");
      var self = this;
      return new Promise(function(resolve, reject){
          if ( !self._mounted ) {
              self._server.close();
              self._server.on("close", function(err){
                  debug(`server has closed, beginning of the end`);
                  if ( err ) { debug(`server temination failed with ${err}`); return reject(err); }
                  debug(`server closed`);
                  resolve();
              });
          } else {
              resolve();
          }
          var fn = co.wrap(compose((self._middleware.map(function(el){
              return el.teardown;
          }).filter(function(el){return undefined !== el;}))));

          fn.call(self).then(()=>{
              debug(`middleware teardown completed, closing server`);
          }).catch(reject);
      });
  }
}


Puree.DEFAULTCONFIG = {
    port: 3000,
    host: undefined,
    passport: {
        domain: "localhost",
        loginUrl: "locahost/login"
    }
};
Puree.Spices = {
    Service: require("./lib/service").Service,
    Browser: require("./lib/service").Browser,
    Crypt: require("./lib/crypt"),
    JWT: require("./lib/jwt")
};
exports = module.exports = Puree;
