import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'android-web/**/*',
      'android/**/*',
      'backend/**/*',
      'node_modules/**/*',
      'functions/**/*',
      'scripts/**/*',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
