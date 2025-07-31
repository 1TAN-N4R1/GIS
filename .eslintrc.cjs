module.exports = {
  env: { browser: true, es2021: true, node: true },
  extends: ['airbnb', 'plugin:react/recommended', 'plugin:react-hooks/recommended', 'prettier'],
  parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react', 'prettier'],
  rules: {
    'prettier/prettier': ['error'],
    'react/jsx-filename-extension': [1, { extensions: ['.jsx'] }],
    'import/extensions': ['error', 'ignorePackages', { js: 'never', jsx: 'never' }],
    'react/react-in-jsx-scope': 'off'
  },
  settings: { react: { version: 'detect' }, 'import/resolver': { node: { extensions: ['.js', '.jsx'] } } }
};