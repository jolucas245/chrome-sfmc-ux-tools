import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import js from '@eslint/js';

export default [
    {
        ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    },
    js.configs.recommended,
    eslintPluginPrettierRecommended,
    jsdoc.configs['flat/recommended'],
    eslintPluginUnicorn.configs['recommended'],
    {
        languageOptions: {
            globals: {
                ...globals.nodeBuiltin,
            },

            ecmaVersion: 2025,
            sourceType: 'module',
        },

        settings: {
            jsdoc: {
                mode: 'typescript',

                preferredTypes: {
                    array: 'Array',
                    'array.<>': '[]',
                    'Array.<>': '[]',
                    'array<>': '[]',
                    'Array<>': '[]',
                    Object: 'object',
                    'object.<>': 'Object.<>',
                    'object<>': 'Object.<>',
                    'Object<>': 'Object.<>',
                    set: 'Set',
                    'set.<>': 'Set.<>',
                    'set<>': 'Set.<>',
                    'Set<>': 'Set.<>',
                    promise: 'Promise',
                    'promise.<>': 'Promise.<>',
                    'promise<>': 'Promise.<>',
                    'Promise<>': 'Promise.<>',
                },
            },
        },

        rules: {
            'logical-assignment-operators': ['error', 'always'],
            'unicorn/better-regex': 'off',

            'unicorn/catch-error-name': [
                'error',
                {
                    name: 'ex',
                },
            ],

            'unicorn/explicit-length-check': 'off',
            'unicorn/filename-case': 'off',
            'unicorn/no-array-reduce': 'off',
            // keep standard starred JSDoc; the autofix of this rule strips the asterisks
            'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
            'unicorn/no-await-expression-member': 'off',
            'unicorn/no-empty-file': 'off',
            'unicorn/no-hex-escape': 'off',
            'unicorn/no-nested-ternary': 'off',
            'unicorn/no-null': 'off',
            'unicorn/no-unused-properties': 'warn',
            'unicorn/numeric-separators-style': 'off',
            'unicorn/prefer-array-some': 'off',
            'unicorn/prefer-module': 'off',
            'unicorn/prefer-set-has': 'off',
            'unicorn/prefer-spread': 'off',
            'unicorn/prefer-string-replace-all': 'error',
            'unicorn/prevent-abbreviations': 'off',
            'arrow-body-style': ['error', 'as-needed'],
            curly: 'error',
            'no-console': 'error',
            'jsdoc/check-line-alignment': 2,

            'jsdoc/require-jsdoc': [
                'warn',
                {
                    require: {
                        FunctionDeclaration: true,
                        MethodDefinition: true,
                        ClassDeclaration: true,
                        ArrowFunctionExpression: false,
                        FunctionExpression: true,
                    },
                },
            ],

            'jsdoc/require-param-type': 'error',

            'jsdoc/tag-lines': [
                'warn',
                'any',
                {
                    startLines: 1,
                },
            ],

            'jsdoc/no-undefined-types': 'off',
            'jsdoc/valid-types': 'off',

            'spaced-comment': [
                'warn',
                'always',
                {
                    block: {
                        exceptions: ['*'],
                        balanced: true,
                    },
                },
            ],
        },
    },
    {
        files: ['**/*.js'],

        rules: {
            'no-var': 'error',
            'prefer-const': 'error',
            'prettier/prettier': 'warn',
            'prefer-arrow-callback': 'warn',
        },
    },
    {
        // these run in the extension's own world and use its API
        files: [
            'src/editor-context-menu.js',
            'src/editor-theme.js',
            'src/editor-format-setting.js',
            'src/editor-typescript-loader.js',
            'src/readable-keys.js',
            'src/journey-settings.js',
            'src/transactional-messages.js',
            'src/mobile-delete.js',
            'src/deep-link-shell.js',
            'src/deep-link-content-builder.js',
            'src/deep-link-email-studio.js',
            'src/deep-link-contact-builder.js',
            'src/email-studio-left-nav.js',
            'src/email-studio-de-switcher.js',
            'src/email-studio-de-switcher-shell.js',
            'src/user-autofill.js',
            'src/background.js',
            'src/options.js',
        ],

        languageOptions: {
            globals: {
                chrome: 'readonly',
            },
        },
    },
    {
        // the content script is a classic browser script, not a module
        files: ['src/**/*.js'],

        languageOptions: {
            globals: {
                ...globals.browser,
            },

            sourceType: 'script',
        },
    },
    {
        // the demo pages for the pictures of the README: classic scripts in a browser page
        files: ['demo/**/*.js'],

        languageOptions: {
            globals: {
                ...globals.browser,
            },

            sourceType: 'script',
        },
    },
    {
        // the capture script hands functions to the demo pages, which run them in the browser
        files: ['scripts/screenshots.js'],

        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
    },
    {
        // sources of the bundles; esbuild turns them into a classic script
        files: [
            'src/editor-language.js',
            'src/editor-format.js',
            'src/editor-typescript.js',
            'src/editor-codemirror.js',
            'src/editor-language/**/*.js',
        ],

        languageOptions: {
            sourceType: 'module',
        },
    },
];
