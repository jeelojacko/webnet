/** @type {import('tailwindcss').Config} */
const withOpacity = (varName) => `rgb(var(${varName}) / <alpha-value>)`;

const palette = (name, shades) =>
  Object.fromEntries(shades.map((shade) => [shade, withOpacity(`--theme-${name}-${shade}`)]));

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: palette('slate', [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        blue: palette('blue', [100, 300, 400, 500, 600, 900, 950]),
        green: palette('green', [400, 500, 600, 700, 900]),
        red: palette('red', [100, 300, 400, 500, 900]),
        amber: palette('amber', [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        cyan: palette('cyan', [100, 200, 300, 400, 500, 700, 800, 900, 950]),
        emerald: palette('emerald', [100, 400, 700]),
        rose: palette('rose', [100, 200, 300, 500, 800, 900, 950]),
      },
    },
  },
  plugins: [],
};
