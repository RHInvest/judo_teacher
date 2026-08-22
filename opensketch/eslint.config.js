import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * ESLint-Konfiguration.
 *
 * Bewusst schmal gehalten: TypeScript im strict-Modus und 1900 Tests decken
 * das meiste ab, was eine Linter-Regel finden koennte. Hier stehen nur Regeln,
 * die echte Fehler melden - keine Stilregeln. Eine Konfiguration, die bei
 * jedem Lauf hundert Formatierungshinweise ausspuckt, wird nach einer Woche
 * ignoriert und faengt dann auch die echten Funde nicht mehr ab.
 *
 * OWNERSHIP: Lead.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      /* Echte Fehlerquellen */
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-alert': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-fallthrough': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-constant-binary-expression': 'error',
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'off',

      /* React-Hooks: die einzige Regelklasse, die statisch Fehler findet,
         welche TypeScript prinzipiell nicht sehen kann. */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      /* TypeScript: nur was ueber die Typpruefung hinausgeht.
         Ungenutzte Namen sind bewusst aus, weil tsconfig sie erlaubt und
         Platzhalterparameter in Contract-Signaturen normal sind. */
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
    },
  },
  {
    /* Tests duerfen mehr: Attrappen brauchen Typloecher, und die Konsole ist
       dort ein legitimes Werkzeug. */
    files: ['**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
)
