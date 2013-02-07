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

  // External libs.
  var express = require("express");
  var requirejs = require("requirejs");

  var _ = grunt.util._;

  grunt.registerTask("server", "Run development server.", function() {
    // Merge defaults and declarative options.
    var options = this.options({

      // Fundamentals.
      favicon: "favicon.ico",
      index: "index.html",

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
        //".coffee": require("grunt-lib-coffee").compile,
        //".ts": require("grunt-lib-typescript").compile,
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
              res.send(wrapped);
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
            res.send(contents);
          });
        },
        
        //".less": require("grunt-lib-less").compile,
        //".scss": require("grunt-lib-scss").compile,
      },

      // These mappings take precedence over `pushState` redirection.
      map: fs.readdirSync(CWD).filter(function(file) {
        return fs.statSync(file).isDirectory();
      }).reduce(function(memo, current) {
        memo[current] = current;
        return memo;
      }, {}),

      // Any express-compatible server will work here.
      server: null,

    // Pull nested options in.
    }, grunt.config(["server"].concat(_.toArray(arguments))));

    // Run forever and disable crashing.
    if (options.forever === true) {
      // Put this task into async mode, and never complete it.
      this.async();

      // Setting force to true, keeps Grunt from crashing while running the
      // server.
      grunt.option("force", true);
    }

    // Run the server.
    run(options);
  });

  // Actually run the server...
  function run(options) {
    // If the server is already available use it.
    var site = options.server ? options.server() : express();

    // Go through each compiler and provide an identical serving experience.
    _.each(options.middleware, function(callback, extension) {
      // Investigate if there is a better way of writing this.
      site.get(new RegExp(extension), function(req, res, next) {
        var url = req.url;
        // If there are query parameters, remove them.
        url = url.split("?")[0];

        // Read in the file contents.
        fs.readFile("." + url, function(err, buffer) {
          callback(buffer, req, res, next);
        });
      });
    });

    // Map static folders to take precedence over redirection.
    Object.keys(options.map).reverse().forEach(function(name) {
      site.get(options.root + name + "/*", function(req, res, next) {
        // Find filename.
        var filename = req.url.slice((options.root + name).length)
        // If there are query parameters, remove them.
        filename = filename.split("?")[0];

        res.sendfile(path.join(options.map[name] + filename));
      });
    });

    // Ensure all routes go home, client side app..
    site.all("*", function(req, res) {
      fs.createReadStream(options.index).pipe(res);
    });

    // Start listening.
    site.listen(options.port, options.host);

    // Echo out a message alerting the user that the server is running.
    console.log("Listening on http://" + options.host + ":" + options.port);
  }
};
