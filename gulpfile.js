var _ = require('lodash');
var gulp = require('gulp');
var stripJsonComments = require('strip-json-comments');
var gutil = require('gulp-util');
var bower = require('bower');
var ngAnnotate = require('gulp-ng-annotate');
var concat = require('gulp-concat');
var sass = require('gulp-sass');
var minifyCss = require('gulp-minify-css');
var rename = require('gulp-rename');
var sh = require('shelljs');
var gitRev = require('git-rev');
var template = require('gulp-template');
var uglify = require('gulp-uglify');
var fs = require('fs');
var path = require('path');
var Q = require('q');
var gulpif = require('gulp-if');
var notifier = require('node-notifier');
var livereload = require('gulp-livereload');
var fontello = require('gulp-fontello');
var del = require('del');

var isWatch = false;
var isLiveReload = process.argv.indexOf('--live-reload') !== -1 || process.argv.indexOf('--livereload') !== -1;

/**
 * helper to wrap a stream with a promise for easy chaining
 * @param stream
 * @returns {Q.Promise}
 */
var streamAsPromise = function(stream) {
    var def = Q.defer();

    stream
        .on('end', function() {
            def.resolve();
        })
        .on('error', function(e) {
            def.reject(e);
        })
    ;

    return def.promise;
};

/**
 * build appconfig from .json files
 *
 * @returns {Q.Promise}
 */
var buildAppConfig = function() {
    var def = Q.defer();

    gitRev.branch(function(branch) {
        gitRev.short(function(rev) {
            var config = {
                VERSION: branch + ":" + rev
            };

            ['./appconfig.json', './appconfig.default.json'].forEach(function(filename) {
                var json = fs.readFileSync(filename);

                if (json) {
                    var data = JSON.parse(stripJsonComments(json.toString('utf8')));
                    config = _.defaults(config, data);
                }
            });

            if (typeof config.API_HTTPS !== "undefined" && config.API_HTTPS === false) {
                config.API_URL = "http://" + config.API_HOST;
            } else {
                config.API_URL = "https://" + config.API_HOST;
            }

            config.STATICSDIR = config.STATICSDIR || config.VERSION.replace(":", "-");
            if (config.CDN) {
                if (config.CDN.substr(-1) != "/") throw new Error("CDN should have trailing /");
                config.STATICSURL = config.CDN + config.STATICSDIR;
            } else {
                config.STATICSURL = config.STATICSDIR;
            }


            def.resolve(config);
        });
    });

    return def.promise;
};

var appConfig = Q.fcall(buildAppConfig);

gulp.task('appconfig', function() {
    appConfig = Q.fcall(buildAppConfig); // refresh the promise with a new build
    return appConfig;
});

gulp.task('appconfig:print', ['appconfig'], function() {
    return appConfig.then(function(APPCONFIG) {
        console.log(JSON.stringify(APPCONFIG));
    });
});

gulp.task('templates:index', ['appconfig'], function() {
    var readTranslations = function(filename) {
        var def = Q.defer();

        fs.readFile(filename, function(err, raw) {
            if (!raw) {
                throw new Error("Missing translations!");
            }

            def.resolve(JSON.parse(stripJsonComments(raw.toString('utf8'))));
        });

        return def.promise;
    };

    return appConfig.then(function(APPCONFIG) {
        var translations = {
            'mobile': {}
        };

        return Q.all(_.map([
            './src/translations/translations/english.json',
            './src/translations/translations/americanEnglish.json',
            './src/translations/translations/french.json',
            './src/translations/translations/dutch.json',
            './src/translations/translations/chinese.json',
            './src/translations/translations/spanish.json',
            './src/translations/translations/russian.json',

            './src/translations/translations/mobile/english.json',
            './src/translations/translations/mobile/americanEnglish.json',
            './src/translations/translations/mobile/french.json',
            './src/translations/translations/mobile/dutch.json',
            './src/translations/translations/mobile/chinese.json',
            './src/translations/translations/mobile/spanish.json',
            './src/translations/translations/mobile/russian.json'
        ], function(filename) {
            var language = path.basename(filename, '.json');
            var isMobile = filename.indexOf('mobile/') !== -1;

            return readTranslations(filename).then(function(result) {
                if (isMobile) {
                    translations['mobile'][language] = result;
                } else {
                    translations[language] = result;
                }
            })
        })).then(function() {
            return streamAsPromise(gulp.src("./src/index.html")
                .pipe(template({
                    VERSION: APPCONFIG.VERSION,
                    STATICSDIR: APPCONFIG.STATICSDIR,
                    STATICSURL: APPCONFIG.STATICSURL,
                    APPCONFIG_JSON: JSON.stringify(APPCONFIG),
                    TRANSLATIONS: JSON.stringify(translations)
                }))
                .pipe(gulp.dest("./www"))
            );
        });
    });
});

gulp.task('templates:rest', ['appconfig'], function() {

    return appConfig.then(function(APPCONFIG) {
        return streamAsPromise(gulp.src("./src/templates/**/*")
            .pipe(gulp.dest("./www/" + APPCONFIG.STATICSDIR + "/templates"))
        );
    });
});

gulp.task('js:libs', ['appconfig'], function() {

    return appConfig.then(function(APPCONFIG) {
        return streamAsPromise(gulp.src([
            "./src/lib/q/q.js",
            "./src/lib/angular/angular.js",
            "./src/lib/ionic-service-core/ionic-core.js",
            "./src/lib/ionic-service-analytics/ionic-analytics.js",
            "./src/lib/angular-ui-router/release/angular-ui-router.js",
            "./src/lib/ng-infinite-scroller-origin/build/ng-infinite-scroll.js",

            // "./src/lib/bootstrap-sass/assets/javascripts/dropdown.js",

            "./src/lib/angular-bootstrap/ui-bootstrap-tpls.js",
            "./src/lib/angular-toggle-switch/angular-toggle-switch.js",

            "./src/lib/pouchdb/dist/pouchdb.js",

            "./src/lib/angular-translate/angular-translate.js",
            "./src/lib/libphonenumber/dist/libphonenumber.js",
            "./src/lib/intl-tel-input/src/js/data.js",

            "./src/lib/moment/moment.js",
            "./src/lib/angular-moment/angular-moment.js",
            "./src/lib/ngImgCrop/compile/unminified/ng-img-crop.js",
            "./src/lib/qrcode/lib/qrcode.js",
            "./src/lib/angular-qr/src/angular-qr.js"
        ])
            .pipe(concat('libs.js'))
            .pipe(gulpif(APPCONFIG.MINIFY, uglify()))
            .pipe(gulp.dest('./www/' + APPCONFIG.STATICSDIR + '/js/'))
        );
    });
});

gulp.task('js:app', ['appconfig'], function() {

    return appConfig.then(function(APPCONFIG) {
        return streamAsPromise(gulp.src([
            './src/js/**/*.js'
        ])
            .pipe(concat('app.js'))
            .pipe(ngAnnotate())
            .on('error', function(e) {
                if (isWatch) {
                    notifier.notify({
                        title: 'GULP watch + js:app + ngAnnotate ERR',
                        message: e.message
                    });
                    console.error(e);
                    this.emit('end');
                } else {
                    throw e;
                }
            })
            .pipe(gulpif(APPCONFIG.MINIFY, uglify()))
            .pipe(gulp.dest('./www/' + APPCONFIG.STATICSDIR + '/js/'))
        );
    });
});

gulp.task('js:sdk', ['appconfig'], function() {

    return appConfig.then(function(APPCONFIG) {
        return streamAsPromise(gulp.src([
            "./src/lib/blocktrail-sdk/build/blocktrail-sdk-full.js"
        ])
            .pipe(concat('sdk.js'))
            .pipe(gulpif(APPCONFIG.MINIFY, uglify({
                mangle: {
                    except: ['Buffer', 'BigInteger', 'Point', 'Script', 'ECPubKey', 'ECKey']
                }
            })))
            .pipe(gulp.dest('./www/' + APPCONFIG.STATICSDIR + '/js/'))
        );
    });
});

var sassTask = function() {

    return appConfig.then(function(APPCONFIG) {
        return streamAsPromise(gulp.src('./src/sass/app.scss')
            .pipe(sass({errLogToConsole: true}))
            .pipe(gulp.dest('./www/' + APPCONFIG.STATICSDIR + '/css/'))
            .pipe(gulpif(APPCONFIG.MINIFY, minifyCss({keepSpecialComments: 0})))
            .pipe(gulp.dest('./www/' + APPCONFIG.STATICSDIR + '/css/'))
        );
    });
};

// create a sass with and without dependancy on fontello
gulp.task('sass', ['appconfig', 'css-rename'], sassTask);
gulp.task('sassfontello', ['appconfig', 'fontello', 'css-rename'], sassTask);

/**
 * css-rename to change .css to .sass extensions because we want the css imported :/
 */
gulp.task('css-rename', function() {

    return streamAsPromise(gulp.src([
        './src/lib/angular-toggle-switch/angular-toggle-switch.css',
        './src/lib/angular-toggle-switch/angular-toggle-switch-bootstrap.css'
    ], { base: process.cwd() })
        .pipe(rename({
            extname: ".scss"
        }))
        .pipe(gulp.dest('./')) // back where you came from
    );
});

gulp.task('fontello-dl', function() {

    return streamAsPromise(gulp.src('./fontello.json')
        .pipe(fontello())
        .pipe(gulp.dest('./www/fontello/'))
    );
});

gulp.task('fontello-rename', ['fontello-dl'], function() {

    return streamAsPromise(gulp.src(['./www/fontello/css/fontello.css'])
        .pipe(rename('_fontello.scss'))
        .pipe(gulp.dest('./www/fontello/css'))
    );
});

gulp.task('fontello-clean', ['fontello-rename'], function() {

    return del([
        './www/fontello/css/*.css'
    ]);
});

gulp.task('fontello', ['fontello-dl', 'fontello-rename', 'fontello-clean'], function() {

    return appConfig.then(function(APPCONFIG) {
        return streamAsPromise(gulp.src('./www/fontello/font/*')
            .pipe(gulp.dest('./www/' + APPCONFIG.STATICSDIR + '/font'))
        );
    });
});

gulp.task('watch', function() {
    isWatch = true;

    if (isLiveReload) {
        livereload.listen();
    }

    gulp.watch(['./fontello.json'], ['fontello:livereload']);
    gulp.watch(['./src/sass/**/*.scss', './www/fontello/**/*'], ['sass:livereload']);
    gulp.watch(['./src/js/**/*.js'], ['js:app:livereload']);
    gulp.watch(['./src/lib/**/*.js'], ['js:libs:livereload', 'js:sdk:livereload']);
    gulp.watch(['./src/templates/**/*', './src/index.html'], ['templates:livereload']);
    gulp.watch(['./appconfig.json', './appconfig.default.json'], ['default:livereload']);
});

gulp.task('fontello:livereload', ['fontello'], function() {
    livereload.reload();
});

gulp.task('sass:livereload', ['sass'], function() {
    livereload.reload();
});

gulp.task('js:app:livereload', ['js:app'], function() {
    livereload.reload();
});

gulp.task('js:libs:livereload', ['js:libs'], function() {
    livereload.reload();
});

gulp.task('js:sdk:livereload', ['js:sdk'], function() {
    livereload.reload();
});

gulp.task('templates:livereload', ['templates'], function() {
    livereload.reload();
});

gulp.task('default:livereload', ['default'], function() {
    livereload.reload();
});

gulp.task('js', ['js:libs', 'js:app', 'js:sdk']);
gulp.task('templates', ['templates:index', 'templates:rest']);
gulp.task('default', ['sassfontello', 'templates', 'js']);
gulp.task('nofontello', ['sass', 'templates', 'js']);
