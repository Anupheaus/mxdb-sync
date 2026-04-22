const base = require('../../ci-templates/eslint/base');
module.exports = {
  ...base,
  rules: {
    ...base.rules,
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
