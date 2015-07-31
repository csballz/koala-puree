var run = require("gulp-run");
var gulp = require('gulp');

gulp.task('cleanjsdocs', function(cb){
	return require('del')(['docs/jsdoc'], cb);
})

gulp.task('jsdoc', ['cleanjsdocs'], function(){
    return run("./node_modules/.bin/jsdoc  -r -d docs/jsdocs **/*.js").exec(function(){
    	console.log(arguments);
    })
})

gulp.task('watchJsdoc', function(){
    return gulp.watch(['./!(docs|node_modules)/**/*.js', '!Gulpfile.js'], ['jsdoc']);
})
