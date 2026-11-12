/** @type {import('tailwindcss').Config} */
// 색 토큰 값의 정본은 src/index.css :root (DESIGN.md 를 따르되 색만 먹색·청록·인주색으로 바꿈)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        absent: 'var(--absent)',
        late: 'var(--late)',
        'late-ink': 'var(--late-ink)',
        early: 'var(--early)',
        result: 'var(--result)',
        excused: 'var(--excused)',
        ink: 'var(--ink)',
        'ink-strong': 'var(--ink-strong)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        line: 'var(--line)',
        raised: 'var(--raised)',
        surface: 'var(--surface)',
        paper: 'var(--paper)',
      },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      fontFamily: { sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
