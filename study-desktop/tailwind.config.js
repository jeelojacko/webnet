// Standalone Study tailwind boundary: reuse the host palette/theme, scan
// only Study sources plus the standalone entry. No duplicated theme.
import base from '../tailwind.config.js';

/** @type {import('tailwindcss').Config} */
export default {
  ...base,
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
};
