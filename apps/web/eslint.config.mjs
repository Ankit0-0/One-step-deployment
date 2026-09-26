import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', 'next-env.d.ts', 'coverage/**'] },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
];

export default config;
