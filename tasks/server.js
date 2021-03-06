/*
 * grunt-bbb-server
 * https://github.com/backbone-boilerplate/grunt-bbb-server
 *
 * Copyright 2013 Tim Branyen
 * Licensed under the MIT license.
 */
"use strict";

module.exports = function(grunt) {
  var ENV = process.env;
  var CWD = process.cwd();

  var path = require("path");
  var fs = require("fs");
  var https = require("https");

  // External libs.
  var express = require("express");
  var requirejs = require("requirejs");
  var gzip = require("gzip-js");
  var httpProxy = require("http-proxy");

  var _ = grunt.util._;

  grunt.registerTask("server", "Run development server.", function() {

    var options = {
      // Fundamentals.
      favicon: "favicon.ico",
      index: "index.html",

      // Should this router automatically handle pushState requests.
      pushState: true,

      // Url root paths.  These are useful to determine where application vs
      // vendor code exists in the path.
      root: "/",
      appDir: "app",

      // Where on the filesystem files are, can be absolute or relative.
      prefix: ".",

      // Should this server exist forever or die immediately after all tasks
      // are done.
      forever: true,

      // Controls how the server is run.
      ssl: ENV.SSL || false,
      host: ENV.HOST || "127.0.0.1",
      port: ENV.PORT || 8000,

      // Register default compiler mappings.
      middleware: {
        // Script pre-processors.
        //"\.coffee$": require("grunt-lib-coffee").compile,
        //"\.ts$": require("grunt-lib-typescript").compile,
        "\.js$": function(buffer, req, res, next) {
          // Only process JavaScript that are required modules, this means
          // bailing out early if not in the module path.
          if (req.url.indexOf(options.root + options.appDir) !== 0) {
            return next();
          }

          // The module name is just the JavaScript file stripped of the
          // host and location.
          var moduleName = req.url.split(options.root + options.appDir)[1];
          moduleName = moduleName.slice(1);

          // This method allows hooking into the RequireJS toolchain.
          requirejs.tools.useLib(function(require) {
            // Convert to AMD if using CommonJS, by default the conversion
            // will ignore modules that already contain a define.
            require(["commonJs"], function(commonJs) {
              var wrapped = commonJs.convert(moduleName, String(buffer));
              res.header("Content-type", "application/javascript");
              next(wrapped);
              //res.send(wrapped);
            });
          });
        },

        // Style pre-processors.
        "\.styl$": function(buffer, req, res, next) {
          var stylus = require("grunt-lib-stylus").init(grunt);
          var contentType = "text/css";
          var opts = {
            paths: ["." + req.url.split("/").slice(0, -1).join("/") + "/"]
          };

          // Compile the source.
          stylus.compile(String(buffer), opts, function(contents) {
            res.header("Content-type", contentType);
            next(contents);
            //res.send(contents);
          });
        },
        
        //"\.less$": require("grunt-lib-less").compile,
        //"\.scss$": require("grunt-lib-scss").compile,
      },

      // These mappings take precedence over `pushState` redirection.
      map: fs.readdirSync(CWD).filter(function(file) {
        return fs.statSync(file).isDirectory();
      }).reduce(function(memo, current) {
        memo[current] = current;
        return memo;
      }, {}),

      proxy: {},

      // Any express-compatible server will work here.
      server: null,
    };
    
    var configOptions = grunt.config(["server"].concat(_.toArray(arguments)));

    // Merge options from configuration.
    _.each(options, function(value, key) {
      // Only change defaults that have overrides.
      if (key in configOptions) {
        // Allow objects to be extended and overwritten.
        if (_.isObject(value)) {
          options[key] = _.extend(value, configOptions[key]);
        } else {
          options[key] = configOptions[key];
        }
      }
    });

    // Run forever and disable crashing.
    if (options.forever === true) {
      // Put this task into async mode, and never complete it.
      this.async();

      // Setting force to true, keeps Grunt from crashing while running the
      // server.
      grunt.option("force", true);
    }

    // Make this value more meaningful otherwise you can provide your own keys.
    if (_.isBoolean(options.ssl) && options.ssl) {
      // Load the SSL certificates, in case they are needed.
      options.ssl = {
        key: fs.readFileSync(__dirname + "/ssl/server.key", "utf8"),
        cert: fs.readFileSync(__dirname + "/ssl/server.crt", "utf8")
      };
    }

    // Run the server.
    run(options);

  });

  // Actually run the server...
  function run(options) {
    // If the server is already available use it.
    var site = options.server ? options.server() : express();
    var protocol = options.ssl ? "https" : "http";

    // TODO Determine if this is necessary.
    //site.use(require("connect-restreamer")());

    // Go through each compiler and provide an identical serving experience.
    _.each(options.middleware, function(callback, extension) {
      // Investigate if there is a better way of writing this.
      site.get(new RegExp(extension), function(req, res, next) {
        var url = req.url;
        // If there are query parameters, remove them.
        url = url.split("?")[0];

        // Read in the file contents.
        fs.readFile("." + url, function(err, buffer) {
          // File wasn't found.
          if (err) {
            return next();
          }

          callback(buffer, req, res, next);
        });
      });
    });

    // Map static folders to take precedence over redirection.
    Object.keys(options.map).sort().reverse().forEach(function(name) {
      var dirMatch = grunt.file.isDir(options.map[name]) ? "/*" : "";
      site.get(options.root + name + dirMatch, function(req, res, next) {
        // Find filename.
        var filename = req.url.slice((options.root + name).length)
        // If there are query parameters, remove them.
        filename = filename.split("?")[0];

        res.sendfile(path.join(options.map[name] + filename));
      });
    });

    // Very similar to map, except that the mapped path is another server.
    Object.keys(options.proxy).sort().reverse().forEach(function(name) {
      var target = options.proxy[name];
      var protocol = target.https ? "https" : "http";

      var proxyOptions = {
        // This can be a string or an object.
        target: target,

        // Do not change the origin, this can affect how servers respond.
        changeOrigin: false,

        // Remove the forwarded headers, make it feel seamless.
        enable : {
          xforward: false
        }
      };

      // Ensure the https proxy settings are configured here as well.
      if (_.isBoolean(target.https) && target.https) {
        proxyOptions.https = {
          key: fs.readFileSync(__dirname + "/ssl/server.key", "utf8"),
          cert: fs.readFileSync(__dirname + "/ssl/server.crt", "utf8")
        };
      }

      // Initialize the actual proxy object.
      var proxy = new httpProxy.HttpProxy(proxyOptions);

      // Same thing for these, if you have https boolean set to true, default
      // to internal keys/certs.
      if (_.isBoolean(target.https) && target.https) {
        // Load the SSL certificates, in case they are needed.
        target.https = {
          key: fs.readFileSync(__dirname + "/ssl/server.key", "utf8"),
          cert: fs.readFileSync(__dirname + "/ssl/server.crt", "utf8")
        };
      }

      // Listen on all HTTP verbs for seamless proxying.
      site.all(options.root + name, function(req, res, next) {
        var referer = protocol + "://" + options.host;

        if (options.port !== "80") {
          referer += ":" + options.port;
        }

        // This will set the most likely default for the referer, but allows
        // it to be overwritten by passing a custom `headers` object.
        _.extend(req.headers, {
          referer: referer
        }, target.headers);

        // Make the proxy request.
        proxy.proxyRequest(req, res);
      });
    });

    // Compression middleware.
    site.all("*", function(content, req, res, next) {
      if (content) {
        return res.send(content);
      }

      next();
    });

    // Ensure all routes go home, client side app..
    if (options.pushState) {
      site.all("*", function(req, res) {
        fs.createReadStream(options.index).pipe(res);
      });
    }

    // Echo out a message alerting the user that the server is running.
    console.log("Listening on", protocol + "://" + options.host + ":" +
      options.port);

    // Start listening.
    if (!options.ssl) {
      return site.listen(options.port, options.host);
    }

    // Create the SSL server instead...
    https.createServer(options.ssl, site).listen(options.port, options.host);
  }
};
